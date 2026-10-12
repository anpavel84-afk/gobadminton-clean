import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe,expect,it } from "vitest";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
run("A3 additive upgrade from0030",()=>{
 it("preserves legacy reports/audit/users and creates no invented cases or evidence",async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL}),c=await pool.connect(),schema="a3_upgrade_"+randomUUID().replaceAll("-",""),root=path.resolve(__dirname,"../../migrations");
  try{
   await c.query("CREATE SCHEMA "+schema);await c.query("SET search_path TO "+schema+",public");
   for(const file of readdirSync(root).filter(f=>f.endsWith(".sql")&&f<"0031").sort())await c.query(readFileSync(path.join(root,file),"utf8"));
   const users=(await c.query("INSERT INTO users(display_name) VALUES('A3 legacy reporter'),('A3 legacy target') RETURNING id")).rows;
   await c.query("INSERT INTO abuse_reports(reporter_user_id,target_kind,target_user_id,target_public_player_id,reason_code,detail,evidence_refs,state) VALUES($1,'player',$2,$3,'spam','Legacy retained original','[\"legacy-original\"]','closed')",[users[0].id,users[1].id,randomUUID()]);
   await c.query("INSERT INTO privileged_audit_events(system_actor,roles_snapshot,permission_key,action_key,target_type,target_id,reason_code,request_id) VALUES('system_bootstrap','[]','identity.manage','admin.bootstrap','admin_principal','historical','synthetic_fixture',gen_random_uuid())");
   const snapshot=async()=>JSON.stringify((await c.query("SELECT (SELECT json_agg(r) FROM abuse_reports r) reports,(SELECT json_agg(a) FROM privileged_audit_events a) audit,(SELECT json_agg(u) FROM users u) users")).rows);
   const before=await snapshot();await c.query(readFileSync(path.join(root,"0031_support_cases.sql"),"utf8"));expect(await snapshot()).toBe(before);
   for(const table of ["support_cases","support_case_links","support_case_actions","case_evidence_items"])expect((await c.query("SELECT * FROM "+table)).rowCount).toBe(0);
  }finally{await c.query("RESET search_path");await c.query("DROP SCHEMA IF EXISTS "+schema+" CASCADE");c.release();await pool.end();}
 },120000);
});
