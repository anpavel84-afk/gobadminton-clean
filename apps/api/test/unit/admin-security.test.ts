import { describe, expect, it } from "vitest";
import { ADMIN_ROLES, hasPermission } from "../../src/admin/rbac";
import { commandSchema } from "../../src/admin/dto";
import { loadEnv } from "../../src/config/env";
const base = {
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://synthetic@127.0.0.1:16540/admin_test",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:18541",
  PUBLIC_WEB_ORIGIN: "http://127.0.0.1:18542",
};
describe("A0a fixed authority boundary", () => {
  it("uses additive roles without granting global or scoped powers implicitly", () => {
    for (const r of ADMIN_ROLES)
      expect(hasPermission([r], "identity.manage")).toBe(r === "superadmin");
    expect(hasPermission(["content_manager", "support"], "venue.merge")).toBe(
      true,
    );
    expect(
      hasPermission(["content_manager", "support"], "game.force_cancel"),
    ).toBe(false);
    expect(hasPermission(["support"], "case.manage")).toBe(false);
    expect(hasPermission(["support"], "case.assigned.manage")).toBe(true);
    expect(hasPermission(["moderator"], "evidence.read")).toBe(false);
  });
  it("rejects unknown role, permission editor and unknown request fields", () => {
    expect(
      commandSchema.safeParse({
        action: "role",
        principalId: "c2ee05d9-4dd2-4f53-9d2f-9dcd243fc281",
        role: "owner",
        active: true,
        expectedVersion: 1,
        reasonCode: "fixture",
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({ action: "sql", query: "SELECT * FROM users" })
        .success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        action: "create_principal",
        userId: "c2ee05d9-4dd2-4f53-9d2f-9dcd243fc281",
        reasonCode: "fixture",
        role: "superadmin",
      }).success,
    ).toBe(false);
  });
  it("defaults off and rejects public/prod/consumer-origin/shared-secret activation", () => {
    expect(loadEnv(base).ADMIN_INTERNAL_ENABLED).toBe(false);
    const allowed = {
      ...base,
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_AUTH_PEPPER: "admin-only-test-secret-at-least-32-chars",
      ADMIN_ORIGIN: "http://localhost:18540",
    };
    expect(loadEnv(allowed).ADMIN_INTERNAL_ENABLED).toBe(true);
    for (const bad of [
      { APP_ENV: "prod" },
      { NODE_ENV: "production" },
      { HOST: "0.0.0.0" },
      { DATABASE_URL: "postgres://synthetic@example.test/test" },
      { ADMIN_ORIGIN: base.PUBLIC_WEB_ORIGIN },
      { ADMIN_AUTH_PEPPER: "local-only-dev-auth-pepper-change-me!!" },
      { ADMIN_VK_REDIRECT_URI: "https://example.test/v1/auth/vk/callback" },
      { ALLOWED_WEB_ORIGINS: "http://localhost:18540" },
    ])
      expect(() => loadEnv({ ...allowed, ...bad })).toThrow();
  });
});

describe("deliberate Germany DEV Admin configuration", () => {
  const dev = { ...base, NODE_ENV:"production", APP_ENV:"mvp", ADMIN_INTERNAL_ENABLED:"1", ADMIN_DEV_ENABLED:"1",
    PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru", PUBLIC_API_ORIGIN:"https://dev.gobadminton.ru",
    ADMIN_ORIGIN:"https://dev-admin.gobadminton.ru", ADMIN_AUTH_PEPPER:"dedicated-admin-secret-longer-than-32-chars",
    ADMIN_VK_REDIRECT_URI:"https://dev-admin.gobadminton.ru/v1/admin/auth/vk/callback",
    ADMIN_YANDEX_REDIRECT_URI:"https://dev-admin.gobadminton.ru/v1/admin/auth/yandex/callback",
    VK_CLIENT_ID:"synthetic", VK_CLIENT_SECRET:"synthetic-provider-secret",
    CONTENT_MODERATION_PROVIDER:"openai", CONTENT_MODERATION_FINGERPRINT_SECRET:"dedicated-moderation-secret-longer-than-32", OPENAI_MODERATION_API_KEY:"synthetic" };
  it("admits mvp/stage without pretending to run in test", () => {
    for (const APP_ENV of ["mvp","stage"]) expect(loadEnv({...dev,APP_ENV}).ADMIN_DEV_ENABLED).toBe(true);
  });
  it("rejects missing opt-in, PROD, invalid environments, origins, secrets and callbacks", () => {
    for (const bad of [{ADMIN_DEV_ENABLED:"0"},{APP_ENV:"prod"},{APP_ENV:"local"},{NODE_ENV:"test"},
      {ADMIN_ORIGIN:"https://dev.gobadminton.ru"},{ADMIN_ORIGIN:"https://user@dev-admin.gobadminton.ru"},
      {ADMIN_ORIGIN:"https://arbitrary.test"},{COOKIE_SECURE:"0"},{ADMIN_AUTH_PEPPER:undefined},
      {ADMIN_AUTH_PEPPER:dev.CONTENT_MODERATION_FINGERPRINT_SECRET},{VK_CLIENT_SECRET:undefined},
      {ADMIN_VK_REDIRECT_URI:"https://dev-admin.gobadminton.ru/v1/admin/auth/yandex/callback"},
      {ADMIN_YANDEX_REDIRECT_URI:undefined},{ALLOWED_WEB_ORIGINS:dev.ADMIN_ORIGIN}])
      expect(() => loadEnv({...dev,...bad})).toThrow();
  });
});

describe("DEV path config retains pure Origin and explicit callbacks", () => {
  const main = "https://dev.gobadminton.ru";
  const dev = { ...base, NODE_ENV:"production", APP_ENV:"stage", ADMIN_INTERNAL_ENABLED:"1", ADMIN_DEV_ENABLED:"1", ADMIN_DEV_PATH_ENABLED:"1",
    PUBLIC_WEB_ORIGIN:main, PUBLIC_API_ORIGIN:main, ADMIN_ORIGIN:main,
    ADMIN_AUTH_PEPPER:"dedicated-admin-secret-longer-than-32-chars",
    ADMIN_VK_REDIRECT_URI:main+"/admin/v1/admin/auth/vk/callback",
    ADMIN_YANDEX_REDIRECT_URI:main+"/admin/v1/admin/auth/yandex/callback",
    VK_CLIENT_ID:"synthetic", VK_CLIENT_SECRET:"synthetic-provider-secret",
    CONTENT_MODERATION_PROVIDER:"openai", CONTENT_MODERATION_FINGERPRINT_SECRET:"dedicated-moderation-secret-longer-than-32", OPENAI_MODERATION_API_KEY:"synthetic" };
  it("admits only exact DEV path configuration and rejects partial or lookalike activation", () => {
    expect(loadEnv(dev).ADMIN_ORIGIN).toBe(main);
    for (const bad of [{ADMIN_DEV_PATH_ENABLED:"0"},{ADMIN_DEV_PATH_ENABLED:"true"},{ADMIN_DEV_ENABLED:"0"},
      {ADMIN_INTERNAL_ENABLED:"0"},{APP_ENV:"prod"},{APP_ENV:"local"},{COOKIE_SECURE:"0"},
      {ADMIN_ORIGIN:main+"/admin"},{ADMIN_ORIGIN:main+"?x"},{ADMIN_ORIGIN:main+"#x"},
      {ADMIN_ORIGIN:"https://user@dev.gobadminton.ru"},{ADMIN_ORIGIN:main+".evil.test"},
      {ADMIN_VK_REDIRECT_URI:main+"/v1/admin/auth/vk/callback"},
      {ADMIN_YANDEX_REDIRECT_URI:main+"/admin/v1/admin/auth/yandex/callback?code=x"}])
      expect(() => loadEnv({...dev,...bad})).toThrow();
  });
});
