import { describe, expect, it } from "vitest";
import { mapBundleForCity, mapIdForBundle, MOSCOW_BUNDLE, SAINT_PETERSBURG_BUNDLE } from "./radar-map-assets";
import { REGIONAL_MAP_PACKS } from "./regional-map-packs";

/** Smoke coverage for the closed mapBundleForCity surface used by GamesVenueMap. */
describe("radar-map-assets regional extension", () => {
  it("resolves Moscow, SPb and all 11 regional packs only", () => {
    expect(mapBundleForCity(MOSCOW_BUNDLE.cityId)).toBe(MOSCOW_BUNDLE);
    expect(mapBundleForCity(SAINT_PETERSBURG_BUNDLE.cityId)).toBe(SAINT_PETERSBURG_BUNDLE);
    for (const pack of REGIONAL_MAP_PACKS) {
      expect(mapBundleForCity(pack.cityId)).toEqual(pack);
      expect(mapIdForBundle(pack)).toBe(pack.mapId);
    }
    expect(mapBundleForCity(null)).toBeNull();
    expect(mapBundleForCity("not-a-city")).toBeNull();
  });
});
