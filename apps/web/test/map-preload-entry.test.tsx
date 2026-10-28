import type { ButtonHTMLAttributes, ComponentProps, ComponentType, ReactElement, ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DynamicOptions, Loader } from "next/dynamic";
import { afterEach, expect, it, vi } from "vitest";
import type { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";

type MapProps = ComponentProps<typeof GamesVenueMap>;
type MapLoader = Extract<Loader<MapProps>, () => unknown>;
type DynamicCapture = {
  loader: MapLoader;
  options: DynamicOptions<MapProps>;
};

const buttonProps = vi.hoisted(() => ({ current: null as ButtonHTMLAttributes<HTMLButtonElement> | null }));

afterEach(() => {
  buttonProps.current = null;
  vi.doUnmock("next/dynamic");
  vi.doUnmock("../src/components/consumer/games/GamesVenueMap");
  vi.doUnmock("../src/components/consumer/Button");
  vi.doUnmock("../src/components/consumer/NavIcon");
  vi.resetModules();
});

async function importMapView() {
  vi.resetModules();
  const mapExport = vi.fn<(props: MapProps) => ReactElement>(() => <div data-testid="venue-map" />);
  vi.doMock("../src/components/consumer/games/GamesVenueMap", () => ({ GamesVenueMap: mapExport }));
  const registration: { current?: DynamicCapture } = {};
  vi.doMock("next/dynamic", () => ({
    default: (loader: MapLoader, options: DynamicOptions<MapProps>): ComponentType<MapProps> => {
      registration.current = { loader, options };
      return function Pending() { return null; };
    },
  }));
  const mod = await import("../src/components/consumer/games/GamesMapView");
  if (!registration.current) throw new Error("GamesMapView did not register next/dynamic");
  return { ...mod, captured: registration.current, mapExport };
}

it("keeps the Next dynamic literal import with ssr:false and warms without instantiating the map", async () => {
  const { captured, warmGamesVenueMapModule, mapExport } = await importMapView();
  expect(captured.options.ssr).toBe(false);
  expect(captured.options.loading).toBeTruthy();

  const loaded = await captured.loader();
  const component = "default" in loaded ? loaded.default : loaded;
  expect(component).toBe(mapExport);
  expect(mapExport).not.toHaveBeenCalled();

  await warmGamesVenueMapModule();
  expect(mapExport).not.toHaveBeenCalled();
});

it("keeps desktop map entry class for effect-owned root intent delegation", async () => {
  vi.resetModules();
  vi.doMock("../src/components/consumer/NavIcon", () => ({ FoldedMapGlyph: () => null }));
  vi.doMock("../src/components/consumer/Button", () => ({
    Button: (props: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => {
      buttonProps.current = props;
      return createElement("button", { type: "button", className: props.className }, props.children);
    },
  }));
  const { DiscoverySidebar } = await import("../src/components/consumer/discovery/DiscoveryComposition");
  const onMap = vi.fn();
  const html = renderToStaticMarkup(
    <DiscoverySidebar city="Москва" onMap={onMap} />,
  );
  expect(html).toContain("gb-map-desktop-entry");
  expect(buttonProps.current?.onClick).toBe(onMap);
  expect(buttonProps.current?.onFocus).toBeUndefined();
  expect(buttonProps.current?.onPointerEnter).toBeUndefined();
});

it("does not claim Moscow map UI for an unsupported city branch", async () => {
  const { GamesMapView } = await importMapView();
  const html = renderToStaticMarkup(<GamesMapView cityId="another-city" day="" />);
  expect(html).toContain("Карта выбранного города пока недоступна");
  expect(html).not.toContain("data-testid=\"venue-map\"");
});

/** Exercise the registered loader independently of Vite source rewriting. */
it("registers a callable loader that resolves the expected map component", async () => {
  const { captured, mapExport } = await importMapView();
  expect(typeof captured.loader).toBe("function");
  const loaded = await captured.loader();
  const component = "default" in loaded ? loaded.default : loaded;
  expect(component).toBe(mapExport);
});
