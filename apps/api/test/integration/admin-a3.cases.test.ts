import cookie from "@fastify/cookie";
import { FastifyAdapter,type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE,type AdminRole } from "../../src/admin/rbac";
import { CASE_EVIDENCE_POLICY,type CaseEvidencePolicy } from "../../src/admin/case-evidence-policy";
import { hashSecret,sealSecret } from "../../src/auth/crypto";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv,type AppEnv } from "../../src/config/env";
import { buildTestCoreModule } from "./test-core.module";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
const origin="http://localhost:18980",pepper="a3-synthetic-admin-pepper-at-least-32chars";
type Actor={id:string;userId:string;token:string;csrf:string;sessionId:string;credentialId:string};
run("A3 synthetic cases / scoped evidence / immutable audit",()=>{
 let databaseAdmin:Pool,fixtureDatabase:string;
 let app:NestFastifyApplication,pool:Pool,env:AppEnv,moderator:Actor,support:Actor,otherSupport:Actor,superadmin:Actor,content:Actor,policy:CaseEvidencePolicy;
 beforeAll(async()=>{
  Object.assign(process.env,{NODE_ENV:"test",APP_ENV:"local",AUTH_PEPPER:"a3-synthetic-consumer-pepper-at-least-32",PUBLIC_API_ORIGIN:"http://127.0.0.1:18981",PUBLIC_WEB_ORIGIN:"http://127.0.0.1:18982",ALLOWED_WEB_ORIGINS:"http://127.0.0.1:18982"});
  // Own disposable DB: legacy suites intentionally clear consumer reports globally.
  // Case-linked history must stay immutable; never weaken FKs or alter their cleanup.
  const sourceUrl=new URL(process.env.DATABASE_URL!);
  if(!["127.0.0.1","localhost","[::1]"].includes(sourceUrl.hostname))throw new Error("A3 fixtures require disposable loopback PostgreSQL");
  databaseAdmin=new Pool({connectionString:sourceUrl.toString()});fixtureDatabase="a3_cases_"+randomUUID().replaceAll("-","");
  await databaseAdmin.query("CREATE DATABASE "+fixtureDatabase);
  sourceUrl.pathname="/"+fixtureDatabase;process.env.DATABASE_URL=sourceUrl.toString();
  execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:process.env,stdio:"inherit"});
  env=loadEnv({...process.env,ADMIN_INTERNAL_ENABLED:"1",CASES_INTERNAL_ENABLED:"1",CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS:"3600",ADMIN_ORIGIN:origin,ADMIN_AUTH_PEPPER:pepper});
  pool=new Pool({connectionString:env.DATABASE_URL,max:20});
  const mod=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AdminModule]}).compile();policy=mod.get(CASE_EVIDENCE_POLICY);
  app=mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}),{logger:false});await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
  moderator=await actor("moderator");support=await actor("support");otherSupport=await actor("support");superadmin=await actor("superadmin");content=await actor("content_manager");
 },120000);
 beforeEach(async()=>{await pool.query("DELETE FROM admin_rate_windows");});
 afterAll(async()=>{await app?.close();await pool?.end();if(fixtureDatabase)await databaseAdmin.query("DROP DATABASE "+fixtureDatabase);await databaseAdmin?.end();});
 async function user(){return (await pool.query("INSERT INTO users(display_name) VALUES('A3 synthetic') RETURNING id")).rows[0].id as string;}
 async function actor(role:AdminRole):Promise<Actor>{const userId=await user(),id=(await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[userId])).rows[0].id;
  await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",[id,role]);const credentialId=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID();
  await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[credentialId,id,Buffer.from("synthetic-command-fixture")]);
  const sessionId=(await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",[id,credentialId,hashSecret(pepper,token),sealSecret(pepper,csrf)])).rows[0].id;return {id,userId,credentialId,token,csrf,sessionId};}
 async function report(){return (await pool.query("INSERT INTO abuse_reports(reporter_user_id,target_kind,target_user_id,target_public_player_id,reason_code,detail,evidence_refs,state) VALUES($1,'player',$2,$3,'spam','RAW email person@example.test token GPS SECRET','[\"private-chat-secret\"]','submitted') RETURNING id",[await user(),await user(),randomUUID()])).rows[0].id as string;}
 function get(route:string,a=moderator){return app.inject({method:"GET",url:"/v1/admin/"+route,cookies:{[ADMIN_COOKIE]:a.token},headers:{origin}});}
 function post(route:string,body:object,a=moderator,key:string=randomUUID()){return app.inject({method:"POST",url:"/v1/admin/"+route,cookies:{[ADMIN_COOKIE]:a.token},headers:{origin,"x-csrf-token":a.csrf,"idempotency-key":key},payload:body});}
 async function create(reportId?:string){const r=await post("cases",{reportId:reportId??await report(),reasonCode:"synthetic_review"});expect(r.statusCode,r.body).toBe(200);return r.json().id as string;}
 async function detail(id:string,a=moderator){const r=await get("cases/"+id,a);expect(r.statusCode,r.body).toBe(200);return r.json();}
 function command(id:string,body:object,a=moderator,key?:string){return post(`cases/${id}/commands`,body,a,key);}
 function change(action:string,expectedVersion:number,extra:object={}){return {action,expectedVersion,reasonCode:"synthetic_review",...extra};}
 async function assign(id:string,principalId:string|null,a=moderator){const d=await detail(id,a),r=await command(id,change("assign",d.version,{principalId}),a);expect(r.statusCode,r.body).toBe(200);return r.json();}
 async function capture(id:string,a=moderator,linkId?:string){const d=await detail(id,a),r=await command(id,change("capture_evidence",d.version,{linkId:linkId??d.links[0].id}),a);expect(r.statusCode,r.body).toBe(200);return r.json().evidenceId as string;}
 it("legacy report queue is additive, minimal, audited; exact lookup and bounded no-store pagination",async()=>{
  const r1=await report(),r2=await report(),before=(await pool.query("SELECT * FROM abuse_reports WHERE id=ANY($1::uuid[]) ORDER BY id",[[r1,r2]])).rows;
  const queue=await get("reports?limit=1");expect(queue.statusCode).toBe(200);expect(queue.headers["cache-control"]).toBe("no-store");expect(queue.json().items).toHaveLength(1);expect(queue.json().nextBeforeId).toBeTruthy();
  const id=await create(r1);expect((await get("cases/"+id,superadmin)).statusCode).toBe(200);const exact=await get("reports?reportId="+r1);expect(exact.json().items[0].caseId).toBe(id);expect(JSON.stringify(exact.json())).not.toMatch(/RAW|person@|SECRET|private-chat|reporter_user_id|target_user_id|detail|evidence_refs/);
  expect((await pool.query("SELECT * FROM abuse_reports WHERE id=ANY($1::uuid[]) ORDER BY id",[[r1,r2]])).rows).toEqual(before);
  expect((await get("reports",support)).statusCode).toBe(403);expect((await get("reports",content)).statusCode).toBe(403);expect((await get("reports?email=person@example.test")).statusCode).toBe(400);
 });
 it("support assigned-only scope, no global creation/assignment/linking/evidence enumeration",async()=>{
  const id=await create(),other=await create();expect((await get("cases/"+id,support)).statusCode).toBe(404);await assign(id,support.id);
  const d=await detail(id,support);expect((await get("cases",support)).json().items.map((x:{id:string})=>x.id)).toEqual([id]);
  expect((await get("cases/"+other,support)).statusCode).toBe(404);expect((await get(`cases/${other}/evidence`,support)).statusCode).toBe(404);expect((await get("cases/"+id,otherSupport)).statusCode).toBe(404);
  for(const body of [change("assign",d.version,{principalId:otherSupport.id}),change("link_report",d.version,{reportId:await report()}),change("link_game",d.version,{gameId:randomUUID()})])expect((await command(id,body,support)).statusCode).toBe(403);
  expect((await post("cases",{reportId:await report(),reasonCode:"synthetic_review"},support)).statusCode).toBe(403);expect((await get("cases",content)).statusCode).toBe(403);expect((await command(id,change("note",d.version,{noteCode:"review_started"}),support)).statusCode).toBe(200);
 });
 it("consumer/Origin/CSRF and stale stepup fail closed; capture/list/read freshness",async()=>{
  const id=await create(),d=await detail(id),payload=change("capture_evidence",1,{linkId:d.links[0].id});
  expect((await app.inject({method:"GET",url:"/v1/admin/cases",headers:{origin,authorization:"Bearer "+moderator.token}})).statusCode).toBe(401);
  expect((await app.inject({method:"GET",url:"/v1/admin/cases",headers:{origin:"http://127.0.0.1:18982"},cookies:{[ADMIN_COOKIE]:moderator.token}})).statusCode).toBe(403);
  expect((await app.inject({method:"POST",url:`/v1/admin/cases/${id}/commands`,headers:{origin,"idempotency-key":randomUUID()},cookies:{[ADMIN_COOKIE]:moderator.token},payload})).statusCode).toBe(403);
  const eid=await capture(id);await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1",[moderator.sessionId]);
  for(const route of [`cases/${id}/evidence`,`cases/${id}/evidence/${eid}`])expect((await get(route)).statusCode).toBe(403);
  expect((await command(id,change("capture_evidence",2,{linkId:d.links[0].id}))).statusCode).toBe(403);await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE id=$1",[moderator.sessionId]);
 });
 it("strict UUID/version/action/code DTOs reject arbitrary private notes and evidence bodies",async()=>{
  const id=await create();for(const body of [change("note",0,{noteCode:"review_started"}),change("note",1,{noteCode:"RAW email secret"}),change("note",1,{noteCode:"review_started",text:"SECRET"}),change("capture_evidence",1,{linkId:"bad"}),change("note",1,{noteCode:"review_started",payload:{secret:true}})])expect((await command(id,body)).statusCode).toBe(400);
  expect((await get("cases/bad")).statusCode).toBe(400);expect((await get("cases?limit=101")).statusCode).toBe(400);expect((await get("cases?beforeId=bad")).statusCode).toBe(400);expect((await command(id,change("note",1,{noteCode:"review_started"}),moderator,"short")).statusCode).toBe(400);expect((await detail(id)).version).toBe(1);
 });
 it("same-key replay serializes once; changed request conflicts; assignment loss denies cached response",async()=>{
  const id=await create();await assign(id,support.id);const key=randomUUID(),body=change("note",2,{noteCode:"review_started"});const rs=await Promise.all([command(id,body,support,key),command(id,body,support,key)]);expect(rs.map(r=>r.statusCode)).toEqual([200,200]);expect(rs[0].json()).toEqual(rs[1].json());
  expect((await command(id,{...body,noteCode:"escalated"},support,key)).statusCode).toBe(409);await assign(id,otherSupport.id);expect((await command(id,body,support,key)).statusCode).toBe(404);
  expect((await pool.query("SELECT count(*)::int n FROM support_case_actions WHERE case_id=$1 AND action='note'",[id])).rows[0].n).toBe(1);
 });
 it("concurrent expected-version writes and competing case creation for one report serialize",async()=>{
  const id=await create();const rs=await Promise.all([command(id,change("note",1,{noteCode:"review_started"})),command(id,change("note",1,{noteCode:"escalated"}))]);expect(rs.map(r=>r.statusCode).sort()).toEqual([200,409]);
  const rid=await report(),body={reportId:rid,reasonCode:"synthetic_review"};const created=await Promise.all([post("cases",body),post("cases",body)]);expect(created.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await pool.query("SELECT count(*)::int n FROM support_case_links WHERE report_id=$1",[rid])).rows[0].n).toBe(1);
 });
 it("closure/reopen preserves report, notes, links/evidence and denies changes while closed",async()=>{
  const rid=await report(),id=await create(rid),eid=await capture(id);
  const before=(await pool.query("SELECT * FROM abuse_reports WHERE id=$1",[rid])).rows;
  for(const [version,status] of [[2,"in_review"],[3,"resolved"],[4,"closed"]] as const)expect((await command(id,change("status",version,{status}))).statusCode).toBe(200);
  expect((await command(id,change("note",5,{noteCode:"escalated"}))).statusCode).toBe(409);expect((await get(`cases/${id}/evidence/${eid}`)).statusCode).toBe(200);expect((await command(id,change("status",5,{status:"open"}))).statusCode).toBe(200);
  expect((await detail(id)).history).toHaveLength(6);expect((await pool.query("SELECT * FROM abuse_reports WHERE id=$1",[rid])).rows).toEqual(before);
 });
 it("case-scoped evidence cross-case link and item IDOR denials; allowlist/hash/audit without raw fields",async()=>{
  const id=await create(),other=await create(),d=await detail(other);await assign(id,support.id);
  expect((await command(id,change("capture_evidence",2,{linkId:d.links[0].id}),support)).statusCode).toBe(404);
  const eid=await capture(id,support),read=await get(`cases/${id}/evidence/${eid}`,support);expect(read.statusCode).toBe(200);const r=read.json();expect(Object.keys(r.payload).sort()).toEqual(["createdAt","id","reasonCode","state","targetKind","targetPublicPlayerId"].sort());
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(r.payload).sort(([a],[b])=>a.localeCompare(b))));expect(r.contentHash).toBe(createHash("sha256").update(canonical).digest("hex"));expect(JSON.stringify(r)).not.toMatch(/SECRET|RAW|person@|private-chat/);
  expect((await get(`cases/${other}/evidence/${eid}`)).statusCode).toBe(404);expect((await get(`cases/${id}/evidence/${eid}`,otherSupport)).statusCode).toBe(404);
  const metadata=await get(`cases/${id}/evidence`,support);expect(metadata.statusCode).toBe(200);expect(metadata.json().items[0].payload).toBeUndefined();expect(metadata.json().items[0].readable).toBe(true);
  for(const action of ["admin.evidence_capture","admin.evidence_read","admin.evidence_list"])expect((await pool.query("SELECT 1 FROM privileged_audit_events WHERE target_id=$1 AND action_key=$2",[id,action])).rowCount).toBeGreaterThan(0);
 });
 it("missing retention policy denies capture/read; expiry hides payload without purge and legalhold hook stays conservative",async()=>{
  const id=await create(),eid=await capture(id);const ttl=env.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS;env.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS=undefined;
  try{expect((await command(id,change("capture_evidence",2,{linkId:(await detail(id)).links[0].id}))).statusCode).toBe(422);expect((await get(`cases/${id}/evidence/${eid}`)).statusCode).toBe(404);}finally{env.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS=ttl;}
  const original=policy.capture.bind(policy);policy.capture=async(c,_id)=>({policyId:"internal_synthetic_v1",expiresAt:(await c.query("SELECT clock_timestamp()+interval '0.6 seconds' expires_at")).rows[0].expires_at,legalHold:true});
  let expired:string;try{expired=await capture(id);}finally{policy.capture=original;}
  await pool.query("SELECT pg_sleep(0.8)");expect((await get(`cases/${id}/evidence/${expired!}`)).statusCode).toBe(404);expect((await pool.query("SELECT legal_hold FROM case_evidence_items WHERE id=$1",[expired!])).rows[0].legal_hold).toBe(true);expect(policy.canPurge({legal_hold:true})).toBe(false);expect(policy.canPurge({legal_hold:false})).toBe(false);
 });
 it("audit failure rolls back case command/action/receipt and evidence; all histories immutable",async()=>{
  const id=await create(),d=await detail(id),key=randomUUID();await pool.query("CREATE FUNCTION a3_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='admin.case.capture_evidence' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$");await pool.query("CREATE TRIGGER a3_fail BEFORE INSERT ON privileged_audit_events FOR EACH ROW EXECUTE FUNCTION a3_reject_audit()");
  try{expect((await command(id,change("capture_evidence",1,{linkId:d.links[0].id}),moderator,key)).statusCode).toBe(500);}finally{await pool.query("DROP TRIGGER a3_fail ON privileged_audit_events; DROP FUNCTION a3_reject_audit()");}
  expect((await detail(id)).version).toBe(1);expect((await pool.query("SELECT 1 FROM case_evidence_items WHERE case_id=$1",[id])).rowCount).toBe(0);expect((await pool.query("SELECT 1 FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2",[moderator.id,hashSecret(pepper,key)])).rowCount).toBe(0);
  const eid=await capture(id);for(const [table,where] of [["support_case_actions","case_id"],["support_case_links","case_id"],["case_evidence_items","case_id"]])for(const op of ["DELETE FROM","UPDATE"])await expect(pool.query(op==="UPDATE"?`UPDATE ${table} SET case_id=case_id WHERE ${where}=$1`:`DELETE FROM ${table} WHERE ${where}=$1`,[id])).rejects.toMatchObject({code:"42501"});
  await expect(pool.query("TRUNCATE case_evidence_items CASCADE")).rejects.toMatchObject({code:"42501"});expect((await get(`cases/${id}/evidence/${eid}`)).statusCode).toBe(200);
 });
 it("revoked current role/credential denies reads and idempotent replay",async()=>{
  const a=await actor("moderator"),id=await create(),key=randomUUID(),body=change("note",1,{noteCode:"review_started"});expect((await command(id,body,a,key)).statusCode).toBe(200);
  await pool.query("UPDATE admin_role_grants SET active=false WHERE principal_id=$1",[a.id]);expect((await command(id,body,a,key)).statusCode).toBe(403);expect((await get("cases/"+id,a)).statusCode).toBe(403);
  await pool.query("UPDATE admin_role_grants SET active=true WHERE principal_id=$1",[a.id]);await pool.query("UPDATE admin_webauthn_credentials SET status='revoked' WHERE principal_id=$1",[a.id]);expect((await command(id,body,a,key)).statusCode).toBe(401);
 });
 it("safe assignment validation, no game/moderation privileges conferred by a link",async()=>{
  const id=await create();for(const principalId of [randomUUID(),content.id])expect((await command(id,change("assign",1,{principalId}))).statusCode).toBe(404);
  const u=await user(),v=(await pool.query("INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address) SELECT id,'A3 fixture','Synthetic','Europe/Moscow',ST_SetSRID(ST_MakePoint(37,55),4326)::geography,$1,'unverified','a3 fixture','a3 address' FROM cities LIMIT 1 RETURNING id",[u])).rows[0].id;
  const g=(await pool.query(`INSERT INTO games(venue_id,title,status,visibility,starts_at,ends_at,timezone,application_deadline_at,capacity,external_reserved_count,format_key,level_scale_id,level_scale_version,allowed_level_ids,settlement_mode,settlement_purpose,settlement_terms,created_by_user_id,host_display_name,host_public_contact,activity_kind) VALUES($1,'A3 SECRET contact','cancelled','public',now()+interval '2 days',now()+interval '3 days','Europe/Moscow',now()+interval '1 day',4,0,'doubles','test',1,'["test"]','external','no_trainer_fee','Synthetic',$2,'SECRET','SECRET','regular') RETURNING id`,[v,u])).rows[0].id;
  expect((await command(id,change("link_game",1,{gameId:g}))).statusCode).toBe(200);await assign(id,support.id);const d=await detail(id,support),eid=await capture(id,support,d.links.find((x:{sourceKind:string})=>x.sourceKind==="game").id),read=(await get(`cases/${id}/evidence/${eid}`,support)).json();expect(read.payload).toMatchObject({id:g,status:"cancelled",moderationState:"clear"});expect(JSON.stringify(read)).not.toMatch(/SECRET|title|contact|location/);expect((await pool.query("SELECT 1 FROM game_managers WHERE user_id=$1 AND game_id=$2",[support.userId,g])).rowCount).toBe(0);
 });
 it("history/report/case/evidence pagination stays bounded and non-overlapping",async()=>{
  const id=await create();for(let v=1;v<=102;v++){await pool.query("DELETE FROM admin_rate_windows");expect((await command(id,change("note",v,{noteCode:"review_started"}))).statusCode).toBe(200);}
  const d=await detail(id),older=(await get(`cases/${id}?beforeVersion=${d.nextHistoryBeforeVersion}`)).json();expect(d.history).toHaveLength(100);expect(older.history).toHaveLength(3);expect(new Set([...d.history,...older.history].map(x=>x.id)).size).toBe(103);
  const a=(await get("cases?limit=1")).json(),b=(await get("cases?limit=1&beforeId="+a.nextBeforeId)).json();expect(a.items[0].id).not.toBe(b.items[0].id);
  await capture(id);await capture(id);const e=(await get(`cases/${id}/evidence?limit=1`)).json(),e2=(await get(`cases/${id}/evidence?limit=1&beforeId=${e.nextBeforeId}`)).json();expect(e.items[0].id).not.toBe(e2.items[0].id);
 });
 it("default-disabled cases404 and no policy activation outside test/local",async()=>{
  env.CASES_INTERNAL_ENABLED=false;try{expect((await get("cases")).statusCode).toBe(404);expect((await post("cases",{})).statusCode).toBe(404);}finally{env.CASES_INTERNAL_ENABLED=true;}
  for(const extra of [{ADMIN_INTERNAL_ENABLED:"0"},{APP_ENV:"mvp"},{NODE_ENV:"production"}])expect(()=>loadEnv({...process.env,ADMIN_INTERNAL_ENABLED:"1",CASES_INTERNAL_ENABLED:"1",CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS:"3600",ADMIN_AUTH_PEPPER:pepper,ADMIN_ORIGIN:origin,...extra})).toThrow();
 });
});
