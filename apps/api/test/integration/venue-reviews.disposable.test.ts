/**
 * Bounded #394 venue-experience HTTP checks. Skipped unless RUN_DB_INTEGRATION=1
 * against dedicated disposable DB. Author does not execute live DB.
 */
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
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { projectionHash } from "../../src/venues/venue-reviews.policy";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
const adminOrigin = "http://localhost:18995";
const pepper = "venue-rev-consumer-admin-pepper-32chars!";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_venue_reviews_disposable";
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

run("#394 venue experience — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let organizer: Actor;
  let participant: Actor;
  let outsider: Actor;
  let reviewer: AdminActor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "venue-reviews-synthetic",
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
      AUTH_PEPPER: "venue-rev-synthetic-fixture-pepper!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-rev-synthetic-fingerprint!!!!!",
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
      [credentialId, id, Buffer.from("synthetic-venue-rev")],
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

  async function seedHeldGame(opts: {
    organizerId: string;
    participantId: string;
    endsAt: Date;
    attribution?: boolean;
    venueCreatedBy?: string;
  }) {
    const venue = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(
           city_id, name, address, timezone, location, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address
         ) VALUES (
           $1, 'VenueExp Court', 'Synthetic address', 'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography, $2,
           'unverified', 'venueexp court', 'synthetic address'
         ) RETURNING id`,
        [MOSCOW_CITY_ID, opts.venueCreatedBy ?? opts.organizerId],
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
         $1, 1, 'Practice match', 'completed', 'unlisted', 'regular', $2,
         $3, $4, 'Europe/Moscow', $5,
         4, 0,
         'doubles', 'ntrp', 1, '["3.0","3.5"]'::jsonb,
         'external', 'no_trainer_fee', 'Synthetic settlement terms',
         $6, 'Host', 'host@example.test',
         clock_timestamp()
       )`,
      [
        gameId,
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
    const heldAt = new Date(opts.endsAt.getTime() + 60_000);
    await pool.query(
      `INSERT INTO game_outcomes
         (game_id, value, version, reason, source, actor_user_id, recorded_at, updated_at)
       VALUES ($1, 'held', 1, NULL, 'manager_explicit', $2, $3, $3)`,
      [gameId, opts.organizerId, heldAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_outcome_revisions
         (game_id, resource_version, actor_user_id, source,
          before_value, after_value, before_reason, after_reason, reason, recorded_at)
       VALUES ($1, 1, $2, 'manager_explicit', NULL, 'held', NULL, NULL, NULL, $3)`,
      [gameId, opts.organizerId, heldAt.toISOString()],
    );
    const presentAt = new Date(heldAt.getTime() + 60_000);
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id, game_id, user_id, value, late, source, actor_user_id, version,
          recorded_at, updated_at)
       VALUES ($1, $2, $3, 'present', false, 'manager_explicit', $4, 1, $5, $5)`,
      [participationId, gameId, opts.participantId, opts.organizerId, presentAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          recorded_at, before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',$5,NULL,'present',NULL,false,NULL,NULL)`,
      [participationId, gameId, opts.participantId, opts.organizerId, presentAt.toISOString()],
    );
    if (opts.attribution !== false) {
      await pool.query(
        `INSERT INTO game_played_at_venue_attributions
           (game_id, source_venue_id, game_version, source, actor_user_id, recorded_at)
         VALUES ($1, $2, 1, 'held_confirm', $3, $4)`,
        [gameId, venue.id, opts.organizerId, heldAt.toISOString()],
      );
    }
    return { gameId, participationId, venueId: venue.id, heldAt, presentAt };
  }

  async function humanApprovePending(pendingIntakeId: string, expectedIntakeVersion = 1) {
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
        expectedIntakeVersion,
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
    expect(source.statusCode).toBe(200);
    const revision = source.json().reviewRevision;
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
        action: "venue_review_decide",
        expectedCaseVersion: intake.json().caseVersion,
        expectedResourceVersion: revision.resourceVersion,
        exactRevisionId: revision.id,
        decision: "approve",
        rationale: "Synthetic venue approve for disposable roundtrip",
        reasonCode: "operations_review",
      },
    });
    expect(decide.statusCode).toBe(200);
    return { caseId, revision, notBefore: decide.json().notBefore as string | null };
  }

  it("guest read allowed; write denied without CSRF/session; missing attribution fail-closed", async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const seeded = await seedHeldGame({
      organizerId: organizer.userId,
      participantId: participant.userId,
      endsAt: past,
    });
    const guestRead = await app.inject({
      method: "GET",
      url: `/v1/venues/${seeded.venueId}/experience-reviews`,
    });
    expect(guestRead.statusCode).toBe(200);
    expect(guestRead.json().items).toEqual([]);
    expect(guestRead.json()).not.toHaveProperty("authorUserId");

    const guestWrite = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews",
      headers: { origin, "content-type": "application/json", "idempotency-key": randomUUID() },
      payload: {
        venueId: seeded.venueId,
        gameId: seeded.gameId,
        audience: "self_draft",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: "Покрытие удобное",
        topics: ["surface"],
      },
    });
    expect(guestWrite.statusCode).toBeGreaterThanOrEqual(400);

    const noHist = await seedHeldGame({
      organizerId: organizer.userId,
      participantId: participant.userId,
      endsAt: past,
      attribution: false,
    });
    // Retarget current row — must not invent historical played-at.
    const otherVenue = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(
           city_id, name, address, timezone, location, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address
         ) VALUES (
           $1, 'Other Court', 'Other address', 'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.63, 55.76), 4326)::geography, $2,
           'unverified', 'other court', 'other address'
         ) RETURNING id`,
        [MOSCOW_CITY_ID, organizer.userId],
      )
    ).rows[0]!;
    await pool.query(`UPDATE games SET venue_id=$2, version=version+1 WHERE id=$1`, [
      noHist.gameId,
      otherVenue.id,
    ]);
    const elig = await app.inject({
      method: "GET",
      url: `/v1/me/venue-reviews/eligibility?venueId=${otherVenue.id}`,
      headers: { cookie: participant.cookie },
    });
    expect(elig.statusCode).toBe(200);
    expect(elig.json().bases).toEqual([]);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        venueId: otherVenue.id,
        gameId: noHist.gameId,
        audience: "self_draft",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: "Нельзя переатрибутировать",
        topics: ["surface"],
      },
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("eligible held+present draft→consent→intake→approve+48h guest projection; edit keeps approved text; report does not hide", async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const seeded = await seedHeldGame({
      organizerId: organizer.userId,
      participantId: participant.userId,
      endsAt: past,
      venueCreatedBy: outsider.userId,
    });

    const draft = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        venueId: seeded.venueId,
        gameId: seeded.gameId,
        audience: "self_draft",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: "Покрытие удобное, места между кортами достаточно.",
        topics: ["surface"],
      },
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json().status).toBe("self_draft");
    expect(draft.json().publicVisible).toBe(false);

    const fence = (
      await pool.query<{ first_eligible_at: Date }>(
        `SELECT first_eligible_at FROM venue_review_event_fences
         WHERE author_user_id=$1 AND game_id=$2`,
        [participant.userId, seeded.gameId],
      )
    ).rows[0]!;
    expect(new Date(fence.first_eligible_at).getTime()).toBe(seeded.presentAt.getTime());

    const text =
      "Покрытие удобное, места между кортами достаточно. Боковой свет мешает следить за воланом.";
    const topics = ["surface", "lighting"] as const;
    const hash = projectionHash({
      canonicalVenueId: seeded.venueId,
      audience: "public_venue",
      text,
      topics: [...topics],
    });
    const preview = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews/consent-preview",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "content-type": "application/json",
      },
      payload: { venueId: seeded.venueId, text, topics: [...topics] },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().consentProjectionHash).toBe(hash);
    expect(preview.json().authorLabel).toBe("Участник игры");

    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/venue-reviews",
      headers: { cookie: participant.cookie },
    });
    const ownId = mine.json().items[0].id as string;
    const submit = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${ownId}/commands`,
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: draft.json().version,
        gameId: seeded.gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text,
        topics: [...topics],
        consentProjectionHash: hash,
      },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().status).toBe("submitted_waiting");
    expect(submit.json().receiptToken).toBeTruthy();

    const pending = (
      await pool.query<{ id: string; version: number; revision_id: string }>(
        `SELECT id, version, revision_id FROM venue_review_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake' ORDER BY created_at DESC LIMIT 1`,
        [ownId],
      )
    ).rows[0]!;
    // Disposable-only: age last_material_edit so approve+48h gate is already satisfied at decide time.
    {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query(
          `UPDATE venue_review_revisions
           SET last_material_edit_at = clock_timestamp() - interval '3 days'
           WHERE id=$1`,
          [pending.revision_id],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    const approved = await humanApprovePending(pending.id, pending.version);
    expect(approved.notBefore).toBeTruthy();
    expect(new Date(approved.notBefore!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    const publicAfter = await app.inject({
      method: "GET",
      url: `/v1/venues/${seeded.venueId}/experience-reviews`,
    });
    expect(publicAfter.statusCode).toBe(200);
    expect(publicAfter.json().publishedCount).toBe(1);
    expect(publicAfter.json().items[0].authorLabel).toBe("Участник игры");
    expect(publicAfter.json().items[0].text).toBe(text);
    expect(JSON.stringify(publicAfter.json())).not.toContain(seeded.gameId);
    expect(JSON.stringify(publicAfter.json())).not.toContain(participant.userId);

    const edited = "Новая редакция ожидает одобрения; старый текст остаётся публичным.";
    const editHash = projectionHash({
      canonicalVenueId: seeded.venueId,
      audience: "public_venue",
      text: edited,
      topics: ["amenities"],
    });
    const slotVersion = (
      await pool.query<{ version: number }>(`SELECT version FROM venue_review_slots WHERE id=$1`, [
        ownId,
      ])
    ).rows[0]!.version;
    const pendingEdit = await app.inject({
      method: "POST",
      url: `/v1/me/venue-reviews/${ownId}/commands`,
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: slotVersion,
        gameId: seeded.gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: edited,
        topics: ["amenities"],
        consentProjectionHash: editHash,
      },
    });
    expect(pendingEdit.statusCode).toBe(200);
    expect(pendingEdit.json().status).toBe("revision_waiting");

    const stillOld = await app.inject({
      method: "GET",
      url: `/v1/venues/${seeded.venueId}/experience-reviews`,
    });
    expect(stillOld.json().items[0].text).toBe(text);

    const handle = stillOld.json().items[0].reviewHandle as string;
    const report = await app.inject({
      method: "POST",
      url: `/v1/venue-reviews/${handle}/reports`,
      headers: {
        cookie: outsider.cookie,
        "x-csrf-token": outsider.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        expectedRevision: stillOld.json().items[0].publishedRevision,
        reasonCode: "spam",
      },
    });
    expect(report.statusCode).toBe(200);
    const afterReport = await app.inject({
      method: "GET",
      url: `/v1/venues/${seeded.venueId}/experience-reviews`,
    });
    expect(afterReport.json().publishedCount).toBe(1);
    expect(afterReport.json().items[0].text).toBe(text);

    const outsiderWrite = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews",
      headers: {
        cookie: outsider.cookie,
        "x-csrf-token": outsider.csrfToken,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        venueId: seeded.venueId,
        gameId: seeded.gameId,
        audience: "self_draft",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text: "Не участник",
        topics: ["surface"],
      },
    });
    expect(outsiderWrite.statusCode).toBeGreaterThanOrEqual(400);
  });
});
