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
 it("0037→0038 upgrade, SQL storage boundaries and ledger rerun",async()=>{
  const name=databaseName+"_public_upgrade";await adminPool.query(`CREATE DATABASE "${name}"`);
  const url=new URL(process.env.DATABASE_URL!);url.pathname="/"+name;const db=new Pool({connectionString:url.href});
  try {
   const dir=path.resolve(__dirname,"../../migrations"),files=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
   await db.query("CREATE TABLE schema_migrations(id text PRIMARY KEY)");
   for(const file of files.filter(f=>f<'0038')){await db.query(await readFile(path.join(dir,file),'utf8'));await db.query("INSERT INTO schema_migrations VALUES($1)",[file.replace(/\.sql$/,'')]);}
   const uid=(await db.query<{id:string}>("INSERT INTO users(display_name) VALUES('public synthetic') RETURNING id")).rows[0]!.id;
   const id=(await db.query<{id:string}>("INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,contact_phone,contact_website,booking_note) VALUES($1,'Public synthetic','Address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37,55),4326)::geography,$2,'unverified','private','https://private.invalid','private note') RETURNING id",[cityId,uid])).rows[0]!.id;
   let alters=0;
   for(let pass=0;pass<2;pass++)for(const file of files){const mid=file.replace(/\.sql$/,'');if(!(await db.query('SELECT 1 FROM schema_migrations WHERE id=$1',[mid])).rowCount){await db.query(await readFile(path.join(dir,file),'utf8'));await db.query('INSERT INTO schema_migrations VALUES($1)',[mid]);if(mid==='0038_public_venue_contacts')alters++;}}
   expect(alters).toBe(1);
   expect((await db.query('SELECT public_contacts,contact_phone,contact_website,booking_note FROM venues WHERE id=$1',[id])).rows[0]).toEqual({public_contacts:null,contact_phone:'private',contact_website:'https://private.invalid',booking_note:'private note'});
   const canonical=publicVenueContactsSchema.parse({phone:'+1234567',website:'https://пример.рф/contact',messengers:[{kind:'telegram',url:'https://t.me/club'}]});
   await db.query('UPDATE venues SET public_contacts=$2::jsonb WHERE id=$1',[id,JSON.stringify(canonical)]);
   for(const bad of [null,{},[],{...canonical,phone:1},{...canonical,private:'secret'},{...canonical,phone:'123456'},{...canonical,website:'https://пример.рф/contact'},{...canonical,website:'https://foo／bar.example/path'},{...canonical,website:'https://a@b/'},{...canonical,website:'https://example.com:443/'},{...canonical,website:'https://example.com/a/../b'},{...canonical,messengers:[{kind:'telegram',url:'https://t.me/'}]},{...canonical,messengers:Array(4).fill({kind:'vk',url:'https://vk.com/club'})}])await expect(db.query('UPDATE venues SET public_contacts=$2::jsonb WHERE id=$1',[id,JSON.stringify(bad)])).rejects.toMatchObject({code:'23514'});
   await db.query('UPDATE venues SET public_contacts=$2 WHERE id=$1',[id,null]);expect((await db.query('SELECT public_contacts IS NULL AS cleared FROM venues WHERE id=$1',[id])).rows[0]?.cleared).toBe(true);
  }finally{await db.end();await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);}
 });
 it("public IDN edit, omission, replacement and SQL NULL leave private timestamp and audit safe",async()=>{
  const x=await fixture();
  const before=(await pool.query('SELECT contact_phone,contact_website,booking_note,contact_updated_at FROM venues WHERE id=$1',[x.v.id])).rows[0];
  const publicContacts={phone:'+1234567',website:'https://пример.рф/contact',messengers:[{kind:'vk',url:'https://vk.com/club'}]};
  const normalized=publicVenueContactsSchema.parse(publicContacts);
  const key=randomUUID(),payload={expectedVersion:2,fields:{...x.f,publicContacts}};
  const edited=await command(x.v.id,'edit',payload,content,key);expect(edited.statusCode,edited.body).toBe(201);expect(edited.json()).toHaveProperty('publicContacts',normalized);
  expect((await command(x.v.id,'edit',payload,content,key)).body).toBe(edited.body);
  expect((await command(x.v.id,'edit',payload)).statusCode).toBe(409);
  for(const url of ['/v1/venues/'+x.v.id,'/v1/venues?cityId='+cityId,'/v1/admin/venues/'+x.v.id]){
   const r=await app.inject({method:'GET',url,headers:url.includes('/admin/')?{origin,cookie:`${ADMIN_COOKIE}=${content.token}`}:{}});expect(r.statusCode,r.body).toBe(200);const body=r.json();expect(url.includes('?')?body.items.find((v:{id:string})=>v.id===x.v.id):body).toHaveProperty('publicContacts',normalized);
  }
  expect((await command(x.v.id,'edit',{expectedVersion:3,fields:x.f})).statusCode).toBe(201);
  expect((await pool.query('SELECT public_contacts FROM venues WHERE id=$1',[x.v.id])).rows[0]?.public_contacts).toEqual(normalized);
  const replacement={phone:null,website:'http://example.com/',messengers:[]};
  expect((await command(x.v.id,'edit',{expectedVersion:4,fields:{...x.f,publicContacts:replacement}})).statusCode).toBe(201);
  expect((await pool.query('SELECT public_contacts FROM venues WHERE id=$1',[x.v.id])).rows[0]?.public_contacts).toEqual(replacement);
  expect((await command(x.v.id,'edit',{expectedVersion:5,fields:{...x.f,publicContacts:null}})).statusCode).toBe(201);
  expect((await pool.query('SELECT public_contacts IS NULL AS cleared FROM venues WHERE id=$1',[x.v.id])).rows[0]?.cleared).toBe(true);
  expect((await pool.query('SELECT contact_phone,contact_website,booking_note,contact_updated_at FROM venues WHERE id=$1',[x.v.id])).rows[0]).toEqual(before);
  const audit=await pool.query("SELECT before_diff,after_diff FROM privileged_audit_events WHERE target_id=$1",[x.v.id]);expect(JSON.stringify(audit.rows)).not.toMatch(/1234567|xn--|publicContacts/);
  expect((await post('',{...fields(),publicContacts,reasonCode:'synthetic_review'})).statusCode).toBe(400);
  const csrf=await app.inject({method:'POST',url:'/v1/admin/venues/'+x.v.id+'/commands',headers:{origin,'idempotency-key':randomUUID()},cookies:{[ADMIN_COOKIE]:content.token},payload:{action:'edit',expectedVersion:6,reasonCode:'synthetic_review',fields:{...x.f,publicContacts}}});expect(csrf.statusCode).toBeGreaterThanOrEqual(400);
 });

 it("public contact edits retain auth/Origin/step-up fences and collision does not publish",async()=>{
  const x=await fixture(),publicContacts={phone:'+1234567',website:null,messengers:[]};
  const payload={action:'edit',expectedVersion:2,reasonCode:'synthetic_review',fields:{...x.f,publicContacts}};
  const endpoint='/v1/admin/venues/'+x.v.id+'/commands';
  const guest=await app.inject({method:'POST',url:endpoint,headers:{origin,'idempotency-key':randomUUID(),'x-csrf-token':content.csrf},payload});expect(guest.statusCode).toBeGreaterThanOrEqual(400);
  const wrongOrigin=await app.inject({method:'POST',url:endpoint,headers:{origin:'https://untrusted.invalid','idempotency-key':randomUUID(),'x-csrf-token':content.csrf},cookies:{[ADMIN_COOKIE]:content.token},payload});expect(wrongOrigin.statusCode).toBeGreaterThanOrEqual(400);
  await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '1 day' WHERE principal_id=$1",[content.id]);
  try {expect((await command(x.v.id,'edit',{expectedVersion:2,fields:{...x.f,publicContacts}})).statusCode).toBeGreaterThanOrEqual(400);}
  finally {await pool.query('UPDATE admin_sessions SET step_up_at=now() WHERE principal_id=$1',[content.id]);}
  const f=fields(),created=await post('',{...f,reasonCode:'synthetic_review'});expect(created.statusCode,created.body).toBe(201);
  const second=created.json() as {id:string};
  const collision=await command(second.id,'edit',{fields:{...x.f,publicContacts}});expect(collision.statusCode,collision.body).toBe(201);expect(collision.json()).toHaveProperty('reviewRequired',true);
  expect((await pool.query('SELECT public_contacts FROM venues WHERE id=$1',[second.id])).rows[0]?.public_contacts).toBeNull();
  const input={...fields(),publicContacts};
  const proposed=await app.get(VenuesService).propose(x.uid,x.s.session,randomUUID(),input);
  if('id' in proposed.body){expect((await pool.query('SELECT public_contacts FROM venues WHERE id=$1',[proposed.body.id])).rows[0]?.public_contacts).toBeNull();}
  else {expect(proposed.statusCode).toBe(409);expect(proposed.body.candidates.length).toBeGreaterThan(0);}
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

// Pure source-author checks run even when PostGIS integration is disabled.
import { publicContactUrl, publicContactPhone, publicVenueContactsSchema, readPublicVenueContacts } from "../../src/venues/public-venue-contacts";
import { venueCommand, venueCreate } from "../../src/admin/venues.dto";
describe("public venue contacts: offline policy",()=>{
 const valid={phone:"+7 (999) 123-45-67",website:"https://пример.рф/contact",messengers:[{kind:"telegram",url:"https://t.me/club"}]};
 const f={cityId:"a0000000-0000-4000-8000-000000000001",name:"Зал",address:"Адрес",timezone:"Europe/Moscow",latitude:55,longitude:37};
 it("strict edit normalizes IDN; create rejects; omission/null remain distinct",()=>{
  const normalized=publicVenueContactsSchema.parse(valid);
  expect(normalized?.website).toBe("https://xn--e1afmkfd.xn--p1ai/contact");
  for(const publicContacts of [valid,null,undefined])expect(venueCommand.safeParse({action:"edit",expectedVersion:1,reasonCode:"synthetic_review",fields:{...f,publicContacts}}).success).toBe(true);
  expect(venueCreate.safeParse({...f,reasonCode:"synthetic_review",publicContacts:valid}).success).toBe(false);
  for(const bad of [{...valid,private:"secret"},{...valid,phone:undefined},{...valid,messengers:[...valid.messengers,...valid.messengers]}])expect(publicVenueContactsSchema.safeParse(bad).success).toBe(false);
 });
 it("WHATWG boundaries and normalized rather than raw length",()=>{
  for(const [raw,url] of [["HTTP://Example.COM:80/a/../b","http://example.com/b"],["https://127.0.0.1:443/","https://127.0.0.1/"],["https://[::1]/","https://[::1]/"],[" ".repeat(310)+"https://example.com/ ","https://example.com/"]])expect(publicContactUrl(raw)).toBe(url);
  for(const raw of ["https://foo／bar.example/path","https://a@b/","https://b:444/","https://b/\n","https://b/\\x","javascript:alert(1)"])expect(publicContactUrl(raw)).toBeNull();
  const expanded="https://example.com/"+"я".repeat(100);expect(expanded.length).toBeLessThan(300);expect(publicContactUrl(expanded)).toBeNull();
  expect(publicContactUrl("https://example.com/"+"a".repeat(280))).not.toBeNull();
  expect(publicContactUrl("https://example.com/"+"a".repeat(281))).toBeNull();
  expect(publicContactUrl("https://t.me/a/..","telegram")).toBeNull();
  expect(publicContactUrl("http://t.me/club","telegram")).toBeNull();
 });
 it("phone bounds and tolerant reads retain safe neighbors",()=>{
  for(const phone of ["123456","1".repeat(16),"12+345678","\n1234567","1234567\u0085"])expect(publicContactPhone(phone)).toBeNull();
  expect(publicContactPhone("  +1234567  ")).toBe("+1234567");
  for(const raw of [null,undefined,[],42,"x"])expect(readPublicVenueContacts(raw)).toBeNull();
  expect(readPublicVenueContacts({...valid,phone:"unsafe",website:"javascript:x",messengers:[{kind:"telegram",url:"https://t.me/"},...valid.messengers,...valid.messengers,{kind:"vk",url:"https://vk.com/club"}],contact_phone:"private"})).toEqual({phone:null,website:null,messengers:[{kind:"telegram",url:"https://t.me/club"},{kind:"vk",url:"https://vk.com/club"}]});
 });
});

import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type { FastifyRequest } from "fastify";
import { AdminService, type AdminActor } from "../../src/admin/admin.service";
import { AdminVenuesService } from "../../src/venues/admin-venues.service";
import { VenuesService } from "../../src/venues/venues.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
function queryResult<R extends QueryResultRow>(rows:R[]):QueryResult<R>{return {rows,rowCount:rows.length,command:"SELECT",oid:0,fields:[]};}
describe("public contacts service projections and SQL binds without DB",()=>{
 const id="a0000000-0000-4000-8000-000000000003",cityId="a0000000-0000-4000-8000-000000000001";
 const contacts={phone:"+1234567",website:"https://example.com/",messengers:[]};
 const base={id,city_id:cityId,name:"Зал",address:"Адрес",timezone:"Europe/Moscow",latitude:55,longitude:37,lifecycle_state:"verified",canonical_venue_id:null,identity_discriminator:"",version:1,normalized_name:"зал",normalized_address:"адрес",data_status:"verified",provenance:"admin_created",public_contacts:contacts as unknown,contact_phone:"private",contact_website:"https://private.invalid",booking_note:"private",cover_credit_kind:null,cover_credit_text:null,cover_credit_url:null};
 it("catalog and alias detail sanitize unknown contacts and omit private fields",async()=>{
  const statements:string[]=[];
  let alias=false;
  const fake:Pick<Pool,"query">={query:(async(sql:string)=>{
   statements.push(sql);
   if(alias && statements.length===1)return queryResult([{...base,lifecycle_state:"merged",canonical_venue_id:"a0000000-0000-4000-8000-000000000004"}]);
   return queryResult([{...base,id:alias?"a0000000-0000-4000-8000-000000000004":id,public_contacts:{...contacts,phone:"unsafe"}}]);
  }) as Pool['query']};
  const service=new VenuesService(fake as Pool,{} as IdempotencyService,{} as MutationRunner);
  const page=await service.searchCatalog({cityId});expect(page.items[0]?.publicContacts).toEqual({...contacts,phone:null});expect(JSON.stringify(page)).not.toContain('private');expect(statements[0]).toContain('public_contacts');
  statements.length=0;alias=true;
  const detail=await service.getById(id);expect(detail.publicContacts).toEqual({...contacts,phone:null});expect(detail.resolvedFromVenueId).toBe(id);expect(statements).toHaveLength(2);
 });
 it("fuzzy candidates and proposal RETURNING expose safe contacts without contact writes",async()=>{
  for(const fuzzy of [true,false]){
   const calls:string[]=[];
   const client:Pick<PoolClient,'query'>={query:(async(sql:string)=>{
    calls.push(sql);
    if(sql.startsWith('SELECT id FROM cities'))return queryResult([{id:cityId}]);
    if(sql.includes('AS distance_m'))return queryResult(fuzzy?[{...base,distance_m:0}]:[]);
    if(sql.includes('INSERT INTO venues ('))return queryResult([{...base,public_contacts:null}]);
    if(sql.includes('INSERT INTO venue_identity_keys'))return queryResult([{venue_id:id}]);
    return queryResult([]);
   }) as PoolClient['query']};
   const mutations:Pick<MutationRunner,'runIdempotent'>={runIdempotent:async input=>input.execute(client as PoolClient)};
   const hash:Pick<IdempotencyService,'requestHash'>={requestHash:()=>"synthetic"};
   const service=new VenuesService({} as Pool,hash as IdempotencyService,mutations as MutationRunner);
   const result=await service.propose(id,id,'synthetic-key',{cityId,name:base.name,address:base.address,timezone:base.timezone,latitude:55,longitude:37});
   expect(result.statusCode).toBe(fuzzy?409:201);
   if('candidates' in result.body)expect(result.body.candidates[0]?.publicContacts).toEqual(contacts);
   else expect(result.body.publicContacts).toBeNull();
   expect(JSON.stringify(result.body)).not.toContain('private');
   expect(calls.some(sql=>sql.includes('public_contacts')&&sql.includes(fuzzy?'AS distance_m':'RETURNING'))).toBe(true);
   for(const sql of calls.filter(sql=>sql.includes('INSERT INTO venues (')))expect(sql.split('RETURNING')[0]).not.toContain('public_contacts');
  }
 });
 it("admin edit binds omission, SQL NULL and serialized canonical replacement; audit/outbox omit contacts",async()=>{
  for(const publicContacts of [undefined,null,{...contacts,website:"https://пример.рф/contact"}]){
   let row={...base};const calls:{sql:string;values:unknown[]}[]=[];
   const client:Pick<PoolClient,'query'>={query:(async(sql:string,values:unknown[]=[])=>{
    calls.push({sql,values});
    if(sql.startsWith('SELECT v.*'))return queryResult([row]);
    if(sql.startsWith('UPDATE venues SET name=')){if(values[12])row={...row,public_contacts:values[13]===null?null:JSON.parse(String(values[13]))};row.version++;}
    if(sql.includes('privileged_audit_events'))return queryResult([{id:'audit'}]);
    return queryResult([]);
   }) as PoolClient['query']};
   const timestamp = new Date("2026-10-21T00:00:00Z");
   const actor: AdminActor = {
    principalId: 'actor', roles: ['content_manager'], sessionId: 'session',
    principal: { id: 'actor', user_id: id, status: 'active', version: 1 },
    session: {
     id: 'session', principal_id: 'actor', credential_id: 'credential',
     audience: 'gobadminton-admin', csrf_ciphertext: 'synthetic-csrf',
     expires_at: new Date("2026-10-22T00:00:00Z"), last_seen_at: timestamp,
     step_up_at: timestamp, revoked_at: null,
    },
   };
   const fake:Pick<AdminService,'privilegedCommand'|'privilegedRead'>={
    privilegedCommand:async(_r,_k,_p,_s,_o,_i,execute)=>execute(client as PoolClient,actor,'hash'),
    privilegedRead:async(_r,_p,read)=>read(client as PoolClient,actor),
   };
   const service=new AdminVenuesService(fake as AdminService);
   const input=venueCommand.parse({action:'edit',expectedVersion:1,reasonCode:'synthetic_review',fields:{cityId,name:base.name,address:base.address,timezone:base.timezone,latitude:55,longitude:37,publicContacts}});
   const result=await service.command({} as FastifyRequest,'synthetic-key',id,input);
   const update=calls.find(c=>c.sql.startsWith('UPDATE venues SET name='));expect(update?.sql).toContain('CASE WHEN $13::boolean THEN $14::jsonb ELSE public_contacts END');
   expect(update?.values[12]).toBe(publicContacts!==undefined);
   expect(update?.values[13]).toBe(publicContacts==null?null:JSON.stringify({...contacts,website:'https://xn--e1afmkfd.xn--p1ai/contact'}));
   expect(result).toHaveProperty('publicContacts',publicContacts===undefined?contacts:publicContacts===null?null:{...contacts,website:'https://xn--e1afmkfd.xn--p1ai/contact'});
   for(const call of calls.filter(c=>/INSERT INTO (privileged_audit_events|outbox_events)/.test(c.sql)))expect(JSON.stringify(call.values)).not.toMatch(/1234567|example.com|xn--|private/);
   expect(await service.detail({} as FastifyRequest,id)).toHaveProperty('publicContacts');
  }
 });
});
