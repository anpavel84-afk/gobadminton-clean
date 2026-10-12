import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  DEMO_MOSCOW_CITY_ID,
  DEMO_SPB_CITY_ID,
  demoUserId,
} from "../../src/database/demo-ids";
import { loadEnv } from "../../src/config/env";
import {
  admittedDemoCityIds,
  ordinalFromDemoUserId,
  regionForDemoCity,
  syntheticDemoFix,
} from "../../src/radar/radar-demo";
import { RadarFeatureService } from "../../src/radar/radar-feature";
import { RADAR_REGION_ID, RADAR_REGION_SPB_ID } from "../../src/radar/constants";

function problemCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse() as { code?: string };
  return body.code;
}

describe("radar demo helpers", () => {
  it("admits only Moscow and SPB city scope", () => {
    expect(admittedDemoCityIds()).toEqual([
      DEMO_MOSCOW_CITY_ID,
      DEMO_SPB_CITY_ID,
    ]);
    expect(regionForDemoCity(DEMO_MOSCOW_CITY_ID).regionId).toBe(RADAR_REGION_ID);
    expect(regionForDemoCity(DEMO_SPB_CITY_ID).regionId).toBe(RADAR_REGION_SPB_ID);
    const moscow = syntheticDemoFix(DEMO_MOSCOW_CITY_ID, 1);
    const spb = syntheticDemoFix(DEMO_SPB_CITY_ID, 11);
    expect(moscow.latitude).toBeGreaterThan(54);
    expect(moscow.latitude).toBeLessThan(57);
    expect(spb.latitude).toBeGreaterThan(59);
    expect(spb.longitude).toBeLessThan(31);
    expect(ordinalFromDemoUserId(demoUserId(3))).toBe(3);
  });
});

describe("RadarFeatureService access fence", () => {
  function feature(raw: Record<string, string>) {
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: "postgres://gobadminton:gobadminton@127.0.0.1:5432/gobadminton",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      ...raw,
    });
    return new RadarFeatureService(env);
  }

  it("keeps both flags fail-closed by default", () => {
    const f = feature({});
    expect(f.liveEnabled).toBe(false);
    expect(f.demoEnabled).toBe(false);
    try {
      f.assertAccess(demoUserId(1));
      throw new Error("expected assertAccess to throw");
    } catch (error) {
      expect(problemCode(error)).toBe("SOCIAL_RADAR_DISABLED");
    }
  });

  it("demo-only admits deterministic demo identities and denies others", () => {
    const f = feature({ SOCIAL_RADAR_DEMO_ENABLED: "1" });
    expect(f.assertAccess(demoUserId(1))).toBe("synthetic_demo");
    try {
      f.assertAccess("11111111-1111-4111-8111-111111111111");
      throw new Error("expected assertAccess to throw");
    } catch (error) {
      expect(problemCode(error)).toBe("SOCIAL_RADAR_DISABLED");
    }
  });

  it("live-only never promotes a demo identity to live", () => {
    const f = feature({ SOCIAL_RADAR_ENABLED: "1" });
    expect(f.assertAccess("11111111-1111-4111-8111-111111111111")).toBe("live");
    expect(() => f.assertAccess(demoUserId(2))).toThrow();
  });

  it("both flags preserve separate live and synthetic paths", () => {
    const f = feature({
      SOCIAL_RADAR_ENABLED: "1",
      SOCIAL_RADAR_DEMO_ENABLED: "1",
    });
    expect(f.assertAccess("11111111-1111-4111-8111-111111111111")).toBe("live");
    expect(f.assertAccess(demoUserId(2))).toBe("synthetic_demo");
  });
});
