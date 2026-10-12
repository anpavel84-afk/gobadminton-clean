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
});
