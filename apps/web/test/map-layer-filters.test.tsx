import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
}));

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useId: () => "map-filters-title",
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    const slots = hooks.slots;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next: T | ((old: T) => T)) => {
      slots[index] = typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
    }];
  },
  useRef(initial: unknown) {
    const i = hooks.cursor++;
    return hooks.slots[i] ??= { current: initial };
  },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const i = hooks.cursor++;
    const prev = hooks.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) hooks.slots[i] = { deps, value: fn() };
    return (hooks.slots[i] as { value: unknown }).value;
  },
  useCallback(fn: unknown) { return fn; },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((value, i) => value !== previous[i])) {
      hooks.slots[index] = deps;
      hooks.effects.push(() => {
        hooks.cleanups[index]?.();
        hooks.cleanups[index] = effect() || (() => {});
      });
    }
  },
}));

import {
  MapLayerFiltersControls,
  MapLayerFiltersProvider,
  useMapLayerFilters,
} from "../src/components/consumer/games/MapLayerFilters";
import { DEFAULT_MAP_LAYER_FILTERS } from "../src/lib/map-layer-filters";
import { filterVenuesForMapLayer } from "../src/lib/map-layer-filters";
import type { VenueSummary } from "../src/lib/consumer-types";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

function flush(tree: ReactNode) {
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}

function clickLabel(tree: ReactNode, label: string) {
  for (const node of elements(tree)) {
    const html = renderToStaticMarkup(node);
    if (!html.includes(label)) continue;
    const onClick = node.props.onClick as (() => void) | undefined;
    if (typeof onClick === "function" && (node.type === "button" || typeof node.type !== "string")) {
      onClick();
      return true;
    }
  }
  // Prefer exact button text match via children walk.
  for (const node of elements(tree)) {
    if (node.type !== "button") continue;
    const text = typeof node.props.children === "string"
      ? node.props.children
      : renderToStaticMarkup(<>{node.props.children as ReactNode}</>);
    if (text.includes(label) && typeof node.props.onClick === "function") {
      (node.props.onClick as () => void)();
      return true;
    }
  }
  return false;
}

function Probe({ onRead }: { onRead: (value: ReturnType<typeof useMapLayerFilters>) => void }) {
  onRead(useMapLayerFilters());
  return null;
}

describe("MapLayerFiltersControls draft/apply/reset", () => {
  beforeEach(() => {
    hooks.slots = [];
    hooks.effects = [];
    hooks.cleanups = [];
    hooks.cursor = 0;
    document.body.style.overflow = "";
    Object.assign(document, { activeElement: document.body });
  });
  afterEach(() => {
    hooks.cleanups.splice(0).forEach(cleanup => cleanup?.());
  });

  it("keeps draft changes until Apply; reset draft does not change applied", () => {
    let applied = DEFAULT_MAP_LAYER_FILTERS;
    const read = (value: ReturnType<typeof useMapLayerFilters>) => { applied = value.applied; };
    const render = () => {
      hooks.cursor = 0;
      return flush(
        <MapLayerFiltersProvider>
          <Probe onRead={read} />
          <MapLayerFiltersControls />
        </MapLayerFiltersProvider>,
      );
    };

    let tree = render();
    expect(applied).toEqual(DEFAULT_MAP_LAYER_FILTERS);
    expect(renderToStaticMarkup(tree)).toContain("Фильтры");
    expect(renderToStaticMarkup(tree)).not.toContain("Фильтры карты");

    expect(clickLabel(tree, "Фильтры")).toBe(true);
    tree = render();
    expect(renderToStaticMarkup(tree)).toContain("Фильтры карты");
    expect(renderToStaticMarkup(tree)).toContain("Площадки");
    expect(renderToStaticMarkup(tree)).toContain("Радар игроков");
    expect(renderToStaticMarkup(tree)).toContain("Показывать игроков рядом");
    expect(renderToStaticMarkup(tree)).toContain("Показать все доступные площадки");
    expect(renderToStaticMarkup(tree)).toContain("Показать только площадки, где есть игры");
    expect(renderToStaticMarkup(tree)).toContain("На карте будут показаны игроки поблизости");

    expect(clickLabel(tree, "Только с играми")).toBe(true);
    tree = render();
    expect(applied.venueMode).toBe("all");

    expect(clickLabel(tree, "Сбросить всё")).toBe(true);
    tree = render();
    expect(applied).toEqual(DEFAULT_MAP_LAYER_FILTERS);

    expect(clickLabel(tree, "Только с играми")).toBe(true);
    tree = render();
    expect(clickLabel(tree, "Показывать игроков рядом")).toBe(true);
    expect(clickLabel(render(), "Применить")).toBe(true);
    tree = render();
    expect(applied).toEqual({ venueMode: "with_games", showPlayersNearby: false });
    expect(renderToStaticMarkup(tree)).toContain("Сбросить фильтры");
    expect(renderToStaticMarkup(tree)).toContain("Только с играми");
    expect(renderToStaticMarkup(tree)).toContain("Радар выключен");

    expect(clickLabel(tree, "Сбросить фильтры")).toBe(true);
    tree = render();
    expect(applied).toEqual(DEFAULT_MAP_LAYER_FILTERS);
  });

  it("player-layer toggle is display-only state and never implies Radar activation APIs", async () => {
    const source = await import("node:fs/promises").then(fs =>
      fs.readFile(new URL("../src/components/consumer/games/MapLayerFilters.tsx", import.meta.url), "utf8"));
    const radarPage = await import("node:fs/promises").then(fs =>
      fs.readFile(new URL("../src/components/consumer/radar/RadarPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain("Показывать игроков рядом");
    expect(source).not.toMatch(/activate\(|permission\(|acquireRadarLocation/);
    expect(radarPage).toContain("showPlayersNearby");
    expect(radarPage).toContain("playersVisible");
    expect(radarPage).toMatch(/Display-layer only/);
  });

  it("preserves selection against canonical venues while marker filter hides confirmed empty", () => {
    const venues = [
      { id: "keep", name: "С игрой" },
      { id: "hide", name: "Без игр" },
      { id: "unknown", name: "Расписание неизвестно" },
    ] as VenueSummary[];
    const counts = new Map([["keep", 3], ["hide", 0]]);
    const selectedId = "hide";
    const markers = filterVenuesForMapLayer(venues, counts, "with_games");
    expect(markers.map(v => v.id)).toEqual(["keep", "unknown"]);
    // Selection resolves from the unfiltered canonical list, not marker filter output.
    expect(venues.find(v => v.id === selectedId)?.id).toBe("hide");
    expect(markers.find(v => v.id === selectedId)).toBeUndefined();
  });
});
