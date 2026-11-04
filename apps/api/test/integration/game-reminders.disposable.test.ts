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
import { GameRemindersCommand } from "../../src/games/game-reminders.command";
import { GamesModule } from "../../src/games/games.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

/**
 * #457 disposable PostGIS: worker command + HTTP GET/Later.
 * Dedicated DB name or strict hosted Actions ephemeral recipe — never live.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
const DB_NAME = "gobadminton_reminders_disposable";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = decodeURIComponent(url.pathname) === `/${DB_NAME}`;
  const hosted =
    decodeURIComponent(url.pathname) === "/gobadminton" &&
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
    throw new Error("Refusing nonlocal/non-test/nonisolated reminders DB");
  }
  return raw;
}

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };
type Response = Awaited<ReturnType<NestFastifyApplication["inject"]>>;

run("#457 postgame reminders — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let organizer: Actor;
  let coOrganizer: Actor;
  let outsider: Actor;
  let blocked: Actor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "reminders-synthetic",
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
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "reminders-synthetic-fixture-pepper!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "reminders-synthetic-fingerprint!!!!",
      POST_GAME_INTERNAL_ENABLED: "1",
    });
    // Test-only overlay (preserve public rollout guard in loadEnv).
    env.USER_RESTRICTIONS_INTERNAL_ENABLED = true;
    const moduleRef = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), GamesModule, VenuesModule, ProfilesModule],
    }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(SessionService);
  }, 180000);

  async function migrate(file: string) {
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

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    env.POST_GAME_INTERNAL_ENABLED = true;
    organizer = await actor("Reminders organizer");
    coOrganizer = await actor("Reminders co-organizer");
    outsider = await actor("Reminders outsider");
    blocked = await actor("Reminders blocked");
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

  const key = () => `reminders-synthetic-${randomUUID()}`;
  function headers(who: Actor, idem = key()) {
    return {
      cookie: who.cookie,
      origin,
      "x-csrf-token": who.csrfToken,
      "idempotency-key": idem,
    };
  }
  function get(who: Actor, url: string): Promise<Response> {
    return app.inject({ method: "GET", url, headers: { cookie: who.cookie } }) as Promise<Response>;
  }
  function post(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "POST",
      url,
      payload: payload as object,
      headers: headers(who, idem),
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

  async function createEndedGame(owner: Actor, opts: { status?: string } = {}) {
    const venue = await post(owner, "/v1/venues", {
      cityId: MOSCOW_CITY_ID,
      name: `Reminders court ${randomUUID()}`,
      address: "Synthetic Moscow",
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
    });
    expect([200, 201]).toContain(venue.statusCode);
    const starts = Date.now() + 7 * 86400000;
    const draft = await post(owner, "/v1/games", {
      hostDisplayName: "Synthetic host",
      hostPublicContact: "telegram:@synthetic_reminders",
      venueId: venue.json().id,
      title: "Reminders disposable game",
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
    if (opts.status) {
      await pool.query("UPDATE games SET status=$2 WHERE id=$1", [published.json().id, opts.status]);
    }
    const ends = (
      await pool.query<{ ends_at: Date }>(`SELECT ends_at FROM games WHERE id = $1`, [
        published.json().id,
      ])
    ).rows[0]!.ends_at;
    return {
      id: published.json().id as string,
      endsAt: ends,
      version: published.json().version as number,
    };
  }

  async function sweep(now: Date) {
    const command = new GameRemindersCommand(env);
    return command.execute(pool, { kind: "sweep" }, { now, manageTransactions: true });
  }

  it("repeated job ensures max 3 durable ordinals; overdue catch-up activates one card", async () => {
    const game = await createEndedGame(organizer);
    const now = new Date(game.endsAt.getTime() + 80 * 3600_000); // past 72h
    const first = await sweep(now);
    expect(first.skipped).toBe(false);
    expect(first.ensured).toBe(3);
    expect(first.activated).toBe(1);
    const second = await sweep(now);
    expect(second.ensured).toBe(0);
    expect(second.activated).toBe(0);
    const count = await pool.query(
      `SELECT ordinal, state FROM game_outcome_reminders
       WHERE game_id = $1 AND organizer_user_id = $2
       ORDER BY ordinal`,
      [game.id, organizer.userId],
    );
    expect(count.rows).toHaveLength(3);
    expect(count.rows.map((r) => r.ordinal)).toEqual([1, 2, 3]);
    expect(count.rows.filter((r) => r.state === "visible")).toHaveLength(1);
    expect(count.rows.filter((r) => r.state === "scheduled")).toHaveLength(2);
    expect(count.rows.find((r) => r.state === "visible")?.ordinal).toBe(1);
  });

  it("batchLimit 2 with 3 ended games eventually processes the third (no oldest starvation)", async () => {
    const g1 = await createEndedGame(organizer);
    const g2 = await createEndedGame(organizer);
    const g3 = await createEndedGame(organizer);
    const base = Date.now();
    await pool.query(`UPDATE games SET ends_at = $2 WHERE id = $1`, [
      g1.id,
      new Date(base - 5 * 3600_000),
    ]);
    await pool.query(`UPDATE games SET ends_at = $2 WHERE id = $1`, [
      g2.id,
      new Date(base - 4 * 3600_000),
    ]);
    await pool.query(`UPDATE games SET ends_at = $2 WHERE id = $1`, [
      g3.id,
      new Date(base - 3 * 3600_000),
    ]);
    const now = new Date(base);
    const command = new GameRemindersCommand(env);
    const first = await command.execute(
      pool,
      { kind: "sweep" },
      { now, batchLimit: 2, manageTransactions: true },
    );
    expect(first.scanned).toBe(2);
    expect(first.ensured).toBe(6);
    const second = await command.execute(
      pool,
      { kind: "sweep" },
      { now, batchLimit: 2, manageTransactions: true },
    );
    expect(second.scanned).toBeGreaterThanOrEqual(1);
    expect(second.ensured).toBeGreaterThanOrEqual(3);
    for (const gameId of [g1.id, g2.id, g3.id]) {
      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM game_outcome_reminders WHERE game_id = $1`,
        [gameId],
      );
      expect(rows.rows[0].n).toBe(3);
    }
  });

  it("Later advances ordinal under cap; does not unbounded re-show the same card", async () => {
    const game = await createEndedGame(organizer);
    await pool.query(
      `UPDATE games
       SET starts_at = clock_timestamp() - interval '5 days',
           application_deadline_at = clock_timestamp() - interval '5 days',
           ends_at = clock_timestamp() - interval '4 days'
       WHERE id = $1`,
      [game.id],
    );
    const ends = (
      await pool.query<{ ends_at: Date }>(`SELECT ends_at FROM games WHERE id = $1`, [game.id])
    ).rows[0]!.ends_at;
    const t0 = new Date(ends.getTime() + 80 * 3600_000);
    const first = await sweep(t0);
    expect(first.activated).toBe(1);
    const listed = await get(organizer, "/v1/me/postgame-reminders");
    const reminder = listed.json().items.find((i: { gameId: string }) => i.gameId === game.id);
    expect(reminder.ordinal).toBe(1);

    const later = await post(organizer, `/v1/me/postgame-reminders/${reminder.id}`, {
      command: "later",
      expectedVersion: reminder.version,
    });
    expect(later.statusCode).toBe(200);

    const t1 = new Date(t0.getTime() + 24 * 3600_000);
    const advance = await sweep(t1);
    expect(advance.activated).toBe(1);
    const after = await pool.query(
      `SELECT ordinal, state, stop_reason FROM game_outcome_reminders
       WHERE game_id = $1 AND organizer_user_id = $2
       ORDER BY ordinal`,
      [game.id, organizer.userId],
    );
    expect(after.rows.find((r) => r.ordinal === 1)).toMatchObject({
      state: "stopped",
      stop_reason: "superseded",
    });
    expect(after.rows.find((r) => r.ordinal === 2)?.state).toBe("visible");

    const listed2 = await get(organizer, "/v1/me/postgame-reminders");
    const rem2 = listed2.json().items.find((i: { gameId: string }) => i.gameId === game.id);
    expect(rem2.ordinal).toBe(2);
    await post(organizer, `/v1/me/postgame-reminders/${rem2.id}`, {
      command: "later",
      expectedVersion: rem2.version,
    });
    const t2 = new Date(t1.getTime() + 24 * 3600_000);
    expect((await sweep(t2)).activated).toBe(1);
    const listed3 = await get(organizer, "/v1/me/postgame-reminders");
    const rem3 = listed3.json().items.find((i: { gameId: string }) => i.gameId === game.id);
    expect(rem3.ordinal).toBe(3);
    await post(organizer, `/v1/me/postgame-reminders/${rem3.id}`, {
      command: "later",
      expectedVersion: rem3.version,
    });
    const t3 = new Date(t2.getTime() + 24 * 3600_000);
    expect((await sweep(t3)).activated).toBe(0);
    const finalList = await get(organizer, "/v1/me/postgame-reminders");
    expect(
      finalList.json().items.every((i: { gameId: string }) => i.gameId !== game.id),
    ).toBe(true);
    const activations = await pool.query(
      `SELECT count(*)::int AS n FROM game_outcome_reminder_events
       WHERE game_id = $1 AND organizer_user_id = $2 AND event_kind = 'activated'`,
      [game.id, organizer.userId],
    );
    expect(activations.rows[0].n).toBe(3);
  });

  it("GET own visible; Later snoozes without outcome/attendance side effects; idempotent", async () => {
    const game = await createEndedGame(organizer);
    const now = new Date(game.endsAt.getTime() + 2 * 3600_000);
    await sweep(now);
    const listed = await get(organizer, "/v1/me/postgame-reminders");
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    const body = listed.json();
    expect(body.installed).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const reminder = body.items.find((i: { gameId: string }) => i.gameId === game.id);
    expect(reminder).toMatchObject({
      gameId: game.id,
      state: "visible",
      allowedActions: { canOpenResults: true, canLater: true },
    });
    expect(reminder.resultsPath).toBe(`/my-games/${game.id}/results`);

    const idem = key();
    const later1 = await post(
      organizer,
      `/v1/me/postgame-reminders/${reminder.id}`,
      { command: "later", expectedVersion: reminder.version },
      idem,
    );
    expect(later1.statusCode).toBe(200);
    const later2 = await post(
      organizer,
      `/v1/me/postgame-reminders/${reminder.id}`,
      { command: "later", expectedVersion: reminder.version },
      idem,
    );
    expect(later2.statusCode).toBe(200);
    expect(later2.json()).toEqual(later1.json());

    const row = await pool.query(
      `SELECT state, snoozed_until, ordinal FROM game_outcome_reminders WHERE id = $1`,
      [reminder.id],
    );
    expect(row.rows[0].state).toBe("snoozed");
    expect(row.rows[0].snoozed_until).toBeTruthy();

    const outcome = await pool.query(`SELECT 1 FROM game_outcomes WHERE game_id = $1`, [game.id]);
    expect(outcome.rowCount).toBe(0);
    const attendance = await pool.query(
      `SELECT 1 FROM game_attendance WHERE game_id = $1`,
      [game.id],
    );
    expect(attendance.rowCount).toBe(0);

    // Ordinal budget unchanged (still ≤3 rows for organizer).
    const slots = await pool.query(
      `SELECT count(*)::int AS n FROM game_outcome_reminders
       WHERE game_id = $1 AND organizer_user_id = $2`,
      [game.id, organizer.userId],
    );
    expect(slots.rows[0].n).toBeLessThanOrEqual(3);
  });

  it("cross-account Later is private 404; foreign GET empty for that game", async () => {
    const game = await createEndedGame(organizer);
    await sweep(new Date(game.endsAt.getTime() + 2 * 3600_000));
    const own = (await get(organizer, "/v1/me/postgame-reminders")).json().items[0];
    const foreignList = await get(outsider, "/v1/me/postgame-reminders");
    expect(foreignList.json().items.every((i: { gameId: string }) => i.gameId !== game.id)).toBe(
      true,
    );
    const foreignLater = await post(outsider, `/v1/me/postgame-reminders/${own.id}`, {
      command: "later",
      expectedVersion: own.version,
    });
    expect(foreignLater.statusCode).toBe(404);
  });

  it("outcome recorded / cancellation / role loss stop and retain history", async () => {
    const game = await createEndedGame(organizer);
    await sweep(new Date(game.endsAt.getTime() + 2 * 3600_000));
    const putOutcome = await put(organizer, `/v1/games/${game.id}/outcome`, {
      expectedVersion: 0,
      outcome: "held",
    });
    expect(putOutcome.statusCode).toBe(200);
    const afterOutcome = await sweep(new Date(game.endsAt.getTime() + 3 * 3600_000));
    expect(afterOutcome.stopped).toBeGreaterThan(0);
    const stopped = await pool.query(
      `SELECT state, stop_reason FROM game_outcome_reminders WHERE game_id = $1`,
      [game.id],
    );
    expect(stopped.rows.every((r) => r.state === "stopped")).toBe(true);
    expect(stopped.rows[0].stop_reason).toBe("outcome_recorded");
    const events = await pool.query(
      `SELECT event_kind, detail FROM game_outcome_reminder_events WHERE game_id = $1`,
      [game.id],
    );
    expect(events.rows.some((e) => e.event_kind === "stopped")).toBe(true);

    const cancelled = await createEndedGame(organizer, { status: "cancelled" });
    await sweep(new Date(cancelled.endsAt.getTime() + 2 * 3600_000));
    // cancelled eligibility stops on ensure path — may create then stop, or stop without create.
    await sweep(new Date(cancelled.endsAt.getTime() + 2 * 3600_000));
    const cancelRows = await pool.query(
      `SELECT state, stop_reason FROM game_outcome_reminders WHERE game_id = $1`,
      [cancelled.id],
    );
    if (cancelRows.rows.length) {
      expect(cancelRows.rows.every((r) => r.state === "stopped")).toBe(true);
      expect(cancelRows.rows[0].stop_reason).toBe("game_cancelled");
    }

    const roleGame = await createEndedGame(organizer);
    await pool.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1, $2, 'manager', 'active')
       ON CONFLICT (game_id, user_id) DO UPDATE
         SET status = 'active', role = 'manager', revoked_at = NULL, updated_at = now()`,
      [roleGame.id, coOrganizer.userId],
    );
    await sweep(new Date(roleGame.endsAt.getTime() + 2 * 3600_000));
    await pool.query(
      `UPDATE game_managers
       SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE game_id = $1 AND user_id = $2`,
      [roleGame.id, coOrganizer.userId],
    );
    await sweep(new Date(roleGame.endsAt.getTime() + 3 * 3600_000));
    const coRows = await pool.query(
      `SELECT state, stop_reason FROM game_outcome_reminders
       WHERE game_id = $1 AND organizer_user_id = $2`,
      [roleGame.id, coOrganizer.userId],
    );
    if (coRows.rows.length) {
      expect(coRows.rows.every((r) => r.state === "stopped" && r.stop_reason === "role_lost")).toBe(
        true,
      );
    }
  });

  it("inactive account stops reminders; disputes/attendance independent of Later", async () => {
    const game = await createEndedGame(blocked);
    await sweep(new Date(game.endsAt.getTime() + 2 * 3600_000));
    const disputesBefore = (
      await pool.query(`SELECT count(*)::int AS n FROM game_attendance_disputes`)
    ).rows[0].n;
    const attendanceBefore = (
      await pool.query(`SELECT count(*)::int AS n FROM game_attendance`)
    ).rows[0].n;
    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [blocked.userId]);
    const after = await sweep(new Date(game.endsAt.getTime() + 3 * 3600_000));
    expect(after.stopped).toBeGreaterThan(0);
    const rows = await pool.query(
      `SELECT stop_reason FROM game_outcome_reminders WHERE organizer_user_id = $1 AND game_id = $2`,
      [blocked.userId, game.id],
    );
    expect(rows.rows.every((r) => r.stop_reason === "account_inactive")).toBe(true);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM game_attendance_disputes`)).rows[0].n,
    ).toBe(disputesBefore);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM game_attendance`)).rows[0].n,
    ).toBe(attendanceBefore);
  });

  it("default POST_GAME_INTERNAL_ENABLED off skips worker minting", async () => {
    env.POST_GAME_INTERNAL_ENABLED = false;
    const game = await createEndedGame(organizer);
    const result = await sweep(new Date(game.endsAt.getTime() + 2 * 3600_000));
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("writes_disabled");
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM game_outcome_reminders WHERE game_id = $1`,
      [game.id],
    );
    expect(count.rows[0].n).toBe(0);
  });
});
