import { describe, expect, it } from "vitest";
import {
  DEMO_GAME_IDS,
  DEMO_MOSCOW_CITY_ID,
  DEMO_SPB_CITY_ID,
  DEMO_USER_IDS,
  DEMO_VENUE_IDS,
  isDemoUuid,
} from "../../src/database/demo-ids";
import {
  buildDemoGames,
  buildDemoPeople,
  buildDemoVenues,
} from "../../src/database/demo-population";
import { buildDemoSocialPopulation } from "../../src/database/demo-social-population";

describe("synthetic demo population", () => {
  it("defines exactly 20 fictional people with deterministic demo UUIDs", () => {
    const people = buildDemoPeople();
    expect(people).toHaveLength(20);
    expect(DEMO_USER_IDS).toHaveLength(20);
    expect(new Set(people.map((p) => p.displayName)).size).toBe(20);
    expect(people.every((p) => isDemoUuid(p.userId))).toBe(true);
    expect(people.every((p) => isDemoUuid(p.publicPlayerId))).toBe(true);
    expect(people.filter((p) => p.lookingActive).length).toBeGreaterThanOrEqual(
      6,
    );
    expect(people.filter((p) => p.directoryVisible).length).toBeGreaterThan(0);
    expect(people.some((p) => !p.directoryVisible)).toBe(true);
    expect(people.filter((p) => p.contactPolicy === "requests").length).toBe(14);
    expect(people.find((p) => p.ordinal === 18)?.socialEligible).toBe(false);
    expect(people.filter((p) => p.cityId === DEMO_MOSCOW_CITY_ID).length).toBeGreaterThan(
      0,
    );
    expect(people.filter((p) => p.cityId === DEMO_SPB_CITY_ID).length).toBeGreaterThan(
      0,
    );
    expect(people.find((p) => p.ordinal === 18)?.cityId).toBeNull();
  });

  it("defines deterministic social backfill without person 18 or radar rows", () => {
    const social = buildDemoSocialPopulation();
    expect(social.dmThreads).toHaveLength(10);
    expect(social.invitations).toHaveLength(8);
    expect(social.gameChats.length).toBe(19);
    const parties = new Set<number>();
    for (const t of social.dmThreads) {
      parties.add(t.initiatorOrdinal);
      parties.add(t.recipientOrdinal);
    }
    for (const i of social.invitations) {
      parties.add(i.inviterOrdinal);
      parties.add(i.inviteeOrdinal);
    }
    expect(parties.has(18)).toBe(false);
    expect(social.messageCount).toBeGreaterThan(20);
    const chatOrdinals = new Set(social.gameChats.map((c) => c.gameOrdinal));
    expect(chatOrdinals.has(13)).toBe(false); // draft has no chat
    expect(chatOrdinals.has(15)).toBe(true);
    expect(chatOrdinals.has(20)).toBe(true);
  });

  it("defines exactly 20 games across Moscow/SPB with variety and capacity honesty", () => {
    const games = buildDemoGames();
    const venues = buildDemoVenues();
    expect(games).toHaveLength(20);
    expect(DEMO_GAME_IDS).toHaveLength(20);
    expect(venues).toHaveLength(6);
    expect(DEMO_VENUE_IDS).toHaveLength(6);
    expect(venues.filter((v) => v.cityId === DEMO_MOSCOW_CITY_ID)).toHaveLength(
      4,
    );
    expect(venues.filter((v) => v.cityId === DEMO_SPB_CITY_ID)).toHaveLength(2);

    const venueByOrdinal = new Map(venues.map((v, i) => [i + 1, v]));
    const moscowGames = games.filter(
      (g) => venueByOrdinal.get(g.venueOrdinal)?.cityId === DEMO_MOSCOW_CITY_ID,
    );
    const spbGames = games.filter(
      (g) => venueByOrdinal.get(g.venueOrdinal)?.cityId === DEMO_SPB_CITY_ID,
    );
    expect(moscowGames.length).toBeGreaterThan(0);
    expect(spbGames.length).toBeGreaterThan(0);
    expect(moscowGames.length + spbGames.length).toBe(20);

    const creators = new Set(games.map((g) => g.creatorOrdinal));
    expect(creators.size).toBeGreaterThanOrEqual(6);
    expect(games.some((g) => g.activityKind === "regular")).toBe(true);
    expect(games.some((g) => g.activityKind === "trainer_led")).toBe(true);
    expect(spbGames.some((g) => g.activityKind === "trainer_led")).toBe(true);
    const statuses = new Set(
      games.flatMap((g) => g.participations.map((p) => p.status)),
    );
    expect(statuses.has("pending")).toBe(true);
    expect(statuses.has("confirmed")).toBe(true);
    expect(statuses.has("withdrawn")).toBe(true);
    for (const game of games) {
      const confirmed = game.participations.filter(
        (p) => p.status === "confirmed",
      ).length;
      expect(confirmed + game.externalReservedCount).toBeLessThanOrEqual(
        game.capacity,
      );
    }
  });
});
