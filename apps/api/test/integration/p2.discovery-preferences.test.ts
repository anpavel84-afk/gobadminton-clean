import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
import { SessionService } from "../../src/auth/session.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { CityHintController } from "../../src/discovery/city-hint.controller";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { DISCOVERY_CITY_IDS, DISCOVERY_PREFERENCE_OPERATION } from "../../src/profiles/discovery-preferences.service";
import { VenuesModule } from "../../src/venues/venues.module";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

function parseSetCookie(header: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const item of values) {
    const pair = item.split(";")[0] ?? "";
    const idx = pair.indexOf("=");
    if (idx > 0) {
      out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
    }
  }
  return out;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

function fakeAdapter(identity: VerifiedIdentity): AuthProviderAdapter {
  return {
    key: identity.provider,
    configured: true,
    async startAuthorization(input) {
      return {
        authorizationUrl: `https://provider.test/authorize?state=${encodeURIComponent(input.state)}`,
      };
    },
    async exchangeCode() {
      return { accessToken: "test-access" };
    },
    async fetchVerifiedIdentity() {
      return { ...identity, subject: uniqueSuffix("p2-discovery-identity") };
    },
  };
}

describeIntegration("P2 private discovery preference on real PostgreSQL/PostGIS", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityOwner: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:fb01",
    subject: uniqueSuffix("owner-fb01"),
    email: "owner-fb01@example.com",
    displayName: "Owner RTG",
  };
  const identityOther: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:fb01",
    subject: uniqueSuffix("other-fb01"),
    email: "other-fb01@example.com",
    displayName: "Other RTG",
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PUBLIC_API_ORIGIN = "http://127.0.0.1:3000";
    process.env.PUBLIC_WEB_ORIGIN = "http://127.0.0.1:3001";
    process.env.ALLOWED_WEB_ORIGINS = "http://127.0.0.1:3001";
    process.env.AUTH_PEPPER = "integration-auth-pepper-32chars!!";
    process.env.COOKIE_SECURE = "false";
    process.env.VK_CLIENT_ID = "vk-test";
    process.env.VK_CLIENT_SECRET = "vk-secret";
    process.env.VK_REDIRECT_URI = "http://127.0.0.1:3000/v1/auth/vk/callback";
    process.env.YANDEX_CLIENT_ID = "ya-test";
    process.env.YANDEX_CLIENT_SECRET = "ya-secret";
    process.env.YANDEX_REDIRECT_URI =
      "http://127.0.0.1:3000/v1/auth/yandex/callback";
    process.env.GIT_SHA = "integration-p2";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";

    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    const env = loadEnv(process.env);
    const database = createDatabase(env.DATABASE_URL);
    pool = database.pool;

    const TestCoreModule = buildTestCoreModule(env, pool);

    const moduleRef = await Test.createTestingModule({
      imports: [
        TestCoreModule,
        AuthModule,
        VenuesModule,
        ProfilesModule,
      ],
      controllers: [CityHintController],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityOwner), fakeAdapter(identityOther)])
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function login(provider: "vk" | "yandex") {
    const start = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=/account`,
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/callback?code=ok&state=${encodeURIComponent(state!)}${provider === "vk" ? "&device_id=vk-device-test" : ""}`,
      cookies,
    });
    expect(callback.statusCode).toBe(302);
    const sessionCookies = {
      ...cookies,
      ...parseSetCookie(callback.headers["set-cookie"]),
    };
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: sessionCookies,
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { id: string; csrfToken: string };
    return {
      cookies: sessionCookies,
      csrfToken: meBody.csrfToken,
      userId: meBody.id,
      cookie: cookieHeader(sessionCookies),
    };
  }

  function mutationHeaders(session: { csrfToken: string; cookie: string }, key: string) {
    return {
      cookie: session.cookie,
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  type Session = Awaited<ReturnType<typeof login>>;
  let owner: Session;
  let other: Session;
  const [moscow, petersburg] = DISCOVERY_CITY_IDS;
  const route = "/v1/me/discovery-preference";
  const get = (session: Session) => app.inject({ method: "GET", url: route, cookies: session.cookies });
  const put = (session: Session, payload: unknown, key = uniqueSuffix("p2-preference-put")) =>
    app.inject({ method: "PUT", url: route, headers: mutationHeaders(session, key), payload: payload as Record<string, unknown> });
  const input = { cityId: petersburg, expectedVersion: 0 };
  beforeEach(async () => { owner = await login("vk"); other = await login("yandex"); });

  async function receiptCount(session: Session, key: string) {
    return (await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM idempotency_records WHERE actor_id=$1 AND operation=$2 AND key_hash=$3",
      [session.userId, DISCOVERY_PREFERENCE_OPERATION, app.get(IdempotencyService).keyHash(key)],
    )).rows[0]!.n;
  }

  it("anonymous and revoked reads/writes are 401, including original receipt replay", async () => {
    for (const method of ["GET", "PUT"] as const) {
      expect((await app.inject({ method, url: route, ...(method === "PUT" ? { payload: input } : {}) })).statusCode).toBe(401);
    }
    const key = uniqueSuffix("p2-revoke-replay");
    expect((await put(owner, input, key)).statusCode).toBe(200);
    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE user_id=$1", [owner.userId]);
    expect((await get(owner)).statusCode).toBe(401);
    expect((await put(owner, input, key)).statusCode).toBe(401);
    expect((await pool.query("SELECT version FROM user_discovery_preferences WHERE user_id=$1", [owner.userId])).rows[0].version).toBe(1);
  });

  async function waitForAccountFence(blockerPid: number) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const result = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname=current_database() AND wait_event_type='Lock'
           AND $1::int = ANY(pg_blocking_pids(pid))
           AND query LIKE '%FOR NO KEY UPDATE%'`, [blockerPid]);
      if (result.rows[0]!.n > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Request did not reach the real account fence");
  }

  for (const mode of ["first write", "receipt replay"] as const) {
    for (const change of ["revoked", "expired", "session deleted", "actor rebound", "disabled"] as const) {
      it(`${mode} rechecks ${change} after a deterministic account-lock wait`, async () => {
        const key = uniqueSuffix("p2-fresh-session");
        if (mode === "receipt replay") expect((await put(owner, input, key)).statusCode).toBe(200);
        const before = (await pool.query("SELECT * FROM user_discovery_preferences WHERE user_id=$1", [owner.userId])).rows;
        const beforeReceipts = (await pool.query("SELECT * FROM idempotency_records WHERE actor_id=$1", [owner.userId])).rows;
        const locked = await pool.connect();
        let pending: ReturnType<typeof put> | undefined;
        try {
          await locked.query("BEGIN");
          const pid = (await locked.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
          await locked.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [owner.userId]);
          pending = put(owner, input, key);
          await waitForAccountFence(pid);
          // These fixture operations preserve User-before-Session ordering.
          if (change === "revoked") await locked.query("UPDATE app_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1", [owner.userId]);
          if (change === "expired") await locked.query("UPDATE app_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", [owner.userId]);
          if (change === "session deleted") await locked.query("DELETE FROM app_sessions WHERE user_id=$1", [owner.userId]);
          if (change === "actor rebound") await locked.query("UPDATE app_sessions SET user_id=$2 WHERE user_id=$1", [owner.userId, other.userId]);
          if (change === "disabled") await locked.query("UPDATE users SET status='disabled' WHERE id=$1", [owner.userId]);
          await locked.query("COMMIT");
          const response = await pending;
          expect(response.statusCode).toBe(401);
          expect(response.headers["cache-control"]).toContain("no-store");
          expect(response.body).not.toContain(petersburg);
          expect(response.body).not.toContain('"version"');
          expect((await pool.query("SELECT * FROM user_discovery_preferences WHERE user_id=$1", [owner.userId])).rows).toEqual(before);
          expect((await pool.query("SELECT * FROM idempotency_records WHERE actor_id=$1", [owner.userId])).rows).toEqual(beforeReceipts);
          expect((await get(other)).json()).toEqual({ cityId: null, version: 0 });
          expect((await pool.query("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id=$1", [owner.userId])).rows[0].n).toBe(0);
        } finally {
          await locked.query("ROLLBACK"); locked.release(); await pending;
        }
      });
    }
  }

  it("a rolled-back revocation permits a waiting replay and a second active session stays authorized", async () => {
    const key = uniqueSuffix("p2-rollback-revocation");
    expect((await put(owner, input, key)).statusCode).toBe(200);
    const issued = await app.get(SessionService).createConsumerSession(owner.userId);
    const cookies = { [SESSION_COOKIE]: issued.sessionToken };
    const second: Session = { userId: owner.userId, cookies, cookie: cookieHeader(cookies), csrfToken: issued.csrfToken };
    const locked = await pool.connect(); let pending: ReturnType<typeof put> | undefined;
    try {
      await locked.query("BEGIN");
      const pid = (await locked.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await locked.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [owner.userId]);
      pending = put(owner, input, key);
      await waitForAccountFence(pid);
      await locked.query("UPDATE app_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND id<>$2", [owner.userId, issued.session.id]);
      await locked.query("ROLLBACK");
      expect((await pending).json()).toEqual({ cityId: petersburg, version: 1 });
    } finally { await locked.query("ROLLBACK"); locked.release(); await pending; }
    // Commit revocation of only the first session, retaining the second session.
    await pool.query("UPDATE app_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND id<>$2", [owner.userId, issued.session.id]);
    expect((await put(owner, input, key)).statusCode).toBe(401);
    expect((await put(second, input, key)).json()).toEqual({ cityId: petersburg, version: 1 });
    expect((await put(second, { cityId: moscow, expectedVersion: 1 })).json()).toEqual({ cityId: moscow, version: 2 });
    expect((await get(second)).json()).toEqual({ cityId: moscow, version: 2 });
  });

  it("retains cookie Origin/CSRF/idempotency security without account input", async () => {
    const headers = mutationHeaders(owner, uniqueSuffix("p2-auth-check"));
    for (const override of [
      { origin: "https://foreign.test" }, { origin: "" },
      { "x-csrf-token": "" }, { "x-csrf-token": "invalid" },
      { authorization: "Bearer unsupported" },
    ]) {
      const r = await app.inject({ method: "PUT", url: route, headers: { ...headers, ...override }, payload: input });
      expect(r.statusCode).toBe(403);
      expect(r.headers["content-type"]).toContain("application/problem+json");
      expect(r.headers["cache-control"]).toContain("no-store");
    }
    expect((await app.inject({ method: "PUT", url: route, headers: { ...headers, "idempotency-key": "" }, payload: input })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: route, headers: { authorization: "Bearer unsupported" } })).statusCode).toBe(401);
    expect((await put(owner, { ...input, userId: other.userId })).statusCode).toBe(422);
    expect((await get(owner)).json()).toEqual({ cityId: null, version: 0 });
    expect((await get(other)).json()).toEqual({ cityId: null, version: 0 });
  });

  it("rejects missing, malformed, catalog-unsupported city and invalid versions without reservations", async () => {
    const third = "a0000000-0000-4000-8000-000000000003";
    await pool.query("INSERT INTO cities(id,country_code,name_ru,name_en,default_timezone) VALUES($1,'RU','Test-only city','Test-only city','Europe/Moscow') ON CONFLICT DO NOTHING", [third]);
    for (const payload of [
      {}, { expectedVersion: 0 }, { cityId: moscow }, { ...input, cityId: null },
      { ...input, cityId: "not-a-uuid" }, { ...input, cityId: third },
      ...[-1, 0.5, "0", null, 2147483648].map(expectedVersion => ({ ...input, expectedVersion })),
      { ...input, latitude: 59.9 }, { ...input, source: "ip" },
    ]) {
      const key = uniqueSuffix("p2-invalid-city");
      const r = await put(owner, payload, key);
      expect(r.statusCode).toBe(422);
      expect(await receiptCount(owner, key)).toBe(0);
    }
    await pool.query("DELETE FROM cities WHERE id=$1", [third]);
    expect((await get(owner)).json()).toEqual({ cityId: null, version: 0 });
  });

  it("saves without a SocialProfile, isolates accounts and does not touch public city/Radar/contacts", async () => {
    const initial = await get(owner);
    expect(initial.json()).toEqual({ cityId: null, version: 0 });
    expect(initial.headers["cache-control"]).toBe("private, no-store");
    // Owner #448: OAuth/getOwn may already materialize a default social profile — baseline then compare.
    const ownerSocialBefore = (await pool.query("SELECT * FROM player_social_profiles WHERE user_id=$1", [owner.userId])).rows;
    await pool.query(
      `UPDATE player_social_profiles
       SET city_id=$2, display_name='Synthetic public city'
       WHERE user_id=$1`,
      [other.userId, moscow],
    );
    expect((await pool.query("SELECT count(*)::int AS n FROM player_social_profiles WHERE user_id=$1", [other.userId])).rows[0].n).toBe(1);
    const before = (await pool.query("SELECT * FROM player_social_profiles WHERE user_id=$1", [other.userId])).rows;
    const a = await put(owner, input);
    const b = await put(other, { cityId: petersburg, expectedVersion: 0 });
    expect(a.statusCode).toBe(200); expect(a.json()).toEqual({ cityId: petersburg, version: 1 });
    expect(a.headers["cache-control"]).toBe("private, no-store");
    expect(b.json()).toEqual({ cityId: petersburg, version: 1 });
    expect((await get(owner)).json()).toEqual(a.json());
    expect((await get(other)).json()).toEqual(b.json());
    expect((await app.inject({ method: "GET", url: `${route}?userId=${other.userId}`, cookies: owner.cookies })).json()).toEqual(a.json());
    expect((await pool.query("SELECT * FROM player_social_profiles WHERE user_id=$1", [other.userId])).rows).toEqual(before);
    expect((await pool.query("SELECT * FROM player_social_profiles WHERE user_id=$1", [owner.userId])).rows).toEqual(ownerSocialBefore);
    for (const table of ["radar_consent_events", "radar_presences", "user_game_preferences", "outbox_events"]) {
      const field = ["outbox_events"].includes(table) ? "aggregate_id" : "user_id";
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${field}=$1`, [owner.userId])).rows[0].n).toBe(0);
    }
    // Explicit synthetic directory consent is unrelated to the saved discovery choice.
    await pool.query(
      `UPDATE player_social_profiles
       SET directory_visible=true,
           directory_visibility_provenance='user_consent',
           consent_policy_version='synthetic-p2',
           opted_in_at=now()
       WHERE user_id=$1`,
      [other.userId],
    );
    const publicId = (await pool.query("SELECT public_player_id FROM player_social_profiles WHERE user_id=$1", [other.userId])).rows[0].public_player_id;
    const publicPlayer = await app.inject({ method: "GET", url: `/v1/players/${publicId}` });
    expect(publicPlayer.statusCode).toBe(200);
    expect(publicPlayer.json().cityId).toBe(moscow);
    expect(publicPlayer.body).not.toContain(petersburg);
    expect(publicPlayer.body).not.toContain("discoveryPreference");
    expect(publicPlayer.body).not.toContain(other.userId);
    // Public hint/catalog DTOs have no account preference extension.
    for (const url of ["/v1/discovery/city-hint", "/v1/cities"]) {
      const r = await app.inject({ method: "GET", url, cookies: owner.cookies });
      expect(r.body).not.toContain("discoveryPreference");
      expect(r.body).not.toContain(owner.userId);
    }
  });

  it("two concurrent first writes with different keys create one row and return 200/409", async () => {
    const keys = [uniqueSuffix("p2-first-a"), uniqueSuffix("p2-first-b")];
    const rs = await Promise.all([put(owner, input, keys[0]), put(owner, { cityId: moscow, expectedVersion: 0 }, keys[1])]);
    expect(rs.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const winner = rs.find(r => r.statusCode === 200)!;
    expect((await get(owner)).json()).toEqual(winner.json());
    expect((await pool.query("SELECT count(*)::int AS n FROM user_discovery_preferences WHERE user_id=$1", [owner.userId])).rows[0].n).toBe(1);
    expect(await receiptCount(owner, keys[rs.findIndex(r => r.statusCode === 409)]!)).toBe(0);
    expect((await get(other)).json()).toEqual({ cityId: null, version: 0 });
  });

  it("same-key concurrent first writes replay once; actor scope and later edits remain independent", async () => {
    const key = uniqueSuffix("p2-same-key");
    const rs = await Promise.all([put(owner, input, key), put(owner, input, key)]);
    expect(rs.map(r => r.statusCode)).toEqual([200, 200]);
    expect(rs[0]!.json()).toEqual(rs[1]!.json());
    expect(await receiptCount(owner, key)).toBe(1);
    // A different actor may use exactly the same raw key for a different choice.
    expect((await put(other, { cityId: moscow, expectedVersion: 0 }, key)).statusCode).toBe(200);
    expect((await put(owner, { cityId: moscow, expectedVersion: 1 })).json()).toEqual({ cityId: moscow, version: 2 });
    expect((await put(owner, input, key)).json()).toEqual({ cityId: petersburg, version: 1 });
    expect((await get(owner)).json()).toEqual({ cityId: moscow, version: 2 });
    const reused = await put(owner, { ...input, cityId: moscow }, key);
    expect(reused.statusCode).toBe(409); expect(reused.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("concurrent updates reject stale versions and version exhaustion safely", async () => {
    expect((await put(owner, input)).statusCode).toBe(200);
    const rs = await Promise.all([put(owner, { cityId: moscow, expectedVersion: 1 }), put(owner, { cityId: petersburg, expectedVersion: 1 })]);
    expect(rs.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await get(owner)).json().version).toBe(2);
    const stale = await put(owner, input);
    expect(stale.statusCode).toBe(409); expect(stale.json().code).toBe("VERSION_CONFLICT");
    await pool.query("UPDATE user_discovery_preferences SET version=2147483647 WHERE user_id=$1", [owner.userId]);
    expect((await put(owner, { cityId: moscow, expectedVersion: 2147483647 })).statusCode).toBe(409);
    expect((await get(owner)).json().version).toBe(2147483647);
    await pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1", [owner.userId]);
    expect((await pool.query("SELECT city_id,version FROM user_discovery_preferences WHERE user_id=$1", [owner.userId])).rows[0]).toEqual({ city_id: null, version: 2147483647 });
  });

  it("actual SQL failure after preference write rolls back preference and reservation, same key retries", async () => {
    const key = uniqueSuffix("p2-forced-rollback");
    await pool.query(`CREATE FUNCTION p2_test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.operation='discovery_preference.put' THEN
        RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER p2_test_fail_receipt BEFORE UPDATE ON idempotency_records FOR EACH ROW EXECUTE FUNCTION p2_test_fail_receipt()`);
    try {
      const failed = await put(owner, input, key);
      expect(failed.statusCode).toBe(500);
      expect(failed.body).not.toContain("synthetic receipt failure");
      expect((await get(owner)).json()).toEqual({ cityId: null, version: 0 });
      expect(await receiptCount(owner, key)).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER p2_test_fail_receipt ON idempotency_records; DROP FUNCTION p2_test_fail_receipt()");
    }
    expect((await put(owner, input, key)).json()).toEqual({ cityId: petersburg, version: 1 });
  });

  it("deletion_pending clears value and private receipts, reactivation cannot replay an old first write", async () => {
    const key = uniqueSuffix("p2-deletion-receipt");
    expect((await put(owner, input, key)).statusCode).toBe(200);
    await pool.query("UPDATE users SET status='deletion_pending',deletion_requested_at=now() WHERE id=$1", [owner.userId]);
    expect((await pool.query('SELECT city_id AS "cityId",version FROM user_discovery_preferences WHERE user_id=$1', [owner.userId])).rows[0]).toEqual({ cityId: null, version: 2 });
    expect(await receiptCount(owner, key)).toBe(0);
    expect((await get(owner)).statusCode).toBe(401); expect((await put(owner, input, key)).statusCode).toBe(401);
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [owner.userId]);
    expect((await put(owner, input, key)).statusCode).toBe(409);
    expect((await get(owner)).json()).toEqual({ cityId: null, version: 2 });
    expect((await put(owner, { cityId: moscow, expectedVersion: 2 })).json()).toEqual({ cityId: moscow, version: 3 });
  });

  it("deletion racing first write always leaves cleared data, no saved receipt and no authorized replay", async () => {
    const key = uniqueSuffix("p2-delete-race");
    const [r] = await Promise.all([
      put(owner, input, key),
      pool.query("UPDATE users SET status='deletion_pending' WHERE id=$1", [owner.userId]),
    ]);
    expect([200, 401]).toContain(r.statusCode);
    const rows = (await pool.query("SELECT city_id FROM user_discovery_preferences WHERE user_id=$1", [owner.userId])).rows;
    expect(rows.every(row => row.city_id === null)).toBe(true);
    expect(await receiptCount(owner, key)).toBe(0);
    expect((await put(owner, input, key)).statusCode).toBe(401);
  });

  it("public default hint ignores spoofed IP/coordinates, is private/no-store and never writes", async () => {
    for (const cookies of [undefined, owner.cookies]) {
      const r = await app.inject({ method: "GET", url: "/v1/discovery/city-hint?ip=1.2.3.4&latitude=59.9&longitude=30.3&cityId=" + petersburg,
        cookies, headers: { "x-forwarded-for": "1.2.3.4", forwarded: "for=1.2.3.4", "x-city-id": petersburg } });
      expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ cityId: moscow, source: "default" });
      expect(r.headers["cache-control"]).toBe("private, no-store");
      expect(r.body).not.toContain("1.2.3.4");
    }
    expect((await get(owner)).json()).toEqual({ cityId: null, version: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM user_discovery_preferences WHERE user_id=$1", [owner.userId])).rows[0].n).toBe(0);
  });

  it("dedicated migration upgrades without backfill, enforces supported FK/PK, hard-deletes private data; runner replays", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN; CREATE SCHEMA p2_upgrade_fixture; SET LOCAL search_path=p2_upgrade_fixture,public");
      await client.query("CREATE TABLE users(id uuid PRIMARY KEY,status text NOT NULL); CREATE TABLE cities(id uuid PRIMARY KEY); CREATE TABLE player_social_profiles(user_id uuid,city_id uuid); CREATE TABLE idempotency_records(actor_id uuid,operation text,response_body jsonb)");
      await client.query("INSERT INTO users VALUES($1,'active');", [owner.userId]);
      await client.query("INSERT INTO cities VALUES($1),($2)", [moscow, petersburg]);
      await client.query("INSERT INTO player_social_profiles VALUES($1,$2)", [owner.userId, moscow]);
      await client.query(readFileSync(path.join(apiRoot, "migrations/0024_user_discovery_preferences.sql"), "utf8"));
      expect((await client.query("SELECT * FROM user_discovery_preferences")).rows).toEqual([]);
      expect((await client.query("SELECT city_id FROM player_social_profiles")).rows[0].city_id).toBe(moscow);
      await client.query("INSERT INTO user_discovery_preferences(user_id,city_id) VALUES($1,$2)", [owner.userId, petersburg]);
      await client.query("INSERT INTO idempotency_records VALUES($1,'discovery_preference.put',$2),($1,'unrelated.operation',$2)", [owner.userId, { cityId: petersburg }]);
      // Real PostgreSQL constraints, not mocked repository errors.
      const third = "a0000000-0000-4000-8000-000000000003";
      await client.query("INSERT INTO cities VALUES($1)", [third]);
      for (const [sql, values, code] of [
        ["INSERT INTO user_discovery_preferences(user_id,city_id) VALUES($1,$2)", [owner.userId, moscow], "23505"],
        ["UPDATE user_discovery_preferences SET city_id=$2 WHERE user_id=$1", [owner.userId, third], "23514"],
        ["UPDATE user_discovery_preferences SET version=0 WHERE user_id=$1", [owner.userId], "23514"],
        ["INSERT INTO user_discovery_preferences(user_id,city_id) VALUES($1,$2)", [third, moscow], "23503"],
      ] as const) {
        await client.query("SAVEPOINT invalid_preference");
        await expect(client.query(sql, [...values])).rejects.toMatchObject({ code });
        await client.query("ROLLBACK TO SAVEPOINT invalid_preference");
      }
      await client.query("DELETE FROM users WHERE id=$1", [owner.userId]);
      expect((await client.query("SELECT * FROM user_discovery_preferences")).rows).toEqual([]);
      expect((await client.query("SELECT operation FROM idempotency_records")).rows).toEqual([{ operation: "unrelated.operation" }]);
    } finally { await client.query("ROLLBACK"); client.release(); }
    const before = (await pool.query("SELECT * FROM schema_migrations ORDER BY id")).rows;
    const replay = execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], { cwd: apiRoot, env: process.env, encoding: "utf8" });
    expect(replay).toContain("skip 0024_user_discovery_preferences");
    expect((await pool.query("SELECT * FROM schema_migrations ORDER BY id")).rows).toEqual(before);
  });
});
