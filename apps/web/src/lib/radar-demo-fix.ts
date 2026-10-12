import type { RadarFix } from "./radar-types";

/** Admitted demo catalog cities (must match API demo-ids). */
export const DEMO_MOSCOW_CITY_ID = "a0000000-0000-4000-8000-000000000001";
export const DEMO_SPB_CITY_ID = "a0000000-0000-4000-8000-000000000002";

const ANCHORS: Record<string, { latitude: number; longitude: number }> = {
  [DEMO_MOSCOW_CITY_ID]: { latitude: 55.7558, longitude: 37.6173 },
  [DEMO_SPB_CITY_ID]: { latitude: 59.9343, longitude: 30.3351 },
};

/** City-scoped synthetic fix — never calls browser geolocation. */
export function syntheticDemoFix(cityId: string, now = Date.now()): RadarFix {
  const anchor = ANCHORS[cityId];
  if (!anchor) {
    throw Object.assign(new Error("demo city unsupported"), { code: 2 });
  }
  return {
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    accuracyMeters: 25,
    capturedAt: new Date(now).toISOString(),
  };
}

export function isAdmittedDemoCity(cityId: string | null | undefined): cityId is string {
  return Boolean(cityId && ANCHORS[cityId]);
}
