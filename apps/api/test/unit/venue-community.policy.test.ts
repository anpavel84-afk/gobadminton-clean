import { describe, expect, it } from "vitest";
import {
  availableSummary,
  emptySummary,
  parseCommunity,
  parseVenueIdList,
  roundCommunityAverage,
  unavailableSummary,
  upsertCommunityRatingRequest,
} from "../../src/venues/venue-community.policy";

describe("#507 I1 venue-community.policy", () => {
  it("rounds average to one decimal without inventing zeros", () => {
    expect(roundCommunityAverage(21, 5)).toBe(4.2);
    expect(roundCommunityAverage(0, 0)).toBeNull();
    expect(emptySummary("v", "c")).toEqual({
      venueId: "v",
      canonicalVenueId: "c",
      average: null,
      count: 0,
      state: "empty",
    });
    expect(unavailableSummary("v", null).count).toBeNull();
    expect(unavailableSummary("v", null).average).toBeNull();
    expect(availableSummary("v", "c", 9, 2).average).toBe(4.5);
  });

  it("validates integer 1–5 and batch id limits", () => {
    expect(() => parseCommunity(upsertCommunityRatingRequest, { value: 0, expectedVersion: 0 }))
      .toThrow();
    expect(() => parseCommunity(upsertCommunityRatingRequest, { value: 3.5, expectedVersion: 0 }))
      .toThrow();
    const ok = parseCommunity(upsertCommunityRatingRequest, { value: 4, expectedVersion: 0 });
    expect(ok.value).toBe(4);
    const ids = Array.from({ length: 201 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(() => parseVenueIdList(ids.join(","))).toThrow();
    expect(parseVenueIdList(`${ids[0]},${ids[0]},${ids[1]}`)).toEqual([ids[0], ids[1]]);
  });
});
