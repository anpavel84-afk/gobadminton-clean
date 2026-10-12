import type { VenueSummary } from "./consumer-types";

const COLLATOR = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

function searchText(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Stable name-first alphabetical order, with address and UUID as tie-breakers. */
export function sortVenueOptions(venues: VenueSummary[]): VenueSummary[] {
  return [...venues].sort((a, b) =>
    COLLATOR.compare(a.name, b.name) ||
    COLLATOR.compare(a.address, b.address) ||
    a.id.localeCompare(b.id),
  );
}

/** Case-, whitespace- and ё/е-insensitive search of name and complete address. */
export function filterVenueOptions(venues: VenueSummary[], query: string): VenueSummary[] {
  const value = searchText(query);
  if (!value) return venues;
  const tokens = value.split(" ").filter(Boolean);
  return venues.filter(venue => {
    const haystack = searchText(`${venue.name} ${venue.address}`);
    return tokens.every(token => haystack.includes(token));
  });
}

/** A cached Venue is usable only for the currently selected city group. */
export function resolveSelectedVenue(
  venues: VenueSummary[],
  cached: VenueSummary | null,
  selectedId: string,
  cityId: string | undefined,
): VenueSummary | undefined {
  if (!selectedId || !cityId) return undefined;
  return venues.find(venue => venue.id === selectedId && venue.cityId === cityId) ??
    (cached?.id === selectedId && cached.cityId === cityId ? cached : undefined);
}
