import { describe, expect, it } from "vitest";
import type { UnifiedSnapshot } from "@gobadminton/contracts";
import {
  MOSCOW_BUNDLE, MOSCOW_DEV_BUNDLE, allowedMapResource,
  candidateMapAllowed, mapBundleForHost, publicDevMapAllowed,
} from "../src/lib/radar-map-assets";

const snapshot = (cityId: string, exposureMode: "live" | "synthetic_demo") =>
  ({ cityId, exposureMode }) as unknown as UnifiedSnapshot;

describe("Germany DEV Radar basemap admission", () => {
  it("allows only the exact DEV host and Moscow, even before player opt-in", () => {
    expect(publicDevMapAllowed("dev.gobadminton.ru", MOSCOW_BUNDLE.cityId)).toBe(true);
    expect(publicDevMapAllowed("dev.gobadminton.ru", null)).toBe(true);
    expect(publicDevMapAllowed("dev.gobadminton.ru", "other-city")).toBe(false);
    expect(publicDevMapAllowed("gobadminton.ru", MOSCOW_BUNDLE.cityId)).toBe(false);
    expect(publicDevMapAllowed("dev.gobadminton.ru.evil", MOSCOW_BUNDLE.cityId)).toBe(false);
    expect(candidateMapAllowed(snapshot(MOSCOW_BUNDLE.cityId, "live"), "dev.gobadminton.ru")).toBe(true);
    expect(candidateMapAllowed(snapshot(MOSCOW_BUNDLE.cityId, "live"), "gobadminton.ru")).toBe(false);
    expect(candidateMapAllowed(snapshot(MOSCOW_BUNDLE.cityId, "live"), "localhost", MOSCOW_BUNDLE.version)).toBe(false);
    expect(candidateMapAllowed(snapshot(MOSCOW_BUNDLE.cityId, "synthetic_demo"), "localhost", MOSCOW_BUNDLE.version)).toBe(true);
  });

  it("pins the German style checksum and rejects cross-origin tiles", () => {
    const bundle = mapBundleForHost("dev.gobadminton.ru");
    expect(bundle).toEqual(MOSCOW_DEV_BUNDLE);
    expect(MOSCOW_DEV_BUNDLE.styleHash).toHaveLength(64);
    expect(allowedMapResource(MOSCOW_DEV_BUNDLE.prefix + "moscow.pmtiles", bundle)).toBe(true);
    expect(allowedMapResource("pmtiles://" + MOSCOW_DEV_BUNDLE.prefix + "moscow.pmtiles", bundle)).toBe(true);
    expect(allowedMapResource(MOSCOW_BUNDLE.prefix + "moscow.pmtiles", bundle)).toBe(false);
    expect(allowedMapResource("https://evil.example/maps", bundle)).toBe(false);
    expect(allowedMapResource(MOSCOW_DEV_BUNDLE.prefix + "moscow.pmtiles?token=unsafe", bundle)).toBe(false);
  });
});
