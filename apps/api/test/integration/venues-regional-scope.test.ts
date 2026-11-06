import { describe, expect, it } from "vitest";
import { REGIONAL_CITY_RADIUS_METERS, regionalCityCenter } from "../../src/venues/venues.service";

/**
 * Disposable PostGIS boundary checks for the 11 regional cities are owned by the
 * trusted parent worktree. This file keeps the admitted integration path and the
 * immutable radius contract visible without claiming a live DB run here.
 */
describe("venues regional scope (parent PostGIS)", () => {
  it("keeps the admitted 11-city / 40 km contract for parent SQL verification", () => {
    expect(REGIONAL_CITY_RADIUS_METERS).toBe(40000);
    expect(regionalCityCenter("1775016f-373e-5a15-958b-1305770b2b16")).toEqual({
      lon: 82.9226887,
      lat: 55.0288307,
    });
    expect(regionalCityCenter("a0000000-0000-4000-8000-000000000001")).toBeNull();
  });
});
