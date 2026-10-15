import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Execute the actual side-effectful entry point. Only persistence is replaced:
// loadEnv, operatorProvisionSchema and CLI dispatch/error handling remain real.
const db = vi.hoisted(() => ({
  first: vi.fn(), enroll: vi.fn(), end: vi.fn(), pool: vi.fn(),
}));
vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) { db.pool(options); }
    end = db.end;
  },
}));
vi.mock("../../src/admin/admin-db", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/admin/admin-db")>(),
  bootstrapFirstAdmin: db.first,
  provisionAdmin: db.enroll,
}));

const token = "synthetic-activation-token-never-print-123456";
const userId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const principalId = "33333333-3333-4333-8333-333333333333";
const dev = {
  NODE_ENV: "production", APP_ENV: "mvp",
  DATABASE_URL: "postgres://synthetic@127.0.0.1:16540/admin_test",
  PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru",
  PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru",
  ADMIN_ORIGIN: "https://dev-admin.gobadminton.ru",
  ADMIN_INTERNAL_ENABLED: "1", ADMIN_DEV_ENABLED: "1",
  ADMIN_AUTH_PEPPER: "synthetic-dedicated-admin-pepper-123456789",
  ADMIN_VK_REDIRECT_URI: "https://dev-admin.gobadminton.ru/v1/admin/auth/vk/callback",
  ADMIN_YANDEX_REDIRECT_URI: "https://dev-admin.gobadminton.ru/v1/admin/auth/yandex/callback",
  VK_CLIENT_ID: "synthetic", VK_CLIENT_SECRET: "synthetic-provider-secret",
  CONTENT_MODERATION_PROVIDER: "openai", OPENAI_MODERATION_API_KEY: "synthetic",
  CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-dedicated-moderation-pepper-12345",
  ADMIN_DEV_OPERATOR_PROVISION: "1",
  ADMIN_BOOTSTRAP_USER_ID: userId, ADMIN_BOOTSTRAP_OPERATION_ID: operationId,
  ADMIN_BOOTSTRAP_ACTIVATION_TOKEN: token, ADMIN_BOOTSTRAP_REASON: "verified_operator",
};
const originalEnv = process.env;
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  process.env = { ...dev };
  process.exitCode = undefined;
  db.first.mockResolvedValue({ principalId, replayed: false });
  db.enroll.mockResolvedValue({ principalId, replayed: false });
  db.end.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env = originalEnv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

async function execute() {
  await import("../../src/admin/bootstrap-cli");
  await vi.waitFor(() => {
    expect(vi.mocked(console.info).mock.calls.length + vi.mocked(console.error).mock.calls.length).toBe(1);
  });
}
async function refused() {
  await execute();
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledExactlyOnceWith(
    "Admin bootstrap refused or failed; no credential output",
  );
  expect(console.info).not.toHaveBeenCalled();
  expect(db.pool).not.toHaveBeenCalled();
  expect(db.first).not.toHaveBeenCalled();
  expect(db.enroll).not.toHaveBeenCalled();
}

describe("trusted bootstrap executable CLI boundary", () => {
  it.each([undefined, "0", "true"])("requires exact DEV operator opt-in: %s", async (flag) => {
    if (flag === undefined) delete process.env.ADMIN_DEV_OPERATOR_PROVISION;
    else process.env.ADMIN_DEV_OPERATOR_PROVISION = flag;
    process.env.ADMIN_BOOTSTRAP_SOURCE_TEST = "1";
    await refused();
  });

  it.each(["mvp", "stage"])("dispatches first with default superadmin on %s", async (appEnv) => {
    process.env.APP_ENV = appEnv;
    await execute();
    expect(db.first).toHaveBeenCalledExactlyOnceWith(expect.anything(), dev.ADMIN_AUTH_PEPPER, {
      userId, operationId, activationToken: token, reasonCode: "verified_operator", role: "superadmin",
    });
    expect(db.enroll).not.toHaveBeenCalled();
    expect(db.pool).toHaveBeenCalledExactlyOnceWith({ connectionString: dev.DATABASE_URL });
    expect(db.end).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ principalId, replayed: false }));
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("dispatches enroll with an explicit existing role and prints replay receipt only", async () => {
    process.env.ADMIN_BOOTSTRAP_MODE = "enroll";
    process.env.ADMIN_BOOTSTRAP_ROLE = "support";
    db.enroll.mockResolvedValue({ principalId, replayed: true });
    await execute();
    expect(db.first).not.toHaveBeenCalled();
    expect(db.enroll).toHaveBeenCalledExactlyOnceWith(expect.anything(), dev.ADMIN_AUTH_PEPPER, {
      userId, operationId, activationToken: token, reasonCode: "verified_operator", role: "support",
    });
    expect(console.info).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ principalId, replayed: true }));
    expect(db.end).toHaveBeenCalledOnce();
  });

  it.each([
    { ADMIN_BOOTSTRAP_MODE: "unknown" },
    { ADMIN_BOOTSTRAP_ROLE: "support" },
    { ADMIN_BOOTSTRAP_ROLE: "owner" },
    { ADMIN_BOOTSTRAP_MODE: "enroll", ADMIN_BOOTSTRAP_ROLE: undefined },
    { ADMIN_BOOTSTRAP_MODE: "enroll", ADMIN_BOOTSTRAP_ROLE: "owner" },
    { ADMIN_BOOTSTRAP_REASON: undefined }, { ADMIN_BOOTSTRAP_REASON: "bad reason" },
    { ADMIN_BOOTSTRAP_OPERATION_ID: undefined }, { ADMIN_BOOTSTRAP_OPERATION_ID: "not-a-uuid" },
    { ADMIN_BOOTSTRAP_USER_ID: undefined }, { ADMIN_BOOTSTRAP_USER_ID: "nickname" },
    { ADMIN_BOOTSTRAP_ACTIVATION_TOKEN: undefined }, { ADMIN_BOOTSTRAP_ACTIVATION_TOKEN: "short" },
    { APP_ENV: "prod" }, { ADMIN_INTERNAL_ENABLED: "0" }, { ADMIN_DEV_ENABLED: "0" },
  ])("refuses invalid input/config before opening DB: %j", async (patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await refused();
  });

  it.each(["1", undefined])("preserves isolated local bootstrap gate: %s", async (flag) => {
    process.env = {
      NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: dev.DATABASE_URL,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18541", PUBLIC_WEB_ORIGIN: "http://127.0.0.1:18542",
      ADMIN_INTERNAL_ENABLED: "1", ADMIN_AUTH_PEPPER: dev.ADMIN_AUTH_PEPPER,
      ADMIN_BOOTSTRAP_USER_ID: userId, ADMIN_BOOTSTRAP_OPERATION_ID: operationId,
      ADMIN_BOOTSTRAP_ACTIVATION_TOKEN: token,
    };
    if (!flag) { await refused(); return; }
    process.env.ADMIN_BOOTSTRAP_SOURCE_TEST = flag;
    await execute();
    expect(db.first).toHaveBeenCalledExactlyOnceWith(expect.anything(), dev.ADMIN_AUTH_PEPPER, {
      userId, operationId, activationToken: token, reasonCode: "first_bootstrap", role: "superadmin",
    });
    expect(db.end).toHaveBeenCalledOnce();
  });

  it.each(["first", "enroll"])("suppresses credential-bearing %s errors and closes DB", async (mode) => {
    process.env.ADMIN_BOOTSTRAP_MODE = mode;
    process.env.ADMIN_BOOTSTRAP_ROLE = "superadmin";
    const failure = new Error(`driver failure containing ${token} ${dev.ADMIN_AUTH_PEPPER}`);
    (mode === "first" ? db.first : db.enroll).mockRejectedValue(failure);
    await execute();
    expect(process.exitCode).toBe(1);
    expect(console.info).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Admin bootstrap refused or failed; no credential output");
    expect(db.end).toHaveBeenCalledOnce();
  });
});
