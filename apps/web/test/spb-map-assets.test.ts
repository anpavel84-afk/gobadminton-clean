import { describe, expect, it } from "vitest";
import type { UnifiedSnapshot } from "@gobadminton/contracts";
import {
  MOSCOW_BUNDLE,
  SAINT_PETERSBURG_BUNDLE,
  REGIONAL_MAP_PACKS,
  allowedMapResource,
  candidateMapAllowed,
  candidateMapConfigAllowed,
  cityLabelForBundle,
  mapBundleForCity,
  mapIdForBundle,
  pointInBundleBounds,
  DEV_APP_ORIGIN,
  PROD_APP_ORIGIN,
} from "../src/lib/radar-map-assets";
import type { RadarConfig } from "../src/lib/unified-directory";

const moscowSnapshot = {
  exposureMode: "synthetic_demo",
  cityId: MOSCOW_BUNDLE.cityId,
  map: { availability: "dev_preview", mapId: "moscow", version: MOSCOW_BUNDLE.version },
} as UnifiedSnapshot;

const spbSnapshot = {
  exposureMode: "authenticated_live",
  cityId: SAINT_PETERSBURG_BUNDLE.cityId,
  map: {
    availability: "dev_preview",
    mapId: "saint-petersburg",
    version: SAINT_PETERSBURG_BUNDLE.version,
  },
} as UnifiedSnapshot;

describe("closed Moscow + Saint Petersburg map packs", () => {
  it("keeps Moscow bundle literals unchanged and adds a distinct SPb pack", () => {
    expect(MOSCOW_BUNDLE.version).toBe("moscow-20261007-p4-098a869f-v001");
    expect(MOSCOW_BUNDLE.styleHash).toBe(
      "0ed88388e2cbc21b99425af5164430abda36b599c68f02623725779ec8ab731d",
    );
    expect(MOSCOW_BUNDLE.center).toEqual([37.6176, 55.7517]);
    expect(SAINT_PETERSBURG_BUNDLE.version).toBe("saint-petersburg-20261104-p4-b7d3b1a8-v001");
    expect(SAINT_PETERSBURG_BUNDLE.cityId).toBe("a0000000-0000-4000-8000-000000000002");
    expect(SAINT_PETERSBURG_BUNDLE.styleHash).toBe(
      "d87e1b4a28944babc70133ce9bb89dce2ccbd6ac7d5594f4691c79ccf54cb6ea",
    );
    expect(SAINT_PETERSBURG_BUNDLE.center).toEqual([30.3158, 59.9391]);
    expect(SAINT_PETERSBURG_BUNDLE.prefix).not.toBe(MOSCOW_BUNDLE.prefix);
    expect(mapBundleForCity(MOSCOW_BUNDLE.cityId)).toBe(MOSCOW_BUNDLE);
    expect(mapBundleForCity(SAINT_PETERSBURG_BUNDLE.cityId)).toBe(SAINT_PETERSBURG_BUNDLE);
    expect(mapBundleForCity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
    expect(mapIdForBundle(MOSCOW_BUNDLE)).toBe("moscow");
    expect(mapIdForBundle(SAINT_PETERSBURG_BUNDLE)).toBe("saint-petersburg");
  });

  it("fences resources to the selected pack and never accepts the other city prefix", () => {
    expect(allowedMapResource(`${SAINT_PETERSBURG_BUNDLE.prefix}style-dev.json`, SAINT_PETERSBURG_BUNDLE)).toBe(true);
    expect(allowedMapResource(`pmtiles://${SAINT_PETERSBURG_BUNDLE.prefix}saint-petersburg.pmtiles`, SAINT_PETERSBURG_BUNDLE)).toBe(true);
    expect(allowedMapResource(`${MOSCOW_BUNDLE.prefix}style-dev.json`, SAINT_PETERSBURG_BUNDLE)).toBe(false);
    expect(allowedMapResource(`${SAINT_PETERSBURG_BUNDLE.prefix}style-dev.json`, MOSCOW_BUNDLE)).toBe(false);
    expect(allowedMapResource(`${SAINT_PETERSBURG_BUNDLE.prefix}style-dev.json?token=x`, SAINT_PETERSBURG_BUNDLE)).toBe(false);
    expect(allowedMapResource(`${SAINT_PETERSBURG_BUNDLE.prefix}../other/style.json`, SAINT_PETERSBURG_BUNDLE)).toBe(false);
  });

  it("admits candidate maps only when cityId, mapId and version match the same pack", () => {
    expect(candidateMapAllowed(moscowSnapshot, DEV_APP_ORIGIN)).toBe(true);
    expect(candidateMapAllowed(spbSnapshot, PROD_APP_ORIGIN)).toBe(true);
    expect(candidateMapAllowed({
      ...spbSnapshot,
      map: { availability: "dev_preview", mapId: "moscow", version: MOSCOW_BUNDLE.version },
    } as UnifiedSnapshot, DEV_APP_ORIGIN)).toBe(false);
    expect(candidateMapAllowed({
      ...moscowSnapshot,
      cityId: SAINT_PETERSBURG_BUNDLE.cityId,
    } as UnifiedSnapshot, DEV_APP_ORIGIN)).toBe(false);
    expect(candidateMapAllowed({
      ...spbSnapshot,
      cityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    } as UnifiedSnapshot, DEV_APP_ORIGIN)).toBe(false);
  });

  it("config gates keep Moscow and SPb separate and reject unknown cities", () => {
    const config = {
      exposureMode: "live",
      unifiedDirectory: { enabled: true },
      cities: [
        { cityId: MOSCOW_BUNDLE.cityId, regionId: "moscow", map: { availability: "dev_preview", mapId: "moscow", version: MOSCOW_BUNDLE.version } },
        { cityId: SAINT_PETERSBURG_BUNDLE.cityId, regionId: "spb", map: { availability: "dev_preview", mapId: "saint-petersburg", version: SAINT_PETERSBURG_BUNDLE.version } },
      ],
    } as RadarConfig;
    expect(candidateMapConfigAllowed(config, MOSCOW_BUNDLE.cityId, DEV_APP_ORIGIN)).toBe(true);
    expect(candidateMapConfigAllowed(config, SAINT_PETERSBURG_BUNDLE.cityId, DEV_APP_ORIGIN)).toBe(true);
    expect(candidateMapConfigAllowed(config, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", DEV_APP_ORIGIN)).toBe(false);
    expect(candidateMapConfigAllowed({
      ...config,
      cities: [{ cityId: SAINT_PETERSBURG_BUNDLE.cityId, regionId: "spb", map: { availability: "missing", mapId: null, version: null } }],
    }, SAINT_PETERSBURG_BUNDLE.cityId, DEV_APP_ORIGIN)).toBe(false);
  });

  it("bounds accept SPb venue coords and reject Moscow center for the SPb pack", () => {
    expect(pointInBundleBounds(30.3158, 59.9391, SAINT_PETERSBURG_BUNDLE)).toBe(true);
    expect(pointInBundleBounds(30.64917, 60.038277, SAINT_PETERSBURG_BUNDLE)).toBe(true);
    expect(pointInBundleBounds(37.6176, 55.7517, SAINT_PETERSBURG_BUNDLE)).toBe(false);
    expect(pointInBundleBounds(37.6176, 55.7517, MOSCOW_BUNDLE)).toBe(true);
    expect(pointInBundleBounds(30.3158, 59.9391, MOSCOW_BUNDLE)).toBe(false);
  });
});

describe("eleven regional fixed map packs (#485)", () => {
  it("pins exact metadata for all 11 packs without changing Moscow/SPb literals", () => {
    expect(REGIONAL_MAP_PACKS).toHaveLength(11);
    expect(MOSCOW_BUNDLE.version).toBe("moscow-20261007-p4-098a869f-v001");
    expect(SAINT_PETERSBURG_BUNDLE.version).toBe("saint-petersburg-20261104-p4-b7d3b1a8-v001");
    expect(new Set(REGIONAL_MAP_PACKS.map((p) => p.cityId)).size).toBe(11);
    for (const pack of REGIONAL_MAP_PACKS) {
      expect(mapBundleForCity(pack.cityId)).toEqual(pack);
      expect(mapIdForBundle(pack)).toBe(pack.mapId);
      expect(cityLabelForBundle(pack)).toBe(pack.cityLabel);
      expect(cityLabelForBundle(pack)).not.toBe("Москва");
      expect(allowedMapResource(`${pack.prefix}style-dev.json`, pack)).toBe(true);
      expect(pointInBundleBounds(pack.center[0], pack.center[1], pack)).toBe(true);
      const [[, south], [, north]] = pack.bounds;
      expect(pointInBundleBounds(pack.center[0], north + (north - south), pack)).toBe(false);
    }
    const a = REGIONAL_MAP_PACKS[0]!;
    const b = REGIONAL_MAP_PACKS[1]!;
    expect(allowedMapResource(`${b.prefix}style-dev.json`, a)).toBe(false);
    expect(mapBundleForCity("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
  });
});
