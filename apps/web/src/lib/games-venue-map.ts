import type { Game, VenueSummary } from "./consumer-types";
import { cityDate } from "./discovery-presentation";

/** Counts are discovery hints; detail/join always revalidate server authority. */
export function venueSchedules(venues: VenueSummary[], games: Game[], day: string, now = Date.now()) {
  const schedules = new Map(venues.map(venue => [venue.id, [] as Game[]]));
  for (const game of new Map(games.map(game => [game.id, game])).values()) {
    if (game.status !== "published" || game.visibility !== "public" || game.availablePlaces <= 0 ||
        Date.parse(game.startsAt) <= now || !Number.isFinite(Date.parse(game.startsAt)) ||
        Date.parse(game.applicationDeadlineAt) <= now) continue;
    if (day && cityDate(new Date(game.startsAt), game.venue.timezone) !== day) continue;
    schedules.get(game.venue.id)?.push(game);
  }
  for (const games of schedules.values()) games.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  return schedules;
}

/** null means unavailable, never a verified zero. Also used for accessible marker text. */
export function venueMarkerPresentation(venue: Pick<VenueSummary, "id" | "name">, counts: ReadonlyMap<string, number> | null) {
  const count = counts?.get(venue.id);
  return {
    className: count ? "g2-map-marker" : "g2-map-venue-marker",
    text: count ? String(count) : "⌂",
    label: count === undefined ? `${venue.name}: расписание недоступно` : `${venue.name}: ${count} доступных игр`,
  };
}

/** Only the immutable venue ID is carried through authentication/profile setup. */
export function venueCreatePath(search: string) {
  const venueId = new URLSearchParams(search).get("venueId");
  return venueId ? `/games/create?${new URLSearchParams({ venueId })}` : "/games/create";
}
