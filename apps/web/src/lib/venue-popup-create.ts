import type { VenueSummary } from "./consumer-types";

export type VenueCreateSelection = { venueId: string; createNewVenue: boolean };

/** Explicit popup context never falls back to a possibly unrelated route query. */
export function initialCreateVenue({ initialVenue, cityId, search, venues }: {
  initialVenue?: VenueSummary | null;
  cityId: string | undefined;
  search: string;
  venues: readonly VenueSummary[];
}): VenueSummary | null {
  if (!cityId) return null;
  if (initialVenue !== undefined) {
    if (!initialVenue || typeof initialVenue.id !== "string" || !initialVenue.id.trim() ||
      initialVenue.cityId !== cityId || typeof initialVenue.name !== "string" || !initialVenue.name.trim() ||
      typeof initialVenue.address !== "string" || !initialVenue.address.trim() || typeof initialVenue.timezone !== "string") return null;
    try { new Intl.DateTimeFormat("ru-RU", { timeZone: initialVenue.timezone }).format(0); }
    catch { return null; }
    return initialVenue;
  }
  const requested = new URLSearchParams(search).get("venueId");
  return venues.find(venue => venue.id === requested && venue.cityId === cityId) ?? null;
}

/** Catalog loading/refresh may fill an untouched draft, never replace a user decision. */
export function selectCreateVenue<T extends VenueCreateSelection>(draft: T, candidate: VenueSummary | null, manuallySelected: boolean): T {
  if (!candidate || manuallySelected || draft.venueId || draft.createNewVenue) return draft;
  return { ...draft, venueId: candidate.id };
}
