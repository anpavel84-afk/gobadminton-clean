import { describe, expect, it } from "vitest";
import {
  MOSCOW_BUNDLE,
  SAINT_PETERSBURG_BUNDLE,
  allowedMapResource,
  cityLabelForBundle,
  mapBundleForCity,
  mapIdForBundle,
  pointInBundleBounds,
} from "./radar-map-assets";
import { REGIONAL_MAP_PACKS, regionalMapPackForCity } from "./regional-map-packs";

describe("regional fixed map packs", () => {
  it("pins exact metadata for all 11 packs and keeps Moscow/SPb byte pins", () => {
    expect(REGIONAL_MAP_PACKS).toHaveLength(11);
    expect(MOSCOW_BUNDLE.version).toBe("moscow-20261007-p4-098a869f-v001");
    expect(MOSCOW_BUNDLE.styleHash).toBe(
      "0ed88388e2cbc21b99425af5164430abda36b599c68f02623725779ec8ab731d",
    );
    expect(SAINT_PETERSBURG_BUNDLE.version).toBe("saint-petersburg-20261104-p4-b7d3b1a8-v001");
    expect(new Set(REGIONAL_MAP_PACKS.map((p) => p.cityId)).size).toBe(11);
    expect(new Set(REGIONAL_MAP_PACKS.map((p) => p.prefix)).size).toBe(11);
    for (const pack of REGIONAL_MAP_PACKS) {
      expect(mapBundleForCity(pack.cityId)).toBe(pack);
      expect(mapIdForBundle(pack)).toBe(pack.mapId);
      expect(cityLabelForBundle(pack)).toBe(pack.cityLabel);
      expect(pack.prefix.startsWith("https://dev.gobadminton.ru/map-assets/releases/")).toBe(true);
      expect(pack.styleHash).toMatch(/^[a-f0-9]{64}$/);
      expect(pack.defaultZoom).toBe(10.5);
      expect(pointInBundleBounds(pack.center[0], pack.center[1], pack)).toBe(true);
    }
    expect(mapBundleForCity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
    expect(regionalMapPackForCity(MOSCOW_BUNDLE.cityId)).toBeNull();
  });

  it("rejects cross-prefix resources and points outside pack bounds even inside a larger bbox story", () => {
    const a = REGIONAL_MAP_PACKS[0]!;
    const b = REGIONAL_MAP_PACKS[1]!;
    expect(allowedMapResource(`${a.prefix}style-dev.json`, a)).toBe(true);
    expect(allowedMapResource(`${b.prefix}style-dev.json`, a)).toBe(false);
    expect(allowedMapResource(`${a.prefix}style-dev.json?x=1`, a)).toBe(false);
    // Center of another city is outside this pack's maxBounds.
    expect(pointInBundleBounds(b.center[0], b.center[1], a)).toBe(false);
    // Far point still inside a naive enlarged bbox story must fail pack bounds.
    const [[west, south], [east, north]] = a.bounds;
    const outsideLat = north + (north - south);
    expect(pointInBundleBounds((west + east) / 2, outsideLat, a)).toBe(false);
  });

  it("preserves Moscow/SPb mapId helpers and city labels", () => {
    expect(mapIdForBundle(MOSCOW_BUNDLE)).toBe("moscow");
    expect(mapIdForBundle(SAINT_PETERSBURG_BUNDLE)).toBe("saint-petersburg");
    expect(cityLabelForBundle(MOSCOW_BUNDLE)).toBe("Москва");
    expect(cityLabelForBundle(SAINT_PETERSBURG_BUNDLE)).toBe("Санкт-Петербург");
  });
});
