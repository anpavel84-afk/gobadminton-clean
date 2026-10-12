import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { ContentModerationService } from "../../src/moderation/moderation.service";
import { MODERATION_PROVIDER, ModerationProviderError, safeImageDecision, type ImageDecision } from "../../src/moderation/provider";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { AvatarService } from "../../src/profiles/avatar.service";
import { avatarForUser } from "../../src/profiles/avatar-presentation";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { buildTestCoreModule } from "./test-core.module";

const run=process.env.RUN_DB_INTEGRATION==="1" ? describe : describe.skip;
run("M1 direct avatar prepublication",()=>{
  let app:NestFastifyApplication;let pool:Pool;let media:string;let userId:string;
  let headers:Record<string,string>;let second:Record<string,string>;let oldUrl:string;let version:number;let source:Buffer;
  const users:string[]=[];
  const env=loadEnv({...process.env,NODE_ENV:"test",APP_ENV:"local",PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",PUBLIC_WEB_ORIGIN:"http://127.0.0.1:3001"});
  const fake=new FakeModerationProvider(env);
  async function start(){
    const module=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AuthModule,ProfilesModule]})
      .overrideProvider(MODERATION_PROVIDER).useValue(fake).compile();
    app=module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    registerAvatarHttp(app.getHttpAdapter().getInstance());await app.register(cookie);app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
  }
  const upload=(bytes=source,v=version,h=headers)=>app.inject({method:"PUT",url:"/v1/me/avatar",headers:{...h,"x-profile-version":String(v)},payload:bytes});
  const remove=()=>app.inject({method:"DELETE",url:"/v1/me/avatar",headers:{...headers,"x-profile-version":String(version)}});
  const row=async()=>(await pool.query("SELECT avatar_key,avatar_moderation_approval_id,version FROM player_social_profiles WHERE user_id=$1",[userId])).rows[0];
  async function fresh(){return sharp(randomBytes(32*32*3),{raw:{width:32,height:32,channels:3}}).png().toBuffer();}
  beforeAll(async()=>{
    execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:{...process.env,NODE_ENV:"test",PUBLIC_API_ORIGIN:env.PUBLIC_API_ORIGIN},stdio:"inherit"});
    pool=new Pool({connectionString:env.DATABASE_URL});await mkdir(path.resolve(__dirname,"../../../../.qa-runtime"),{recursive:true});
    media=await mkdtemp(path.resolve(__dirname,"../../../../.qa-runtime/m1-avatar-"));env.AVATAR_MEDIA_ROOT=media;await start();
  });
  beforeEach(async()=>{
    userId=randomUUID();users.push(userId);await pool.query("INSERT INTO users(id,display_name) VALUES ($1,'M1 synthetic actor')",[userId]);
    const sessions=app.get(SessionService);const a=await sessions.createConsumerSession(userId);const b=await sessions.createConsumerSession(userId);
    headers={cookie:`${SESSION_COOKIE}=${a.sessionToken}`,origin:env.PUBLIC_WEB_ORIGIN,"x-csrf-token":a.csrfToken,"content-type":"image/png"};
    second={...headers,cookie:`${SESSION_COOKIE}=${b.sessionToken}`,"x-csrf-token":b.csrfToken};fake.fixture=async()=>safeImageDecision();fake.calls=0;version=0;source=await fresh();
    const initial=await upload();expect(initial.statusCode,initial.body).toBe(200);oldUrl=initial.json().avatar.uploadedUrl;version=initial.json().version;source=await fresh();fake.calls=0;
  });
  afterAll(async()=>{
    vi.restoreAllMocks();await app?.close();if(pool){await pool.query("DELETE FROM external_identities WHERE user_id=ANY($1::uuid[])",[users]);await pool.query("DELETE FROM app_sessions WHERE user_id=ANY($1::uuid[])",[users]);await pool.query("DELETE FROM player_social_profiles WHERE user_id=ANY($1::uuid[])",[users]);await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[users]);await pool.end();}if(media)await rm(media,{recursive:true,force:true});
  });
  it("only sends sanitized 512 PNG outside all actor/profile transactions and binds exact bytes",async()=>{
    source=await sharp(randomBytes(800*600*3),{raw:{width:800,height:600,channels:3}}).withMetadata().png().toBuffer();
    fake.fixture=async input=>{
      expect(input.bytes.equals(source)).toBe(false);const meta=await sharp(input.bytes).metadata();
      expect(meta).toMatchObject({format:"png",width:512,height:512});expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();expect(meta.xmp).toBeUndefined();
      const client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT",[userId]);await client.query("SELECT user_id FROM player_social_profiles WHERE user_id=$1 FOR UPDATE NOWAIT",[userId]);await client.query("ROLLBACK");}finally{client.release();}
      return safeImageDecision();
    };
    const response=await upload();expect(response.statusCode,response.body).toBe(200);expect(fake.calls).toBe(1);const current=await row();
    const bytes=await readFile(path.join(media,current.avatar_key));const approval=(await pool.query("SELECT * FROM content_moderation_approvals WHERE id=$1",[current.avatar_moderation_approval_id])).rows[0];
    expect(approval).toMatchObject({decision:"allow",surface_key:"avatar_image",provider_key:"fake",policy_version:"avatar-image-v1",fingerprint_version:1});
    expect(approval.content_fingerprint).toBe(app.get(ContentModerationService).fingerprint(bytes));expect(approval).not.toHaveProperty("category_scores");
    expect((await pool.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1",[current.avatar_key])).rowCount).toBe(0);
  });
  it("invalid MIME, animation, size and dimensions fail before provider or staging",async()=>{
    const apng=Buffer.concat([source.subarray(0,8),Buffer.from([0,0,0,8]),Buffer.from("acTL"),Buffer.alloc(12),source.subarray(8)]);
    const animation=await sharp(Buffer.from([...Array(12).fill(0),...Array(12).fill(255)]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[100,100]}).toBuffer();
    const huge=await sharp({create:{width:8193,height:1,channels:3,background:"red"}}).png().toBuffer();
    const before=await row();const files=await readdir(media);
    for(const [bytes,mime,status] of [[source,"image/jpeg",415],[apng,"image/png",422],[animation,"image/webp",422],
      [Buffer.alloc(5*1024*1024+1),"image/png",413],[source.subarray(0,30),"image/png",422],[huge,"image/png",422]] as const){
      expect((await upload(bytes,version,{...headers,"content-type":mime})).statusCode).toBe(status);
    }
    expect(fake.calls).toBe(0);expect(await row()).toEqual(before);expect(await readdir(media)).toEqual(files);
  });
  for(const category of ["sexual","violence/graphic"] as const)it(`${category} synthetic rejection preserves old public file and GC`,async()=>{
    fake.fixture=async()=>{const d=safeImageDecision();d.categories[category]=true;d.flagged=true;return d;};
    const before=await row();const files=await readdir(media);const gc=(await pool.query("SELECT * FROM avatar_media_gc ORDER BY storage_key")).rows;
    const response=await upload();expect(response.statusCode).toBe(422);expect(response.json().code).toBe("PUBLIC_IMAGE_CONTENT_REJECTED");
    expect(await row()).toEqual(before);expect(await readdir(media)).toEqual(files);expect((await pool.query("SELECT * FROM avatar_media_gc ORDER BY storage_key")).rows).toEqual(gc);
    expect((await app.inject({method:"GET",url:oldUrl})).statusCode).toBe(200);expect(response.body).not.toContain(category);
  });
  for(const kind of ["429","5xx","schema","model","unknown-flag","exception","timeout"] as const)it(`${kind} fails closed with no stage or old avatar change`,async()=>{
    fake.fixture=async input=>{
      if(kind==="timeout")return new Promise((_,reject)=>input.signal.addEventListener("abort",()=>reject(new ModerationProviderError("unavailable")),{once:true}));
      if(kind==="model")return {...safeImageDecision(),model:"unexpected"};
      if(kind==="unknown-flag")return {...safeImageDecision(),flagged:true};
      if(kind==="exception")throw new Error("PRIVATE_IMAGE BASE64 synthetic-api-key");
      throw new ModerationProviderError(kind==="schema"?"schema":"unavailable",kind==="429"?12:undefined);
    };
    const before=await row();const files=await readdir(media);const response=await upload();
    expect(response.statusCode).toBe(503);expect(response.json().code).toBe(["schema","model","unknown-flag"].includes(kind)?"MODERATION_POLICY_MISMATCH":"MODERATION_TEMPORARILY_UNAVAILABLE");
    expect(response.body).not.toMatch(/PRIVATE_IMAGE|BASE64|synthetic-api-key|categories|scores/);expect(await row()).toEqual(before);expect(await readdir(media)).toEqual(files);
  });
  it("exact cache survives restart, skips budget/provider but keeps version CAS",async()=>{
    source=await fresh();const approved=await upload();expect(approved.statusCode).toBe(200);version=approved.json().version;const count=fake.calls;
    await app.close();await start();fake.fixture=async()=>{throw new ModerationProviderError("unavailable");};
    await pool.query("UPDATE content_moderation_rate_budgets SET count=10,day_count=50 WHERE user_id=$1",[userId]);
    const cached=await upload();expect(cached.statusCode,cached.body).toBe(200);expect(fake.calls).toBe(count);
    expect((await upload()).statusCode).toBe(409);expect(fake.calls).toBe(count);
    version=cached.json().version;expect((await upload(await fresh())).statusCode).toBe(429);expect(fake.calls).toBe(count);
    expect((await remove()).statusCode).toBe(200);
  });
  it("atomic attempt budget prevents concurrent flood and resets elapsed windows",async()=>{
    await pool.query("UPDATE content_moderation_rate_budgets SET count=9,day_count=9 WHERE user_id=$1",[userId]);
    const responses=await Promise.all([upload(),upload(await fresh(),version,second)]);
    expect(responses.map(r=>r.statusCode).sort()).toEqual([200,429]);expect(fake.calls).toBe(1);
    version=responses.find(r=>r.statusCode===200)!.json().version;
    await pool.query("UPDATE content_moderation_rate_budgets SET count=1,day_count=50 WHERE user_id=$1",[userId]);
    expect((await upload(await fresh())).statusCode).toBe(429);expect(fake.calls).toBe(1);
    await pool.query("UPDATE content_moderation_rate_budgets SET window_started_at=now()-interval '16 minutes',day_started_at=now()-interval '25 hours',count=10 WHERE user_id=$1",[userId]);
    expect((await upload(await fresh())).statusCode).toBe(200);expect(fake.calls).toBe(2);
    expect((await pool.query("SELECT count,day_count FROM content_moderation_rate_budgets WHERE user_id=$1",[userId])).rows[0]).toEqual({count:1,day_count:1});
  });
  it("cache excludes old policy/model/surface/fingerprint version or rotated secret",async()=>{
    const bytes=await sharp(source).resize(512,512,{fit:"cover"}).png().toBuffer();const service=app.get(ContentModerationService);const fp=service.fingerprint(bytes);
    await pool.query(`INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at)
      VALUES ('image','avatar_image',1,$1,'old-policy','none','fake','old-model',$2,'allow',now())`,[fp,JSON.stringify(safeImageDecision().categories)]);
    const response=await upload();expect(response.statusCode).toBe(200);expect(fake.calls).toBe(1);version=response.json().version;
    const secret=env.CONTENT_MODERATION_FINGERPRINT_SECRET;env.CONTENT_MODERATION_FINGERPRINT_SECRET="synthetic-rotated-fingerprint-secret-32";
    try{expect((await upload()).statusCode).toBe(200);expect(fake.calls).toBe(2);}finally{env.CONTENT_MODERATION_FINGERPRINT_SECRET=secret;}
  });
  it("stale result after newer replacement from another session cannot overwrite; loser GC is retryable",async()=>{
    let enter!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;});let finish!:(v:ImageDecision)=>void;
    fake.fixture=async()=>{enter();return new Promise(resolve=>{finish=resolve;});};
    const stale=upload().then(r=>r);await entered;fake.fixture=async()=>safeImageDecision();
    const winner=await upload(await fresh(),version,second);expect(winner.statusCode,winner.body).toBe(200);finish(safeImageDecision());
    expect((await stale).statusCode).toBe(409);expect((await avatarForUser(pool,userId)).uploadedUrl).toBe(winner.json().avatar.uploadedUrl);
    const orphans=(await pool.query("SELECT storage_key FROM avatar_media_gc WHERE not_before>now() AND storage_key NOT IN (SELECT avatar_key FROM player_social_profiles WHERE avatar_key IS NOT NULL)")).rows;
    expect(orphans.length).toBeGreaterThan(0);for(const orphan of orphans){expect((await app.inject({method:"GET",url:`/v1/media/avatars/${orphan.storage_key}`})).statusCode).toBe(404);}
    await pool.query("UPDATE avatar_media_gc SET not_before=now()-interval '1 second'");await app.get(AvatarService).cleanup();
    for(const orphan of orphans)expect(await readdir(media)).not.toContain(orphan.storage_key);
  });
  it("removal remains available with both upload slots occupied and provider offline",async()=>{
    const finishes:Array<(v:ImageDecision)=>void>=[];let entered!:()=>void;const both=new Promise<void>(resolve=>{entered=resolve;});
    fake.fixture=async()=>new Promise(resolve=>{finishes.push(resolve);if(finishes.length===2)entered();});
    const a=upload().then(r=>r);const b=upload(await fresh(),version,second).then(r=>r);await both;
    const removed=await remove();expect(removed.statusCode,removed.body).toBe(200);expect(await row()).toMatchObject({avatar_key:null,avatar_moderation_approval_id:null});
    finishes.forEach(resolve=>resolve(safeImageDecision()));expect((await a).statusCode).toBe(409);expect((await b).statusCode).toBe(409);
  });
  it("session revocation during moderation rechecks authority and preserves old bytes",async()=>{
    fake.fixture=async()=>{await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE user_id=$1",[userId]);return safeImageDecision();};
    const before=await row();expect((await upload()).statusCode).toBe(401);expect(await row()).toEqual(before);expect((await app.inject({method:"GET",url:oldUrl})).statusCode).toBe(200);
  });
  it("profile generation change with the same numeric version rejects a stale result",async()=>{
    fake.fixture=async()=>{
      await pool.query("DELETE FROM player_social_profiles WHERE user_id=$1",[userId]);
      await pool.query("INSERT INTO player_social_profiles(user_id,display_name,version) VALUES ($1,'New generation',$2)",[userId,version]);
      return safeImageDecision();
    };
    const response=await upload();expect(response.statusCode).toBe(409);expect(await row()).toMatchObject({avatar_key:null,avatar_moderation_approval_id:null,version});
  });
  it("fingerprint recheck rejects altered staged bytes and rolls approval/publication back",async()=>{
    const service=app.get(ContentModerationService);const original=service.bindImage.bind(service);const before=await row();
    const spy=vi.spyOn(service,"bindImage").mockImplementation((client,approval,bytes)=>original(client,approval,Buffer.concat([bytes,Buffer.from("tamper")])));
    try{const response=await upload();expect(response.statusCode).toBe(503);expect(response.json().code).toBe("MODERATION_POLICY_MISMATCH");expect(await row()).toEqual(before);}finally{spy.mockRestore();}
  });
  it("ambiguous successful COMMIT never deletes a possibly published candidate",async()=>{
    const fence=app.get(ActorFenceService);const assert=fence.assertActiveConsumerInTransaction.bind(fence);
    const spy=vi.spyOn(fence,"assertActiveConsumerInTransaction").mockImplementation(async(client,input)=>{
      await assert(client,input);const query=client.query.bind(client);
      // Shim only the fenced publication client, preserving driver overloads.
      client.query=(async(text:string,values?:unknown[])=>{
        const result=await query(text,values);
        if(text==="COMMIT"){client.query=query;throw new Error("Synthetic lost commit acknowledgement");}
        return result;
      }) as typeof client.query;
    });
    try{
      const response=await upload();expect(response.statusCode).toBe(500);
      const current=await row();expect(current.version).toBe(version+1);expect(current.avatar_moderation_approval_id).not.toBeNull();
      expect((await app.inject({method:"GET",url:`/v1/media/avatars/${current.avatar_key}`})).statusCode).toBe(200);
      await app.get(AvatarService).cleanup();expect(await readdir(media)).toContain(current.avatar_key);
    }finally{spy.mockRestore();}
  });
  it("restart cleans crash journals; referenced possibly committed file remains readable",async()=>{
    const current=await row();const orphan=`${randomBytes(32).toString("hex")}.png`;
    await pool.query("INSERT INTO avatar_media_gc(storage_key,not_before) VALUES ($1,now()-interval '1 second'),($2,now()-interval '1 second')",[orphan,current.avatar_key]);
    await writeFile(path.join(media,orphan),source);await app.close();await start();await app.get(AvatarService).cleanup();
    expect(await readdir(media)).not.toContain(orphan);expect((await app.inject({method:"GET",url:oldUrl})).statusCode).toBe(200);
  });
  it("legacy and VK/Yandex fallback require no moderation; arbitrary URLs and unknown provider are denied",async()=>{
    await pool.query("UPDATE player_social_profiles SET avatar_moderation_approval_id=NULL WHERE user_id=$1",[userId]);
    expect((await row()).avatar_moderation_approval_id).toBeNull();expect((await app.inject({method:"GET",url:oldUrl})).statusCode).toBe(200);
    fake.fixture=async()=>{throw new ModerationProviderError("unavailable");};
    for(const [provider,url,expected] of [["vk","https://sun9.userapi.com/synthetic.png","https://sun9.userapi.com/synthetic.png"],
      ["yandex","https://avatars.yandex.net/synthetic.png","https://avatars.yandex.net/synthetic.png"],
      ["yandex","https://evil.invalid/avatar.png",null],["future","https://avatars.yandex.net/synthetic.png",null]] as const){
      await pool.query("DELETE FROM external_identities WHERE user_id=$1",[userId]);
      // Current schema deliberately only accepts VK/Yandex; verify future identity cannot even be registered.
      if(provider==="future") {await expect(pool.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,avatar_url) VALUES ($1::uuid,$2,'m1',$1::text,$3)",[userId,provider,url])).rejects.toThrow();continue;}
      await pool.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,avatar_url) VALUES ($1::uuid,$2,'m1',$1::text,$3)",[userId,provider,url]);
      expect((await avatarForUser(pool,userId)).providerUrl).toBe(expected);
    }
    const response=await remove();expect(response.statusCode).toBe(200);expect(fake.calls).toBe(0);
    await pool.query("DELETE FROM external_identities WHERE user_id=$1",[userId]);
  });
});
