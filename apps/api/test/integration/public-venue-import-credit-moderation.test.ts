/**
 * MOD-V2-B2b public-data description + gallery/cover credit gates — disposable PostGIS + fake provider.
 * Covers 3 import modes + Admin gallery credit API; dry-run/replay/noop/provider0; exact credit bindings;
 * text reject/503 preserve old fields; tampered admission; concurrent claim. No real illegal images.
 * Skips when RUN_DB_INTEGRATION≠1. Own synthetic budget isolation between cases.
 */
import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { loadEnv } from "../../src/config/env";
import {
  importVenueCovers,
  importVenueGallery,
  importVenuePublicData,
} from "../../src/database/import-venue-covers";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { ContentModerationService } from "../../src/moderation/moderation.service";
import {
  MODERATION_MODEL,
  MODERATION_PROVIDER,
  ModerationProviderError,
  safeImageDecision,
  safeTextBatchDecision,
  TEXT_CATEGORIES,
} from "../../src/moderation/provider";
import { PUBLIC_TEXT_POLICY_VERSION } from "../../src/moderation/text-policy";
import { AvatarService } from "../../src/profiles/avatar.service";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { validateManifest } from "../../src/venues/venue-cover-import";
import { validateGalleryManifest } from "../../src/venues/venue-gallery-import";
import {
  needsCreditTextPrepare,
  needsPublicDataTextPrepare,
  TRUSTED_ILLUSTRATION_CREDIT,
} from "../../src/venues/venue-import-moderation";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const adminOrigin = "http://localhost:19606";
const pepper = "venue-import-credit-mod-pepper-32chars!!";
const city = "a0000000-0000-4000-8000-000000000001";

function flaggedTextBatch(count: number, flaggedIndex = 0) {
  return {
    model: MODERATION_MODEL,
    responseId: "synthetic-flagged-venue-import-credit",
    results: Array.from({ length: count }, (_, i) => ({
      flagged: i === flaggedIndex,
      categories: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, i === flaggedIndex && key === "harassment"]),
      ) as Record<(typeof TEXT_CATEGORIES)[number], boolean>,
    })),
  };
}

run("MOD-V2-B2b public venue import + credit moderation", () => {
  const dbName = "venue_import_credit_" + randomUUID().replaceAll("-", "");
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let app: NestFastifyApplication;
  let mediaRoot: string;
  let fake: FakeModerationProvider;
  let moderation: ContentModerationService;
  let media: AvatarService;
  let actorPrincipal: string;
  let actorUserId: string;
  let adminActor: { id: string; token: string; csrf: string };
  let png: Buffer;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    const url = new URL(process.env.DATABASE_URL);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("Disposable loopback DB required");
    }
    admin = new Pool({ connectionString: url.href });
    await admin.query(`CREATE DATABASE "${dbName}"`);
    url.pathname = `/${dbName}`;
    pool = new Pool({ connectionString: url.href });
    const migrations = path.resolve(__dirname, "../../migrations");
    const { readdir, readFile } = await import("node:fs/promises");
    await pool.query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await pool.query(await readFile(path.join(migrations, file), "utf8"));
      await pool.query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
    }
    mediaRoot = await mkdtemp(path.join(tmpdir(), "venue-import-credit-"));
    png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#224466" },
    }).png().toBuffer();
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: url.href,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3066",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3067",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:3067",
      AUTH_PEPPER: "venue-import-credit-consumer-pepper-32c",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: pepper,
      AVATAR_MEDIA_ROOT: mediaRoot,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-import-credit-fingerprint-32ch",
      COOKIE_SECURE: "false",
    });
    fake = new FakeModerationProvider(env);
    moderation = new ContentModerationService(pool, env, fake);
    const idempotency = new IdempotencyService(pool, env);
    const mutations = new MutationRunner(pool, idempotency, new ActorFenceService(env), env);
    media = new AvatarService(pool, env, mutations, moderation, idempotency);
    const moduleRef = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AdminModule, VenuesModule, ProfilesModule],
    })
      .overrideProvider(MODERATION_PROVIDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    registerAvatarHttp(app.getHttpAdapter().getInstance());
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const user = (await pool.query<{ id: string }>(
      "INSERT INTO users(display_name) VALUES('B2b import credit actor') RETURNING id",
    )).rows[0]!;
    actorUserId = user.id;
    const principal = (await pool.query<{ id: string }>(
      "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
      [actorUserId],
    )).rows[0]!;
    actorPrincipal = principal.id;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'superadmin','synthetic')",
      [actorPrincipal],
    );
    adminActor = await seedAdmin("superadmin");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await admin.end();
    }
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fake.textCalls = 0;
    fake.calls = 0;
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    fake.fixture = async () => safeImageDecision();
    // Isolate synthetic budgets between unrelated cases (not production caps).
    await pool!.query("DELETE FROM content_moderation_rate_budgets");
    await pool!.query("DELETE FROM admin_rate_windows");
  });

  async function seedAdmin(role: AdminRole) {
    const uid = (await pool!.query<{ id: string }>(
      "INSERT INTO users(display_name) VALUES('B2b gallery admin') RETURNING id",
    )).rows[0]!.id;
    const id = (await pool!.query<{ id: string }>(
      "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
      [uid],
    )).rows[0]!.id;
    await pool!.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic')",
      [id, role],
    );
    const credential = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool!.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [credential, id, Buffer.from("synthetic-b2b")],
    );
    await pool!.query(
      "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",
      [id, credential, hashSecret(pepper, token), sealSecret(pepper, csrf)],
    );
    return { id, token, csrf };
  }

  async function seedVenue(name = `Arena ${randomUUID().slice(0, 8)}`, address?: string) {
    const id = randomUUID();
    const addr = address ?? `Street ${id.slice(0, 8)}`;
    await pool!.query(
      `INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,
         normalized_name,normalized_address,identity_discriminator,public_description)
       VALUES($1,$2,$3,$4,'Europe/Moscow',ST_SetSRID(ST_MakePoint(37.62,55.75),4326)::geography,$5,'verified',$3,$4,'',NULL)`,
      [id, city, name, addr, actorUserId],
    );
    return { id, name, address: addr };
  }

  /** Deterministic distinct benign JPEG per label — fixed RGB caused cover/gallery dedup SKIP. */
  async function jpeg(label: string) {
    const digest = createHash("sha256").update(label).digest();
    const r = 40 + (digest[0]! % 200);
    const g = digest[1]!;
    const b = digest[2]!;
    return sharp({
      create: { width: 900, height: 600, channels: 3, background: { r, g, b } },
    }).jpeg().toBuffer();
  }

  it("0066 admits venue_credit_text and venue_gallery_item; helper fences trusted illustration", async () => {
    const approvals = await pool!.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_approvals'::regclass
         AND conname = 'content_moderation_approvals_surface_key_check'`,
    );
    expect(approvals.rows[0]?.consrc).toMatch(/venue_credit_text/);
    const kinds = await pool!.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_bindings'::regclass
         AND conname = 'content_moderation_bindings_entity_kind_check'`,
    );
    expect(kinds.rows[0]?.consrc).toMatch(/venue_gallery_item/);
    expect(needsCreditTextPrepare({
      creditKind: "illustration", creditText: TRUSTED_ILLUSTRATION_CREDIT,
    })).toBe(false);
    expect(needsCreditTextPrepare({ creditKind: "photo", creditText: "Фото: Клуб" })).toBe(true);
    expect(needsPublicDataTextPrepare(
      { public_description: null },
      {
        venueId: randomUUID(),
        expectedVersion: 1,
        expectedName: "A",
        expectedAddress: "B",
        sources: [{ url: "https://example.com/", checkedAt: "2026-11-01T00:00:00.000Z", note: "private" }],
        profile: { courtCount: 1, amenities: { parking: false, showers: false }, description: "Новое описание зала" },
      } as never,
    )).toBe(true);
    expect(needsPublicDataTextPrepare(
      { public_description: "То же" },
      {
        venueId: randomUUID(),
        expectedVersion: 1,
        expectedName: "A",
        expectedAddress: "B",
        sources: [{ url: "https://example.com/", checkedAt: "2026-11-01T00:00:00.000Z", note: "private" }],
        profile: { courtCount: 1, amenities: { parking: false, showers: false }, description: "То же" },
      } as never,
    )).toBe(false);
  });

  it("public-data: dry-run/noop/clear zero egress; changed description binds; reject preserves old", async () => {
    const v = await seedVenue();
    const sources = [{ url: "https://example.com/src", checkedAt: "2026-11-01T12:00:00.000Z", note: "PRIVATE NOTE" }];
    const base = {
      schema: "VENUE_PUBLIC_DATA_BATCH_V1" as const,
      batch: `pd-${randomUUID().slice(0, 8)}`,
      count: 1,
      items: [{
        venueId: v.id,
        expectedVersion: 1,
        expectedName: v.name,
        expectedAddress: v.address,
        profile: { courtCount: 2, amenities: { parking: true, showers: false } },
        sources,
      }],
    };
    const lines: object[] = [];
    const textBefore = fake.textCalls;
    expect(await importVenuePublicData(pool!, base, actorPrincipal, false, (l) => lines.push(l), { moderation })).toBe(0);
    expect(fake.textCalls).toBe(textBefore);
    expect(await importVenuePublicData(pool!, base, actorPrincipal, true, () => undefined, { moderation })).toBe(0);
    expect(fake.textCalls).toBe(textBefore); // no description → zero text egress
    const row1 = (await pool!.query<{ public_description: string | null; version: number }>(
      "SELECT public_description, version FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    expect(row1.public_description).toBeNull();

    const withDesc = {
      ...base,
      batch: `pd-desc-${randomUUID().slice(0, 8)}`,
      items: [{
        ...base.items[0]!,
        expectedVersion: row1.version,
        profile: {
          courtCount: 2,
          amenities: { parking: true, showers: false },
          description: "Светлый зал с хорошим покрытием",
        },
      }],
    };
    expect(await importVenuePublicData(pool!, withDesc, actorPrincipal, true, () => undefined, { moderation })).toBe(0);
    expect(fake.textCalls).toBe(textBefore + 1);
    const row2 = (await pool!.query<{ public_description: string | null; version: number }>(
      "SELECT public_description, version FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    expect(row2.public_description).toBe("Светлый зал с хорошим покрытием");
    const binds = await pool!.query(
      `SELECT surface_key, entity_kind, binding_kind FROM content_moderation_bindings
       WHERE entity_id=$1 AND surface_key='venue_description'`,
      [v.id],
    );
    expect(binds.rowCount).toBe(1);
    expect(binds.rows[0]).toMatchObject({
      surface_key: "venue_description",
      entity_kind: "venue",
      binding_kind: "publication",
    });

    // Rejected description leaves old value.
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length);
    const bad = {
      ...withDesc,
      batch: `pd-bad-${randomUUID().slice(0, 8)}`,
      items: [{
        ...withDesc.items[0]!,
        expectedVersion: row2.version,
        profile: {
          courtCount: 2,
          amenities: { parking: true, showers: false },
          description: "Плохой текст для отказа",
        },
      }],
    };
    const failLines: object[] = [];
    expect(await importVenuePublicData(pool!, bad, actorPrincipal, true, (l) => failLines.push(l), { moderation })).toBe(1);
    expect(failLines).toContainEqual(expect.objectContaining({
      action: "FAILED", reason: "PUBLIC_TEXT_CONTENT_REJECTED",
    }));
    const row3 = (await pool!.query<{ public_description: string | null; version: number }>(
      "SELECT public_description, version FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    expect(row3.public_description).toBe("Светлый зал с хорошим покрытием");
    expect(row3.version).toBe(row2.version);

    // Known replay zero egress.
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    const replayCalls = fake.textCalls;
    expect(await importVenuePublicData(pool!, withDesc, actorPrincipal, true, () => undefined, { moderation })).toBe(0);
    expect(fake.textCalls).toBe(replayCalls);
  });

  it("gallery import + Admin API: free credit binds; illustration skips text; reject keeps old", async () => {
    const v = await seedVenue("Gallery Hall", "Gallery St 1");
    // Seed empty main via cover illustration (trusted — zero text).
    const bytes = await jpeg("cover-ill");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const coverBatch = {
      manifest: validateManifest({
        schema: "VENUE_COVER_BATCH_V1",
        batch: `cov-${randomUUID().slice(0, 8)}`,
        count: 1,
        items: [{
          venueId: v.id,
          file: `${v.id}.jpg`,
          sha256: sha,
          kind: "illustration",
          credit_text: TRUSTED_ILLUSTRATION_CREDIT,
          source_page_url: null,
          basis_note: "PRIVATE BASIS",
        }],
      }),
      images: new Map([[v.id, bytes]]),
    };
    const text0 = fake.textCalls;
    expect(await importVenueCovers(pool!, coverBatch, actorPrincipal, true, { media, moderation }, () => undefined)).toBe(0);
    expect(fake.textCalls).toBe(text0); // trusted illustration

    const version = (await pool!.query<{ version: number }>(
      "SELECT version FROM venues WHERE id=$1", [v.id],
    )).rows[0]!.version;
    const append = await jpeg("gal-append");
    const appendSha = createHash("sha256").update(append).digest("hex");
    const file = `${v.id}-${appendSha.slice(0, 16)}.jpg`;
    const gal = {
      manifest: validateGalleryManifest({
        schema: "VENUE_GALLERY_BATCH_V1",
        batch: `gal-${randomUUID().slice(0, 8)}`,
        count: 1,
        items: [{
          venueId: v.id,
          expectedName: "Gallery Hall",
          expectedAddress: "Gallery St 1",
          expectedVersion: version,
          file,
          sha256: appendSha,
          evidence: {
            creditKind: "photo",
            creditText: "Фото: Спортивный клуб",
            creditUrl: "https://example.com/photo",
            sourceUrl: "https://example.com/photo",
            sourceAuthor: null,
            permissionBasis: "Письменное согласие клуба",
            sourceFingerprint: appendSha,
          },
        }],
      }),
      images: new Map([[file, append]]),
    };
    expect(await importVenueGallery(pool!, gal, actorPrincipal, true, { media, moderation }, () => undefined)).toBe(0);
    expect(fake.textCalls).toBe(text0 + 1);
    const creditBinds = await pool!.query(
      `SELECT b.entity_kind, b.surface_key, a.policy_version
       FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.surface_key='venue_credit_text' AND b.entity_kind='venue_gallery_item'`,
    );
    expect(creditBinds.rowCount).toBeGreaterThanOrEqual(1);
    expect(creditBinds.rows[0]?.policy_version).toBe(PUBLIC_TEXT_POLICY_VERSION);

    // Admin gallery add with rejected credit — prior cover/main unchanged.
    const venueRow = (await pool!.query<{ version: number; cover_credit_text: string | null }>(
      "SELECT version, cover_credit_text FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length);
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${v.id}/gallery`,
      headers: {
        origin: adminOrigin,
        cookie: `${ADMIN_COOKIE}=${adminActor.token}`,
        "x-csrf-token": adminActor.csrf,
        "idempotency-key": `gal-api-${randomUUID()}`,
        "content-type": "image/png",
        "x-venue-version": String(venueRow.version),
        "x-gallery-credit-kind": "photo",
        "x-gallery-credit-text": encodeURIComponent("Фото: Отказ"),
        "x-gallery-credit-url": encodeURIComponent("https://example.com/rej"),
        "x-gallery-source-url": encodeURIComponent("https://example.com/rej"),
        "x-gallery-source-author": "null",
        "x-gallery-permission-basis": encodeURIComponent("Письменное согласие клуба"),
        "x-gallery-source-fingerprint": "null",
      },
      payload: png,
    });
    expect(res.statusCode, res.body).toBe(422);
    const after = (await pool!.query<{ version: number; cover_credit_text: string | null }>(
      "SELECT version, cover_credit_text FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    expect(after.version).toBe(venueRow.version);
    expect(after.cover_credit_text).toBe(venueRow.cover_credit_text);
  });

  it("provider 503 on public-data description leaves fields; private provenance never forwarded", async () => {
    const v = await seedVenue();
    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable");
    };
    const manifest = {
      schema: "VENUE_PUBLIC_DATA_BATCH_V1" as const,
      batch: `pd503-${randomUUID().slice(0, 8)}`,
      count: 1,
      items: [{
        venueId: v.id,
        expectedVersion: 1,
        expectedName: v.name,
        expectedAddress: v.address,
        profile: {
          courtCount: 1,
          amenities: { parking: false, showers: false },
          description: "Описание при недоступности",
        },
        sources: [{ url: "https://example.com/p", checkedAt: "2026-11-01T00:00:00.000Z", note: "SECRET_NOTE_NEVER" }],
      }],
    };
    const lines: object[] = [];
    expect(await importVenuePublicData(pool!, manifest, actorPrincipal, true, (l) => lines.push(l), { moderation })).toBe(1);
    expect(lines).toContainEqual(expect.objectContaining({
      action: "HOLD",
      reason: expect.stringMatching(/MODERATION_TEMPORARILY_UNAVAILABLE|MODERATION_POLICY_MISMATCH/),
    }));
    const row = (await pool!.query<{ public_description: string | null; version: number }>(
      "SELECT public_description, version FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    expect(row.public_description).toBeNull();
    expect(row.version).toBe(1);

    // Retained attempt + same batch changed to clear/omit → CONFLICT, no mutation, no paid retry.
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    const textBefore = fake.textCalls;
    const clearManifest = {
      ...manifest,
      items: [{
        ...manifest.items[0]!,
        profile: {
          courtCount: 1,
          amenities: { parking: false, showers: false },
          description: null,
        },
      }],
    };
    const clearLines: object[] = [];
    expect(await importVenuePublicData(
      pool!, clearManifest, actorPrincipal, true, (l) => clearLines.push(l), { moderation },
    )).toBe(1);
    expect(clearLines).toContainEqual(expect.objectContaining({
      action: "FAILED", reason: "PUBLIC_DATA_CONFLICT",
    }));
    expect(fake.textCalls).toBe(textBefore);
    const afterClear = (await pool!.query<{ public_description: string | null; version: number }>(
      "SELECT public_description, version FROM venues WHERE id=$1", [v.id],
    )).rows[0]!;
    expect(afterClear).toEqual(row);

    // Exact same retained input → HOLD UNKNOWN, zero egress (no paid retry).
    const replayLines: object[] = [];
    expect(await importVenuePublicData(
      pool!, manifest, actorPrincipal, true, (l) => replayLines.push(l), { moderation },
    )).toBe(1);
    expect(replayLines).toContainEqual(expect.objectContaining({
      action: "HOLD", reason: "OPERATION_OUTCOME_UNKNOWN",
    }));
    expect(fake.textCalls).toBe(textBefore);
    expect((await pool!.query<{ public_description: string | null; version: number }>(
      "SELECT public_description, version FROM venues WHERE id=$1", [v.id],
    )).rows[0]).toEqual(row);
  });
});
