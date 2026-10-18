import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { readdir, readFile } from "node:fs/promises";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
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
   const id=(await db.query("INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id) VALUES($1,'Синтетический зал','Синтетический адрес','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$2) RETURNING id",[cityId,uid])).rows[0].id;
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
});
