/**
 * Bounded admin venue-review intake/decide checks. Skipped unless RUN_DB_INTEGRATION=1.
 * Author does not execute live WebAuthn/DB.
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
const adminOrigin = "http://localhost:18996";
const pepper = "admin-venue-rev-pepper-at-least-32chars!!";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_admin_venue_reviews_disposable";
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

type AdminActor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

run("#394 admin venue reviews — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let reviewer: AdminActor;
  let conflicted: AdminActor;
  let authorUserId: string;
  let authorCookie: string;
  let authorCsrf: string;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "admin-venue-reviews-synthetic",
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
      AUTH_PEPPER: "admin-venue-rev-synthetic-pepper!!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "admin-venue-rev-fingerprint!!!!!!!!",
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
    reviewer = await adminActor("superadmin");
    conflicted = await adminActor("moderator");
    authorUserId = randomUUID();
    await pool.query(`INSERT INTO users (id, status) VALUES ($1, 'active')`, [authorUserId]);
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, public_player_id, display_name, directory_visible, social_eligible,
          contact_policy, directory_visibility_provenance, consent_policy_version)
       VALUES ($1, $2, 'Author', true, true, 'closed', 'owner_default', 'v1')`,
      [authorUserId, randomUUID()],
    );
    const issued = await sessions.createConsumerSession(authorUserId);
    authorCookie = `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`;
    authorCsrf = issued.csrfToken;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

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
      [credentialId, id, Buffer.from("synthetic-admin-venue")],
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

  async function seedSubmittedReview() {
    const organizerId = randomUUID();
    await pool.query(`INSERT INTO users (id, status) VALUES ($1, 'active')`, [organizerId]);
    const venue = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(
           city_id, name, address, timezone, location, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address
         ) VALUES (
           $1, 'Admin Venue', 'Addr', 'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography, $2,
           'unverified', 'admin venue', 'addr'
         ) RETURNING id`,
        [MOSCOW_CITY_ID, organizerId],
      )
    ).rows[0]!;
    const endsAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const starts = new Date(endsAt.getTime() - 3600_000);
    const gameId = randomUUID();
    await pool.query(
      `INSERT INTO games (
         id, version, title, status, visibility, activity_kind, venue_id,
         starts_at, ends_at, timezone, application_deadline_at,
         capacity, external_reserved_count,
         format_key, level_scale_id, level_scale_version, allowed_level_ids,
         settlement_mode, settlement_purpose, settlement_terms,
         created_by_user_id, host_display_name, host_public_contact, published_at
       ) VALUES (
         $1, 1, 'G', 'completed', 'public', 'regular', $2,
         $3, $4, 'Europe/Moscow', $5, 4, 0,
         'doubles', 'ntrp', 1, '["3.0"]'::jsonb,
         'external', 'no_trainer_fee', 'terms',
         $6, 'H', 'h@t', clock_timestamp()
       )`,
      [gameId, venue.id, starts.toISOString(), endsAt.toISOString(), starts.toISOString(), organizerId],
    );
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status) VALUES ($1,$2,'owner','active')`,
      [gameId, organizerId],
    );
    // Historic manager seat for conflicted reviewer (revoked) — still COI.
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1,$2,'manager','revoked')`,
      [gameId, conflicted.userId],
    );
    const participationId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status, confirmed_at)
       VALUES ($1,$2,$3,'confirmed',$4)`,
      [participationId, gameId, authorUserId, starts.toISOString()],
    );
    await pool.query(
      `INSERT INTO participation_transitions
         (id, participation_id, from_status, to_status, actor_id, reason_code,
          aggregate_version, game_version, at)
       VALUES ($1,$2,NULL,'confirmed',$3,'t',1,1,$4)`,
      [randomUUID(), participationId, authorUserId, starts.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_outcomes
         (game_id, value, version, reason, source, actor_user_id, recorded_at, updated_at)
       VALUES ($1,'held',1,NULL,'manager_explicit',$2,$3,$3)`,
      [gameId, organizerId, endsAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_outcome_revisions
         (game_id, resource_version, actor_user_id, source,
          before_value, after_value, before_reason, after_reason, reason, recorded_at)
       VALUES ($1,1,$2,'manager_explicit',NULL,'held',NULL,NULL,NULL,$3)`,
      [gameId, organizerId, endsAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id, game_id, user_id, value, late, source, actor_user_id, version)
       VALUES ($1,$2,$3,'present',false,'manager_explicit',$4,1)`,
      [participationId, gameId, authorUserId, organizerId],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          recorded_at, before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',$5,NULL,'present',NULL,false,NULL,NULL)`,
      [participationId, gameId, authorUserId, organizerId, endsAt.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_played_at_venue_attributions
         (game_id, source_venue_id, game_version, source, actor_user_id)
       VALUES ($1,$2,1,'held_confirm',$3)`,
      [gameId, venue.id, organizerId],
    );
    const text = "Свет ровный, покрытие сухое.";
    const hash = projectionHash({
      canonicalVenueId: venue.id,
      audience: "public_venue",
      text,
      topics: ["lighting"],
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/me/venue-reviews",
      headers: {
        cookie: authorCookie,
        "x-csrf-token": authorCsrf,
        origin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        venueId: venue.id,
        gameId,
        audience: "public_venue",
        expectedBasisVersions: { outcomeVersion: 1, attendanceVersion: 1 },
        text,
        topics: ["lighting"],
        consentProjectionHash: hash,
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    const pending = (
      await pool.query<{ id: string; version: number; revision_id: string }>(
        `SELECT id, version, revision_id FROM venue_review_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake'`,
        [created.json().id],
      )
    ).rows[0]!;
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
    return { pending, venueId: venue.id, gameId, handle: created.json().reviewHandle as string };
  }

  it("lists pending; historic manager COI denied; independent approve with step-up CAS", async () => {
    const seeded = await seedSubmittedReview();
    const list = await app.inject({
      method: "GET",
      url: "/v1/admin/venue-reviews/pending-intakes",
      cookies: { [ADMIN_COOKIE]: reviewer.token },
      headers: { origin: adminOrigin },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.some((i: { pendingIntakeId: string }) => i.pendingIntakeId === seeded.pending.id)).toBe(
      true,
    );

    const coi = await app.inject({
      method: "POST",
      url: "/v1/admin/cases/venue-review-intake",
      cookies: { [ADMIN_COOKIE]: conflicted.token },
      headers: {
        origin: adminOrigin,
        "x-csrf-token": conflicted.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        pendingIntakeId: seeded.pending.id,
        expectedIntakeVersion: seeded.pending.version,
        reasonCode: "operations_review",
        assignToSelf: true,
      },
    });
    expect(coi.statusCode).toBeGreaterThanOrEqual(400);

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
        pendingIntakeId: seeded.pending.id,
        expectedIntakeVersion: seeded.pending.version,
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
    expect(source.json().reviewRevision.projectionHash).toBeTruthy();
    expect(source.json().reviewRevision.text).toContain("Свет");

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
        expectedCaseVersion: intake.json().caseVersion,
        expectedResourceVersion: source.json().reviewRevision.resourceVersion + 1,
        exactRevisionId: source.json().reviewRevision.id,
        decision: "approve",
        rationale: "stale version must fail",
        reasonCode: "operations_review",
      },
    });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);

    const ok = await app.inject({
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
        expectedResourceVersion: source.json().reviewRevision.resourceVersion,
        exactRevisionId: source.json().reviewRevision.id,
        decision: "approve",
        rationale: "Independent exact-revision approve",
        reasonCode: "operations_review",
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().notBefore).toBeTruthy();
  });
});
