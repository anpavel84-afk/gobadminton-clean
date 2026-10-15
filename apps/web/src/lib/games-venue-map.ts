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
