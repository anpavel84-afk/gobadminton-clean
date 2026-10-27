import type { VenueSummary } from "./consumer-types";

/** Display-layer only: does not change Radar consent, publication or session. */
export type VenueLayerMode = "all" | "with_games";

export type MapLayerFiltersState = {
  venueMode: VenueLayerMode;
  showPlayersNearby: boolean;
};

export const DEFAULT_MAP_LAYER_FILTERS: MapLayerFiltersState = {
  venueMode: "all",
  showPlayersNearby: true,
};

export function sameMapLayerFilters(a: MapLayerFiltersState, b: MapLayerFiltersState): boolean {
  return a.venueMode === b.venueMode && a.showPlayersNearby === b.showPlayersNearby;
}

/** True when applied display filters differ from product defaults. */
export function mapLayerFiltersActive(applied: MapLayerFiltersState): boolean {
  return !sameMapLayerFilters(applied, DEFAULT_MAP_LAYER_FILTERS);
}

/**
 * Marker visibility for «Только с играми».
 * Unknown / unloaded schedules are never treated as zero: keep those venues visible.
 * Only exclude after a confirmed public schedule count of 0.
 */
export function filterVenuesForMapLayer(
  venues: readonly VenueSummary[],
  counts: ReadonlyMap<string, number> | null,
  mode: VenueLayerMode,
): VenueSummary[] {
  if (mode === "all") return [...venues];
  if (counts === null) return [...venues];
  return venues.filter(venue => {
    const count = counts.get(venue.id);
    if (count === undefined) return true;
    return count > 0;
  });
}

export function mapLayerFiltersChipLabel(applied: MapLayerFiltersState): string {
  const parts: string[] = [];
  if (applied.venueMode === "with_games") parts.push("Только с играми");
  if (applied.showPlayersNearby) {
    if (applied.venueMode === "with_games") parts.push("Показ игроков включён");
  } else {
    parts.push("Показ игроков выключен");
  }
  return parts.length ? parts.join(" · ") : "Фильтры";
}
