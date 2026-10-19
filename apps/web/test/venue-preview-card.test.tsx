import { Children, isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
import { nearestGameLabel } from "../src/lib/venue-popup";
const venue: VenueSummary = { id: "a", name: "Зал А", address: "Улица 1", cityId: "city", timezone: "Europe/Moscow" };
function game(startsAt: string, endsAt: string): Game {
  return { id: startsAt, version: 1, title: "Игра", venue, startsAt, endsAt, timezone: venue.timezone,
    status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
    organizer: { id: null, displayName: "Организатор", publicContact: "" }, applicationDeadlineAt: startsAt,
    capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles",
    levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: [] },
    settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
}
it("renders the real cover and region with exactly one named keyboard button; opens once", () => {
  const onOpen = vi.fn();
  const tree = VenuePreviewCard({ venue, games: [], gamesReady: true, now: 0, onOpen });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('role="region" aria-label="Выбранная площадка"');
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(html).toContain('aria-label="Открыть площадку Зал А"');
  expect(html).toContain("Улица 1"); expect(html).toContain('data-cover="default"');
  function activate(node: ReactNode): void {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
    if (node.type === "button") node.props.onClick?.();
    Children.forEach(node.props.children, activate);
  }
  activate(tree); expect(onOpen).toHaveBeenCalledOnce();
  const uploadedUrl = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
  expect(renderToStaticMarkup(<VenuePreviewCard venue={{ ...venue, cover: { uploadedUrl } }} games={[]} gamesReady now={0} onOpen={onOpen} />)).toContain('data-cover="uploaded"');
});
it("distinguishes unavailable from checked empty and never shows stale time", () => {
  const games = [game("2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z")];
  const html = renderToStaticMarkup(<VenuePreviewCard venue={venue} games={games} gamesReady={false} now={0} onOpen={vi.fn()} />);
  expect(html).toContain("Расписание временно недоступно"); expect(html).not.toContain("13:00"); expect(html).not.toContain("Пока нет игр");
  expect(nearestGameLabel([], venue.timezone, 0)).toBe("Пока нет игр");
});
it("uses the earliest game without mutating input and formats local calendar dates", () => {
  const early = game("2026-11-04T10:00:00Z", "2026-11-04T11:30:00Z");
  const late = game("2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z");
  const games = Object.freeze([late, early]);
  expect(nearestGameLabel(games, venue.timezone, Date.parse("2026-11-04T00:00:00Z"))).toBe("13:00 – 14:30 · Сегодня");
  expect(nearestGameLabel(games, venue.timezone, Date.parse("2026-11-03T00:00:00Z"))).toBe("13:00 – 14:30 · Завтра");
  expect(nearestGameLabel(games, venue.timezone, Date.parse("2026-11-01T00:00:00Z"))).toBe("13:00 – 14:30 · 4 нояб.");
  expect(games).toEqual([late, early]);
  expect(nearestGameLabel([early], venue.timezone, Date.parse("2026-11-03T22:00:00Z"))).toContain("Сегодня");
});
it.each([
  ["2026-03-29T00:30:00Z", "2026-03-29T22:00:00Z", "2026-03-29T23:00:00Z", "00:00 – 01:00 · Завтра"],
  ["2026-10-24T22:30:00Z", "2026-10-25T23:00:00Z", "2026-10-26T00:00:00Z", "00:00 – 01:00 · Завтра"],
])("handles DST calendar tomorrow at %s", (now, start, end, label) => {
  expect(nearestGameLabel([game(start, end)], "Europe/Berlin", Date.parse(now))).toBe(label);
});
