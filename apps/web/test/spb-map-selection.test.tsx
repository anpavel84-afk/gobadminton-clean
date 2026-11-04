import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOSCOW_BUNDLE, SAINT_PETERSBURG_BUNDLE } from "../src/lib/radar-map-assets";
import { UnifiedDirectoryController } from "../src/lib/unified-directory";
import type { Me } from "../src/lib/consumer-types";
import type { apiFetch } from "../src/lib/api-client";

vi.mock("next/dynamic", () => ({
  default: () => () => createElement("div", { "data-testid": "venue-map" }),
}));
vi.mock("../src/components/consumer/games/MapLayerFilters", () => ({
  MapLayerFiltersProvider: ({ children }: { children: unknown }) => children,
  MapLayerFiltersControls: () => null,
  useMapLayerFilters: () => ({ applied: { venueMode: "all", showPlayersNearby: true } }),
}));

describe("Saint Petersburg map selection and unsupported city fallback", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders the map shell for SPb and keeps unknown cities on the honest list fallback", async () => {
    const { GamesMapView } = await import("../src/components/consumer/games/GamesMapView");
    const spb = renderToStaticMarkup(createElement(GamesMapView, { cityId: SAINT_PETERSBURG_BUNDLE.cityId, day: "" }));
    expect(spb).toContain('data-testid="venue-map"');
    expect(spb).not.toContain("Карта выбранного города пока недоступна");

    const moscow = renderToStaticMarkup(createElement(GamesMapView, { cityId: MOSCOW_BUNDLE.cityId, day: "" }));
    expect(moscow).toContain('data-testid="venue-map"');

    const unknown = renderToStaticMarkup(createElement(GamesMapView, { cityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", day: "" }));
    expect(unknown).toContain("Карта выбранного города пока недоступна. Все площадки доступны списком.");
    expect(unknown).not.toContain('data-testid="venue-map"');
  });

  it("clears controller camera when the city filter changes", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      data: {
        contractVersion: "players-unified-radar-v1",
        policyVersion: "radar-geographic-sharing-v2",
        exposureMode: "synthetic_demo",
        cityId: MOSCOW_BUNDLE.cityId,
        regionId: "moscow",
        generatedAt: "2030-01-01T00:00:00.000Z",
        validUntil: "2030-01-01T00:00:45.000Z",
        refreshAfterSeconds: 30,
        query: { queryRef: "q", asOf: "2030-01-01T00:00:00.000Z", ordering: "radar_city_then_directory", originState: "none", originRef: null },
        totals: { matchingTotal: 0, radarTotal: 0, ordinaryOnlyTotal: 0, completeness: "exact_at_asOf" },
        map: { availability: "missing", mapId: null, version: null },
        items: [],
        page: { returnedCount: 0, rankStart: null, rankEnd: null, hasMore: false, nextCursor: null },
      },
    }));
    const controller = new UnifiedDirectoryController(request as unknown as typeof apiFetch, () => Date.parse("2030-01-01T00:00:00Z"));
    controller.bind({ id: "viewer", csrfToken: "csrf" } as Me);
    await controller.query({ cityId: MOSCOW_BUNDLE.cityId });
    controller.camera = { center: MOSCOW_BUNDLE.center, zoom: 10.5 };
    await controller.query({ cityId: SAINT_PETERSBURG_BUNDLE.cityId });
    expect(controller.camera).toBeNull();
  });
});
