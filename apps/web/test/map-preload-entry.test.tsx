import type { ComponentProps, ComponentType, ReactElement, ReactNode } from "react";
import { isValidElement } from "react";
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

afterEach(() => {
  vi.doUnmock("next/dynamic");
  vi.doUnmock("../src/components/consumer/games/GamesVenueMap");
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

function findElement(
  node: ReactNode,
  predicate: (el: ReactElement) => boolean,
): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  const children = (node.props as { children?: ReactNode }).children;
  if (children == null) return null;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
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
  const { DiscoverySidebar } = await import("../src/components/consumer/discovery/DiscoveryComposition");
  const onMap = vi.fn();
  const tree = DiscoverySidebar({ city: "Москва", onMap });
  const preview = findElement(
    tree,
    (el) => el.type === "button" && (el.props as { className?: string }).className === "gb-discovery-map-preview",
  );
  expect(preview).toBeTruthy();
  const previewProps = preview!.props as {
    type?: string;
    onClick?: unknown;
    onFocus?: unknown;
    onPointerEnter?: unknown;
    children?: ReactNode;
  };
  expect(previewProps.type).toBe("button");
  expect(previewProps.onClick).toBe(onMap);
  // Focus/pointer preload stays on the discovery root effect, not the preview props.
  expect(previewProps.onFocus).toBeUndefined();
  expect(previewProps.onPointerEnter).toBeUndefined();
  expect(findElement(previewProps.children, (el) => el.type === "button" || el.type === "a")).toBeNull();

  const html = renderToStaticMarkup(tree);
  expect(html).toContain('class="gb-discovery-map-preview"');
  expect(html).toContain('aria-label="Все игры на карте"');
  expect(html.match(/<button\b/g)?.length).toBe(1);
  // Sidebar preview is the native control; floating feed CTA owns gb-map-desktop-entry.
  expect(html).not.toContain("gb-map-desktop-entry");
  expect(html).not.toMatch(/gb-discovery-map-preview[\s\S]*<button\b/);
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
