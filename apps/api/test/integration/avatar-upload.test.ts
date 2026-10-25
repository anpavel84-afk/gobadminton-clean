import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { AvatarService } from "../../src/profiles/avatar.service";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("owned avatar integration", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let png: Buffer;
  let headers: Record<string,string>;
  let other: Record<string,string>;
  const userId = randomUUID();
  const otherId = randomUUID();
  let version = 0;
  let url: string;
  const media = path.resolve(__dirname, '../../../../.qa-runtime/avatar-it-media');
  const env = loadEnv({ ...process.env, NODE_ENV:"test", APP_ENV:"local", PUBLIC_API_ORIGIN:"http://127.0.0.1:3000", PUBLIC_WEB_ORIGIN:"http://127.0.0.1:3001", SOCIAL_DIRECTORY_ENABLED:"1", AVATAR_MEDIA_ROOT:media });
  async function start() {
    const module = await Test.createTestingModule({imports:[buildTestCoreModule(env,pool), AuthModule, ProfilesModule]}).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    registerAvatarHttp(app.getHttpAdapter().getInstance());
    await app.register(cookie); app.setGlobalPrefix("v1"); app.useGlobalFilters(new ProblemExceptionFilter()); await app.init(); await app.getHttpAdapter().getInstance().ready();
  }
  const upload = (payload: Buffer = png, overrides: Record<string,string> = {}) => app.inject({method:"PUT",url:"/v1/me/avatar",headers:{...headers,"idempotency-key":randomUUID(),"x-profile-version":String(version),...overrides},payload});
  beforeAll(async () => {
    execFileSync('pnpm',['exec','tsx','src/database/migrate.ts'],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,PUBLIC_API_ORIGIN:env.PUBLIC_API_ORIGIN},stdio:'inherit'});
    pool = new Pool({connectionString:env.DATABASE_URL});
    await pool.query("INSERT INTO users(id,display_name) VALUES ($1,'Avatar One'),($2,'Avatar Two')",[userId,otherId]);
    await pool.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,avatar_url) VALUES ($1::uuid,'yandex','avatar-test',$1::text,'https://avatars.yandex.net/test')",[userId]);
    await mkdir(media,{recursive:true});
    await start();
    const session = await app.get(SessionService).createConsumerSession(userId);
    const second = await app.get(SessionService).createConsumerSession(otherId);
    headers={cookie:`${SESSION_COOKIE}=${session.sessionToken}`,origin:env.PUBLIC_WEB_ORIGIN,"x-csrf-token":session.csrfToken,"content-type":"image/png"};
    other={...headers,cookie:`${SESSION_COOKIE}=${second.sessionToken}`,"x-csrf-token":second.csrfToken};
    png=await sharp(randomBytes(800*800*3),{raw:{width:800,height:800,channels:3}}).withMetadata({orientation:6}).png().toBuffer();
    expect(png.length).toBeGreaterThan(1024*1024);
  });
  afterAll(async()=>{await app?.close();if(pool){await pool.query('DELETE FROM idempotency_records WHERE actor_id=ANY($1::uuid[])',[[userId,otherId]]);for (const table of ['external_identities','app_sessions','player_social_profiles']) await pool.query(`DELETE FROM ${table} WHERE user_id = ANY($1::uuid[])`,[[userId,otherId]]);await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])',[[userId,otherId]]);await pool.end();}});
  it("auth/CSRF and Origin fence every mutation",async()=>{
    expect((await upload(png,{cookie:""})).statusCode).toBe(401);
    expect((await upload(png,{"x-csrf-token":""})).statusCode).toBe(403);
    expect((await upload(png,{"x-csrf-token":"wrong"})).statusCode).toBe(403);
    expect((await upload(png,{origin:"https://evil.invalid"})).statusCode).toBe(403);
    expect((await app.inject({method:'DELETE',url:'/v1/me/avatar',headers:{...headers,'idempotency-key':randomUUID(),'x-csrf-token':''}})).statusCode).toBe(403);
    expect((await app.inject({method:'DELETE',url:'/v1/me/avatar',headers:{...headers,'idempotency-key':randomUUID(),'x-csrf-token':'wrong'}})).statusCode).toBe(403);
  });
  it("requires a 16–128 character key on both commands",async()=>{
    for(const method of ["PUT","DELETE"] as const){
      for(const key of [undefined,"", "x".repeat(15), "x".repeat(129)]){
        const requestHeaders={...headers,"x-profile-version":"0",...(key===undefined?{}:{"idempotency-key":key})};
        const response=await app.inject({method,url:"/v1/me/avatar",headers:requestHeaders,...(method==="PUT"?{payload:png}:{})});
        expect(response.statusCode,response.body).toBe(400);expect(response.json().code).toBe("IDEMPOTENCY_KEY_INVALID");
      }
    }
    expect((await pool.query("SELECT 1 FROM idempotency_records WHERE actor_id=$1",[userId])).rowCount).toBe(0);
  });
  it("reject matrix is bounded and leaves DB unchanged",async()=>{
    expect((await upload(png,{'content-type':'image/jpeg'})).statusCode).toBe(415);
    expect((await upload(Buffer.from('<svg/>'))).statusCode).toBe(415);
    expect((await upload(Buffer.from('<html/>'),{'content-type':'text/html'})).statusCode).toBe(415);
    expect((await upload(png.subarray(0,30))).statusCode).toBe(422);
    expect((await upload(Buffer.alloc(5*1024*1024+1))).statusCode).toBe(413);
    expect((await upload(png,{'x-profile-version':'NaN'})).statusCode).toBe(400);
    expect((await pool.query('SELECT * FROM player_social_profiles WHERE user_id=$1',[userId])).rowCount).toBe(0);
  });
  it("upload strips metadata and exposes only sanitized current derivative",async()=>{
    const r=await upload(); expect(r.statusCode,r.body).toBe(200);const body=r.json();version=body.version;url=body.avatar.uploadedUrl;
    expect(body.avatar.providerUrl).toBe('https://avatars.yandex.net/test');
    expect(url).toMatch(/^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/);
    const read=await app.inject({method:'GET',url});expect(read.statusCode).toBe(200);expect(read.headers['x-content-type-options']).toBe('nosniff');expect(read.headers['cache-control']).toBe('no-store');
    const meta=await sharp(read.rawPayload).metadata();expect(meta).toMatchObject({width:512,height:512,format:'png'});expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();
    const own=await app.inject({method:'GET',url:'/v1/me/social-profile',headers});expect(own.json().avatar.uploadedUrl).toBe(url);
    await pool.query("UPDATE player_social_profiles SET directory_visible=true, city_id=(SELECT id FROM cities LIMIT 1),consent_policy_version='directory-mvp-v1',opted_in_at=now() WHERE user_id=$1",[userId]);
    const id=(await pool.query('SELECT public_player_id FROM player_social_profiles WHERE user_id=$1',[userId])).rows[0].public_player_id;
    expect((await app.inject({method:'GET',url:`/v1/players/${id}`})).json().avatar.uploadedUrl).toBe(url);
    expect((await app.inject({method:'GET',url:'/v1/players'})).json().items.find((x:{publicPlayerId:string})=>x.publicPlayerId===id).avatar.uploadedUrl).toBe(url);
  });
  it("WebP/JPEG derivatives keep legacy PNG keys/MIME and GC never deletes an owned key", async () => {
    for (const format of ["webp", "jpeg"] as const) {
      const derivative = await sharp({create:{width:512,height:512,channels:3,background:"#638122"}}).withMetadata({orientation:6}).toFormat(format).toBuffer();
      const previous = url;
      const response = await upload(derivative, {"content-type":`image/${format}`});
      expect(response.statusCode,response.body).toBe(200);
      const receipt = response.json(); version = receipt.version; url = receipt.avatar.uploadedUrl;
      expect(url).toMatch(/^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/);
      const read = await app.inject({method:"GET",url});
      expect(read.headers["content-type"]).toBe("image/png");
      const metadata = await sharp(read.rawPayload).metadata();
      expect(metadata).toMatchObject({width:512,height:512,format:"png"});
      expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
      expect((await app.inject({method:"GET",url:previous})).statusCode).toBe(404);
      const key = url.split("/").pop()!;
      await pool.query("INSERT INTO avatar_media_gc(storage_key,not_before) VALUES ($1,now()-interval '1 minute') ON CONFLICT(storage_key) DO UPDATE SET not_before=excluded.not_before",[key]);
      await app.get(AvatarService).cleanup();
      expect((await app.inject({method:"GET",url})).statusCode).toBe(200);
      expect(await readdir(media)).toContain(key);
    }
  });
  it("survives API application recreation on the same durable directory",async()=>{
    const before=await readFile(path.join(media,url.split('/').pop()!));
    await app.close();await start();
    const read=await app.inject({method:'GET',url});expect(read.statusCode).toBe(200);expect(read.rawPayload.equals(before)).toBe(true);
  });
  it("version race commits one replacement; other actor never writes target",async()=>{
    const old=url;
    const results=await Promise.all([upload(),upload()]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
    const winner=results.find(r=>r.statusCode===200)!.json();version=winner.version;url=winner.avatar.uploadedUrl;
    expect((await app.inject({method:'GET',url:old})).statusCode).toBe(404);
    expect(await readdir(media)).not.toContain(old.split('/').pop());
    const r=await app.inject({method:'DELETE',url:'/v1/me/avatar',headers:{...other,'idempotency-key':randomUUID(),'x-profile-version':'0'}});expect(r.statusCode).toBe(200);
    expect((await app.inject({method:'GET',url})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:`/v1/players/${userId}/avatar`,headers,payload:png.subarray(0,100)})).statusCode).toBe(404);
  });
  it("remove restores provider and retires owned bytes",async()=>{
    const r=await app.inject({method:'DELETE',url:'/v1/me/avatar',headers:{...headers,'idempotency-key':randomUUID(),'x-profile-version':String(version)}});expect(r.statusCode).toBe(200);version=r.json().version;
    expect(r.json().avatar).toEqual({uploadedUrl:null,providerUrl:'https://avatars.yandex.net/test'});expect((await app.inject({method:'GET',url})).statusCode).toBe(404);
    expect(await readdir(media)).not.toContain(url.split('/').pop());
  });
  it("revoked session rejected, missing file honest 404, account deletion transition queues cleanup",async()=>{
    const r=await upload();expect(r.statusCode,r.body).toBe(200);url=r.json().avatar.uploadedUrl;version=r.json().version;
    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE user_id=$1",[userId]);expect((await upload()).statusCode).toBe(401);
    expect((await app.inject({method:'GET',url:'/v1/media/avatars/'+ '0'.repeat(64)+'.png'})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:'/v1/media/avatars/..%2Fsecrets'})).statusCode).toBe(404);
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1",[userId]);
    expect((await pool.query('SELECT 1 FROM avatar_media_gc WHERE storage_key=$1',[url.split('/').pop()])).rowCount).toBe(1);
    await app.get(AvatarService).cleanup();expect(await readdir(media)).not.toContain(url.split('/').pop());expect((await app.inject({method:'GET',url})).statusCode).toBe(404);
  });
  it("explicit profile deletion journals cleanup without enabling account deletion product", async () => {
    const r = await app.inject({method:'PUT',url:'/v1/me/avatar',headers:{...other,'idempotency-key':randomUUID(),'x-profile-version':'1'},payload:png});
    expect(r.statusCode,r.body).toBe(200);
    const oldUrl = r.json().avatar.uploadedUrl;
    await pool.query('DELETE FROM player_social_profiles WHERE user_id=$1',[otherId]);
    await app.get(AvatarService).cleanup();
    expect((await app.inject({method:'GET',url:oldUrl})).statusCode).toBe(404);
    expect(await readdir(media)).not.toContain(oldUrl.split('/').pop());
  });

});
