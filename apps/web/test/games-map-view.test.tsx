// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="basemap" /> }));
vi.mock("../src/components/consumer/Button", () => ({ Button: ({ children, href, ...props }: any) => href ? <a href={href}>{children}</a> : <button {...props}>{children}</button> }));
vi.mock("../src/components/consumer/discovery/DiscoveryGameCard", () => ({ DiscoveryGameCard: ({ game }: any) => <a href={`/games/${game.id}`}>{game.title}</a> }));
const mocks = vi.hoisted(() => ({ venues: vi.fn(), games: vi.fn() }));
vi.mock("../src/lib/api-client", () => ({ listAllCityVenues: mocks.venues, listAllUpcomingCityGames: mocks.games }));
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("keeps a zero-game venue selectable under a date filter and creates by exact ID", async () => {
  mocks.venues.mockResolvedValue({ ok: true, data: [{ id: "empty-id", name: "Зал без игр", address: "Адрес", timezone: "Europe/Moscow", cityId: "unsupported" }] });
  mocks.games.mockResolvedValue({ ok: true, data: [] });
  render(<GamesMapView cityId="unsupported" day="2026-10-18" />);
  fireEvent.click(await screen.findByRole("button", { name: "Зал без игр · 0" }));
  expect(screen.getByText("Нет предстоящих доступных игр")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Создать игру на этой площадке" }).getAttribute("href")).toBe("/games/create?venueId=empty-id");
  expect(screen.getByText(/Карта выбранного города пока недоступна/)).toBeTruthy();
});
it("reports failed complete schedules instead of rendering a partial count", async () => {
  mocks.venues.mockResolvedValue({ ok: true, data: [] });
  mocks.games.mockResolvedValue({ ok: false });
  render(<GamesMapView cityId="city" day="" />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Не удалось загрузить полный каталог"));
  expect(screen.queryByRole("button", { name: / · 0/ })).toBeNull();
});
