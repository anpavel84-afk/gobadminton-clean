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
