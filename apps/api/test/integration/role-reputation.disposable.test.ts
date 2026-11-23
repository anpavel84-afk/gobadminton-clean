import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { NativeSessionService } from "../../src/auth/native-session.service";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { projectionHash } from "../../src/games/role-reputation.policy";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const nativeClientId = "role-rep-native-fixture";
const nativeRedirect = "https://app.example.test/auth/callback";

/**
 * Bounded #394 role-reputation HTTP checks. Skipped unless RUN_DB_INTEGRATION=1
 * against dedicated disposable DB. Never creates live sessions/credentials.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "https://localhost:3001";
const adminOrigin = "http://localhost:18995";
const pepper = "role-rep-consumer-admin-pepper-32chars!!";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_role_reputation_disposable";
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

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };
type AdminActor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

run("#394 role reputation — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let native: NativeSessionService;
  let organizer: Actor;
  let participant: Actor;
  let outsider: Actor;
  /** Qualified reader+manager: evidence.assigned.read (superadmin). Pure moderator stays denied. */
  let reviewer: AdminActor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "role-reputation-synthetic",
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
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "https://localhost:3000",
      PUBLIC_WEB_ORIGIN: origin,
      ALLOWED_WEB_ORIGINS: origin,
      COOKIE_SECURE: "true",
      AUTH_PEPPER: "role-rep-synthetic-fixture-pepper!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "role-rep-synthetic-fingerprint!!!!!",
      POST_GAME_INTERNAL_ENABLED: "1",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      CASES_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: pepper,
      NATIVE_AUTH_ENABLED: "1",
      NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([
        { clientId: nativeClientId, redirectUris: [nativeRedirect] },
      ]),
    });
    const ref = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        GamesModule,
        VenuesModule,
        ProfilesModule,
        AdminModule,
      ],
    }).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);
    native = ref.get(NativeSessionService);
    organizer = await actor("org");
    participant = await actor("part");
    outsider = await actor("out");
    reviewer = await adminActor("superadmin");
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function actor(label: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query(`INSERT INTO users (id, status) VALUES ($1, 'active')`, [userId]);
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, public_player_id, display_name, directory_visible, social_eligible,
          contact_policy, directory_visibility_provenance, consent_policy_version)
       VALUES ($1, $2, $3, true, true, 'closed', 'owner_default', 'v1')`,
      [userId, randomUUID(), `Player ${label}`],
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
      [credentialId, id, Buffer.from("synthetic-role-rep-consumer")],
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

  /**
   * Complete SQL fixture aligned with working admin-cases / attendance games rows.
   * Keeps synthetic time/attendance/proof correct; does not weaken constraints.
   */
  async function seedHeldGame(opts: {
    organizerId: string;
    participantId: string;
    endsAt: Date;
    status?: string;
    outcome?: "held" | "not_held" | null;
  }) {
    const venue = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(
           city_id, name, address, timezone, location, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address
         ) VALUES (
           $1, 'RoleRep Court', 'Synthetic address', 'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography, $2,
           'unverified', 'rolerep court', 'synthetic address'
         ) RETURNING id`,
        [MOSCOW_CITY_ID, opts.organizerId],
      )
    ).rows[0]!;
    const gameId = randomUUID();
    const starts = new Date(opts.endsAt.getTime() - 3600_000);
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
         $1, 1, 'Game', $2, 'public', 'regular', $3,
         $4, $5, 'Europe/Moscow', $6,
         4, 0,
         'doubles', 'ntrp', 1, '["3.0","3.5"]'::jsonb,
         'external', 'no_trainer_fee', 'Synthetic settlement terms',
         $7, 'Host', 'host@example.test',
         clock_timestamp()
       )`,
      [
        gameId,
        opts.status ?? "completed",
        venue.id,
        starts.toISOString(),
        opts.endsAt.toISOString(),
        deadline.toISOString(),
        opts.organizerId,
      ],
    );
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [gameId, opts.organizerId],
    );
    const participationId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, $3, 'confirmed', $4)`,
      [participationId, gameId, opts.participantId, starts.toISOString()],
    );
    await pool.query(
      `INSERT INTO participation_transitions
         (id, participation_id, from_status, to_status, actor_id, reason_code,
          aggregate_version, game_version, at)
       VALUES ($1, $2, NULL, 'confirmed', $3, 'test_confirm', 1, 1, $4)`,
      [randomUUID(), participationId, opts.participantId, starts.toISOString()],
    );
    if (opts.outcome === "held" || opts.outcome === "not_held") {
      await pool.query(
        `INSERT INTO game_outcomes
           (game_id, value, version, reason, source, actor_user_id)
         VALUES ($1, $2, 1, $3, 'manager_explicit', $4)`,
        [
          gameId,
          opts.outcome,
          opts.outcome === "not_held" ? "cancel" : null,
          opts.organizerId,
        ],
      );
    }
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id, game_id, user_id, value, late, source, actor_user_id, version)
       VALUES ($1, $2, $3, 'present', false, 'manager_explicit', $4, 1)`,
      [participationId, gameId, opts.participantId, opts.organizerId],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          recorded_at, before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',$5,NULL,'present',NULL,false,NULL,NULL)`,
      [participationId, gameId, opts.participantId, opts.organizerId, starts.toISOString()],
    );
    const rev1 = randomUUID();
    await pool.query(
      `INSERT INTO game_role_proof_revisions
         (id, game_id, role, resource_version, subject_user_id, phase, binding_kind,
          provenance_source, accepted_for_count, actor_user_id)
       VALUES ($1,$2,'organization',1,$3,'planned','publish_freeze','publish_manager',false,$3)`,
      [rev1, gameId, opts.organizerId],
    );
    await pool.query(
      `INSERT INTO game_role_proofs
         (game_id, role, version, subject_user_id, phase, accepted_for_count,
          open_dispute, latest_revision_id)
       VALUES ($1,'organization',1,$2,'planned',false,false,$3)`,
      [gameId, opts.organizerId, rev1],
    );
    if (opts.outcome === "held") {
      const rev2 = randomUUID();
      await pool.query(
        `INSERT INTO game_role_proof_revisions
           (id, game_id, role, resource_version, subject_user_id, phase, binding_kind,
            provenance_source, accepted_for_count, actor_user_id, outcome_version)
         VALUES ($1,$2,'organization',2,$3,'performed','held_confirm','manager_explicit',true,$3,1)`,
        [rev2, gameId, opts.organizerId],
      );
      await pool.query(
        `UPDATE game_role_proofs
         SET version=2, phase='performed', accepted_for_count=true, latest_revision_id=$2
         WHERE game_id=$1 AND role='organization'`,
        [gameId, rev2],
      );
    }
    const subject = (
      await pool.query<{ public_handle: string }>(
        `INSERT INTO role_reputation_subjects
           (subject_user_id, role, public_handle, version)
         VALUES ($1,'organization',$2,1)
         ON CONFLICT (subject_user_id, role) DO UPDATE SET updated_at=clock_timestamp()
         RETURNING public_handle`,
        [opts.organizerId, randomUUID().replaceAll("-", "")],
      )
    ).rows[0]!;
    const handle = (
      await pool.query<{ public_handle: string }>(
        `SELECT public_handle FROM role_reputation_subjects
         WHERE subject_user_id=$1 AND role='organization'`,
        [opts.organizerId],
      )
    ).rows[0]!;
    void subject;
    return { gameId, participationId, roleHandle: handle.public_handle };
  }

  /** Trainer-led held game with training role proof — for native author loop eligibility. */
  async function seedHeldTrainerLed(opts: {
    organizerId: string;
    trainerId: string;
    participantId: string;
    endsAt: Date;
  }) {
    const venue = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(
           city_id, name, address, timezone, location, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address
         ) VALUES (
           $1, 'RoleRep Train Court', 'Synthetic train address', 'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography, $2,
           'unverified', 'rolerep train court', 'synthetic train address'
         ) RETURNING id`,
        [MOSCOW_CITY_ID, opts.organizerId],
      )
    ).rows[0]!;
    const trainerProfile = (
      await pool.query<{ id: string }>(
        `INSERT INTO trainer_profiles(user_id, display_name, status)
         VALUES ($1, 'Synthetic trainer', 'active')
         ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name
         RETURNING id`,
        [opts.trainerId],
      )
    ).rows[0]!;
    const gameId = randomUUID();
    const starts = new Date(opts.endsAt.getTime() - 3600_000);
    const deadline = new Date(starts.getTime() - 3600_000);
    await pool.query(
      `INSERT INTO games (
         id, version, title, status, visibility, activity_kind, venue_id,
         starts_at, ends_at, timezone, application_deadline_at,
         capacity, external_reserved_count,
         format_key, level_scale_id, level_scale_version, allowed_level_ids,
         settlement_mode, settlement_purpose, settlement_terms, price_status,
         trainer_profile_id, trainer_display_name_snapshot,
         created_by_user_id, host_display_name, host_public_contact,
         published_at
       ) VALUES (
         $1, 1, 'Training', 'completed', 'public', 'trainer_led', $2,
         $3, $4, 'Europe/Moscow', $5,
         4, 0,
         'doubles', 'ntrp', 1, '["3.0","3.5"]'::jsonb,
         'external', 'trainer_fee', 'Synthetic trainer fee terms', 'by_agreement',
         $6, 'Synthetic trainer',
         $7, 'Host', 'host@example.test',
         clock_timestamp()
       )`,
      [
        gameId,
        venue.id,
        starts.toISOString(),
        opts.endsAt.toISOString(),
        deadline.toISOString(),
        trainerProfile.id,
        opts.organizerId,
      ],
    );
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [gameId, opts.organizerId],
    );
    const participationId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, $3, 'confirmed', $4)`,
      [participationId, gameId, opts.participantId, starts.toISOString()],
    );
    await pool.query(
      `INSERT INTO participation_transitions
         (id, participation_id, from_status, to_status, actor_id, reason_code,
          aggregate_version, game_version, at)
       VALUES ($1, $2, NULL, 'confirmed', $3, 'test_confirm', 1, 1, $4)`,
      [randomUUID(), participationId, opts.participantId, starts.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_outcomes
         (game_id, value, version, reason, source, actor_user_id)
       VALUES ($1, 'held', 1, NULL, 'manager_explicit', $2)`,
      [gameId, opts.organizerId],
    );
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id, game_id, user_id, value, late, source, actor_user_id, version)
       VALUES ($1, $2, $3, 'present', false, 'manager_explicit', $4, 1)`,
      [participationId, gameId, opts.participantId, opts.organizerId],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          recorded_at, before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',$5,NULL,'present',NULL,false,NULL,NULL)`,
      [participationId, gameId, opts.participantId, opts.organizerId, starts.toISOString()],
    );
    const rev1 = randomUUID();
    await pool.query(
      `INSERT INTO game_role_proof_revisions
         (id, game_id, role, resource_version, subject_user_id, phase, binding_kind,
          provenance_source, accepted_for_count, actor_user_id)
       VALUES ($1,$2,'training',1,$3,'planned','publish_freeze','publish_manager',false,$4)`,
      [rev1, gameId, opts.trainerId, opts.organizerId],
    );
    await pool.query(
      `INSERT INTO game_role_proofs
         (game_id, role, version, subject_user_id, phase, accepted_for_count,
          open_dispute, latest_revision_id)
       VALUES ($1,'training',1,$2,'planned',false,false,$3)`,
      [gameId, opts.trainerId, rev1],
    );
    const rev2 = randomUUID();
    await pool.query(
      `INSERT INTO game_role_proof_revisions
         (id, game_id, role, resource_version, subject_user_id, phase, binding_kind,
          provenance_source, accepted_for_count, actor_user_id, outcome_version)
       VALUES ($1,$2,'training',2,$3,'performed','held_confirm','manager_explicit',true,$4,1)`,
      [rev2, gameId, opts.trainerId, opts.organizerId],
    );
    await pool.query(
      `UPDATE game_role_proofs
       SET version=2, phase='performed', accepted_for_count=true, latest_revision_id=$2
       WHERE game_id=$1 AND role='training'`,
      [gameId, rev2],
    );
    await pool.query(
      `INSERT INTO role_reputation_subjects
         (subject_user_id, role, public_handle, version)
       VALUES ($1,'training',$2,1)
       ON CONFLICT (subject_user_id, role) DO UPDATE SET updated_at=clock_timestamp()`,
      [opts.trainerId, randomUUID().replaceAll("-", "")],
    );
    const handle = (
      await pool.query<{ public_handle: string }>(
        `SELECT public_handle FROM role_reputation_subjects
         WHERE subject_user_id=$1 AND role='training'`,
        [opts.trainerId],
      )
    ).rows[0]!;
    return { gameId, participationId, roleHandle: handle.public_handle, trainerProfileId: trainerProfile.id };
  }

  async function nativeBearer(userId: string, idem?: string) {
    const issued = await native.transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [userId]);
      return native.issue(client, userId, nativeClientId);
    });
    return {
      authorization: `Bearer ${issued.accessToken}`,
      accessToken: issued.accessToken,
      sessionId: issued.sessionId,
      ...(idem ? { "idempotency-key": idem } : {}),
    };
  }

  async function humanApprovePending(pendingIntakeId: string, expectedIntakeVersion = 1) {
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
        expectedIntakeVersion,
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
      headers: { origin: adminOrigin },
    });
    expect(source.statusCode).toBe(200);
    const pendingKind = source.json().pendingKind as string;
    const targetKind = pendingKind === "reply_submit" ? "reply" : "review";
    const revision =
      targetKind === "reply" ? source.json().replyRevision : source.json().reviewRevision;
    expect(revision?.id).toBeTruthy();
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
        expectedCaseVersion: intake.json().caseVersion,
        expectedResourceVersion: revision.resourceVersion,
        targetKind,
        exactRevisionId: revision.id,
        decision: "approve",
        rationale: "Synthetic approve for disposable roundtrip",
        reasonCode: "operations_review",
      },
    });
    expect(decide.statusCode).toBe(200);
    return { caseId, revision, targetKind };
  }

  it("outsider can read but not write; own past role can submit pending; self denied; public handle roundtrip", async () => {
    const past = new Date("2026-10-01T18:00:00.000Z");
    const seeded = await seedHeldGame({
      organizerId: organizer.userId,
      participantId: participant.userId,
      endsAt: past,
      outcome: "held",
    });

    const read = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: outsider.cookie },
    });
    expect(read.statusCode).toBe(200);
    const body = read.json();
    expect(body.availability).toBe("available");
    expect(body.countScope).toBe("confirmed_history");
    expect(body.heldGamesCount).toBe(1);
    expect(body).not.toHaveProperty("authorUserId");
    expect(JSON.stringify(body)).not.toContain(seeded.gameId);

    const multiline = "Организация была слабой\nСрыв договорённостей";
    const preview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "content-type": "application/json",
      },
      payload: {
        role: "organization",
        subjectRoleHandle: seeded.roleHandle,
        text: multiline,
        topics: ["agreements"],
      },
    });
    expect(preview.statusCode).toBe(200);
    const hash = preview.json().consentProjectionHash as string;
    expect(hash).toBe(
      projectionHash({
        subjectUserId: organizer.userId,
        role: "organization",
        audience: "public",
        text: multiline,
        topics: ["agreements"],
      }),
    );

    const outsiderWrite = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        cookie: outsider.cookie,
        "x-csrf-token": outsider.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        gameId: seeded.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: hash,
      },
    });
    expect(outsiderWrite.statusCode).toBeGreaterThanOrEqual(400);

    const selfWrite = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        gameId: seeded.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: projectionHash({
          subjectUserId: organizer.userId,
          role: "organization",
          audience: "public",
          text: multiline,
          topics: ["agreements"],
        }),
      },
    });
    expect(selfWrite.statusCode).toBeGreaterThanOrEqual(400);

    const ok = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        gameId: seeded.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: hash,
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pendingIntakeStatus).toBe("waiting_intake");
    expect(ok.json().status).toBe("submitted");
    const ownId = ok.json().id as string;
    const reviewHandle = ok.json().reviewHandle as string;
    expect(reviewHandle).toMatch(/^[0-9a-f]{32}$/);

    // Pending not public.
    const after = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
    });
    expect(after.json().publishedReviewCount).toBe(0);
    expect(after.json().items).toEqual([]);

    const minePending = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { cookie: participant.cookie },
    });
    expect(minePending.statusCode).toBe(200);
    const pendingItem = minePending
      .json()
      .items.find((i: { id: string }) => i.id === ownId);
    expect(pendingItem.pendingIntakeStatus).toBe("waiting_intake");
    expect(pendingItem.receiptToken).toBeTruthy();
    expect(pendingItem.text).toBe(multiline);

    // UUID path must not work for public reply/report (handle-only).
    const uuidReport = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${ownId}/reports`,
      headers: {
        cookie: outsider.cookie,
        "x-csrf-token": outsider.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        targetKind: "review",
        expectedRevision: 1,
        reasonCode: "spam",
      },
    });
    expect(uuidReport.statusCode).toBeGreaterThanOrEqual(400);

    const pending = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [ownId],
      )
    ).rows[0]!;
    await humanApprovePending(pending.id, pending.version);

    const mineLinked = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { cookie: participant.cookie },
    });
    const linkedItem = mineLinked.json().items.find((i: { id: string }) => i.id === ownId);
    expect(linkedItem.pendingIntakeStatus).toBe("linked");
    expect(linkedItem.receiptToken).toBeTruthy();

    const published = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: outsider.cookie },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().publishedReviewCount).toBe(1);
    const item = published.json().items[0];
    expect(item.reviewHandle).toBe(reviewHandle);
    expect(item.publishedRevision).toBe(1);
    expect(item.replyAggregateVersion).toBe(0);
    expect(item.text).toBe(multiline);
    expect(item.reply).toBeNull();
    expect(JSON.stringify(published.json())).not.toContain(ownId);
    expect(JSON.stringify(published.json())).not.toContain(organizer.userId);

    const report = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reports`,
      headers: {
        cookie: outsider.cookie,
        "x-csrf-token": outsider.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        targetKind: "review",
        expectedRevision: item.publishedRevision,
        reasonCode: "spam",
      },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().status).toBe("submitted");

    // Foreign reporter waiting_intake must not overwrite author's linked own receipt.
    const mineAfterReport = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { cookie: participant.cookie },
    });
    const ownAfterReport = mineAfterReport.json().items.find((i: { id: string }) => i.id === ownId);
    expect(ownAfterReport.pendingIntakeStatus).toBe("linked");
    expect(ownAfterReport.receiptToken).toBeTruthy();
    expect(ownAfterReport.receiptToken).not.toBe(report.json().receiptToken);
    expect(ownAfterReport.roleHandle).toBe(seeded.roleHandle);

    const replyText = "Спасибо за отзыв\nУчтём";
    const replyPreview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "content-type": "application/json",
      },
      payload: {
        targetKind: "reply",
        reviewHandle,
        text: replyText,
      },
    });
    expect(replyPreview.statusCode).toBe(200);
    const replyHash = replyPreview.json().consentProjectionHash as string;
    expect(replyHash).toBe(
      projectionHash({
        subjectUserId: organizer.userId,
        role: "organization",
        audience: "public",
        text: replyText,
        topics: [],
        reviewRevision: item.publishedRevision,
      }),
    );

    const subjectSelfReviewPreview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "content-type": "application/json",
      },
      payload: {
        role: "organization",
        subjectRoleHandle: seeded.roleHandle,
        text: "self",
        topics: ["agreements"],
      },
    });
    expect(subjectSelfReviewPreview.statusCode).toBeGreaterThanOrEqual(400);

    const reply = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: item.replyAggregateVersion,
        expectedReviewRevision: item.publishedRevision,
        text: replyText,
        consentProjectionHash: replyHash,
      },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().status).toBe("submitted");

    const outsiderReply = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: {
        cookie: outsider.cookie,
        "x-csrf-token": outsider.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: 0,
        expectedReviewRevision: item.publishedRevision,
        text: replyText,
        consentProjectionHash: replyHash,
      },
    });
    expect(outsiderReply.statusCode).toBeGreaterThanOrEqual(400);

    // Stale consent / duplicate new key.
    const stale = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        gameId: seeded.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: "0".repeat(64),
      },
    });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);

    // Future/cancelled excluded from held count.
    await seedHeldGame({
      organizerId: organizer.userId,
      participantId: participant.userId,
      endsAt: new Date("2099-01-01T12:00:00.000Z"),
      status: "published",
      outcome: "held",
    });
    await seedHeldGame({
      organizerId: organizer.userId,
      participantId: participant.userId,
      endsAt: past,
      status: "cancelled",
      outcome: "held",
    });
    const countRead = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
    });
    expect(countRead.json().heldGamesCount).toBe(1);
  });

  it("public reply stays bound to approved review revision across v2 approve", async () => {
    const organizer = await actor(`org-reply-v2-${randomUUID()}`);
    const participant = await actor(`part-reply-v2-${randomUUID()}`);
    const past = new Date("2026-10-02T18:00:00.000Z");
    const seeded = await seedHeldGame({
      organizerId: organizer.userId,
      participantId: participant.userId,
      endsAt: past,
      outcome: "held",
    });

    const v1Text = "Первая редакция\nДоговорённости нарушены";
    const v1Hash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text: v1Text,
      topics: ["agreements"],
    });
    const submitV1 = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        gameId: seeded.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: v1Text,
        topics: ["agreements"],
        consentProjectionHash: v1Hash,
      },
    });
    expect(submitV1.statusCode).toBe(200);
    const slotId = submitV1.json().id as string;
    const reviewHandle = submitV1.json().reviewHandle as string;
    const pendingV1 = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [slotId],
      )
    ).rows[0]!;
    const approvedV1 = await humanApprovePending(pendingV1.id, pendingV1.version);
    const actualV1 = approvedV1.revision.resourceVersion as number;

    const publicV1 = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: organizer.cookie },
    });
    expect(publicV1.statusCode).toBe(200);
    const itemV1 = publicV1.json().items[0];
    expect(itemV1.text).toBe(v1Text);
    expect(itemV1.publishedRevision).toBe(actualV1);
    expect(itemV1.reply).toBeNull();

    const replyV1Text = "Ответ на первую редакцию\nПринято";
    const replyV1Preview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "content-type": "application/json",
      },
      payload: { targetKind: "reply", reviewHandle, text: replyV1Text },
    });
    expect(replyV1Preview.statusCode).toBe(200);
    const replyV1 = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: itemV1.replyAggregateVersion,
        expectedReviewRevision: itemV1.publishedRevision,
        text: replyV1Text,
        consentProjectionHash: replyV1Preview.json().consentProjectionHash,
      },
    });
    expect(replyV1.statusCode).toBe(200);
    const replyPending = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND kind='reply_submit' AND status='waiting_intake'
         ORDER BY created_at DESC LIMIT 1`,
        [slotId],
      )
    ).rows[0]!;
    await humanApprovePending(replyPending.id, replyPending.version);

    const withReply = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: organizer.cookie },
    });
    expect(withReply.json().items[0].reply?.text).toBe(replyV1Text);
    expect(withReply.json().items[0].subjectOwnReply?.status).toBe("published");

    const v2Text = "Вторая редакция\nУточнение после ответа";
    const v2Hash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text: v2Text,
      topics: ["agreements"],
    });
    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { cookie: participant.cookie },
    });
    const own = mine.json().items.find((i: { id: string }) => i.id === slotId);
    const submitV2 = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${slotId}/commands`,
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: own.version,
        gameId: seeded.gameId,
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: v2Text,
        topics: ["agreements"],
        consentProjectionHash: v2Hash,
      },
    });
    expect(submitV2.statusCode).toBe(200);

    // Pending v2 must keep published v1 text + approved reply until human approves v2.
    const whilePending = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: organizer.cookie },
    });
    expect(whilePending.statusCode).toBe(200);
    expect(whilePending.json().publishedReviewCount).toBe(1);
    expect(whilePending.json().items).toHaveLength(1);
    expect(whilePending.json().items[0].text).toBe(v1Text);
    expect(whilePending.json().items[0].publishedRevision).toBe(actualV1);
    expect(whilePending.json().items[0].reply?.text).toBe(replyV1Text);
    // Existing report/reply gates stay on status=published — do not advertise while revision_waiting.
    expect(whilePending.json().items[0].allowedActions.canReply).toBe(false);
    expect(whilePending.json().items[0].allowedActions.canReport).toBe(false);

    const pendingV2 = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND kind='review_submit' AND status='waiting_intake'
         ORDER BY created_at DESC LIMIT 1`,
        [slotId],
      )
    ).rows[0]!;
    const approvedV2 = await humanApprovePending(pendingV2.id, pendingV2.version);
    const actualV2 = approvedV2.revision.resourceVersion as number;
    expect(actualV2).toBeGreaterThan(actualV1);

    const afterV2 = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: organizer.cookie },
    });
    expect(afterV2.json().items[0].text).toBe(v2Text);
    expect(afterV2.json().items[0].publishedRevision).toBe(actualV2);
    expect(afterV2.json().items[0].reply).toBeNull();
    // Do not pretend the v1-bound reply is still the subject's current published answer.
    expect(afterV2.json().items[0].subjectOwnReply).toBeNull();
    expect(afterV2.json().items[0].allowedActions.canReply).toBe(true);

    // Negative: stale expectedReviewRevision (actual v1) cannot submit a reply against approved v2.
    const staleReply = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: afterV2.json().items[0].replyAggregateVersion,
        expectedReviewRevision: actualV1,
        text: "Устаревший ответ\nНельзя",
        consentProjectionHash: projectionHash({
          subjectUserId: organizer.userId,
          role: "organization",
          audience: "public",
          text: "Устаревший ответ\nНельзя",
          topics: [],
          reviewRevision: actualV1,
        }),
      },
    });
    expect(staleReply.statusCode).toBeGreaterThanOrEqual(400);

    const replyV2Text = "Свежий ответ на вторую редакцию\nСогласен";
    const replyV2Preview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "content-type": "application/json",
      },
      payload: { targetKind: "reply", reviewHandle, text: replyV2Text },
    });
    expect(replyV2Preview.statusCode).toBe(200);
    const replyV2 = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: {
        cookie: organizer.cookie,
        "x-csrf-token": organizer.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: afterV2.json().items[0].replyAggregateVersion,
        expectedReviewRevision: actualV2,
        text: replyV2Text,
        consentProjectionHash: replyV2Preview.json().consentProjectionHash,
      },
    });
    expect(replyV2.statusCode).toBe(200);

    const pendingOnly = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: organizer.cookie },
    });
    expect(pendingOnly.json().items[0].reply).toBeNull();
    expect(pendingOnly.json().items[0].subjectOwnReply?.status).toMatch(
      /submitted|revision_waiting/,
    );

    const replyV2Pending = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND kind='reply_submit' AND status='waiting_intake'
         ORDER BY created_at DESC LIMIT 1`,
        [slotId],
      )
    ).rows[0]!;
    await humanApprovePending(replyV2Pending.id, replyV2Pending.version);

    const publishedV2Reply = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
      headers: { cookie: organizer.cookie },
    });
    expect(publishedV2Reply.json().items[0].reply?.text).toBe(replyV2Text);
    expect(publishedV2Reply.json().items[0].subjectOwnReply?.status).toBe("published");
  });

  it("native bearer public author loop: eligibility/create/pending/own/withdraw + negatives", async () => {
    const org = await actor(`native-org-${randomUUID()}`);
    const trainer = await actor(`native-trainer-${randomUUID()}`);
    const author = await actor(`native-author-${randomUUID()}`);
    const foreign = await actor(`native-foreign-${randomUUID()}`);
    const past = new Date("2026-09-15T18:00:00.000Z");
    const orgSeed = await seedHeldGame({
      organizerId: org.userId,
      participantId: author.userId,
      endsAt: past,
      outcome: "held",
    });
    const trainSeed = await seedHeldTrainerLed({
      organizerId: org.userId,
      trainerId: trainer.userId,
      participantId: author.userId,
      endsAt: past,
    });

    const bearer = await nativeBearer(author.userId);
    const eligOrg = await app.inject({
      method: "GET",
      url: `/v1/me/role-reviews/eligibility?roleHandle=${orgSeed.roleHandle}`,
      headers: bearer,
    });
    expect(eligOrg.statusCode).toBe(200);
    expect(eligOrg.headers["cache-control"]).toBe("no-store");
    const orgBases = eligOrg.json().bases.filter((b: { admission: string }) => b.admission === "may_submit");
    expect(orgBases.length).toBeGreaterThanOrEqual(1);
    expect(orgBases.some((b: { gameId: string }) => b.gameId === orgSeed.gameId)).toBe(true);

    const eligTrain = await app.inject({
      method: "GET",
      url: `/v1/me/role-reviews/eligibility?roleHandle=${trainSeed.roleHandle}`,
      headers: bearer,
    });
    expect(eligTrain.statusCode).toBe(200);
    expect(
      eligTrain.json().bases.some(
        (b: { gameId: string; admission: string }) =>
          b.gameId === trainSeed.gameId && b.admission === "may_submit",
      ),
    ).toBe(true);

    // Self / foreign / absent handle negatives.
    const selfElig = await app.inject({
      method: "GET",
      url: `/v1/me/role-reviews/eligibility?roleHandle=${orgSeed.roleHandle}`,
      headers: await nativeBearer(org.userId),
    });
    expect(selfElig.statusCode).toBe(200);
    expect(selfElig.json().bases.every((b: { admission: string }) => b.admission !== "may_submit")).toBe(
      true,
    );
    const foreignElig = await app.inject({
      method: "GET",
      url: `/v1/me/role-reviews/eligibility?roleHandle=${orgSeed.roleHandle}`,
      headers: await nativeBearer(foreign.userId),
    });
    expect(foreignElig.statusCode).toBe(200);
    expect(
      foreignElig.json().bases.every((b: { admission: string }) => b.admission !== "may_submit"),
    ).toBe(true);
    const absent = await app.inject({
      method: "GET",
      url: `/v1/me/role-reviews/eligibility?roleHandle=${"f".repeat(32)}`,
      headers: bearer,
    });
    expect(absent.statusCode).toBe(404);
    expect(absent.json().code).toBe("RESOURCE_UNAVAILABLE");

    // Self-marked attendance is not independently confirmed present → deny self_mark.
    // Isolated disposable participant/game (#522): coherent v1→v2 tip + revision; no rewind on orgSeed.
    const selfMarkedAuthor = await actor(`native-selfmark-${randomUUID()}`);
    const selfMarkSeed = await seedHeldGame({
      organizerId: org.userId,
      participantId: selfMarkedAuthor.userId,
      endsAt: past,
      outcome: "held",
    });
    await pool.query(
      `UPDATE game_attendance SET value='present', source='self_attested', actor_user_id=$2, version=version+1
       WHERE game_id=$1 AND user_id=$2`,
      [selfMarkSeed.gameId, selfMarkedAuthor.userId],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          recorded_at, before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason, reason)
       VALUES ($1,$2,$3,2,$3,'self_attested',clock_timestamp(),
               'present','present',false,false,NULL,NULL,'fixture_self_mark')`,
      [selfMarkSeed.participationId, selfMarkSeed.gameId, selfMarkedAuthor.userId],
    );
    const selfMarkElig = await app.inject({
      method: "GET",
      url: `/v1/me/role-reviews/eligibility?roleHandle=${orgSeed.roleHandle}`,
      headers: await nativeBearer(selfMarkedAuthor.userId),
    });
    expect(selfMarkElig.statusCode).toBe(200);
    const selfMarkBasis = selfMarkElig
      .json()
      .bases.find((b: { gameId: string }) => b.gameId === selfMarkSeed.gameId);
    expect(selfMarkBasis.admission).toBe("deny");
    expect(selfMarkBasis.reason).toBe("self_mark");

    // Open role dispute holds basis — not may_submit. Isolated game; positive orgSeed untouched.
    const disputeSeed = await seedHeldGame({
      organizerId: org.userId,
      participantId: author.userId,
      endsAt: past,
      outcome: "held",
    });
    await pool.query(
      `UPDATE game_role_proofs SET open_dispute=true, phase='disputed' WHERE game_id=$1 AND role='organization'`,
      [disputeSeed.gameId],
    );
    const disputedElig = await app.inject({
      method: "GET",
      url: `/v1/me/role-reviews/eligibility?roleHandle=${orgSeed.roleHandle}`,
      headers: await nativeBearer(author.userId),
    });
    expect(disputedElig.statusCode).toBe(200);
    const disputedBasis = disputedElig
      .json()
      .bases.find((b: { gameId: string }) => b.gameId === disputeSeed.gameId);
    expect(disputedBasis.admission).toBe("hold");
    expect(disputedBasis.reason).toBe("held_or_role_dispute");

    const multiline = "Нативный отзыв\nс переносом строки";
    const preview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: { ...bearer, "content-type": "application/json" },
      payload: {
        role: "organization",
        subjectRoleHandle: orgSeed.roleHandle,
        text: multiline,
        topics: ["agreements"],
      },
    });
    expect(preview.statusCode).toBe(200);
    const hash = preview.json().consentProjectionHash as string;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Role-specific topics mismatch on consent-preview.
    const badTopics = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: { ...bearer, "content-type": "application/json" },
      payload: {
        role: "organization",
        subjectRoleHandle: orgSeed.roleHandle,
        text: multiline,
        topics: ["explanations"],
      },
    });
    expect(badTopics.statusCode).toBe(422);
    expect(badTopics.json().code).toBe("ROLE_TOPICS_INVALID");

    const createKey = randomUUID();
    const create = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: { ...bearer, "idempotency-key": createKey, "content-type": "application/json" },
      payload: {
        gameId: orgSeed.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: hash,
      },
    });
    expect(create.statusCode).toBe(200);
    expect(create.json().pendingIntakeStatus).toBe("waiting_intake");
    expect(create.json().receiptToken).toBeTruthy();
    const slotId = create.json().id as string;

    // Pending is not anonymous publication.
    const anon = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${orgSeed.roleHandle}`,
    });
    expect(anon.statusCode).toBe(200);
    expect(anon.json().publishedReviewCount).toBe(0);
    expect(JSON.stringify(anon.json())).not.toContain(multiline);

    // Same-key replay under current authority.
    const replay = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: { ...bearer, "idempotency-key": createKey, "content-type": "application/json" },
      payload: {
        gameId: orgSeed.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: hash,
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(create.json());

    const staleBasis = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        ...(await nativeBearer(author.userId, randomUUID())),
        "content-type": "application/json",
      },
      payload: {
        gameId: orgSeed.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 1,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: hash,
      },
    });
    expect(staleBasis.statusCode).toBe(409);
    expect(staleBasis.json().code).toBe("VERSION_CONFLICT");

    const consentMismatch = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        ...(await nativeBearer(author.userId, randomUUID())),
        "content-type": "application/json",
      },
      payload: {
        gameId: orgSeed.gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: multiline,
        topics: ["agreements"],
        consentProjectionHash: "0".repeat(64),
      },
    });
    expect(consentMismatch.statusCode).toBe(422);
    expect(consentMismatch.json().code).toBe("ROLE_CONSENT_MISMATCH");

    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: bearer,
    });
    expect(mine.statusCode).toBe(200);
    const own = mine.json().items.find((i: { id: string }) => i.id === slotId);
    expect(own.status).toMatch(/submitted|revision_waiting/);
    expect(own.pendingIntakeStatus).toBe("waiting_intake");

    const withdrawKey = randomUUID();
    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${slotId}/commands`,
      headers: { ...bearer, "idempotency-key": withdrawKey, "content-type": "application/json" },
      payload: { action: "withdraw", expectedVersion: own.version },
    });
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json().status).toBe("withdrawn");
    // Receipt may still carry waiting_intake — status fence wins for clients.
    expect(withdraw.json().receiptToken).toBeTruthy();

    const afterWithdraw = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: bearer,
    });
    const withdrawn = afterWithdraw.json().items.find((i: { id: string }) => i.id === slotId);
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.text).toBeNull();
    expect(withdrawn.pendingIntakeStatus).toBe("none");

    // Training author loop: eligibility → create → own → withdraw (not eligibility-only).
    const trainText = "Тренировка\nбыла понятной";
    const trainPreview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: { ...bearer, "content-type": "application/json" },
      payload: {
        role: "training",
        subjectRoleHandle: trainSeed.roleHandle,
        text: trainText,
        topics: ["explanations"],
      },
    });
    expect(trainPreview.statusCode).toBe(200);
    const trainHash = trainPreview.json().consentProjectionHash as string;
    const trainCreate = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: { ...bearer, "idempotency-key": randomUUID(), "content-type": "application/json" },
      payload: {
        gameId: trainSeed.gameId,
        role: "training",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text: trainText,
        topics: ["explanations"],
        consentProjectionHash: trainHash,
      },
    });
    expect(trainCreate.statusCode).toBe(200);
    expect(trainCreate.json().pendingIntakeStatus).toBe("waiting_intake");
    const trainSlotId = trainCreate.json().id as string;
    const trainMine = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: bearer,
    });
    expect(trainMine.statusCode).toBe(200);
    const trainOwn = trainMine.json().items.find((i: { id: string }) => i.id === trainSlotId);
    expect(trainOwn.status).toMatch(/submitted|revision_waiting/);
    const trainWithdraw = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${trainSlotId}/commands`,
      headers: { ...bearer, "idempotency-key": randomUUID(), "content-type": "application/json" },
      payload: { action: "withdraw", expectedVersion: trainOwn.version },
    });
    expect(trainWithdraw.statusCode).toBe(200);
    expect(trainWithdraw.json().status).toBe("withdrawn");

    // Mixed cookie+bearer rejected; malformed/revoked/disabled; cookie CSRF still required on cookie path.
    const mixed = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { ...bearer, cookie: author.cookie },
    });
    expect(mixed.statusCode).toBe(403);
    expect(mixed.json().code).toBe("CREDENTIALS_CONFLICT");
    const malformed = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { authorization: `Bearer ${"x".repeat(43)}` },
    });
    expect(malformed.statusCode).toBe(401);

    const revokedCreds = await nativeBearer(author.userId);
    await sessions.revokeSession(revokedCreds.sessionId);
    const revoked = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { authorization: revokedCreds.authorization },
    });
    expect(revoked.statusCode).toBe(401);

    const disabledUser = await actor("disabled-native");
    const disabledCreds = await nativeBearer(disabledUser.userId);
    await pool.query(`UPDATE users SET status='disabled' WHERE id=$1`, [disabledUser.userId]);
    const disabled = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { authorization: disabledCreds.authorization },
    });
    expect(disabled.statusCode).toBe(401);

    const cookieNoCsrf = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: {
        cookie: author.cookie,
        origin,
        "content-type": "application/json",
      },
      payload: {
        role: "organization",
        subjectRoleHandle: orgSeed.roleHandle,
        text: "cookie",
        topics: [],
      },
    });
    expect(cookieNoCsrf.statusCode).toBe(403);
    expect(cookieNoCsrf.json().code).toBe("CSRF_REQUIRED");

    // Recipient reply/report now NativeBearer-capable — invalid/mixed authority stay fail-closed.
    const replyMissingKey = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${"c".repeat(32)}/reply-commands`,
      headers: { ...(await nativeBearer(org.userId)), "content-type": "application/json" },
      payload: {
        action: "submit_revision",
        expectedVersion: 0,
        expectedReviewRevision: 1,
        text: "denied",
        consentProjectionHash: "0".repeat(64),
      },
    });
    expect(replyMissingKey.statusCode).toBeGreaterThanOrEqual(400);
    const replyMixed = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${"c".repeat(32)}/reply-commands`,
      headers: {
        ...(await nativeBearer(org.userId, randomUUID())),
        cookie: org.cookie,
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: 0,
        expectedReviewRevision: 1,
        text: "denied",
        consentProjectionHash: "0".repeat(64),
      },
    });
    expect(replyMixed.statusCode).toBe(403);
    expect(replyMixed.json().code).toBe("CREDENTIALS_CONFLICT");
    const reportMixed = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${"c".repeat(32)}/reports`,
      headers: {
        ...(await nativeBearer(author.userId, randomUUID())),
        cookie: author.cookie,
        "content-type": "application/json",
      },
      payload: {
        targetKind: "review",
        expectedRevision: 1,
        reasonCode: "harassment",
      },
    });
    expect(reportMixed.statusCode).toBe(403);
    expect(reportMixed.json().code).toBe("CREDENTIALS_CONFLICT");
  });

  it("native bearer subject reply + outsider report on published review (game origin)", async () => {
    const past = new Date("2026-09-15T18:00:00.000Z");
    const org = await actor(`native-reply-org-${randomUUID()}`);
    const participant = await actor(`native-reply-part-${randomUUID()}`);
    const outsider = await actor(`native-reply-out-${randomUUID()}`);
    const seeded = await seedHeldGame({
      organizerId: org.userId,
      participantId: participant.userId,
      endsAt: past,
      outcome: "held",
    });
    const partBearer = await nativeBearer(participant.userId);
    const text = "Организация была ровной\nВсё по времени";
    const preview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: { ...partBearer, "content-type": "application/json" },
      payload: {
        role: "organization",
        subjectRoleHandle: seeded.roleHandle,
        text,
        topics: ["flow"],
      },
    });
    expect(preview.statusCode).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: { ...partBearer, "idempotency-key": randomUUID(), "content-type": "application/json" },
      payload: {
        gameId: seeded.gameId,
        role: "organization",
        expectedBasisVersions: { proofVersion: 2, outcomeVersion: 1, attendanceVersion: 1 },
        text,
        topics: ["flow"],
        consentProjectionHash: preview.json().consentProjectionHash,
      },
    });
    expect(created.statusCode).toBe(200);
    const reviewHandle = created.json().reviewHandle as string;
    const pending = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [created.json().id],
      )
    ).rows[0]!;
    await humanApprovePending(pending.id, pending.version);

    const orgBearer = await nativeBearer(org.userId);
    const actorPage = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}?gameId=${seeded.gameId}`,
      headers: orgBearer,
    });
    expect(actorPage.statusCode).toBe(200);
    const item = actorPage.json().items.find((i: { reviewHandle: string }) => i.reviewHandle === reviewHandle);
    expect(item.allowedActions.canReply).toBe(true);
    expect(item.allowedActions.canReport).toBe(true);
    // No reply tip yet — subjectOwnReply stays null until a reply row exists.
    expect(item.subjectOwnReply).toBeNull();

    const outBearer = await nativeBearer(outsider.userId);
    const outsiderPage = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}?gameId=${seeded.gameId}`,
      headers: outBearer,
    });
    const outItem = outsiderPage.json().items.find((i: { reviewHandle: string }) => i.reviewHandle === reviewHandle);
    expect(outItem.allowedActions.canReply).toBe(false);
    expect(outItem.allowedActions.canReport).toBe(true);
    expect(outItem.subjectOwnReply).toBeNull();

    const replyText = "Спасибо за отзыв\nУчтём";
    const replyPreview = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews/consent-preview",
      headers: { ...orgBearer, "content-type": "application/json" },
      payload: { targetKind: "reply", reviewHandle, text: replyText },
    });
    expect(replyPreview.statusCode).toBe(200);
    const replyKey = randomUUID();
    const reply = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: { ...orgBearer, "idempotency-key": replyKey, "content-type": "application/json" },
      payload: {
        action: "submit_revision",
        expectedVersion: item.replyAggregateVersion,
        expectedReviewRevision: item.publishedRevision,
        text: replyText,
        consentProjectionHash: replyPreview.json().consentProjectionHash,
      },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({
      version: item.replyAggregateVersion + 1,
      status: "submitted",
      receiptToken: expect.any(String),
    });
    expect(reply.json()).not.toHaveProperty("pendingIntakeStatus");
    expect(reply.json()).not.toHaveProperty("id");

    const replyReplay = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: { ...orgBearer, "idempotency-key": replyKey, "content-type": "application/json" },
      payload: {
        action: "submit_revision",
        expectedVersion: item.replyAggregateVersion,
        expectedReviewRevision: item.publishedRevision,
        text: replyText,
        consentProjectionHash: replyPreview.json().consentProjectionHash,
      },
    });
    expect(replyReplay.statusCode).toBe(200);
    expect(replyReplay.json().receiptToken).toBe(reply.json().receiptToken);

    const afterReply = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}?gameId=${seeded.gameId}`,
      headers: orgBearer,
    });
    const tip = afterReply.json().items.find((i: { reviewHandle: string }) => i.reviewHandle === reviewHandle);
    expect(tip.subjectOwnReply?.status).toMatch(/submitted|revision_waiting/);
    expect(tip.subjectOwnReply?.pendingRevision).toBeTruthy();
    // Submitted acknowledgement is not published public reply text.
    expect(tip.reply).toBeNull();

    const staleAgg = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reply-commands`,
      headers: { ...(await nativeBearer(org.userId, randomUUID())), "content-type": "application/json" },
      payload: {
        action: "submit_revision",
        expectedVersion: item.replyAggregateVersion,
        expectedReviewRevision: item.publishedRevision,
        text: replyText,
        consentProjectionHash: replyPreview.json().consentProjectionHash,
      },
    });
    expect(staleAgg.statusCode).toBe(409);

    const reportKey = randomUUID();
    const report = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reports?gameId=${seeded.gameId}`,
      headers: { ...outBearer, "idempotency-key": reportKey, "content-type": "application/json" },
      payload: {
        targetKind: "review",
        expectedRevision: item.publishedRevision,
        reasonCode: "harassment",
        explanation: "Оскорбительный тон",
      },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toEqual({
      reportId: expect.any(String),
      receiptToken: expect.any(String),
      status: "submitted",
    });
    const reportDedupe = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reports?gameId=${seeded.gameId}`,
      headers: { ...outBearer, "idempotency-key": reportKey, "content-type": "application/json" },
      payload: {
        targetKind: "review",
        expectedRevision: item.publishedRevision,
        reasonCode: "harassment",
        explanation: "Оскорбительный тон",
      },
    });
    expect(reportDedupe.statusCode).toBe(200);
    expect(reportDedupe.json().reportId).toBe(report.json().reportId);

    const afterReport = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}?gameId=${seeded.gameId}`,
      headers: outBearer,
    });
    const stillVisible = afterReport.json().items.find((i: { reviewHandle: string }) => i.reviewHandle === reviewHandle);
    expect(stillVisible.text).toBe(text);
    expect(stillVisible.allowedActions.canReport).toBe(true);
  });
});
