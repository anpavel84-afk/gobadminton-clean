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
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { projectionHash } from "../../src/games/role-reputation.policy";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

/**
 * Bounded #394 role-reputation HTTP checks. Skipped unless RUN_DB_INTEGRATION=1
 * against dedicated disposable DB. Never creates live sessions/credentials.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
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
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "role-rep-synthetic-fixture-pepper!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "role-rep-synthetic-fingerprint!!!!!",
      POST_GAME_INTERNAL_ENABLED: "1",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      CASES_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: pepper,
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
    expect(whilePending.json().items[0].text).toBe(v1Text);
    expect(whilePending.json().items[0].publishedRevision).toBe(actualV1);
    expect(whilePending.json().items[0].reply?.text).toBe(replyV1Text);

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
});
