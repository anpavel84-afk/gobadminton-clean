import { publicVenueContactsSchema, readPublicVenueContacts, safePublicPhone, safePublicUrl } from "../../src/venues/public-venue-contacts";
import { venueCommand, venueCreate } from "../../src/admin/venues.dto";
import { VenuesService } from "../../src/venues/venues.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { readdir, readFile } from "node:fs/promises";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool, Client, type PoolClient } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret,sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { AuthModule } from "../../src/auth/auth.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { GamesService } from "../../src/games/games.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
const origin="http://localhost:19440",pepper="p4-private-synthetic-admin-pepper-32chars";
type Actor={id:string;token:string;csrf:string};
run("T0a-1: контакты площадки и приватность",()=>{
 const databaseName="venue_contacts_"+randomUUID().replaceAll("-", "");
 let adminPool:Pool;
 let app:NestFastifyApplication,pool:Pool,content:Actor,games:GamesService,sessions:SessionService;
 const cityId="a0000000-0000-4000-8000-000000000001";
 beforeAll(async()=>{
  process.env.NODE_ENV="test";process.env.APP_ENV="local";process.env.PUBLIC_API_ORIGIN="http://127.0.0.1:19441";process.env.PUBLIC_WEB_ORIGIN="http://127.0.0.1:19442";process.env.ALLOWED_WEB_ORIGINS=process.env.PUBLIC_WEB_ORIGIN;
  const url=new URL(process.env.DATABASE_URL!);
  if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Нужен изолированный локальный PostGIS");
  adminPool=new Pool({connectionString:url.href});await adminPool.query(`CREATE DATABASE "${databaseName}"`);url.pathname="/"+databaseName;
  const env=loadEnv({...process.env,DATABASE_URL:url.href,ADMIN_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:origin,ADMIN_AUTH_PEPPER:pepper});pool=new Pool({connectionString:url.href,max:10});
  await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
  const dir=path.resolve(__dirname,"../../migrations");
  for(const file of (await readdir(dir)).filter(f=>f.endsWith(".sql")).sort())await pool.query(await readFile(path.join(dir,file),"utf8"));
  const mod=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AdminModule,GamesModule,VenuesModule,AuthModule]}).compile();
  app=mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
  content=await actor("content_manager");games=mod.get(GamesService);sessions=mod.get(SessionService);
 },120000);
 beforeEach(async()=>{await pool.query("DELETE FROM admin_rate_windows");});
 afterAll(async()=>{await app?.close();await pool?.end();if(adminPool){await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);await adminPool.end();}});
 async function user(){return (await pool.query<{id:string}>("INSERT INTO users(display_name) VALUES('P4 synthetic') RETURNING id")).rows[0]!.id;}
 async function actor(role:AdminRole):Promise<Actor>{const uid=await user(),id=(await pool.query<{id:string}>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[uid])).rows[0]!.id;await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",[id,role]);const credential=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID();await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[credential,id,Buffer.from('synthetic-command-fixture')]);await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",[id,credential,hashSecret(pepper,token),sealSecret(pepper,csrf)]);return {id,token,csrf};}
 function fields(extra:object={}){return {cityId,name:"Synthetic "+randomUUID(),address:"Synthetic address "+randomUUID(),timezone:"Europe/Moscow",latitude:55.75,longitude:37.62,...extra};}
 function post(url:string,payload:object,a=content,key=randomUUID()){return app.inject({method:"POST",url:"/v1/admin/venues"+url,headers:{origin,"x-csrf-token":a.csrf,"idempotency-key":key},cookies:{[ADMIN_COOKIE]:a.token},payload});}
 function command(id:string,action:string,extra:object={},a=content,key=randomUUID()){return post('/'+id+'/commands',{action,expectedVersion:1,reasonCode:'synthetic_review',...extra},a,key);}

 it("миграция: N-1, nullable, CHECK, повтор по ledger и безопасный rollback",async()=>{
  const migrationDatabase=databaseName+"_migration";
  await adminPool.query(`CREATE DATABASE "${migrationDatabase}"`);
  const url=new URL(process.env.DATABASE_URL!);url.pathname="/"+migrationDatabase;
  const db=new Pool({connectionString:url.href});
  try {
   const dir=path.resolve(__dirname,"../../migrations");
   await db.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
   const files=(await readdir(dir)).filter(f=>f.endsWith(".sql")).sort();
   for(const file of files.filter(f=>f!=="0036_venue_contacts.sql")) {
    await db.query(await readFile(path.join(dir,file),"utf8"));
    await db.query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]);
   }
   const uid=(await db.query("INSERT INTO users(display_name) VALUES('Синтетический пользователь') RETURNING id")).rows[0].id;
   const id=(await db.query("INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address) VALUES($1,'Синтетический зал','Синтетический адрес','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$2,'unverified',venue_normalize_v1('Синтетический зал'),venue_normalize_v1('Синтетический адрес')) RETURNING id",[cityId,uid])).rows[0].id;
   const sql=await readFile(path.join(dir,"0036_venue_contacts.sql"),"utf8");
   await db.query(sql);await db.query("INSERT INTO schema_migrations(id) VALUES('0036_venue_contacts')");
   // migrate.ts пропускает применённый файл по ledger; сырой ALTER повторно не исполняется.
   for(const file of files){const mid=file.replace(/\.sql$/,"");if(!(await db.query("SELECT 1 FROM schema_migrations WHERE id=$1",[mid])).rowCount)await db.query(await readFile(path.join(dir,file),"utf8"));}
   expect((await db.query("SELECT contact_phone,contact_website,booking_note,contact_updated_at FROM venues WHERE id=$1",[id])).rows[0]).toEqual({contact_phone:null,contact_website:null,booking_note:null,contact_updated_at:null});
   // Явная старая проекция и старый UPDATE не зависят от добавленных полей.
   await db.query("UPDATE venues SET name='Синтетический зал 2' WHERE id=$1",[id]);
   expect((await db.query("SELECT id,name,address,timezone FROM venues WHERE id=$1",[id])).rows[0].name).toBe("Синтетический зал 2");
   const rollback=await readFile(path.join(dir,"rollback/0036_venue_contacts.sql"),"utf8");
   await db.query("BEGIN");await db.query(rollback);await db.query("COMMIT");
   await db.query(sql);await db.query("INSERT INTO schema_migrations(id) VALUES('0036_venue_contacts')");
   await db.query("UPDATE venues SET contact_phone='Синтетический контакт' WHERE id=$1",[id]);
   const c=await db.connect();try{await c.query("BEGIN");await expect(c.query(rollback)).rejects.toMatchObject({code:"23514"});await c.query("ROLLBACK");}finally{c.release();}
   expect((await db.query("SELECT contact_phone FROM venues WHERE id=$1",[id])).rows[0].contact_phone).toBe("Синтетический контакт");
  } finally {await db.end();await adminPool.query(`DROP DATABASE IF EXISTS "${migrationDatabase}"`);}
 });
 const keys=["contactPhone","contactWebsite","bookingNote"];
 const contacts={contactPhone:"+0 000 000-00-00",contactWebsite:"https://venue.example.invalid",bookingNote:"Синтетическая инструкция"};
 function absent(value:unknown):void {
  if(!value || typeof value!=="object")return;
  for(const [key,child] of Object.entries(value)){expect(keys).not.toContain(key);absent(child);}
 }
 async function consumer(uid:string){const s=await sessions.createConsumerSession(uid);return {session:s.session.id,cookie:`${SESSION_COOKIE}=${s.sessionToken}`};}
 async function fixture(){
  const f=fields(),r=await post("",{...f,reasonCode:"synthetic_review"});expect(r.statusCode,r.body).toBe(201);
  const v=r.json() as {id:string;version:number},uid=await user(),s=await consumer(uid);
  const starts=new Date(Date.now()+2*86400000),ends=new Date(+starts+3600000);
  const created=await games.createDraft(uid,s.session,randomUUID(),{hostDisplayName:"Синтетический организатор",hostPublicContact:"Синтетический контакт",venueId:v.id,startsAt:starts.toISOString(),endsAt:ends.toISOString(),timezone:"Europe/Moscow",applicationDeadlineAt:starts.toISOString(),capacity:20,externalReservedCount:0,visibility:"public",formatKey:"doubles",activityKind:"regular",levelRule:{scaleId:"test",scaleVersion:1,allowedLevelIds:["test"]},settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,terms:"Синтетические условия"}});
  absent(created.body);
  const published=await games.publish(uid,s.session,created.body.id,randomUUID(),created.body.version);absent(published.body);
  const edit=await command(v.id,"edit",{fields:{...f,...contacts}});expect(edit.statusCode,edit.body).toBe(201);
  return {v,f,uid,s,gameId:created.body.id};
 }
 async function detail(gameId:string,cookie?:string){const r=await app.inject({method:"GET",url:"/v1/games/"+gameId,headers:cookie?{cookie}:{}});expect(r.statusCode,r.body).toBe(200);return r.json();}
 it("скрывает ключи от анонимного, неподтверждённых и посторонних; раскрывает владельцу, менеджеру и confirmed",async()=>{
  const x=await fixture(),baseline=(await detail(x.gameId)).venue;absent(baseline);
  expect(Object.keys(baseline).sort()).toEqual(["id","name","cityId","address","timezone","latitude","longitude","cover"].sort());
  expect((await detail(x.gameId,x.s.cookie)).venue).toMatchObject(contacts);
  const manager=await user(),ms=await consumer(manager);
  await pool.query("INSERT INTO game_managers(game_id,user_id,role) VALUES($1,$2,'manager')",[x.gameId,manager]);
  expect((await detail(x.gameId,ms.cookie)).venue).toMatchObject(contacts);
  for(const status of ["pending","confirmed","rejected","withdrawn","cancelled_by_game","removed","expired",null]){
   const uid=await user(),s=await consumer(uid);
   if(status)await pool.query("INSERT INTO participations(game_id,user_id,status) VALUES($1,$2,$3)",[x.gameId,uid,status]);
   const venue=(await detail(x.gameId,s.cookie)).venue;
   if(status==="confirmed")expect(venue).toMatchObject(contacts);else expect(venue).toEqual(baseline);
  }
  await pool.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2",[x.gameId,manager]);
  expect((await detail(x.gameId,ms.cookie)).venue).toEqual(baseline);
  // Блокировка сама по себе не предоставляет доступа к контактам.
  const blocked=await user(),bs=await consumer(blocked);
  const pair=(await pool.query("INSERT INTO social_pairs(user_low,user_high) VALUES(LEAST($1::uuid,$2::uuid),GREATEST($1::uuid,$2::uuid)) RETURNING id",[x.uid,blocked])).rows[0].id;
  await pool.query("INSERT INTO user_blocks(blocker_user_id,blocked_user_id,pair_id) VALUES($1,$2,$3)",[x.uid,blocked,pair]);
  expect((await detail(x.gameId,bs.cookie)).venue).toEqual(baseline);
  for(const url of [`/v1/games?venueId=${x.v.id}`,`/v1/games?cityId=${cityId}&temporalScope=upcoming`,`/v1/games/map?cityId=${cityId}&temporalScope=upcoming`,`/v1/venues?cityId=${cityId}`,`/v1/venues/${x.v.id}`,"/v1/me/games"]){
   const r=await app.inject({method:"GET",url,headers:{cookie:x.s.cookie}});expect(r.statusCode,r.body).toBe(200);absent(r.json());
  }
 });
 it("редактирует и очищает поля с audit, conflict и replay; пропуск сохраняет контакты",async()=>{
  const x=await fixture();
  const before=(await pool.query("SELECT contact_updated_at FROM venues WHERE id=$1",[x.v.id])).rows[0].contact_updated_at;
  const preserved=await command(x.v.id,"edit",{expectedVersion:2,fields:x.f});expect(preserved.statusCode,preserved.body).toBe(201);
  expect((await pool.query("SELECT contact_updated_at FROM venues WHERE id=$1",[x.v.id])).rows[0].contact_updated_at).toEqual(before);
  const key=randomUUID(),payload={expectedVersion:3,fields:{...x.f,contactPhone:"  ",contactWebsite:"",bookingNote:" "}};
  const cleared=await command(x.v.id,"edit",payload,content,key);expect(cleared.statusCode,cleared.body).toBe(201);
  expect((await command(x.v.id,"edit",payload,content,key)).body).toBe(cleared.body);
  expect((await command(x.v.id,"edit",payload)).statusCode).toBe(409);
  await pool.query("UPDATE admin_sessions SET revoked_at=now() WHERE principal_id=$1",[content.id]);
  try{expect((await command(x.v.id,"edit",payload,content,key)).statusCode).toBe(401);}finally{await pool.query("UPDATE admin_sessions SET revoked_at=NULL WHERE principal_id=$1",[content.id]);}

  const row=(await pool.query("SELECT contact_phone,contact_website,booking_note,contact_updated_at FROM venues WHERE id=$1",[x.v.id])).rows[0];
  expect(row).toMatchObject({contact_phone:null,contact_website:null,booking_note:null});expect(+row.contact_updated_at).toBeGreaterThan(+before);
  expect((await detail(x.gameId,x.s.cookie)).venue).toMatchObject({contactPhone:null,contactWebsite:null,bookingNote:null});absent(await detail(x.gameId));
  for(const role of ["manager","confirmed"]){
   const uid=await user(),session=await consumer(uid);
   if(role==="manager")await pool.query("INSERT INTO game_managers(game_id,user_id,role) VALUES($1,$2,'manager')",[x.gameId,uid]);
   else await pool.query("INSERT INTO participations(game_id,user_id,status) VALUES($1,$2,'confirmed')",[x.gameId,uid]);
   expect((await detail(x.gameId,session.cookie)).venue).toMatchObject({contactPhone:null,contactWebsite:null,bookingNote:null});
  }

  const history=await pool.query("SELECT a.action FROM venue_admin_actions a JOIN privileged_audit_events e ON e.id=a.audit_id WHERE a.venue_id=$1 AND a.action='edit'",[x.v.id]);expect(history.rowCount).toBe(3);
 });
 it("отклоняет схемы и превышения длины в API и CHECK; create не принимает контакты",async()=>{
  const x=await fixture();
  expect((await post("",{...fields(),...contacts,reasonCode:"synthetic_review"})).statusCode).toBe(400);
  for(const bad of [{contactWebsite:"ftp://venue.example.invalid"},{contactWebsite:"javascript:alert(1)"},{contactPhone:"x".repeat(41)},{contactWebsite:"https://"+"x".repeat(293)},{bookingNote:"x".repeat(501)}]){
   const r=await command(x.v.id,"edit",{expectedVersion:2,fields:{...x.f,...bad}});expect(r.statusCode,r.body).toBe(400);expect(r.headers["content-type"]).toContain("application/problem+json");
  }
  for(const [column,value] of [["contact_phone","x".repeat(41)],["contact_website","ftp://venue.example.invalid"],["contact_website","https://"+"x".repeat(293)],["booking_note","x".repeat(501)]]){
   await expect(pool.query(`UPDATE venues SET ${column}=$2 WHERE id=$1`,[x.v.id,value])).rejects.toMatchObject({code:"23514"});
  }
  const r=await command(x.v.id,"edit",{expectedVersion:2,fields:{...x.f,contactPhone:"  "+contacts.contactPhone+" ",contactWebsite:" http://venue.example.invalid ",bookingNote:"  Инструкция  "}});expect(r.statusCode,r.body).toBe(201);
  expect((await detail(x.gameId,x.s.cookie)).venue).toMatchObject({contactPhone:contacts.contactPhone,contactWebsite:"http://venue.example.invalid",bookingNote:"Инструкция"});
 });
 it("public edit: guest projection, replacement/null/omission, private preservation, audit and replay", async()=>{
  const x=await fixture();
  const publicContacts={phone:"+7 (999) 123-45-67",website:"https://public.example.invalid",messengers:[{kind:"telegram",url:"https://t.me/synthetic_venue"}]};
  const privateBefore=(await pool.query("SELECT contact_phone,contact_website,booking_note,contact_updated_at FROM venues WHERE id=$1",[x.v.id])).rows[0];
  const key=randomUUID(), payload={expectedVersion:2,fields:{...x.f,publicContacts}};
  const edited=await command(x.v.id,"edit",payload,content,key);expect(edited.statusCode,edited.body).toBe(201);
  expect(edited.json()).toMatchObject({publicContacts,version:3});
  expect((await command(x.v.id,"edit",payload,content,key)).body).toBe(edited.body);
  expect((await command(x.v.id,"edit",payload)).statusCode).toBe(409);
  await pool.query("UPDATE admin_sessions SET revoked_at=now() WHERE principal_id=$1",[content.id]);
  try{expect((await command(x.v.id,"edit",payload,content,key)).statusCode).toBe(401);}finally{await pool.query("UPDATE admin_sessions SET revoked_at=NULL WHERE principal_id=$1",[content.id]);}

  const catalog=await app.inject({method:"GET",url:`/v1/venues?cityId=${cityId}`});
  expect(catalog.statusCode).toBe(200);expect(catalog.json().items).toContainEqual(expect.objectContaining({id:x.v.id,publicContacts}));absent(catalog.json());
  const detail=await app.inject({method:"GET",url:`/v1/venues/${x.v.id}`});expect(detail.json()).toMatchObject({publicContacts});absent(detail.json());
  const adminDetail=await app.inject({method:"GET",url:`/v1/admin/venues/${x.v.id}`,headers:{origin},cookies:{[ADMIN_COOKIE]:content.token}});
  expect(adminDetail.statusCode,adminDetail.body).toBe(200);expect(adminDetail.json()).toMatchObject({publicContacts});
  expect((await command(x.v.id,"edit",{expectedVersion:3,fields:x.f})).json()).toMatchObject({publicContacts,version:4});
  const replacement={phone:null,website:null,messengers:[]};
  expect((await command(x.v.id,"edit",{expectedVersion:4,fields:{...x.f,publicContacts:replacement}})).json()).toMatchObject({publicContacts:replacement,version:5});
  expect((await command(x.v.id,"edit",{expectedVersion:5,fields:{...x.f,publicContacts:null}})).json()).toMatchObject({publicContacts:null,version:6});
  expect((await pool.query("SELECT contact_phone,contact_website,booking_note,contact_updated_at FROM venues WHERE id=$1",[x.v.id])).rows[0]).toEqual(privateBefore);
  const audits=await pool.query("SELECT e.before_diff,e.after_diff FROM privileged_audit_events e JOIN venue_admin_actions a ON a.audit_id=e.id WHERE a.venue_id=$1",[x.v.id]);
  expect(JSON.stringify(audits.rows)).not.toContain(publicContacts.phone);expect(JSON.stringify(audits.rows)).not.toContain(publicContacts.website);
  const events=await pool.query("SELECT payload FROM outbox_events WHERE aggregate_type='venue' AND aggregate_id=$1",[x.v.id]);
  expect(JSON.stringify(events.rows)).not.toContain(publicContacts.phone);expect(JSON.stringify(events.rows)).not.toContain(publicContacts.website);
 });
 it("fresh 0038 schema, CHECK and create/propose do not publish private inputs",async()=>{
  const x=await fixture();
  expect((await pool.query("SELECT public_contacts FROM venues WHERE id=$1",[x.v.id])).rows[0]).toEqual({public_contacts:null});
  for(const value of invalidPublicContacts)await expect(pool.query("UPDATE venues SET public_contacts=$2::jsonb WHERE id=$1",[x.v.id,JSON.stringify(value)])).rejects.toMatchObject({code:"23514"});
  expect((await post("",{...fields(),publicContacts:validPublicContacts,reasonCode:"synthetic_review"})).statusCode).toBe(400);
  const input={...fields(),publicContacts:validPublicContacts,contactPhone:"synthetic private"};
  const proposed=await app.get(VenuesService).propose(x.uid,x.s.session,randomUUID(),input);
  expect(proposed.statusCode).toBe(201);
  expect(proposed.body).toMatchObject({publicContacts:null});absent(proposed.body);
  if(!("id" in proposed.body))throw new Error("Expected proposed venue");
  expect((await pool.query("SELECT public_contacts,contact_phone FROM venues WHERE id=$1",[proposed.body.id])).rows[0]).toEqual({public_contacts:null,contact_phone:null});
 });
 it("public edit preserves auth, step-up, CSRF/Origin fences and collision nonpublication", async()=>{
  const x=await fixture(), publicContacts={phone:null,website:"https://public.example.invalid",messengers:[]};
  const payload={action:"edit",expectedVersion:2,reasonCode:"synthetic_review",fields:{...x.f,publicContacts}};
  const url=`/v1/admin/venues/${x.v.id}/commands`;
  expect((await app.inject({method:"POST",url,payload,headers:{origin,"idempotency-key":randomUUID()}})).statusCode).toBe(401);
  for(const headers of [{origin},{origin,"x-csrf-token":"wrong"},{origin:"https://foreign.invalid","x-csrf-token":content.csrf}]){
   expect((await app.inject({method:"POST",url,payload,headers:{...headers,"idempotency-key":randomUUID()},cookies:{[ADMIN_COOKIE]:content.token}})).statusCode).toBe(403);
  }
  const readonly=await actor("support");
  expect((await command(x.v.id,"edit",{expectedVersion:2,fields:payload.fields},readonly)).statusCode).toBe(403);
  const otherFields=fields(),other=await post("",{...otherFields,reasonCode:"synthetic_review"});expect(other.statusCode).toBe(201);
  const collision=await command(x.v.id,"edit",{expectedVersion:2,fields:{...otherFields,publicContacts}});
  expect(collision.statusCode,collision.body).toBe(201);expect(collision.json()).toMatchObject({reviewRequired:true,publicContacts:null,version:2});
  expect((await pool.query("SELECT public_contacts FROM venues WHERE id=$1",[x.v.id])).rows[0]).toEqual({public_contacts:null});
  await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '1 hour' WHERE principal_id=$1",[content.id]);
  expect((await command(x.v.id,"edit",{expectedVersion:2,fields:payload.fields})).statusCode).toBe(403);
  await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE principal_id=$1",[content.id]);
 });
 it("0037 -> 0038 preserves synthetic private values, NULL default, CHECK and ledger rerun",async()=>{
  const name=databaseName+"_public_upgrade";await adminPool.query(`CREATE DATABASE "${name}"`);
  const url=new URL(process.env.DATABASE_URL!);url.pathname="/"+name;const db=new Pool({connectionString:url.href});
  try {
   const dir=path.resolve(__dirname,"../../migrations");
   await db.query("CREATE TABLE schema_migrations(id text PRIMARY KEY)");
   const files=(await readdir(dir)).filter(f=>f.endsWith(".sql")).sort();
   for(const f of files.filter(f=>f<"0038")){await db.query(await readFile(path.join(dir,f),"utf8"));await db.query("INSERT INTO schema_migrations VALUES($1)",[f.replace(/\.sql$/ ,"")]);}
   const uid=(await db.query("INSERT INTO users(display_name) VALUES('Synthetic upgrade') RETURNING id")).rows[0].id;
   const id=(await db.query("INSERT INTO venues(city_id,name,address,timezone,location,contact_phone,contact_website,booking_note,contact_updated_at,created_by_user_id) VALUES($1,'Synthetic public upgrade','Synthetic','Europe/Moscow',ST_SetSRID(ST_MakePoint(37,55),4326)::geography,'synthetic private','https://private.example.invalid','synthetic booking','2026-01-01T00:00:00Z',$2) RETURNING id",[cityId,uid])).rows[0].id;
   let alters=0;
   for(let pass=0;pass<2;pass++)for(const f of files){const mid=f.replace(/\.sql$/ ,"");if(!(await db.query("SELECT 1 FROM schema_migrations WHERE id=$1",[mid])).rowCount){await db.query(await readFile(path.join(dir,f),"utf8"));await db.query("INSERT INTO schema_migrations VALUES($1)",[mid]);alters++;}}
   expect(alters).toBe(1);
   expect((await db.query("SELECT public_contacts,contact_phone,contact_website,booking_note,contact_updated_at FROM venues WHERE id=$1",[id])).rows[0]).toEqual({public_contacts:null,contact_phone:"synthetic private",contact_website:"https://private.example.invalid",booking_note:"synthetic booking",contact_updated_at:new Date("2026-01-01T00:00:00Z")});
   expect((await db.query("SELECT column_default,is_nullable,data_type FROM information_schema.columns WHERE table_name='venues' AND column_name='public_contacts'")).rows).toEqual([{column_default:null,is_nullable:"YES",data_type:"jsonb"}]);
   for(const value of invalidPublicContacts){await expect(db.query("UPDATE venues SET public_contacts=$2::jsonb WHERE id=$1",[id,JSON.stringify(value)])).rejects.toMatchObject({code:"23514"});}
   await db.query("UPDATE venues SET public_contacts=$2::jsonb WHERE id=$1",[id,JSON.stringify(validPublicContacts)]);
   // Application rollback: old-column projection/update leaves the new data intact.
   await db.query("UPDATE venues SET name='Synthetic old application' WHERE id=$1",[id]);
   expect((await db.query("SELECT public_contacts FROM venues WHERE id=$1",[id])).rows[0].public_contacts).toEqual(validPublicContacts);
  }finally{await db.end();await adminPool.query(`DROP DATABASE "${name}"`);}
 });

});

const validPublicContacts = {phone:"+7 (999) 123-45-67",website:"http://venue.example.invalid",messengers:[{kind:"telegram",url:"https://t.me/synthetic"},{kind:"whatsapp",url:"https://wa.me/79991234567"},{kind:"vk",url:"https://vk.com/synthetic"}]};
const emptyPublicContacts = {phone:null,website:null,messengers:[]};
const invalidPublicContacts: unknown[] = [
 null, [], "private", {}, {...emptyPublicContacts,private:"secret"}, {...emptyPublicContacts,contactPhone:"secret"},
 {website:null,messengers:[]}, {...emptyPublicContacts,phone:1}, {...emptyPublicContacts,phone:"123456"},
 {...emptyPublicContacts,phone:"1234567890123456"}, {...emptyPublicContacts,phone:"１２３４５６７"},
 {...emptyPublicContacts,phone:"1234567x"}, {...emptyPublicContacts,phone:"12+34567"},
 {...emptyPublicContacts,phone:"1234567"+"-".repeat(34)},
 ...["\n1234567", "1234567\t", "1234567\u007f", "1234567\u0085"].map(phone=>({...emptyPublicContacts,phone})),
 ...["ftp://venue.invalid","https://user:pass@venue.invalid","https://@venue.invalid","https://venue.invalid:444/path","https://venue.invalid/\\evil","\nhttps://venue.invalid","https://venue.invalid/\tpath","https://","https://venue.invalid/"+"x".repeat(300)].map(website=>({...emptyPublicContacts,website})),
 {...emptyPublicContacts,messengers:{}}, {...emptyPublicContacts,messengers:[null]},
 ...["http://t.me/name","https://t.me/","https://t.me","https://t.me.evil.invalid/name","https://user@t.me/name","https://t.me:444/name","https://t.me/a/..","https://t.me/\nname","https://t.me/"+"x".repeat(300),"https://t.me/\\name","https://t.me/name\u007f"].map(url=>({...emptyPublicContacts,messengers:[{kind:"telegram",url}]})),
 {...emptyPublicContacts,messengers:[{kind:"private",url:"https://t.me/name"}]},
 {...emptyPublicContacts,messengers:[{kind:"telegram",url:"https://t.me/name",contactPhone:"secret"}]},
 {...emptyPublicContacts,messengers:Array.from({length:4},()=>({kind:"telegram",url:"https://t.me/name"}))},
 {...emptyPublicContacts,messengers:[{kind:"vk",url:"https://vk.com/a"},{kind:"vk",url:"https://vk.com/b"}]},
];
describe("public organization contacts: no DB",()=>{
 const fields={cityId:"a0000000-0000-4000-8000-000000000001",name:"Synthetic",address:"Synthetic address",timezone:"Europe/Moscow",latitude:55,longitude:37};
 it("strict writes reject unsafe/unknown/private keys and enforce every required field",()=>{
  expect(publicVenueContactsSchema.parse(validPublicContacts)).toEqual(validPublicContacts);
  expect(publicVenueContactsSchema.parse(emptyPublicContacts)).toEqual(emptyPublicContacts);
  for(const value of invalidPublicContacts)expect(publicVenueContactsSchema.safeParse(value).success,JSON.stringify(value)).toBe(false);
  for(const key of ["phone","website","messengers"]){const value:Record<string,unknown>={...emptyPublicContacts};delete value[key];expect(publicVenueContactsSchema.safeParse(value).success).toBe(false);}
  for(const publicContacts of [undefined,null,validPublicContacts])expect(venueCommand.safeParse({action:"edit",expectedVersion:1,reasonCode:"synthetic_review",fields:{...fields,publicContacts}}).success).toBe(true);
  expect(venueCreate.safeParse({...fields,reasonCode:"synthetic_review",publicContacts:validPublicContacts}).success).toBe(false);
 });
 it("phone/URL boundaries and trimming precede safe projection",()=>{
  expect(safePublicPhone("  +1 (234) 567-8901  ")).toBe("+1 (234) 567-8901");
  expect(safePublicPhone("1234567"+"-".repeat(33))).toHaveLength(40);
  expect(safePublicPhone("1234567"+"-".repeat(34))).toBeNull();
  expect(safePublicPhone("123456789012345")).not.toBeNull();
  const maxUrl="https://venue.invalid/"+"x".repeat(278);
  expect(maxUrl).toHaveLength(300);expect(safePublicUrl(maxUrl)).toBe(maxUrl);expect(safePublicUrl(maxUrl+"x")).toBeNull();
  expect(safePublicUrl("  https://venue.invalid:443/a  ")).toBe("https://venue.invalid:443/a");
  expect(safePublicUrl("https://T.ME/name","telegram")).not.toBeNull();
  expect(safePublicUrl("https://wa.me/name","telegram")).toBeNull();
  expect(safePublicUrl("https://vk.com/name","whatsapp")).toBeNull();
 });
 it("unknown reads retain safe neighbors, strip private keys, deduplicate and bound",()=>{
  for(const value of [undefined,null,[],true,1,"contacts"])expect(readPublicVenueContacts(value)).toBeNull();
  expect(readPublicVenueContacts({})).toEqual(emptyPublicContacts);
  expect(readPublicVenueContacts({...validPublicContacts,contactPhone:"private",bookingNote:"private",messengers:[null,{kind:"telegram",url:"javascript:bad"},...validPublicContacts.messengers,...validPublicContacts.messengers,{kind:"private",url:"https://private.invalid"}]})).toEqual(validPublicContacts);
  expect(readPublicVenueContacts({...validPublicContacts,phone:"private",website:"javascript:bad"})).toEqual({...validPublicContacts,phone:null,website:null});
  expect(readPublicVenueContacts({...emptyPublicContacts,messengers:[{kind:"vk",url:"https://vk.com/safe",private:"secret"}]})).toEqual({...emptyPublicContacts,messengers:[{kind:"vk",url:"https://vk.com/safe"}]});
 });
 function result(rows: Record<string,unknown>[]){return {rows,rowCount:rows.length,command:"SELECT",oid:0,fields:[]};}
 function row(public_contacts:unknown){return {id:"a0000000-0000-4000-8000-000000000010",city_id:fields.cityId,name:fields.name,address:fields.address,timezone:fields.timezone,latitude:55,longitude:37,data_status:"verified",provenance:"admin_corrected",lifecycle_state:"verified",identity_discriminator:"",canonical_venue_id:null,normalized_name:"synthetic",normalized_address:"synthetic address",cover_credit_kind:null,cover_credit_text:null,cover_credit_url:null,public_contacts,contact_phone:"private",contact_website:"https://private.invalid",booking_note:"private"};}
 function setup(){
  const pool=new Pool();
  const client:PoolClient=Object.assign(new Client(),{release:()=>{}});
  const env=loadEnv({NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:"postgres://localhost/synthetic_unused",PUBLIC_API_ORIGIN:"http://localhost:19441"});
  const idem=new IdempotencyService(pool,env);
  class SourceMutationRunner extends MutationRunner {
   override async runIdempotent<T>(input:{execute:(c:PoolClient)=>Promise<{statusCode:number;body:T}>}){return input.execute(client);}
  }
  const mutations=new SourceMutationRunner(pool,idem,new ActorFenceService(env),env);
  return {pool,client,service:new VenuesService(pool,idem,mutations)};
 }
 it("catalog/detail projections select public JSON only and safely handle old/partly unsafe rows",async()=>{
  const {pool,service}=setup(), query=vi.spyOn(pool,"query");
  for(const value of [validPublicContacts,null,undefined,{...validPublicContacts,website:"javascript:bad"}]){
   query.mockResolvedValueOnce(result([row(value)]));
   const page=await service.searchCatalog({cityId:fields.cityId});expect(page.items[0]?.publicContacts).toEqual(readPublicVenueContacts(value));
   query.mockResolvedValueOnce(result([row(value)]));expect((await service.getById(row(validPublicContacts).id)).publicContacts).toEqual(readPublicVenueContacts(value));
   expect(JSON.stringify(page)).not.toContain('"contactPhone"');expect(JSON.stringify(page)).not.toContain("private.invalid");
  }
  for(const [sql] of query.mock.calls){expect(String(sql)).toContain("public_contacts");expect(String(sql)).not.toMatch(/contact_phone|contact_website|booking_note/);}
 });
 it("merged alias uses final target contacts",async()=>{
  const {pool,service}=setup(), target="a0000000-0000-4000-8000-000000000011";
  vi.spyOn(pool,"query").mockResolvedValueOnce(result([{...row(validPublicContacts),lifecycle_state:"merged",canonical_venue_id:target}])).mockResolvedValueOnce(result([{...row(null),id:target}]));
  expect(await service.getById(row(validPublicContacts).id)).toMatchObject({id:target,resolvedFromVenueId:row(validPublicContacts).id,publicContacts:null});
 });
 it("propose RETURNING carries safe projection but INSERT never writes contacts",async()=>{
  const {client,service}=setup(),query=vi.spyOn(client,"query");
  for(const rows of [[],[{id:fields.cityId}],[],[],[],[row(null)],[{venue_id:row(validPublicContacts).id}]])query.mockResolvedValueOnce(result(rows));
  const response=await service.propose("actor","session","synthetic-key-1234",fields);
  expect(response).toMatchObject({statusCode:201,body:{publicContacts:null}});
  const insert=query.mock.calls.map(([sql])=>String(sql)).find(sql=>sql.includes("INSERT INTO venues ("));
  expect(insert).toBeDefined();expect(insert?.split("RETURNING")[0]).not.toContain("public_contacts");expect(insert?.split("RETURNING")[1]).toContain("public_contacts");
 });
 it("fuzzy candidates carry safe public contacts without private JSON",async()=>{
  const {client,service}=setup(),query=vi.spyOn(client,"query");
  for(const rows of [[],[{id:fields.cityId}],[],[],[{...row(validPublicContacts),distance_m:1}],[]])query.mockResolvedValueOnce(result(rows));
  const response=await service.propose("actor","session","synthetic-key-1234",fields);
  expect(response).toMatchObject({statusCode:409,body:{candidates:[expect.objectContaining({publicContacts:validPublicContacts})]}});
  const fuzzy=query.mock.calls.map(([sql])=>String(sql)).find(sql=>sql.includes("LIMIT 80"));expect(fuzzy).toContain("public_contacts");
  expect(JSON.stringify(response)).not.toContain("private.invalid");expect(JSON.stringify(response)).not.toContain('"contactPhone"');
 });
});
