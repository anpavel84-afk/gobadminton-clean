import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
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
import { VenuesService } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
const origin="http://localhost:19440",pepper="p4-private-synthetic-admin-pepper-32chars";
type Actor={id:string;token:string;csrf:string};
run("P4 venue lifecycle on current P3",()=>{
 let app:NestFastifyApplication,pool:Pool,content:Actor,other:Actor,support:Actor,games:GamesService,sessions:SessionService,venues:VenuesService;
 const cityId="a0000000-0000-4000-8000-000000000001";
 beforeAll(async()=>{
  process.env.NODE_ENV="test";process.env.APP_ENV="local";process.env.PUBLIC_API_ORIGIN="http://127.0.0.1:19441";process.env.PUBLIC_WEB_ORIGIN="http://127.0.0.1:19442";process.env.ALLOWED_WEB_ORIGINS=process.env.PUBLIC_WEB_ORIGIN;
  execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:process.env,stdio:"inherit"});
  const env=loadEnv({...process.env,ADMIN_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:origin,ADMIN_AUTH_PEPPER:pepper});pool=new Pool({connectionString:env.DATABASE_URL,max:10});
  const mod=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AdminModule,GamesModule,VenuesModule,AuthModule]}).compile();
  app=mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
  content=await actor("content_manager");other=await actor("superadmin");support=await actor("support");games=mod.get(GamesService);sessions=mod.get(SessionService);venues=mod.get(VenuesService);
 },120000);
 beforeEach(async()=>{await pool.query("DELETE FROM admin_rate_windows");});
 afterAll(async()=>{await app?.close();await pool?.end();});
 async function user(){return (await pool.query<{id:string}>("INSERT INTO users(display_name) VALUES('P4 synthetic') RETURNING id")).rows[0]!.id;}
 async function actor(role:AdminRole):Promise<Actor>{const uid=await user(),id=(await pool.query<{id:string}>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[uid])).rows[0]!.id;await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",[id,role]);const credential=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID();await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[credential,id,Buffer.from('synthetic-command-fixture')]);await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",[id,credential,hashSecret(pepper,token),sealSecret(pepper,csrf)]);return {id,token,csrf};}
 function fields(extra:object={}){return {cityId,name:"Synthetic "+randomUUID(),address:"Synthetic address "+randomUUID(),timezone:"Europe/Moscow",latitude:55.75,longitude:37.62,...extra};}
 function post(url:string,payload:object,a=content,key=randomUUID()){return app.inject({method:"POST",url:"/v1/admin/venues"+url,headers:{origin,"x-csrf-token":a.csrf,"idempotency-key":key},cookies:{[ADMIN_COOKIE]:a.token},payload});}
 function get(url:string,a=content){return app.inject({method:"GET",url:"/v1/admin/venues"+url,headers:{origin},cookies:{[ADMIN_COOKIE]:a.token}});}
 async function create(extra:object={}){const r=await post("",{...fields(extra),reasonCode:"synthetic_review"});expect(r.statusCode,r.body).toBe(201);return r.json() as {id:string;version:number};}
 function command(id:string,action:string,extra:object={},a=content,key=randomUUID()){return post('/'+id+'/commands',{action,expectedVersion:1,reasonCode:'synthetic_review',...extra},a,key);}
 it("denies consumer/support, missing CSRF, stale stepup and unknown sensitive fields",async()=>{
  expect((await get('',support)).statusCode).toBe(403);expect((await app.inject({method:'GET',url:'/v1/admin/venues',headers:{origin,authorization:'Bearer consumer'}})).statusCode).toBe(401);
  expect((await post('',{...fields(),reasonCode:'synthetic_review',sql:'select secret'})).statusCode).toBe(400);
  const v=await create();expect((await app.inject({method:'POST',url:'/v1/admin/venues/'+v.id+'/commands',headers:{origin,'idempotency-key':randomUUID()},cookies:{[ADMIN_COOKIE]:content.token},payload:{action:'retire',expectedVersion:1,reasonCode:'synthetic_review'}})).statusCode).toBe(403);
  await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE principal_id=$1",[content.id]);expect((await command(v.id,'retire')).statusCode).toBe(403);await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE principal_id=$1",[content.id]);
 });
 it("verifies, retires, restores, preserves bounded catalog and versions",async()=>{
  const v=await create();expect((await command(v.id,'retire')).statusCode).toBe(201);expect((await command(v.id,'restore')).statusCode).toBe(409);
  expect((await command(v.id,'restore',{expectedVersion:2})).statusCode).toBe(201);expect((await command(v.id,'verify',{expectedVersion:3})).statusCode).toBe(201);expect((await get('/'+v.id)).json().version).toBe(4);
  expect((await venues.searchCatalog({cityId,limit:1})).items.length).toBe(1);
 });
 it("merges live game references/reservations; old IDs and legacy proposal keys resolve; repeat reauthorizes",async()=>{
  const f=fields(),source=(await post('',{...f,reasonCode:'synthetic_review'})).json(),target=await create();
  const uid=await user(),session=await sessions.createConsumerSession(uid),starts=new Date(Date.now()+2*86400000),ends=new Date(+starts+3600000);
  const game=await games.createDraft(uid,session.session.id,randomUUID(),{hostDisplayName:'Synthetic',hostPublicContact:'Synthetic',venueId:source.id,startsAt:starts.toISOString(),endsAt:ends.toISOString(),timezone:'Europe/Moscow',applicationDeadlineAt:starts.toISOString(),capacity:4,externalReservedCount:0,visibility:'public',formatKey:'doubles',activityKind:'regular',levelRule:{scaleId:'test',scaleVersion:1,allowedLevelIds:['test']},settlement:{mode:'external',purpose:'no_trainer_fee',priceMinor:null,currency:null,terms:'Synthetic'}});
  const key=randomUUID(),payload={targetId:target.id,expectedTargetVersion:1};const r=await command(source.id,'merge',payload,content,key);expect(r.statusCode,r.body).toBe(201);expect((await command(source.id,'merge',payload,content,key)).body).toBe(r.body);
  expect((await pool.query('SELECT venue_id FROM games WHERE id=$1',[game.body.id])).rows[0].venue_id).toBe(target.id);
  expect((await venues.getById(source.id)).id).toBe(target.id);expect(((await venues.propose(uid,session.session.id,randomUUID(),f)).body as {id:string}).id).toBe(target.id);
  expect((await pool.query('SELECT count(*) FROM venue_identity_keys WHERE venue_id=$1',[target.id])).rows[0].count).toBe('2');
  await pool.query('UPDATE admin_role_grants SET active=false WHERE principal_id=$1',[content.id]);expect((await command(source.id,'merge',payload,content,key)).statusCode).toBe(403);await pool.query('UPDATE admin_role_grants SET active=true WHERE principal_id=$1',[content.id]);
 });
 it("serializes concurrent reverse merge, resolves aliases, rejects self/cross-city/distinct halls",async()=>{
  const a=await create(),b=await create();const results=await Promise.all([command(a.id,'merge',{targetId:b.id,expectedTargetVersion:1}),command(b.id,'merge',{targetId:a.id,expectedTargetVersion:1},other)]);expect(results.map(x=>x.statusCode).sort()).toEqual([201,409]);
  const h1=await create({identityDiscriminator:'hall:1'}),h2=await create({identityDiscriminator:'hall:2'});expect((await command(h1.id,'merge',{targetId:h2.id,expectedTargetVersion:1})).json().code).toBe('VENUE_DISTINCT_UNIT');
  expect((await command(h1.id,'merge',{targetId:h1.id,expectedTargetVersion:1})).statusCode).toBe(409);
  const spb=await create({cityId:'a0000000-0000-4000-8000-000000000002'});expect((await command(h1.id,'merge',{targetId:spb.id,expectedTargetVersion:1})).statusCode).toBe(409);
 });
 it("routes edit collision to review without silent merge; audited dismissal uses version",async()=>{
  const f=fields(),a=(await post('',{...f,reasonCode:'synthetic_review'})).json(),b=await create();const r=await command(b.id,'edit',{fields:f});expect(r.statusCode,r.body).toBe(201);expect(r.json().reviewRequired).toBe(true);expect((await get('/'+b.id)).json().version).toBe(1);
  const list=(await get('/duplicates')).json().items;const d=list.find((x:{leftVenueId:string;rightVenueId:string})=>[x.leftVenueId,x.rightVenueId].includes(a.id));expect(d).toBeTruthy();expect((await post('/duplicates/'+d.id+'/dismiss',{expectedVersion:d.version,reasonCode:'distinct_confirmed'})).statusCode).toBe(201);
 });
 it("rolls back merge, history, keys and receipt when audit fails; history is append-only",async()=>{
  const a=await create(),b=await create();await pool.query("CREATE FUNCTION p4_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='venue.merge' THEN RAISE EXCEPTION 'synthetic audit rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER p4_fail_audit BEFORE INSERT ON privileged_audit_events FOR EACH ROW EXECUTE FUNCTION p4_reject_audit()");
  try{expect((await command(a.id,'merge',{targetId:b.id,expectedTargetVersion:1})).statusCode).toBe(500);expect((await get('/'+a.id)).json().version).toBe(1);expect((await pool.query('SELECT count(*) FROM venue_merge_history WHERE source_venue_id=$1',[a.id])).rows[0].count).toBe('0');expect((await pool.query('SELECT count(*) FROM venue_identity_keys WHERE venue_id=$1',[a.id])).rows[0].count).toBe('1');}finally{await pool.query('DROP TRIGGER p4_fail_audit ON privileged_audit_events; DROP FUNCTION p4_reject_audit()');}
  await expect(pool.query('DELETE FROM venue_admin_actions WHERE venue_id=$1',[a.id])).rejects.toThrow();
 });
});
