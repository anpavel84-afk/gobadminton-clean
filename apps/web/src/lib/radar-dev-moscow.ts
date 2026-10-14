import type { RadarConfig } from "./unified-directory";
import type { RadarFix } from "./radar-types";
export const DEV_MOSCOW_LABEL = "DEV · тестовая геолокация: Москва";
/** Only the private authenticated config advertises this; no owner UUID in client code. */
export function usesDevMoscowLocation(config: RadarConfig | null, origin: string): boolean {
  const p = config?.devMoscowTest;
  return origin === "https://dev.gobadminton.ru" && config?.exposureMode === "live" &&
    p?.latitude === 55.7558 && p.longitude === 37.6173 && p.accuracyMeters === 25;
}
export function devMoscowFix(config: RadarConfig | null, origin: string, now = Date.now()): RadarFix | null {
  return usesDevMoscowLocation(config, origin) ? { latitude: 55.7558, longitude: 37.6173, accuracyMeters: 25, capturedAt: new Date(now).toISOString() } : null;
}
