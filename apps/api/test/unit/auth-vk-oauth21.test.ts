import { afterEach, describe, expect, it, vi } from "vitest";
import { VkAuthProvider } from "../../src/auth/providers/vk.adapter";
import { YandexAuthProvider } from "../../src/auth/providers/yandex.adapter";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    VK_CLIENT_ID: "vk-app-id",
    VK_CLIENT_SECRET: "vk-client-secret-value",
    VK_REDIRECT_URI: "https://gobadminton.ru/v1/auth/vk/callback",
    YANDEX_CLIENT_ID: "ya-app-id",
    YANDEX_CLIENT_SECRET: "ya-client-secret-value",
    YANDEX_REDIRECT_URI: "https://gobadminton.ru/v1/auth/yandex/callback",
    ...overrides,
  } as never;
}

function requestUrl(input: string | URL | { url: string }): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function asSearchParams(body: unknown): URLSearchParams {
  if (body instanceof URLSearchParams) return body;
  if (typeof body === "string") return new URLSearchParams(body);
  throw new Error("unexpected fetch body");
}

function collectedLogs(spies: Array<ReturnType<typeof vi.spyOn>>): string {
  return spies
    .flatMap((spy) => spy.mock.calls.map((args) => JSON.stringify(args)))
    .join("\n");
}

describe("VK ID OAuth 2.1 request shapes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exchanges the authorization code with query device_id and body code only", async () => {
    const fetchMock = vi.fn(async (input: string | URL | { url: string }, init?: RequestInit) => {
      const url = new URL(requestUrl(input));
      expect(url.origin + url.pathname).toBe("https://id.vk.com/oauth2/auth");
      expect(init?.method).toBe("POST");
      expect(url.searchParams.get("grant_type")).toBe("authorization_code");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://gobadminton.ru/v1/auth/vk/callback",
      );
      expect(url.searchParams.get("client_id")).toBe("vk-app-id");
      expect(url.searchParams.get("code_verifier")).toBe("pkce-verifier-secret");
      expect(url.searchParams.get("state")).toBe("oauth-state");
      expect(url.searchParams.get("device_id")).toBe("vk-device-1");
      expect(url.searchParams.get("client_secret")).toBeNull();
      expect(url.search).not.toContain("vk-client-secret-value");
      const body = asSearchParams(init?.body);
      expect([...body.keys()]).toEqual(["code"]);
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("client_secret")).toBeNull();
      return jsonResponse({
        access_token: "vk-access-token",
        refresh_token: "vk-refresh-token",
        state: "oauth-state",
        expires_in: 3600,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const logs = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
    ];

    const adapter = new VkAuthProvider(makeEnv());
    const tokens = await adapter.exchangeCode({
      code: "auth-code",
      codeVerifier: "pkce-verifier-secret",
      redirectUri: "https://gobadminton.ru/v1/auth/vk/callback",
      state: "oauth-state",
      deviceId: "vk-device-1",
    });
    expect(tokens.accessToken).toBe("vk-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(collectedLogs(logs)).not.toMatch(
      /auth-code|pkce-verifier-secret|oauth-state|vk-device-1|vk-access-token|vk-client-secret-value/,
    );
  });

  it("fails closed without fabricating a device id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new VkAuthProvider(makeEnv());
    await expect(
      adapter.exchangeCode({
        code: "auth-code",
        codeVerifier: "pkce-verifier-secret",
        redirectUri: "https://gobadminton.ru/v1/auth/vk/callback",
        state: "oauth-state",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a token response whose state does not match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          access_token: "vk-access-token",
          state: "other-state",
        }),
      ),
    );
    const adapter = new VkAuthProvider(makeEnv());
    await expect(
      adapter.exchangeCode({
        code: "auth-code",
        codeVerifier: "pkce-verifier-secret",
        redirectUri: "https://gobadminton.ru/v1/auth/vk/callback",
        state: "oauth-state",
        deviceId: "vk-device-1",
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("requests user info with query client_id and body access_token", async () => {
    const fetchMock = vi.fn(async (input: string | URL | { url: string }, init?: RequestInit) => {
      const url = new URL(requestUrl(input));
      expect(url.origin + url.pathname).toBe("https://id.vk.com/oauth2/user_info");
      expect(init?.method).toBe("POST");
      expect(url.searchParams.get("client_id")).toBe("vk-app-id");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();
      const body = asSearchParams(init?.body);
      expect([...body.keys()]).toEqual(["access_token"]);
      expect(body.get("access_token")).toBe("vk-access-token");
      return jsonResponse({
        user: {
          user_id: 42,
          email: "player@example.com",
          first_name: "Иван",
          last_name: "Иванов",
          avatar: "https://example.test/avatar.png",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new VkAuthProvider(makeEnv());
    const identity = await adapter.fetchVerifiedIdentity({
      accessToken: "vk-access-token",
    });
    expect(identity).toEqual({
      provider: "vk",
      issuerNamespace: "vkid:app:vk-app-id",
      subject: "42",
      email: "player@example.com",
      displayName: "Иван Иванов",
      avatarUrl: "https://example.test/avatar.png",
    });
  });
});

describe("Yandex adapter contract remains unchanged", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps token exchange in the POST body including client_secret", async () => {
    const fetchMock = vi.fn(async (input: string | URL | { url: string }, init?: RequestInit) => {
      const url = new URL(requestUrl(input));
      expect(url.origin + url.pathname).toBe("https://oauth.yandex.ru/token");
      expect(url.search).toBe("");
      const body = asSearchParams(init?.body);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("ya-code");
      expect(body.get("code_verifier")).toBe("ya-verifier");
      expect(body.get("client_id")).toBe("ya-app-id");
      expect(body.get("client_secret")).toBe("ya-client-secret-value");
      expect(body.get("device_id")).toBeNull();
      return jsonResponse({ access_token: "ya-access-token" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new YandexAuthProvider(makeEnv());
    const tokens = await adapter.exchangeCode({
      code: "ya-code",
      codeVerifier: "ya-verifier",
      redirectUri: "https://gobadminton.ru/v1/auth/yandex/callback",
      state: "ya-state",
      deviceId: "must-be-ignored",
    });
    expect(tokens.accessToken).toBe("ya-access-token");
  });

  it("still fetches Yandex userinfo with an OAuth Authorization header", async () => {
    const fetchMock = vi.fn(async (input: string | URL | { url: string }, init?: RequestInit) => {
      const url = new URL(requestUrl(input));
      expect(url.origin + url.pathname).toBe("https://login.yandex.ru/info");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("OAuth ya-access-token");
      return jsonResponse({
        id: "7",
        default_email: "ya@example.com",
        display_name: "Ya",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new YandexAuthProvider(makeEnv());
    const identity = await adapter.fetchVerifiedIdentity({
      accessToken: "ya-access-token",
    });
    expect(identity.provider).toBe("yandex");
    expect(identity.subject).toBe("7");
    expect(identity.issuerNamespace).toBe("yandex:oauth:ya-app-id");
  });
});
