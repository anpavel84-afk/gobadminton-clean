import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env";

describe("loadEnv", () => {
  it("accepts a valid local configuration", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      PORT: "3000",
      HOST: "127.0.0.1",
      DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      GIT_SHA: "abc123",
      SERVICE_NAME: "gobadminton-api",
    });

    expect(env.PORT).toBe(3000);
    expect(env.PUBLIC_API_ORIGIN).toBe("http://127.0.0.1:3000");
    expect(env.APP_ENV).toBe("local");
    expect(env.AUTH_PEPPER.length).toBeGreaterThanOrEqual(32);
    expect(env.ALLOWED_WEB_ORIGINS.length).toBeGreaterThan(0);
    expect(env.SOCIAL_DIRECTORY_ENABLED).toBe(false);
    expect(env.SOCIAL_RADAR_ENABLED).toBe(false);
    expect(env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED).toBe(false);
    expect(env.RADAR_GEOGRAPHIC_TOKEN_EPOCH).toBe("source-stage-v1");
    expect(env.SOCIAL_RADAR_DEMO_ENABLED).toBe(false);
    expect(env.SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS).toEqual([]);
    expect(env.SOCIAL_DM_ENABLED).toBe(false);
    expect(env.SOCIAL_INVITATIONS_ENABLED).toBe(false);
    expect(env.SOCIAL_GAME_CHAT_ENABLED).toBe(false);
    expect(env.SOCIAL_INBOX_ENABLED).toBe(false);
  });

  it("enables SOCIAL_DIRECTORY_ENABLED when explicitly set", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      SOCIAL_DIRECTORY_ENABLED: "1",
    });
    expect(env.SOCIAL_DIRECTORY_ENABLED).toBe(true);
  });


  it("enables SOCIAL_RADAR_ENABLED when explicitly set", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      SOCIAL_RADAR_ENABLED: "1",
    });
    expect(env.SOCIAL_RADAR_ENABLED).toBe(true);
    expect(env.SOCIAL_RADAR_GEOGRAPHIC_ENABLED).toBe(false);
  });

  it("enables SOCIAL_RADAR_DEMO_ENABLED independently of live Radar", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      SOCIAL_RADAR_DEMO_ENABLED: "1",
    });
    expect(env.SOCIAL_RADAR_DEMO_ENABLED).toBe(true);
    expect(env.SOCIAL_RADAR_ENABLED).toBe(false);
  });



  it("parses owner/test global Radar user allowlist without enabling Radar itself", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS:
        "11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222",
    });
    expect(env.SOCIAL_RADAR_ENABLED).toBe(false);
    expect(env.SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("rejects raw IP public API origins", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
        PUBLIC_API_ORIGIN: "http://169.58.183.182:18080",
      }),
    ).toThrow(/PUBLIC_API_ORIGIN/);
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      loadEnv({
        PUBLIC_API_ORIGIN: "https://dev-api.gobadminton.ru",
      }),
    ).toThrow(/DATABASE_URL/);
  });

  const friendsRuntime = {
    DATABASE_URL: "postgres://synthetic:synthetic@localhost/friends_disposable",
    CONTENT_MODERATION_PROVIDER: "openai",
    CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-fingerprint-secret-32chars",
    OPENAI_MODERATION_API_KEY: "synthetic-not-a-real-key",
    FRIENDS_INTERNAL_ENABLED: "1",
    SOCIAL_DIRECTORY_ENABLED: "1",
    FRIENDS_REQUEST_TTL_SECONDS: "604800",
    FRIENDS_RATE_WINDOW_SECONDS: "3600",
    FRIENDS_SEND_LIMIT: "20",
    FRIENDS_RECEIVE_LIMIT: "50",
  } as const;

  it("accepts exact production Friends origins with APP_ENV prod", () => {
    const env = loadEnv({
      ...friendsRuntime,
      NODE_ENV: "production",
      APP_ENV: "prod",
      PUBLIC_WEB_ORIGIN: "https://gobadminton.ru",
      PUBLIC_API_ORIGIN: "https://gobadminton.ru",
    });
    expect(env.FRIENDS_INTERNAL_ENABLED).toBe(true);
    expect(env.APP_ENV).toBe("prod");
    expect(env.PUBLIC_WEB_ORIGIN).toBe("https://gobadminton.ru");
    expect(env.PUBLIC_API_ORIGIN).toBe("https://gobadminton.ru");
    expect(env.SOCIAL_DIRECTORY_ENABLED).toBe(true);
  });

  it.each([
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru", PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru" },
    { APP_ENV: "mvp", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    { APP_ENV: "stage", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "http://gobadminton.ru", PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://www.gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://api.gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru/", PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://user:pass@gobadminton.ru", PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "http://127.0.0.1:3000" },
    { APP_ENV: "prod", NODE_ENV: "test", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://gobadminton.ru", SOCIAL_DIRECTORY_ENABLED: "0" },
    { APP_ENV: "prod", NODE_ENV: "production", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://gobadminton.ru", FRIENDS_SEND_LIMIT: "101" },
  ])("rejects incorrect Friends production origin/environment variant: %j", (extra) => {
    expect(() => loadEnv({ ...friendsRuntime, ...extra })).toThrow(/FRIENDS_INTERNAL_ENABLED|Friends production runtime/);
  });
});
