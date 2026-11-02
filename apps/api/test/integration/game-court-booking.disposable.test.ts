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
import { GameAuthorityService } from "../../src/games/game-authority.service";
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
  const dedicated = url.pathname === "/gobadminton_court_booking_disposable";
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

run("#386 GameCourtBooking — disposable synthetic PostGIS", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let authority: GameAuthorityService;
  let manager: Actor;
  let participant: Actor;
  let pending: Actor;
  let outsider: Actor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 5000, application_name: "court-booking-synthetic" });
    const existing = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'");
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
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
      AUTH_PEPPER: "court-booking-synthetic-fixture-pepper!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "court-booking-fingerprint-fixture!!",
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
    authority = ref.get(GameAuthorityService);
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
    manager = await actor("Court manager");
    participant = await actor("Court participant");
    pending = await actor("Court pending");
    outsider = await actor("Court outsider");
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

  const key = () => `court-booking-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return { cookie: who.cookie, origin, "x-csrf-token": who.csrfToken, "idempotency-key": idem };
  }
  function get(who: Actor | null, url: string): Promise<Response> {
    return app.inject({
      method: "GET",
      url,
      headers: who ? { cookie: who.cookie } : {},
    }) as Promise<Response>;
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

  async function createPublishedGame(owner: Actor) {
    const venue = await post(owner, "/v1/venues", {
      cityId: MOSCOW_CITY_ID,
      name: `Court venue ${randomUUID()}`,
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
      title: "Court booking disposable game",
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
    return published.json() as { id: string; version: number; capacity: number };
  }

  async function confirmParticipant(gameId: string, userId: string) {
    await pool.query(
      `INSERT INTO participations (game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, 'confirmed', now())`,
      [gameId, userId],
    );
  }

  async function pendingParticipant(gameId: string, userId: string) {
    await pool.query(
      `INSERT INTO participations (game_id, user_id, status)
       VALUES ($1, $2, 'pending')`,
      [gameId, userId],
    );
  }

  it("manager write/read, participant readonly, anonymous/foreign/pending denial, CAS/replay/revoke", async () => {
    const g = await createPublishedGame(manager);
    await confirmParticipant(g.id, participant.userId);
    await pendingParticipant(g.id, pending.userId);
    const url = `/v1/games/${g.id}/court-booking`;

    expect((await get(null, url)).statusCode).toBe(401);
    expect((await get(outsider, url)).statusCode).toBe(404);
    expect((await get(pending, url)).statusCode).toBe(404);

    const initial = await get(manager, url);
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(initial.json()).toMatchObject({
      gameId: g.id,
      status: "unspecified",
      version: 0,
      updatedAt: null,
      declarationSource: "organizer_declared",
      allowedActions: { canUpdate: true },
    });

    const participantView = await get(participant, url);
    expect(participantView.statusCode).toBe(200);
    expect(participantView.json()).toMatchObject({
      status: "unspecified",
      version: 0,
      allowedActions: { canUpdate: false },
    });

    expect((await put(participant, url, { expectedVersion: 0, status: "arranging" })).statusCode).toBe(404);
    expect((await put(outsider, url, { expectedVersion: 0, status: "arranging" })).statusCode).toBe(404);

    const idem = key();
    const written = await put(manager, url, { expectedVersion: 0, status: "arranging" }, idem);
    expect(written.statusCode).toBe(200);
    expect(written.json()).toMatchObject({
      gameId: g.id,
      status: "arranging",
      version: 1,
      declarationSource: "organizer_declared",
      allowedActions: { canUpdate: true },
    });
    expect(typeof written.json().updatedAt).toBe("string");

    const replay = await put(manager, url, { expectedVersion: 0, status: "arranging" }, idem);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ status: "arranging", version: 1 });

    const stale = await put(manager, url, { expectedVersion: 0, status: "organizer_confirmed" });
    expect(stale.statusCode).toBe(409);

    const after = await get(participant, url);
    expect(after.json()).toMatchObject({
      status: "arranging",
      version: 1,
      allowedActions: { canUpdate: false },
    });

    // Public game detail must not leak court-booking or change capacity.
    const publicGame = await get(outsider, `/v1/games/${g.id}`);
    expect(publicGame.statusCode).toBe(200);
    expect(publicGame.json().capacity).toBe(g.capacity);
    expect(JSON.stringify(publicGame.json())).not.toMatch(/courtBooking|court-booking|organizer_declared/);

    await authority.revokeForTests(g.id, manager.userId);
    const revokedPut = await put(manager, url, { expectedVersion: 1, status: "not_arranged" });
    expect([403, 404]).toContain(revokedPut.statusCode);
    const revokedReplay = await put(manager, url, { expectedVersion: 0, status: "arranging" }, idem);
    expect([403, 404]).toContain(revokedReplay.statusCode);
    // Creator remains confirmed participant → readonly GET retained, not incorrectly denied.
    const revokedCreatorGet = await get(manager, url);
    expect(revokedCreatorGet.statusCode).toBe(200);
    expect(revokedCreatorGet.json()).toMatchObject({
      status: "arranging",
      version: 1,
      allowedActions: { canUpdate: false },
    });
  });

  async function waitBlockedBy(blockerPid: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = await pool.query(
        `SELECT pid FROM pg_stat_activity
         WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))`,
        [blockerPid],
      );
      if (rows.rows.length) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("Expected a real SQL lock waiter before releasing Game exclusive fence");
  }

  it("GET denies after non-playing manager revoke held behind Game exclusive fence", async () => {
    const owner = await actor("Fence owner");
    const nonPlaying = await actor("Nonplaying manager");
    const g = await createPublishedGame(owner);
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1, $2, 'manager', 'active')`,
      [g.id, nonPlaying.userId],
    );
    const url = `/v1/games/${g.id}/court-booking`;
    expect((await get(nonPlaying, url)).statusCode).toBe(200);
    expect((await get(nonPlaying, url)).json().allowedActions.canUpdate).toBe(true);

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      const pid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await holder.query(`SELECT id FROM games WHERE id = $1 FOR UPDATE`, [g.id]);
      await holder.query(
        `UPDATE game_managers
         SET status = 'revoked', revoked_at = now(), updated_at = now()
         WHERE game_id = $1 AND user_id = $2`,
        [g.id, nonPlaying.userId],
      );
      const mid = get(nonPlaying, url);
      await waitBlockedBy(pid);
      await holder.query("COMMIT");
      expect((await mid).statusCode).toBe(404);
      expect((await get(nonPlaying, url)).statusCode).toBe(404);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });

  it("GET denies after participant removal held behind Game exclusive fence", async () => {
    const owner = await actor("Remove owner");
    const onlyParticipant = await actor("Sole participant");
    const g = await createPublishedGame(owner);
    await confirmParticipant(g.id, onlyParticipant.userId);
    const url = `/v1/games/${g.id}/court-booking`;
    expect((await get(onlyParticipant, url)).statusCode).toBe(200);

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      const pid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await holder.query(`SELECT id FROM games WHERE id = $1 FOR UPDATE`, [g.id]);
      await holder.query(
        `UPDATE participations
         SET status = 'removed', version = version + 1, updated_at = now()
         WHERE game_id = $1 AND user_id = $2 AND status = 'confirmed'`,
        [g.id, onlyParticipant.userId],
      );
      const mid = get(onlyParticipant, url);
      await waitBlockedBy(pid);
      await holder.query("COMMIT");
      expect((await mid).statusCode).toBe(404);
      expect((await get(onlyParticipant, url)).statusCode).toBe(404);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });
});
