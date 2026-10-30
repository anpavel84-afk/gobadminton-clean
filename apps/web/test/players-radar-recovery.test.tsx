import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import type { RadarView } from "../src/lib/radar-controller";
const mock = vi.hoisted(() => ({ view: {} as RadarView, rows: [] as UnifiedRow[] }));
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../src/components/consumer/radar/UnifiedPlayerCard", () => ({ UnifiedPlayerCard: () => <div>PRIVATE RADAR ROW</div> }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({
  useRadarSession: () => ({ controller: {}, view: mock.view }),
  useRadarConfig: () => ({ exposureMode: "live", publishingV2: { enabled: true }, unifiedDirectory: { enabled: true, contractVersion: "players-unified-radar-v1", disclosure: { text: "Consent" } }, cities: [{ cityId: "moscow", regionId: "moscow-region", map: { availability: "missing" } }] }),
  useDirectoryFilters: () => ({ filters: { name: "", areaKey: "", cityId: "moscow", lookingOnly: false, trainerOnly: false }, update: vi.fn() }),
  // Snapshot generatedAt+30s is refresh-due; validUntil 2099 keeps authorized window renderable.
  useUnifiedDirectory: () => ({ controller: { matches: () => false, renderable: () => true }, view: { mode: "unified", snapshot: { contractVersion: "players-unified-radar-v1", policyVersion: "radar-geographic-sharing-v2", exposureMode: "authenticated_live", cityId: "moscow", regionId: "moscow-region", generatedAt: "2026-10-15T00:00:00Z", validUntil: "2099-01-01", refreshAfterSeconds: 30, query: { queryRef: "context", originState: "authorized", originRef: "origin", ordering: "radar_distance_then_directory", asOf: "2026-10-15T00:00:00Z" }, map: { availability: "missing", mapId: null, version: null }, items: mock.rows, page: { returnedCount: mock.rows.length, rankStart: 1, rankEnd: mock.rows.length, hasMore: false, nextCursor: null }, totals: { matchingTotal: 1, radarTotal: 1, ordinaryOnlyTotal: 0, completeness: "exact_at_asOf" } } satisfies UnifiedSnapshot, rows: mock.rows, busy: false } }),
}));
import { PlayersDirectoryPage } from "../src/components/consumer/pages/PlayersDirectoryPage";
it("Players exposes enable/unavailable and confirmed timer, and hides refreshed private rows after error", () => {
  mock.view = { phase: "off", confirmedOn: false, now: 0 } as RadarView;
  expect(renderToStaticMarkup(<PlayersDirectoryPage />)).toContain("Включить Radar");
  mock.view = { ...mock.view, phase: "disabled" };
  expect(renderToStaticMarkup(<PlayersDirectoryPage />)).toContain("Radar сейчас недоступен");
  mock.view = { ...mock.view, phase: "active", confirmedOn: true, status: { state: "active", contractVersion: "players-unified-radar-v1", activationId: "a", expiresAt: "2099-01-01", hardExpiresAt: "2099-01-01", foregroundUntil: "2099-01-01", locationValidUntil: "2099-01-01" } } as RadarView;
  mock.rows = [{ publicPlayerId: "private", projection: "radar_public", player: { publicPlayerId: "private", displayName: "Private", cityId: "moscow", areaKey: null, level: null, trainer: false, lookingForGame: null, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false }, radar: { resultId: "result", resultRef: "proof", consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: "2099-01-01", distance: null, geo: { latitude: 55.75, longitude: 37.61, crs: "EPSG:4326", model: "regional_grid_1000m_v1", gridSizeMeters: 1000, uncertaintyMeters: 1000, quality: "approximate", sourceTimestampBucket: "2026-10-15T00:00:00Z", sourceAgeSeconds: 0 } } }];
  const active = renderToStaticMarkup(<PlayersDirectoryPage />);
  expect(active).toContain("PRIVATE RADAR ROW");
  expect(active).toContain("Подтверждённый срок Radar");
  mock.view = { ...mock.view, phase: "error" };
  mock.rows = mock.rows.map(row => ({ ...row, publicPlayerId: "refreshed-private", player: { ...row.player, publicPlayerId: "refreshed-private" } })); // A directory refresh arrives with retained active status.
  const html = renderToStaticMarkup(<PlayersDirectoryPage />);
  expect(html).toContain("Проверить статус");
  expect(html).not.toContain("PRIVATE RADAR ROW");
  expect(html).not.toContain("Подтверждённый срок Radar");
});
