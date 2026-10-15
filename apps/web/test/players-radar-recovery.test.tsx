import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { RadarView } from "../src/lib/radar-controller";
const mock = vi.hoisted(() => ({ view: {} as RadarView, rows: [] as unknown[] }));
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../src/components/consumer/radar/UnifiedPlayerCard", () => ({ UnifiedPlayerCard: () => <div>PRIVATE RADAR ROW</div> }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({
  useRadarSession: () => ({ controller: {}, view: mock.view }),
  useRadarConfig: () => ({ exposureMode: "live", publishingV2: { enabled: true }, unifiedDirectory: { enabled: true, contractVersion: "players-unified-radar-v1", disclosure: { text: "Consent" } }, cities: [{ cityId: "moscow" }] }),
  useDirectoryFilters: () => ({ filters: { name: "", areaKey: "", cityId: "moscow", lookingOnly: false, trainerOnly: false }, update: vi.fn() }),
  useUnifiedDirectory: () => ({ controller: { matches: () => true }, view: { mode: "unified", snapshot: { validUntil: "2099-01-01", page: {}, totals: { radarTotal: 1 } }, rows: mock.rows, busy: false } }),
}));
import { PlayersDirectoryPage } from "../src/components/consumer/pages/PlayersDirectoryPage";
it("Players exposes enable/unavailable and confirmed timer, and hides refreshed private rows after error", () => {
  mock.view = { phase: "off", confirmedOn: false, now: 0 } as RadarView;
  expect(renderToStaticMarkup(<PlayersDirectoryPage />)).toContain("Включить Radar");
  mock.view = { ...mock.view, phase: "disabled" };
  expect(renderToStaticMarkup(<PlayersDirectoryPage />)).toContain("Radar сейчас недоступен");
  mock.view = { ...mock.view, phase: "active", confirmedOn: true, status: { state: "active", contractVersion: "players-unified-radar-v1", activationId: "a", expiresAt: "2099-01-01", hardExpiresAt: "2099-01-01", foregroundUntil: "2099-01-01", locationValidUntil: "2099-01-01" } } as RadarView;
  mock.rows = [{ publicPlayerId: "private", player: { publicPlayerId: "private", displayName: "Private" }, radar: { validUntil: "2099-01-01" } }];
  const active = renderToStaticMarkup(<PlayersDirectoryPage />);
  expect(active).toContain("PRIVATE RADAR ROW");
  expect(active).toContain("Подтверждённый срок Radar");
  mock.view = { ...mock.view, phase: "error" };
  mock.rows = [...mock.rows]; // A directory refresh arrives with retained active status.
  const html = renderToStaticMarkup(<PlayersDirectoryPage />);
  expect(html).toContain("Проверить статус");
  expect(html).not.toContain("PRIVATE RADAR ROW");
  expect(html).not.toContain("Подтверждённый срок Radar");
});
