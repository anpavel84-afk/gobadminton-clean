import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/auth/auth.service";
import { AUTH_BINDING_COOKIE, SESSION_COOKIE } from "../../src/auth/constants";
import type { AuthProviderAdapter, VerifiedIdentity } from "../../src/auth/providers/types";
import { normalizeReturnPath } from "../../src/auth/return-path";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: "test",
    APP_ENV: "local",
    PORT: 3000,
    HOST: "127.0.0.1",
    DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
    PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
    PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
    ALLOWED_WEB_ORIGINS: ["http://127.0.0.1:3001"],
    AUTH_PEPPER: "t".repeat(32),
    AUTH_TRANSACTION_TTL_SECONDS: 600,
    SESSION_TTL_SECONDS: 3600,
    COOKIE_SECURE: false,
    GIT_SHA: "test",
    SERVICE_NAME: "gobadminton-api",
    VK_CLIENT_ID: "vk-app",
    VK_CLIENT_SECRET: "vk-secret",
    VK_REDIRECT_URI: "http://127.0.0.1:3000/v1/auth/vk/callback",
    YANDEX_CLIENT_ID: undefined,
    YANDEX_CLIENT_SECRET: undefined,
    YANDEX_REDIRECT_URI: undefined,
    ...overrides,
  } as never;
}

function fakeProvider(
  identity: VerifiedIdentity,
  configured = true,
): AuthProviderAdapter {
  return {
    key: identity.provider,
    configured,
    async startAuthorization() {
      return { authorizationUrl: "https://provider.example/authorize?x=1" };
    },
    async exchangeCode() {
      return { accessToken: "provider-access-token" };
    },
    async fetchVerifiedIdentity() {
      return identity;
    },
  };
}

describe("auth security gates", () => {
  it("rejects unknown providers and unsafe return paths before redirect", async () => {
    const providers = {
      listKeys: () => ["vk", "yandex"],
      getConfiguredOrThrow: vi.fn(),
    };
    const auth = new AuthService(
      makeEnv(),
      providers as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      auth.startBrowserAuth("google", "/account", { setCookie: vi.fn() } as never),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      auth.startBrowserAuth("vk", "https://evil.example/", {
        setCookie: vi.fn(),
      } as never),
    ).rejects.toMatchObject({ status: 400 });

    expect(normalizeReturnPath("//evil")).toBeNull();
  });

  it("fails closed when provider credentials are missing", async () => {
    const providers = {
      listKeys: () => ["vk", "yandex"],
      getConfiguredOrThrow: () => {
        const err = Object.assign(new Error("unavailable"), {
          status: 503,
          getResponse: () => ({ code: "PROVIDER_UNAVAILABLE", status: 503 }),
        });
        throw err;
      },
    };
    const auth = new AuthService(
      makeEnv({
        VK_CLIENT_ID: undefined,
        VK_CLIENT_SECRET: undefined,
        VK_REDIRECT_URI: undefined,
      }),
      providers as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      auth.startBrowserAuth("vk", "/account", { setCookie: vi.fn() } as never),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("rejects logout without Origin / CSRF", async () => {
    const sessions = {
      lookupActiveSession: vi.fn(async () => ({
        id: "sess-1",
        userId: "user-1",
        audience: "consumer_browser",
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      })),
      verifyCsrf: vi.fn(async () => false),
      revokeSession: vi.fn(),
    };
    const auth = new AuthService(
      makeEnv(),
      { listKeys: () => ["vk", "yandex"] } as never,
      {} as never,
      {} as never,
      sessions as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      auth.logout(
        {
          headers: {},
          cookies: { [SESSION_COOKIE]: "token" },
        } as never,
        { clearCookie: vi.fn() } as never,
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      auth.logout(
        {
          headers: {
            origin: "http://127.0.0.1:3001",
            "x-csrf-token": "bad",
          },
          cookies: { [SESSION_COOKIE]: "token" },
        } as never,
        { clearCookie: vi.fn() } as never,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("exposes only vk/yandex in provider registry list", () => {
    const auth = new AuthService(
      makeEnv(),
      { listKeys: () => ["vk", "yandex"] } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(auth.listProviders()).toEqual({ providers: ["vk", "yandex"] });
    expect(fakeProvider({
      provider: "vk",
      issuerNamespace: "vkid:app:1",
      subject: "42",
    }).configured).toBe(true);
  });

  it("passes VK callback device_id into exchange and fails closed when it is missing", async () => {
    const vkRedirect = "http://127.0.0.1:3000/v1/auth/vk/callback";
    const env = makeEnv({ VK_REDIRECT_URI: vkRedirect });
    const exchangeCode = vi.fn(async () => ({ accessToken: "provider-access-token" }));
    const fetchVerifiedIdentity = vi.fn(async () => ({
      provider: "vk" as const,
      issuerNamespace: "vkid:app:vk-app",
      subject: "42",
    }));
    const providers = {
      listKeys: () => ["vk", "yandex"],
      getConfiguredOrThrow: () => ({
        key: "vk",
        configured: true,
        startAuthorization: async () => ({ authorizationUrl: "https://id.vk.com/authorize" }),
        exchangeCode,
        fetchVerifiedIdentity,
      }),
    };
    const transactions = {
      consume: vi.fn(async () => ({
        pkceVerifier: "pkce-verifier-secret",
        redirectUri: vkRedirect,
        returnPath: "/account",
        purpose: "login",
        boundUserId: null,
        boundSessionId: null,
      })),
    };
    const identities = {
      resolveOrCreateUser: vi.fn(async () => ({ id: "user-1", status: "active" })),
    };
    const sessions = {
      createConsumerSession: vi.fn(async () => ({ sessionToken: "session-token" })),
    };
    const auth = new AuthService(
      env,
      providers as never,
      transactions as never,
      identities as never,
      sessions as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const reply = { setCookie: vi.fn(), clearCookie: vi.fn() };
    const request = {
      cookies: { [AUTH_BINDING_COOKIE]: "binding-secret" },
    };

    const missing = await auth.handleBrowserCallback(
      "vk",
      { code: "auth-code", state: "auth-state" },
      request as never,
      reply as never,
    );
    expect(missing.redirectTo).toContain("authError=AUTH_FAILED");
    expect(exchangeCode).not.toHaveBeenCalled();

    const ok = await auth.handleBrowserCallback(
      "vk",
      { code: "auth-code", state: "auth-state", device_id: "vk-device-1" },
      request as never,
      reply as never,
    );
    expect(ok.redirectTo).toBe("http://127.0.0.1:3001/account");
    expect(exchangeCode).toHaveBeenCalledWith({
      code: "auth-code",
      codeVerifier: "pkce-verifier-secret",
      redirectUri: vkRedirect,
      state: "auth-state",
      deviceId: "vk-device-1",
    });
  });

  it("does not require device_id for Yandex callback exchange", async () => {
    const yaRedirect = "http://127.0.0.1:3000/v1/auth/yandex/callback";
    const env = makeEnv({
      YANDEX_CLIENT_ID: "ya-app",
      YANDEX_CLIENT_SECRET: "ya-secret",
      YANDEX_REDIRECT_URI: yaRedirect,
    });
    const exchangeCode = vi.fn(async (input: { deviceId?: string }) => {
      expect(input.deviceId).toBeUndefined();
      return { accessToken: "ya-access" };
    });
    const auth = new AuthService(
      env,
      {
        listKeys: () => ["vk", "yandex"],
        getConfiguredOrThrow: () => ({
          key: "yandex",
          configured: true,
          startAuthorization: async () => ({
            authorizationUrl: "https://oauth.yandex.ru/authorize",
          }),
          exchangeCode,
          fetchVerifiedIdentity: async () => ({
            provider: "yandex" as const,
            issuerNamespace: "yandex:oauth:ya-app",
            subject: "7",
          }),
        }),
      } as never,
      {
        consume: async () => ({
          pkceVerifier: "ya-verifier",
          redirectUri: yaRedirect,
          returnPath: "/account",
          purpose: "login",
          boundUserId: null,
          boundSessionId: null,
        }),
      } as never,
      {
        resolveOrCreateUser: async () => ({ id: "user-ya", status: "active" }),
      } as never,
      {
        createConsumerSession: async () => ({ sessionToken: "ya-session" }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await auth.handleBrowserCallback(
      "yandex",
      { code: "ya-code", state: "ya-state" },
      { cookies: { [AUTH_BINDING_COOKIE]: "binding-secret" } } as never,
      { setCookie: vi.fn(), clearCookie: vi.fn() } as never,
    );
    expect(result.redirectTo).toBe("http://127.0.0.1:3001/account");
    expect(exchangeCode).toHaveBeenCalledTimes(1);
  });
});
