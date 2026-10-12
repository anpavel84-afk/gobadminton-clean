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
});
