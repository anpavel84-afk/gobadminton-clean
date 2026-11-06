import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CityHintController } from "../../src/discovery/city-hint.controller";
import { DISCOVERY_CITY_IDS, validateDiscoveryPreference } from "../../src/profiles/discovery-preferences.service";

const CONTRACTS = path.resolve(__dirname, "../../../../packages/contracts/src/regional-cities.ts");
const MOSCOW = "a0000000-0000-4000-8000-000000000001";
const PETERSBURG = "a0000000-0000-4000-8000-000000000002";
const NOVOSIBIRSK = "1775016f-373e-5a15-958b-1305770b2b16";

describe("discovery preference boundary", () => {
  it("accepts exactly the 13 approved cities and integer versions with regional parity", () => {
    const source = readFileSync(CONTRACTS, "utf8");
    const regionalIds = [...source.matchAll(/id: "([0-9a-f-]{36})"/g)].map((m) => m[1]!);
    expect(regionalIds).toHaveLength(11);
    expect(DISCOVERY_CITY_IDS).toHaveLength(13);
    expect(DISCOVERY_CITY_IDS.slice(0, 2)).toEqual([MOSCOW, PETERSBURG]);
    expect(DISCOVERY_CITY_IDS.slice(2)).toEqual(regionalIds);
    for (const cityId of DISCOVERY_CITY_IDS) {
      for (const expectedVersion of [0, 1, 2147483647]) {
        expect(validateDiscoveryPreference({ cityId, expectedVersion })).toEqual({ cityId, expectedVersion });
      }
    }
  });
  it.each([null, [], "city", {}, { cityId: null, expectedVersion: 0 },
    { cityId: "a0000000-0000-4000-8000-000000000003", expectedVersion: 0 },
    { cityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expectedVersion: 0 },
    { cityId: DISCOVERY_CITY_IDS[0] },
    ...[-1, 0.1, "0", null, NaN, Infinity, 2147483648].map(expectedVersion => ({ cityId: DISCOVERY_CITY_IDS[0], expectedVersion })),
    { cityId: DISCOVERY_CITY_IDS[0], expectedVersion: 0, userId: "another-user" },
  ])("rejects invalid city/version/shape: %j", input => {
    expect(() => validateDiscoveryPreference(input)).toThrow();
  });
  it("returns a fresh safe Moscow hint without receiving request data or touching persistence", () => {
    const controller = new CityHintController();
    expect(controller.getCityHint()).toEqual({ cityId: MOSCOW, source: "default" });
    expect(controller.getCityHint()).not.toBe(controller.getCityHint());
    expect(DISCOVERY_CITY_IDS).toContain(NOVOSIBIRSK);
    expect(DISCOVERY_CITY_IDS).toContain(PETERSBURG);
  });
});
