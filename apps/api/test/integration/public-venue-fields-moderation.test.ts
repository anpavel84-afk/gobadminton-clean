/**
 * MOD-V2-B2a ordinary public venue name/address/description gate — isolated PostgreSQL + fake provider.
 * Covers three consumer paths, exact reuse zero egress, race-to-create failure, Admin create/edit/retired/restore,
 * clear/omit, reject+provider failure unchanged, precise bindings, migration checks.
 * Skips when RUN_DB_INTEGRATION≠1. No real provider / live DB / B2b import/credits.
 */
import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { ModerationModule } from "../../src/moderation/moderation.module";
import {
  MODERATION_MODEL,
  MODERATION_PROVIDER,
  ModerationProviderError,
  safeTextBatchDecision,
  TEXT_CATEGORIES,
} from "../../src/moderation/provider";
import { PUBLIC_TEXT_POLICY_VERSION } from "../../src/moderation/text-policy";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const webOrigin = "http://127.0.0.1:3022";
const adminOrigin = "http://localhost:19522";
const pepper = "venue-fields-mod-synthetic-admin-pepper!!";

function assertDisposableDatabase(url: string): void {
  if (process.env.RUN_DB_INTEGRATION !== "1") {
    throw new Error("RUN_DB_INTEGRATION=1 required before migrate");
  }
  if (process.env.GMAP1_DISPOSABLE_DB !== "1") {
    throw new Error("GMAP1_DISPOSABLE_DB=1 required before migrate");
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Loopback disposable PostgreSQL required");
  }
}

function flaggedTextBatch(count: number, flaggedIndex = 0) {
  return {
    model: MODERATION_MODEL,
    responseId: "synthetic-flagged-venue-fields",
    results: Array.from({ length: count }, (_, i) => ({
      flagged: i === flaggedIndex,
      categories: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, i === flaggedIndex && key === "harassment"]),
      ) as Record<(typeof TEXT_CATEGORIES)[number], boolean>,
    })),
  };
}

type Actor = {
  userId: string;
  sessionId: string;
  csrfToken: string;
  cookie: string;
};

type AdminActor = {
  id: string;
  token: string;
  csrf: string;
};

describeIntegration("MOD-V2-B2a public venue fields moderation", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let fake: FakeModerationProvider;
  let sessions: SessionService;
  let consumer: Actor;
  let admin: AdminActor;

  beforeAll(async () => {
    assertDisposableDatabase(databaseUrl);
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3022",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-fields-mod-synthetic-fingerprint!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: pepper,
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "venue-fields-mod-synthetic-pepper-only!!",
    });
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    const db = createDatabase(databaseUrl);
    pool = db.pool;
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3022",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-fields-mod-synthetic-fingerprint!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: pepper,
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "venue-fields-mod-synthetic-pepper-only!!",
    });
    fake = new FakeModerationProvider(env);
    const moduleRef = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        ProfilesModule,
        VenuesModule,
        AdminModule,
        ModerationModule,
      ],
    })
      .overrideProvider(MODERATION_PROVIDER)
      .useValue(fake)
      .compile();
    sessions = moduleRef.get(SessionService);
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    admin = await seedAdmin("content_manager");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    fake.textCalls = 0;
    fake.calls = 0;
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    consumer = await actor("Venue fields mod consumer");
    await pool.query("DELETE FROM admin_rate_windows");
  });

  async function actor(name: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, name]);
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, display_name, directory_visible, contact_policy, directory_visibility_provenance, social_eligible, version)
       VALUES ($1, $2, true, 'requests', 'owner_default', true, 1)`,
      [userId, name],
    );
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  async function seedAdmin(role: AdminRole): Promise<AdminActor> {
    const uid = (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name) VALUES('Venue fields admin') RETURNING id",
      )
    ).rows[0]!.id;
    const id = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
        [uid],
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
      [id, role],
    );
    const credential = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [credential, id, Buffer.from("synthetic-venue-fields")],
    );
    await pool.query(
      "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",
      [id, credential, hashSecret(pepper, token), sealSecret(pepper, csrf)],
    );
    return { id, token, csrf };
  }

  const key = () => `venue-fields-${randomUUID()}`;
  function consumerHeaders(who: Actor, idem = key()) {
    return {
      cookie: who.cookie,
      origin: webOrigin,
      "x-csrf-token": who.csrfToken,
      "idempotency-key": idem,
    };
  }
  function adminHeaders(idem = key()) {
    return {
      origin: adminOrigin,
      "x-csrf-token": admin.csrf,
      "idempotency-key": idem,
    };
  }
  function venuePayload(extra: Record<string, unknown> = {}) {
    const suffix = randomUUID().slice(0, 8);
    return {
      cityId: MOSCOW_CITY_ID,
      name: `Клуб Бадминтон ${suffix}`,
      address: `ул. Ленина, ${Math.floor(Math.random() * 80) + 1}`,
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
      ...extra,
    };
  }

  async function bindingsFor(venueId: string) {
    return pool.query<{
      surface_key: string;
      resource_version: number;
      binding_kind: string;
      entity_kind: string;
    }>(
      `SELECT surface_key, resource_version, binding_kind, entity_kind
       FROM content_moderation_bindings
       WHERE entity_id = $1::uuid AND entity_kind = 'venue'
       ORDER BY surface_key, resource_version`,
      [venueId],
    );
  }

  async function publicationEvidence(venueId: string, resourceVersion: number) {
    return pool.query<{
      surface_key: string;
      resource_version: number;
      binding_kind: string;
      decision: string;
      content_fingerprint: string;
      policy_version: string;
    }>(
      `SELECT b.surface_key, b.resource_version, b.binding_kind,
              a.decision, a.content_fingerprint, a.policy_version
       FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id = $1::uuid
         AND b.entity_kind = 'venue'
         AND b.binding_kind = 'publication'
         AND b.resource_version = $2
       ORDER BY b.surface_key`,
      [venueId, resourceVersion],
    );
  }

  /** Far from the shared 55.75/37.62 cluster so fuzzy neighbors do not false-409. */
  function isolatedVenuePayload(extra: Record<string, unknown> = {}) {
    const suffix = randomUUID().slice(0, 8);
    return {
      cityId: MOSCOW_CITY_ID,
      name: `Изолят Race ${suffix}`,
      address: `пр. Изолированный, ${suffix}`,
      timezone: "Europe/Moscow",
      latitude: 55.12 + (Math.random() * 0.04),
      longitude: 37.12 + (Math.random() * 0.04),
      ...extra,
    };
  }

  it("0065 migration admits venue surfaces and entity kind; rollback keeps catalogue", async () => {
    const approvals = await pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_approvals'::regclass
         AND conname = 'content_moderation_approvals_surface_key_check'`,
    );
    expect(approvals.rows[0]?.consrc).toMatch(/venue_name/);
    expect(approvals.rows[0]?.consrc).toMatch(/venue_address/);
    expect(approvals.rows[0]?.consrc).toMatch(/venue_description/);
    const kinds = await pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_bindings'::regclass
         AND conname = 'content_moderation_bindings_entity_kind_check'`,
    );
    expect(kinds.rows[0]?.consrc).toMatch(/'venue'/);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        readFileSync(
          path.join(apiRoot, "migrations/rollback/0065_moderation_venue_public_fields.sql"),
          "utf8",
        ),
      );
      expect(
        (
          await client.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.content_moderation_approvals'::regclass
               AND conname = 'content_moderation_approvals_surface_key_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/venue_name/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("consumer create/propose/confirm-distinct bind venue_name+address; exact reuse zero egress", async () => {
    const payload = venuePayload();
    const created = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: consumerHeaders(consumer),
      payload,
    });
    expect([200, 201]).toContain(created.statusCode);
    expect(fake.textCalls).toBe(1);
    const venueId = created.json().id as string;
    const bound = await bindingsFor(venueId);
    expect(bound.rows.map((r) => r.surface_key).sort()).toEqual(["venue_address", "venue_name"]);
    expect(bound.rows.every((r) => r.entity_kind === "venue" && r.binding_kind === "publication")).toBe(
      true,
    );

    fake.textCalls = 0;
    const reused = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: consumerHeaders(consumer),
      payload,
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.json().id).toBe(venueId);
    expect(fake.textCalls).toBe(0);

    // Distinct neighbor → confirm-distinct create path.
    const distinct = venuePayload({
      name: `Отдельный зал ${randomUUID().slice(0, 8)}`,
      address: payload.address,
      latitude: 55.7501,
      longitude: 37.6201,
    });
    const prompt = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: consumerHeaders(consumer),
      payload: distinct,
    });
    // May 201 (no fuzzy) or 409 (fuzzy neighbors). Either is fine for this path.
    if (prompt.statusCode === 409) {
      expect(fake.textCalls).toBe(0);
      const token = prompt.json().confirmationToken as string;
      fake.textCalls = 0;
      const confirmed = await app.inject({
        method: "POST",
        url: "/v1/venue-proposals/confirm-distinct",
        headers: consumerHeaders(consumer),
        payload: { ...distinct, confirmationToken: token },
      });
      expect([200, 201]).toContain(confirmed.statusCode);
      expect(fake.textCalls).toBe(1);
      const confirmedId = confirmed.json().id as string;
      if (confirmed.statusCode === 201) {
        const cb = await bindingsFor(confirmedId);
        expect(cb.rows.map((r) => r.surface_key).sort()).toEqual(["venue_address", "venue_name"]);
      }
    } else {
      expect([200, 201]).toContain(prompt.statusCode);
    }
  });

  it("reject and provider failure leave prior Admin values; clear/omit skip egress of private fields", async () => {
    const createPayload = {
      ...venuePayload(),
      reasonCode: "synthetic_review",
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/venues",
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    const venueId = created.json().id as string;
    const version = created.json().version as number;
    expect(fake.textCalls).toBe(1);

    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length);
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: {
        action: "edit",
        expectedVersion: version,
        reasonCode: "synthetic_review",
        fields: {
          cityId: MOSCOW_CITY_ID,
          name: "Отклонённое название",
          address: createPayload.address,
          timezone: "Europe/Moscow",
          latitude: 55.75,
          longitude: 37.62,
        },
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(rejected.json().fields?.name).toBeTruthy();

    const afterReject = await app.inject({
      method: "GET",
      url: `/v1/admin/venues/${venueId}`,
      headers: { origin: adminOrigin },
      cookies: { [ADMIN_COOKIE]: admin.token },
    });
    expect(afterReject.json().name).toBe(createPayload.name);
    expect(afterReject.json().version).toBe(version);

    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    const unavailable = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: {
        action: "edit",
        expectedVersion: version,
        reasonCode: "synthetic_review",
        fields: {
          cityId: MOSCOW_CITY_ID,
          name: "Имя при сбое",
          address: createPayload.address,
          timezone: "Europe/Moscow",
          latitude: 55.75,
          longitude: 37.62,
        },
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().code).toBe("MODERATION_TEMPORARILY_UNAVAILABLE");

    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    fake.textCalls = 0;
    // Omit description + clear profile: no public textual change → zero egress; private contacts stay internal.
    const omit = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: {
        action: "edit",
        expectedVersion: version,
        reasonCode: "synthetic_review",
        fields: {
          cityId: MOSCOW_CITY_ID,
          name: createPayload.name,
          address: createPayload.address,
          timezone: "Europe/Moscow",
          latitude: 55.75,
          longitude: 37.62,
          contactPhone: "+79990001122",
          bookingNote: "private note never egress",
        },
      },
    });
    expect(omit.statusCode).toBe(201);
    expect(fake.textCalls).toBe(0);
    expect(JSON.stringify(omit.json())).not.toMatch(/private note|79990001122/);

    fake.textCalls = 0;
    const clear = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: {
        action: "edit",
        expectedVersion: omit.json().version,
        reasonCode: "synthetic_review",
        fields: {
          cityId: MOSCOW_CITY_ID,
          name: createPayload.name,
          address: createPayload.address,
          timezone: "Europe/Moscow",
          latitude: 55.75,
          longitude: 37.62,
          profile: null,
        },
      },
    });
    expect(clear.statusCode).toBe(201);
    expect(fake.textCalls).toBe(0);
  });

  it("Admin retired edit and restore classify exact public text; retire/verify work without provider", async () => {
    const createPayload = { ...venuePayload(), reasonCode: "synthetic_review" };
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/venues",
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    const venueId = created.json().id as string;
    let version = created.json().version as number;

    fake.textCalls = 0;
    const retired = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: { action: "retire", expectedVersion: version, reasonCode: "synthetic_review" },
    });
    expect(retired.statusCode).toBe(201);
    expect(fake.textCalls).toBe(0);
    version = retired.json().version as number;

    // Public GET still resolves retired by id.
    const publicGet = await app.inject({ method: "GET", url: `/v1/venues/${venueId}` });
    expect(publicGet.statusCode).toBe(200);
    expect(publicGet.json().name).toBe(createPayload.name);

    fake.textCalls = 0;
    const editRetired = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: {
        action: "edit",
        expectedVersion: version,
        reasonCode: "synthetic_review",
        fields: {
          cityId: MOSCOW_CITY_ID,
          name: `Retired rename ${randomUUID().slice(0, 6)}`,
          address: createPayload.address,
          timezone: "Europe/Moscow",
          latitude: 55.75,
          longitude: 37.62,
          profile: {
            courtCount: 2,
            amenities: { parking: true, showers: null },
            description: "Публичное описание после retirement",
          },
        },
      },
    });
    expect(editRetired.statusCode).toBe(201);
    expect(fake.textCalls).toBe(1);
    version = editRetired.json().version as number;
    const afterEdit = await bindingsFor(venueId);
    expect(afterEdit.rows.some((r) => r.surface_key === "venue_name")).toBe(true);
    expect(afterEdit.rows.some((r) => r.surface_key === "venue_description")).toBe(true);

    fake.textCalls = 0;
    const restored = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: { action: "restore", expectedVersion: version, reasonCode: "synthetic_review" },
    });
    expect(restored.statusCode).toBe(201);
    // Same exact public text already approved at edit → provider cache may zero-egress.
    expect(fake.textCalls).toBe(0);
    version = restored.json().version as number;
    const restoreEvidence = await publicationEvidence(venueId, version);
    expect(restoreEvidence.rows.map((r) => r.surface_key).sort()).toEqual([
      "venue_address",
      "venue_description",
      "venue_name",
    ]);
    expect(
      restoreEvidence.rows.every(
        (r) =>
          r.binding_kind === "publication" &&
          r.decision === "allow" &&
          r.policy_version === PUBLIC_TEXT_POLICY_VERSION &&
          typeof r.content_fingerprint === "string" &&
          r.content_fingerprint.length === 64 &&
          r.resource_version === version,
      ),
    ).toBe(true);

    // Cold path: mutate public snapshot under retirement without prior allow cache.
    const retiredAgain = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: { action: "retire", expectedVersion: version, reasonCode: "synthetic_review" },
    });
    expect(retiredAgain.statusCode).toBe(201);
    version = retiredAgain.json().version as number;
    const coldName = `Cold restore ${randomUUID().slice(0, 8)}`;
    const coldDesc = `Cold description ${randomUUID().slice(0, 8)}`;
    await pool.query(
      `UPDATE venues
       SET name = $2,
           public_description = $3,
           normalized_name = venue_normalize_v1($2)
       WHERE id = $1`,
      [venueId, coldName, coldDesc],
    );
    fake.textCalls = 0;
    const coldRestore = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: { action: "restore", expectedVersion: version, reasonCode: "synthetic_review" },
    });
    expect(coldRestore.statusCode).toBe(201);
    expect(fake.textCalls).toBe(1);
    version = coldRestore.json().version as number;
    const coldEvidence = await publicationEvidence(venueId, version);
    expect(coldEvidence.rows.map((r) => r.surface_key).sort()).toEqual([
      "venue_address",
      "venue_description",
      "venue_name",
    ]);
    expect(coldEvidence.rows.every((r) => r.decision === "allow")).toBe(true);

    fake.textCalls = 0;
    const verified = await app.inject({
      method: "POST",
      url: `/v1/admin/venues/${venueId}/commands`,
      headers: adminHeaders(),
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload: { action: "verify", expectedVersion: version, reasonCode: "synthetic_review" },
    });
    expect(verified.statusCode).toBe(201);
    expect(fake.textCalls).toBe(0);
  });

  it("legacy empty-discriminator hall reuse is zero-egress (prepare mirrors findOrPropose)", async () => {
    const suffix = randomUUID().slice(0, 8);
    const name = `QA Спортзал зал 2 ${suffix}`;
    const address = `ул. LegacyEmpty ${suffix}`;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO venues (
         city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id,
         lifecycle_state, normalized_name, normalized_address,
         identity_discriminator
       ) VALUES (
         $1,$2,$3,'Europe/Moscow',
         ST_SetSRID(ST_MakePoint(37.05,55.05),4326)::geography,
         'unverified','legacy',$4,
         'unverified', venue_normalize_v1($2), venue_normalize_v1($3), ''
       )
       RETURNING id`,
      [MOSCOW_CITY_ID, name, address, consumer.userId],
    );
    const legacyId = inserted.rows[0]!.id;
    await pool.query(`SELECT venue_backfill_identity_keys()`);
    const keyRow = await pool.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM venue_identity_keys WHERE venue_id = $1`,
      [legacyId],
    );
    expect(keyRow.rows[0]?.dedupe_key).toBeTruthy();

    fake.textCalls = 0;
    const reused = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: consumerHeaders(consumer),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name,
        address,
        timezone: "Europe/Moscow",
        latitude: 55.05,
        longitude: 37.05,
      },
    });
    expect(reused.statusCode).toBe(200);
    expect(reused.json().id).toBe(legacyId);
    expect(fake.textCalls).toBe(0);
    const count = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM venues WHERE id = $1 OR (name = $2 AND address = $3)`,
      [legacyId, name, address],
    );
    expect(count.rows[0]!.c).toBe(1);
  });

  it("race: reuse prep cannot unchecked INSERT; stale confirm token does not replay", async () => {
    const payload = isolatedVenuePayload();
    const seeded = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: consumerHeaders(consumer),
      payload,
    });
    expect(seeded.statusCode).toBe(201);
    const seededId = seeded.json().id as string;
    const beforeCount = (
      await pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM venues WHERE name = $1 AND address = $2`,
        [payload.name, payload.address],
      )
    ).rows[0]!.c;

    // Hold catalog lock so execute blocks after readonly reuse prep.
    const locker = await pool.connect();
    const driftTag = randomUUID().slice(0, 8);
    const driftedName = `Изолят Drifted ${driftTag}`;
    const driftedAddress = `ул. Сдвинутая ${driftTag}`;
    const driftedLat = Number(payload.latitude) + 1.5;
    const driftedLon = Number(payload.longitude) + 1.5;
    let textCallsBeforeRace = fake.textCalls;
    try {
      await locker.query("BEGIN");
      await locker.query(
        "SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))",
      );
      const racePromise = app.inject({
        method: "POST",
        url: "/v1/venues",
        headers: consumerHeaders(consumer),
        payload,
      });
      // Wait until the racing execute is blocked on the catalog advisory lock
      // (proves readonly reuse prep finished while the identity key still existed).
      let blocked = false;
      for (let i = 0; i < 80; i++) {
        const waiting = await locker.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM pg_locks
           WHERE locktype = 'advisory' AND NOT granted AND pid <> pg_backend_pid()`,
        );
        if ((waiting.rows[0]?.n ?? 0) > 0) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(true);
      // Lawful concurrent identity/location drift after readonly reuse prep:
      // remove the prepared exact key AND move the row off fuzzy reach so execute
      // must attempt INSERT (create-without-prepared-text) → VENUE_TEXT_PREPARE_STALE.
      // Deleting keys alone leaves same geo/name/address → fuzzy VENUE_POSSIBLE_DUPLICATE.
      textCallsBeforeRace = fake.textCalls;
      await locker.query(
        `UPDATE venues
         SET name = $2,
             address = $3,
             normalized_name = venue_normalize_v1($2),
             normalized_address = venue_normalize_v1($3),
             location = ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
             identity_discriminator = ''
         WHERE id = $1`,
        [seededId, driftedName, driftedAddress, driftedLon, driftedLat],
      );
      await locker.query(`DELETE FROM venue_identity_keys WHERE venue_id = $1`, [
        seededId,
      ]);
      await locker.query("COMMIT");
      const raced = await racePromise;
      expect(raced.statusCode).toBe(409);
      expect(raced.json().code).toBe("VENUE_TEXT_PREPARE_STALE");
      expect(fake.textCalls).toBe(textCallsBeforeRace);
    } finally {
      try {
        await locker.query("ROLLBACK");
      } catch {
        /* already committed/released */
      }
      locker.release();
    }
    // Seed lawfully drifted off the racing payload identity; INSERT rolled back.
    const originalIdentityCount = (
      await pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM venues WHERE name = $1 AND address = $2`,
        [payload.name, payload.address],
      )
    ).rows[0]!.c;
    expect(beforeCount).toBe(1);
    expect(originalIdentityCount).toBe(0);
    const driftedSeed = await pool.query<{ name: string; address: string }>(
      `SELECT name, address FROM venues WHERE id = $1`,
      [seededId],
    );
    expect(driftedSeed.rows).toHaveLength(1);
    expect(driftedSeed.rows[0]!.name).toBe(driftedName);
    expect(driftedSeed.rows[0]!.address).toBe(driftedAddress);
    const orphanBindings = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM content_moderation_bindings b
       WHERE b.entity_kind = 'venue'
         AND b.binding_kind = 'publication'
         AND b.entity_id <> $1::uuid
         AND EXISTS (
           SELECT 1 FROM venues v
           WHERE v.id = b.entity_id AND v.name = $2 AND v.address = $3
         )`,
      [seededId, payload.name, payload.address],
    );
    expect(orphanBindings.rows[0]!.c).toBe(0);

    // Stale confirm-token path (title claims it): force a fuzzy neighbor pair.
    const tokenActor = await actor("Venue fields stale-token");
    const tokenTag = randomUUID().slice(0, 8);
    const tokenBase = isolatedVenuePayload({
      name: `Изолят База ${tokenTag}`,
      address: `улица ${tokenTag}`,
    });
    const base = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: consumerHeaders(tokenActor),
      payload: tokenBase,
    });
    expect(base.statusCode).toBe(201);
    const neighbor = {
      ...tokenBase,
      name: `Изолят База сосед ${tokenTag}`,
      latitude: tokenBase.latitude + 0.00015,
      longitude: tokenBase.longitude + 0.00015,
    };
    const fuzzy = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals",
      headers: consumerHeaders(tokenActor),
      payload: neighbor,
    });
    expect(fuzzy.statusCode).toBe(409);
    const token = fuzzy.json().confirmationToken as string;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    await pool.query(
      `UPDATE venue_proposal_confirm_tokens
       SET expires_at = now() - interval '1 minute'
       WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
      [token],
    );
    fake.textCalls = 0;
    const stale = await app.inject({
      method: "POST",
      url: "/v1/venue-proposals/confirm-distinct",
      headers: consumerHeaders(tokenActor),
      payload: { ...neighbor, confirmationToken: token },
    });
    expect(stale.statusCode).toBe(422);
    expect(fake.textCalls).toBe(0);
    const used = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM venue_proposal_confirm_tokens
       WHERE token_hash = encode(digest($1, 'sha256'), 'hex') AND used_at IS NOT NULL`,
      [token],
    );
    expect(used.rows[0]!.c).toBe(0);

    // Same-key success replay after revoke is denied by session fences in MutationRunner.
    const idem = key();
    const secondPayload = isolatedVenuePayload();
    const second = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: consumerHeaders(consumer, idem),
      payload: secondPayload,
    });
    expect([200, 201]).toContain(second.statusCode);
    await pool.query("UPDATE app_sessions SET revoked_at = now() WHERE id = $1", [
      consumer.sessionId,
    ]);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: consumerHeaders(consumer, idem),
      payload: secondPayload,
    });
    expect([401, 403]).toContain(replay.statusCode);
  });
});
