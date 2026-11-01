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
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_attendance_disputes_disposable";
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
type Response = Awaited<ReturnType<NestFastifyApplication["inject"]>>;

run("PG-2 GameAttendance disputes — disposable synthetic PostGIS", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let manager: Actor;
  let participant: Actor;
  let outsider: Actor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "pg2-disputes-synthetic",
    });
    const existing = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'",
    );
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await migrate(file);
    }
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "pg2-synthetic-fixture-pepper-only!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "pg2-synthetic-fingerprint-fixture!!",
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
    manager = await actor("PG2 manager");
    participant = await actor("PG2 participant");
    outsider = await actor("PG2 outsider");
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

  const key = () => `pg2-synthetic-${randomUUID()}`;
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
      name: `PG2 court ${randomUUID()}`,
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
      title: "PG2 disposable game",
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

  async function confirmWithTransition(gameId: string, userId: string) {
    const part = await pool.query<{ id: string }>(
      `INSERT INTO participations (game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, 'confirmed', clock_timestamp() - interval '4 hours')
       RETURNING id`,
      [gameId, userId],
    );
    const id = part.rows[0]!.id;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version, at)
       VALUES ($1, NULL, 'confirmed', $2, 'test_confirm', 1, 1, clock_timestamp() - interval '4 hours')`,
      [id, userId],
    );
    return id;
  }

  it("correction leaves open; consent resolves; unknown no ACK; outsider 404; same-key replay", async () => {
    const g = await createEndedGame(manager);
    const contextId = await confirmWithTransition(g.id, participant.userId);

    expect(
      (
        await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, {
          expectedVersion: 0,
          value: "absent",
        })
      ).statusCode,
    ).toBe(200);

    const dispute = await post(participant, `/v1/games/${g.id}/attendance/${contextId}/disputes`, {
      attendanceVersion: 1,
      explanation: "Я была на втором корте",
    });
    expect(dispute.statusCode).toBe(201);
    const disputeId = dispute.json().id as string;

    const respond = await post(manager, `/v1/attendance-disputes/${disputeId}/responses`, {
      expectedVersion: 1,
      explanation: "Исправляю, спор оставляю открытым",
      correction: {
        expectedAttendanceVersion: 1,
        value: "present",
        correctionReason: "Участник на втором корте",
      },
    });
    expect(respond.statusCode).toBe(200);
    expect(respond.json()).toMatchObject({
      status: "open",
      currentAssertion: { value: "present", version: 2 },
      challengedAssertion: { value: "absent", version: 1 },
    });

    expect((await get(outsider, `/v1/attendance-disputes/${disputeId}`)).statusCode).toBe(404);

    const cleared = await post(manager, `/v1/attendance-disputes/${disputeId}/responses`, {
      expectedVersion: 2,
      explanation: "Временно неизвестно",
      correction: {
        expectedAttendanceVersion: 2,
        value: "unknown",
        correctionReason: "Нет надёжного факта",
      },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().currentAssertion.value).toBe("unknown");
    expect(cleared.json().status).toBe("open");

    expect(
      (
        await post(participant, `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`, {
          attendanceVersion: 3,
        })
      ).statusCode,
    ).toBe(409);

    expect(
      (
        await post(manager, `/v1/attendance-disputes/${disputeId}/responses`, {
          expectedVersion: 3,
          explanation: "Вернул present",
          correction: {
            expectedAttendanceVersion: 3,
            value: "present",
            correctionReason: "Факт подтверждён",
          },
        })
      ).statusCode,
    ).toBe(200);

    const help = await post(participant, `/v1/attendance-disputes/${disputeId}/help`, {
      expectedVersion: 4,
      explanation: "Нужна помощь по уточнению",
    });
    expect(help.statusCode).toBe(200);
    expect(help.json().helpProgress).toBe("requested");
    expect(help.json().caseProgress.linked).toBe(false);

    const ackKey = key();
    const ackBody = {
      attendanceVersion: 4,
      resolvingDisputeId: disputeId,
      expectedDisputeVersion: 5,
    };
    const ack = await post(
      participant,
      `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`,
      ackBody,
      ackKey,
    );
    expect(ack.statusCode).toBe(200);
    expect(ack.json().dispute).toBeNull();
    expect(ack.json().acknowledgedVersion).toBe(4);

    const replay = await post(
      participant,
      `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`,
      ackBody,
      ackKey,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json().acknowledgedVersion).toBe(4);

    const notices = await pool.query(
      `SELECT count(*)::int AS n FROM game_attendance_notices WHERE participation_id=$1`,
      [contextId],
    );
    expect(notices.rows[0]!.n).toBe(4);
  });
});
