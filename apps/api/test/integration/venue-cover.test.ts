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
import { MODERATION_PROVIDER, ModerationProviderError, safeImageDecision } from "../../src/moderation/provider";
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
    // Keep the synthetic consumer and admin surfaces isolated regardless of CI inheritance.
    const env=loadEnv({...process.env,DATABASE_URL:url.href,NODE_ENV:"test",APP_ENV:"local",PUBLIC_API_ORIGIN:"http://127.0.0.1:19441",
      HOST:"127.0.0.1",PUBLIC_WEB_ORIGIN:"http://127.0.0.1:19442",ALLOWED_WEB_ORIGINS:"http://127.0.0.1:19442",
      AUTH_PEPPER:"venue-cover-synthetic-consumer-pepper-32chars",ADMIN_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:origin,ADMIN_AUTH_PEPPER:pepper,
      ADMIN_VK_REDIRECT_URI:origin+"/v1/admin/auth/vk/callback",ADMIN_YANDEX_REDIRECT_URI:origin+"/v1/admin/auth/yandex/callback",AVATAR_MEDIA_ROOT:media,CONTENT_MODERATION_PROVIDER:"fake",CONTENT_MODERATION_FINGERPRINT_SECRET:"venue-cover-synthetic-fingerprint-secret"});
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
  it("superadmin manages imported and nonowned eligible catalog covers without changing creator ownership",async()=>{
    const admin=await actor("superadmin");
    for(const imported of [false,true]) {
      const v=await venue();
      // Imported catalog rows still have mandatory creator provenance in the actual schema.
      const creator=imported?await user():owner.userId;
      if(imported)await pool.query("UPDATE venues SET created_by_user_id=$2 WHERE id=$1",[v.id,creator]);
      const access=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover/access`,headers:headers(admin)});
      expect(access.statusCode,access.body).toBe(200);
      expect((await upload(v.id,1,other)).statusCode).toBe(404);
      const saved=await upload(v.id,1,admin);expect(saved.statusCode,saved.body).toBe(200);
      const row=(await pool.query("SELECT created_by_user_id FROM venues WHERE id=$1",[v.id])).rows[0];
      expect(row.created_by_user_id).toBe(creator);
      const removed=await app.inject({method:"DELETE",url:`/v1/admin/venues/${v.id}/cover`,headers:headers(admin),payload:{expectedVersion:saved.json().version}});
      expect(removed.statusCode,removed.body).toBe(200);
      await pool.query("UPDATE venues SET lifecycle_state='retired' WHERE id=$1",[v.id]);
      expect((await upload(v.id,removed.json().version,admin)).statusCode).toBe(404);
    }
  });
  it("two-venue selection isolation and reload persist exact selected cover",async()=>{
    const a=await venue(),b=await venue(),admin=await actor("superadmin");
    const saved=await upload(a.id,1,admin);expect(saved.statusCode,saved.body).toBe(200);
    const cover=async(id:string)=>app.inject({method:"GET",url:`/v1/admin/venues/${id}/cover`,headers:headers(admin)});
    const first=await cover(a.id),second=await cover(b.id);
    expect(first.json().hasCover).toBe(true);expect(second.json()).toMatchObject({version:1,hasCover:false});
    expect((await cover(a.id)).json()).toEqual(first.json());
    expect((await pool.query("SELECT version,cover_key FROM venues WHERE id=$1",[b.id])).rows[0]).toMatchObject({version:1,cover_key:null});
  });
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
    expect(access.statusCode,access.body).toBe(200);expect(access.json()).toMatchObject({version:1,hasCover:false,csrfToken:owner.csrf,cover:{uploadedUrl:null}});
  });
  it("projects current derivative/default in actual games list/detail, replace/delete/hide and public media; preserves private profile covers",async()=>{
    const v=await venue(),service=app.get(GamesService),session=await app.get(SessionService).createConsumerSession(owner.userId);
    const starts=new Date(Date.now()+2*86400000),ends=new Date(+starts+3600000);
    const game=await service.createDraft(owner.userId,session.session.id,randomUUID(),{hostDisplayName:"Synthetic host",hostPublicContact:"Synthetic contact",venueId:v.id,startsAt:starts.toISOString(),endsAt:ends.toISOString(),timezone:"Europe/Moscow",applicationDeadlineAt:starts.toISOString(),capacity:4,externalReservedCount:0,visibility:"public",formatKey:"doubles",activityKind:"regular",levelRule:{scaleId:"test",scaleVersion:1,allowedLevelIds:["test"]},settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,terms:"Synthetic"}});
    await service.publish(owner.userId,session.session.id,game.body.id,randomUUID(),game.body.version);
    async function projections(expected:string|null){
      const detail=await read(`/v1/games/${game.body.id}`);expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().venue).toMatchObject({id:v.id,cover:{uploadedUrl:expected}});
      const list=await read(`/v1/games?venueId=${v.id}`);expect(list.statusCode,list.body).toBe(200);expect(list.json().items.find((g:{id:string})=>g.id===game.body.id)?.venue).toMatchObject({id:v.id,cover:{uploadedUrl:expected}});
      expect((await read(`/v1/venues/${v.id}`)).json().cover).toEqual({uploadedUrl:expected,credit:null});
      const catalog=await read(`/v1/venues?cityId=${cityId}`);expect(catalog.json().items.find((r:{id:string})=>r.id===v.id)?.cover).toEqual({uploadedUrl:expected,credit:null});
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
  it.each(["reject", "review"])("lets only the authorized owner delete a retained cover hidden by %s",async decision=>{
    const v=await venue(),saved=await upload(v.id);
    expect(saved.statusCode,saved.body).toBe(200);
    expect(saved.json().hasCover).toBe(true);
    const url=saved.json().cover.uploadedUrl;
    await pool.query("UPDATE content_moderation_approvals SET decision=$2 WHERE id=(SELECT cover_moderation_approval_id FROM venues WHERE id=$1)",[v.id,decision]);
    expect((await read(url)).statusCode).toBe(404);
    const access=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover/access`,headers:headers()});
    expect(access.statusCode,access.body).toBe(200);
    expect(access.json()).toMatchObject({version:2,hasCover:true,cover:{uploadedUrl:null}});
    // Public DTOs still contain only the approved URL, never retained-cover metadata.
    expect((await read(`/v1/venues/${v.id}`)).json()).not.toHaveProperty("hasCover");
    for(const a of [other,support]){
      const denied=await app.inject({method:"DELETE",url:`/v1/admin/venues/${v.id}/cover`,headers:headers(a),payload:{expectedVersion:2}});
      expect(denied.statusCode).toBe(a===other?404:403);
    }
    const removed=await app.inject({method:"DELETE",url:`/v1/admin/venues/${v.id}/cover`,headers:headers(),payload:{expectedVersion:access.json().version}});
    expect(removed.statusCode,removed.body).toBe(200);
    expect(removed.json()).toMatchObject({version:3,hasCover:false,cover:{uploadedUrl:null}});
    expect((await pool.query("SELECT cover_key,cover_moderation_approval_id,cover_actor_id FROM venues WHERE id=$1",[v.id])).rows[0]).toEqual({cover_key:null,cover_moderation_approval_id:null,cover_actor_id:null});
    const fresh=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover/access`,headers:headers()});
    expect(fresh.json()).toMatchObject({version:3,hasCover:false,cover:{uploadedUrl:null}});
    expect((await read(url)).statusCode).toBe(404);
  });
  it("moderation unavailable during replacement preserves the published cover, version and public projection",async()=>{
    const v=await venue(),saved=await upload(v.id);
    expect(saved.statusCode,saved.body).toBe(200);
    const previous=saved.json(),url=previous.cover.uploadedUrl;
    expect(url).toEqual(expect.any(String));
    const before=(await pool.query("SELECT version,cover_key,cover_moderation_approval_id,cover_actor_id FROM venues WHERE id=$1",[v.id])).rows[0];
    const publicBefore=(await read(`/v1/venues/${v.id}`)).json();
    expect(publicBefore.cover).toEqual({uploadedUrl:url,credit:null});
    const bytesBefore=await read(url);expect(bytesBefore.statusCode).toBe(200);
    // Distinct sanitized bytes must reach moderation rather than reuse an approval.
    const replacement=await sharp({create:{width:900,height:600,channels:3,background:"red"}}).png().toBuffer();
    const calls=fake.calls;
    fake.fixture=async()=>{throw new ModerationProviderError("unavailable");};
    try{
      const failed=await upload(v.id,previous.version,owner,randomUUID(),replacement);
      expect(failed.statusCode,failed.body).toBe(503);
      expect(failed.json().code).toBe("MODERATION_TEMPORARILY_UNAVAILABLE");
      expect(fake.calls).toBeGreaterThan(calls);
      expect((await pool.query("SELECT version,cover_key,cover_moderation_approval_id,cover_actor_id FROM venues WHERE id=$1",[v.id])).rows[0]).toEqual(before);
      const access=await app.inject({method:"GET",url:`/v1/admin/venues/${v.id}/cover`,headers:headers()});
      expect(access.statusCode,access.body).toBe(200);expect(access.json()).toEqual(previous);
      const publicAfter=await read(`/v1/venues/${v.id}`);
      expect(publicAfter.statusCode).toBe(200);expect(publicAfter.json()).toEqual(publicBefore);
      const retained=await read(url);expect(retained.statusCode).toBe(200);expect(retained.rawPayload).toEqual(bytesBefore.rawPayload);
      expect((await pool.query("SELECT count(*)::int AS n FROM venue_admin_actions WHERE venue_id=$1 AND action='cover'",[v.id])).rows[0].n).toBe(1);
    }finally{fake.fixture=async()=>safeImageDecision();}
  });
  it("keeps CAS and moderation rejection atomic; retirement hides public bytes",async()=>{
    const v=await venue();
    fake.fixture=async()=>{const d=safeImageDecision();return {...d,flagged:true,categories:{...d.categories,violence:true}};};
    // Distinct bytes must miss any prior legitimate allow-approval cache.
    const rejected=await sharp({create:{width:900,height:600,channels:3,background:"#123abc"}}).png().toBuffer();
    const callsBefore=fake.calls;
    expect((await upload(v.id,1,owner,randomUUID(),rejected)).statusCode).toBe(422);
    expect(fake.calls).toBe(callsBefore+1); // provider was really consulted
    expect((await pool.query("SELECT cover_key,version FROM venues WHERE id=$1",[v.id])).rows[0]).toEqual({cover_key:null,version:1});
    fake.fixture=async()=>safeImageDecision();await pool.query("DELETE FROM content_moderation_rate_budgets");
    const saved=await upload(v.id);expect(saved.statusCode,saved.body).toBe(200);
    expect((await upload(v.id,1)).statusCode).toBe(409);
    const malformed=await app.inject({method:"DELETE",url:`/v1/admin/venues/${v.id}/cover`,headers:headers(),payload:{expectedVersion:2,arbitraryUrl:"https://evil.invalid"}});
    expect(malformed.statusCode).toBe(400);
    const retired=await app.inject({method:"POST",url:`/v1/admin/venues/${v.id}/commands`,headers:headers(),payload:{action:"retire",expectedVersion:2,reasonCode:"synthetic_fixture"}});
    expect(retired.statusCode,retired.body).toBe(201);
    expect((await read(saved.json().cover.uploadedUrl)).statusCode).toBe(404);
    expect((await read(`/v1/venues/${v.id}`)).json().cover).toEqual({uploadedUrl:null,credit:null});
    expect((await upload(v.id,3)).statusCode).toBe(404);
  });
  it("reauthorizes replay, fences principal generation during moderation and account retirement",async()=>{
    const a=await actor("content_manager"),v=await venue();await pool.query("UPDATE venues SET created_by_user_id=$2 WHERE id=$1",[v.id,a.userId]);
    const key=randomUUID(),saved=await upload(v.id,1,a,key);expect(saved.statusCode,saved.body).toBe(200);
    await pool.query("UPDATE admin_role_grants SET active=false WHERE principal_id=$1",[a.id]);expect((await upload(v.id,1,a,key)).statusCode).toBe(403);
    await pool.query("UPDATE admin_role_grants SET active=true WHERE principal_id=$1",[a.id]);
    await pool.query("DELETE FROM content_moderation_rate_budgets");
    const fresh=await sharp({create:{width:900,height:600,channels:3,background:"blue"}}).withMetadata().png().toBuffer();
    fake.fixture=async()=>{await pool.query("UPDATE admin_principals SET version=version+1 WHERE id=$1",[a.id]);return safeImageDecision();};
    const fenceCalls=fake.calls;
    expect((await upload(v.id,2,a,randomUUID(),fresh)).statusCode).toBe(409);
    expect(fake.calls).toBe(fenceCalls+1); // fence was exercised mid-moderation
    fake.fixture=async()=>safeImageDecision();
    expect((await read(saved.json().cover.uploadedUrl)).statusCode).toBe(200);
    await pool.query("UPDATE admin_sessions SET revoked_at=now() WHERE principal_id=$1",[a.id]);expect((await upload(v.id,1,a,key)).statusCode).toBe(401);
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[a.userId]);expect((await read(saved.json().cover.uploadedUrl)).statusCode).toBe(404);
    expect((await pool.query("SELECT cover_key FROM venues WHERE id=$1",[v.id])).rows[0].cover_key).toBeNull();
  });
  async function consumer(){
    const userId=await user(),session=await app.get(SessionService).createConsumerSession(userId);
    return {userId,session,headers:{cookie:`${SESSION_COOKIE}=${session.sessionToken}`,origin:"http://127.0.0.1:19442","x-csrf-token":session.csrfToken}};
  }
  async function gameFor(v:string,a:Awaited<ReturnType<typeof consumer>>,visibility:"public"|"unlisted"="public"){
    const starts=new Date(Date.now()+2*86400000);
    const response=await app.inject({method:"POST",url:"/v1/games",headers:{...a.headers,"idempotency-key":randomUUID()},payload:{hostDisplayName:"Synthetic game host",hostPublicContact:"Synthetic contact",venueId:v,startsAt:starts.toISOString(),endsAt:new Date(+starts+3600000).toISOString(),timezone:"Europe/Moscow",applicationDeadlineAt:starts.toISOString(),capacity:4,externalReservedCount:0,visibility,formatKey:"doubles",activityKind:"regular",levelRule:{scaleId:"test",scaleVersion:1,allowedLevelIds:["test"]},settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,terms:"Synthetic"}}});
    expect(response.statusCode,response.body).toBe(201);return response.json() as {id:string;version:number};
  }
  function gameUpload(id:string,version:number,a:Awaited<ReturnType<typeof consumer>>,key=randomUUID(),body=png){
    return app.inject({method:"PUT",url:`/v1/games/${id}/cover`,headers:{...a.headers,"idempotency-key":key,"x-game-version":String(version),"content-type":"image/png"},payload:body});
  }
  it("Issue47 ordinary organizers: own > current exact venue > default, independent games, removal, public projections",async()=>{
    const a=await consumer(),v=await venue(),g=await gameFor(v.id,a),inheritor=await gameFor(v.id,a);
    const first=await upload(v.id);expect(first.statusCode,first.body).toBe(200);const venueUrl=first.json().cover.uploadedUrl;
    expect((await app.get(GamesService).getGame(g.id,a.userId)).cover).toEqual({uploadedUrl:venueUrl});
    const key=randomUUID(),saved=await gameUpload(g.id,g.version,a,key);expect(saved.statusCode,saved.body).toBe(200);
    const ownUrl=saved.json().cover.uploadedUrl;expect(ownUrl).toMatch(/^\/v1\/media\/game-covers\/[a-f0-9]{64}\.png$/);
    // Draft confidentiality and no cross-surface key promotion.
    expect((await read(ownUrl)).statusCode).toBe(404);
    expect((await app.inject({method:"GET",url:ownUrl,headers:a.headers})).statusCode).toBe(200);
    const suffix=ownUrl.split("/").at(-1);
    for(const route of ["venue-covers","covers"])expect((await read(`/v1/media/${route}/${suffix}`)).statusCode).toBe(404);
    const calls=fake.calls;expect((await gameUpload(g.id,g.version,a,key)).statusCode).toBe(200);expect(fake.calls).toBe(calls);
    const service=app.get(GamesService);
    await service.publish(a.userId,a.session.session.id,g.id,randomUUID(),saved.json().version);
    await service.publish(a.userId,a.session.session.id,inheritor.id,randomUUID(),inheritor.version);
    const image=await read(ownUrl);expect(image.statusCode,image.body).toBe(200);expect(image.headers["cache-control"]).toBe("no-store");expect(image.headers.vary).toBe("Cookie");
    const meta=await sharp(image.rawPayload).metadata();expect(meta).toMatchObject({format:"png",width:1200,height:400});expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();
    const changed=await upload(v.id,2);expect(changed.statusCode,changed.body).toBe(200);const current=changed.json().cover.uploadedUrl;
    async function projections(id:string,expected:string|null){
      expect((await read(`/v1/games/${id}`)).json().cover).toEqual({uploadedUrl:expected});
      const list=(await read(`/v1/games?venueId=${v.id}`)).json().items;expect(list.find((x:{id:string})=>x.id===id).cover).toEqual({uploadedUrl:expected});
      const mine=(await app.inject({method:"GET",url:"/v1/me/games",headers:a.headers})).json().items;expect(mine.find((x:{id:string})=>x.id===id).cover).toEqual({uploadedUrl:expected});
      const map=(await read(`/v1/games/map?cityId=${cityId}&temporalScope=upcoming&venueId=${v.id}`)).json();
      expect(map.items.flatMap((x:{games:unknown[]})=>x.games).find((x:{id:string})=>x.id===id).cover).toEqual({uploadedUrl:expected});
    }
    await projections(g.id,ownUrl);await projections(inheritor.id,current);
    const currentGame=await service.getGame(g.id,a.userId);
    const removed=await app.inject({method:"DELETE",url:`/v1/games/${g.id}/cover`,headers:{...a.headers,"idempotency-key":randomUUID(),"x-game-version":String(currentGame.version)},payload:{expectedVersion:currentGame.version}});
    expect(removed.statusCode,removed.body).toBe(200);await projections(g.id,current);expect((await read(ownUrl)).statusCode).toBe(404);
    await pool.query("UPDATE content_moderation_approvals SET decision='review' WHERE id=(SELECT cover_moderation_approval_id FROM venues WHERE id=$1)",[v.id]);
    await projections(g.id,null);await projections(inheritor.id,null);expect((await read(current)).statusCode).toBe(404);
  });
  it("Issue47 auth/CSRF/foreign/private/moderation/CAS/replay/actor fences and concurrent replacement",async()=>{
    const a=await consumer(),foreign=await consumer(),v=await venue(),g=await gameFor(v.id,a,"unlisted");
    const initialCalls=fake.calls;
    expect((await gameUpload(g.id,1,foreign)).statusCode).toBe(404);
    for(const patch of [{cookie:""},{"x-csrf-token":""},{origin:"https://evil.invalid"}])expect((await app.inject({method:"PUT",url:`/v1/games/${g.id}/cover`,headers:{...a.headers,...patch,"content-type":"image/png","idempotency-key":randomUUID(),"x-game-version":"1"},payload:png})).statusCode).toBeGreaterThanOrEqual(400);
    expect(fake.calls).toBe(initialCalls);
    for(const bytes of [Buffer.from("<svg/>"),Buffer.concat([png,Buffer.from("trailing")])])expect((await gameUpload(g.id,1,a,randomUUID(),bytes)).statusCode).toBeGreaterThanOrEqual(400);
    const fresh=await sharp({create:{width:900,height:600,channels:3,background:"orange"}}).png().toBuffer();
    fake.fixture=async()=>{const d=safeImageDecision();return {...d,flagged:true,categories:{...d.categories,violence:true}};};
    expect((await gameUpload(g.id,1,a,randomUUID(),fresh)).statusCode).toBe(422);
    expect((await pool.query("SELECT cover_key,version FROM games WHERE id=$1",[g.id])).rows[0]).toEqual({cover_key:null,version:1});
    fake.fixture=async()=>safeImageDecision();
    const key=randomUUID(),saved=await gameUpload(g.id,1,a,key);expect(saved.statusCode,saved.body).toBe(200);const url=saved.json().cover.uploadedUrl;
    await app.get(GamesService).publish(a.userId,a.session.session.id,g.id,randomUUID(),2);
    expect((await read(url)).statusCode).toBe(404);expect((await app.inject({method:"GET",url,headers:foreign.headers})).statusCode).toBe(404);
    const racers=await Promise.all([gameUpload(g.id,3,a),gameUpload(g.id,3,a)]);expect(racers.map(x=>x.statusCode).sort()).toEqual([200,409]);
    expect((await app.inject({method:"GET",url,headers:a.headers})).statusCode).toBe(404);
    await pool.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2",[g.id,a.userId]);
    expect((await gameUpload(g.id,1,a,key)).statusCode).toBe(403);
    await pool.query("UPDATE game_managers SET status='active' WHERE game_id=$1 AND user_id=$2",[g.id,a.userId]);
    fake.fixture=async()=>{await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[a.session.session.id]);return safeImageDecision();};
    const unique=await sharp({create:{width:900,height:600,channels:3,background:"purple"}}).png().toBuffer();
    expect((await gameUpload(g.id,4,a,randomUUID(),unique)).statusCode).toBe(401);
    expect((await pool.query("SELECT version FROM games WHERE id=$1",[g.id])).rows[0].version).toBe(4);
  });

  it("Issue47 retains hidden own slots for removal, shares moderation budgets, retires account media and rejects malformed delete",async()=>{
    const a=await consumer(),v=await venue(),g=await gameFor(v.id,a);
    const venueImage=await upload(v.id);expect(venueImage.statusCode).toBe(200);
    const photo=await sharp({create:{width:900,height:600,channels:3,background:"yellow"}}).withMetadata().png().toBuffer();
    const saved=await gameUpload(g.id,1,a,randomUUID(),photo);expect(saved.statusCode,saved.body).toBe(200);const ownUrl=saved.json().cover.uploadedUrl;
    await pool.query("UPDATE content_moderation_approvals SET decision='review' WHERE id=(SELECT cover_moderation_approval_id FROM games WHERE id=$1)",[g.id]);
    expect((await app.inject({method:"GET",url:ownUrl,headers:a.headers})).statusCode).toBe(404);
    const access=await app.inject({method:"GET",url:`/v1/games/${g.id}/cover`,headers:a.headers});expect(access.json()).toMatchObject({hasCover:true,cover:venueImage.json().cover});
    for(const payload of [{},{expectedVersion:1.5},{expectedVersion:2,arbitraryUrl:"https://evil.invalid"},{expectedVersion:3}]){
      const r=await app.inject({method:"DELETE",url:`/v1/games/${g.id}/cover`,headers:{...a.headers,"idempotency-key":randomUUID(),"x-game-version":"2"},payload});expect(r.statusCode).toBe(400);
    }
    const removed=await app.inject({method:"DELETE",url:`/v1/games/${g.id}/cover`,headers:{...a.headers,"idempotency-key":randomUUID(),"x-game-version":"2"},payload:{expectedVersion:2}});expect(removed.statusCode,removed.body).toBe(200);expect(removed.json()).toMatchObject({hasCover:false,cover:venueImage.json().cover});
    await pool.query("INSERT INTO content_moderation_rate_budgets(user_id,bucket,window_started_at,count,day_started_at,day_count) VALUES($1,'image',now(),10,now(),50) ON CONFLICT(user_id,bucket) DO UPDATE SET count=10,day_count=50",[a.userId]);
    const fresh=await sharp({create:{width:900,height:600,channels:3,background:"pink"}}).png().toBuffer();
    expect((await gameUpload(g.id,3,a,randomUUID(),fresh)).statusCode).toBe(429);
    await pool.query("DELETE FROM content_moderation_rate_budgets WHERE user_id=$1",[a.userId]);
    const next=await gameUpload(g.id,3,a,randomUUID(),fresh);expect(next.statusCode,next.body).toBe(200);
    const storageKey=next.json().cover.uploadedUrl.split("/").at(-1);
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[a.userId]);
    expect((await read(next.json().cover.uploadedUrl)).statusCode).toBe(404);
    expect((await pool.query("SELECT cover_key FROM games WHERE id=$1",[g.id])).rows[0].cover_key).toBeNull();
    expect((await pool.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1",[storageKey])).rowCount).toBe(1);
  });

  it("Issue47 additive 0035 upgrade preserves games; unused rollback refuses populated slots",async()=>{
    const a=await consumer(),v=await venue(),g=await gameFor(v.id,a);
    const saved=await gameUpload(g.id,1,a);expect(saved.statusCode,saved.body).toBe(200);
    const migration=await readFile(path.resolve(__dirname,"../../migrations/0035_game_cover.sql"),"utf8");
    const rollback=await readFile(path.resolve(__dirname,"../../migrations/rollback/0035_game_cover.sql"),"utf8");
    const c=await pool.connect();
    try {
      await c.query("BEGIN");await expect(c.query(rollback)).rejects.toThrow("refuses populated");await c.query("ROLLBACK");
      await c.query("BEGIN");
      const before=(await c.query("SELECT id,version,status,venue_id,created_by_user_id FROM games ORDER BY id")).rows;
      await c.query("UPDATE games SET cover_key=NULL,cover_moderation_approval_id=NULL,cover_actor_id=NULL");
      await c.query(rollback);await c.query(migration);
      expect((await c.query("SELECT id,version,status,venue_id,created_by_user_id FROM games ORDER BY id")).rows).toEqual(before);
      expect((await c.query("SELECT game_effective_cover_url($1) AS url",[g.id])).rows[0].url).toBeNull();
      await c.query("ROLLBACK");
    } finally {await c.query("ROLLBACK");c.release();}
  });

});
