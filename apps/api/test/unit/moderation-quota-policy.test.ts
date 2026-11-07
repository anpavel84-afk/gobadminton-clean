import { describe, expect, it, vi } from "vitest";
import {
  DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
  isDevModerationQuantityQuotaPauseActive,
  isExactTrustedDevModerationEnv,
  reserveModerationAttemptRow,
  type ModerationQuotaEnv,
} from "../../src/moderation/moderation-quota-policy";

const trustedDev: ModerationQuotaEnv = {
  NODE_ENV: "production",
  APP_ENV: "mvp",
  PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru",
  PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru",
};

describe("moderation DEV quantity-quota pause policy", () => {
  it.each(["mvp", "stage"] as const)("admits exact trusted DEV production runtime %s", (APP_ENV) => {
    expect(isExactTrustedDevModerationEnv({ ...trustedDev, APP_ENV })).toBe(true);
  });

  it.each([
    { APP_ENV: "prod" as const },
    { APP_ENV: "local" as const },
    { NODE_ENV: "test" as const },
    { NODE_ENV: "development" as const },
    { PUBLIC_WEB_ORIGIN: "https://gobadminton.ru" },
    { PUBLIC_API_ORIGIN: "https://gobadminton.ru" },
    { PUBLIC_API_ORIGIN: "https://api.gobadminton.ru" },
    { PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru/" },
    { PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru:443" },
    { PUBLIC_WEB_ORIGIN: "https://www.gobadminton.ru" },
    { PUBLIC_API_ORIGIN: "http://127.0.0.1:3000" },
  ])("fail-closed for non-DEV / inexact origin: %j", (patch) => {
    expect(isExactTrustedDevModerationEnv({ ...trustedDev, ...patch })).toBe(false);
  });

  it("never treats APP_ENV=dev as admission and ignores request-like Origin fields", () => {
    expect(
      isExactTrustedDevModerationEnv({
        ...trustedDev,
        APP_ENV: "dev" as ModerationQuotaEnv["APP_ENV"],
      }),
    ).toBe(false);
    // Policy reads only trusted PUBLIC_* server config — no request Origin argument exists.
    expect(isExactTrustedDevModerationEnv(trustedDev)).toBe(true);
  });

  it("activates before Owner deadline and deactivates at/after exact expiry", () => {
    const before = new Date("2026-12-31T23:59:59.999Z");
    const at = new Date("2027-01-01T00:00:00.000Z");
    const after = new Date("2027-01-01T00:00:00.001Z");
    expect(isDevModerationQuantityQuotaPauseActive(trustedDev, before)).toBe(true);
    expect(isDevModerationQuantityQuotaPauseActive({ ...trustedDev, APP_ENV: "stage" }, before)).toBe(
      true,
    );
    expect(isDevModerationQuantityQuotaPauseActive(trustedDev, at)).toBe(false);
    expect(isDevModerationQuantityQuotaPauseActive(trustedDev, after)).toBe(false);
    expect(DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("keeps PROD and local quantity caps even before January 2027", () => {
    const before = new Date("2026-11-08T00:00:00.000Z");
    expect(
      isDevModerationQuantityQuotaPauseActive(
        {
          NODE_ENV: "production",
          APP_ENV: "prod",
          PUBLIC_WEB_ORIGIN: "https://gobadminton.ru",
          PUBLIC_API_ORIGIN: "https://gobadminton.ru",
        },
        before,
      ),
    ).toBe(false);
    expect(
      isDevModerationQuantityQuotaPauseActive(
        {
          NODE_ENV: "test",
          APP_ENV: "local",
          PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
          PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
        },
        before,
      ),
    ).toBe(false);
    expect(
      isDevModerationQuantityQuotaPauseActive(
        {
          ...trustedDev,
          APP_ENV: "prod",
          PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru",
          PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru",
        },
        before,
      ),
    ).toBe(false);
  });

  it("reservation SQL groups quantity bypass separately from next_allowed_at", async () => {
    const seen: unknown[] = [];
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        seen.push({ sql, params });
        return { rowCount: 1, rows: [{ user_id: params[0] }] };
      }),
    };
    const pauseUntil = new Date("2027-01-01T00:00:00.000Z");
    expect(
      await reserveModerationAttemptRow(pool, "11111111-1111-1111-1111-111111111111", "text", {
        trustedDevEnv: true,
        pauseUntil,
      }),
    ).toBe(true);
    const call = seen[0] as { sql: string; params: unknown[] };
    expect(call.params).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "text",
      true,
      pauseUntil,
    ]);
    expect(call.sql).toMatch(/\$3::boolean AND now\(\) < \$4::timestamptz/);
    expect(call.sql).toMatch(/next_allowed_at IS NULL OR content_moderation_rate_budgets\.next_allowed_at <= now\(\)/);
    // Quantity OR-group must not wrap next_allowed_at.
    const whereIdx = call.sql.indexOf("WHERE");
    const nextIdx = call.sql.indexOf("next_allowed_at IS NULL");
    expect(whereIdx).toBeGreaterThan(-1);
    expect(nextIdx).toBeGreaterThan(whereIdx);
    const quantityBlock = call.sql.slice(whereIdx, nextIdx);
    expect(quantityBlock).toMatch(/count < 10/);
    expect(quantityBlock).toMatch(/day_count < 50/);
    expect(quantityBlock).not.toMatch(/next_allowed_at/);
  });
});
