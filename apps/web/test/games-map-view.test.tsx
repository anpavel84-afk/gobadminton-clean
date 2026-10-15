import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
import { venueCreatePath, venueMarkerPresentation, venueSchedules } from "../src/lib/games-venue-map";
vi.mock("../src/components/consumer/discovery/DiscoveryGameCard", () => ({
  DiscoveryGameCard: ({ game }: { game: Game }) => <a href={`/games/${game.id}`}>{game.title}</a>,
}));
import { VenueScheduleCard } from "../src/components/consumer/games/VenueScheduleCard";
const venue = { id: "empty/id", name: "Зал без игр", address: "Адрес", timezone: "Europe/Moscow", cityId: "city" } as VenueSummary;
const card = (gamesReady: boolean, day = "", hasUpcoming = false, games: Game[] = []) => renderToStaticMarkup(
  <VenueScheduleCard venue={venue} games={games} gamesReady={gamesReady} day={day} hasUpcoming={hasUpcoming} />,
);
it("renders the zero-game venue, safe default, address and exact preselected create link", () => {
  const schedules = venueSchedules([venue], [], "2026-10-18");
  expect([...schedules.keys()]).toEqual([venue.id]);
  const html = card(true, "2026-10-18", false, schedules.get(venue.id));
  expect(html).toContain("Зал без игр");
  expect(html).toContain("Адрес");
  expect(html).toContain('data-cover="default"');
  expect(html).toContain("Нет предстоящих доступных игр");
  expect(html).toContain('href="/games/create?venueId=empty%2Fid"');
});
it("distinguishes no games on the selected date from no upcoming games", () => {
  expect(card(true, "2026-10-18", true)).toContain("Нет игр в выбранную дату");
  expect(card(true)).toContain("Нет предстоящих доступных игр");
});
it("does not expose stale games or a false empty state while schedules are unavailable", () => {
  const html = card(false, "", true, [{ id: "stale", title: "Stale game" } as Game]);
  expect(html).toContain("Расписание временно недоступно");
  expect(html).not.toContain("Нет предстоящих");
  expect(html).not.toContain("Stale game");
});
it("keeps unavailable marker counts distinct from verified zero and positive counts", () => {
  expect(venueMarkerPresentation(venue, null)).toMatchObject({ text: "⌂", label: "Зал без игр: расписание недоступно" });
  expect(venueMarkerPresentation(venue, new Map())).toMatchObject({ label: "Зал без игр: расписание недоступно" });
  expect(venueMarkerPresentation(venue, new Map([[venue.id, 0]]))).toMatchObject({ text: "⌂", label: "Зал без игр: 0 доступных игр" });
  expect(venueMarkerPresentation(venue, new Map([[venue.id, 2]]))).toMatchObject({ text: "2", className: "g2-map-marker" });
});
it("preserves venue identity through the encoded profile setup return path", () => {
  const create = venueCreatePath("?venueId=empty%2Fid&untrusted=discard");
  const setup = `/profile/setup?returnTo=${encodeURIComponent(create)}`;
  expect(new URLSearchParams(setup.split("?")[1]).get("returnTo")).toBe("/games/create?venueId=empty%2Fid");
  expect(venueCreatePath("")).toBe("/games/create");
});
it("links the selected venue schedule to the existing game route", () => {
  expect(card(true, "", true, [{ id: "game-id", title: "Игра" } as Game])).toContain('href="/games/game-id"');
});
