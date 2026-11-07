/**
 * MOD-V2-B1c public venue-review text gate — isolated PostgreSQL + fake provider.
 * Skips when RUN_DB_INTEGRATION≠1. No real provider / live DB / private body egress.
 */
import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { ModerationModule } from "../../src/moderation/moderation.module";
import {
  MODERATION_MODEL,
  MODERATION_PROVIDER,
  ModerationProviderError,
  safeTextBatchDecision,
  TEXT_CATEGORIES,
} from "../../src/moderation/provider";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { projectionHash } from "../../src/venues/venue-reviews.policy";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const webOrigin = "http://127.0.0.1:3016";
const adminOrigin = "http://localhost:19516";
const pepper = "venue-review-mod-synthetic-admin-pepper!!";

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

function flaggedTextBatch(
  count: number,
  category: (typeof TEXT_CATEGORIES)[number] = "harassment",
) {
  return {
    model: MODERATION_MODEL,
    responseId: "synthetic-flagged-venue-review",
    results: Array.from({ length: count }, () => ({
      flagged: true,
      categories: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, key === category]),
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
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

describeIntegration("MOD-V2-B1c public venue-review moderation", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  const migrations = path.join(apiRoot, "migrations");
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";
  let app: NestFastifyApplication;
  let pool: Pool;
  let fake: FakeModerationProvider;
  let sessions: SessionService;
  let organizer: Actor;
  let participant: Actor;
  let reviewer: AdminActor;

  beforeAll(async () => {
    assertDisposableDatabase(databaseUrl);
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3016",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-review-mod-synthetic-fingerprint!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      POST_GAME_INTERNAL_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      CASES_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: pepper,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "venue-review-mod-synthetic-pepper-only!!",
    });
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "venue-review-mod-synthetic",
    });
    const existing = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'",
    );
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(await readFile(path.join(migrations, file), "utf8"));
        await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [
          file.replace(/\.sql$/, ""),
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    const env = loadEnv({ ...process.env });
    fake = new FakeModerationProvider(env);
    const moduleRef = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        ProfilesModule,
        GamesModule,
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
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    fake.textCalls = 0;
    fake.calls = 0;
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    organizer = await actor("Venue rev org");
    participant = await actor("Venue rev part");
    reviewer = await adminActor("superadmin");
  });

  async function actor(name: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id, display_name, status) VALUES($1,$2,'active')", [
      userId,
      name,
    ]);
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

  async function adminActor(role: AdminRole): Promise<AdminActor> {
    const userId = randomUUID();
    await pool.query(`INSERT INTO users (id, status, display_name) VALUES ($1, 'active', $2)`, [
      userId,
      `admin-${role}`,
    ]);
    const id = (
      await pool.query(
        "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
        [userId],
      )
    ).rows[0].id as string;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
      [id, role],
    );
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [credentialId, id, Buffer.from("synthetic-venue-review-mod")],
    );
    const sessionId = (
      await pool.query(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [id, credentialId, hashSecret(pepper, token), sealSecret(pepper, csrf)],
      )
    ).rows[0].id as string;
    await pool.query("UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE id=$1", [
      sessionId,
    ]);
    return { id, userId, token, csrf, sessionId };
  }

  async function seedHeldGame() {
    const endsAt = new Date(Date.now() - 2 * 86400000);
    const venue = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(
           city_id, name, address, timezone, location, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address
         ) VALUES (
           $1, 'VenueRev Mod Court', 'Synthetic address', 'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography, $2,
           'unverified', 'venuerev mod court', 'synthetic address'
         ) RETURNING id`,
        [MOSCOW_CITY_ID, organizer.userId],
      )
    ).rows[0]!;
    const gameId = randomUUID();
    const starts = new Date(endsAt.getTime() - 3600_000);
    const deadline = new Date(starts.getTime() - 3600_000);
    await pool.query(
      `INSERT INTO games (
         id, version, title, status, visibility, activity_kind, venue_id,
         starts_at, ends_at, timezone, application_deadline_at,
         capacity, external_reserved_count,
         format_key, level_scale_id, level_scale_version, allowed_level_ids,
         settlement_mode, settlement_purpose, settlement_terms,
         created_by_user_id, host_display_name, host_public_contact,
         published_at
       ) VALUES (
         $1, 1, 'Game', 'completed', 'public', 'regular', $2,
         $3, $4, 'Europe/Moscow', $5,
         4, 0,
         'doubles', 'ntrp', 1, '["3.0","3.5"]'::jsonb,
         'external', 'no_trainer_fee', 'Synthetic settlement terms',
         $6, 'Host', 'host@example.test',
         clock_timestamp()
       )`,
      [gameId, venue.id, starts.toISOString(), endsAt.toISOString(), deadline.toISOString(), organizer.userId],
    );
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [gameId, organizer.userId],
    );
    const participationId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, $3, 'confirmed', $4)`,
      [participationId, gameId, participant.userId, starts.toISOString()],
    );
    await pool.query(
      `INSERT INTO participation_transitions
         (id, participation_id, from_status, to_status, actor_id, reason_code,
          aggregate_version, game_version, at)
       VALUES ($1, $2, NULL, 'confirmed', $3, 'test_confirm', 1, 1, $4)`,
      [randomUUID(), participationId, participant.userId, starts.toISOString()],
    );
    const heldAt = new Date(endsAt.getTime() + 60_000);
    await pool.query(
      `INSERT INTO game_outcomes
         (game_id, value, version, reason, source, actor_user_id, recorded_at, updated_at)
       VALUES ($1, 'held', 1, null, 'manager_explicit', $2, $3, $3)`,
      [gameId, organizer.userId, heldAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_outcome_revisions
         (game_id, resource_version, actor_user_id, source,
          before_value, after_value, before_reason, after_reason, reason, recorded_at)
       VALUES ($1, 1, $2, 'manager_explicit', NULL, 'held', NULL, NULL, NULL, $3)`,
      [gameId, organizer.userId, heldAt.toISOString()],
    );
    const presentAt = new Date(heldAt.getTime() + 60_000);
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id, game_id, user_id, value, late, source, actor_user_id, version,
          recorded_at, updated_at)
       VALUES ($1, $2, $3, 'present', false, 'manager_explicit', $4, 1, $5, $5)`,
      [participationId, gameId, participant.userId, organizer.userId, presentAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          recorded_at, before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',$5,NULL,'present',NULL,false,NULL,NULL)`,
      [participationId, gameId, participant.userId, organizer.userId, presentAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_played_at_venue_attributions
         (game_id, source_venue_id, game_version, source, actor_user_id, recorded_at)
       VALUES ($1, $2, 1, 'held_confirm', $3, $4)`,
      [gameId, venue.id, organizer.userId, heldAt.toISOString()],
    );
    return { gameId, venueId: venue.id };
  }

  const key = () => `venue-mod-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return {
      cookie: who.cookie,
      origin: webOrigin,
      "x-csrf-token": who.csrfToken,
      "idempotency-key": idem,
    };
  }

  async function submitPublic(text: string, topics: string[] = ["surface"]) {
    const { gameId, venueId } = await seedHeldGame();
    const consentProjectionHash = projectionHash({
      canonicalVenueId: venueId,
      audience: "public_venue",
      text,
      topics,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews",
      headers: headers(participant),
      payload: {
        venueId,
        gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text,
        topics,
        consentProjectionHash,
      },
    });
    return { res, gameId, venueId };
  }

  it("self_draft create has zero provider calls", async () => {
    const { gameId, venueId } = await seedHeldGame();
    const baseline = fake.textCalls;
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews",
      headers: headers(participant),
      payload: {
        venueId,
        gameId,
        audience: "self_draft",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: "Личный черновик без внешней проверки",
        topics: ["surface"],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("self_draft");
    expect(fake.textCalls).toBe(baseline);
  });

  it("ALLOW still creates human pending + candidate binding; never auto-publishes", async () => {
    const text = "Покрытие слабое, после дождя лужи не убирали";
    const { res } = await submitPublic(text);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toMatch(/submitted|revision_waiting/);
    expect(fake.textCalls).toBe(1);
    const slot = await pool.query<{ status: string; pending_revision_id: string }>(
      `SELECT status, pending_revision_id FROM venue_review_slots WHERE public_handle=$1`,
      [res.json().reviewHandle],
    );
    expect(slot.rows[0]?.pending_revision_id).toBeTruthy();
    const binding = await pool.query(
      `SELECT b.binding_kind, b.entity_kind, a.decision, a.surface_key,
              b.venue_review_decision_id
       FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id = $1::uuid AND b.binding_kind = 'candidate'`,
      [slot.rows[0]!.pending_revision_id],
    );
    expect(binding.rows[0]).toMatchObject({
      binding_kind: "candidate",
      entity_kind: "venue_review_revision",
      decision: "allow",
      surface_key: "venue_review_body",
      venue_review_decision_id: null,
    });
    const published = await pool.query(
      `SELECT 1 FROM content_moderation_bindings
       WHERE entity_id=$1::uuid AND binding_kind='publication'`,
      [slot.rows[0]!.pending_revision_id],
    );
    expect(published.rowCount).toBe(0);
  });

  it("soft harassment stays pendingreview; hard reject retains tip; withdraw zero egress", async () => {
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, "harassment");
    const soft = await submitPublic("Негативная критика покрытия без угроз");
    expect(soft.res.statusCode).toBe(200);
    const revId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM venue_review_slots WHERE public_handle=$1`,
        [soft.res.json().reviewHandle],
      )
    ).rows[0]!.pending_revision_id;
    const decision = await pool.query<{ decision: string }>(
      `SELECT a.decision FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id=$1::uuid AND b.binding_kind='candidate'`,
      [revId],
    );
    expect(decision.rows[0]?.decision).toBe("review");

    const reviewId = soft.res.json().id as string;
    const version = soft.res.json().version as number;
    const baseline = fake.textCalls;
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, "sexual/minors");
    const editText = "Замена с жёстким отказом";
    const consentProjectionHash = projectionHash({
      canonicalVenueId: soft.venueId,
      audience: "public_venue",
      text: editText,
      topics: ["surface"],
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: {
        action: "submit_revision",
        expectedVersion: version,
        gameId: soft.gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: editText,
        topics: ["surface"],
        consentProjectionHash,
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(fake.textCalls).toBe(baseline + 1);
    const tip = await pool.query<{ body: string }>(
      `SELECT r.body_text AS body FROM venue_review_slots s
       JOIN venue_review_revisions r ON r.id = s.pending_revision_id
       WHERE s.id=$1`,
      [reviewId],
    );
    expect(tip.rows[0]?.body).toBe("Негативная критика покрытия без угроз");

    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    const afterHard = fake.textCalls;
    const unavailable = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: {
        action: "submit_revision",
        expectedVersion: version,
        gameId: soft.gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: "Текст при недоступности",
        topics: ["surface"],
        consentProjectionHash: projectionHash({
          canonicalVenueId: soft.venueId,
          audience: "public_venue",
          text: "Текст при недоступности",
          topics: ["surface"],
        }),
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().code).toBe("MODERATION_TEMPORARILY_UNAVAILABLE");

    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: { action: "withdraw", expectedVersion: version },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(fake.textCalls).toBe(afterHard + 1);
  });

  it("human approve binds published twin + venue_review_decision_id; preserves soft review", async () => {
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, "harassment");
    const text = "Покрытие скользкое после влажной уборки, риск травмы";
    const { res } = await submitPublic(text);
    expect(res.statusCode).toBe(200);
    const pendingIntakeId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venue_review_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [res.json().id],
      )
    ).rows[0]!.id;
    const submittedId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM venue_review_slots WHERE id=$1`,
        [res.json().id],
      )
    ).rows[0]!.pending_revision_id;

    fake.textCalls = 0;
    const intake = await app.inject({
      method: "POST",
      url: "/v1/admin/cases/venue-review-intake",
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        pendingIntakeId,
        expectedIntakeVersion: 1,
        reasonCode: "operations_review",
        assignToSelf: true,
      },
    });
    expect(intake.statusCode).toBe(200);
    expect(fake.textCalls).toBe(0);
    const caseId = intake.json().caseId as string;
    const source = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/venue-review-source`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: { origin: adminOrigin },
    });
    expect(source.statusCode).toBe(200);
    const revision = source.json().reviewRevision;
    expect(revision.id).toBe(submittedId);
    const decide = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        action: "venue_review_decide",
        expectedCaseVersion: source.json().caseVersion,
        expectedResourceVersion: revision.resourceVersion,
        exactRevisionId: revision.id,
        decision: "approve",
        rationale: "Допустимая критика покрытия",
        reasonCode: "operations_review",
      },
    });
    expect(decide.statusCode).toBe(200);
    // Soft candidate already cached classification=review; approve reuses it (no new provider I/O).
    expect(fake.textCalls).toBe(0);

    const slot = await pool.query<{
      status: string;
      approved_revision_id: string;
      pending_revision_id: string | null;
    }>(`SELECT status, approved_revision_id, pending_revision_id FROM venue_review_slots WHERE id=$1`, [
      res.json().id,
    ]);
    expect(slot.rows[0]?.status).toBe("published");
    expect(slot.rows[0]?.approved_revision_id).not.toBe(submittedId);
    expect(slot.rows[0]?.pending_revision_id).toBeNull();

    const twin = await pool.query<{
      lifecycle: string;
      body_text: string;
      resource_version: number;
    }>(`SELECT lifecycle, body_text, resource_version FROM venue_review_revisions WHERE id=$1`, [
      slot.rows[0]!.approved_revision_id,
    ]);
    expect(twin.rows[0]?.lifecycle).toBe("published");
    expect(twin.rows[0]?.body_text).toBe(text);

    const candidate = await pool.query<{
      binding_kind: string;
      decision: string;
      venue_review_decision_id: string | null;
      approval_id: string;
    }>(
      `SELECT b.binding_kind, a.decision, b.venue_review_decision_id, b.approval_id
       FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id=$1::uuid AND b.binding_kind='candidate'`,
      [submittedId],
    );
    expect(candidate.rows[0]?.decision).toBe("review");
    expect(candidate.rows[0]?.venue_review_decision_id).toBeNull();

    const publication = await pool.query<{
      binding_kind: string;
      decision: string;
      venue_review_decision_id: string | null;
      entity_kind: string;
      approval_id: string;
    }>(
      `SELECT b.binding_kind, a.decision, b.venue_review_decision_id, b.entity_kind, b.approval_id
       FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id=$1::uuid AND b.binding_kind='publication'`,
      [slot.rows[0]!.approved_revision_id],
    );
    expect(publication.rows[0]).toMatchObject({
      binding_kind: "publication",
      decision: "review",
      entity_kind: "venue_review_revision",
    });
    expect(publication.rows[0]?.venue_review_decision_id).toBeTruthy();
    // Exact cached approval row reused — not a forged allow / hidden bypass.
    expect(publication.rows[0]?.approval_id).toBe(candidate.rows[0]?.approval_id);
  });

  it("0064 surfaces and venue decision FK exist; role XOR preserved", async () => {
    const surfaces = await pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_approvals'::regclass
         AND conname = 'content_moderation_approvals_surface_key_check'`,
    );
    expect(surfaces.rows[0]?.consrc).toMatch(/venue_review_body/);
    expect(surfaces.rows[0]?.consrc).toMatch(/role_review_body/);
    const kinds = await pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_bindings'::regclass
         AND conname = 'content_moderation_bindings_entity_kind_check'`,
    );
    expect(kinds.rows[0]?.consrc).toMatch(/venue_review_revision/);
    const col = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name='content_moderation_bindings'
         AND column_name='venue_review_decision_id'`,
    );
    expect(col.rows[0]).toEqual({
      column_name: "venue_review_decision_id",
      is_nullable: "YES",
    });
    const xor = await pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_bindings'::regclass
         AND conname = 'content_moderation_bindings_human_decision_xor_chk'`,
    );
    expect(xor.rows[0]?.consrc).toMatch(/role_reputation_decision_id/);
    expect(xor.rows[0]?.consrc).toMatch(/venue_review_decision_id/);
  });

  it("stale Case version denies approve before paid work", async () => {
    const { res } = await submitPublic("Нейтральный отзыв о покрытии для stale-case");
    expect(res.statusCode).toBe(200);
    const pendingIntakeId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venue_review_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [res.json().id],
      )
    ).rows[0]!.id;
    const intake = await app.inject({
      method: "POST",
      url: "/v1/admin/cases/venue-review-intake",
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        pendingIntakeId,
        expectedIntakeVersion: 1,
        reasonCode: "operations_review",
        assignToSelf: true,
      },
    });
    expect(intake.statusCode).toBe(200);
    const caseId = intake.json().caseId as string;
    const source = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/venue-review-source`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: { origin: adminOrigin },
    });
    const revision = source.json().reviewRevision;
    fake.textCalls = 0;
    const stale = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        action: "venue_review_decide",
        expectedCaseVersion: source.json().caseVersion + 1,
        expectedResourceVersion: revision.resourceVersion,
        exactRevisionId: revision.id,
        decision: "approve",
        rationale: "stale must not pay",
        reasonCode: "operations_review",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(fake.textCalls).toBe(0);
  });

  it("expired submit window rejects revise before provider; zero textCalls", async () => {
    const { res, gameId, venueId } = await submitPublic("Текст до закрытия окна подачи");
    expect(res.statusCode).toBe(200);
    const reviewId = res.json().id as string;
    const version = res.json().version as number;
    // Mutable window companion closes after fence is set (fence itself stays immutable).
    await pool.query(
      `UPDATE venue_review_submit_windows
       SET window_deadline_at = clock_timestamp() - interval '1 day',
           updated_at = clock_timestamp()
       WHERE author_user_id = $1 AND game_id = $2 AND canonical_venue_id = $3`,
      [participant.userId, gameId, venueId],
    );
    const text = "Ревизия после закрытого окна";
    const topics = ["surface"];
    fake.textCalls = 0;
    const beforeRevisions = (
      await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM venue_review_revisions`)
    ).rows[0]!.n;
    const beforeBindings = (
      await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM content_moderation_bindings`)
    ).rows[0]!.n;
    const beforeIntakes = (
      await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM venue_review_pending_intakes`)
    ).rows[0]!.n;
    const revise = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: {
        action: "submit_revision",
        expectedVersion: version,
        gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text,
        topics,
        consentProjectionHash: projectionHash({
          canonicalVenueId: venueId,
          audience: "public_venue",
          text,
          topics,
        }),
      },
    });
    expect(revise.statusCode).toBe(422);
    expect(revise.json().code).toBe("VENUE_WINDOW_CLOSED");
    expect(fake.textCalls).toBe(0);
    expect(
      (await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM venue_review_revisions`))
        .rows[0]!.n,
    ).toBe(beforeRevisions);
    expect(
      (
        await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM content_moderation_bindings`)
      ).rows[0]!.n,
    ).toBe(beforeBindings);
    expect(
      (
        await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM venue_review_pending_intakes`,
        )
      ).rows[0]!.n,
    ).toBe(beforeIntakes);
  });

  it("withdrawn slot rejects public revise before provider; zero textCalls", async () => {
    const { res, gameId, venueId } = await submitPublic(
      "Текст до отзыва для preflight-withdrawn",
    );
    expect(res.statusCode).toBe(200);
    const reviewId = res.json().id as string;
    const version = res.json().version as number;
    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: { action: "withdraw", expectedVersion: version },
    });
    expect(withdrawn.statusCode).toBe(200);
    const nextVersion = withdrawn.json().version as number;
    const text = "Повтор после отзыва не должен вызывать провайдера";
    const topics = ["surface"];
    fake.textCalls = 0;
    const beforeRevisions = (
      await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM venue_review_revisions`)
    ).rows[0]!.n;
    const beforeBindings = (
      await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM content_moderation_bindings`)
    ).rows[0]!.n;
    const beforeIntakes = (
      await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM venue_review_pending_intakes`)
    ).rows[0]!.n;
    const retry = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: {
        action: "submit_revision",
        expectedVersion: nextVersion,
        gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text,
        topics,
        consentProjectionHash: projectionHash({
          canonicalVenueId: venueId,
          audience: "public_venue",
          text,
          topics,
        }),
      },
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().code).toBe("WITHDRAWN_SLOT");
    expect(fake.textCalls).toBe(0);
    expect(
      (await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM venue_review_revisions`))
        .rows[0]!.n,
    ).toBe(beforeRevisions);
    expect(
      (
        await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM content_moderation_bindings`)
      ).rows[0]!.n,
    ).toBe(beforeBindings);
    expect(
      (
        await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM venue_review_pending_intakes`,
        )
      ).rows[0]!.n,
    ).toBe(beforeIntakes);
  });
});
