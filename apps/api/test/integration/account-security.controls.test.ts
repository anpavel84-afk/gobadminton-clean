import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
import { randomUUID } from "node:crypto";
import { hashSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { IdentityService } from "../../src/auth/identity.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_BINDING_COOKIE, SESSION_COOKIE } from "../../src/auth/constants";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";

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

function cookieJar(cookies: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cookies)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
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
      return identity;
    },
  };
}

describeIntegration("Account security controls integration", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication | undefined;
  let pool: ReturnType<typeof createDatabase>["pool"];

  async function boot(adapters: AuthProviderAdapter[]) {
    if (app) {
      await app.close();
    }
    const env = loadEnv(process.env);
    if (!pool) {
      throw new Error("pool must be initialized before boot");
    }
    const moduleRef = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AuthModule],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue(adapters)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }

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
    process.env.GIT_SHA = "integration-asc";

    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    const env = loadEnv(process.env);
    pool = createDatabase(env.DATABASE_URL).pool;
    await boot([
      fakeAdapter({
        provider: "vk",
        issuerNamespace: "vkid:app:asc-boot",
        subject: uniqueSuffix("boot-vk"),
        displayName: "Boot",
      }),
      fakeAdapter({
        provider: "yandex",
        issuerNamespace: "yandex:oauth:boot",
        subject: uniqueSuffix("boot-ya"),
        displayName: "Boot YA",
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function login(provider: "vk" | "yandex") {
    if (!app) throw new Error("app not booted");
    const start = await app!.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=/account`,
    });
    expect(start.statusCode).toBe(200);
    const startCookies = parseSetCookie(start.headers["set-cookie"]);
    const binding = startCookies[AUTH_BINDING_COOKIE];
    const state = new URL(String(start.json().authorizationUrl)).searchParams.get(
      "state",
    )!;
    const deviceQuery = provider === "vk" ? "&device_id=vk-device-asc" : "";
    const callback = await app!.inject({
      method: "GET",
      url: `/v1/auth/${provider}/callback?code=test-code&state=${encodeURIComponent(state)}${deviceQuery}`,
      cookies: cookieJar({ [AUTH_BINDING_COOKIE]: binding }),
    });
    expect(callback.statusCode).toBe(302);
    const session = parseSetCookie(callback.headers["set-cookie"])[SESSION_COOKIE];
    expect(session).toBeTruthy();
    return session!;
  }

  async function csrfFor(session: string) {
    if (!app) throw new Error("app not booted");
    const me = await app!.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(me.statusCode).toBe(200);
    return { csrf: me.json().csrfToken as string, me: me.json() };
  }


  it("lists linked providers and refuses silent switch on collision (no email auto-link)", async () => {
    const identityVk: VerifiedIdentity = {
      provider: "vk",
      issuerNamespace: "vkid:app:asc",
      subject: uniqueSuffix("asc-vk"),
      email: "shared-asc@example.com",
      displayName: "ASC VK",
    };
    const identityYa: VerifiedIdentity = {
      provider: "yandex",
      issuerNamespace: "yandex:oauth:asc",
      subject: uniqueSuffix("asc-ya"),
      email: "shared-asc@example.com",
      displayName: "ASC YA",
    };
    await boot([fakeAdapter(identityVk), fakeAdapter(identityYa)]);

    const sessionA = await login("vk");
    const { csrf: csrfA, me: meA } = await csrfFor(sessionA);

    const listed = await app!.inject({
      method: "GET",
      url: "/v1/me/linked-providers",
      cookies: { [SESSION_COOKIE]: sessionA },
    });
    expect(listed.statusCode).toBe(200);
    const items = listed.json().items as Array<{ provider: string; status: string }>;
    expect(items.find((i) => i.provider === "vk")?.status).toBe("connected");
    expect(items.find((i) => i.provider === "yandex")?.status).toBe("available");

    const sessionB = await login("yandex");
    const meB = await app!.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: sessionB },
    });
    expect(meA.id).not.toBe(meB.json().id);

    const linkStart = await app!.inject({
      method: "POST",
      url: "/v1/me/linked-providers/yandex/link",
      headers: {
        origin: "http://127.0.0.1:3001",
        "x-csrf-token": csrfA,
      },
      payload: { returnPath: "/profile/settings/login-methods" },
      cookies: { [SESSION_COOKIE]: sessionA },
    });
    expect(linkStart.statusCode).toBe(200);
    const linkCookies = parseSetCookie(linkStart.headers["set-cookie"]);
    const linkState = new URL(
      String(linkStart.json().authorizationUrl),
    ).searchParams.get("state")!;

    const linkCallback = await app!.inject({
      method: "GET",
      url: `/v1/auth/yandex/callback?code=test-code&state=${encodeURIComponent(linkState)}`,
      cookies: cookieJar({
        [AUTH_BINDING_COOKIE]: linkCookies[AUTH_BINDING_COOKIE],
        [SESSION_COOKIE]: sessionA,
      }),
    });
    expect(linkCallback.statusCode).toBe(302);
    expect(String(linkCallback.headers.location)).toMatch(/authError=IDENTITY_COLLISION/);

    const meAfter = await app!.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: sessionA },
    });
    expect(meAfter.statusCode).toBe(200);
    expect(meAfter.json().id).toBe(meA.id);
    expect(meAfter.json().linkedProviders).toEqual(["vk"]);
  });

  it("links a free provider to the current session and protects last-method unlink", async () => {
    const freshVk: VerifiedIdentity = {
      provider: "vk",
      issuerNamespace: "vkid:app:asc-link",
      subject: uniqueSuffix("asc-link-vk"),
      email: "link-only@example.com",
      displayName: "Link VK",
    };
    const freshYa: VerifiedIdentity = {
      provider: "yandex",
      issuerNamespace: "yandex:oauth:asc-link",
      subject: uniqueSuffix("asc-link-ya"),
      email: "link-only@example.com",
      displayName: "Link YA",
    };
    await boot([fakeAdapter(freshVk), fakeAdapter(freshYa)]);

    const session = await login("vk");
    const { csrf } = await csrfFor(session);

    const unlinkOnly = await app!.inject({
      method: "DELETE",
      url: "/v1/me/linked-providers/vk",
      headers: {
        origin: "http://127.0.0.1:3001",
        "idempotency-key": "unlinkOnly-valid-key-issue23",
        "x-csrf-token": csrf,
      },
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(unlinkOnly.statusCode).toBe(409);
    expect(unlinkOnly.json().code).toBe("LAST_AUTH_METHOD");

    const linkStart = await app!.inject({
      method: "POST",
      url: "/v1/me/linked-providers/yandex/link",
      headers: {
        origin: "http://127.0.0.1:3001",
        "x-csrf-token": csrf,
      },
      payload: { returnPath: "/profile/settings/login-methods" },
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(linkStart.statusCode).toBe(200);
    const linkCookies = parseSetCookie(linkStart.headers["set-cookie"]);
    const linkState = new URL(
      String(linkStart.json().authorizationUrl),
    ).searchParams.get("state")!;
    const linkCallback = await app!.inject({
      method: "GET",
      url: `/v1/auth/yandex/callback?code=test-code&state=${encodeURIComponent(linkState)}`,
      cookies: cookieJar({
        [AUTH_BINDING_COOKIE]: linkCookies[AUTH_BINDING_COOKIE],
        [SESSION_COOKIE]: session,
      }),
    });
    expect(linkCallback.statusCode).toBe(302);
    expect(String(linkCallback.headers.location)).not.toMatch(/authError=/);

    const me = await app!.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(me.json().linkedProviders.sort()).toEqual(["vk", "yandex"]);

    const csrf2 = me.json().csrfToken as string;
    const unlinkVk = await app!.inject({
      method: "DELETE",
      url: "/v1/me/linked-providers/vk",
      headers: {
        origin: "http://127.0.0.1:3001",
        "idempotency-key": "unlinkVk-valid-key-issue23",
        "x-csrf-token": csrf2,
      },
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(unlinkVk.statusCode).toBe(200);
    expect(
      (unlinkVk.json().items as Array<{ provider: string; status: string }>).find(
        (i) => i.provider === "vk",
      )?.status,
    ).toBe("available");

    const noCsrf = await app!.inject({
      method: "DELETE",
      url: "/v1/me/linked-providers/yandex",
      headers: { origin: "http://127.0.0.1:3001" },
      cookies: { [SESSION_COOKIE]: session },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it("lists own sessions and supports revoke-one / revoke-others / logout", async () => {
    const id: VerifiedIdentity = {
      provider: "vk",
      issuerNamespace: "vkid:app:asc-sess",
      subject: uniqueSuffix("asc-sess"),
      displayName: "Session User",
    };
    await boot([
      fakeAdapter(id),
      fakeAdapter({
        provider: "yandex",
        issuerNamespace: "yandex:oauth:asc-sess",
        subject: uniqueSuffix("asc-sess-ya"),
        displayName: "Session YA",
      }),
    ]);

    const session1 = await login("vk");
    const session2 = await login("vk");
    const session3 = await login("vk");
    const { csrf: csrf3 } = await csrfFor(session3);

    const listed = await app!.inject({
      method: "GET",
      url: "/v1/me/sessions",
      cookies: { [SESSION_COOKIE]: session3 },
    });
    expect(listed.statusCode).toBe(200);
    const items = listed.json().items as Array<{ id: string; current: boolean }>;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.filter((i) => i.current)).toHaveLength(1);

    const other = items.find((i) => !i.current)!;
    const revokeOne = await app!.inject({
      method: "DELETE",
      url: `/v1/me/sessions/${other.id}`,
      headers: {
        origin: "http://127.0.0.1:3001",
        "idempotency-key": "revokeOne-valid-key-issue23",
        "x-csrf-token": csrf3,
      },
      cookies: { [SESSION_COOKIE]: session3 },
    });
    expect(revokeOne.statusCode).toBe(200);

    const currentId = items.find((i) => i.current)!.id;
    const revokeCurrent = await app!.inject({
      method: "DELETE",
      url: `/v1/me/sessions/${currentId}`,
      headers: {
        origin: "http://127.0.0.1:3001",
        "idempotency-key": "revokeCurrent-valid-key-issue23",
        "x-csrf-token": csrf3,
      },
      cookies: { [SESSION_COOKIE]: session3 },
    });
    expect(revokeCurrent.statusCode).toBe(409);
    expect(revokeCurrent.json().code).toBe("CURRENT_SESSION");

    const revokeOthers = await app!.inject({
      method: "POST",
      url: "/v1/me/sessions/revoke-others",
      headers: {
        origin: "http://127.0.0.1:3001",
        "x-csrf-token": csrf3,
        "idempotency-key": "asc-revoke-others-key-01",
      },
      payload: {},
      cookies: { [SESSION_COOKIE]: session3 },
    });
    expect(revokeOthers.statusCode).toBe(200);
    expect(revokeOthers.json().items).toHaveLength(1);
    expect(revokeOthers.json().items[0].current).toBe(true);

    expect(
      (
        await app!.inject({
          method: "GET",
          url: "/v1/me",
          cookies: { [SESSION_COOKIE]: session1 },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app!.inject({
          method: "GET",
          url: "/v1/me",
          cookies: { [SESSION_COOKIE]: session2 },
        })
      ).statusCode,
    ).toBe(401);

    const logout = await app!.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        origin: "http://127.0.0.1:3001",
        "x-csrf-token": csrf3,
        "idempotency-key": "asc-logout-key-01",
      },
      payload: {},
      cookies: { [SESSION_COOKIE]: session3 },
    });
    expect(logout.statusCode).toBe(204);
    expect(
      (
        await app!.inject({
          method: "GET",
          url: "/v1/me",
          cookies: { [SESSION_COOKIE]: session3 },
        })
      ).statusCode,
    ).toBe(401);
  });
  // Synthetic fixtures for the existing disposable-PostGIS integration harness only.
  async function securityActor(twoProviders = true) {
    const userId = (await pool.query<{ id: string }>(
      "INSERT INTO users(display_name) VALUES('Issue 23 synthetic actor') RETURNING id",
    )).rows[0]!.id;
    for (const provider of twoProviders ? ["vk", "yandex"] : ["vk"]) {
      await pool.query(
        "INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject) VALUES($1,$2,'issue23-synthetic',$3)",
        [userId, provider, randomUUID()],
      );
    }
    const issued = await app!.get(SessionService).createConsumerSession(userId);
    return {
      userId, issued,
      cookies: { [SESSION_COOKIE]: issued.sessionToken },
      headers: { origin: "http://127.0.0.1:3001", "x-csrf-token": issued.csrfToken },
    };
  }

  type SecurityActor = Awaited<ReturnType<typeof securityActor>>;
  function remove(a: SecurityActor, url: string, key: string = randomUUID()) {
    return app!.inject({ method: "DELETE", url, cookies: a.cookies,
      headers: { ...a.headers, "idempotency-key": key } });
  }
  async function receiptCount(a: SecurityActor, operation: string) {
    return (await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM idempotency_records WHERE actor_id=$1 AND operation=$2",
      [a.userId, operation],
    )).rows[0]!.n;
  }

  it("DELETE requires a real key, and Origin/CSRF/cookie gates remain enforced", async () => {
    const a = await securityActor();
    const target = await app!.get(SessionService).createConsumerSession(a.userId);
    for (const url of ["/v1/me/linked-providers/vk", `/v1/me/sessions/${target.session.id}`]) {
      for (const key of [undefined, "short", "x".repeat(129)]) {
        const result = await app!.inject({ method: "DELETE", url, cookies: a.cookies,
          headers: { ...a.headers, ...(key ? { "idempotency-key": key } : {}) } });
        expect(result.statusCode).toBe(400);
        expect(result.json().code).toBe("IDEMPOTENCY_KEY_INVALID");
      }
      for (const headers of [
        { "x-csrf-token": a.issued.csrfToken },
        { ...a.headers, origin: "https://evil.test" },
        { origin: a.headers.origin },
        { ...a.headers, "x-csrf-token": "wrong" },
        { ...a.headers, authorization: "Bearer wrong" },
      ]) {
        expect((await app!.inject({ method: "DELETE", url, cookies: a.cookies,
          headers: { ...headers, "idempotency-key": randomUUID() } })).statusCode).toBe(403);
      }
      expect((await app!.inject({ method: "DELETE", url,
        headers: { ...a.headers, "idempotency-key": randomUUID() } })).statusCode).toBe(401);
    }
    expect(await receiptCount(a, "identity.provider.unlink")).toBe(0);
    expect(await receiptCount(a, "identity.session.revoke")).toBe(0);
    expect((await pool.query("SELECT id FROM external_identities WHERE user_id=$1", [a.userId])).rows).toHaveLength(2);
    expect((await pool.query("SELECT revoked_at FROM app_sessions WHERE id=$1", [target.session.id])).rows[0]!.revoked_at).toBeNull();
  });

  it("provider duplicates run once, replay the original snapshot, and reject a changed target", async () => {
    const a = await securityActor();
    const key = randomUUID();
    const identities = app!.get(IdentityService);
    const spy = vi.spyOn(identities, "unlinkProviderInTransaction");
    try {
      const results = await Promise.all(Array.from({ length: 3 }, () => remove(a, "/v1/me/linked-providers/vk", key)));
      expect(results.map(r => r.statusCode)).toEqual([200, 200, 200]);
      for (const r of results) expect(r.json()).toEqual(results[0]!.json());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await receiptCount(a, "identity.provider.unlink")).toBe(1);
      const changed = await remove(a, "/v1/me/linked-providers/yandex", key);
      expect(changed.statusCode).toBe(409);
      expect(changed.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
      // A successful receipt authorizes only this actor's original operation.
      // Relinking later must neither rerun DELETE nor refresh the saved response.
      await identities.linkIdentityToUser(a.userId, {
        provider: "vk", issuerNamespace: "issue23-relink", subject: randomUUID(),
      }, a.issued.session.id);
      const replay = await remove(a, "/v1/me/linked-providers/vk", key);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(results[0]!.json());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await identities.listLinkedProviders(a.userId)).toEqual(["vk", "yandex"]);
      const foreign = await securityActor(false);
      const denied = await remove(foreign, "/v1/me/linked-providers/vk", key);
      expect(denied.statusCode).toBe(409);
      expect(denied.json().code).toBe("LAST_AUTH_METHOD");
      await pool.query("UPDATE app_sessions SET authenticated_at=now()-interval '16 minutes' WHERE id=$1", [a.issued.session.id]);
      const stale = await remove(a, "/v1/me/linked-providers/vk", key);
      expect(stale.statusCode).toBe(403);
      expect(stale.json().code).toBe("RECENT_AUTH_REQUIRED");
    } finally { spy.mockRestore(); }
  });

  it("different provider keys race without deleting the last method or leaving a failed receipt", async () => {
    const a = await securityActor();
    const results = await Promise.all(["vk", "yandex"].map(p => remove(a, `/v1/me/linked-providers/${p}`)));
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find(r => r.statusCode === 409)!.json().code).toBe("LAST_AUTH_METHOD");
    expect((await app!.get(IdentityService).listLinkedProviders(a.userId))).toHaveLength(1);
    expect(await receiptCount(a, "identity.provider.unlink")).toBe(1);
  });

  async function syntheticPresence(a: SecurityActor, ownerSessionId: string) {
    await pool.query(
      `INSERT INTO radar_presences(
        user_id,activation_id,owner_session_id,version,policy_version,region_id,
        started_at,expires_at,hard_expires_at,foreground_until,location_valid_until,
        next_location_update_at,next_radius_change_at,radius_changes_window_started_at,
        cell_i,cell_j,coarse_center,radius_bucket_km)
       VALUES($1,$2,$3,1,'issue23-test','synthetic',now(),now()+interval '10 minutes',
         now()+interval '20 minutes',now()+interval '1 minute',now()+interval '1 minute',
         now(),now(),now(),0,0,ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,3)`,
      [a.userId, randomUUID(), ownerSessionId],
    );
  }

  it("session duplicates revoke/purge once, preserve the exact snapshot and reject changed target/session context", async () => {
    const a = await securityActor();
    const sessions = app!.get(SessionService);
    const target = await sessions.createConsumerSession(a.userId);
    const second = await sessions.createConsumerSession(a.userId);
    await syntheticPresence(a, target.session.id);
    const key = randomUUID(), url = `/v1/me/sessions/${target.session.id}`;
    const spy = vi.spyOn(sessions, "revokeOwnedSessionInTransaction");
    try {
      const results = await Promise.all(Array.from({ length: 3 }, () => remove(a, url, key)));
      expect(results.map(r => r.statusCode)).toEqual([200, 200, 200]);
      for (const r of results) expect(r.json()).toEqual(results[0]!.json());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await receiptCount(a, "identity.session.revoke")).toBe(1);
      const revokedAt = (await pool.query("SELECT revoked_at FROM app_sessions WHERE id=$1", [target.session.id])).rows[0]!.revoked_at;
      expect(revokedAt).toBeInstanceOf(Date);
      expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [a.userId])).rowCount).toBe(0);
      expect(results[0]!.json().items.some((i: { id: string }) => i.id === target.session.id)).toBe(false);
      await sessions.createConsumerSession(a.userId);
      expect((await remove(a, url, key)).json()).toEqual(results[0]!.json());
      expect((await pool.query("SELECT revoked_at FROM app_sessions WHERE id=$1", [target.session.id])).rows[0]!.revoked_at).toEqual(revokedAt);
      const changed = await remove(a, `/v1/me/sessions/${second.session.id}`, key);
      expect(changed.statusCode).toBe(409);
      expect(changed.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
      const otherContext = { ...a, issued: second, cookies: { [SESSION_COOKIE]: second.sessionToken },
        headers: { ...a.headers, "x-csrf-token": second.csrfToken } };
      expect((await remove(otherContext, url, key)).statusCode).toBe(409);
      const current = await remove(a, `/v1/me/sessions/${a.issued.session.id}`);
      expect(current.statusCode).toBe(409);
      expect(current.json().code).toBe("CURRENT_SESSION");
      const foreign = await securityActor();
      expect((await remove(foreign, url, key)).statusCode).toBe(404);
      // Reauthorize the resource on replay, even if a formerly own target changes owner.
      await pool.query("UPDATE app_sessions SET user_id=$2 WHERE id=$1", [target.session.id, foreign.userId]);
      expect((await remove(a, url, key)).statusCode).toBe(404);
      expect(await receiptCount(a, "identity.session.revoke")).toBe(1);
    } finally { spy.mockRestore(); }
  });

  it("receipt failure rolls back provider removal and session revoke + presence purge", async () => {
    for (const kind of ["provider", "session"] as const) {
      const a = await securityActor();
      const target = await app!.get(SessionService).createConsumerSession(a.userId);
      if (kind === "session") await syntheticPresence(a, target.session.id);
      const url = kind === "provider" ? "/v1/me/linked-providers/vk" : `/v1/me/sessions/${target.session.id}`;
      const key = randomUUID();
      const spy = vi.spyOn(app!.get(IdempotencyService), "complete").mockRejectedValueOnce(new Error("synthetic receipt failure"));
      try { expect((await remove(a, url, key)).statusCode).toBe(500); }
      finally { spy.mockRestore(); }
      expect(await receiptCount(a, kind === "provider" ? "identity.provider.unlink" : "identity.session.revoke")).toBe(0);
      if (kind === "provider") expect(await app!.get(IdentityService).listLinkedProviders(a.userId)).toEqual(["vk", "yandex"]);
      else {
        expect((await pool.query("SELECT revoked_at FROM app_sessions WHERE id=$1", [target.session.id])).rows[0]!.revoked_at).toBeNull();
        expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [a.userId])).rowCount).toBe(1);
      }
      expect((await remove(a, url, key)).statusCode).toBe(200);
      expect(await receiptCount(a, kind === "provider" ? "identity.provider.unlink" : "identity.session.revoke")).toBe(1);
    }
  });

  it("revoked sessions and inactive actors cannot replay, including revocation after edge auth", async () => {
    for (const kind of ["provider", "session"] as const) {
      for (const state of ["revoked", "disabled", "deletion_pending"] as const) {
        const a = await securityActor();
        const target = await app!.get(SessionService).createConsumerSession(a.userId);
        const url = kind === "provider" ? "/v1/me/linked-providers/vk" : `/v1/me/sessions/${target.session.id}`;
        const key = randomUUID();
        expect((await remove(a, url, key)).statusCode).toBe(200);
        const runner = app!.get(MutationRunner), original = runner.runIdempotent.bind(runner);
        // Execute the actual revocation between HTTP auth and the real transactional fence.
        const spy = vi.spyOn(runner, "runIdempotent").mockImplementationOnce(async input => {
          if (state === "revoked") await app!.get(SessionService).revokeSession(a.issued.session.id);
          else await pool.query("UPDATE users SET status=$2 WHERE id=$1", [a.userId, state]);
          return original(input);
        });
        try { expect((await remove(a, url, key)).statusCode).toBe(401); }
        finally { spy.mockRestore(); }
        expect((await remove(a, url, key)).statusCode).toBe(401);
        expect(await receiptCount(a, kind === "provider" ? "identity.provider.unlink" : "identity.session.revoke")).toBe(1);
      }
    }
  });

  it("OAuth link initiation is fresh single-use state, with runtime Origin/CSRF/exact cookie binding", async () => {
    await boot([fakeAdapter({ provider: "vk", issuerNamespace: "issue23-oauth-vk", subject: randomUUID() }),
      fakeAdapter({ provider: "yandex", issuerNamespace: "issue23-oauth-ya", subject: randomUUID() })]);
    const a = await securityActor(false), b = await securityActor(false);
    const url = "/v1/me/linked-providers/yandex/link";
    for (const headers of [{}, { origin: a.headers.origin }, { "x-csrf-token": a.issued.csrfToken },
      { ...a.headers, origin: "https://evil.test" }, { ...a.headers, "x-csrf-token": "wrong" },
      { ...a.headers, authorization: "Bearer wrong" }]) {
      expect((await app!.inject({ method: "POST", url, headers, cookies: a.cookies, payload: {} })).statusCode).toBe(403);
    }
    expect((await app!.inject({ method: "POST", url, headers: a.headers, payload: {} })).statusCode).toBe(401);
    expect((await app!.inject({ method: "POST", url, headers: a.headers, cookies: b.cookies, payload: {} })).statusCode).toBe(403);
    const key = randomUUID();
    async function initiate() {
      const r = await app!.inject({ method: "POST", url, cookies: a.cookies,
        headers: { ...a.headers, "idempotency-key": key }, payload: { returnPath: "/account" } });
      expect(r.statusCode).toBe(200);
      return { state: new URL(r.json().authorizationUrl).searchParams.get("state")!,
        binding: parseSetCookie(r.headers["set-cookie"])[AUTH_BINDING_COOKIE]! };
    }
    const first = await initiate(), second = await initiate();
    const sameUser = await initiate(), missingSession = await initiate(), expired = await initiate(), revoked = await initiate();
    expect(first.state).not.toBe(second.state);
    expect(first.binding).not.toBe(second.binding);
    expect((await pool.query("SELECT 1 FROM idempotency_records WHERE actor_id=$1", [a.userId])).rowCount).toBe(0);
    const callback = (tx: typeof first, cookies: Record<string, string> = { ...a.cookies, [AUTH_BINDING_COOKIE]: tx.binding }, provider = "yandex") =>
      app!.inject({ method: "GET", url: `/v1/auth/${provider}/callback?code=test-code&state=${encodeURIComponent(tx.state)}`, cookies });
    expect(String((await callback(first, a.cookies)).headers.location)).toContain("authError=INVALID_CALLBACK");
    expect(String((await callback(first, { ...a.cookies, [AUTH_BINDING_COOKIE]: "wrong" })).headers.location)).toContain("authError=BINDING_MISMATCH");
    expect(String((await callback(first, undefined, "vk")).headers.location)).toContain("authError=PROVIDER_MISMATCH");
    const anotherSession = await app!.get(SessionService).createConsumerSession(a.userId);
    expect(String((await callback(sameUser, {
      [SESSION_COOKIE]: anotherSession.sessionToken, [AUTH_BINDING_COOKIE]: sameUser.binding,
    })).headers.location)).toContain("authError=LINK_SESSION_MISMATCH");
    expect(String((await callback(missingSession, { [AUTH_BINDING_COOKIE]: missingSession.binding })).headers.location)).toContain("authError=LINK_SESSION_REQUIRED");
    await pool.query("UPDATE auth_transactions SET expires_at=now()-interval '1 second' WHERE state_hash=$1", [
      hashSecret(loadEnv(process.env).AUTH_PEPPER, expired.state),
    ]);
    expect(String((await callback(expired)).headers.location)).toContain("authError=AUTH_TRANSACTION_EXPIRED");
    const identities = app!.get(IdentityService), spy = vi.spyOn(identities, "linkIdentityToUser");
    try {
      const concurrent = await Promise.all([callback(first), callback(first)]);
      expect(concurrent.filter(r => !String(r.headers.location).includes("authError="))).toHaveLength(1);
      expect(concurrent.filter(r => String(r.headers.location).includes("AUTH_TRANSACTION_REPLAY"))).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
    expect(await identities.listLinkedProviders(a.userId)).toEqual(["vk", "yandex"]);
    const mismatch = await callback(second, { ...b.cookies, [AUTH_BINDING_COOKIE]: second.binding });
    expect(String(mismatch.headers.location)).toContain("authError=LINK_SESSION_MISMATCH");
    expect(String((await callback(second)).headers.location)).toContain("authError=AUTH_TRANSACTION_REPLAY");
    expect(await identities.listLinkedProviders(b.userId)).toEqual(["vk"]);
    await app!.get(SessionService).revokeSession(a.issued.session.id);
    expect(String((await callback(revoked)).headers.location)).toContain("authError=LINK_SESSION_MISMATCH");
    expect(String((await callback(revoked)).headers.location)).toContain("authError=AUTH_TRANSACTION_REPLAY");
  });
});
