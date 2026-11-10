import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
import { MODERATION_PROVIDER, ModerationProviderError, safeImageDecision, safeTextBatchDecision } from "../../src/moderation/provider";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { AvatarService } from "../../src/profiles/avatar.service";
import { buildTestCoreModule } from "./test-core.module";

// Refuse any implicit/live database BEFORE constructing Pool; hosted CI must be explicitly disposable.
function disposableUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit empty owned disposable database required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_comment_photo_publication_disposable";
  const hosted =
    url.pathname === "/gobadminton" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GMAP1_DISPOSABLE_DB === "1" &&
    /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "") &&
    url.port === process.env.CI_DB_PORT;
  if (
    process.env.NODE_ENV !== "test" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !(dedicated || hosted)
  ) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
const adminOrigin = "http://localhost:18995";
const adminPepper = "comment-photos-synthetic-admin-pepper-only";
type Actor = { id: string; cookie: string; csrf: string; sessionId: string };
const migrationDir = path.resolve(__dirname,"../../migrations");

run("#507 I2b exact revision photo publication", () => {
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
      ADMIN_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:adminOrigin,ADMIN_AUTH_PEPPER:adminPepper,
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
    provider.fixture=async()=>safeImageDecision();provider.textFixture=async i=>safeTextBatchDecision(i.texts.length);owner=await actor();other=await actor();venue=await newVenue(owner);
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
    return app.inject({method:"DELETE",url:`/v1/me/venue-photo-submissions/${id}`,headers:{...headers(who,idem),"x-photo-version":version},payload:{expectedVersion:1}});
  }
  async function ready() {
    const response=await upload();expect(response.statusCode).toBe(201);return response.json<{id:string;previewPath:string;venueId:string}>();
  }
  async function storage(id: string) {
    return (await pool.query<{storage_key:string}>("SELECT storage_key FROM venue_photo_submissions WHERE id=$1",[id])).rows[0]!.storage_key;
  }

  function create(payload: Record<string,unknown>,who=owner,idem=key()) {
    return app.inject({method:"POST",url:`/v1/venues/${venue}/comments`,headers:headers(who,idem),payload});
  }
  function edit(id: string,payload: Record<string,unknown>,idem=key()) {
    return app.inject({method:"PUT",url:`/v1/comments/${id}`,headers:headers(owner,idem),payload});
  }
  const publicGet=(url:string,who:Actor|null=null,method:"GET"|"HEAD"="GET")=>app.inject({method,url,
    headers:{...(who?{cookie:who.cookie}:{}),"if-none-match":"*","if-modified-since":new Date().toUTCString()}});
  it("publishes ordered photo-only content without text/image reclassification; edit omission retains, removal revokes",async()=>{
    const a=await ready();const b=await ready();
    const imageCalls=provider.calls,textCalls=provider.textCalls,idem=key();
    const made=await create({photoIds:[b.id,a.id]},owner,idem);
    expect(made.statusCode,made.body).toBe(201);
    const comment=made.json();expect(comment.body).toBeNull();expect(comment.photos.map((p:{id:string})=>p.id)).toEqual([b.id,a.id]);
    expect((await create({photoIds:[b.id,a.id]},owner,idem)).json()).toEqual(comment);
    expect(provider.calls).toBe(imageCalls);expect(provider.textCalls).toBe(textCalls);
    for(const method of ["GET","HEAD"] as const) {
      const result=await publicGet(comment.photos[0].url,null,method);
      expect(result.statusCode,result.body).toBe(200);expect(result.headers["cache-control"]).toBe("no-store");
    }
    expect((await create({text:"reuse",photoIds:[a.id]})).statusCode).toBe(404);
    expect((await create({photoIds:[a.id]},other)).statusCode).toBe(404);
    expect((await withdraw(a.id)).statusCode).toBe(409);
    const kept=await edit(comment.id,{text:"retained photos",expectedVersion:1});
    expect(kept.statusCode,kept.body).toBe(200);expect(kept.json().photos.map((p:{id:string})=>p.id)).toEqual([b.id,a.id]);
    expect((await publicGet(comment.photos[0].url)).statusCode).toBe(404);
    const removal=await edit(comment.id,{photoIds:[],expectedVersion:2});
    expect(removal.statusCode).toBe(422); // never an empty live comment
    const removed=await edit(comment.id,{text:"text remains",photoIds:[],expectedVersion:2});
    expect(removed.statusCode,removed.body).toBe(200);expect(removed.json().photos).toEqual([]);
    expect((await publicGet(kept.json().photos[0].url)).statusCode).toBe(404);
    expect((await edit(comment.id,{photoIds:[a.id],expectedVersion:3})).statusCode).toBe(404);
    expect(provider.calls).toBe(imageCalls);
  });
  it("rejects atomic replacements and seals text UNKNOWN with previous body/photo authority intact",async()=>{
    const a=await ready();const made=await create({text:"accepted body",photoIds:[a.id]});expect(made.statusCode).toBe(201);
    const c=made.json();
    const foreign=(await upload(other)).json();
    const calls=provider.textCalls;
    expect((await edit(c.id,{text:"not paid",photoIds:[foreign.id],expectedVersion:1})).statusCode).toBe(404);
    expect(provider.textCalls).toBe(calls);
    provider.textFixture=async()=>{throw new ModerationProviderError("unavailable");};
    const idem=key(),payload={text:"unique timeout text",photoIds:[],expectedVersion:1};
    expect((await edit(c.id,payload,idem)).statusCode).toBe(503);
    const after=provider.textCalls;expect((await edit(c.id,payload,idem)).statusCode).toBe(503);expect(provider.textCalls).toBe(after);
    const current=(await app.inject({method:"GET",url:`/v1/comments/${c.id}`})).json();
    expect(current).toMatchObject({body:"accepted body",version:1});expect(current.photos).toEqual(c.photos);
    expect((await publicGet(c.photos[0].url)).statusCode).toBe(200);
    expect((await pool.query("SELECT count(*)::int n FROM entity_comment_revisions WHERE comment_id=$1",[c.id])).rows[0].n).toBe(1);
  });
  it("revokes bytes for source deletion, bilateral block, restrictions and venue retirement before conditional responses",async()=>{
    const a=await ready(),made=await create({photoIds:[a.id]});expect(made.statusCode).toBe(201);const c=made.json();
    await pool.query("INSERT INTO user_blocks(blocker_user_id,blocked_user_id) VALUES($1,$2)",[other.id,owner.id]);
    expect((await publicGet(c.photos[0].url,other)).statusCode).toBe(404);
    expect((await publicGet(c.photos[0].url)).statusCode).toBe(200);
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[owner.id]);
    expect((await publicGet(c.photos[0].url)).statusCode).toBe(404);
    await pool.query("UPDATE users SET status='active' WHERE id=$1",[owner.id]);
    await pool.query("UPDATE venues SET lifecycle_state='retired',version=version+1 WHERE id=$1",[venue]);
    expect((await publicGet(c.photos[0].url)).statusCode).toBe(404);
    await pool.query("UPDATE venues SET lifecycle_state='unverified',version=version+1 WHERE id=$1",[venue]);
    const deleted=await app.inject({method:"DELETE",url:`/v1/comments/${c.id}`,headers:headers(owner),payload:{expectedVersion:1}});
    expect(deleted.statusCode,deleted.body).toBe(200);expect(deleted.json()).toMatchObject({body:null,deleted:true,photos:[]});
    expect((await publicGet(c.photos[0].url,null,"HEAD")).statusCode).toBe(404);
    const key=await storage(a.id);await pool.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1",[key]);
    // Unexpired private stage retention is bounded by its original TTL; current/history metadata stays retained.
    await media.cleanup();expect((await pool.query("SELECT 1 FROM entity_comment_photos WHERE comment_id=$1",[c.id])).rowCount).toBe(1);
  });
  it("only same-current retained IDs cross staging TTL; private expiry never becomes public authority",async()=>{
    async function expire(ids:string[]) {
      const c=await pool.connect();
      try { await c.query("BEGIN");
        await c.query("ALTER TABLE venue_photo_submissions DISABLE TRIGGER venue_photo_submission_guard");
        await c.query("ALTER TABLE venue_photo_submissions DISABLE TRIGGER published_photo_withdraw_guard");
        await c.query("UPDATE venue_photo_submissions SET created_at=now()-interval '2 hours',rights_declared_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=ANY($1::uuid[])",[ids]);
        await c.query("ALTER TABLE venue_photo_submissions ENABLE TRIGGER venue_photo_submission_guard");
        await c.query("ALTER TABLE venue_photo_submissions ENABLE TRIGGER published_photo_withdraw_guard");
        await c.query("COMMIT");
      } catch(error) {await c.query("ROLLBACK");throw error;} finally {c.release();}
    }
    const a=await ready(),b=await ready();const made=await create({photoIds:[a.id]});expect(made.statusCode).toBe(201);const comment=made.json();
    await expire([a.id,b.id]);
    expect((await get(a.id,owner,true,true)).statusCode).toBe(404);
    const retained=await edit(comment.id,{expectedVersion:1});expect(retained.statusCode,retained.body).toBe(200);
    expect(retained.json().photos.map((p:{id:string})=>p.id)).toEqual([a.id]);
    expect((await publicGet(retained.json().photos[0].url)).statusCode).toBe(200);
    expect((await create({photoIds:[b.id]})).statusCode).toBe(404);
    expect((await create({text:"copied",photoIds:[a.id]})).statusCode).toBe(404);
    await pool.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key IN(SELECT storage_key FROM venue_photo_submissions WHERE id=ANY($1::uuid[]))",[[a.id,b.id]]);
    await media.cleanup();expect((await publicGet(retained.json().photos[0].url)).statusCode).toBe(200);
    const deletion=await app.inject({method:"DELETE",url:`/v1/comments/${comment.id}`,headers:headers(owner),payload:{expectedVersion:2}});
    expect(deletion.statusCode).toBe(200);await media.cleanup();
    expect((await pool.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1",[await storage(a.id)])).rowCount).toBe(0);
  });
  it("rejects empty live content at commit time SQL",async()=>{
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const row=(await client.query<{id:string}>("INSERT INTO entity_comments(entity_kind,entity_id,author_user_id,body,version) VALUES('venue',$1,$2,NULL,1) RETURNING id",[venue,owner.id])).rows[0]!;
      await client.query("INSERT INTO entity_comment_revisions(comment_id,entity_kind,entity_id,resource_version,actor_user_id,after_body) VALUES($1,'venue',$2,1,$3,NULL)",[row.id,venue,owner.id]);
      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toMatchObject({code:"23514"});
    } finally {await client.query("ROLLBACK");client.release();}
    expect((await create({text:"  ",photoIds:[]})).statusCode).toBe(422);
    expect((await create({photoIds:Array(5).fill(randomUUID())})).statusCode).toBe(422);
  });
  it("pages beyond 24 with exact source attribution and resets a cursor after merge",async()=>{
    for(let i=0;i<25;i++) {
      const a=await ready();const made=await create({photoIds:[a.id]});expect(made.statusCode,made.body).toBe(201);
    }
    const first=await app.inject({method:"GET",url:`/v1/venues/${venue}/community-photos`});expect(first.statusCode,first.body).toBe(200);
    expect(first.json().items).toHaveLength(24);expect(first.json().nextCursor).toBeTruthy();
    const second=await app.inject({method:"GET",url:`/v1/venues/${venue}/community-photos?cursor=${first.json().nextCursor}`});
    expect(second.statusCode,second.body).toBe(200);expect(second.json().items).toHaveLength(1);expect(second.json().nextCursor).toBeNull();
    const all=[...first.json().items,...second.json().items];expect(new Set(all.map(p=>p.id)).size).toBe(25);
    for(const photo of [all[0],all[24]]) expect((await app.inject({method:"GET",url:photo.source.path})).statusCode).toBe(200);
    const target=await newVenue(owner);await pool.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2,version=version+1 WHERE id=$1",[venue,target]);
    const stale=await app.inject({method:"GET",url:`/v1/venues/${venue}/community-photos?cursor=${first.json().nextCursor}`});
    expect(stale.statusCode,stale.body).toBe(409);expect(stale.json().code).toBe("VENUE_CANONICAL_CHANGED");
  });
});
