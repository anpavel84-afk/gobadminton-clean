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
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { MODERATION_PROVIDER, safeImageDecision } from "../../src/moderation/provider";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:19450";
const pepper = "venue-gallery-synthetic-admin-pepper-32chars";

type Actor = { id: string; userId: string; token: string; csrf: string };

run("venue gallery: isolated disposable PostGIS / actual API behavior", () => {
  let app: NestFastifyApplication, pool: Pool, adminPool: Pool, media: string, png: Buffer, fake: FakeModerationProvider;
  let owner: Actor, other: Actor, support: Actor;
  const name = `venue_gallery_${randomUUID().replaceAll("-", "")}`;
  const cityId = "a0000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Disposable loopback PostGIS required");
    adminPool = new Pool({ connectionString: url.href });
    await adminPool.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.href });
    const dir = path.resolve(__dirname, "../../migrations");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
      await pool.query(await readFile(path.join(dir, file), "utf8"));
    }
    const root = path.resolve(__dirname, "../../.qa-runtime");
    await mkdir(root, { recursive: true });
    media = await mkdtemp(path.join(root, "venue-gallery-"));
    const env = loadEnv({
      ...process.env,
      DATABASE_URL: url.href,
      NODE_ENV: "test",
      APP_ENV: "local",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:19451",
      HOST: "127.0.0.1",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:19452",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:19452",
      AUTH_PEPPER: "venue-gallery-synthetic-consumer-pepper-32chars",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
      ADMIN_VK_REDIRECT_URI: origin + "/v1/admin/auth/vk/callback",
      ADMIN_YANDEX_REDIRECT_URI: origin + "/v1/admin/auth/yandex/callback",
      AVATAR_MEDIA_ROOT: media,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-gallery-synthetic-fingerprint-secret",
    });
    fake = new FakeModerationProvider(env);
    const mod = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AdminModule, VenuesModule, ProfilesModule],
    }).overrideProvider(MODERATION_PROVIDER).useValue(fake).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    registerAvatarHttp(app.getHttpAdapter().getInstance());
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    owner = await actor("content_manager");
    other = await actor("content_manager");
    support = await actor("support");
    png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "green" } }).withMetadata().png().toBuffer();
  }, 120000);

  beforeEach(async () => {
    await pool.query("DELETE FROM admin_rate_windows");
    await pool.query("DELETE FROM content_moderation_rate_budgets");
    fake.fixture = async () => safeImageDecision();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (adminPool) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
      await adminPool.end();
    }
    if (media) await rm(media, { recursive: true, force: true });
  });

  async function user() {
    return (await pool.query<{ id: string }>("INSERT INTO users(display_name) VALUES('Synthetic venue gallery') RETURNING id")).rows[0]!.id;
  }
  async function actor(role: AdminRole): Promise<Actor> {
    const userId = await user();
    const id = (await pool.query<{ id: string }>("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [userId])).rows[0]!.id;
    await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')", [id, role]);
    const credential = randomUUID(), token = randomUUID() + randomUUID(), csrf = randomUUID();
    await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)", [credential, id, Buffer.from("synthetic-fixture")]);
    await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)", [id, credential, hashSecret(pepper, token), sealSecret(pepper, csrf)]);
    return { id, userId, token, csrf };
  }
  function headers(a = owner, extra: Record<string, string> = {}) {
    return { origin, cookie: `${ADMIN_COOKIE}=${a.token}`, "x-csrf-token": a.csrf, "idempotency-key": randomUUID(), ...extra };
  }
  async function venue() {
    const r = await app.inject({
      method: "POST", url: "/v1/admin/venues", headers: headers(),
      payload: { cityId, name: "Synthetic " + randomUUID(), address: "Synthetic address", timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62, reasonCode: "synthetic_fixture" },
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as { id: string; version: number };
  }
  function evidence(kind: "illustration" | "photo" | "logo" = "illustration") {
    if (kind === "illustration") {
      return {
        "x-gallery-credit-kind": "illustration",
        "x-gallery-credit-text": encodeURIComponent("Иллюстрация"),
        "x-gallery-credit-url": "null",
        "x-gallery-source-url": "null",
        "x-gallery-source-author": "null",
        "x-gallery-permission-basis": encodeURIComponent("Письменное согласие клуба"),
        "x-gallery-source-fingerprint": "null",
      };
    }
    const label = kind === "photo" ? "Фото: Клуб" : "Логотип: Клуб";
    const url = kind === "photo" ? "https://club.example/photo" : "https://club.example/logo";
    return {
      "x-gallery-credit-kind": kind,
      "x-gallery-credit-text": encodeURIComponent(label),
      "x-gallery-credit-url": encodeURIComponent(url),
      "x-gallery-source-url": kind === "photo" ? encodeURIComponent(url) : "null",
      "x-gallery-source-author": "null",
      "x-gallery-permission-basis": encodeURIComponent("Письменное согласие клуба"),
      "x-gallery-source-fingerprint": "null",
    };
  }
  function add(id: string, version: number, a = owner, body = png, kind: "illustration" | "photo" | "logo" = "illustration", key = randomUUID()) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/venues/${id}/gallery`,
      headers: { ...headers(a, evidence(kind)), "content-type": "image/png", "x-venue-version": String(version), "idempotency-key": key },
      payload: body,
    });
  }
  const publicVenue = (id: string) => app.inject({ method: "GET", url: `/v1/venues/${id}` });

  it("backfills synthetic legacy photo/logo/illustration preserving source/moderation and public gates", async () => {
    const cases = [
      { kind: "photo", text: "Фото: Legacy", url: "https://club.example/legacy", basis: "imported club archive", fp: "d".repeat(64) },
      { kind: "logo", text: "Логотип: Legacy", url: "https://club.example/logo", basis: "legacy_preserved_unknown", fp: null as string | null },
      { kind: "illustration", text: "Иллюстрация", url: null as string | null, basis: "legacy_preserved_unknown", fp: null as string | null },
    ] as const;
    for (const [index, credit] of cases.entries()) {
      const v = await venue();
      const actorUser = await user();
      const approval = (await pool.query<{ id: string }>(
        "INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at) VALUES('image','cover_image',1,$1,'synthetic','synthetic','fake','synthetic','{}','allow',now()) RETURNING id",
        [String(index).repeat(64)],
      )).rows[0]!.id;
      const key = `${String.fromCharCode(97 + index).repeat(64)}.png`;
      await pool.query(
        `UPDATE venues SET cover_key=$2, cover_moderation_approval_id=$3, cover_actor_id=$4,
          cover_credit_kind=$5, cover_credit_text=$6, cover_credit_url=$7, version=version+1 WHERE id=$1`,
        [v.id, key, approval, actorUser, credit.kind, credit.text, credit.url],
      );
      await pool.query(
        `INSERT INTO venue_gallery_items (
           venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
           credit_kind, credit_text, credit_url, source_url, source_author, permission_basis, source_fingerprint
         ) VALUES ($1,0,true,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10)`,
        [v.id, key, approval, actorUser, credit.kind, credit.text, credit.url,
          credit.kind === "photo" ? credit.url : null, credit.basis, credit.fp],
      );
      const receipt = await app.inject({ method: "GET", url: `/v1/admin/venues/${v.id}/gallery`, headers: headers() });
      expect(receipt.statusCode, receipt.body).toBe(200);
      expect(receipt.json().items).toHaveLength(1);
      expect(receipt.json().items[0]).toMatchObject({
        isMain: true, position: 0, kind: credit.kind,
        permissionBasis: credit.basis,
        sourceFingerprint: credit.fp,
        credit: { kind: credit.kind, text: credit.text, url: credit.url },
      });
      expect((await publicVenue(v.id)).json().profile.gallery.items).toHaveLength(1);
      await pool.query("UPDATE content_moderation_approvals SET decision='reject' WHERE id=$1", [approval]);
      expect((await publicVenue(v.id)).json().profile.gallery.items).toEqual([]);
      await pool.query("UPDATE content_moderation_approvals SET decision='allow' WHERE id=$1", [approval]);
      expect((await publicVenue(v.id)).json().profile.gallery.items).toHaveLength(1);
      await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1", [actorUser]);
      expect((await publicVenue(v.id)).json().profile.gallery.items).toEqual([]);
      await pool.query("UPDATE venues SET lifecycle_state='retired' WHERE id=$1", [v.id]);
      const retired = await publicVenue(v.id);
      if (retired.statusCode === 200) expect(retired.json().profile.gallery.items).toEqual([]);
      else expect(retired.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it("enforces max 8, order, main, concurrent CAS, rollback and gallery media GC", async () => {
    const v = await venue();
    const items: string[] = [];
    let version = 1;
    for (let i = 0; i < 8; i++) {
      const color = `#${(16 + i * 20).toString(16)}0000`;
      const body = await sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).png().toBuffer();
      const saved = await add(v.id, version, owner, body);
      expect(saved.statusCode, saved.body).toBe(200);
      version = saved.json().version;
      items.push(saved.json().items[i].id);
    }
    expect((await add(v.id, version)).statusCode).toBe(409);
    const reordered = [...items].reverse();
    const reorder = await app.inject({
      method: "POST", url: `/v1/admin/venues/${v.id}/gallery/reorder`,
      headers: headers(owner, { "content-type": "application/json", "x-venue-version": String(version) }),
      payload: { expectedVersion: version, orderedIds: reordered },
    });
    expect(reorder.statusCode, reorder.body).toBe(200);
    version = reorder.json().version;
    expect(reorder.json().items.map((x: { id: string }) => x.id)).toEqual(reordered);
    expect(reorder.json().items.every((x: { position: number }) => x.position >= 0 && x.position < 8)).toBe(true);
    const mainId = reordered[3]!;
    const setMain = await app.inject({
      method: "POST", url: `/v1/admin/venues/${v.id}/gallery/${mainId}/main`,
      headers: headers(owner, { "content-type": "application/json", "x-venue-version": String(version) }),
      payload: { expectedVersion: version },
    });
    expect(setMain.statusCode, setMain.body).toBe(200);
    version = setMain.json().version;
    expect(setMain.json().items.find((x: { id: string }) => x.id === mainId)?.isMain).toBe(true);
    expect(setMain.json().items.every((x: { position: number }) => x.position >= 0 && x.position < 8)).toBe(true);
    const liveKeys = (await pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM venue_gallery_items WHERE venue_id=$1 AND active", [v.id],
    )).rows.map((row) => row.storage_key);
    expect((await pool.query(
      "SELECT 1 FROM avatar_media_gc WHERE storage_key = ANY($1::text[])", [liveKeys],
    )).rowCount).toBe(0);
    const publicItems = (await publicVenue(v.id)).json().profile.gallery.items;
    expect(publicItems[0]?.url).toBe((await publicVenue(v.id)).json().cover.uploadedUrl);
    const stale = await add(v.id, 1);
    expect(stale.statusCode).toBe(409);
    const removeTarget = reordered[0]!;
    const removed = await app.inject({
      method: "DELETE", url: `/v1/admin/venues/${v.id}/gallery/${removeTarget}`,
      headers: headers(owner, { "content-type": "application/json", "x-venue-version": String(version) }),
      payload: { expectedVersion: version },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const storageKey = (await pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM venue_gallery_items WHERE id=$1", [removeTarget],
    )).rows[0]!.storage_key;
    expect((await pool.query("SELECT 1 FROM avatar_media_gc WHERE storage_key=$1", [storageKey])).rowCount).toBe(1);
    const concurrent = await Promise.all([
      app.inject({
        method: "POST", url: `/v1/admin/venues/${v.id}/gallery/${reordered[1]}/main`,
        headers: headers(owner, { "content-type": "application/json", "x-venue-version": String(removed.json().version) }),
        payload: { expectedVersion: removed.json().version },
      }),
      app.inject({
        method: "POST", url: `/v1/admin/venues/${v.id}/gallery/${reordered[2]}/main`,
        headers: headers(owner, { "content-type": "application/json", "x-venue-version": String(removed.json().version) }),
        payload: { expectedVersion: removed.json().version },
      }),
    ]);
    expect(concurrent.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    const rollback = await readFile(path.resolve(__dirname, "../../migrations/rollback/0045_venue_gallery.sql"), "utf8");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await expect(c.query(rollback)).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      try { await c.query("ROLLBACK"); } catch { /* already rolled back */ }
      c.release();
    }
  });

  it("legacy cover replace and cover onto existing non-main gallery preserve CHECK range and skip live GC", async () => {
    // Legacy cover replace (no prior main): insert stays in CHECK range; live refs are not GC'd.
    const legacy = await venue();
    const legacyCover = await app.inject({
      method: "PUT", url: `/v1/admin/venues/${legacy.id}/cover`,
      headers: headers(owner, { "content-type": "image/png", "x-venue-version": "1" }),
      payload: png,
    });
    expect(legacyCover.statusCode, legacyCover.body).toBe(200);
    const legacyRows = (await pool.query<{ position: number; storage_key: string; is_main: boolean; active: boolean }>(
      "SELECT position, storage_key, is_main, active FROM venue_gallery_items WHERE venue_id=$1", [legacy.id],
    )).rows;
    expect(legacyRows).toHaveLength(1);
    expect(legacyRows[0]).toMatchObject({ position: 0, is_main: true, active: true });
    expect((await pool.query(
      "SELECT 1 FROM avatar_media_gc WHERE storage_key=$1", [legacyRows[0]!.storage_key],
    )).rowCount).toBe(0);
    // Cover replace onto venue that already has non-main gallery rows (insert-then-reorder path).
    const seeded = await venue();
    const first = await add(seeded.id, 1, owner);
    expect(first.statusCode, first.body).toBe(200);
    await pool.query(
      "UPDATE venue_gallery_items SET is_main=false WHERE venue_id=$1 AND active", [seeded.id],
    );
    const second = await add(seeded.id, first.json().version, owner);
    expect(second.statusCode, second.body).toBe(200);
    await pool.query(
      "UPDATE venue_gallery_items SET is_main=false WHERE venue_id=$1 AND active", [seeded.id],
    );
    const coverOntoExisting = await app.inject({
      method: "PUT", url: `/v1/admin/venues/${seeded.id}/cover`,
      headers: headers(owner, { "content-type": "image/png", "x-venue-version": String(second.json().version) }),
      payload: await sharp({ create: { width: 900, height: 600, channels: 3, background: "#003399" } }).png().toBuffer(),
    });
    expect(coverOntoExisting.statusCode, coverOntoExisting.body).toBe(200);
    const afterLegacy = (await pool.query<{ position: number; storage_key: string; is_main: boolean; active: boolean }>(
      "SELECT position, storage_key, is_main, active FROM venue_gallery_items WHERE venue_id=$1 AND active ORDER BY position",
      [seeded.id],
    )).rows;
    expect(afterLegacy.length).toBeGreaterThanOrEqual(2);
    expect(afterLegacy.every((row) => row.position >= 0 && row.position < 8)).toBe(true);
    expect(afterLegacy.filter((row) => row.is_main)).toHaveLength(1);
    expect(afterLegacy[0]!.is_main).toBe(true);
    expect((await pool.query(
      "SELECT 1 FROM avatar_media_gc WHERE storage_key = ANY($1::text[])",
      [afterLegacy.map((row) => row.storage_key)],
    )).rowCount).toBe(0);
  });

  it("normalizes mixed-uploader gallery on retirement: compact positions, elect main/cover, version bump; earlier retired stay hidden", async () => {
    const uploaderA = await actor("content_manager");
    const uploaderB = await actor("content_manager");
    const created = await app.inject({
      method: "POST", url: "/v1/admin/venues", headers: headers(uploaderA),
      payload: { cityId, name: "Synthetic mixed " + randomUUID(), address: "Synthetic address", timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62, reasonCode: "synthetic_fixture" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const v = created.json() as { id: string; version: number };
    const a0 = await add(v.id, 1, uploaderA);
    expect(a0.statusCode, a0.body).toBe(200);
    // Insert B at position 1 and second A at position 2 via direct rows so both uploaders own media.
    const fpB = "e1".repeat(32);
    const fpA2 = "e2".repeat(32);
    const approvalB = (await pool.query<{ id: string }>(
      "INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at) VALUES('image','cover_image',1,$1,'synthetic','synthetic','fake','synthetic','{}','allow',now()) RETURNING id",
      [fpB],
    )).rows[0]!.id;
    const approvalA2 = (await pool.query<{ id: string }>(
      "INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at) VALUES('image','cover_image',1,$1,'synthetic','synthetic','fake','synthetic','{}','allow',now()) RETURNING id",
      [fpA2],
    )).rows[0]!.id;
    const keyB = `${fpB}.png`;
    const keyA2 = `${fpA2}.png`;
    await pool.query(
      `INSERT INTO venue_gallery_items(
         venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
         credit_kind, credit_text, credit_url, source_url, source_author, permission_basis, source_fingerprint
       ) VALUES
       ($1,1,false,$2,$3,$4,'illustration','Иллюстрация',NULL,NULL,NULL,'Письменное согласие клуба',NULL),
       ($1,2,false,$5,$6,$7,'illustration','Иллюстрация',NULL,NULL,NULL,'Письменное согласие клуба',NULL)`,
      [v.id, keyB, approvalB, uploaderB.userId, keyA2, approvalA2, uploaderA.userId],
    );
    await pool.query("UPDATE venues SET version=version+1 WHERE id=$1", [v.id]);
    const beforeB = (await pool.query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [v.id])).rows[0]!.version;
    const contactsBefore = (await pool.query<{ public_contacts: unknown }>("SELECT public_contacts FROM venues WHERE id=$1", [v.id])).rows[0]!.public_contacts;

    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1", [uploaderB.userId]);
    const afterB = await pool.query<{ position: number; actor_id: string; is_main: boolean; active: boolean; storage_key: string }>(
      "SELECT position, actor_id, is_main, active, storage_key FROM venue_gallery_items WHERE venue_id=$1 ORDER BY position, active DESC",
      [v.id],
    );
    const activeAfterB = afterB.rows.filter((row) => row.active);
    expect(activeAfterB).toHaveLength(2);
    expect(activeAfterB.map((row) => row.position)).toEqual([0, 1]);
    expect(activeAfterB.every((row) => row.actor_id === uploaderA.userId)).toBe(true);
    expect(afterB.rows.some((row) => row.storage_key === keyB && row.active === false)).toBe(true);
    const versionAfterB = (await pool.query<{ version: number }>("SELECT version FROM venues WHERE id=$1", [v.id])).rows[0]!.version;
    expect(versionAfterB).toBe(beforeB + 1);
    expect((await pool.query("SELECT public_contacts FROM venues WHERE id=$1", [v.id])).rows[0]?.public_contacts).toEqual(contactsBefore);

    const addAfter = await add(v.id, versionAfterB, uploaderA);
    expect(addAfter.statusCode, addAfter.body).toBe(200);
    expect((addAfter.json().items as { position: number }[]).map((x) => x.position).sort()).toEqual([0, 1, 2]);

    // Separate venue: retire main uploader while another active uploader survives → elect main/cover.
    const mainOwner = await actor("content_manager");
    const otherOwner = await actor("content_manager");
    const created2 = await app.inject({
      method: "POST", url: "/v1/admin/venues", headers: headers(mainOwner),
      payload: { cityId, name: "Synthetic elect " + randomUUID(), address: "Synthetic address", timezone: "Europe/Moscow", latitude: 55.76, longitude: 37.63, reasonCode: "synthetic_fixture" },
    });
    expect(created2.statusCode, created2.body).toBe(201);
    const v2 = created2.json() as { id: string };
    const firstMain = await add(v2.id, 1, mainOwner);
    expect(firstMain.statusCode, firstMain.body).toBe(200);
    const approvalOther = (await pool.query<{ id: string }>(
      "INSERT INTO content_moderation_approvals(content_type,surface_key,fingerprint_version,content_fingerprint,policy_version,local_policy_version,provider_key,provider_model,category_flags,decision,checked_at) VALUES('image','cover_image',1,$1,'synthetic','synthetic','fake','synthetic','{}','allow',now()) RETURNING id",
      ["d".repeat(64)],
    )).rows[0]!.id;
    const keyOther = `${"d".repeat(64)}.png`;
    await pool.query(
      `INSERT INTO venue_gallery_items(
         venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
         credit_kind, credit_text, credit_url, source_url, source_author, permission_basis, source_fingerprint
       ) VALUES ($1,1,false,$2,$3,$4,'illustration','Иллюстрация',NULL,NULL,NULL,'Письменное согласие клуба',NULL)`,
      [v2.id, keyOther, approvalOther, otherOwner.userId],
    );
    const beforeMain = (await pool.query<{ version: number; cover_actor_id: string }>(
      "SELECT version, cover_actor_id FROM venues WHERE id=$1", [v2.id],
    )).rows[0]!;
    expect(beforeMain.cover_actor_id).toBe(mainOwner.userId);
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1", [mainOwner.userId]);
    const afterMain = await pool.query<{ position: number; actor_id: string; is_main: boolean; active: boolean }>(
      "SELECT position, actor_id, is_main, active FROM venue_gallery_items WHERE venue_id=$1 AND active ORDER BY position",
      [v2.id],
    );
    expect(afterMain.rows).toHaveLength(1);
    expect(afterMain.rows[0]).toMatchObject({ position: 0, actor_id: otherOwner.userId, is_main: true, active: true });
    const cover = (await pool.query<{ cover_actor_id: string; cover_key: string; version: number }>(
      "SELECT cover_actor_id, cover_key, version FROM venues WHERE id=$1", [v2.id],
    )).rows[0]!;
    expect(cover.cover_actor_id).toBe(otherOwner.userId);
    expect(cover.cover_key).toBe(keyOther);
    expect(cover.version).toBe(beforeMain.version + 1);
    expect((await publicVenue(v2.id)).json().profile.gallery.items).toHaveLength(1);
    // Earlier-retired B media stays hidden even after B reactivation.
    expect((await pool.query(
      "SELECT 1 FROM venue_gallery_items WHERE venue_id=$1 AND storage_key=$2 AND active",
      [v.id, keyB],
    )).rowCount).toBe(0);
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [uploaderB.userId]);
    expect((await pool.query(
      "SELECT 1 FROM venue_gallery_items WHERE venue_id=$1 AND storage_key=$2 AND active",
      [v.id, keyB],
    )).rowCount).toBe(0);
    expect((await publicVenue(v.id)).json().profile.gallery.items.every(
      (entry: { url: string }) => !entry.url.includes("b".repeat(16)),
    )).toBe(true);
  });

  it("preserves original uploader on projected cover when superadmin setMain; retirement clears public gallery+cover without resurrection", async () => {
    const uploader = await actor("content_manager");
    const created = await app.inject({
      method: "POST", url: "/v1/admin/venues", headers: headers(uploader),
      payload: { cityId, name: "Synthetic " + randomUUID(), address: "Synthetic address", timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62, reasonCode: "synthetic_fixture" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const v = created.json() as { id: string; version: number };
    const first = await add(v.id, 1, uploader);
    expect(first.statusCode, first.body).toBe(200);
    const second = await add(v.id, first.json().version, uploader);
    expect(second.statusCode, second.body).toBe(200);
    const itemId = (second.json().items as { id: string; isMain: boolean }[]).find((x) => !x.isMain)!.id;
    const admin = await actor("superadmin");
    const setMain = await app.inject({
      method: "POST", url: `/v1/admin/venues/${v.id}/gallery/${itemId}/main`,
      headers: headers(admin, { "content-type": "application/json", "x-venue-version": String(second.json().version) }),
      payload: { expectedVersion: second.json().version },
    });
    expect(setMain.statusCode, setMain.body).toBe(200);
    const projected = (await pool.query<{ cover_actor_id: string; cover_key: string }>(
      "SELECT cover_actor_id, cover_key FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    expect(projected.cover_actor_id).toBe(uploader.userId);
    expect(projected.cover_actor_id).not.toBe(admin.userId);
    const galleryActor = (await pool.query<{ actor_id: string }>(
      "SELECT actor_id FROM venue_gallery_items WHERE id=$1", [itemId],
    )).rows[0]!.actor_id;
    expect(galleryActor).toBe(uploader.userId);
    const liveKeys = (await pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM venue_gallery_items WHERE venue_id=$1 AND active", [v.id],
    )).rows.map((row) => row.storage_key);
    expect(liveKeys).toContain(projected.cover_key);
    expect((await pool.query(
      "SELECT 1 FROM avatar_media_gc WHERE storage_key = ANY($1::text[])", [liveKeys],
    )).rowCount).toBe(0);
    expect((await publicVenue(v.id)).json().profile.gallery.items).toHaveLength(2);
    expect((await publicVenue(v.id)).json().cover.uploadedUrl).toBeTruthy();
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1", [uploader.userId]);
    expect((await publicVenue(v.id)).json().profile.gallery.items).toEqual([]);
    expect((await publicVenue(v.id)).json().cover.uploadedUrl).toBeNull();
    expect((await pool.query("SELECT cover_key FROM venues WHERE id=$1", [v.id])).rows[0]?.cover_key).toBeNull();
    expect((await pool.query(
      "SELECT 1 FROM venue_gallery_items WHERE venue_id=$1 AND active", [v.id],
    )).rowCount).toBe(0);
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [uploader.userId]);
    expect((await publicVenue(v.id)).json().profile.gallery.items).toEqual([]);
    expect((await publicVenue(v.id)).json().cover.uploadedUrl).toBeNull();
    expect((await pool.query("SELECT cover_key FROM venues WHERE id=$1", [v.id])).rows[0]?.cover_key).toBeNull();
  });

  it("description omission preserves and explicit null clears; auth/replay failures follow cover patterns", async () => {
    const v = await venue();
    const fields = {
      cityId, name: "Synthetic gallery profile", address: "Synthetic address",
      timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62,
    };
    const edit = (profile: unknown, version: number) => app.inject({
      method: "POST", url: `/v1/admin/venues/${v.id}/commands`,
      headers: headers(),
      payload: { action: "edit", expectedVersion: version, reasonCode: "synthetic_fixture", fields: { ...fields, profile } },
    });
    const seeded = await edit({ courtCount: 2, amenities: { parking: true, showers: false }, description: "Зал у метро" }, 1);
    expect(seeded.statusCode, seeded.body).toBe(201);
    expect(seeded.json().profile.description).toBe("Зал у метро");
    const omit = await edit({ courtCount: 2, amenities: { parking: true, showers: false } }, seeded.json().version);
    expect(omit.statusCode, omit.body).toBe(201);
    expect(omit.json().profile.description).toBe("Зал у метро");
    expect((await publicVenue(v.id)).json().profile.description).toBe("Зал у метро");
    const cleared = await edit({ courtCount: 2, amenities: { parking: true, showers: false }, description: null }, omit.json().version);
    expect(cleared.statusCode, cleared.body).toBe(201);
    expect(cleared.json().profile.description).toBeNull();
    expect((await publicVenue(v.id)).json().profile.description).toBeNull();

    const galleryVersion = (await app.inject({ method: "GET", url: `/v1/admin/venues/${v.id}/gallery`, headers: headers() })).json().version as number;
    expect((await add(v.id, galleryVersion, other)).statusCode).toBe(404);
    expect((await add(v.id, galleryVersion, support)).statusCode).toBe(403);
    const key = randomUUID();
    const first = await add(v.id, galleryVersion, owner, png, "illustration", key);
    expect(first.statusCode, first.body).toBe(200);
    const replay = await add(v.id, galleryVersion, owner, png, "illustration", key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect((await add(v.id, galleryVersion, owner, png, "illustration", randomUUID())).statusCode).toBe(409);
  });
});
