import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe,expect,it } from "vitest";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
run('Admin A2b additive upgrade from0029',()=>{
  it('preserves historical Games and A0a privileged audit; no invented moderation truth',async()=>{
    const pool=new Pool({connectionString:process.env.DATABASE_URL}),c=await pool.connect(),schema='a2b_upgrade_'+randomUUID().replaceAll('-',''),root=path.resolve(__dirname,'../../migrations');
    try{
      await c.query('CREATE SCHEMA '+schema);await c.query('SET search_path TO '+schema+',public');
      for(const f of readdirSync(root).filter(f=>f.endsWith('.sql')&&f<'0030').sort())await c.query(readFileSync(path.join(root,f),'utf8'));
      const u=(await c.query("INSERT INTO users(display_name) VALUES('A2b upgrade fixture') RETURNING id")).rows[0].id;
      const v=(await c.query(`INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
        SELECT id,'Upgrade synthetic','Synthetic','Europe/Moscow',ST_SetSRID(ST_MakePoint(37,55),4326)::geography,$1,'unverified','a2b venue','a2b address' FROM cities LIMIT 1 RETURNING id`,[u])).rows[0].id;
      const g=(await c.query(`INSERT INTO games(venue_id,title,status,visibility,starts_at,ends_at,timezone,application_deadline_at,capacity,external_reserved_count,format_key,level_scale_id,level_scale_version,allowed_level_ids,settlement_mode,settlement_purpose,settlement_terms,created_by_user_id,host_display_name,host_public_contact,activity_kind)
        VALUES($1,'Historical cancelled','cancelled','public',now()+interval '2 days',now()+interval '3 days','Europe/Moscow',now()+interval '1 day',4,0,'doubles','test',1,'["test"]','external','no_trainer_fee','Synthetic',$2,'Fixture','Fixture','regular') RETURNING id`,[v,u])).rows[0].id;
      await c.query("INSERT INTO privileged_audit_events(system_actor,roles_snapshot,permission_key,action_key,target_type,target_id,reason_code,request_id) VALUES('system_bootstrap','[]','identity.manage','admin.bootstrap','admin_principal','historical','synthetic_fixture',gen_random_uuid())");
      const snapshot=async()=>JSON.stringify((await c.query('SELECT (SELECT json_agg(g) FROM games g) games,(SELECT json_agg(a) FROM privileged_audit_events a) audit,(SELECT json_agg(u) FROM users u) users')).rows);
      const before=await snapshot();await c.query(readFileSync(path.join(root,'0030_user_capability_restrictions.sql'),'utf8'));expect(await snapshot()).toBe(before);
      expect((await c.query('SELECT * FROM user_restriction_state')).rowCount).toBe(0);expect((await c.query('SELECT * FROM user_restriction_actions')).rowCount).toBe(0);expect((await c.query('SELECT status FROM games WHERE id=$1',[g])).rows[0].status).toBe('cancelled');
    }finally{await c.query('RESET search_path');await c.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');c.release();await pool.end();}
  },120000);
});
