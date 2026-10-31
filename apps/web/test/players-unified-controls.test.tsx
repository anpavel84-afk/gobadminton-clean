import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
const session = vi.hoisted(() => ({ on: true }));
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../src/components/consumer/radar/RadarControls", () => ({ RadarSwitchControl: () => null, RadarStatusControls: () => null }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({
  useRadarSession: () => ({ controller: null, view: { status: session.on ? { state: "active", contractVersion: "players-unified-radar-v1", activationId: "active", version: 1 } : { state: "off" }, phase: session.on ? "active" : "off", confirmedOn: session.on, pendingStop: false, me: { id: "viewer" } } }),
  useUnifiedDirectory: () => ({ controller: null, view: { mode: "ordinary", snapshot: null, busy: true, rows: [], notice: "", capabilityUnavailable: false } }),
  useRadarConfig: () => null,
  useDirectoryFilters: () => ({ filters: { cityId: "", areaKey: "", name: "", lookingOnly: false, trainerOnly: false }, update: () => {} }),
}));
import { PlayersDirectoryPage } from "../src/components/consumer/pages/PlayersDirectoryPage";
describe("Players automatic Radar composition", () => {
  it("adds only the map action during active Radar, even while capability loads", () => {
    session.on = true; const html = renderToStaticMarkup(<PlayersDirectoryPage />);
    expect(html).toContain("Игроки на карте"); expect(html).toContain('href="/players/radar"');
    // Combined mobile finder overlay (Owner-approved): partner CTA + map secondary share one zone.
    const zoneAt = html.indexOf("pb-mobile-finder-zone");
    expect(zoneAt).toBeGreaterThan(-1);
    expect(html.slice(zoneAt, zoneAt + 80)).toContain('data-radar="on"');
    const ctaAt = html.indexOf("pb-finder-cta", zoneAt);
    const mapAt = html.indexOf("pb-finder-map-secondary", zoneAt);
    expect(ctaAt).toBeGreaterThan(zoneAt);
    expect(mapAt).toBeGreaterThan(ctaAt);
    const sharedZone = html.slice(zoneAt, mapAt + 200);
    expect(sharedZone).toContain("pb-finder-cta");
    expect(sharedZone).toContain("pb-finder-map-secondary");
    expect(sharedZone).toContain('href="/players/radar"');
    expect(sharedZone).toContain('aria-label="Игроки на карте"');
    for (const label of ["Смотреть участников Radar", "Сортировать по близости", "Обычный каталог", "Обновить участников Radar", "Никого не нашли", "Показать на карте"]) expect(html).not.toContain(label);
    expect(html).toContain("Ищем игроков…");
  });
  it("keeps OFF in ordinary catalog without a map action", () => {
    session.on = false; const html = renderToStaticMarkup(<PlayersDirectoryPage />);
    expect(html).not.toContain("Игроки на карте"); expect(html).not.toContain("Показать на карте"); expect(html).toContain('aria-label="Фильтры каталога"');
  });
});
