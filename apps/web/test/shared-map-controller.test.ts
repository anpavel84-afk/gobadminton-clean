import { expect, it, vi } from "vitest";
import type { UnifiedPreview, UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import type { Me } from "../src/lib/consumer-types";
import type { apiFetch } from "../src/lib/api-client";
import { liveUnifiedPreview, UnifiedDirectoryController } from "../src/lib/unified-directory";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";

const now = Date.parse("2030-01-01T00:00:00Z");
const until = new Date(now + 45000).toISOString();
function person(name: "one" | "two" | "page-two"): UnifiedRow {
  const id = { one: "00000000-0000-4000-8000-000000000001", two: "00000000-0000-4000-8000-000000000002", "page-two": "00000000-0000-4000-8000-000000000003" }[name];
  return {
    publicPlayerId: id, projection: "directory",
    player: { publicPlayerId: id, displayName: "Алексей", cityId: MOSCOW_BUNDLE.cityId, areaKey: null, level: null, trainer: false, lookingForGame: true, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false },
    radar: { resultId: id, resultRef: `ref-${id}`, consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: until, distance: null,
      geo: { latitude: 55.75, longitude: 37.61, crs: "EPSG:4326", model: "regional_grid_100m_v1", gridSizeMeters: 100, uncertaintyMeters: 100, quality: "approximate", sourceTimestampBucket: new Date(now).toISOString(), sourceAgeSeconds: 0 } },
  };
}
const first = person("one"), second = person("two"), later = person("page-two");
const base: UnifiedSnapshot = {
  contractVersion: "players-unified-radar-v1", policyVersion: "radar-geographic-sharing-v2", exposureMode: "synthetic_demo", cityId: MOSCOW_BUNDLE.cityId, regionId: "moscow",
  generatedAt: new Date(now).toISOString(), validUntil: until, refreshAfterSeconds: 30,
  query: { queryRef: "query", asOf: new Date(now).toISOString(), ordering: "radar_city_then_directory", originState: "none", originRef: null },
  totals: { matchingTotal: 101, radarTotal: 101, ordinaryOnlyTotal: 0, completeness: "exact_at_asOf" },
  map: { availability: "missing", mapId: null, version: null }, items: [first, second],
  page: { returnedCount: 2, rankStart: 1, rankEnd: 2, hasMore: false, nextCursor: null },
};
/** Preview is a closed projection, not a directory row or a map proof envelope. */
function previewFor(row: UnifiedRow): UnifiedPreview {
  const { publicPlayerId, displayName, level, trainer, avatar, canRequestContact } = row.player;
  const { consentPolicyVersion, geo, validUntil, distance } = row.radar!;
  return { player: { publicPlayerId, displayName, level, trainer, avatar, canRequestContact },
    proximityBand: null, radar: { consentPolicyVersion, geo, validUntil, distance }, upcomingGames: [] };
}
function harness() {
  const request = vi.fn(async (path: string, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body));
    if (path === "/v1/players/query/map") return { ok: true, status: 200, data: {
      ...base, items: body.mapCursor ? [later] : [first, second],
      mapPage: { returnedCount: body.mapCursor ? 1 : 2, rankStart: body.mapCursor ? 101 : 1, rankEnd: body.mapCursor ? 101 : 2, hasMore: !body.mapCursor, nextMapCursor: body.mapCursor ? null : "next-private-window" },
    } };
    if (path === "/v1/radar/results/preview") {
      const row = [first, second, later].find(row => row.radar!.resultRef === body.resultRef)!;
      return { ok: true, status: 200, data: previewFor(row) };
    }
    return { ok: true, status: 200, data: base };
  });
  const controller = new UnifiedDirectoryController(request as unknown as typeof apiFetch, () => now);
  controller.bind({ id: "any-viewer", csrfToken: "csrf" } as Me);
  return { controller, request };
}
it("R2 retains nextMapCursor/limit100 and reaches people beyond the first bounded window", async () => {
  const { controller, request } = harness();
  await controller.query({ cityId: MOSCOW_BUNDLE.cityId }); await controller.map(); await controller.map(true);
  const calls = request.mock.calls.filter(([path]) => path === "/v1/players/query/map");
  expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({ contractVersion: "players-unified-radar-v1", queryRef: "query", limit: 100 });
  expect(JSON.parse(String(calls[1]![1]!.body))).toEqual({ contractVersion: "players-unified-radar-v1", queryRef: "query", mapCursor: "next-private-window", limit: 100 });
  expect(controller.view.pins.map(row => row.publicPlayerId)).toEqual([later.publicPlayerId]);
  await controller.map(true); expect(request.mock.calls.filter(([path]) => path.endsWith("/map"))).toHaveLength(2);
});
it("R4 same-name people select independently by publicPlayerId; OFF clears private selection", async () => {
  const { controller, request } = harness();
  await controller.query({ cityId: MOSCOW_BUNDLE.cityId }); await controller.map();
  await controller.select(controller.view.pins[0]!);
  expect(controller.view.selected).toBe(first.publicPlayerId); expect(controller.view.preview?.player.publicPlayerId).toBe(first.publicPlayerId);
  controller.close(); await controller.select(controller.view.pins[1]!);
  expect(controller.view.selected).toBe(second.publicPlayerId); expect(controller.view.preview?.player.publicPlayerId).toBe(second.publicPlayerId);
  const refs = request.mock.calls.filter(([path]) => path.endsWith("/preview")).map(([, init]) => JSON.parse(String(init!.body)).resultRef);
  expect(refs).toEqual([first.radar!.resultRef, second.radar!.resultRef]);
  expect(controller.view.preview?.upcomingGames).toEqual([]);
  expect(liveUnifiedPreview(controller.view.preview, second.publicPlayerId, now)).toBe(true);
  controller.ordinary(); expect(controller.view.pins).toEqual([]); expect(controller.view.selected).toBeNull(); expect(controller.view.preview).toBeNull();
});

it("accepts the closed preview fixture and rejects leaked directory/proof fields and missing games", () => {
  const valid = previewFor(first);
  expect(liveUnifiedPreview(valid, first.publicPlayerId, now)).toBe(true);
  for (const invalid of [
    { ...valid, player: first.player },
    { ...valid, radar: first.radar },
    { ...valid, upcomingGames: undefined },
    { ...valid, player: { ...valid.player, contact: "private" } },
  ]) expect(liveUnifiedPreview(invalid as unknown as UnifiedPreview, first.publicPlayerId, now)).toBe(false);
});
