import { describe, it, expect } from "vitest";
import {
  distanceEstimate,
  publicGeo,
  sealUnified,
  openUnified,
  cursorSchema,
  type UnifiedPoint,
} from "../../src/radar/unified-contract";
import { loadEnv } from "../../src/config/env";
const fine: UnifiedPoint = {
  latitude: 55.75,
  longitude: 37.61,
  grid: 100,
  model: "regional_grid_100m_v1",
  accuracy: 10,
  capturedAt: Date.parse("2026-10-08T12:00:01Z"),
};
const coarse: UnifiedPoint = {
  ...fine,
  grid: 1000,
  model: "regional_grid_1000m_v1",
  accuracy: 1000,
};
describe("Unified distance uncertainty and opaque purpose tokens", () => {
  it("rounds refined420m to400m with200m uncertainty", () => {
    expect(distanceEstimate(420, fine, fine)).toMatchObject({
      kind: "estimate",
      roundedMeters: 400,
      roundingStepMeters: 100,
      uncertaintyMeters: 200,
      lowerMeters: null,
      upperMeters: null,
    });
  });
  it("refined1800m preserves meaningful1.8km", () => {
    expect(
      distanceEstimate(
        1800,
        { ...fine, accuracy: 20 },
        { ...fine, accuracy: 20 },
      ),
    ).toMatchObject({ roundedMeters: 1800, uncertaintyMeters: 200 });
  });
  it("mixed source1800m gives range up to4km", () => {
    expect(
      distanceEstimate(1800, { ...fine, accuracy: 20 }, coarse),
    ).toMatchObject({
      kind: "range",
      roundedMeters: null,
      upperMeters: 4000,
      roundingStepMeters: 1000,
    });
  });
  it("same coarse center never returns0m", () => {
    expect(distanceEstimate(0, coarse, coarse)).toMatchObject({
      kind: "range",
      roundedMeters: null,
      upperMeters: 4000,
      uncertaintyMeters: 4000,
    });
  });
  it("coarse5200m rounds to5km", () => {
    expect(distanceEstimate(5200, coarse, coarse)).toMatchObject({
      kind: "estimate",
      roundedMeters: 5000,
      uncertaintyMeters: 4000,
    });
  });
  it("half-up/near-zero boundaries are deterministic", () => {
    expect(distanceEstimate(450, fine, fine).roundedMeters).toBe(500);
    expect(distanceEstimate(0, fine, fine).kind).toBe("range");
    expect(distanceEstimate(201, fine, fine).kind).toBe("estimate");
  });
  it("does not expose exact capture/accuracy and clamps tolerated future age", () => {
    expect(publicGeo(fine, Date.parse("2026-10-08T12:00:32Z"))).toMatchObject({
      sourceTimestampBucket: "2026-10-08T12:00:00.000Z",
      sourceAgeSeconds: 60,
      uncertaintyMeters: 100,
    });
    expect(publicGeo(fine, fine.capturedAt - 20000).sourceAgeSeconds).toBe(0);
    expect(publicGeo(fine, fine.capturedAt)).not.toHaveProperty("accuracy");
  });
  it("rejects cross-purpose, tampering and restore epochs", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://fictional@127.0.0.1/test",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET:
        "synthetic-unified-moderation-test-secret-only",
    });
    const p = {
      contextId: "00000000-0000-4000-8000-000000000001",
      group: 0,
      distance: 420,
      name: "player",
      publicId: "00000000-0000-4000-8000-000000000002",
      rank: 1,
    };
    const t = sealUnified(env, "list", p);
    expect(openUnified(env, "list", t, cursorSchema)).toEqual(p);
    expect(t).not.toContain("player");
    expect(openUnified(env, "map", t, cursorSchema)).toBeNull();
    expect(
      openUnified(
        { ...env, RADAR_GEOGRAPHIC_TOKEN_EPOCH: "rotated" },
        "list",
        t,
        cursorSchema,
      ),
    ).toBeNull();
    expect(
      openUnified(env, "list", t.slice(0, -1) + "!", cursorSchema),
    ).toBeNull();
  });
});
