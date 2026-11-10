import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { VenuesModule } from "../../src/venues/venues.module";
import { VENUE_CANDIDATE_RIGHTS } from "../../src/venues/venue-photo-candidates";
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
  const dedicated = url.pathname === "/gobadminton_venue_photo_candidates_disposable";
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

run("#507 I3a creator candidate / genuine review / existing GC", () => {
  let pool: Pool, app: NestFastifyApplication, sessions: SessionService, media: AvatarService;
  let provider: FakeModerationProvider, root: string, png: Buffer, owner: Actor, other: Actor, venue: string;
  let fixtureIndex = 0;
  type Admin = { id: string; userId: string; token: string; csrf: string };
  let privileged: Admin;
  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({connectionString:databaseUrl,max:12,connectionTimeoutMillis:5000,application_name:"venue-photo-candidates-owned-synthetic"});
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'");
    if (tables.rowCount) throw new Error("Requires EMPTY owned disposable schema");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    for (const file of (await readdir(migrationDir)).filter(f=>f.endsWith(".sql")).sort()) {
      await pool.query(await readFile(path.join(migrationDir,file),"utf8"));
      await pool.query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]);
    }
    root = await mkdtemp(path.join(process.cwd(),".venue-photo-candidates-disposable-"));
    const env = loadEnv({NODE_ENV:"test",APP_ENV:"local",HOST:"127.0.0.1",DATABASE_URL:databaseUrl,
      PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",PUBLIC_WEB_ORIGIN:origin,COOKIE_SECURE:"false",
      AUTH_PEPPER:"comment-photos-synthetic-pepper-only",CONTENT_MODERATION_PROVIDER:"fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET:"comment-photos-synthetic-fingerprint-only",AVATAR_MEDIA_ROOT:root,
      ADMIN_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:adminOrigin,ADMIN_AUTH_PEPPER:adminPepper,
      USER_RESTRICTIONS_INTERNAL_ENABLED:"1"});
    provider = new FakeModerationProvider(env);
    const ref = await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),CommentsModule,VenuesModule,AdminModule]})
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
    provider.fixture=async()=>safeImageDecision();provider.textFixture=async input=>safeTextBatchDecision(input.texts.length);
    await pool.query("DELETE FROM admin_rate_windows");
    await pool.query("DELETE FROM content_moderation_rate_budgets");
    owner=await actor();other=await actor();venue=await newVenue(owner);privileged=await admin("superadmin");
    png=await sharp({create:{width:900,height:600,channels:3,background:{r:++fixtureIndex,g:20,b:30}}}).png().toBuffer();
  });
  const key=()=>`candidate-${randomUUID()}`;
  const headers=(who: Actor, idem=key())=>({cookie:who.cookie,origin,"x-csrf-token":who.csrf,"idempotency-key":idem});
  const evidence=()=>({"x-gallery-credit-kind":"photo","x-gallery-credit-text":encodeURIComponent(`Фото: Синтетический автор ${fixtureIndex}`),
    "x-gallery-credit-url":"https://example.com/credit","x-gallery-source-url":"https://example.com/source",
    "x-gallery-source-author":encodeURIComponent("Синтетический автор"),
    "x-gallery-permission-basis":encodeURIComponent("Синтетическая декларация автора о собственных правах")});
  function upload(who=owner,idem=key(),venueId=venue) {
    return app.inject({method:"POST",url:`/v1/venues/${venueId}/photo-candidates`,headers:{...headers(who,idem),...evidence(),
      "content-type":"image/png","x-photo-rights":VENUE_CANDIDATE_RIGHTS},payload:png});
  }
  async function ready() {
    const r=await upload();expect(r.statusCode,r.body).toBe(201);return r.json<{id:string;status:string;version:number}>();
  }
  function get(id: string,who: Actor|null=owner,content=false) {
    return app.inject({method:"GET",url:`/v1/me/venue-photo-candidates/${id}${content?"/content":""}`,
      headers:{...(who?{cookie:who.cookie}:{}),"if-none-match":"*"}});
  }
  function withdraw(id: string,who=owner,idem=key()) {
    return app.inject({method:"DELETE",url:`/v1/me/venue-photo-candidates/${id}`,
      headers:{...headers(who,idem),"x-photo-version":"1"},payload:{expectedVersion:1}});
  }
  async function admin(role: AdminRole,userId?: string): Promise<Admin> {
    userId??=(await actor()).id;
    const id=(await pool.query<{id:string}>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[userId])).rows[0]!.id;
    await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",[id,role]);
    const credential=randomUUID(),token=randomUUID()+randomUUID(),csrf=randomUUID();
    await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[credential,id,Buffer.from("synthetic-fixture")]);
    await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",
      [id,credential,hashSecret(adminPepper,token),sealSecret(adminPepper,csrf)]);
    return {id,userId,token,csrf};
  }
  const adminHeaders=(a=privileged,idem=key())=>({origin:adminOrigin,cookie:`${ADMIN_COOKIE}=${a.token}`,
    "x-csrf-token":a.csrf,"idempotency-key":idem});
  async function version() {return (await pool.query<{version:number}>("SELECT version FROM venues WHERE id=$1",[venue])).rows[0]!.version;}
  async function decide(id:string,action:"accept"|"reject"="accept",a=privileged,idem=key(),expectedVersion?:number) {
    return app.inject({method:"POST",url:`/v1/admin/venues/${venue}/photo-candidates/${id}/decision`,
      headers:adminHeaders(a,idem),payload:{action,expectedVersion:expectedVersion??await version(),expectedCandidateVersion:1}});
  }
  async function storage(id:string) {return (await pool.query<{storage_key:string}>("SELECT storage_key FROM venue_photo_submissions WHERE id=$1",[id])).rows[0]!.storage_key;}
  async function collect(id:string) {
    const storageKey=await storage(id);
    await pool.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1",[storageKey]);
    await media.cleanup();return path.join(root,storageKey);
  }

  it("uses the actual created canonical row; successful foreign dedup grants no candidate authority",async()=>{
    const payload={cityId:"a0000000-0000-4000-8000-000000000001",name:`Новый зал ${randomUUID()}`,
      address:`Адрес ${randomUUID()}`,timezone:"Europe/Moscow",latitude:55.9,longitude:37.4};
    const created=await app.inject({method:"POST",url:"/v1/venues",headers:headers(owner),payload});
    expect(created.statusCode,created.body).toBe(201);venue=created.json<{id:string}>().id;
    expect((await pool.query("SELECT created_by_user_id FROM venues WHERE id=$1",[venue])).rows[0].created_by_user_id).toBe(owner.id);
    const dedup=await app.inject({method:"POST",url:"/v1/venues",headers:headers(other),payload});
    expect([200,201]).toContain(dedup.statusCode);expect(dedup.json().id).toBe(venue);
    const calls=provider.calls;expect((await upload(other)).statusCode).toBe(404);expect(provider.calls).toBe(calls);
    provider.fixture=async()=>{const d=safeImageDecision();return {...d,flagged:true,categories:{...d.categories,sexual:true}};};
    expect((await upload()).statusCode).toBe(422);
    expect((await pool.query("SELECT 1 FROM venues WHERE id=$1",[venue])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM venue_gallery_items WHERE venue_id=$1",[venue])).rowCount).toBe(0);
  });
  it("keeps pending private, fences guest/foreign/conditional reads and isolates comment-purpose paths",async()=>{
    const p=await ready();expect(p).toMatchObject({status:"awaiting_review",version:1});
    for(const content of [false,true]) {
      expect((await get(p.id,null,content)).statusCode).toBe(401);
      expect((await get(p.id,other,content)).statusCode).toBe(404);
    }
    const preview=await get(p.id,owner,true);expect(preview.statusCode).toBe(200);expect(preview.headers["cache-control"]).toBe("no-store");
    expect(await sharp(preview.rawPayload).metadata()).toMatchObject({width:1200,height:400});
    const filename=await storage(p.id);
    expect((await app.inject({method:"GET",url:`/v1/media/venue-covers/${filename}`})).statusCode).toBe(404);
    for(const suffix of ["","/content"]) expect((await app.inject({method:"GET",url:`/v1/me/venue-photo-submissions/${p.id}${suffix}`,headers:{cookie:owner.cookie}})).statusCode).toBe(404);
    expect((await app.inject({method:"DELETE",url:`/v1/me/venue-photo-submissions/${p.id}`,
      headers:{...headers(owner),"x-photo-version":"1"},payload:{expectedVersion:1}})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",url:`/v1/venues/${venue}/comments`,headers:headers(owner),payload:{text:"",photoIds:[p.id]}})).statusCode).toBe(404);
    const comment=await app.inject({method:"POST",url:`/v1/venues/${venue}/comment-photos`,headers:{...headers(owner),
      "content-type":"image/png","x-photo-rights":COMMENT_PHOTO_RIGHTS},payload:png});
    expect(comment.statusCode).toBe(201);expect((await get(comment.json().id)).statusCode).toBe(404);
    expect((await withdraw(comment.json().id)).statusCode).toBe(404);
    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[owner.sessionId]);
    expect((await get(p.id,owner,true)).statusCode).toBe(401);expect((await withdraw(p.id)).statusCode).toBe(401);
  });
  it("atomically replaces pending with history; GC keeps pending and collects withdrawn/rejected except legal hold",async()=>{
    const first=await ready();await access(await collect(first.id));
    await expect(pool.query("UPDATE venue_photo_submissions SET purpose='comment_attachment' WHERE id=$1",[first.id])).rejects.toMatchObject({code:"23514"});
    await expect(pool.query("UPDATE venue_photo_submissions SET status='accepted',version=2 WHERE id=$1",[first.id])).rejects.toMatchObject({code:"23514"});
    await expect(pool.query("DELETE FROM venue_photo_submissions WHERE id=$1",[first.id])).rejects.toMatchObject({code:"23514"});
    const second=await ready();expect((await get(first.id)).json()).toMatchObject({status:"withdrawn",version:2});
    expect((await pool.query("SELECT 1 FROM venue_photo_submissions WHERE venue_id=$1 AND status='awaiting_review'",[venue])).rowCount).toBe(1);
    await expect(access(await collect(first.id))).rejects.toMatchObject({code:"ENOENT"});
    const rejected=await decide(second.id,"reject");expect(rejected.statusCode,rejected.body).toBe(200);
    const audit=(await pool.query("SELECT decision_audit_id FROM venue_photo_submissions WHERE id=$1",[second.id])).rows[0].decision_audit_id;
    expect(audit).toBeTruthy();await expect(access(await collect(second.id))).rejects.toMatchObject({code:"ENOENT"});
    const held=await ready();
    // Actual append-only privileged evidence row marks the hold; no invented case/retention table.
    await pool.query(`INSERT INTO privileged_audit_events(actor_id,roles_snapshot,permission_key,action_key,target_type,target_id,reason_code,request_id,legal_hold)
      VALUES($1,'["superadmin"]','venue.manage','venue.candidate_evidence','venue_photo_candidate',$2,'synthetic_fixture',$3,true)`,[privileged.id,held.id,randomUUID()]);
    expect((await decide(held.id,"reject")).statusCode).toBe(200);await access(await collect(held.id));
  });
  it("requires genuine privileged role, exact creator-or-superadmin scope and fresh step-up",async()=>{
    const p=await ready(),foreign=await admin("content_manager"),support=await admin("support");
    const regular=await app.inject({method:"POST",url:`/v1/admin/venues/${venue}/photo-candidates/${p.id}/decision`,headers:headers(owner),
      payload:{action:"accept",expectedVersion:await version(),expectedCandidateVersion:1}});
    expect([401,403]).toContain(regular.statusCode);
    expect((await decide(p.id,"accept",foreign)).statusCode).toBe(404);
    expect((await decide(p.id,"accept",support)).statusCode).toBe(403);
    const scoped=await admin("content_manager",owner.id);
    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE principal_id=$1",[scoped.id]);
    const expired=await decide(p.id,"accept",scoped);expect(expired.statusCode).toBe(403);expect(expired.json().code).toBe("ADMIN_STEP_UP_REQUIRED");
    await pool.query("UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE principal_id=$1",[scoped.id]);
    const calls=provider.calls,texts=provider.textCalls;
    const accepted=await decide(p.id,"accept",scoped);expect(accepted.statusCode,accepted.body).toBe(200);
    expect(provider.calls).toBe(calls);expect(provider.textCalls).toBe(texts+1);
    expect((await pool.query("SELECT 1 FROM content_moderation_bindings WHERE entity_kind='venue_gallery_item' AND surface_key='venue_credit_text'")).rowCount).toBeGreaterThan(0);
    expect((await withdraw(p.id)).statusCode).toBe(409);expect((await get(p.id,owner,true)).statusCode).toBe(404);
    const filename=await storage(p.id);
    expect((await app.inject({method:"GET",url:`/v1/media/venue-covers/${filename}`})).statusCode).toBe(200);
    // Exercise the collector reference even if a stale journal entry exists after acceptance.
    await pool.query("INSERT INTO avatar_media_gc(storage_key,not_before) VALUES($1,now()) ON CONFLICT(storage_key) DO UPDATE SET not_before=now()",[filename]);
    await access(await collect(p.id));
  });
  it("rechecks both versions after text preparation; failed/provider-unavailable acceptance leaves official media unchanged",async()=>{
    const p=await ready();const before=await version();
    provider.textFixture=async input=>{await pool.query("UPDATE venues SET version=version+1 WHERE id=$1",[venue]);return safeTextBatchDecision(input.texts.length);};
    expect((await decide(p.id,"accept",privileged,key(),before)).statusCode).toBe(409);
    expect((await get(p.id)).json().status).toBe("awaiting_review");
    expect((await pool.query("SELECT 1 FROM venue_gallery_items WHERE venue_id=$1",[venue])).rowCount).toBe(0);
    provider.textFixture=async()=>{throw new ModerationProviderError("unavailable");};
    const idem=key();expect((await decide(p.id,"accept",privileged,idem)).statusCode).toBe(503);
    const calls=provider.textCalls;expect((await decide(p.id,"accept",privileged,idem)).statusCode).toBe(503);expect(provider.textCalls).toBe(calls);
    expect((await decide(p.id,"reject")).statusCode).toBe(200);
  });
  it("fences retry/provider UNKNOWN and actor loss after external image preparation",async()=>{
    const idem=key(),calls=provider.calls;
    const pair=await Promise.all([upload(owner,idem),upload(owner,idem)]);
    expect(pair.some(r=>r.statusCode===201)).toBe(true);expect(pair.every(r=>[201,409].includes(r.statusCode))).toBe(true);
    const p=pair.find(r=>r.statusCode===201)!.json();
    expect((await upload(owner,idem)).json()).toEqual(p);expect(provider.calls).toBe(calls+1);
    png=await sharp({create:{width:900,height:600,channels:3,background:"cyan"}}).png().toBuffer();
    provider.fixture=async()=>{throw new ModerationProviderError("unavailable");};
    const unknown=key();expect((await upload(owner,unknown)).statusCode).toBe(503);
    const attempts=provider.calls;expect((await upload(owner,unknown)).statusCode).toBe(503);expect(provider.calls).toBe(attempts);
    expect((await get(p.id)).json().status).toBe("awaiting_review");
    png=await sharp({create:{width:900,height:600,channels:3,background:"magenta"}}).png().toBuffer();
    provider.fixture=async()=>{await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[owner.sessionId]);return safeImageDecision();};
    expect((await upload()).statusCode).toBe(401);
    expect((await pool.query("SELECT 1 FROM venue_photo_submissions WHERE venue_id=$1 AND status='awaiting_review'",[venue])).rowCount).toBe(1);
  });
  it("fails closed on stale stored approval without another image call",async()=>{
    const p=await ready(),calls=provider.calls;
    const approval=(await pool.query("SELECT image_approval_id FROM venue_photo_submissions WHERE id=$1",[p.id])).rows[0].image_approval_id;
    await pool.query("UPDATE content_moderation_approvals SET policy_version='synthetic-stale' WHERE id=$1",[approval]);
    const stale=await decide(p.id);expect(stale.statusCode).toBe(409);expect(stale.json().code).toBe("MODERATION_POLICY_MISMATCH");
    expect(provider.calls).toBe(calls);
    expect((await pool.query("SELECT 1 FROM venue_gallery_items WHERE venue_id=$1",[venue])).rowCount).toBe(0);
    // Safety withdrawal does not call or require the provider/current approval.
    expect((await withdraw(p.id)).statusCode).toBe(200);
  });
  it("serializes accept/withdraw and rejects venue merge during external preparation",async()=>{
    const p=await ready();
    const pair=await Promise.all([decide(p.id),withdraw(p.id)]);
    const status=(await get(p.id)).json().status;
    expect(["accepted","withdrawn"]).toContain(status);
    expect(pair.some(r=>r.statusCode===200)).toBe(true);
    expect(pair.every(r=>[200,404,409].includes(r.statusCode))).toBe(true);
    expect((await pool.query("SELECT 1 FROM venue_gallery_items WHERE venue_id=$1 AND active",[venue])).rowCount).toBe(status==="accepted"?1:0);
    const target=await newVenue(owner);venue=await newVenue(owner);const next=await ready();
    provider.textFixture=async input=>{await pool.query("UPDATE venues SET lifecycle_state='merged',canonical_venue_id=$2,version=version+1 WHERE id=$1",[venue,target]);return safeTextBatchDecision(input.texts.length);};
    // Prior safe credit cache must not skip this fixture: give this row distinct supplied credit.
    // A separate source upload supplies unique credit through the ordinary immutable admission.
    const unique=await app.inject({method:"POST",url:`/v1/venues/${venue}/photo-candidates`,headers:{...headers(owner),...evidence(),
      "x-gallery-credit-text":encodeURIComponent(`Фото: Автор ${randomUUID()}`),"content-type":"image/png","x-photo-rights":VENUE_CANDIDATE_RIGHTS},payload:png});
    expect(unique.statusCode).toBe(201);expect((await decide(unique.json().id)).statusCode).toBe(404);
    expect((await pool.query("SELECT 1 FROM venue_gallery_items WHERE venue_id=$1",[venue])).rowCount).toBe(0);
    expect((await get(next.id,owner,true)).statusCode).toBe(404);
  });
  it("appends up to eight, preserves the existing official main, and rejects the ninth without provider calls",async()=>{
    const first=await ready();expect((await decide(first.id)).statusCode).toBe(200);
    const cover=(await pool.query("SELECT cover_key FROM venues WHERE id=$1",[venue])).rows[0].cover_key;
    for(let i=1;i<8;i++) {const p=await ready();expect((await decide(p.id)).statusCode).toBe(200);}
    expect((await pool.query("SELECT cover_key FROM venues WHERE id=$1",[venue])).rows[0].cover_key).toBe(cover);
    expect((await pool.query("SELECT 1 FROM venue_gallery_items WHERE venue_id=$1 AND active",[venue])).rowCount).toBe(8);
    const ninth=await ready(),images=provider.calls,texts=provider.textCalls;
    const full=await decide(ninth.id);expect(full.statusCode).toBe(409);expect(full.json().code).toBe("VENUE_GALLERY_FULL");
    expect(provider.calls).toBe(images);expect(provider.textCalls).toBe(texts);
    expect((await withdraw(ninth.id)).statusCode).toBe(200);
  });
});
