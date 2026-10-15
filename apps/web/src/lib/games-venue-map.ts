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

/** Reconcile by immutable ID: presentation refreshes must preserve focused controls. */
export function reconcileVenueMarkers<Entry>(entries: Map<string, Entry>, venues: VenueSummary[], adapter: {
  create: (venue: VenueSummary) => Entry;
  update: (entry: Entry, venue: VenueSummary) => void;
  remove: (entry: Entry) => void;
}) {
  const visible = new Set<string>();
  for (const venue of venues) {
    const { latitude: lat, longitude: lon } = venue;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || lon < 36 || lon > 39.5 || lat < 54.5 || lat > 56.5) continue;
    visible.add(venue.id);
    let entry = entries.get(venue.id);
    if (!entry) { entry = adapter.create(venue); entries.set(venue.id, entry); }
    adapter.update(entry, venue);
  }
  for (const [id, entry] of entries) {
    if (!visible.has(id)) { adapter.remove(entry); entries.delete(id); }
  }
}

/** One complete load at a time; the quiet polling interval starts after settlement. */
export function startVenueMapRefresh(load: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (controller.signal.aborted || pending) return;
    clearTimeout(timer);
    pending = true;
    try { await load(controller.signal); }
    finally {
      pending = false;
      if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 30000);
    }
  };
  void refresh();
  return {
    refresh: () => { void refresh(); },
    stop: () => { controller.abort(); clearTimeout(timer); },
  };
}
