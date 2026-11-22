import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { NativeSessionService } from "../../src/auth/native-session.service";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "https://localhost:3001";

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
      PUBLIC_API_ORIGIN: "https://localhost:3000",
      PUBLIC_WEB_ORIGIN: origin,
      ALLOWED_WEB_ORIGINS: origin,
      COOKIE_SECURE: "true",
      AUTH_PEPPER: "pg2-synthetic-fixture-pepper-only!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "pg2-synthetic-fingerprint-fixture!!",
      POST_GAME_INTERNAL_ENABLED: "1",
      NATIVE_AUTH_ENABLED: "1",
      NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([
        { clientId: "postgame-disputes-fixture", redirectUris: ["https://app.example.test/auth/callback"] },
      ]),
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
    env.NATIVE_AUTH_ENABLED = true;
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

  async function nativeHeaders(who: Actor, idem = key()) {
    const native = app.get(NativeSessionService);
    const issued = await native.transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [who.userId]);
      return native.issue(client, who.userId, "postgame-disputes-fixture");
    });
    return {
      credentials: issued,
      headers: { authorization: `Bearer ${issued.accessToken}`, "idempotency-key": idem },
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
  async function nativeGet(who: Actor, url: string): Promise<Response> {
    const n = await nativeHeaders(who);
    return app.inject({ method: "GET", url, headers: n.headers }) as Promise<Response>;
  }
  async function nativePost(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    const n = await nativeHeaders(who, idem);
    return app.inject({
      method: "POST",
      url,
      payload: payload as object,
      headers: n.headers,
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
    // Game create already seats the organizer (participations_game_user_uidx). Reuse that
    // row and backdate confirmed_at / confirmed transition so eligibility matches domain
    // (transition_as_of_start or current_confirmed within the ended window).
    const part = await pool.query<{ id: string }>(
      `INSERT INTO participations (game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, 'confirmed', clock_timestamp() - interval '4 hours')
       ON CONFLICT (game_id, user_id) DO UPDATE
         SET status = 'confirmed',
             confirmed_at = EXCLUDED.confirmed_at,
             updated_at = now()
       RETURNING id`,
      [gameId, userId],
    );
    const id = part.rows[0]!.id;
    const existingConfirm = await pool.query<{ id: string }>(
      `SELECT id FROM participation_transitions
       WHERE participation_id = $1 AND to_status = 'confirmed'
       ORDER BY at ASC, id ASC
       LIMIT 1`,
      [id],
    );
    if (existingConfirm.rows[0]) {
      await pool.query(
        `UPDATE participation_transitions
         SET at = clock_timestamp() - interval '4 hours'
         WHERE id = $1`,
        [existingConfirm.rows[0].id],
      );
    } else {
      await pool.query(
        `INSERT INTO participation_transitions
           (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version, at)
         VALUES ($1, NULL, 'confirmed', $2, 'test_confirm', 1, 1, clock_timestamp() - interval '4 hours')`,
        [id, userId],
      );
    }
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
    expect(ack.json().resolvedDispute).toEqual({
      id: disputeId,
      resultingVersion: 6,
      status: "resolved",
      contextId,
      attendanceVersion: 4,
    });

    const replay = await post(
      participant,
      `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`,
      ackBody,
      ackKey,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json().acknowledgedVersion).toBe(4);
    expect(replay.json().resolvedDispute).toEqual({
      id: disputeId,
      resultingVersion: 6,
      status: "resolved",
      contextId,
      attendanceVersion: 4,
    });

    const notices = await pool.query(
      `SELECT count(*)::int AS n FROM game_attendance_notices WHERE participation_id=$1`,
      [contextId],
    );
    expect(notices.rows[0]!.n).toBe(4);
  });

  it("missing mark version0 → clarification → help; unknown row uses actual version", async () => {
    const g = await createEndedGame(manager);
    const contextId = await confirmWithTransition(g.id, participant.userId);

    const results = await get(participant, `/v1/games/${g.id}/results`);
    expect(results.statusCode).toBe(200);
    expect(results.json().attendance.myAttendance).toMatchObject({
      value: "unknown",
      version: 0,
      allowedActions: expect.objectContaining({ canDispute: true, canAcknowledge: false }),
    });

    const missing = await post(participant, `/v1/games/${g.id}/attendance/${contextId}/disputes`, {
      attendanceVersion: 0,
      explanation: "Организатор ещё не отметил посещение",
    });
    expect(missing.statusCode).toBe(201);
    expect(missing.json()).toMatchObject({
      status: "open",
      challengedVersion: 0,
      challengedAssertion: null,
      currentAssertion: { value: "unknown", version: 0 },
      allowedActions: expect.objectContaining({ canRequestHelp: true, canAcknowledgeCurrent: false }),
    });

    const help = await post(participant, `/v1/attendance-disputes/${missing.json().id}/help`, {
      expectedVersion: 1,
      explanation: "Нужна независимая проверка без ответа организатора",
    });
    expect(help.statusCode).toBe(200);
    expect(help.json().helpProgress).toBe("requested");
    expect(help.json().caseProgress.linked).toBe(false);

    // Unknown row (actual version) still uses its version, not forced 0.
    const g2 = await createEndedGame(manager);
    const context2 = await confirmWithTransition(g2.id, participant.userId);
    expect(
      (
        await put(manager, `/v1/games/${g2.id}/attendance/${context2}`, {
          expectedVersion: 0,
          value: "present",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await put(manager, `/v1/games/${g2.id}/attendance/${context2}`, {
          expectedVersion: 1,
          value: "unknown",
          correctionReason: "Нет надёжного факта",
        })
      ).statusCode,
    ).toBe(200);
    const unknownDispute = await post(participant, `/v1/games/${g2.id}/attendance/${context2}/disputes`, {
      attendanceVersion: 2,
      explanation: "Прошу уточнить неизвестную отметку",
    });
    expect(unknownDispute.statusCode).toBe(201);
    expect(unknownDispute.json().challengedVersion).toBe(2);
    expect(unknownDispute.json().challengedAssertion).toMatchObject({ value: "unknown", version: 2 });
  });

  it("self_attested current keeps canAcknowledgeCurrent false; external mark still acks", async () => {
    const g = await createEndedGame(manager);
    const ownContext = await confirmWithTransition(g.id, manager.userId);
    const marked = await put(manager, `/v1/games/${g.id}/attendance/${ownContext}`, {
      expectedVersion: 0,
      value: "present",
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({
      assertion: { source: "self_attested" },
      allowedActions: expect.objectContaining({ canAcknowledge: false }),
    });

    const dispute = await post(manager, `/v1/games/${g.id}/attendance/${ownContext}/disputes`, {
      attendanceVersion: 1,
      explanation: "Нужно уточнить собственную массовую отметку",
    });
    expect(dispute.statusCode).toBe(201);
    expect(dispute.json()).toMatchObject({
      status: "open",
      currentAssertion: { version: 1, assertion: { source: "self_attested" } },
      allowedActions: expect.objectContaining({ canAcknowledgeCurrent: false }),
    });

    expect(
      (
        await post(manager, `/v1/games/${g.id}/attendance/${ownContext}/acknowledgements`, {
          attendanceVersion: 1,
          resolvingDisputeId: dispute.json().id,
          expectedDisputeVersion: 1,
        })
      ).statusCode,
    ).toBe(409);

    // Dispute stays open; party_acknowledged history is not fabricated for self.
    const open = await get(manager, `/v1/attendance-disputes/${dispute.json().id}`);
    expect(open.json()).toMatchObject({
      status: "open",
      allowedActions: expect.objectContaining({ canAcknowledgeCurrent: false }),
    });
  });

  it("revision snapshot/reason guard rejects version>1 with null before snapshot and null reason (23514)", async () => {
    const g = await createEndedGame(manager);
    const contextId = await confirmWithTransition(g.id, participant.userId);
    // Unused positive version avoids UNIQUE 23505 masking the CHECK contract.
    const unusedVersion = 17;
    await expect(
      pool.query(
        `INSERT INTO game_attendance_revisions
           (participation_id, game_id, user_id, resource_version, actor_user_id, source,
            before_value, after_value, before_late, after_late,
            before_correction_reason, after_correction_reason, reason)
         VALUES ($1, $2, $3, $4, $5, 'manager_explicit',
                 NULL, 'present', NULL, false,
                 NULL, NULL, NULL)`,
        [contextId, g.id, participant.userId, unusedVersion, manager.userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("native bearer participant/manager full loop + gates; cookie cases retained", async () => {
    const g = await createEndedGame(manager);
    const contextId = await confirmWithTransition(g.id, participant.userId);
    expect(
      (await put(manager, `/v1/games/${g.id}/attendance/${contextId}`, { expectedVersion: 0, value: "absent" })).statusCode,
    ).toBe(200);

    const dispute = await nativePost(participant, `/v1/games/${g.id}/attendance/${contextId}/disputes`, {
      attendanceVersion: 1,
      explanation: "Native participant clarification",
    });
    expect(dispute.statusCode).toBe(201);
    const disputeId = dispute.json().id as string;

    expect((await nativeGet(outsider, `/v1/attendance-disputes/${disputeId}`)).statusCode).toBe(404);
    expect((await nativeGet(outsider, `/v1/games/${g.id}/attendance/${contextId}/history`)).statusCode).toBe(404);

    const detail = await nativeGet(participant, `/v1/attendance-disputes/${disputeId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ status: "open", challengedVersion: 1 });

    const history = await nativeGet(manager, `/v1/games/${g.id}/attendance/${contextId}/history?limit=20`);
    expect(history.statusCode).toBe(200);
    expect(Array.isArray(history.json().items)).toBe(true);

    const stale = await nativePost(manager, `/v1/attendance-disputes/${disputeId}/responses`, {
      expectedVersion: 99,
      explanation: "stale",
    });
    expect(stale.statusCode).toBe(409);

    const respond = await nativePost(manager, `/v1/attendance-disputes/${disputeId}/responses`, {
      expectedVersion: 1,
      explanation: "Native manager correction",
      correction: {
        expectedAttendanceVersion: 1,
        value: "present",
        late: false,
        correctionReason: "На корте",
      },
    });
    expect(respond.statusCode).toBe(200);
    expect(respond.json()).toMatchObject({ status: "open", currentAssertion: { value: "present", version: 2 } });

    const help = await nativePost(participant, `/v1/attendance-disputes/${disputeId}/help`, {
      expectedVersion: 2,
      explanation: "Native help request",
    });
    expect(help.statusCode).toBe(200);
    expect(help.json()).toMatchObject({ helpProgress: "requested", caseProgress: { linked: false } });

    const ackKey = key();
    const ackBody = {
      attendanceVersion: 2,
      resolvingDisputeId: disputeId,
      expectedDisputeVersion: 3,
    };
    const ack = await nativePost(
      participant,
      `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`,
      ackBody,
      ackKey,
    );
    expect(ack.statusCode).toBe(200);
    expect(ack.json().resolvedDispute).toEqual({
      id: disputeId,
      resultingVersion: 4,
      status: "resolved",
      contextId,
      attendanceVersion: 2,
    });
    const replay = await nativePost(
      participant,
      `/v1/games/${g.id}/attendance/${contextId}/acknowledgements`,
      ackBody,
      ackKey,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json().resolvedDispute).toEqual(ack.json().resolvedDispute);

    // Withdraw does not acknowledge attendance.
    const g2 = await createEndedGame(manager);
    const context2 = await confirmWithTransition(g2.id, participant.userId);
    expect(
      (await put(manager, `/v1/games/${g2.id}/attendance/${context2}`, { expectedVersion: 0, value: "absent" })).statusCode,
    ).toBe(200);
    const open2 = await nativePost(participant, `/v1/games/${g2.id}/attendance/${context2}/disputes`, {
      attendanceVersion: 1,
      explanation: "Will withdraw",
    });
    expect(open2.statusCode).toBe(201);
    const withdrawn = await nativePost(participant, `/v1/attendance-disputes/${open2.json().id}/withdraw`, {
      expectedVersion: 1,
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().status).toBe("withdrawn");
    const afterWithdraw = await get(participant, `/v1/games/${g2.id}/results`);
    expect(afterWithdraw.json().attendance.myAttendance.acknowledgedVersion).toBeNull();

    // Mixed credentials / CSRF / disabled native / revoked session.
    const n = await nativeHeaders(participant);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/attendance-disputes/${disputeId}`,
          headers: { ...n.headers, cookie: participant.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/games/${g.id}/attendance/${contextId}/disputes`,
          payload: { attendanceVersion: 1, explanation: "no csrf" },
          headers: { cookie: participant.cookie, origin },
        })
      ).statusCode,
    ).toBe(403);
    env.NATIVE_AUTH_ENABLED = false;
    try {
      expect((await nativeGet(participant, `/v1/attendance-disputes/${disputeId}`)).statusCode).toBe(404);
    } finally {
      env.NATIVE_AUTH_ENABLED = true;
    }
    env.POST_GAME_INTERNAL_ENABLED = false;
    try {
      expect(
        (
          await nativePost(participant, `/v1/games/${g.id}/attendance/${contextId}/disputes`, {
            attendanceVersion: 1,
            explanation: "writes off",
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      env.POST_GAME_INTERNAL_ENABLED = true;
    }
    await sessions.revokeSession(n.credentials.sessionId);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/attendance-disputes/${disputeId}`,
          headers: n.headers,
        })
      ).statusCode,
    ).toBe(401);

    // Admin consumer routes stay closed on these native credentials.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/admin/cases/attendance-dispute-intake",
          headers: (await nativeHeaders(manager)).headers,
          payload: { disputeId, expectedDisputeVersion: 1, reasonCode: "intake_test", assignToSelf: true },
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });
});
