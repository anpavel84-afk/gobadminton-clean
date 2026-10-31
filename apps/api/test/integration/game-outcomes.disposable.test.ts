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
  const dedicated = url.pathname === "/gobadminton_outcomes_disposable";
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

run("PG-1a GameOutcome — disposable synthetic PostGIS", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let authority: GameAuthorityService;
  let manager: Actor;
  let coManager: Actor;
  let participant: Actor;
  let outsider: Actor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 5000, application_name: "pg1a-synthetic" });
    const existing = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'");
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    // N-1 outcomes schema: migrations before 0042 only. Venue gallery 0045 is an independent
    // additive dependency of current VenuesService (venue_gallery_items); apply it without 0042.
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql") && f < "0042").sort()) {
      await migrate(file);
    }
    await migrate("0045_venue_gallery.sql");
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "pg1a-synthetic-fixture-pepper-only!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "pg1a-synthetic-fingerprint-fixture!!",
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
    authority = ref.get(GameAuthorityService);

    const pre = await actor("N-1 manager");
    const draft = await createEndedGame(pre);
    expect((await get(pre, `/v1/games/${draft.id}/results`)).json()).toMatchObject({
      gameId: draft.id,
      outcome: { value: "unknown", version: 0 },
      allowedActions: { canRecordOutcome: false },
    });
    expect((await put(pre, `/v1/games/${draft.id}/outcome`, { expectedVersion: 0, outcome: "held" })).statusCode).toBe(503);

    await migrate("0042_game_outcomes.sql");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, "rollback/0042_game_outcomes.sql"), "utf8"));
      expect((await client.query("SELECT to_regclass('game_outcomes') AS name")).rows[0].name).toBeNull();
      // Explicit ledger after independent 0045 + rolled-back 0042: 0001–0041 and 0045 (not blanket len).
      expect((await client.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBe(42);
      expect((await client.query("SELECT 1 FROM schema_migrations WHERE id='0045_venue_gallery'")).rowCount).toBe(1);
      expect((await client.query("SELECT 1 FROM schema_migrations WHERE id='0042_game_outcomes'")).rowCount).toBe(0);
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
    manager = await actor("PG1a manager");
    coManager = await actor("PG1a co-manager");
    participant = await actor("PG1a participant");
    outsider = await actor("PG1a outsider");
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

  const key = () => `pg1a-synthetic-${randomUUID()}`;
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

  async function createEndedGame(owner: Actor, opts: { status?: string } = {}) {
    const venue = await post(owner, "/v1/venues", {
      cityId: MOSCOW_CITY_ID,
      name: `PG1a court ${randomUUID()}`,
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
      title: "PG1a disposable game",
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
    if (opts.status) await pool.query("UPDATE games SET status=$2 WHERE id=$1", [published.json().id, opts.status]);
    return published.json() as { id: string; version: number };
  }

  async function confirmParticipant(gameId: string, userId: string) {
    await pool.query(
      `INSERT INTO participations (game_id, user_id, status, confirmed_at)
       VALUES ($1, $2, 'confirmed', clock_timestamp())
       ON CONFLICT DO NOTHING`,
      [gameId, userId],
    );
  }

  async function effects(gameId: string) {
    const r = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM participations WHERE game_id=$1) AS seats,
         (SELECT count(*)::int FROM game_outcomes WHERE game_id=$1) AS outcomes,
         (SELECT count(*)::int FROM game_outcome_revisions WHERE game_id=$1) AS revisions,
         (SELECT status FROM games WHERE id=$1) AS status`,
      [gameId],
    );
    return r.rows[0] as { seats: number; outcomes: number; revisions: number; status: string };
  }

  it("absence projects unknown; elapsed time creates no row; held/not_held + correction persist", async () => {
    const g = await createEndedGame(manager);
    const before = await get(manager, `/v1/games/${g.id}/results`);
    expect(before.statusCode).toBe(200);
    expect(before.headers["cache-control"]).toBe("no-store");
    expect(before.json()).toMatchObject({
      gameId: g.id,
      outcome: { value: "unknown", version: 0, reason: null, provenance: null },
      allowedActions: { canRecordOutcome: true },
    });
    expect(await effects(g.id)).toMatchObject({ outcomes: 0, revisions: 0, status: "published" });

    const held = await put(manager, `/v1/games/${g.id}/outcome`, { expectedVersion: 0, outcome: "held" });
    expect(held.statusCode).toBe(200);
    expect(held.json().outcome).toMatchObject({ value: "held", version: 1, reason: null });
    const heldProv = held.json().outcome.provenance;
    expect(heldProv).toEqual({
      source: "manager_explicit",
      recordedAt: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(heldProv.recordedAt).toBe(held.json().revisions[0].recordedAt);
    expect(heldProv.createdAt).toBe(heldProv.recordedAt);
    expect(held.json().revisions).toHaveLength(1);
    expect(held.json().revisionsNextCursor).toBeNull();
    expect(await effects(g.id)).toMatchObject({ outcomes: 1, revisions: 1, status: "completed" });

    const corrected = await put(manager, `/v1/games/${g.id}/outcome`, {
      expectedVersion: 1,
      outcome: "not_held",
      reason: "Зал закрыли",
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().outcome).toMatchObject({ value: "not_held", version: 2, reason: "Зал закрыли" });
    const corrProv = corrected.json().outcome.provenance;
    expect(corrProv.createdAt).toBe(heldProv.createdAt);
    expect(corrProv.recordedAt).toBe(corrected.json().revisions[1].recordedAt);
    expect(Date.parse(corrProv.recordedAt)).toBeGreaterThanOrEqual(Date.parse(heldProv.recordedAt));
    expect(corrected.json().revisions).toHaveLength(2);
    expect(corrected.json().revisionsNextCursor).toBeNull();
    expect(await effects(g.id)).toMatchObject({ status: "completed", revisions: 2 });

    await confirmParticipant(g.id, participant.userId);
    const asParticipant = await get(participant, `/v1/games/${g.id}/results`);
    expect(asParticipant.statusCode).toBe(200);
    expect(asParticipant.json().outcome.provenance).toEqual(corrProv);
    expect(asParticipant.json().revisions).toBeUndefined();
    expect(asParticipant.json().revisionsNextCursor).toBeUndefined();
  });

  it("manager revision history is a bounded newest window with older continuation", async () => {
    const g = await createEndedGame(manager);
    let version = 0;
    let outcome: "held" | "not_held" = "held";
    for (let i = 0; i < 5; i += 1) {
      const body =
        version === 0 && outcome === "held"
          ? { expectedVersion: version, outcome }
          : { expectedVersion: version, outcome, reason: `corr-${i}` };
      const res = await put(manager, `/v1/games/${g.id}/outcome`, body);
      expect(res.statusCode).toBe(200);
      version = res.json().outcome.version;
      outcome = outcome === "held" ? "not_held" : "held";
    }
    expect(await effects(g.id)).toMatchObject({ revisions: 5 });

    const page1 = await get(manager, `/v1/games/${g.id}/results?revisionsLimit=2`);
    expect(page1.statusCode).toBe(200);
    expect(page1.json().revisions.map((r: { version: number }) => r.version)).toEqual([4, 5]);
    expect(page1.json().revisionsNextCursor).toEqual(expect.any(String));

    const page2 = await get(
      manager,
      `/v1/games/${g.id}/results?revisionsLimit=2&revisionsCursor=${encodeURIComponent(page1.json().revisionsNextCursor)}`,
    );
    expect(page2.statusCode).toBe(200);
    expect(page2.json().revisions.map((r: { version: number }) => r.version)).toEqual([2, 3]);
    expect(page2.json().revisionsNextCursor).toEqual(expect.any(String));

    const page3 = await get(
      manager,
      `/v1/games/${g.id}/results?revisionsLimit=2&revisionsCursor=${encodeURIComponent(page2.json().revisionsNextCursor)}`,
    );
    expect(page3.statusCode).toBe(200);
    expect(page3.json().revisions.map((r: { version: number }) => r.version)).toEqual([1]);
    expect(page3.json().revisionsNextCursor).toBeNull();

    expect((await get(manager, `/v1/games/${g.id}/results?revisionsLimit=0`)).statusCode).toBe(400);
    expect((await get(manager, `/v1/games/${g.id}/results?revisionsCursor=bad`)).statusCode).toBe(400);
  });

  it("manager history vs participant projection; guest/outsider/revoked manager private 404; replay after revoke denied", async () => {
    const g = await createEndedGame(manager);
    await confirmParticipant(g.id, participant.userId);
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status) VALUES ($1,$2,'manager','active')`,
      [g.id, coManager.userId],
    );
    const idem = key();
    const saved = await put(manager, `/v1/games/${g.id}/outcome`, { expectedVersion: 0, outcome: "held" }, idem);
    expect(saved.statusCode).toBe(200);
    expect(Object.keys(saved.json()).sort()).toEqual([
      "allowedActions",
      "gameId",
      "outcome",
      "revisions",
      "revisionsNextCursor",
    ]);
    const body = JSON.stringify(saved.json());
    expect(body).not.toMatch(/PRIVATE TERMS SENTINEL|telegram:@synthetic_private|roster|attendance|absent/);

    const asParticipant = await get(participant, `/v1/games/${g.id}/results`);
    expect(asParticipant.statusCode).toBe(200);
    expect(asParticipant.json().outcome.value).toBe("held");
    expect(asParticipant.json().revisions).toBeUndefined();
    expect(asParticipant.json().revisionsNextCursor).toBeUndefined();
    expect(asParticipant.headers["cache-control"]).toBe("no-store");

    for (const who of [outsider]) {
      expect((await get(who, `/v1/games/${g.id}/results`)).statusCode).toBe(404);
      expect((await put(who, `/v1/games/${g.id}/outcome`, { expectedVersion: 1, outcome: "held", reason: "x" })).statusCode).toBe(404);
    }
    expect((await get({ ...outsider, cookie: "" }, `/v1/games/${g.id}/results`)).statusCode).toBe(401);

    // Co-manager without a seat: revoke → private 404 on read/write/replay.
    await authority.revokeForTests(g.id, coManager.userId);
    expect((await get(coManager, `/v1/games/${g.id}/results`)).statusCode).toBe(404);
    expect((await put(coManager, `/v1/games/${g.id}/outcome`, {
      expectedVersion: 1,
      outcome: "held",
      reason: "revoked",
    })).statusCode).toBe(404);

    // Owner keep seat after revoke: participant read remains; write/replay denied.
    await authority.revokeForTests(g.id, manager.userId);
    const asFormerManager = await get(manager, `/v1/games/${g.id}/results`);
    expect(asFormerManager.statusCode).toBe(200);
    expect(asFormerManager.json().revisions).toBeUndefined();
    expect(asFormerManager.json().outcome.value).toBe("held");
    expect((await put(manager, `/v1/games/${g.id}/outcome`, { expectedVersion: 0, outcome: "held" }, idem)).statusCode).toBe(404);
  });

  it("same key/body replays one fact; different body conflicts; concurrent writers one success", async () => {
    const g = await createEndedGame(manager);
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status) VALUES ($1,$2,'manager','active')`,
      [g.id, coManager.userId],
    );
    const idem = key();
    const first = await put(manager, `/v1/games/${g.id}/outcome`, { expectedVersion: 0, outcome: "held" }, idem);
    expect(first.statusCode).toBe(200);
    const replay = await put(manager, `/v1/games/${g.id}/outcome`, { expectedVersion: 0, outcome: "held" }, idem);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const conflictBody = await put(
      manager,
      `/v1/games/${g.id}/outcome`,
      { expectedVersion: 0, outcome: "not_held", reason: "other" },
      idem,
    );
    expect(conflictBody.statusCode).toBe(409);
    expect(conflictBody.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await effects(g.id)).toMatchObject({ outcomes: 1, revisions: 1 });

    const g2 = await createEndedGame(manager);
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status) VALUES ($1,$2,'manager','active')`,
      [g2.id, coManager.userId],
    );
    const results = await Promise.all([
      put(manager, `/v1/games/${g2.id}/outcome`, { expectedVersion: 0, outcome: "held" }),
      put(coManager, `/v1/games/${g2.id}/outcome`, {
        expectedVersion: 0,
        outcome: "not_held",
        reason: "parallel",
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.some((r) => r.statusCode === 409 && r.json().code === "VERSION_CONFLICT")).toBe(true);
    expect(await effects(g2.id)).toMatchObject({ outcomes: 1, revisions: 1 });
  });

  it("lifecycle pre-end/draft/cancelled/completed; seats unchanged; writes off keeps history; empty rollback", async () => {
    const future = await createEndedGame(manager);
    await pool.query(
      `UPDATE games SET ends_at = clock_timestamp() + interval '2 hours', status='published' WHERE id=$1`,
      [future.id],
    );
    expect((await put(manager, `/v1/games/${future.id}/outcome`, { expectedVersion: 0, outcome: "held" })).statusCode).toBe(422);

    const draftGame = await createEndedGame(manager, { status: "draft" });
    // force draft after end
    await pool.query(`UPDATE games SET status='draft', ends_at=clock_timestamp()-interval '1 hour' WHERE id=$1`, [draftGame.id]);
    expect((await put(manager, `/v1/games/${draftGame.id}/outcome`, { expectedVersion: 0, outcome: "held" })).statusCode).toBe(422);

    const cancelled = await createEndedGame(manager);
    await pool.query(`UPDATE games SET status='cancelled' WHERE id=$1`, [cancelled.id]);
    const seatsBefore = (await effects(cancelled.id)).seats;
    expect((await put(manager, `/v1/games/${cancelled.id}/outcome`, { expectedVersion: 0, outcome: "held" })).statusCode).toBe(422);
    const notHeld = await put(manager, `/v1/games/${cancelled.id}/outcome`, {
      expectedVersion: 0,
      outcome: "not_held",
      reason: "Отмена сохранена",
    });
    expect(notHeld.statusCode).toBe(200);
    expect(await effects(cancelled.id)).toMatchObject({ status: "cancelled", seats: seatsBefore, revisions: 1 });

    const completed = await createEndedGame(manager);
    const first = await put(manager, `/v1/games/${completed.id}/outcome`, { expectedVersion: 0, outcome: "held" });
    expect(first.statusCode).toBe(200);
    const seats = (await effects(completed.id)).seats;
    const fix = await put(manager, `/v1/games/${completed.id}/outcome`, {
      expectedVersion: 1,
      outcome: "held",
      reason: "Уточнение",
    });
    expect(fix.statusCode).toBe(200);
    expect(await effects(completed.id)).toMatchObject({ status: "completed", seats, revisions: 2 });

    env.POST_GAME_INTERNAL_ENABLED = false;
    expect((await put(manager, `/v1/games/${completed.id}/outcome`, {
      expectedVersion: 2,
      outcome: "not_held",
      reason: "off",
    })).statusCode).toBe(503);
    const history = await get(manager, `/v1/games/${completed.id}/results`);
    expect(history.statusCode).toBe(200);
    expect(history.json().outcome.version).toBe(2);
    expect(history.json().allowedActions.canRecordOutcome).toBe(false);
    env.POST_GAME_INTERNAL_ENABLED = true;

    // Empty-schema rollback path (populated refuses).
    const emptyClient = await pool.connect();
    try {
      await emptyClient.query("BEGIN");
      await emptyClient.query("CREATE TEMP TABLE _probe(i int)");
      // Use a savepoint around refuse-populated check on live tables.
      await emptyClient.query("SAVEPOINT sp_populated");
      let refused = false;
      try {
        await emptyClient.query(await readFile(path.join(migrations, "rollback/0042_game_outcomes.sql"), "utf8"));
      } catch (error) {
        refused = String(error).includes("populated history");
        await emptyClient.query("ROLLBACK TO SAVEPOINT sp_populated");
      }
      expect(refused).toBe(true);
      expect((await emptyClient.query("SELECT to_regclass('game_outcomes') AS name")).rows[0].name).toBe("game_outcomes");
    } finally {
      await emptyClient.query("ROLLBACK");
      emptyClient.release();
    }
  });
});
