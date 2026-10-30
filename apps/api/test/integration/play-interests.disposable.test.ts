import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { PlayInterestsModule } from "../../src/play-interests/play-interests.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { PairFenceService } from "../../src/safety/pair-fence.service";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

const DB_NAME = "gobadminton_play_interests_disposable";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";

/** Dedicated local DB, or the exact existing ephemeral Actions recipe. No fallback. */
function disposableUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL must explicitly identify the play-interests disposable DB");
  const url = new URL(raw);
  const dedicated = decodeURIComponent(url.pathname) === `/${DB_NAME}`;
  const hosted = url.pathname === "/gobadminton" && process.env.GITHUB_ACTIONS === "true"
    && process.env.GMAP1_DISPOSABLE_DB === "1" && /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "")
    && url.port === process.env.CI_DB_PORT;
  if (process.env.NODE_ENV !== "test" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.search || url.hash
    || !(dedicated || hosted)) {
    throw new Error("Refusing nonlocal/non-test/nonisolated play-interests DB before connecting");
  }
  return raw;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

class ObservedPairs extends PairFenceService {
  private armed: { held: ReturnType<typeof deferred<number>>; release: ReturnType<typeof deferred<void>> } | null = null;
  arm() {
    if (this.armed) throw new Error("Pair barrier already armed");
    const gate = { held: deferred<number>(), release: deferred<void>() };
    this.armed = gate;
    return gate;
  }
  override async lockOrCreate(client: PoolClient, a: string, b: string) {
    const gate = this.armed;
    if (gate) this.armed = null;
    const row = await super.lockOrCreate(client, a, b);
    if (gate) {
      const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      gate.held.resolve(pid);
      await gate.release.promise;
    }
    return row;
  }
  clear() { this.armed = null; }
}

type Actor = { userId: string; publicPlayerId: string; sessionId: string; csrfToken: string; cookie: string };
type Response = Awaited<ReturnType<NestFastifyApplication["inject"]>>;

run("Play interests API — isolated synthetic PostGIS only", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  const pairs = new ObservedPairs();
  let a: Actor, b: Actor, outsider: Actor;

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 5000,
      application_name: "gobadminton-play-interests-synthetic",
    });
    const existing = await pool.query<{ name: string }>(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys'`,
    );
    if (existing.rows.length) {
      throw new Error("Play-interest suite requires an EMPTY application DB; recreate only its disposable DB");
    }
    const migrations = path.resolve(__dirname, "../../migrations");
    const files = (await readdir(migrations)).filter(f => f.endsWith(".sql")).sort();
    const client = await pool.connect();
    try {
      await client.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
      for (const file of files) {
        await client.query("BEGIN");
        try {
          await client.query(await readFile(path.join(migrations, file), "utf8"));
          await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      client.release();
    }
    expect((await pool.query("SELECT to_regclass('play_interests') AS name")).rows[0].name).toBe("play_interests");

    env = loadEnv({
      NODE_ENV: "test", APP_ENV: "local", HOST: "127.0.0.1", DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000", PUBLIC_WEB_ORIGIN: origin, COOKIE_SECURE: "false",
      AUTH_PEPPER: "play-interest-synthetic-fixture-pepper-only",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "play-interest-synthetic-fingerprint-only",
      SOCIAL_DIRECTORY_ENABLED: "1",
    });
    const ref = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), PlayInterestsModule, SafetyModule],
    }).overrideProvider(PairFenceService).useValue(pairs).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);
  });

  afterAll(async () => {
    pairs.clear();
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    a = await actor("Synthetic A");
    b = await actor("Synthetic B");
    outsider = await actor("Synthetic outsider");
  });

  async function actor(name: string): Promise<Actor> {
    const userId = randomUUID(), publicPlayerId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, name]);
    await pool.query(`INSERT INTO player_social_profiles(user_id,public_player_id,display_name,city_id,
      directory_visible,contact_policy,consent_policy_version,opted_in_at)
      VALUES($1,$2,$3,$4,true,'requests','synthetic-play-interest-fixture',clock_timestamp())`,
    [userId, publicPlayerId, name, MOSCOW_CITY_ID]);
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId, publicPlayerId, sessionId: issued.session.id, csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  const key = () => `pi-synthetic-${randomUUID()}`;
  function post(who: Actor, url: string, payload: unknown, idem = key()): Promise<Response> {
    return app.inject({
      method: "POST", url, payload: payload as object,
      headers: { cookie: who.cookie, origin, "x-csrf-token": who.csrfToken, "idempotency-key": idem },
    }) as Promise<Response>;
  }
  function get(who: Actor, url: string): Promise<Response> {
    return app.inject({ method: "GET", url, headers: { cookie: who.cookie } }) as Promise<Response>;
  }
  async function send(from = a, to = b, idem = key()): Promise<PlayInterestReceipt> {
    const response = await post(from, "/v1/play-interests", { targetPublicPlayerId: to.publicPlayerId }, idem);
    expect([200, 201]).toContain(response.statusCode);
    expect(response.headers["cache-control"]).toBe("no-store");
    return response.json();
  }
  function state(who: Actor, peer: Actor) {
    return get(who, `/v1/me/play-interest-states?publicPlayerId=${peer.publicPlayerId}`);
  }
  async function putBlock(who: Actor, target: Actor, remove = false): Promise<Response> {
    return app.inject({
      method: remove ? "DELETE" : "PUT",
      url: `/v1/me/blocks/${target.publicPlayerId}`,
      headers: { cookie: who.cookie, origin, "x-csrf-token": who.csrfToken, "idempotency-key": key() },
    }) as Promise<Response>;
  }
  async function friendshipCount() {
    const installed = await pool.query("SELECT to_regclass('friendships') AS name");
    if (!installed.rows[0]?.name) return 0;
    return (await pool.query("SELECT count(*)::int AS n FROM friendships")).rows[0].n as number;
  }

  it("A-only interest is outgoing for A, indistinguishable from none for B, creates no friendship rows", async () => {
    const receipt = await send();
    expect(receipt.outcome).toBe("outgoing");
    const aView = (await state(a, b)).json().items[0] as PlayInterestView;
    const bView = (await state(b, a)).json().items[0] as PlayInterestView;
    expect(aView).toMatchObject({ relationship: "outgoing", interestId: receipt.interestId, capabilities: { canSend: false, canWithdraw: true } });
    expect(bView).toMatchObject({ relationship: "none", interestId: null, capabilities: { canSend: true, canWithdraw: false } });
    expect(JSON.stringify(bView)).not.toContain(receipt.interestId);
    expect(await friendshipCount()).toBe(0);
  });

  it("A+B mutual including simultaneous pair-serialized sends; duplicate idempotency has no second effect", async () => {
    const idem = key();
    const first = await send(a, b, idem);
    expect(first.outcome).toBe("outgoing");
    const replay = await post(a, "/v1/play-interests", { targetPublicPlayerId: b.publicPlayerId }, idem);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first);
    expect((await pool.query("SELECT count(*)::int AS n FROM play_interests WHERE actor_user_id=$1", [a.userId])).rows[0].n).toBe(1);

    const mutual = await send(b, a);
    expect(mutual.outcome).toBe("mutual");
    expect((await state(a, b)).json().items[0].relationship).toBe("mutual");
    expect((await state(b, a)).json().items[0].relationship).toBe("mutual");
    expect(await friendshipCount()).toBe(0);

    const gate = pairs.arm();
    const left = post(a, "/v1/play-interests", { targetPublicPlayerId: outsider.publicPlayerId });
    let waiter: Promise<Response> | undefined;
    try {
      const pid = await Promise.race([
        gate.held.promise,
        left.then(() => { throw new Error("First writer did not reach Pair barrier"); }),
      ]);
      waiter = post(outsider, "/v1/play-interests", { targetPublicPlayerId: a.publicPlayerId });
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const rows = await pool.query(
          `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`,
          [pid],
        );
        if (rows.rows.length) break;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      gate.release.resolve();
      const results = await Promise.all([left, waiter]);
      expect(results.every(r => [200, 201].includes(r.statusCode))).toBe(true);
      const outcomes = results.map(r => r.json<PlayInterestReceipt>().outcome);
      expect(outcomes.filter(o => o === "mutual").length).toBeGreaterThanOrEqual(1);
    } finally {
      gate.release.resolve();
      pairs.clear();
      await Promise.allSettled([left, ...(waiter ? [waiter] : [])]);
    }
  });

  it("block and privacy epoch invalidate mutual; stale replay confers no rights; CSRF/auth/visibility fail closed", async () => {
    const aReceipt = await send(a, b);
    const bReceipt = await send(b, a);
    expect(bReceipt.outcome).toBe("mutual");
    expect((await putBlock(a, b)).statusCode).toBe(200);
    expect((await state(a, b)).json().items[0].relationship).toBe("unavailable");
    expect((await state(b, a)).json().items[0].relationship).toBe("unavailable");
    expect((await post(a, "/v1/play-interests", { targetPublicPlayerId: b.publicPlayerId })).statusCode).toBe(404);
    expect((await putBlock(a, b, true)).statusCode).toBe(200);
    // Unblock must not resurrect withdrawn intents from the block trigger.
    expect((await state(a, b)).json().items[0].relationship).toBe("none");
    expect((await state(b, a)).json().items[0].relationship).toBe("none");

    const again = await send(a, b);
    expect(again.interestId).not.toBe(aReceipt.interestId);
    await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1", [b.userId]);
    expect((await state(a, b)).json().items[0].relationship).toBe("unavailable");
    expect((await post(a, `/v1/play-interests/${again.interestId}/withdraw`, { expectedVersion: again.version })).statusCode).toBe(200);
    await pool.query("UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1", [b.userId]);

    expect((await post(outsider, "/v1/play-interests", { targetPublicPlayerId: a.publicPlayerId }, key())).statusCode).toBe(201);
    expect((await app.inject({
      method: "POST", url: "/v1/play-interests",
      payload: { targetPublicPlayerId: b.publicPlayerId },
      headers: { cookie: a.cookie, origin: "https://evil.test", "x-csrf-token": a.csrfToken, "idempotency-key": key() },
    })).statusCode).toBeGreaterThanOrEqual(400);
    await sessions.revokeSession(a.sessionId);
    expect((await state(a, b)).statusCode).toBe(401);
    expect(await friendshipCount()).toBe(0);
  });

  it("self/hidden/inactive peers fail closed without leaking why; withdraw is offered for own outgoing", async () => {
    expect((await post(a, "/v1/play-interests", { targetPublicPlayerId: a.publicPlayerId })).statusCode).toBe(404);
    expect((await post(a, "/v1/play-interests", { targetPublicPlayerId: randomUUID() })).statusCode).toBe(404);
    const receipt = await send();
    const withdrawn = await post(a, `/v1/play-interests/${receipt.interestId}/withdraw`, { expectedVersion: receipt.version });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().outcome).toBe("withdrawn");
    expect((await state(a, b)).json().items[0].relationship).toBe("none");
    expect(await friendshipCount()).toBe(0);
  });
});
