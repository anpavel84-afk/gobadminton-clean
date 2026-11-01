import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_attendance_disposable";
  const hosted = url.pathname === "/gobadminton" && process.env.GITHUB_ACTIONS === "true"
    && process.env.GMAP1_DISPOSABLE_DB === "1" && /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "")
    && url.port === process.env.CI_DB_PORT;
  if (process.env.NODE_ENV !== "test" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.search || url.hash || !(dedicated || hosted)) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };
type Response = Awaited<ReturnType<NestFastifyApplication["inject"]>>;

run("PG-1b GameAttendance — disposable synthetic PostGIS", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let manager: Actor;
  let participant: Actor;
  let withdrawn: Actor;
  let outsider: Actor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 5000, application_name: "pg1b-synthetic" });
    const existing = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'");
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql") && f < "0047").sort()) {
      await migrate(file);
    }
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "pg1b-synthetic-fixture-pepper-only!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "pg1b-synthetic-fingerprint-fixture!!",
      POST_GAME_INTERNAL_ENABLED: "1",
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

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, "rollback/0046_game_attendance.sql"), "utf8"));
      expect((await client.query("SELECT to_regclass('game_attendance') AS name")).rows[0].name).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 120000);

  async function migrate(file: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    env.POST_GAME_INTERNAL_ENABLED = true;
    manager = await actor("PG1b manager");
    participant = await actor("PG1b participant");
    withdrawn = await actor("PG1b withdrawn");
    outsider = await actor("PG1b outsider");
  });

  async function actor(name: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, name]);
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  const key = () => `pg1b-synthetic-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return { cookie: who.cookie, origin, "x-csrf-token": who.csrfToken, "idempotency-key": idem };
  }
  function get(who: Actor, url: string): Promise<Response> {
    return app.inject({ method: "GET", url, headers: { cookie: who.cookie } }) as Promise<Response>;
  }
  function put(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "PUT",
      url,
      payload: payload as object,
      headers: headers(who, idem),
    }) as Promise<Response>;
  }
  function post(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "POST",
      url,
      payload: payload as object,
      headers: headers(who, idem),
    }) as Promise<Response>;
  }

  async function createEndedGame(owner: Actor) {
    const venue = await post(owner, "/v1/venues", {
      cityId: MOSCOW_CITY_ID,
      name: `PG1b court ${randomUUID()}`,
      address: "Synthetic Moscow",
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
    });
    expect([200, 201]).toContain(venue.statusCode);
    const starts = Date.now() + 7 * 86400000;
    const draft = await post(owner, "/v1/games", {
      hostDisplayName: "Synthetic host",
      hostPublicContact: "telegram:@synthetic_private",
      venueId: venue.json().id,
      title: "PG1b disposable game",
      startsAt: new Date(starts).toISOString(),
      endsAt: new Date(starts + 7200000).toISOString(),
      timezone: "Europe/Moscow",
      applicationDeadlineAt: new Date(starts - 86400000).toISOString(),
      capacity: 4,
      externalReservedCount: 0,
      visibility: "public",
      formatKey: "doubles",
      activityKind: "regular",
      levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0", "3.5"] },
      settlement: {
        mode: "external",
        purpose: "no_trainer_fee",
        priceMinor: null,
        currency: null,
        terms: "PRIVATE TERMS SENTINEL",
      },
    });
    expect(draft.statusCode).toBe(201);
    const published = await post(owner, `/v1/games/${draft.json().id}/publish`, {
      expectedVersion: draft.json().version,
    });
    expect(published.statusCode).toBe(200);
    await pool.query(
      `UPDATE games
       SET starts_at = clock_timestamp() - interval '3 hours',
           application_deadline_at = clock_timestamp() - interval '4 hours',
           ends_at = clock_timestamp() - interval '1 hour'
       WHERE id = $1`,
      [published.json().id],
    );
    return published.json() as { id: string; version: number };
  }

  async function confirmWithTransition(gameId: string, userId: string, atOffsetHours = -4) {
    const part = await pool.query<{ id: string }>(
      `INSERT INTO participations (game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, 'confirmed', clock_timestamp() + ($3 || ' hours')::interval)
       RETURNING id`,
      [gameId, userId, String(atOffsetHours)],
    );
    const id = part.rows[0]!.id;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version, at)
       VALUES ($1, NULL, 'confirmed', $2, 'test_confirm', 1, 1, clock_timestamp() + ($3 || ' hours')::interval)`,
      [id, userId, String(atOffsetHours)],
    );
    return id;
  }

  it("no time inference; manager marks; notice+ack+dispute; withdrawn-before-start excluded; outsider 404", async () => {
    const g = await createEndedGame(manager);
    const contextId = await confirmWithTransition(g.id, participant.userId, -4);
    const withdrawnId = await confirmWithTransition(g.id, withdrawn.userId, -5);
    await pool.query(
      `UPDATE participations SET status='withdrawn' WHERE id=$1`,
      [withdrawnId],
    );
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version, at)
       VALUES ($1, 'confirmed', 'withdrawn', $2, 'test_withdraw', 2, 1, clock_timestamp() - interval '4 hours')`,
      [withdrawnId, withdrawn.userId],
    );

    const results = await get(manager, `/v1/games/${g.id}/results`);
    expect(results.statusCode).toBe(200);
    expect(results.headers["cache-control"]).toBe("no-store");
    expect(results.json().attendance.installed).toBe(true);
    expect(results.json().attendance.roster.map((r: { contextId: string }) => r.contextId)).toContain(contextId);
    expect(results.json().attendance.roster.map((r: { contextId: string }) => r.contextId)).not.toContain(withdrawnId);
    expect(results.json().attendance.summary.unknown).toBeGreaterThanOrEqual(1);

    env.POST_GAME_INTERNAL_ENABLED = false;
    expect((await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
      expectedVersion: 0,
      value: "absent",
    })).statusCode).toBe(503);
    env.POST_GAME_INTERNAL_ENABLED = true;

    const marked = await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
      expectedVersion: 0,
      value: "absent",
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({
      contextId,
      value: "absent",
      version: 1,
      assertion: { source: "manager_explicit" },
    });

    const notices = await get(participant, "/v1/me/game-results");
    expect(notices.statusCode).toBe(200);
    expect(notices.json().items[0]).toMatchObject({
      gameId: g.id,
      contextId,
      notice: { attendanceVersion: 1, value: "absent", acknowledgedAt: null },
    });

    const dispute = await post(participant, `/v1/games/${g.id}/attendance/${contextId}/disputes`, {
      attendanceVersion: 1,
      explanation: "Я была на втором корте",
    });
    expect(dispute.statusCode).toBe(201);
    expect(dispute.json().status).toBe("open");

    const corrected = await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
      expectedVersion: 1,
      value: "present",
      late: true,
      correctionReason: "Уточнили состав",
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({
      value: "present",
      version: 2,
      late: true,
      dispute: { status: "open", challengedVersion: 1 },
    });

    const ackOld = await post(participant, `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`, {
      attendanceVersion: 1,
    });
    expect(ackOld.statusCode).toBe(409);

    const ack = await post(participant, `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`, {
      attendanceVersion: 2,
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().acknowledgedVersion).toBe(2);

    expect((await get(outsider, `/v1/games/${g.id}/results`)).statusCode).toBe(404);
    expect((await get(outsider, `/v1/attendance-disputes/${dispute.json().id}`)).statusCode).toBe(404);

    const bulk = await post(manager, `/v1/games/${g.id}/attendance/bulk-present`, {
      items: [{ contextId, expectedVersion: 2 }],
      confirmedExactSelection: true,
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().items[0]).toMatchObject({ contextId, value: "present", version: 3 });
  });

  it("idempotent PUT replay; version conflict; concurrent revoke private 404", async () => {
    const g = await createEndedGame(manager);
    const contextId = await confirmWithTransition(g.id, participant.userId);
    const idem = key();
    const first = await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
      expectedVersion: 0,
      value: "present",
    }, idem);
    expect(first.statusCode).toBe(200);
    const replay = await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
      expectedVersion: 0,
      value: "present",
    }, idem);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().version).toBe(1);
    expect((await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
      expectedVersion: 0,
      value: "absent",
    })).statusCode).toBe(409);

    await pool.query(`UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2`, [
      g.id,
      manager.userId,
    ]);
    expect((await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
      expectedVersion: 1,
      value: "absent",
      correctionReason: "нет",
    })).statusCode).toBe(404);
  });
});
