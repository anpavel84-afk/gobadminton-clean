import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DynamicOptions } from "next/dynamic";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeographicRadarMap } from "../src/components/consumer/radar/GeographicRadarMap";
import { RadarMapModuleLoading } from "../src/components/consumer/radar/RadarMapModuleLoading";
import { UnifiedDirectoryController } from "../src/lib/unified-directory";

type MapProps = ComponentProps<typeof GeographicRadarMap>;
type MapLoader = () => Promise<ComponentType<MapProps>>;
const h = vi.hoisted(() => ({
  capture: vi.fn<(loader: MapLoader, options: DynamicOptions<MapProps>) => void>(),
  map: vi.fn<(props: MapProps) => null>(() => null),
}));

vi.mock("next/dynamic", () => ({
  default: (loader: MapLoader, options: DynamicOptions<MapProps>) => {
    h.capture(loader, options);
    return () => null;
  },
}));
vi.mock("../src/components/consumer/games/GamesMapView", () => ({ GamesMapView: () => null }));

beforeEach(() => {
  vi.resetModules();
  h.capture.mockClear();
  h.map.mockClear();
});

async function captureDynamic(rejectImport = false) {
  vi.doMock("../src/components/consumer/radar/GeographicRadarMap", () => {
    if (rejectImport) throw new Error("Radar chunk unavailable");
    return { GeographicRadarMap: h.map };
  });
  await import("../src/components/consumer/radar/RadarPage");
  expect(h.capture).toHaveBeenCalledOnce();
  const call = h.capture.mock.calls[0];
  if (!call) throw new Error("Radar dynamic loader was not captured");
  return call;
}

describe("Radar map module loading", () => {
  it("renders the real pure status and a decorative dot", () => {
    expect(renderToStaticMarkup(createElement(RadarMapModuleLoading))).toBe(
      '<p class="gb-radar-map-module-loading" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true"></span><span>Загружаем карту…</span></p>',
    );
  });

  it("keeps SSR disabled and uses the real loading component", async () => {
    const [, options] = await captureDynamic();
    const { RadarMapModuleLoading: LoadingComponent } = await import("../src/components/consumer/radar/RadarMapModuleLoading");
    expect(options.ssr).toBe(false);
    expect(options.loading).toBe(LoadingComponent);
    const Loading = options.loading;
    if (!Loading) throw new Error("Radar loading component missing");
    expect(renderToStaticMarkup(createElement(Loading, {}))).toBe(
      renderToStaticMarkup(createElement(RadarMapModuleLoading)),
    );
  });

  it("resolves the imported map component on successful module loading", async () => {
    const [loader] = await captureDynamic();
    expect(await loader()).toBe(h.map);
  });

  it("resolves an alert component after an import rejection without loading copy", async () => {
    const [loader] = await captureDynamic(true);
    const Component = await loader();
    expect(Component).not.toBe(h.map);
    const onUnavailable = vi.fn();
    // Server rendering checks the alert before the mount effect can set failed.
    const html = renderToStaticMarkup(createElement(Component, {
      controller: new UnifiedDirectoryController(), rows: [], selected: null,
      onSelect: vi.fn(), onUnavailable,
    }));
    expect(html).toBe('<p role="alert" class="gb-map-position-unavailable">Не удалось загрузить участников Radar. Площадки и игры остаются на карте.</p>');
    expect(html).not.toContain("Загружаем карту…");
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
