import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { COMMENT_PHOTO_RIGHTS } from "../../src/comments/comment-photos";
import { CommentsModule } from "../../src/comments/comments.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { MODERATION_PROVIDER, ModerationProviderError, safeImageDecision } from "../../src/moderation/provider";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { AvatarService } from "../../src/profiles/avatar.service";
import { buildTestCoreModule } from "./test-core.module";

// Refuse any implicit/live database BEFORE constructing Pool. No CI fallback.
function disposableUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit empty owned disposable database required");
  const url = new URL(raw);
  if (process.env.NODE_ENV !== "test" || !["postgres:","postgresql:"].includes(url.protocol)
    || !["localhost","127.0.0.1","[::1]"].includes(url.hostname)
    || url.pathname !== "/gobadminton_comment_photos_disposable" || url.search || url.hash) {
    throw new Error("Refusing nonlocal/nonisolated/non-test database");
  }
  return raw;
}
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
type Actor = { id: string; cookie: string; csrf: string; sessionId: string };
const migrationDir = path.resolve(__dirname,"../../migrations");

run("#507 I2a owned disposable private photo foundation", () => {
  let pool: Pool, app: NestFastifyApplication, sessions: SessionService, media: AvatarService;
  let provider: FakeModerationProvider, root: string, png: Buffer, owner: Actor, other: Actor, venue: string;
  let fixtureIndex = 0;
  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({connectionString:databaseUrl,max:12,connectionTimeoutMillis:5000,application_name:"comment-photos-owned-synthetic"});
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'");
    if (tables.rowCount) throw new Error("Requires EMPTY owned disposable schema");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    for (const file of (await readdir(migrationDir)).filter(f=>f.endsWith(".sql")).sort()) {
      await pool.query(await readFile(path.join(migrationDir,file),"utf8"));
      await pool.query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]);
    }
    root = await mkdtemp(path.join(process.cwd(),".comment-photos-disposable-"));
    const env = loadEnv({NODE_ENV:"test",APP_ENV:"local",HOST:"127.0.0.1",DATABASE_URL:databaseUrl,
      PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",PUBLIC_WEB_ORIGIN:origin,COOKIE_SECURE:"false",
      AUTH_PEPPER:"comment-photos-synthetic-pepper-only",CONTENT_MODERATION_PROVIDER:"fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET:"comment-photos-synthetic-fingerprint-only",AVATAR_MEDIA_ROOT:root,
      USER_RESTRICTIONS_INTERNAL_ENABLED:"1"});
    provider = new FakeModerationProvider(env);
    const ref = await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),CommentsModule]})
      .overrideProvider(MODERATION_PROVIDER).useValue(provider).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    await app.register(cookie);
    registerAvatarHttp(app.getHttpAdapter().getInstance());
    app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();await app.getHttpAdapter().getInstance().ready();
    sessions=ref.get(SessionService);media=ref.get(AvatarService);
    png = await sharp({create:{width:900,height:600,channels:3,background:"red"}}).png().toBuffer();
  },120000);
  afterAll(async () => { await app?.close();await pool?.end();if(root) await rm(root,{recursive:true,force:true}); });
  async function actor(): Promise<Actor> {
    const id=randomUUID();await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Synthetic photo owner')",[id]);
    const session=await sessions.createConsumerSession(id);
    return {id,sessionId:session.session.id,cookie:`${SESSION_COOKIE}=${encodeURIComponent(session.sessionToken)}`,csrf:session.csrfToken};
  }
  async function newVenue(who: Actor): Promise<string> {
    const row=await pool.query<{id:string}>(`INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
      SELECT id,$1,'Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$2,'unverified',venue_normalize_v1($1),venue_normalize_v1('Synthetic address')
      FROM cities LIMIT 1 RETURNING id`,[`Photo venue ${randomUUID()}`,who.id]);
    return row.rows[0]!.id;
  }
  beforeEach(async () => {
    provider.fixture=async()=>safeImageDecision();owner=await actor();other=await actor();venue=await newVenue(owner);
    png=await sharp({create:{width:900,height:600,channels:3,background:{r:++fixtureIndex,g:20,b:30}}}).png().toBuffer();
  });
  const key=()=>`photo-${randomUUID()}`;
  const headers=(who: Actor, idem=key())=>({cookie:who.cookie,origin,"x-csrf-token":who.csrf,"idempotency-key":idem});
  function upload(who=owner,idem=key(),venueId=venue,rights=COMMENT_PHOTO_RIGHTS) {
    return app.inject({method:"POST",url:`/v1/venues/${venueId}/comment-photos`,headers:{...headers(who,idem),"content-type":"image/png","x-photo-rights":rights},payload:png});
  }
  function get(id: string,who: Actor|null=owner,content=false,conditional=false) {
    return app.inject({method:"GET",url:`/v1/me/venue-photo-submissions/${id}${content?"/content":""}`,
      headers:{...(who?{cookie:who.cookie}:{}),...(conditional?{"if-none-match":"*","if-modified-since":new Date().toUTCString()}:{})}});
  }
  function withdraw(id: string,who=owner,idem=key(),version="1") {
    return app.inject({method:"DELETE",url:`/v1/me/venue-photo-submissions/${id}`,headers:{...headers(who,idem),"x-photo-version":version}});
  }
  async function ready() {
    const response=await upload();expect(response.statusCode).toBe(201);return response.json<{id:string;previewPath:string;venueId:string}>();
  }
  async function storage(id: string) {
    return (await pool.query<{storage_key:string}>("SELECT storage_key FROM venue_photo_submissions WHERE id=$1",[id])).rows[0]!.storage_key;
  }
  // Clock travel is restricted to this owned disposable table and rolled forward only;
  // the production immutable trigger remains enabled outside this fixture helper.
  async function expire(id: string) {
    const client=await pool.connect();
    try { await client.query("BEGIN");await client.query("ALTER TABLE venue_photo_submissions DISABLE TRIGGER venue_photo_submission_guard");
      await client.query("UPDATE venue_photo_submissions SET created_at=now()-interval '2 hours',rights_declared_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1",[id]);
      await client.query("ALTER TABLE venue_photo_submissions ENABLE TRIGGER venue_photo_submission_guard");await client.query("COMMIT");
    } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
  }

  it("enforces cookie/CSRF/rights and ownership before private bytes, including conditional requests", async () => {
    const calls=provider.calls;
    expect((await upload(owner,key(),venue,"wrong-version")).statusCode).toBe(400);
    expect((await app.inject({method:"POST",url:`/v1/venues/${venue}/comment-photos`,headers:{"content-type":"image/png","x-photo-rights":COMMENT_PHOTO_RIGHTS},payload:png})).statusCode).toBe(403);
    expect(provider.calls).toBe(calls);
    const photo=await ready();
    expect(photo.previewPath).toBe(`/v1/me/venue-photo-submissions/${photo.id}/content`);
    for(const content of [false,true]) {
      expect((await get(photo.id,other,content,true)).statusCode).toBe(404);
      expect((await get(photo.id,null,content,true)).statusCode).toBe(401);
    }
    const bytes=await get(photo.id,owner,true,true);expect(bytes.statusCode).toBe(200);
    expect(bytes.headers["cache-control"]).toBe("no-store");
    expect(await sharp(bytes.rawPayload).metadata()).toMatchObject({format:"png",width:900,height:600});
    const status=await get(photo.id);expect(status.json()).not.toHaveProperty("storage_key");
    expect((await app.inject({method:"GET",url:`/v1/media/avatars/${await storage(photo.id)}`})).statusCode).toBe(404);
    expect((await app.inject({method:"GET",url:`/v1/venues/${venue}/comments`})).json().items).toEqual([]);
    const forbidden=await app.inject({method:"POST",url:`/v1/venues/${venue}/comments`,headers:headers(owner),payload:{text:"",photoIds:[photo.id]}});
    expect([400,422]).toContain(forbidden.statusCode);
    expect((await pool.query("SELECT 1 FROM venue_gallery_items WHERE storage_key=$1",[await storage(photo.id)])).rowCount).toBe(0);
  });
  it("deduplicates concurrent/retried commands, separates venue hashes and seals provider UNKNOWN", async () => {
    const idem=key();const before=provider.calls;
    const pair=await Promise.all([upload(owner,idem),upload(owner,idem)]);
    expect(pair.filter(r=>r.statusCode===201).length).toBeGreaterThanOrEqual(1);
    expect(pair.every(r=>[201,409].includes(r.statusCode))).toBe(true);
    expect(provider.calls).toBe(before+1);
    const first=pair.find(r=>r.statusCode===201)!.json();
    expect((await upload(owner,idem)).json()).toEqual(first);expect(provider.calls).toBe(before+1);
    const elsewhere=await newVenue(owner);
    expect((await upload(owner,idem,elsewhere)).statusCode).toBe(409);
    provider.fixture=async()=>{throw new ModerationProviderError("unavailable");};
    // Unique byte identity avoids legitimate allow-cache reuse.
    png=await sharp({create:{width:901,height:601,channels:3,background:"blue"}}).png().toBuffer();
    const unknown=key();const fail=await upload(owner,unknown);expect(fail.statusCode).toBe(503);
    const attempts=provider.calls;expect((await upload(owner,unknown)).statusCode).toBe(503);expect(provider.calls).toBe(attempts);
    expect((await pool.query("SELECT reservation_state FROM idempotency_records WHERE actor_id=$1 AND operation='comments.photos.upload' ORDER BY created_at DESC LIMIT 1",[owner.id])).rows[0]?.reservation_state).toBe("unknown");
  });
  it("seals an actual image reject as 422 without repeat classification", async () => {
    provider.fixture=async()=>{const decision=safeImageDecision();return {...decision,flagged:true,categories:{...decision.categories,sexual:true}};};
    png=await sharp({create:{width:902,height:602,channels:3,background:"orange"}}).png().toBuffer();
    const idem=key();expect((await upload(owner,idem)).statusCode).toBe(422);
    const calls=provider.calls;expect((await upload(owner,idem)).statusCode).toBe(422);expect(provider.calls).toBe(calls);
    expect((await pool.query("SELECT 1 FROM venue_photo_submissions WHERE owner_user_id=$1",[owner.id])).rowCount).toBe(0);
  });
  it("rechecks canonical venue and actor/session after external preparation", async () => {
    const elsewhere=await newVenue(owner);
    png=await sharp({create:{width:903,height:603,channels:3,background:"pink"}}).png().toBuffer();
    provider.fixture=async()=>{await pool.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2,version=version+1 WHERE id=$1",[venue,elsewhere]);return safeImageDecision();};
    expect((await upload()).statusCode).toBe(404);
    venue=elsewhere;
    png=await sharp({create:{width:904,height:604,channels:3,background:"purple"}}).png().toBuffer();
    provider.fixture=async()=>{await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[owner.sessionId]);return safeImageDecision();};
    expect((await upload()).statusCode).toBe(401);
    expect((await pool.query("SELECT 1 FROM venue_photo_submissions WHERE owner_user_id=$1",[owner.id])).rowCount).toBe(0);
  });
  it("denies changed canonical venue and expired/withdrawn stages, with provider-independent withdrawal", async () => {
    const photo=await ready(), filename=await storage(photo.id);
    const elsewhere=await newVenue(owner);
    await pool.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2,version=version+1 WHERE id=$1",[venue,elsewhere]);
    expect((await get(photo.id)).statusCode).toBe(404);expect((await get(photo.id,owner,true,true)).statusCode).toBe(404);
    provider.fixture=async()=>{throw new ModerationProviderError("unavailable");};
    const idem=key(),calls=provider.calls;
    expect((await withdraw(photo.id,other)).statusCode).toBe(404);
    expect((await withdraw(photo.id,owner,idem)).json()).toMatchObject({status:"withdrawn",version:2,previewPath:null});
    expect((await withdraw(photo.id,owner,idem)).statusCode).toBe(200);
    expect((await withdraw(photo.id,owner,key(),"2")).statusCode).toBe(400);
    expect(provider.calls).toBe(calls);
    expect((await get(photo.id,owner,true,true)).statusCode).toBe(404);
    await media.cleanup();await expect(access(path.join(root,filename))).rejects.toMatchObject({code:"ENOENT"});
    provider.fixture=async()=>safeImageDecision();venue=elsewhere;
    const expired=await ready();await expire(expired.id);
    expect((await get(expired.id)).statusCode).toBe(404);expect((await get(expired.id,owner,true,true)).statusCode).toBe(404);
    expect((await withdraw(expired.id)).statusCode).toBe(200);
  });
  it("protects live references during GC, collects expired/abandoned stages and serializes withdraw/GC", async () => {
    const photo=await ready(), filename=await storage(photo.id);
    await pool.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1",[filename]);
    await media.cleanup();await access(path.join(root,filename));
    // Immutable private facts cannot be reassigned across actor/venue or renew expiry.
    await expect(pool.query("UPDATE venue_photo_submissions SET owner_user_id=$2 WHERE id=$1",[photo.id,other.id])).rejects.toMatchObject({code:"23514"});
    await expect(pool.query("UPDATE venue_photo_submissions SET expires_at=expires_at+interval '1 second' WHERE id=$1",[photo.id])).rejects.toMatchObject({code:"23514"});
    await Promise.all([media.cleanup(),withdraw(photo.id)]);await media.cleanup();
    await expect(access(path.join(root,filename))).rejects.toMatchObject({code:"ENOENT"});
    const expired=await ready(), expiredKey=await storage(expired.id);await expire(expired.id);
    await pool.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1",[expiredKey]);
    await media.cleanup();await expect(access(path.join(root,expiredKey))).rejects.toMatchObject({code:"ENOENT"});
    const abandoned=`${"a".repeat(64)}.png`;await media.stage(abandoned,png);
    await media.cleanup();await access(path.join(root,abandoned));
    await pool.query("UPDATE avatar_media_gc SET not_before=now()-interval '1 second',queued_at=now()-interval '2 hours' WHERE storage_key=$1",[abandoned]);
    await media.cleanup();await expect(access(path.join(root,abandoned))).rejects.toMatchObject({code:"ENOENT"});
  });
  it("enforces the eight-stage cap without classifying the ninth and reuses only community cache", async () => {
    const before=provider.calls;
    for(let i=0;i<8;i++) expect((await upload()).statusCode).toBe(201);
    // The same approved sanitized bytes can reuse their dedicated cache across owned stages.
    expect(provider.calls-before).toBeLessThanOrEqual(1);
    const calls=provider.calls;expect((await upload()).statusCode).toBe(409);expect(provider.calls).toBe(calls);
  });
  it("rolls migration down/up on this owned schema while retaining journal cleanup", async () => {
    const photo=await ready(), filename=await storage(photo.id);
    await pool.query(await readFile(path.join(migrationDir,"rollback/0069_venue_comment_photo_submissions.sql"),"utf8"));
    expect((await pool.query("SELECT to_regclass('public.venue_photo_submissions') AS relation")).rows[0].relation).toBeNull();
    await media.cleanup();await expect(access(path.join(root,filename))).rejects.toMatchObject({code:"ENOENT"});
    await pool.query(await readFile(path.join(migrationDir,"0069_venue_comment_photo_submissions.sql"),"utf8"));
    expect((await upload()).statusCode).toBe(201);
  });
});
