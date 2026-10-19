import { describe, expect, it } from "vitest";
import { sameVenueCounts, stableVenueCounts, venueSchedules } from "../src/lib/games-venue-map";
import { discoveryDayBounds } from "../src/lib/discovery-presentation";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
const venues = ["a", "b", "empty"].map(id => ({ id, name: "Одинаковое имя", cityId: "city", address: id, timezone: "Europe/Moscow" })) as VenueSummary[];
const now = Date.parse("2026-10-15T12:00:00Z");
const game = (id: string, venue = venues[0], extra: Partial<Game> = {}) => ({ id, venue, startsAt: "2026-10-15T22:30:00Z", applicationDeadlineAt: "2026-10-15T21:30:00Z", status: "published", visibility: "public", availablePlaces: 1, ...extra }) as Game;
describe("Games map identity, dates and privacy hints", () => {
  it("retains every venue including zero-game venues and never matches names", () => {
    const result = venueSchedules(venues, [game("1"), game("2", venues[1])], "", now);
    expect([...result.keys()]).toEqual(["a", "b", "empty"]);
    expect(result.get("a")?.map(g => g.id)).toEqual(["1"]);
    expect(result.get("empty")).toEqual([]);
  });
  it("uses venue calendar date across UTC midnight, dedupes and sorts", () => {
    const games = [game("late"), game("early", venues[0], { startsAt: "2026-10-15T21:30:00Z" }), game("late")];
    expect(venueSchedules(venues, games, "2026-10-16", now).get("a")?.map(g => g.id)).toEqual(["early", "late"]);
    expect(venueSchedules(venues, games, "2026-10-15", now).get("a")).toEqual([]);
  });
  it("never counts private, cancelled, expired, full or closed application games", () => {
    const games = [game("private", undefined, { visibility: "unlisted" }), game("cancel", undefined, { status: "cancelled" }), game("full", undefined, { availablePlaces: 0 }), game("past", undefined, { startsAt: "2026-10-15T11:00:00Z" }), game("deadline", undefined, { applicationDeadlineAt: "2026-10-15T11:00:00Z" })];
    expect(venueSchedules(venues, games, "", now).get("a")).toEqual([]);
  });
  it("expires hints without waiting for a new network response", () => {
    expect(venueSchedules(venues, [game("1")], "", Date.parse("2026-10-15T22:30:00Z")).get("a")).toEqual([]);
  });
  it("preserves timezone day boundaries on a DST transition", () => {
    const bounds = discoveryDayBounds("2026-10-25", "Europe/Berlin");
    expect(Date.parse(bounds.startsBefore) - Date.parse(bounds.startsFrom)).toBe(25 * 3600000);
  });
});

it("counts 5/4/6 distinct games, never seats or participants", () => {
  const counts = [5, 4, 6];
  const catalog: VenueSummary[] = counts.map(count => ({ id: `venue-${count}`, name: "Одинаковое имя", cityId: "city", address: `address-${count}`, timezone: "Europe/Moscow" }));
  const rows = counts.flatMap((count, i) => {
    const venue = catalog[i];
    if (!venue) throw new Error(`Missing venue for ${count} games`);
    return Array.from({ length: count }, (_, n) =>
      game(`${venue.id}-${n}`, venue, { availablePlaces: 20 + n, startsAt: `2026-10-16T${String(10 + n).padStart(2, "0")}:00:00Z` }));
  });
  const duplicate = rows[0];
  if (!duplicate) throw new Error("Expected a game to exercise duplicate elimination");
  const grouped = venueSchedules(catalog, [...rows].reverse().concat(duplicate), "", now);
  expect([...grouped.values()].map(games => games.length)).toEqual([5, 4, 6]);
  for (const venue of catalog) {
    const schedule = grouped.get(venue.id);
    if (!schedule) throw new Error(`Missing schedule for ${venue.id}`);
    expect(schedule.every(row => row.venue.id === venue.id)).toBe(true);
    expect(schedule.map(row => row.startsAt)).toEqual(schedule.map(row => row.startsAt).sort());
  }
});

it("stabilizes counts by content without equating unknown and empty", () => {
  const previous = new Map([["a", 1], ["b", 2]]);
  const reordered = new Map([["b", 2], ["a", 1]]);
  expect(sameVenueCounts(previous, reordered)).toBe(true);
  expect(stableVenueCounts(previous, reordered)).toBe(previous);
  for (const next of [new Map([["a", 2], ["b", 2]]), new Map([["c", 1], ["b", 2]])]) {
    expect(stableVenueCounts(previous, next)).toBe(next);
  }
  expect(sameVenueCounts(null, null)).toBe(true);
  expect(sameVenueCounts(null, new Map())).toBe(false);
  expect(sameVenueCounts(new Map(), null)).toBe(false);
});
