import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
run("0034 additive venue cover upgrade / unused rollback",()=>{
  it("preserves old venue/profile state, refuses populated rollback, journals replacement and deletion",async()=>{
    const url=new URL(process.env.DATABASE_URL!);
    if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Disposable loopback PostGIS required");
    const admin=new Pool({connectionString:url.href}),name=`venue_cover_upgrade_${randomUUID().replaceAll("-","")}`;
    await admin.query(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;const pool=new Pool({connectionString:url.href});
    const dir=path.resolve(__dirname,"../../migrations");
    try {
      await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
      for(const file of (await readdir(dir)).filter(f=>f.endsWith(".sql")&&f<"0034").sort())await pool.query(await readFile(path.join(dir,file),"utf8"));
      const user=randomUUID(),venue=randomUUID(),key="a".repeat(64)+".png";
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Synthetic migration')",[user]);
      await pool.query("INSERT INTO player_social_profiles(user_id,display_name,cover_key,cover_moderation_approval_id) VALUES($1,'Synthetic migration',NULL,NULL)",[user]);
      await pool.query(`INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,version,lifecycle_state,normalized_name,normalized_address)
        VALUES($1,'a0000000-0000-4000-8000-000000000001','Synthetic','Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$2,8,'verified','synthetic','synthetic address')`,[venue,user]);
      const migration=await readFile(path.join(dir,"0034_venue_cover.sql"),"utf8"),rollback=await readFile(path.join(dir,"rollback/0034_venue_cover.sql"),"utf8");
      await pool.query(migration);
      expect((await pool.query("SELECT version,cover_key,cover_actor_id,cover_moderation_approval_id FROM venues WHERE id=$1",[venue])).rows[0]).toEqual({version:8,cover_key:null,cover_actor_id:null,cover_moderation_approval_id:null});
      expect((await pool.query("SELECT count(*)::int AS n FROM player_social_profiles WHERE user_id=$1",[user])).rows[0].n).toBe(1);
      await pool.query("BEGIN");await pool.query(rollback);await pool.query("COMMIT");await pool.query(migration);
      const approval=(await pool.query(`INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at)
        VALUES('image','cover_image',1,$1,'avatar-image-v1','none','fake','synthetic','{}','allow',now()) RETURNING id`,["b".repeat(64)])).rows[0].id;
      await expect(pool.query("UPDATE venues SET cover_key=$2 WHERE id=$1",[venue,key])).rejects.toThrow();
      await pool.query("UPDATE venues SET cover_key=$2,cover_moderation_approval_id=$3,cover_actor_id=$4 WHERE id=$1",[venue,key,approval,user]);
      expect((await pool.query("SELECT venue_cover_url($1) AS url",[venue])).rows[0].url).toBe(`/v1/media/venue-covers/${key}`);
      await pool.query("BEGIN");await expect(pool.query(rollback)).rejects.toThrow("refuses populated");await pool.query("ROLLBACK");
      const replacement="c".repeat(64)+".png";
      await pool.query("UPDATE venues SET cover_key=$2 WHERE id=$1",[venue,replacement]);
      expect((await pool.query("SELECT storage_key FROM avatar_media_gc WHERE storage_key=$1",[key])).rowCount).toBe(1);
      await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[user]);
      expect((await pool.query("SELECT version,cover_key FROM venues WHERE id=$1",[venue])).rows[0]).toEqual({version:9,cover_key:null});
      expect((await pool.query("SELECT storage_key FROM avatar_media_gc WHERE storage_key=$1",[replacement])).rowCount).toBe(1);
      expect((await pool.query("SELECT PostGIS_Version() AS v")).rows[0].v).toBeTruthy();
    } finally {await pool.end();await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
  },120000);
});
