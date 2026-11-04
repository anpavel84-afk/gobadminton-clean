import { describe, expect, it } from "vitest";
import { hasPermission } from "../../src/admin/rbac";
import {
  PILOT_DEFAULT_WINDOW_DAYS,
  PILOT_FORMULAS_RU,
  PILOT_MAX_WINDOW_DAYS,
  assertNoPiiKeys,
  rateOrNull,
} from "../../src/admin/pilot-metrics.policy";
import {
  pilotMetricsQueryInputSchema,
  resolvePilotMetricsQuery,
} from "../../src/admin/pilot-metrics.query";
import { parse } from "../../src/admin/dto";

describe("admin pilot metrics unit", () => {
  it("grants pilot.read only to superadmin", () => {
    expect(hasPermission(["superadmin"], "pilot.read")).toBe(true);
    for (const role of ["content_manager", "moderator", "support"] as const) {
      expect(hasPermission([role], "pilot.read")).toBe(false);
    }
  });

  it("defaults to last 30 days and rejects inverted or >365d windows", () => {
    expect(PILOT_DEFAULT_WINDOW_DAYS).toBe(30);
    expect(PILOT_MAX_WINDOW_DAYS).toBe(365);
    const cityId = "a0000000-0000-4000-8000-000000000001";
    const resolved = resolvePilotMetricsQuery(
      parse(pilotMetricsQueryInputSchema, { cityId }),
    );
    expect(resolved.cityId).toBe(cityId);
    expect(resolved.to.getTime() - resolved.from.getTime()).toBe(
      PILOT_DEFAULT_WINDOW_DAYS * 86_400_000,
    );
    expect(resolvePilotMetricsQuery(parse(pilotMetricsQueryInputSchema, {})).cityId).toBeNull();
    expect(() =>
      resolvePilotMetricsQuery(
        parse(pilotMetricsQueryInputSchema, {
          cityId,
          from: "2026-11-04T00:00:00.000Z",
          to: "2026-11-03T00:00:00.000Z",
        }),
      ),
    ).toThrow();
    expect(() =>
      resolvePilotMetricsQuery(
        parse(pilotMetricsQueryInputSchema, {
          cityId,
          from: "2025-01-01T00:00:00.000Z",
          to: "2026-12-01T00:00:00.000Z",
        }),
      ),
    ).toThrow();
  });

  it("keeps Russian formulas and null rates for zero denominators", () => {
    expect(PILOT_FORMULAS_RU.confirmationRate).toMatch(/null/i);
    expect(PILOT_FORMULAS_RU.heldRate).toMatch(/held/);
    expect(PILOT_FORMULAS_RU.repeatAttendance).toMatch(/≥2|>=2/);
    expect(rateOrNull(2, 0)).toBeNull();
    expect(rateOrNull(1, 4)).toBe(0.25);
  });

  it("flags aggregate keys that look like PII or row identifiers", () => {
    expect(
      assertNoPiiKeys({
        city: { id: "x", nameRu: "Москва" },
        applications: { count: 1 },
      }),
    ).toEqual([]);
    expect(assertNoPiiKeys({ email: "a@b.c", userId: "u" }).length).toBeGreaterThan(0);
  });
});
