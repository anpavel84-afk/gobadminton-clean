import type { ComponentProps, ComponentType, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DynamicOptions, Loader } from "next/dynamic";
import { afterEach, expect, it, vi } from "vitest";
import { GamesMapModuleLoading } from "../src/components/consumer/games/GamesMapModuleLoading";
import type { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";

type MapProps = ComponentProps<typeof GamesVenueMap>;
// This mock accepts the loader function, not Next's alternative promise form.
type MapLoader = Extract<Loader<MapProps>, () => unknown>;
type DynamicCapture = {
  loader: MapLoader;
  options: DynamicOptions<MapProps>;
  resolved?: ComponentType<MapProps>;
};

/** This models pending/resolved dynamic rendering, not Next or browser chunk timing. */
async function importView(outcome: "success" | "failure" = "success") {
  vi.resetModules();
  const mapExport = vi.fn<(props: MapProps) => ReactElement>(props => <div data-testid="resolved-venue-map" data-venue-count={props.venues.length} />);
  vi.doMock("../src/components/consumer/games/GamesVenueMap", () => {
    if (outcome === "failure") throw new Error("Map module import rejected");
    return { GamesVenueMap: mapExport };
  });

  const registration: { current?: DynamicCapture } = {};
  vi.doMock("next/dynamic", () => ({
    default: (loader: MapLoader, options: DynamicOptions<MapProps>): ComponentType<MapProps> => {
      const current: DynamicCapture = { loader, options };
      registration.current = current;
      return function MockDynamicMap(props: MapProps) {
        const Resolved = current.resolved;
        if (Resolved) return <Resolved {...props} />;
        return options.loading?.({ isLoading: true, pastDelay: true, timedOut: false, error: null }) ?? null;
      };
    },
  }));

  const { GamesMapView } = await import("../src/components/consumer/games/GamesMapView");
  const { GamesMapModuleLoading: Loading } = await import("../src/components/consumer/games/GamesMapModuleLoading");
  const captured = registration.current;
  if (!captured) throw new Error("GamesMapView did not register its dynamic map");
  return { GamesMapView, Loading, captured, mapExport };
}

async function resolveMap(captured: DynamicCapture) {
  const loaded = await captured.loader();
  const component = "default" in loaded ? loaded.default : loaded;
  captured.resolved = component;
  return component;
}

afterEach(() => {
  vi.doUnmock("next/dynamic");
  vi.doUnmock("../src/components/consumer/games/GamesVenueMap");
  vi.resetModules();
});

it("renders one polite atomic module status and a decorative progress bar inside the map area", () => {
  const html = renderToStaticMarkup(<GamesMapModuleLoading />);
  expect(html).toContain('class="gb-games-map-area gb-games-map-module-loading"');
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
  expect(html).toContain(">Загружаем карту…</p>");
  expect(html).toContain('<div class="gb-games-map-module-loading__progress" aria-hidden="true"><span></span></div>');
  expect(html).not.toContain("gb-map-sr-only");
  expect(html).not.toContain("aria-valuenow");
});

it("registers the real loading component with ssr:false and resolves to the exact map export", async () => {
  const { GamesMapView, Loading, captured, mapExport } = await importView();
  expect(captured.options.ssr).toBe(false);
  expect(captured.options.loading).toBe(Loading);
  const loading = captured.options.loading;
  if (!loading) throw new Error("Missing module loading component");
  expect(renderToStaticMarkup(<>{loading({ isLoading: true, pastDelay: true })}</>)).toBe(renderToStaticMarkup(<Loading />));

  const onReturnToList = vi.fn<() => void>();
  const pending = renderToStaticMarkup(<GamesMapView cityId={MOSCOW_BUNDLE.cityId} day="" onReturnToList={onReturnToList} />);
  expect(pending).toContain("Загружаем карту…");
  expect(mapExport).not.toHaveBeenCalled();
  expect(await resolveMap(captured)).toBe(mapExport);

  const html = renderToStaticMarkup(<GamesMapView cityId={MOSCOW_BUNDLE.cityId} day="" onReturnToList={onReturnToList} />);
  expect(html).toContain('data-testid="resolved-venue-map"');
  expect(html).not.toContain("Загружаем карту…");
  expect(html).toContain("Загружаем все площадки и расписание…");
  expect(mapExport.mock.calls.at(-1)?.[0]).toEqual({
    venues: [], counts: null, selectedVenueId: null,
    onSelect: expect.any(Function), onDeselect: expect.any(Function),
    onAvailability: expect.any(Function), onErrorCardChange: expect.any(Function), onReturnToList,
  });
});

it("resolves a rejected import to a stable alert and keeps the existing return action", async () => {
  const { GamesMapView, captured, mapExport } = await importView("failure");
  const onReturnToList = vi.fn<() => void>();
  const pending = renderToStaticMarkup(<GamesMapView cityId={MOSCOW_BUNDLE.cityId} day="" onReturnToList={onReturnToList} />);
  expect(pending).toContain("Загружаем карту…");

  const ErrorComponent = await resolveMap(captured);
  expect(await resolveMap(captured)).toBe(ErrorComponent);
  const alert = renderToStaticMarkup(<ErrorComponent venues={[]} counts={null} onSelect={() => {}} onReturnToList={onReturnToList} />);
  expect(alert.match(/role="alert"/g)).toHaveLength(1);
  expect(alert).toContain("<h2>Карта не загрузилась</h2>");
  expect(alert).toContain("Не удалось загрузить модуль карты. Площадки доступны списком.");
  expect(alert).not.toContain("Загружаем карту…");
  expect(alert).toContain("К списку");
  expect(alert).not.toContain("Повторить");

  const html = renderToStaticMarkup(<GamesMapView cityId={MOSCOW_BUNDLE.cityId} day="" onReturnToList={onReturnToList} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("Карта не загрузилась");
  expect(html).toContain("Не удалось загрузить модуль карты. Площадки доступны списком.");
  expect(html.match(/aria-label="К списку игр"/g)).toHaveLength(1);
  expect(html).toContain("Загружаем все площадки и расписание…");
  expect(html).not.toContain("Загружаем карту…");
  expect(mapExport).not.toHaveBeenCalled();
  // SSR does not execute onAvailability's effect or prove a populated fallback list.
});

it("offers list navigation when the failed module has no return callback", async () => {
  const { GamesMapView, captured } = await importView("failure");
  await resolveMap(captured);
  const html = renderToStaticMarkup(<GamesMapView cityId={MOSCOW_BUNDLE.cityId} day="" />);
  expect(html).toContain('href="/games"');
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("Загружаем карту…");
});

it.each([
  { label: "Moscow map", cityId: MOSCOW_BUNDLE.cityId, venueId: undefined, modulePending: true },
  { label: "another city", cityId: "another-city", venueId: undefined, modulePending: false },
  { label: "venue schedule", cityId: MOSCOW_BUNDLE.cityId, venueId: "venue-id", modulePending: false },
])("limits the pending module UI to the $label branch", async ({ cityId, venueId, modulePending }) => {
  const { GamesMapView } = await importView();
  const html = renderToStaticMarkup(<GamesMapView cityId={cityId} venueId={venueId} day="" />);
  expect(html.includes("Загружаем карту…")).toBe(modulePending);
  expect(html.includes('class="gb-games-map-area gb-games-map-module-loading"')).toBe(modulePending);
  if (venueId) expect(html).toContain('aria-label="Расписание площадки"');
  else if (!modulePending) expect(html).toContain("Карта выбранного города пока недоступна. Все площадки доступны списком.");
});
