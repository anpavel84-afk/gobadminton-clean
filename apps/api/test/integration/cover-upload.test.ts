import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { MODERATION_PROVIDER, safeImageDecision } from "../../src/moderation/provider";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("owned cover: disposable PostGIS API", () => {
  let app: NestFastifyApplication, pool: Pool, media: string, png: Buffer;
  let own: Record<string,string>, other: Record<string,string>;
  const user = randomUUID(), viewer = randomUUID();
  let version = 0, url = "";
  const env = loadEnv({ ...process.env, NODE_ENV:"test", APP_ENV:"local", PUBLIC_API_ORIGIN:"http://127.0.0.1:3000", PUBLIC_WEB_ORIGIN:"http://127.0.0.1:3001", SOCIAL_DIRECTORY_ENABLED:"1", CONTENT_MODERATION_PROVIDER:"fake", CONTENT_MODERATION_FINGERPRINT_SECRET:"synthetic-cover-test-fingerprint-secret" });
  const fake = new FakeModerationProvider(env);
  const upload = (v=version, key=randomUUID(), bytes=png, headers=own) => app.inject({method:"PUT",url:"/v1/me/cover",headers:{...headers,"idempotency-key":key,"x-profile-version":String(v)},payload:bytes});
  const read = (headers:Record<string,string>={}) => app.inject({method:"GET",url,headers});
  beforeAll(async () => {
    if (!["127.0.0.1","localhost","[::1]"].includes(new URL(env.DATABASE_URL).hostname)) throw new Error("Disposable loopback PostGIS required");
    execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:{...process.env,NODE_ENV:"test",PUBLIC_API_ORIGIN:env.PUBLIC_API_ORIGIN},stdio:"inherit"});
    pool = new Pool({connectionString:env.DATABASE_URL});
    await pool.query("INSERT INTO users(id,display_name) VALUES ($1,'Synthetic cover owner'),($2,'Synthetic cover viewer')",[user,viewer]);
    const root=path.resolve(__dirname,"../../.qa-runtime");await mkdir(root,{recursive:true});media=await mkdtemp(path.join(root,"cover-"));env.AVATAR_MEDIA_ROOT=media;
    const module=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AuthModule,ProfilesModule]}).overrideProvider(MODERATION_PROVIDER).useValue(fake).compile();
    app=module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));registerAvatarHttp(app.getHttpAdapter().getInstance());await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
    const a=await app.get(SessionService).createConsumerSession(user), b=await app.get(SessionService).createConsumerSession(viewer);
    own={cookie:`${SESSION_COOKIE}=${a.sessionToken}`,origin:env.PUBLIC_WEB_ORIGIN,"x-csrf-token":a.csrfToken,"content-type":"image/png"};other={...own,cookie:`${SESSION_COOKIE}=${b.sessionToken}`,"x-csrf-token":b.csrfToken};
    png=await sharp({create:{width:600,height:400,channels:3,background:"green"}}).withMetadata().png().toBuffer();
  });
  afterAll(async()=>{
    await app?.close();if(pool){await pool.query("DELETE FROM user_blocks WHERE blocker_user_id=ANY($1::uuid[]) OR blocked_user_id=ANY($1::uuid[])",[[user,viewer]]);await pool.query("DELETE FROM idempotency_records WHERE actor_id=ANY($1::uuid[])",[[user,viewer]]);await pool.query("DELETE FROM app_sessions WHERE user_id=ANY($1::uuid[])",[[user,viewer]]);await pool.query("DELETE FROM player_social_profiles WHERE user_id=ANY($1::uuid[])",[[user,viewer]]);await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[[user,viewer]]);await pool.end();}if(media)await rm(media,{recursive:true,force:true});
  });
  it("requires authentication, CSRF and origin before decoding",async()=>{
    for(const patch of [{cookie:""},{"x-csrf-token":""},{origin:"https://evil.invalid"}])expect((await upload(0,randomUUID(),png,{...own,...patch})).statusCode).toBe(patch.cookie===""?401:403);
    expect((await app.inject({method:"GET",url:"/v1/me/cover"})).statusCode).toBe(401);
  });
  it("publishes only a moderated derivative; hidden cover is owner-only",async()=>{
    const r=await upload();expect(r.statusCode,r.body).toBe(200);version=r.json().version;url=r.json().cover.uploadedUrl;
    expect(url).toMatch(/^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/);
    expect((await read()).statusCode).toBe(404);expect((await read(other)).statusCode).toBe(404);
    const image=await read(own);expect(image.statusCode).toBe(200);expect(image.headers["cache-control"]).toBe("no-store");expect(image.headers.vary).toBe("Cookie");
    const meta=await sharp(image.rawPayload).metadata();expect(meta).toMatchObject({width:1200,height:400,format:"png"});expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();
    expect((await app.inject({method:"GET",url:"/v1/me/cover",headers:own})).json()).toEqual({version,cover:{uploadedUrl:url}});
    const approval=await pool.query("SELECT a.surface_key,a.decision FROM player_social_profiles p JOIN content_moderation_approvals a ON a.id=p.cover_moderation_approval_id WHERE p.user_id=$1",[user]);expect(approval.rows[0]).toEqual({surface_key:"cover_image",decision:"allow"});
  });
  it("replays original upload, rejects key reuse and invalidates replaced bytes",async()=>{
    const key=randomUUID(), expected=version;
    const r=await upload(expected,key);expect(r.statusCode,r.body).toBe(200);const old=url;version=r.json().version;url=r.json().cover.uploadedUrl;
    expect((await app.inject({method:"GET",url:old,headers:own})).statusCode).toBe(404);
    const calls=fake.calls;expect((await upload(expected,key)).json()).toEqual(r.json());expect(fake.calls).toBe(calls);
    expect((await upload(version,key)).statusCode).toBe(409);
    const del=await app.inject({method:"DELETE",url:"/v1/me/cover",headers:{...own,"content-type":"application/json","idempotency-key":key,"x-profile-version":String(expected)},payload:{expectedVersion:expected}});expect(del.statusCode).toBe(409);
  });
  it("public visibility and bilateral block are checked for each media read",async()=>{
    await pool.query("UPDATE player_social_profiles SET directory_visible=true,city_id=(SELECT id FROM cities LIMIT 1),consent_policy_version='directory-mvp-v1',opted_in_at=now() WHERE user_id=$1",[user]);
    expect((await read()).statusCode).toBe(200);expect((await read(other)).statusCode).toBe(200);
    await pool.query("INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES ($1,$2)",[viewer,user]);expect((await read(other)).statusCode).toBe(404);expect((await read(own)).statusCode).toBe(200);
    await pool.query("DELETE FROM user_blocks WHERE blocker_user_id=$1",[viewer]);
    await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[user]);expect((await read()).statusCode).toBe(404);
  });
  it("rejected moderation preserves current bytes, CAS fences races and other users",async()=>{
    fake.fixture=async()=>({...safeImageDecision(),flagged:true,categories:{...safeImageDecision().categories,violence:true}});
    const changed=await sharp(png).negate().png().toBuffer();expect((await upload(version,randomUUID(),changed)).statusCode).toBe(422);expect((await read(own)).statusCode).toBe(200);fake.fixture=async()=>safeImageDecision();
    const race=await Promise.all([upload(),upload()]);expect(race.map(r=>r.statusCode).sort()).toEqual([200,409]);const winner=race.find(r=>r.statusCode===200)!.json();version=winner.version;url=winner.cover.uploadedUrl;
    const чужой=await app.inject({method:"DELETE",url:"/v1/me/cover",headers:{...other,"content-type":"application/json","idempotency-key":randomUUID(),"x-profile-version":"0"},payload:{expectedVersion:0}});expect(чужой.statusCode).toBe(200);expect((await read(own)).statusCode).toBe(200);
    expect((await app.inject({method:"PUT",url:`/v1/players/${user}/cover`,headers:other,payload:png})).statusCode).toBe(404);
  });
  it("shared moderation budget rejects new bytes without changing the current cover",async()=>{
    await pool.query("UPDATE content_moderation_rate_budgets SET count=10,day_count=50 WHERE user_id=$1",[user]);
    const fresh=await sharp({create:{width:600,height:400,channels:3,background:"blue"}}).png().toBuffer();
    expect((await upload(version,randomUUID(),fresh)).statusCode).toBe(429);
    expect((await read(own)).statusCode).toBe(200);
    await pool.query("UPDATE content_moderation_rate_budgets SET count=0,day_count=0 WHERE user_id=$1",[user]);
  });
  it("revocation during external moderation fences publication and subsequent replay",async()=>{
    const session=await app.get(SessionService).createConsumerSession(user);
    const isolated={...own,cookie:`${SESSION_COOKIE}=${session.sessionToken}`,"x-csrf-token":session.csrfToken};
    fake.fixture=async()=>{await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[session.session.id]);return safeImageDecision();};
    const fresh=await sharp({create:{width:600,height:400,channels:3,background:"purple"}}).png().toBuffer();
    const key=randomUUID();expect((await upload(version,key,fresh,isolated)).statusCode).toBe(401);
    expect((await upload(version,key,fresh,isolated)).statusCode).toBe(401);
    expect((await read(own)).statusCode).toBe(200);fake.fixture=async()=>safeImageDecision();
  });
  it("rejects absent, malformed and disagreeing DELETE commands without changing DB or media",async()=>{
    const before=await pool.query("SELECT version,cover_key FROM player_social_profiles WHERE user_id=$1",[user]);
    for(const payload of [undefined,{}, {expectedVersion:-1},{expectedVersion:1.5},{expectedVersion:"0"},{expectedVersion:2147483648},{expectedVersion:version+1},{expectedVersion:version,extra:true}]){
      const response=await app.inject({method:"DELETE",url:"/v1/me/cover",headers:{...own,"content-type":"application/json","idempotency-key":randomUUID(),"x-profile-version":String(version)},...(payload===undefined?{}:{payload})});
      expect(response.statusCode,response.body).toBe(400);
    }
    expect((await pool.query("SELECT version,cover_key FROM player_social_profiles WHERE user_id=$1",[user])).rows).toEqual(before.rows);
    expect((await read(own)).statusCode).toBe(200);
  });
  it("deletes to default, rejects stale URL, and account retirement revokes the current URL",async()=>{
    const expected=version,key=randomUUID();
    const remove=(v:number,replayKey=key)=>app.inject({method:"DELETE",url:"/v1/me/cover",headers:{...own,"content-type":"application/json","idempotency-key":replayKey,"x-profile-version":String(v)},payload:{expectedVersion:v}});
    const r=await remove(expected);expect(r.statusCode,r.body).toBe(200);version=r.json().version;expect(r.json().cover.uploadedUrl).toBeNull();expect((await read(own)).statusCode).toBe(404);
    expect((await remove(expected)).json()).toEqual(r.json());
    expect((await remove(version)).statusCode).toBe(409);
    expect((await remove(expected,randomUUID())).statusCode).toBe(409);
    const next=await upload();expect(next.statusCode,next.body).toBe(200);url=next.json().cover.uploadedUrl;
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[user]);expect((await read()).statusCode).toBe(404);
    expect((await pool.query("SELECT cover_key FROM player_social_profiles WHERE user_id=$1",[user])).rows[0].cover_key).toBeNull();
  });
});
