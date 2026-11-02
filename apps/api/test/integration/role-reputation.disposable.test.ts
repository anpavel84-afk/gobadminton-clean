import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
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

run("#394 role reputation — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let organizer: Actor;
  let participant: Actor;
  let outsider: Actor;
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
    });
    const ref = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), GamesModule, VenuesModule, ProfilesModule],
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
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function actor(label: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, status) VALUES ($1, 'active')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, public_player_id, display_name, directory_visible, social_eligible,
          contact_policy, directory_visibility_provenance, consent_policy_version)
       VALUES ($1, $2, $3, true, true, 'closed', 'owner_explicit', 'v1')`,
      [userId, randomUUID(), `Player ${label}`],
    );
    const session = await sessions.createSession(userId);
    return {
      userId,
      sessionId: session.id,
      csrfToken: session.csrfToken,
      cookie: `${SESSION_COOKIE}=${session.token}`,
    };
  }

  async function seedHeldGame(opts: {
    organizerId: string;
    participantId: string;
    endsAt: Date;
    status?: string;
    outcome?: "held" | "not_held" | null;
    future?: boolean;
  }) {
    const venueId = randomUUID();
    await pool.query(
      `INSERT INTO venues (id, name, city_id, status, created_by_user_id, version)
       VALUES ($1, 'Court', $2, 'active', $3, 1)
       ON CONFLICT DO NOTHING`,
      [venueId, MOSCOW_CITY_ID, opts.organizerId],
    ).catch(async () => {
      // venue schema may use different columns — fall back to existing city venue
    });
    const venue = (
      await pool.query<{ id: string }>(`SELECT id FROM venues LIMIT 1`)
    ).rows[0];
    const gameId = randomUUID();
    const starts = new Date(opts.endsAt.getTime() - 3600_000);
    await pool.query(
      `INSERT INTO games (
         id, version, title, status, visibility, activity_kind, venue_id,
         starts_at, ends_at, timezone, capacity, external_reserved_count,
         created_by_user_id, host_display_name, host_public_contact,
         settlement_purpose, published_at
       ) VALUES (
         $1, 1, 'Game', $2, 'public', 'regular', $3,
         $4, $5, 'Europe/Moscow', 4, 0,
         $6, 'Host', 'host@example.test',
         'no_trainer_fee', clock_timestamp()
       )`,
      [
        gameId,
        opts.status ?? "completed",
        venue?.id ?? venueId,
        starts.toISOString(),
        opts.endsAt.toISOString(),
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
      `INSERT INTO participation_transitions (id, participation_id, to_status, at)
       VALUES ($1, $2, 'confirmed', $3)`,
      [randomUUID(), participationId, starts.toISOString()],
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
         (participation_id, game_id, value, late, source, actor_user_id, version)
       VALUES ($1, $2, 'present', false, 'manager_explicit', $3, 1)`,
      [participationId, gameId, opts.organizerId],
    );
    // Planned + performed proof (no current-manager invention for missing history).
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
    const handle = createHash("sha256").update(gameId).digest("hex").slice(0, 32);
    await pool.query(
      `INSERT INTO role_reputation_subjects
         (subject_user_id, role, public_handle, version)
       VALUES ($1,'organization',$2,1)
       ON CONFLICT (subject_user_id, role) DO UPDATE SET updated_at=clock_timestamp()
       RETURNING public_handle`,
      [opts.organizerId, handle],
    );
    const subject = (
      await pool.query<{ public_handle: string }>(
        `SELECT public_handle FROM role_reputation_subjects
         WHERE subject_user_id=$1 AND role='organization'`,
        [opts.organizerId],
      )
    ).rows[0]!;
    return { gameId, participationId, roleHandle: subject.public_handle };
  }

  it("outsider can read but not write; own past role can submit pending; self denied", async () => {
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

    const text = "Организация была слабой";
    const hash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text,
      topics: ["agreements"],
    });
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
        text,
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
        text,
        topics: ["agreements"],
        consentProjectionHash: projectionHash({
          subjectUserId: organizer.userId,
          role: "organization",
          audience: "public",
          text,
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
        text,
        topics: ["agreements"],
        consentProjectionHash: hash,
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pendingIntakeStatus).toBe("waiting_intake");
    expect(ok.json().status).toBe("submitted");

    // Pending not public.
    const after = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${seeded.roleHandle}`,
    });
    expect(after.json().publishedReviewCount).toBe(0);
    expect(after.json().items).toEqual([]);

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
        text,
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
});
