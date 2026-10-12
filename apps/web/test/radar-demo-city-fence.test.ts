import { describe, expect, it, vi } from "vitest";
import { RadarController } from "../src/lib/radar-controller";
import type { apiFetch } from "../src/lib/api-client";

const me = { id: "demo", displayName: "Demo", csrfToken: "csrf", locale: "ru", linkedProviders: [] };
const syntheticOff = {
  state: "off" as const,
  ownerHere: true,
  policyVersion: "radar-mvp-v1",
  exposureMode: "synthetic_demo" as const,
};

describe("QRDA-F02 synthetic demo city fence", () => {
  it.each([
    {
      name: "profile fetch failure",
      profile: { ok: false as const, status: 503, problem: { code: "UNAVAILABLE" } },
    },
    {
      name: "missing city",
      profile: { ok: true as const, status: 200, data: { cityId: null } },
    },
    {
      name: "unsupported city",
      profile: {
        ok: true as const,
        status: 200,
        data: { cityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      },
    },
  ])("fail-closes $name without invoking acquisition / browser GPS path", async ({ profile }) => {
    const fetch = vi.fn(async (path: string) => {
      if (path === "/v1/me") return { ok: true, status: 200, data: me };
      if (path === "/v1/me/social-profile") return profile;
      if (path.endsWith("current")) return { ok: true, status: 200, data: syntheticOff };
      throw new Error(`unexpected path ${path}`);
    });
    const c = new RadarController(fetch as unknown as typeof apiFetch);
    await c.reconcile();
    expect(c.view.exposureMode).toBe("synthetic_demo");
    expect(c.view.demoCityId).toBeNull();
    expect(c.usesSyntheticLocation()).toBe(false);
    expect(c.view.phase).toBe("location_error");
    expect(c.view.notice).toContain("Браузерная геолокация не используется");

    const acquire = vi.fn(async () => {
      throw { code: 1 };
    });
    await c.activate(acquire);
    expect(acquire).not.toHaveBeenCalled();
    expect(c.view.phase).toBe("location_error");
  });

  it("admitted city still allows synthetic activation without browser GPS", async () => {
    const fetch = vi.fn(async (path: string) => {
      if (path === "/v1/me") return { ok: true, status: 200, data: me };
      if (path === "/v1/me/social-profile") {
        return {
          ok: true,
          status: 200,
          data: { cityId: "a0000000-0000-4000-8000-000000000001" },
        };
      }
      if (path === "/v1/me/radar/activations") {
        return {
          ok: true,
          status: 201,
          data: {
            state: "active",
            ownerHere: true,
            activationId: "act",
            version: 1,
            policyVersion: "radar-mvp-v1",
            regionId: "moscow-mvp",
            radiusBucketKm: 5,
            startedAt: "2030-01-01T00:00:00.000Z",
            expiresAt: "2030-01-01T00:15:00.000Z",
            hardExpiresAt: "2030-01-01T01:00:00.000Z",
            foregroundUntil: "2030-01-01T00:05:00.000Z",
            locationValidUntil: "2030-01-01T00:10:00.000Z",
            nextLocationUpdateAt: "2030-01-01T00:05:00.000Z",
            nextRadiusChangeAt: "2030-01-01T00:05:00.000Z",
            exposureMode: "synthetic_demo",
          },
        };
      }
      if (path.endsWith("nearby")) {
        return {
          ok: true,
          status: 200,
          data: {
            state: "results",
            policyVersion: "radar-mvp-v1",
            radiusBucketKm: 5,
            refreshAfterSeconds: 30,
            displayTtlSeconds: 45,
            items: [],
            exposureMode: "synthetic_demo",
          },
        };
      }
      return { ok: true, status: 200, data: syntheticOff };
    });
    const c = new RadarController(fetch as unknown as typeof apiFetch);
    await c.reconcile();
    expect(c.usesSyntheticLocation()).toBe(true);
    c.permission();
    expect(c.view.phase).toBe("permission");
    const acquire = vi.fn(async () => ({
      latitude: 55.7558,
      longitude: 37.6173,
      accuracyMeters: 25,
      capturedAt: "2030-01-01T00:00:00.000Z",
    }));
    await c.activate(acquire);
    expect(acquire).toHaveBeenCalledOnce();
    expect(c.view.phase).toBe("active");
  });
});
