import type { Game, VenueSummary } from "./consumer-types";
import { cityDate } from "./discovery-presentation";
import { MOSCOW_BUNDLE, pointInBundleBounds, type FixedMapBundle } from "./radar-map-assets";

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
    text: count ? String(count) : "",
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
}, bundle: FixedMapBundle = MOSCOW_BUNDLE) {
  const visible = new Set<string>();
  for (const venue of venues) {
    const { latitude: lat, longitude: lon } = venue;
    if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || !pointInBundleBounds(lon, lat, bundle)) continue;
    visible.add(venue.id);
    let entry = entries.get(venue.id);
    if (!entry) { entry = adapter.create(venue); entries.set(venue.id, entry); }
    adapter.update(entry, venue);
  }
  for (const [id, entry] of entries) {
    if (!visible.has(id)) { adapter.remove(entry); entries.delete(id); }
  }
}

/** One complete load at a time. No idle full-catalog poll — callers refresh on focus/online/visibility.
 * Focus+visibility twins share one in-flight load; a short cooldown drops a duplicate after a fast refresh settle.
 * Hidden-document refresh is rejected; the explicit initial load always runs and does not arm that cooldown. */
export function startVenueMapRefresh(load: (signal: AbortSignal) => Promise<void>, options?: { cooldownMs?: number }) {
  const controller = new AbortController();
  let pending = false;
  let lastRefreshStartedAt = 0;
  const cooldownMs = options?.cooldownMs ?? 750;
  const run = async () => {
    if (controller.signal.aborted || pending) return;
    pending = true;
    try { await load(controller.signal); }
    catch { /* load owns UI errors; avoid unhandled rejection from void run/refresh */ }
    finally { pending = false; }
  };
  const refresh = () => {
    if (controller.signal.aborted || pending) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (lastRefreshStartedAt !== 0 && Date.now() - lastRefreshStartedAt < cooldownMs) return;
    lastRefreshStartedAt = Date.now();
    void run();
  };
  void run();
  return {
    refresh: () => { refresh(); },
    stop: () => { controller.abort(); },
  };
}

/** Route only to an existing venue screen; return destinations stay inside Games. */
export function gamesMapReturnPath(value: string | null) {
  if (!value || !/^\/(?:games|players\/radar)(?:\?|$)/.test(value)) return "/games?view=map";
  return value;
}
export function venueMapPath(venueId: string, day: string, returnTo: string) {
  return `/venues/${encodeURIComponent(venueId)}?${new URLSearchParams({ day, returnTo: gamesMapReturnPath(returnTo) })}`;
}

/** A browser-synthesized click after a drag must not select a venue. detail=0 is keyboard. */
export function markerActivation() {
  let origin: [number, number] | null = null;
  let dragged = false;
  return {
    start(x: number, y: number) { origin = [x, y]; dragged = false; },
    move(x: number, y: number) { if (origin && Math.hypot(x - origin[0], y - origin[1]) > 5) dragged = true; },
    cancel() { dragged = true; },
    allow(detail: number) { return detail === 0 || !dragged; },
  };
}

/** Compare verified hints by content, preserving unknown versus verified empty. */
export function sameVenueCounts(previous: Map<string, number> | null, next: Map<string, number> | null): boolean {
  if (previous === next) return true;
  if (previous === null || next === null || previous.size !== next.size) return false;
  for (const [key, value] of previous) if (!next.has(key) || next.get(key) !== value) return false;
  return true;
}
export function stableVenueCounts(previous: Map<string, number> | null, next: Map<string, number> | null): Map<string, number> | null {
  return sameVenueCounts(previous, next) ? previous : next;
}

/** Public selection intent only; schedule-only GamesMapView.venueId is unrelated. */
export function mapCommunityReturnPath(path: string, search: string, venueId: string, cityId: string, day: string, activity: string) {
  const [base = "/games?view=map"] = gamesMapReturnPath(`${path}${search}`).split("#");
  const [route, query] = base.split("?");
  const source = new URLSearchParams(query);
  const params = new URLSearchParams();
  for (const key of ["view", "cityId", "day", "activity", "trainer"]) {
    const value = source.get(key);
    if (value !== null) params.set(key, value);
  }
  if (route === "/games") params.set("view", "map");
  params.set("selectedVenue", venueId);
  params.set("communityCity", cityId);
  params.set("cityId", cityId);
  params.set("day", day);
  params.set("activity", activity);
  return `${route}?${params}`;
}
export function mapCommunitySelection(search: string, hash: string, cityId: string) {
  const params = new URLSearchParams(search);
  const venueId = params.get("selectedVenue");
  const section = hash.slice(1);
  if (!venueId || params.get("communityCity") !== cityId || !["ratings", "discussion", "reviews"].includes(section)) return null;
  return { venueId, section: section as "ratings" | "discussion" | "reviews" };
}
