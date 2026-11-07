/**
 * MOD-V2-B1b public role-review/reply text gate — isolated PostgreSQL + fake provider.
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
import { projectionHash } from "../../src/games/role-reputation.policy";
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
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const webOrigin = "http://127.0.0.1:3015";
const adminOrigin = "http://localhost:19515";
const pepper = "role-review-mod-synthetic-admin-pepper!!";

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
    responseId: "synthetic-flagged-role-review",
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

describeIntegration("MOD-V2-B1b public role-review moderation", () => {
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
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3015",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "role-review-mod-synthetic-fingerprint!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      POST_GAME_INTERNAL_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      CASES_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: pepper,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "role-review-mod-synthetic-pepper-only!!",
    });
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "role-review-mod-synthetic",
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
    organizer = await actor("Role review org");
    participant = await actor("Role review part");
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
      [credentialId, id, Buffer.from("synthetic-role-review-mod")],
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
           $1, 'RoleRev Mod Court', 'Synthetic address', 'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography, $2,
           'unverified', 'rolerev mod court', 'synthetic address'
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
    await pool.query(
      `INSERT INTO game_outcomes
         (game_id, value, version, reason, source, actor_user_id)
       VALUES ($1, 'held', 1, null, 'manager_explicit', $2)`,
      [gameId, organizer.userId],
    );
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id, game_id, user_id, value, late, source, actor_user_id, version)
       VALUES ($1, $2, $3, 'present', false, 'manager_explicit', $4, 1)`,
      [participationId, gameId, participant.userId, organizer.userId],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          recorded_at, before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',$5,NULL,'present',NULL,false,NULL,NULL)`,
      [participationId, gameId, participant.userId, organizer.userId, starts.toISOString()],
    );
    const rev1 = randomUUID();
    await pool.query(
      `INSERT INTO game_role_proof_revisions
         (id, game_id, role, resource_version, subject_user_id, phase, binding_kind,
          provenance_source, accepted_for_count, actor_user_id)
       VALUES ($1,$2,'organization',1,$3,'planned','publish_freeze','publish_manager',false,$3)`,
      [rev1, gameId, organizer.userId],
    );
    await pool.query(
      `INSERT INTO game_role_proofs
         (game_id, role, version, subject_user_id, phase, accepted_for_count,
          open_dispute, latest_revision_id)
       VALUES ($1,'organization',1,$2,'planned',false,false,$3)`,
      [gameId, organizer.userId, rev1],
    );
    const rev2 = randomUUID();
    await pool.query(
      `INSERT INTO game_role_proof_revisions
         (id, game_id, role, resource_version, subject_user_id, phase, binding_kind,
          provenance_source, accepted_for_count, actor_user_id, outcome_version)
       VALUES ($1,$2,'organization',2,$3,'performed','held_confirm','manager_explicit',true,$3,1)`,
      [rev2, gameId, organizer.userId],
    );
    await pool.query(
      `UPDATE game_role_proofs
       SET version=2, phase='performed', accepted_for_count=true, latest_revision_id=$2
       WHERE game_id=$1 AND role='organization'`,
      [gameId, rev2],
    );
    const handle = (
      await pool.query<{ public_handle: string }>(
        `INSERT INTO role_reputation_subjects
           (subject_user_id, role, public_handle, version)
         VALUES ($1,'organization',$2,1)
         ON CONFLICT (subject_user_id, role) DO UPDATE SET updated_at=clock_timestamp()
         RETURNING public_handle`,
        [organizer.userId, randomUUID().replaceAll("-", "")],
      )
    ).rows[0]!;
    return { gameId, roleHandle: handle.public_handle };
  }

  const key = () => `role-mod-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return {
      cookie: who.cookie,
      origin: webOrigin,
      "x-csrf-token": who.csrfToken,
      "idempotency-key": idem,
    };
  }

  async function submitReview(text: string, topics: string[] = ["agreements"]) {
    const { gameId } = await seedHeldGame();
    const consentProjectionHash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text,
      topics,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: headers(participant),
      payload: {
        gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text,
        topics,
        consentProjectionHash,
      },
    });
    return { res, gameId };
  }

  it("ALLOW still creates human pending + candidate binding; never auto-publishes", async () => {
    const text = "Организация встречи была слабая, время сдвинули без предупреждения";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    expect(res.json().pendingIntakeStatus).toBe("waiting_intake");
    expect(fake.textCalls).toBe(1);
    const slot = await pool.query<{ status: string; pending_revision_id: string }>(
      `SELECT status, pending_revision_id FROM role_review_slots WHERE public_handle=$1`,
      [res.json().reviewHandle],
    );
    expect(slot.rows[0]?.status).toBe("submitted");
    expect(slot.rows[0]?.pending_revision_id).toBeTruthy();
    const binding = await pool.query(
      `SELECT b.binding_kind, b.entity_kind, a.decision, a.surface_key
       FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id = $1::uuid AND b.binding_kind = 'candidate'`,
      [slot.rows[0]!.pending_revision_id],
    );
    expect(binding.rows[0]).toMatchObject({
      binding_kind: "candidate",
      entity_kind: "role_review_revision",
      decision: "allow",
      surface_key: "role_review_body",
    });
    const published = await pool.query(
      `SELECT 1 FROM content_moderation_bindings
       WHERE entity_id=$1::uuid AND binding_kind='publication'`,
      [slot.rows[0]!.pending_revision_id],
    );
    expect(published.rowCount).toBe(0);
  });

  it("soft harassment stays pendingreview (decision=review), never forged allow", async () => {
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, "harassment");
    const text = "Негативная критика организации без угроз";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    expect(res.json().pendingIntakeStatus).toBe("waiting_intake");
    const revId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM role_review_slots WHERE public_handle=$1`,
        [res.json().reviewHandle],
      )
    ).rows[0]!.pending_revision_id;
    const decision = await pool.query<{ decision: string }>(
      `SELECT a.decision FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id=$1::uuid AND b.binding_kind='candidate'`,
      [revId],
    );
    expect(decision.rows[0]?.decision).toBe("review");
  });

  it("hard-safety category rejects with fields.text; no intake; prior tip retained on edit", async () => {
    const first = await submitReview("Нейтральный принятый отзыв о встрече");
    expect(first.res.statusCode).toBe(200);
    const reviewId = first.res.json().id as string;
    const version = first.res.json().version as number;
    const baselineCalls = fake.textCalls;

    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, "sexual/minors");
    const editText = "Замена с жёстким отказом";
    const consentProjectionHash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text: editText,
      topics: ["agreements"],
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: {
        action: "submit_revision",
        expectedVersion: version,
        gameId: first.gameId,
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: editText,
        topics: ["agreements"],
        consentProjectionHash,
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(rejected.json().fields?.text).toBeTruthy();
    expect(fake.textCalls).toBe(baselineCalls + 1);

    const slot = await pool.query<{ status: string; version: number; body: string }>(
      `SELECT s.status, s.version, r.body_text AS body
       FROM role_review_slots s
       JOIN role_review_revisions r ON r.id = s.pending_revision_id
       WHERE s.id=$1`,
      [reviewId],
    );
    expect(slot.rows[0]?.body).toBe("Нейтральный принятый отзыв о встрече");
    expect(slot.rows[0]?.version).toBe(version);
  });

  it("provider 503 preserves prior tip; withdraw has zero provider calls", async () => {
    const first = await submitReview("Исходный отзыв до сбоя провайдера");
    expect(first.res.statusCode).toBe(200);
    const reviewId = first.res.json().id as string;
    const version = first.res.json().version as number;
    const baseline = fake.textCalls;

    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    const editText = "Текст при недоступности";
    const consentProjectionHash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text: editText,
      topics: ["agreements"],
    });
    const unavailable = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: {
        action: "submit_revision",
        expectedVersion: version,
        gameId: first.gameId,
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: editText,
        topics: ["agreements"],
        consentProjectionHash,
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().code).toBe("MODERATION_TEMPORARILY_UNAVAILABLE");

    const after503 = fake.textCalls;
    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${reviewId}/commands`,
      headers: headers(participant),
      payload: { action: "withdraw", expectedVersion: version },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(fake.textCalls).toBe(after503);
    expect(fake.textCalls).toBeGreaterThan(baseline);
  });

  it("quoted abuse soft-flag → review; human approve binds publication + decision FK", async () => {
    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, "harassment");
    const text = 'Он написал «ужас», цитирую для отчёта о нарушении договорённостей';
    const { res } = await submitReview(text, ["agreements", "communication"]);
    expect(res.statusCode).toBe(200);
    const pendingIntakeId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [res.json().id],
      )
    ).rows[0]!.id;

    fake.textCalls = 0;
    const intake = await app.inject({
      method: "POST",
      url: "/v1/admin/cases/role-reputation-intake",
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
    // Intake/read must not call text provider.
    expect(fake.textCalls).toBe(0);
    const caseId = intake.json().caseId as string;
    const source = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/role-review-source`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: { origin: adminOrigin, "x-csrf-token": reviewer.csrf },
    });
    expect(source.statusCode).toBe(200);
    expect(fake.textCalls).toBe(0);
    const revision = source.json().reviewRevision;
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
        action: "role_review_decide",
        expectedCaseVersion: source.json().caseVersion,
        expectedResourceVersion: revision.resourceVersion,
        targetKind: "review",
        exactRevisionId: revision.id,
        decision: "approve",
        rationale: "Допустимая критика после ручной проверки",
        reasonCode: "operations_review",
      },
    });
    expect(decide.statusCode).toBe(200);
    const pub = await pool.query<{
      binding_kind: string;
      decision: string;
      role_reputation_decision_id: string | null;
    }>(
      `SELECT b.binding_kind, a.decision, b.role_reputation_decision_id
       FROM content_moderation_bindings b
       JOIN content_moderation_approvals a ON a.id = b.approval_id
       WHERE b.entity_id=$1::uuid AND b.binding_kind='publication'`,
      [revision.id],
    );
    expect(pub.rows[0]?.binding_kind).toBe("publication");
    expect(pub.rows[0]?.decision).toBe("review");
    expect(pub.rows[0]?.role_reputation_decision_id).toBeTruthy();
    const slot = await pool.query<{ status: string }>(
      `SELECT status FROM role_review_slots WHERE id=$1`,
      [res.json().id],
    );
    expect(slot.rows[0]?.status).toBe("published");
  });

  it("0063 surfaces exist; venue/player comment paths stay closed for role-only writer", async () => {
    const surfaces = await pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'public.content_moderation_approvals'::regclass
         AND conname = 'content_moderation_approvals_surface_key_check'`,
    );
    expect(surfaces.rows[0]?.consrc).toMatch(/role_review_body/);
    expect(surfaces.rows[0]?.consrc).toMatch(/role_reply_body/);
    const receiptCols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='admin_command_receipts'
         AND column_name IN ('reservation_state','claim_nonce','expires_at')`,
    );
    expect(receiptCols.rows.map((r) => r.column_name).sort()).toEqual([
      "claim_nonce",
      "expires_at",
      "reservation_state",
    ]);
    const receiptState = await pool.query<{ consrc: string }>(
      `SELECT pg_get_constraintdef(oid) AS consrc
       FROM pg_constraint
       WHERE conrelid = 'public.admin_command_receipts'::regclass
         AND conname = 'admin_command_receipts_reservation_state_chk'`,
    );
    expect(receiptState.rows[0]?.consrc).toMatch(/error/);
    // Source must not open new public venue/player comments in this pass.
    const venueWrite = await app.inject({
      method: "POST",
      url: `/v1/venues/${randomUUID()}/comments`,
      headers: headers(participant),
      payload: { text: "не должно открыться", parentCommentId: null },
    });
    expect([403, 404, 422]).toContain(venueWrite.statusCode);
  });

  async function intakeAssignedCase(slotId: string) {
    const pendingIntakeId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [slotId],
      )
    ).rows[0]!.id;
    const intake = await app.inject({
      method: "POST",
      url: "/v1/admin/cases/role-reputation-intake",
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
      url: `/v1/admin/cases/${caseId}/role-review-source`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: { origin: adminOrigin, "x-csrf-token": reviewer.csrf },
    });
    expect(source.statusCode).toBe(200);
    return { caseId, source: source.json() as {
      caseVersion: number;
      reviewRevision: { id: string; resourceVersion: number };
    } };
  }

  async function stripClassifierEvidence(revisionId: string) {
    await pool.query(
      `DELETE FROM content_moderation_bindings WHERE entity_id=$1::uuid`,
      [revisionId],
    );
    await pool.query(
      `DELETE FROM content_moderation_approvals
       WHERE surface_key IN ('role_review_body','role_reply_body')
         AND id NOT IN (SELECT approval_id FROM content_moderation_bindings)`,
    );
  }

  it("stale expectedCaseVersion before provider: zero paid calls on legacy pending", async () => {
    const text = "Слабая организация: опоздание и смена корта без уведомления участников";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    const revisionId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM role_review_slots WHERE id=$1`,
        [res.json().id],
      )
    ).rows[0]!.pending_revision_id;
    await stripClassifierEvidence(revisionId);
    const { caseId, source } = await intakeAssignedCase(res.json().id);
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
        action: "role_review_decide",
        expectedCaseVersion: source.caseVersion + 1,
        expectedResourceVersion: source.reviewRevision.resourceVersion,
        targetKind: "review",
        exactRevisionId: source.reviewRevision.id,
        decision: "approve",
        rationale: "stale case version must not pay",
        reasonCode: "operations_review",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    expect(fake.textCalls).toBe(0);
  });

  it("authorized completed receipt replays approve with zero provider", async () => {
    const text = "Поток встречи сбился: перерывы дольше договорённого без согласования";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    const revisionId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM role_review_slots WHERE id=$1`,
        [res.json().id],
      )
    ).rows[0]!.pending_revision_id;
    await stripClassifierEvidence(revisionId);
    const { caseId, source } = await intakeAssignedCase(res.json().id);
    const idem = randomUUID();
    fake.textCalls = 0;
    const payload = {
      action: "role_review_decide",
      expectedCaseVersion: source.caseVersion,
      expectedResourceVersion: source.reviewRevision.resourceVersion,
      targetKind: "review",
      exactRevisionId: source.reviewRevision.id,
      decision: "approve",
      rationale: "Допустимая критика после ручной проверки",
      reasonCode: "operations_review",
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(fake.textCalls).toBe(1);
    const afterFirst = fake.textCalls;
    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      caseId: first.json().caseId,
      caseVersion: first.json().caseVersion,
      decision: "approve",
      auditId: first.json().auditId,
    });
    expect(fake.textCalls).toBe(afterFirst);
  });

  it("concurrent same-key legacy pending: one paid attempt; loser CIP then safe replay", async () => {
    const text = "Коммуникация организатора была путаной, ответы приходили слишком поздно";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    const revisionId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM role_review_slots WHERE id=$1`,
        [res.json().id],
      )
    ).rows[0]!.pending_revision_id;
    await stripClassifierEvidence(revisionId);
    const { caseId, source } = await intakeAssignedCase(res.json().id);
    const idem = randomUUID();
    let releaseProvider!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let enteredProvider = 0;
    fake.textFixture = async (input) => {
      enteredProvider += 1;
      await blocked;
      return safeTextBatchDecision(input.texts.length);
    };
    fake.textCalls = 0;
    const payload = {
      action: "role_review_decide",
      expectedCaseVersion: source.caseVersion,
      expectedResourceVersion: source.reviewRevision.resourceVersion,
      targetKind: "review",
      exactRevisionId: source.reviewRevision.id,
      decision: "approve",
      rationale: "Параллельный один ключ",
      reasonCode: "operations_review",
    };
    const first = app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    for (let i = 0; i < 100 && enteredProvider === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(enteredProvider).toBe(1);
    const second = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(enteredProvider).toBe(1);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("COMMAND_IN_PROGRESS");
    // Soft TTL advance must not reclaim processing for a second paid call.
    await pool.query(
      `UPDATE admin_command_receipts
       SET expires_at = clock_timestamp() - interval '1 hour'
       WHERE actor_id=$1 AND reservation_state='processing'`,
      [reviewer.id],
    );
    const afterTtl = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(enteredProvider).toBe(1);
    expect(afterTtl.statusCode).toBe(409);
    expect(afterTtl.json().code).toBe("COMMAND_IN_PROGRESS");
    releaseProvider();
    const firstResult = await first;
    expect(firstResult.statusCode).toBe(200);
    expect(fake.textCalls).toBe(1);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(fake.textCalls).toBe(1);
  });

  it("unknown seal survives TTL; late wrong claim_nonce cannot complete", async () => {
    const text = "Организатор сорвал договорённости по времени начала и составу";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    const revisionId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM role_review_slots WHERE id=$1`,
        [res.json().id],
      )
    ).rows[0]!.pending_revision_id;
    await stripClassifierEvidence(revisionId);
    const { caseId, source } = await intakeAssignedCase(res.json().id);
    const idem = randomUUID();
    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    fake.textCalls = 0;
    const payload = {
      action: "role_review_decide",
      expectedCaseVersion: source.caseVersion,
      expectedResourceVersion: source.reviewRevision.resourceVersion,
      targetKind: "review",
      exactRevisionId: source.reviewRevision.id,
      decision: "approve",
      rationale: "provider unavailable seals unknown",
      reasonCode: "operations_review",
    };
    const failed = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(failed.statusCode).toBe(503);
    expect(fake.textCalls).toBe(1);
    const sealed = await pool.query<{
      reservation_state: string;
      claim_nonce: string | null;
    }>(
      `SELECT reservation_state, claim_nonce FROM admin_command_receipts
       WHERE actor_id=$1 AND reservation_state='unknown'`,
      [reviewer.id],
    );
    expect(sealed.rows[0]?.reservation_state).toBe("unknown");
    const ownerNonce = sealed.rows[0]!.claim_nonce!;
    await pool.query(
      `UPDATE admin_command_receipts
       SET expires_at = clock_timestamp() - interval '2 days'
       WHERE actor_id=$1 AND reservation_state='unknown'`,
      [reviewer.id],
    );
    const afterTtl = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(afterTtl.statusCode).toBe(503);
    expect(fake.textCalls).toBe(1);
    // Late wrong-owner completion denied: forged claim_nonce cannot flip unknown→completed.
    const wrong = await pool.query(
      `UPDATE admin_command_receipts
       SET reservation_state='completed',
           response_ciphertext='forged',
           claim_nonce=$2
       WHERE actor_id=$1 AND claim_nonce=$3 AND reservation_state='unknown'`,
      [reviewer.id, randomUUID(), randomUUID()],
    );
    expect(wrong.rowCount).toBe(0);
    const still = await pool.query<{ reservation_state: string; claim_nonce: string }>(
      `SELECT reservation_state, claim_nonce FROM admin_command_receipts
       WHERE actor_id=$1 AND key_hash IS NOT NULL AND reservation_state='unknown'`,
      [reviewer.id],
    );
    expect(still.rows.some((r) => r.claim_nonce === ownerNonce)).toBe(true);
  });

  it("obsolete pending review approve: REVISION_NOT_CURRENT before provider (provider0)", async () => {
    const text = "Организация встречи была несогласованной по времени и корту";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    const revisionId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM role_review_slots WHERE id=$1`,
        [res.json().id],
      )
    ).rows[0]!.pending_revision_id;
    await stripClassifierEvidence(revisionId);
    const { caseId, source } = await intakeAssignedCase(res.json().id);
    // Legacy obsolete: pending tip moved away from the exact revision under review.
    await pool.query(
      `UPDATE role_review_slots SET pending_revision_id=NULL WHERE id=$1`,
      [res.json().id],
    );
    fake.textCalls = 0;
    const obsolete = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        action: "role_review_decide",
        expectedCaseVersion: source.caseVersion,
        expectedResourceVersion: source.reviewRevision.resourceVersion,
        targetKind: "review",
        exactRevisionId: source.reviewRevision.id,
        decision: "approve",
        rationale: "obsolete pending must not pay",
        reasonCode: "operations_review",
      },
    });
    expect(obsolete.statusCode).toBe(409);
    expect(obsolete.json().code).toBe("REVISION_NOT_CURRENT");
    expect(fake.textCalls).toBe(0);
  });

  it("admin paid hard-reject seals error receipt; same-key replays 422 with provider0", async () => {
    const text = "Коммуникация по правилам площадки была путаной и запоздалой";
    const { res } = await submitReview(text);
    expect(res.statusCode).toBe(200);
    const revisionId = (
      await pool.query<{ pending_revision_id: string }>(
        `SELECT pending_revision_id FROM role_review_slots WHERE id=$1`,
        [res.json().id],
      )
    ).rows[0]!.pending_revision_id;
    await stripClassifierEvidence(revisionId);
    const { caseId, source } = await intakeAssignedCase(res.json().id);
    const idem = randomUUID();
    fake.textFixture = async (input) =>
      flaggedTextBatch(input.texts.length, "sexual/minors");
    fake.textCalls = 0;
    const payload = {
      action: "role_review_decide",
      expectedCaseVersion: source.caseVersion,
      expectedResourceVersion: source.reviewRevision.resourceVersion,
      targetKind: "review",
      exactRevisionId: source.reviewRevision.id,
      decision: "approve",
      rationale: "paid reject must seal durable error",
      reasonCode: "operations_review",
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(first.statusCode).toBe(422);
    expect(first.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(first.json().fields?.text).toBeTruthy();
    expect(fake.textCalls).toBe(1);
    const sealed = await pool.query<{ reservation_state: string }>(
      `SELECT reservation_state FROM admin_command_receipts
       WHERE actor_id=$1 AND reservation_state='error'`,
      [reviewer.id],
    );
    expect(sealed.rowCount).toBe(1);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": reviewer.csrf,
        "idempotency-key": idem,
      },
      payload,
    });
    expect(replay.statusCode).toBe(422);
    expect(replay.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(replay.json().fields?.text).toBe(first.json().fields?.text);
    expect(fake.textCalls).toBe(1);
  });

  it("consumer role hard-reject same-key replays 422 with provider0", async () => {
    const editText = "Повтор того же жёсткого отказа без второго вызова";
    const first = await submitReview("Нейтральный принятый отзыв до жёсткого отказа");
    expect(first.res.statusCode).toBe(200);
    const reviewId = first.res.json().id as string;
    const version = first.res.json().version as number;
    const consentProjectionHash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text: editText,
      topics: ["agreements"],
    });
    const idem = randomUUID();
    fake.textFixture = async (input) =>
      flaggedTextBatch(input.texts.length, "sexual/minors");
    fake.textCalls = 0;
    const payload = {
      action: "submit_revision",
      expectedVersion: version,
      gameId: first.gameId,
      expectedBasisVersions: {
        proofVersion: 2,
        outcomeVersion: 1,
        attendanceVersion: 1,
      },
      text: editText,
      topics: ["agreements"],
      consentProjectionHash,
    };
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${reviewId}/commands`,
      headers: { ...headers(participant), "idempotency-key": idem },
      payload,
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(fake.textCalls).toBe(1);
    const receipt = await pool.query<{ status_code: number; reservation_state: string }>(
      `SELECT status_code, reservation_state FROM idempotency_records
       WHERE actor_id=$1 AND operation='role_review.command'
         AND status_code=422`,
      [participant.userId],
    );
    expect(receipt.rows[0]?.reservation_state).toBe("completed");
    expect(receipt.rows[0]?.status_code).toBe(422);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${reviewId}/commands`,
      headers: { ...headers(participant), "idempotency-key": idem },
      payload,
    });
    expect(replay.statusCode).toBe(422);
    expect(replay.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(fake.textCalls).toBe(1);
  });
});
