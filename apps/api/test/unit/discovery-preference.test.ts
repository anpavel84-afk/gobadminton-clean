import { describe, expect, it } from "vitest";
import { CityHintController } from "../../src/discovery/city-hint.controller";
import { DISCOVERY_CITY_IDS, validateDiscoveryPreference } from "../../src/profiles/discovery-preferences.service";

describe("discovery preference boundary", () => {
  it("accepts exactly the two canonical regions and integer versions", () => {
    for (const cityId of DISCOVERY_CITY_IDS) {
      for (const expectedVersion of [0, 1, 2147483647]) {
        expect(validateDiscoveryPreference({ cityId, expectedVersion })).toEqual({ cityId, expectedVersion });
      }
    }
  });
  it.each([null, [], "city", {}, { cityId: null, expectedVersion: 0 },
    { cityId: "a0000000-0000-4000-8000-000000000003", expectedVersion: 0 },
    { cityId: DISCOVERY_CITY_IDS[0] },
    ...[-1, 0.1, "0", null, NaN, Infinity, 2147483648].map(expectedVersion => ({ cityId: DISCOVERY_CITY_IDS[0], expectedVersion })),
    { cityId: DISCOVERY_CITY_IDS[0], expectedVersion: 0, userId: "another-user" },
  ])("rejects invalid city/version/shape: %j", input => {
    expect(() => validateDiscoveryPreference(input)).toThrow();
  });
  it("returns a fresh safe hint without receiving request data or touching persistence", () => {
    const controller = new CityHintController();
    expect(controller.getCityHint()).toEqual({ cityId: DISCOVERY_CITY_IDS[0], source: "default" });
    expect(controller.getCityHint()).not.toBe(controller.getCityHint());
  });
});
