import { describe, expect, it } from "vitest";
import type { VenueSummary } from "../src/lib/consumer-types";
import {
  DEFAULT_MAP_LAYER_FILTERS,
  filterVenuesForMapLayer,
  mapLayerFiltersActive,
  mapLayerFiltersChipLabel,
  sameMapLayerFilters,
} from "../src/lib/map-layer-filters";

const a = { id: "a", name: "С играми", cityId: "city" } as VenueSummary;
const b = { id: "b", name: "Без игр", cityId: "city" } as VenueSummary;
const c = { id: "c", name: "Неизвестно", cityId: "city" } as VenueSummary;

describe("map layer filter helpers", () => {
  it("defaults to all venues with players layer on", () => {
    expect(DEFAULT_MAP_LAYER_FILTERS).toEqual({ venueMode: "all", showPlayersNearby: true });
    expect(mapLayerFiltersActive(DEFAULT_MAP_LAYER_FILTERS)).toBe(false);
  });

  it("treats only confirmed zero as excluded for with_games; unknown stays visible", () => {
    const known = new Map([["a", 2], ["b", 0]]);
    expect(filterVenuesForMapLayer([a, b, c], known, "all").map(v => v.id)).toEqual(["a", "b", "c"]);
    expect(filterVenuesForMapLayer([a, b, c], known, "with_games").map(v => v.id)).toEqual(["a", "c"]);
    expect(filterVenuesForMapLayer([a, b, c], null, "with_games").map(v => v.id)).toEqual(["a", "b", "c"]);
    expect(filterVenuesForMapLayer([a, b], new Map(), "with_games").map(v => v.id)).toEqual(["a", "b"]);
  });

  it("never invents a verified empty from missing counts", () => {
    const partial = new Map([["a", 1]]);
    const filtered = filterVenuesForMapLayer([a, b], partial, "with_games");
    expect(filtered.map(v => v.id)).toEqual(["a", "b"]);
  });

  it("reports active chip state for non-default applied filters", () => {
    expect(mapLayerFiltersActive({ venueMode: "with_games", showPlayersNearby: true })).toBe(true);
    expect(mapLayerFiltersActive({ venueMode: "all", showPlayersNearby: false })).toBe(true);
    expect(mapLayerFiltersChipLabel({ venueMode: "with_games", showPlayersNearby: true })).toContain("Только с играми");
    expect(mapLayerFiltersChipLabel({ venueMode: "with_games", showPlayersNearby: true })).toContain("Показ игроков включён");
    expect(mapLayerFiltersChipLabel({ venueMode: "with_games", showPlayersNearby: false })).toContain("Только с играми");
    expect(mapLayerFiltersChipLabel({ venueMode: "with_games", showPlayersNearby: false })).toContain("Показ игроков выключен");
    expect(sameMapLayerFilters(DEFAULT_MAP_LAYER_FILTERS, { ...DEFAULT_MAP_LAYER_FILTERS })).toBe(true);
  });
});
