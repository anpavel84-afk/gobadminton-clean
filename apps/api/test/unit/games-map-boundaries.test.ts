import { describe, expect, it } from "vitest";
import { normalizeDiscovery } from "../../src/games/games-discovery.query";
import { parseMapQuery } from "../../src/games/games-map.query";
import { serializeMap } from "../../src/games/games-map.read";

const id = "a0000000-0000-4000-8000-000000000001";
const filter = normalizeDiscovery({ cityId: id, temporalScope: "upcoming" });
function row(): Parameters<typeof serializeMap>[0] {
  return {
    generated_at: new Date("2026-10-07T19:00:00Z"), earliest_start: new Date("2099-01-01Z"),
    matching_games: 1, mappable_games: 1, unmapped_games: 0, venues: 1, integrity_failure: false, warnings: [],
    items: [{ venue: { id, cityId: id, name: "Synthetic", address: "Synthetic", timezone: "UTC", latitude: 0, longitude: 0, lifecycleState: "unverified" },
      matchingGameCount: 1, nextGameAt: "2099-01-01T00:00:00Z", hasMoreGames: false,
      games: [{ id, version: 1, title: "Synthetic", startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-01T01:00:00Z", timezone: "UTC", activityKind: "regular", capacity: 8, externalReservedCount: 2, confirmedCount: 2 }],
    }],
  };
}
describe("GMap wire/payload boundary guards", () => {
  it("measures encoded UTF-8 bytes and rejects oversized reader output before any partial successful body", () => {
    // Valid DB string bounds cannot reach 2MiB at 200/600 output objects.
    // Inject oversized reader data specifically to exercise the mandatory last guard.
    const large = row(); large.items[0]!.venue.address = "😀".repeat(530000);
    expect(() => serializeMap(large, filter)).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: "GAME_MAP_QUERY_TOO_BROAD" }) }));
    const valid = serializeMap(row(), filter); expect(valid.items[0]!.games[0]!.availablePlaces).toBe(4);
    expect(valid.items[0]!.games[0]).not.toHaveProperty("confirmedCount");
  });
  it("uses the canonical OpenAPI response schema for safe internal integrity errors", () => {
    const invalid = row(); invalid.items[0]!.games[0]!.version = 0;
    expect(() => serializeMap(invalid, filter)).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: "GAME_MAP_TEMPORARILY_UNAVAILABLE" }) }));
    const invalidName = row(); invalidName.items[0]!.venue.name = "x".repeat(161);
    expect(() => serializeMap(invalidName, filter)).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: "GAME_MAP_TEMPORARILY_UNAVAILABLE" }) }));
  });
  it("strict map parser rejects absent scope, scalars/offsets/calendar errors while legacy time parsing remains compatible", () => {
    for (const suffix of ["", "&temporalScope=all", "&temporalScope=upcoming&startsBefore=2099-01-01", "&temporalScope=upcoming&startsFrom=2099-02-30T00:00:00Z", "&temporalScope=upcoming&startsFrom=2099-01-01T24:00:00Z", "&temporalScope=upcoming&startsFrom=2099-01-01T01:00:00+25:00", "&temporalScope=upcoming&levelScaleId=foo?bar&cursor=hidden", "&temporalScope=upcoming&cityId=" + id]) {
      expect(() => parseMapQuery(`/v1/games/map?cityId=${id}${suffix}`)).toThrow();
    }
    expect(normalizeDiscovery({ startsFrom: "2099-01-01" }).startsFrom).toBe("2099-01-01T00:00:00.000Z");
    expect(parseMapQuery(`/v1/games/map?cityId=${id}&temporalScope=upcoming&startsFrom=2099-01-01T01:00:00%2B01:00`).startsFrom).toBe("2099-01-01T00:00:00.000Z");
  });
});
