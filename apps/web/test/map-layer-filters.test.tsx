import { Children, Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
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
  useCallback(fn: unknown, deps: unknown[]) {
    const i = hooks.cursor++;
    const prev = hooks.slots[i] as { deps: unknown[]; fn: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) hooks.slots[i] = { deps, fn };
    return (hooks.slots[i] as { fn: unknown }).fn;
  },
  useContext(context: { _currentValue: unknown }) { return context._currentValue; },
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

type FiberStore = { slots: unknown[]; cleanups: (() => void)[] };
const fibers = new Map<string, FiberStore>();

function fiberFor(key: string): FiberStore {
  let store = fibers.get(key);
  if (!store) { store = { slots: [], cleanups: [] }; fibers.set(key, store); }
  return store;
}

function expandChildren(children: ReactNode, path: string): ReactNode {
  return Children.map(children, (child, index) => expand(child, `${path}/${index}`));
}

/** Expand function components and Context.Provider so clicks hit real host controls. */
function expand(node: ReactNode, path = "root"): ReactNode {
  if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}.${index}`));
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (node.type === Fragment) {
    return <Fragment>{expandChildren(node.props.children as ReactNode, `${path}/fragment`)}</Fragment>;
  }
  if (typeof node.type === "function") {
    const key = `${path}:${node.type.name || "fn"}:${String(node.key ?? "")}`;
    const store = fiberFor(key);
    const saved = { slots: hooks.slots, cleanups: hooks.cleanups, cursor: hooks.cursor, effects: hooks.effects };
    hooks.slots = store.slots; hooks.cleanups = store.cleanups; hooks.cursor = 0; hooks.effects = [];
    const output = (node.type as (props: Record<string, unknown>) => ReactNode)(node.props);
    hooks.effects.splice(0).forEach(effect => effect());
    store.slots = hooks.slots; store.cleanups = hooks.cleanups;
    hooks.slots = saved.slots; hooks.cleanups = saved.cleanups; hooks.cursor = saved.cursor; hooks.effects = saved.effects;
    return expand(output, `${key}.out`);
  }
  if (node.type && typeof node.type === "object" && ("_context" in node.type || ("Provider" in node.type && "_currentValue" in node.type))) {
    const provider = node.type as { _context?: { _currentValue: unknown }; _currentValue?: unknown };
    const context = provider._context ?? provider;
    const previous = context._currentValue;
    context._currentValue = node.props.value;
    try {
      return expandChildren(node.props.children as ReactNode, `${path}/provider`);
    } finally {
      context._currentValue = previous;
    }
  }
  return cloneElement(node, undefined, expandChildren(node.props.children as ReactNode, path));
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

function clickLabel(tree: ReactNode, label: string) {
  for (const node of elements(tree)) {
    if (node.props["aria-label"] === label && typeof node.props.onClick === "function") {
      (node.props.onClick as () => void)();
      return true;
    }
  }
  for (const node of elements(tree)) {
    if (typeof node.props.onClick !== "function") continue;
    try {
      const html = renderToStaticMarkup(node);
      if (html.includes(label)) {
        (node.props.onClick as () => void)();
        return true;
      }
    } catch {
      // Non-serializable nodes are skipped; host buttons are preferred above.
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
    fibers.clear();
    const body = { style: { overflow: "" } };
    vi.stubGlobal("document", { body, activeElement: body });
    const raf = (callback: () => void) => { callback(); return 1; };
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      requestAnimationFrame: raf, cancelAnimationFrame: () => {},
    }));
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    for (const store of fibers.values()) store.cleanups.forEach(cleanup => cleanup?.());
    hooks.cleanups.splice(0).forEach(cleanup => cleanup?.());
    vi.unstubAllGlobals();
  });

  it("keeps draft changes until Apply; reset draft does not change applied", () => {
    let applied = DEFAULT_MAP_LAYER_FILTERS;
    const read = (value: ReturnType<typeof useMapLayerFilters>) => { applied = value.applied; };
    const render = () => expand(
      <MapLayerFiltersProvider>
        <Probe onRead={read} />
        <MapLayerFiltersControls />
      </MapLayerFiltersProvider>,
    );

    let tree = render();
    expect(applied).toEqual(DEFAULT_MAP_LAYER_FILTERS);
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Фильтры");
    expect(renderToStaticMarkup(<>{tree}</>)).not.toContain('role="dialog"');

    expect(clickLabel(tree, "Фильтры")).toBe(true);
    tree = render();
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Фильтры карты");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain('role="dialog"');
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Площадки");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Радар игроков");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Показывать игроков рядом");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Показать все доступные площадки");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Показать только площадки, где есть игры");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("На карте будут показаны игроки поблизости");

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
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Сбросить фильтры");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Только с играми");
    expect(renderToStaticMarkup(<>{tree}</>)).toContain("Радар выключен");

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
