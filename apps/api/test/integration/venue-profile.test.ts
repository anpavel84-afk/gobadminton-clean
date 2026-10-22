// AUTHORED ONLY for #170. Source author must never execute RUN_DB_INTEGRATION=1.
import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { VenuesService, type VenueDto } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:19440", pepper = "venue-profile-synthetic-admin-pepper-32chars";
const cityId = "a0000000-0000-4000-8000-000000000001";
const apiRoot = path.resolve(__dirname, "../.."), dir = path.join(apiRoot, "migrations");
const facts = { courtCount: 0, amenities: { parking: false, showers: true } };
const contacts = { phone: "+1234567", website: "https://example.invalid/", messengers: [] };
type Actor = { id: string; token: string; csrf: string };
type AdminVenue = VenueDto & { version: number; cityName: string; reviewRequired?: boolean };
function guardedUrl(): URL {
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (url.search !== "" || !["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || process.env.NODE_ENV !== "test" || process.env.APP_ENV !== "local" || process.env.CONTENT_MODERATION_PROVIDER !== "fake") {
    throw new Error("Requires test/local synthetic-only loopback PostGIS; no remote/live DB allowed");
  }
  return url;
}
async function apply(db: Pool, until: string) {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
  for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql") && f < until).sort()) {
    const mid = file.replace(/\.sql$/, "");
    if ((await db.query("SELECT 1 FROM schema_migrations WHERE id=$1", [mid])).rowCount) continue;
    const c = await db.connect();
    try {
      await c.query("BEGIN"); await c.query(await readFile(path.join(dir, file), "utf8"));
      await c.query("INSERT INTO schema_migrations(id) VALUES($1)", [mid]); await c.query("COMMIT");
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
}

run("0039 venue profile — disposable synthetic DB, authored only", () => {
  const name = "venue_profile_" + randomUUID().replaceAll("-", "");
  let adminPool: Pool | undefined, pool: Pool, app: NestFastifyApplication | undefined;
  let manager: Actor;
  beforeAll(async () => {
    const url = guardedUrl();
    adminPool = new Pool({ connectionString: url.href });
    await adminPool.query(`CREATE DATABASE "${name}"`); url.pathname = "/" + name;
    pool = new Pool({ connectionString: url.href, max: 10 });
    await apply(pool, "0040");
    const env = loadEnv({ ...process.env, DATABASE_URL: url.href, PUBLIC_API_ORIGIN: "http://127.0.0.1:19441",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:19442", ALLOWED_WEB_ORIGINS: "http://127.0.0.1:19442",
      ADMIN_INTERNAL_ENABLED: "1", ADMIN_ORIGIN: origin, ADMIN_AUTH_PEPPER: pepper });
    const mod = await Test.createTestingModule({ imports: [buildTestCoreModule(env, pool), AdminModule, VenuesModule] }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.register(cookie); app.setGlobalPrefix("v1"); app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init(); await app.getHttpAdapter().getInstance().ready(); manager = await actor("content_manager");
  }, 120000);
  beforeEach(async () => { await pool.query("DELETE FROM admin_rate_windows"); });
  afterAll(async () => {
    try { await app?.close(); } finally {
      try { await pool?.end(); } finally {
        if (adminPool) { try { await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`); } finally { await adminPool.end(); } }
      }
    }
  });
  async function user() { return (await pool.query<{ id: string }>("INSERT INTO users(display_name) VALUES('Synthetic profile') RETURNING id")).rows[0]!.id; }
  async function actor(role: AdminRole): Promise<Actor> {
    const uid = await user(), id = (await pool.query<{ id: string }>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [uid])).rows[0]!.id;
    await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')", [id, role]);
    const credential = randomUUID(), token = randomUUID() + randomUUID(), csrf = randomUUID();
    await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)", [credential, id, Buffer.from("synthetic")]);
    await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)", [id, credential, hashSecret(pepper, token), sealSecret(pepper, csrf)]);
    return { id, token, csrf };
  }
  function fields() { return { cityId, name: "Synthetic " + randomUUID(), address: "Synthetic address " + randomUUID(), timezone: "Europe/Moscow", latitude: 55, longitude: 37 }; }
  function post(url: string, payload: object, a = manager, key = randomUUID()) {
    if (!app) throw new Error("Missing app");
    return app.inject({ method: "POST", url: "/v1/admin/venues" + url, cookies: { [ADMIN_COOKIE]: a.token }, headers: { origin, "x-csrf-token": a.csrf, "idempotency-key": key }, payload });
  }
  async function fixture() {
    const f = fields(), response = await post("", { ...f, reasonCode: "synthetic_review" });
    expect(response.statusCode, response.body).toBe(201); return { f, v: response.json<AdminVenue>() };
  }
  function edit(id: string, f: object, version: number, key = randomUUID(), a = manager) {
    return post(`/${id}/commands`, { action: "edit", expectedVersion: version, reasonCode: "synthetic_review", fields: f }, a, key);
  }
  async function detail(id: string) {
    if (!app) throw new Error("Missing app");
    const response = await app.inject({ method: "GET", url: "/v1/venues/" + id });
    expect(response.statusCode, response.body).toBe(200); return response.json<VenueDto>();
  }
  async function stored(id: string) {
    return (await pool.query("SELECT court_count,amenity_parking,amenity_showers,public_profile_updated_at,public_contacts,version,name,contact_phone,contact_website,booking_note FROM venues WHERE id=$1", [id])).rows[0]!;
  }
  it("fresh schema has nullable/no-default facts, SQL bounds and DB-generated insert date", async () => {
    const x = await fixture(), row = await stored(x.v.id);
    const inserted = await pool.query("INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address,public_profile_updated_at) SELECT city_id,name,address,timezone,location,created_by_user_id,'unverified',normalized_name,normalized_address,'1900-01-01'::timestamptz FROM venues WHERE id=$1 RETURNING public_profile_updated_at", [x.v.id]);
    expect(inserted.rows[0]?.public_profile_updated_at).toBeInstanceOf(Date);
    expect(inserted.rows[0]?.public_profile_updated_at.getUTCFullYear()).not.toBe(1900);
    expect(row).toMatchObject({ court_count: null, amenity_parking: null, amenity_showers: null });
    expect(row.public_profile_updated_at).toBeInstanceOf(Date);
    expect(x.v.profile).toMatchObject({ courtCount: null, amenities: { parking: null, showers: null }, gallery: { coverage: "cover_only", items: [] } });
    const columns = await pool.query("SELECT column_default,is_nullable FROM information_schema.columns WHERE table_name='venues' AND column_name IN ('court_count','amenity_parking','amenity_showers','public_profile_updated_at')");
    expect(columns.rows).toHaveLength(4); for (const col of columns.rows) expect(col).toEqual({ column_default: null, is_nullable: "YES" });
    await expect(pool.query("UPDATE venues SET court_count=-1 WHERE id=$1", [x.v.id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE venues SET court_count=2147483648 WHERE id=$1", [x.v.id])).rejects.toMatchObject({ code: "22003" });
    await pool.query("UPDATE venues SET court_count=2147483647,amenity_parking=false WHERE id=$1", [x.v.id]);
    expect((await detail(x.v.id)).profile).toMatchObject({ courtCount: 2147483647, amenities: { parking: false } });
  });
  it("0037 reads missing keys; seeded 0038→0039 preserves legacy/private data and ledger rerun", async () => {
    if (!adminPool) throw new Error("Missing admin pool");
    const upgradeName = name + "_upgrade", url = guardedUrl();
    await adminPool.query(`CREATE DATABASE "${upgradeName}"`); url.pathname = "/" + upgradeName;
    const db = new Pool({ connectionString: url.href });
    try {
      await apply(db, "0038");
      const uid = (await db.query<{ id: string }>("INSERT INTO users(display_name) VALUES('Synthetic legacy') RETURNING id")).rows[0]!.id;
      const id = (await db.query<{ id: string }>("INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address,contact_phone,contact_website,booking_note) VALUES($1,'Synthetic legacy','Synthetic address','Europe/Moscow',ST_SetSRID(ST_MakePoint(37,55),4326)::geography,$2,'verified','synthetic legacy','synthetic address','private','https://private.invalid','private note') RETURNING id", [cityId, uid])).rows[0]!.id;
      const service = new VenuesService(db, {} as IdempotencyService, {} as MutationRunner);
      expect((await service.getById(id)).profile).toMatchObject({ courtCount: null, amenities: { parking: null, showers: null }, updatedAt: null });
      expect((await service.searchCatalog({ cityId })).items[0]?.profile?.updatedAt).toBeNull();
      await apply(db, "0039"); await db.query("UPDATE venues SET public_contacts=$2::jsonb WHERE id=$1", [id, JSON.stringify(contacts)]);
      const before = (await db.query("SELECT * FROM venues WHERE id=$1", [id])).rows[0];
      await apply(db, "0040");
      const after = (await db.query("SELECT * FROM venues WHERE id=$1", [id])).rows[0];
      expect(after).toMatchObject({ ...before, court_count: null, amenity_parking: null, amenity_showers: null, public_profile_updated_at: null });
      await apply(db, "0040"); expect((await db.query("SELECT * FROM venues WHERE id=$1", [id])).rows[0]).toEqual(after);
      expect((await db.query("SELECT count(*)::int AS n FROM schema_migrations WHERE id='0039_venue_public_profile'")).rows[0]?.n).toBe(1);
      // Old API SQL on additive schema: no new fields in SELECT/UPDATE; old image gate remains integrator-owned.
      await db.query("UPDATE venues SET version=version+1,updated_at=now() WHERE id=$1", [id]);
      expect((await db.query("SELECT id,name,address,timezone FROM venues WHERE id=$1", [id])).rows[0]?.id).toBe(id);
      expect((await db.query("SELECT public_profile_updated_at FROM venues WHERE id=$1", [id])).rows[0]?.public_profile_updated_at).toBeNull();
      await db.query("UPDATE venues SET name='Synthetic legacy edited' WHERE id=$1", [id]);
      expect((await service.getById(id)).profile?.updatedAt).not.toBeNull();
      await db.query("UPDATE venues SET court_count=0,amenity_parking=false,amenity_showers=true WHERE id=$1", [id]);
      const populated = (await db.query("SELECT * FROM venues WHERE id=$1", [id])).rows[0];
      // Exercise the real ledger runner, not raw ALTER twice; isolated database only.
      execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: url.href, PUBLIC_API_ORIGIN: "http://127.0.0.1:19441" }, stdio: "pipe" });
      expect((await db.query("SELECT * FROM venues WHERE id=$1", [id])).rows[0]).toEqual(populated);
      expect((await db.query("SELECT public_contacts,contact_phone FROM venues WHERE id=$1", [id])).rows[0]).toEqual({ public_contacts: contacts, contact_phone: "private" });
      expect(JSON.stringify(await service.getById(id))).not.toContain("private");
    } finally { try { await db.end(); } finally { await adminPool.query(`DROP DATABASE IF EXISTS "${upgradeName}"`); } }
  });
  it("edit omission/null/replacement, version conflicts, collision no-write and immutable server fields", async () => {
    const x = await fixture();
    let response = await edit(x.v.id, { ...x.f, profile: facts, publicContacts: contacts }, 1);
    expect(response.statusCode, response.body).toBe(201); expect(response.json<AdminVenue>().profile).toMatchObject(facts);
    response = await edit(x.v.id, x.f, 2); expect(response.statusCode).toBe(201);
    expect(response.json<AdminVenue>().profile).toMatchObject(facts);
    const before = await stored(x.v.id);
    expect((await edit(x.v.id, { ...x.f, profile: null }, 1)).statusCode).toBe(409); expect(await stored(x.v.id)).toEqual(before);
    for (const profile of [{ ...facts, updatedAt: "2000-01-01T00:00:00Z" }, { ...facts, gallery: { items: [] } }, { ...facts, bookingNote: "private" }, { ...facts, amenities: { parking: false } }, { ...facts, courtCount: 2147483648 }]) {
      expect((await edit(x.v.id, { ...x.f, profile }, 3)).statusCode).toBe(400); expect(await stored(x.v.id)).toEqual(before);
    }
    const y = await fixture();
    response = await edit(y.v.id, { ...x.f, profile: facts }, 1); expect(response.statusCode).toBe(201); expect(response.json()).toHaveProperty("reviewRequired", true);
    expect(await stored(y.v.id)).toMatchObject({ court_count: null, version: 1 });
    response = await edit(x.v.id, { ...x.f, profile: null }, 3); expect(response.statusCode).toBe(201);
    expect(response.json<AdminVenue>().profile).toMatchObject({ courtCount: null, amenities: { parking: null, showers: null } });
  });
  it("preserves admin cookie/exact Origin/CSRF/step-up/current role on first write and replay", async () => {
    if (!app) throw new Error("Missing app");
    const x = await fixture(), payload = { action: "edit", expectedVersion: 1, reasonCode: "synthetic_review", fields: { ...x.f, profile: facts } };
    const a = await actor("content_manager"), key = randomUUID(), url = `/v1/admin/venues/${x.v.id}/commands`;
    for (const options of [
      { headers: { origin, "x-csrf-token": a.csrf, "idempotency-key": randomUUID() }, cookies: {} },
      { headers: { origin: "http://wrong.invalid", "x-csrf-token": a.csrf, "idempotency-key": randomUUID() }, cookies: { [ADMIN_COOKIE]: a.token } },
      { headers: { origin, "x-csrf-token": "wrong", "idempotency-key": randomUUID() }, cookies: { [ADMIN_COOKIE]: a.token } },
    ]) expect((await app.inject({ method: "POST", url, payload, ...options })).statusCode).toBeGreaterThanOrEqual(400);
    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '1 day' WHERE principal_id=$1", [a.id]);
    expect((await post(`/${x.v.id}/commands`, payload, a, key)).statusCode).toBeGreaterThanOrEqual(400);
    await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE principal_id=$1", [a.id]);
    const first = await post(`/${x.v.id}/commands`, payload, a, key); expect(first.statusCode, first.body).toBe(201);
    const state = await stored(x.v.id);
    const replay = await post(`/${x.v.id}/commands`, payload, a, key); expect(replay.body).toBe(first.body); expect(await stored(x.v.id)).toEqual(state);
    await pool.query("UPDATE admin_role_grants SET active=false WHERE principal_id=$1", [a.id]);
    expect((await post(`/${x.v.id}/commands`, payload, a, key)).statusCode).toBe(403); expect(await stored(x.v.id)).toEqual(state);
  });
  it("date changes only for persisted public content; normalized/no-op/private/lifecycle/replay preserve it", async () => {
    const x = await fixture(), initial = await stored(x.v.id);
    const key = randomUUID();
    const first = await edit(x.v.id, { ...x.f, profile: facts, publicContacts: { ...contacts, website: "HTTPS://EXAMPLE.INVALID:443/a/../" } }, 1, key);
    expect(first.statusCode, first.body).toBe(201);
    const changed = await stored(x.v.id); expect(+changed.public_profile_updated_at).toBeGreaterThan(+initial.public_profile_updated_at);
    const replay = await edit(x.v.id, { ...x.f, profile: facts, publicContacts: { ...contacts, website: "HTTPS://EXAMPLE.INVALID:443/a/../" } }, 1, key);
    expect(replay.body).toBe(first.body); expect(await stored(x.v.id)).toEqual(changed);
    for (const f of [{ ...x.f, profile: facts, publicContacts: contacts }, x.f, { ...x.f, contactPhone: "private", bookingNote: "private note" }]) {
      const current = await stored(x.v.id), r = await edit(x.v.id, f, current.version); expect(r.statusCode, r.body).toBe(201);
      expect((await stored(x.v.id)).public_profile_updated_at).toEqual(changed.public_profile_updated_at);
    }
    await pool.query("UPDATE venues SET lifecycle_state='retired',version=version+1,provenance='admin_corrected',updated_at=now(),public_profile_updated_at='1900-01-01' WHERE id=$1", [x.v.id]);
    expect((await stored(x.v.id)).public_profile_updated_at).toEqual(changed.public_profile_updated_at);
    await pool.query("UPDATE venues SET lifecycle_state='unverified' WHERE id=$1", [x.v.id]);
    for (const patch of ["name=name||' edited'", "address=address||' edited'", "timezone='UTC'", "location=ST_SetSRID(ST_MakePoint(38,56),4326)::geography", "identity_discriminator='hall:2'", "public_contacts=NULL", "court_count=2", "amenity_parking=true", "amenity_showers=false"]) {
      const before = await stored(x.v.id); await pool.query(`UPDATE venues SET ${patch} WHERE id=$1`, [x.v.id]);
      expect(+(await stored(x.v.id)).public_profile_updated_at).toBeGreaterThan(+before.public_profile_updated_at);
    }
  });
  it("eligible moderated photo only; replacement/removal/moderation/actor/retirement and content date", async () => {
    const x = await fixture(), uid = await user();
    const approval = (await pool.query<{ id: string }>("INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at) VALUES('image','cover_image',1,$1,'synthetic','synthetic','fake','synthetic','{}','allow',now()) RETURNING id", [randomUUID().replaceAll("-", "").repeat(2)])).rows[0]!.id;
    const key = randomUUID().replaceAll("-", "").repeat(2) + ".png", oldDate = (await stored(x.v.id)).public_profile_updated_at;
    await pool.query("UPDATE venues SET cover_key=$2,cover_actor_id=$3,cover_moderation_approval_id=$4,cover_credit_kind='photo',cover_credit_text='Фото: Synthetic',cover_credit_url='https://example.invalid/' WHERE id=$1", [x.v.id, key, uid, approval]);
    const profile = (await detail(x.v.id)).profile!;
    expect(profile.gallery).toEqual({ coverage: "cover_only", items: [{ url: `/v1/media/venue-covers/${key}`, credit: { kind: "photo", text: "Фото: Synthetic", url: "https://example.invalid/" } }] });
    expect(+(await stored(x.v.id)).public_profile_updated_at).toBeGreaterThan(+oldDate);
    const contentDate = (await stored(x.v.id)).public_profile_updated_at;
    await pool.query("UPDATE content_moderation_approvals SET decision='deny' WHERE id=$1", [approval]);
    expect((await detail(x.v.id)).profile?.gallery.items).toEqual([]);
    expect((await stored(x.v.id)).public_profile_updated_at).toEqual(contentDate);
    await pool.query("UPDATE content_moderation_approvals SET decision='allow' WHERE id=$1", [approval]);
    for (const [kind, text, url] of [["logo", "Логотип: Synthetic", "https://example.invalid/"], ["illustration", "Иллюстрация", null], [null, null, null]]) {
      const beforeCredit = (await stored(x.v.id)).public_profile_updated_at;
      await pool.query("UPDATE venues SET cover_credit_kind=$2,cover_credit_text=$3,cover_credit_url=$4 WHERE id=$1", [x.v.id, kind, text, url]);
      expect((await detail(x.v.id)).profile?.gallery).toEqual({ coverage: "cover_only", items: [] });
      expect(+(await stored(x.v.id)).public_profile_updated_at).toBeGreaterThan(+beforeCredit);
    }
    await pool.query("UPDATE venues SET cover_credit_kind='photo',cover_credit_text='Фото: Synthetic',cover_credit_url='https://example.invalid/' WHERE id=$1", [x.v.id]);
    const beforeReplacement = (await stored(x.v.id)).public_profile_updated_at;
    await pool.query("UPDATE venues SET cover_key=$2 WHERE id=$1", [x.v.id, randomUUID().replaceAll("-", "").repeat(2) + ".png"]);
    expect((await detail(x.v.id)).profile?.gallery.items).toEqual([]);
    expect(+(await stored(x.v.id)).public_profile_updated_at).toBeGreaterThan(+beforeReplacement);
    await pool.query("UPDATE venues SET cover_credit_kind='photo',cover_credit_text='Фото: Synthetic',cover_credit_url='https://example.invalid/' WHERE id=$1", [x.v.id]);
    await pool.query("UPDATE venues SET lifecycle_state='retired' WHERE id=$1", [x.v.id]);
    expect((await detail(x.v.id)).profile?.gallery.items).toEqual([]);
    await pool.query("UPDATE venues SET lifecycle_state='unverified' WHERE id=$1", [x.v.id]);
    const beforeRemoval = (await stored(x.v.id)).public_profile_updated_at;
    await pool.query("UPDATE venues SET cover_key=NULL,cover_actor_id=NULL,cover_moderation_approval_id=NULL WHERE id=$1", [x.v.id]);
    expect((await detail(x.v.id)).profile?.gallery.items).toEqual([]);
    expect(+(await stored(x.v.id)).public_profile_updated_at).toBeGreaterThan(+beforeRemoval);
    await pool.query("UPDATE venues SET cover_key=$2,cover_actor_id=$3,cover_moderation_approval_id=$4,cover_credit_kind='photo',cover_credit_text='Фото: Synthetic',cover_credit_url='https://example.invalid/' WHERE id=$1", [x.v.id, key, uid, approval]);
    expect((await detail(x.v.id)).profile?.gallery.items).toHaveLength(1);
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1", [uid]);
    expect((await detail(x.v.id)).profile?.gallery.items).toEqual([]);
    expect((await pool.query("SELECT cover_key FROM venues WHERE id=$1", [x.v.id])).rows[0]?.cover_key).toBeNull();
    expect(JSON.stringify(await detail(x.v.id))).not.toMatch(/private|cover_key|actor_id|approval_id|rating|reviewCount/);
  });
  it("command/audit/history/outbox/receipt failure rolls back facts, contacts and DB date atomically", async () => {
    const x = await fixture();
    for (const table of ["privileged_audit_events", "venue_admin_actions", "outbox_events", "admin_command_receipts"]) {
      const before = await stored(x.v.id);
      const counts = async () => (await pool.query("SELECT (SELECT count(*) FROM privileged_audit_events) AS audit,(SELECT count(*) FROM venue_admin_actions) AS history,(SELECT count(*) FROM outbox_events) AS outbox,(SELECT count(*) FROM admin_command_receipts) AS receipts")).rows[0];
      const totals = await counts();
      // Synthetic throw lives only in this random database, never in runtime source.
      await pool.query("CREATE FUNCTION synthetic_profile_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$");
      await pool.query(`CREATE TRIGGER synthetic_profile_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION synthetic_profile_failure()`);
      try {
        const response = await edit(x.v.id, { ...x.f, profile: facts, publicContacts: contacts }, 1);
        expect(response.statusCode).toBeGreaterThanOrEqual(500);
        expect(await stored(x.v.id)).toEqual(before); expect(await counts()).toEqual(totals);
      } finally {
        await pool.query(`DROP TRIGGER synthetic_profile_failure ON ${table}`); await pool.query("DROP FUNCTION synthetic_profile_failure()");
      }
    }
  });
});
