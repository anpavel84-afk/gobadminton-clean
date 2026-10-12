import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
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

describeIntegration("F-02 identity/session integration", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:test",
    subject: uniqueSuffix("subject-a"),
    email: "same@example.com",
    displayName: "Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:test",
    subject: uniqueSuffix("subject-b"),
    email: "same@example.com",
    displayName: "Player B",
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
    process.env.GIT_SHA = "integration-auth";

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
      imports: [TestCoreModule, AuthModule],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityA), fakeAdapter(identityB)])
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
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
    const startCookies = parseSetCookie(start.headers["set-cookie"]);
    const binding = startCookies[AUTH_BINDING_COOKIE];
    expect(binding).toBeTruthy();
    const authorizationUrl = String(start.json().authorizationUrl);
    const state = new URL(authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const deviceQuery = provider === "vk" ? "&device_id=vk-device-test" : "";
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/callback?code=test-code&state=${encodeURIComponent(state!)}${deviceQuery}`,
      cookies: cookieJar({ [AUTH_BINDING_COOKIE]: binding }),
    });
    expect(callback.statusCode).toBe(302);
    expect(String(callback.headers.location)).toContain("/account");
    const sessionCookies = parseSetCookie(callback.headers["set-cookie"]);
    const session = sessionCookies[SESSION_COOKIE];
    expect(session).toBeTruthy();
    expect(String(callback.headers["set-cookie"])).toMatch(/HttpOnly/i);
    expect(String(callback.headers["set-cookie"])).toMatch(/SameSite=Lax/i);
    return session!;
  }

  it("creates one user on first login and reuses it on repeat", async () => {
    const first = await login("vk");
    const me1 = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: first },
    });
    expect(me1.statusCode).toBe(200);
    expect(me1.headers["cache-control"]).toMatch(/no-store/i);
    const body1 = me1.json();
    expect(body1.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body1.linkedProviders).toContain("vk");
    expect(body1.csrfToken).toBeTruthy();
    expect(JSON.stringify(body1)).not.toMatch(/test-access|vk-secret|provider-access/i);

    const second = await login("vk");
    const me2 = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: second },
    });
    expect(me2.statusCode).toBe(200);
    expect(me2.json().id).toBe(body1.id);
  });

  it("does not auto-link different provider subjects that share email", async () => {
    const vkSession = await login("vk");
    const yaSession = await login("yandex");
    const vkMe = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: vkSession },
    });
    const yaMe = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: { [SESSION_COOKIE]: yaSession },
    });
    expect(vkMe.json().id).not.toBe(yaMe.json().id);
  });

  it("rejects replay, unknown provider, and revoked sessions", async () => {
    const start = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/account",
    });
    expect(start.statusCode).toBe(200);
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const state = new URL(String(start.json().authorizationUrl)).searchParams.get(
      "state",
    )!;
    const binding = cookies[AUTH_BINDING_COOKIE];

    const first = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=test-code&state=${encodeURIComponent(state)}&device_id=vk-device-test`,
      cookies: cookieJar({ [AUTH_BINDING_COOKIE]: binding }),
    });
    expect(first.statusCode).toBe(302);

    const replay = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=test-code&state=${encodeURIComponent(state)}&device_id=vk-device-test`,
      cookies: cookieJar({ [AUTH_BINDING_COOKIE]: binding }),
    });
    expect(String(replay.headers.location)).toMatch(/authError=/);

    const missingDevice = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/account",
    });
    const missingDeviceCookies = parseSetCookie(missingDevice.headers["set-cookie"]);
    const missingDeviceState = new URL(
      String(missingDevice.json().authorizationUrl),
    ).searchParams.get("state")!;
    const missingDeviceCallback = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=test-code&state=${encodeURIComponent(missingDeviceState)}`,
      cookies: cookieJar({
        [AUTH_BINDING_COOKIE]: missingDeviceCookies[AUTH_BINDING_COOKIE],
      }),
    });
    expect(String(missingDeviceCallback.headers.location)).toMatch(
      /authError=AUTH_FAILED/,
    );

    const unknown = await app.inject({
      method: "GET",
      url: "/v1/auth/google/start?returnPath=/account",
    });
    expect(unknown.statusCode).toBe(400);

    const session = parseSetCookie(first.headers["set-cookie"])[SESSION_COOKIE];
    expect(session).toBeTruthy();
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: cookieJar({ [SESSION_COOKIE]: session }),
    });
    const csrf = me.json().csrfToken as string;
    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        origin: "http://127.0.0.1:3001",
        "x-csrf-token": csrf,
        "idempotency-key": "logout-idempotency-key-01",
      },
      payload: {},
      cookies: cookieJar({ [SESSION_COOKIE]: session }),
    });
    expect(logout.statusCode).toBe(204);

    const meAfter = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: cookieJar({ [SESSION_COOKIE]: session }),
    });
    expect(meAfter.statusCode).toBe(401);
  });

  it("rejects unsafe returnPath and unauthenticated /me", async () => {
    const unsafe = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=https://evil.example",
    });
    expect(unsafe.statusCode).toBe(400);

    const me = await app.inject({ method: "GET", url: "/v1/me" });
    expect(me.statusCode).toBe(401);

    const providers = await app.inject({ method: "GET", url: "/v1/auth/providers" });
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toEqual({ providers: ["vk", "yandex"] });
  });
});
