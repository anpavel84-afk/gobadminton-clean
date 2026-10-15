import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { GamesService } from "../../src/games/games.service";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { MODERATION_PROVIDER, safeImageDecision } from "../../src/moderation/provider";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { AvatarService } from "../../src/profiles/avatar.service";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";
const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
const origin="http://localhost:19440", pepper="venue-cover-synthetic-admin-pepper-32chars";
type Actor={id:string;userId:string;token:string;csrf:string};
run("venue cover: isolated disposable PostGIS / actual API / games projections",()=>{
  let app:NestFastifyApplication,pool:Pool,adminPool:Pool,media:string,png:Buffer,fake:FakeModerationProvider;
  let owner:Actor,other:Actor,support:Actor,playerCookie:string;
  const name=`venue_cover_${randomUUID().replaceAll("-","")}`;
  const cityId="a0000000-0000-4000-8000-000000000001";
  beforeAll(async()=>{
    const url=new URL(process.env.DATABASE_URL!);
    if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Disposable loopback PostGIS required");
    adminPool=new Pool({connectionString:url.href});await adminPool.query(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;
    pool=new Pool({connectionString:url.href});
    const dir=path.resolve(__dirname,"../../migrations");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    for(const file of (await readdir(dir)).filter(f=>f.endsWith(".sql")).sort())await pool.query(await readFile(path.join(dir,file),"utf8"));
    const root=path.resolve(__dirname,"../../.qa-runtime");await mkdir(root,{recursive:true});media=await mkdtemp(path.join(root,"venue-cover-"));
    const env=loadEnv({...process.env,DATABASE_URL:url.href,NODE_ENV:"test",APP_ENV:"local",PUBLIC_API_ORIGIN:"http://127.0.0.1:19441",PUBLIC_WEB_ORIGIN:origin,ALLOWED_WEB_ORIGINS:origin,ADMIN_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:origin,ADMIN_AUTH_PEPPER:pepper,AVATAR_MEDIA_ROOT:media,CONTENT_MODERATION_PROVIDER:"fake",CONTENT_MODERATION_FINGERPRINT_SECRET:"venue-cover-synthetic-fingerprint-secret"});
    fake=new FakeModerationProvider(env);
    const mod=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AdminModule,GamesModule,VenuesModule,ProfilesModule]})
      .overrideProvider(MODERATION_PROVIDER).useValue(fake).compile();
    app=mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));registerAvatarHttp(app.getHttpAdapter().getInstance());
    await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
    owner=await actor("content_manager");other=await actor("content_manager");support=await actor("support");
    const session=await app.get(SessionService).createConsumerSession(await user());playerCookie=`${SESSION_COOKIE}=${session.sessionToken}`;
    png=await sharp({create:{width:900,height:600,channels:3,background:"green"}}).withMetadata().png().toBuffer();
  },120000);
  beforeEach(async()=>{await pool.query("DELETE FROM admin_rate_windows");await pool.query("DELETE FROM content_moderation_rate_budgets");fake.fixture=async()=>safeImageDecision();});
  afterAll(async()=>{
    await app?.close();await pool?.end();if(adminPool){await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);await adminPool.end();}
    if(media)await rm(media,{recursive:true,force:true});
  });
  async function user(){return (await pool.query<{id:string}>("INSERT INTO users(display_name) VALUES('Synthetic venue cover') RETURNING id")).rows[0]!.id;}
  async function actor(role:AdminRole):Promise<Actor>{
    const userId=await user(),id=(await pool.query<{id:string}>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[userId])).rows[0]!.id;
    await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",[id,role]);
    const credential=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID();
    await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[credential,id,Buffer.from("synthetic-fixture")]);
    await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",[id,credential,hashSecret(pepper,token),sealSecret(pepper,csrf)]);
    return {id,userId,token,csrf};
  }
  function headers(a=owner){return {origin,cookie:`${ADMIN_COOKIE}=${a.token}`,"x-csrf-token":a.csrf,"idempotency-key":randomUUID()};}
  async function venue(){const r=await app.inject({method:"POST",url:"/v1/admin/venues",headers:headers(),payload:{cityId,name:"Synthetic "+randomUUID(),address:"Synthetic address",timezone:"Europe/Moscow",latitude:55.75,longitude:37.62,reasonCode:"synthetic_fixture"}});expect(r.statusCode,r.body).toBe(201);return r.json() as {id:string;version:number};}
  function upload(id:string,version=1,a=owner,key=randomUUID(),body=png,patch:Record<string,string>={}){
    return app.inject({method:"PUT",url:`/v1/admin/venues/${id}/cover`,headers:{...headers(a),"content-type":"image/png","x-venue-version":String(version),"idempotency-key":key,...patch},payload:body});
  }
  const read=(url:string)=>app.inject({method:"GET",url});
  it("rejects anonymous/player/foreign manager/support, CSRF, origin, stale step-up and invalid binary before publication",async()=>{
    const v=await venue(),calls=fake.calls;
    for(const [patch,status] of [[{cookie:""},401],[{cookie:playerCookie},401],[{"x-csrf-token":""},403],[{origin:"https://evil.invalid"},403]] as Array<[Record<string,string>,number]>)expect((await upload(v.id,1,owner,randomUUID(),png,patch)).statusCode).toBe(status);
    for(const a of [other,support]) {
      const removed=await app.inject({method:"DELETE",url:`/v1/admin/venues/${v.id}/cover`,headers:headers(a),payload:{expectedVersion:1}});
      expect(removed.statusCode).toBe(a===other?404:403);
      const accessDenied=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover/access`,headers:headers(a)});
      expect(accessDenied.statusCode).toBe(a===other?404:403);
    }
    expect((await upload(v.id,1,other)).statusCode).toBe(404);expect((await upload(v.id,1,support)).statusCode).toBe(403);expect(fake.calls).toBe(calls);
    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE principal_id=$1",[owner.id]);expect((await upload(v.id)).statusCode).toBe(403);
    await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE principal_id=$1",[owner.id]);
    for(const body of [Buffer.from('<svg/>'),Buffer.concat([png,Buffer.from('<html/>')])])expect((await upload(v.id,1,owner,randomUUID(),body)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await upload(v.id,1,owner,randomUUID(),png,{"content-type":"image/jpeg"})).statusCode).toBe(415);
    expect((await upload(v.id,1,owner,randomUUID(),Buffer.alloc(5*1024*1024+1))).statusCode).toBe(413);
    const access=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover/access`,headers:headers()});
    const browserRead=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover/access`,headers:{cookie:headers().cookie,"sec-fetch-site":"same-origin",referer:origin+`/venues/${v.id}`}});
    expect(browserRead.statusCode,browserRead.body).toBe(200);
    for(const patch of [{"sec-fetch-site":"cross-site"},{referer:"https://evil.invalid/"}]){
      const denied=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover/access`,headers:{cookie:headers().cookie,"sec-fetch-site":"same-origin",referer:origin+`/venues/${v.id}`,...patch}});
      expect(denied.statusCode).toBe(403);
    }
    expect(access.statusCode,access.body).toBe(200);expect(access.json()).toMatchObject({version:1,csrfToken:owner.csrf,cover:{uploadedUrl:null}});
  });
  it("projects current derivative/default in actual games list/detail, replace/delete/hide and public media; preserves private profile covers",async()=>{
    const v=await venue(),service=app.get(GamesService),session=await app.get(SessionService).createConsumerSession(owner.userId);
    const starts=new Date(Date.now()+2*86400000),ends=new Date(+starts+3600000);
    const game=await service.createDraft(owner.userId,session.session.id,randomUUID(),{hostDisplayName:"Synthetic host",hostPublicContact:"Synthetic contact",venueId:v.id,startsAt:starts.toISOString(),endsAt:ends.toISOString(),timezone:"Europe/Moscow",applicationDeadlineAt:starts.toISOString(),capacity:4,externalReservedCount:0,visibility:"public",formatKey:"doubles",activityKind:"regular",levelRule:{scaleId:"test",scaleVersion:1,allowedLevelIds:["test"]},settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,terms:"Synthetic"}});
    await service.publish(owner.userId,session.session.id,game.body.id,randomUUID(),game.body.version);
    async function projections(expected:string|null){
      const detail=await read(`/v1/games/${game.body.id}`);expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().venue).toMatchObject({id:v.id,cover:{uploadedUrl:expected}});
      const list=await read(`/v1/games?venueId=${v.id}`);expect(list.statusCode,list.body).toBe(200);expect(list.json().items.find((g:{id:string})=>g.id===game.body.id)?.venue).toMatchObject({id:v.id,cover:{uploadedUrl:expected}});
      expect((await read(`/v1/venues/${v.id}`)).json().cover).toEqual({uploadedUrl:expected});
      const catalog=await read(`/v1/venues?cityId=${cityId}`);expect(catalog.json().items.find((r:{id:string})=>r.id===v.id)?.cover).toEqual({uploadedUrl:expected});
    }
    await projections(null);
    const key=randomUUID(),saved=await upload(v.id,1,owner,key);expect(saved.statusCode,saved.body).toBe(200);const url=saved.json().cover.uploadedUrl;
    await projections(url);
    const image=await read(url);expect(image.statusCode,image.body).toBe(200);expect(image.headers["cache-control"]).toBe("no-store");expect(image.headers["x-content-type-options"]).toBe("nosniff");
    const meta=await sharp(image.rawPayload).metadata();expect(meta).toMatchObject({format:"png",width:1200,height:400});expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();
    const calls=fake.calls;expect((await upload(v.id,1,owner,key)).json()).toEqual(saved.json());expect(fake.calls).toBe(calls);expect((await upload(v.id,2,owner,key)).statusCode).toBe(409);
    // A private profile-cover key is not promoted by the venue media route.
    const approval=(await pool.query("SELECT cover_moderation_approval_id AS id FROM venues WHERE id=$1",[v.id])).rows[0].id,privateKey="f".repeat(64)+".png";
    await pool.query("INSERT INTO player_social_profiles(user_id,display_name,cover_key,cover_moderation_approval_id) VALUES($1,'Private synthetic',$2,$3)",[owner.userId,privateKey,approval]);
    expect((await read(`/v1/media/venue-covers/${privateKey}`)).statusCode).toBe(404);
    expect((await read(`/v1/media/covers/${privateKey}`)).statusCode).toBe(404);
    await pool.query("UPDATE content_moderation_approvals SET decision='reject' WHERE id=$1",[approval]);
    expect((await read(url)).statusCode).toBe(404);await projections(null);
    await pool.query("DELETE FROM content_moderation_rate_budgets");
    const replaced=await upload(v.id,2);expect(replaced.statusCode,replaced.body).toBe(200);const next=replaced.json().cover.uploadedUrl;
    expect(next).not.toBe(url);expect((await read(url)).statusCode).toBe(404);await projections(next);
    const removed=await app.inject({method:"DELETE",url:`/v1/admin/venues/${v.id}/cover`,headers:headers(),payload:{expectedVersion:3}});
    expect(removed.statusCode,removed.body).toBe(200);expect((await read(next)).statusCode).toBe(404);await projections(null);
    await app.get(AvatarService).cleanup();
    expect((await pool.query("SELECT count(*)::int AS n FROM venue_admin_actions WHERE venue_id=$1 AND action='cover'",[v.id])).rows[0].n).toBe(3);
  });
  it("keeps CAS and moderation rejection atomic; retirement hides public bytes",async()=>{
    const v=await venue();
    fake.fixture=async()=>({...safeImageDecision(),flagged:true});
    expect((await upload(v.id)).statusCode).toBe(422);
    expect((await pool.query("SELECT cover_key,version FROM venues WHERE id=$1",[v.id])).rows[0]).toEqual({cover_key:null,version:1});
    fake.fixture=async()=>safeImageDecision();await pool.query("DELETE FROM content_moderation_rate_budgets");
    const saved=await upload(v.id);expect(saved.statusCode,saved.body).toBe(200);
    expect((await upload(v.id,1)).statusCode).toBe(409);
    const malformed=await app.inject({method:"DELETE",url:`/v1/admin/venues/${v.id}/cover`,headers:headers(),payload:{expectedVersion:2,arbitraryUrl:"https://evil.invalid"}});
    expect(malformed.statusCode).toBe(400);
    const retired=await app.inject({method:"POST",url:`/v1/admin/venues/${v.id}/commands`,headers:headers(),payload:{action:"retire",expectedVersion:2,reasonCode:"synthetic_fixture"}});
    expect(retired.statusCode,retired.body).toBe(201);
    expect((await read(saved.json().cover.uploadedUrl)).statusCode).toBe(404);
    expect((await read(`/v1/venues/${v.id}`)).json().cover).toEqual({uploadedUrl:null});
    expect((await upload(v.id,3)).statusCode).toBe(404);
  });
  it("reauthorizes replay, fences principal generation during moderation and account retirement",async()=>{
    const a=await actor("content_manager"),v=await venue();await pool.query("UPDATE venues SET created_by_user_id=$2 WHERE id=$1",[v.id,a.userId]);
    const key=randomUUID(),saved=await upload(v.id,1,a,key);expect(saved.statusCode,saved.body).toBe(200);
    await pool.query("UPDATE admin_role_grants SET active=false WHERE principal_id=$1",[a.id]);expect((await upload(v.id,1,a,key)).statusCode).toBe(403);
    await pool.query("UPDATE admin_role_grants SET active=true WHERE principal_id=$1",[a.id]);
    await pool.query("DELETE FROM content_moderation_rate_budgets");
    fake.fixture=async()=>{await pool.query("UPDATE admin_principals SET version=version+1 WHERE id=$1",[a.id]);return safeImageDecision();};
    expect((await upload(v.id,2,a)).statusCode).toBe(409);expect((await read(saved.json().cover.uploadedUrl)).statusCode).toBe(200);
    await pool.query("UPDATE admin_sessions SET revoked_at=now() WHERE principal_id=$1",[a.id]);expect((await upload(v.id,1,a,key)).statusCode).toBe(401);
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[a.userId]);expect((await read(saved.json().cover.uploadedUrl)).statusCode).toBe(404);
    expect((await pool.query("SELECT cover_key FROM venues WHERE id=$1",[v.id])).rows[0].cover_key).toBeNull();
  });
});
