import { Children, isValidElement } from "react";
import type * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], maps: [] as FakeMap[], width: 400, markerCreates: 0, replace: vi.fn(), offset: vi.fn(), observer: (() => {}) as () => void, markerRemove: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useMemo: (fn: () => unknown) => fn(),
  useRef(initial: unknown) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useState(initial: unknown) {
    const i = h.cursor++; const slots = h.slots;
    if (!(i in slots)) slots[i] = initial;
    return [slots[i], (next: unknown) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as unknown[] | undefined;
    const cleanups = h.cleanups;
    if (!prev || deps.some((v, n) => v !== prev[n])) { h.slots[i] = deps; h.effects.push(() => { cleanups[i]?.(); cleanups[i] = effect() || (() => {}); }); }
  },
}));
vi.mock("../src/components/consumer/radar/RadarPage", () => ({ RadarPage: () => null }));
vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(), addProtocol: vi.fn(),
  Map: class {
  constructor() { h.maps.push(this); }
  handlers = new Map<string, ((event: unknown) => void)[]>();
  touchZoomRotate = { disableRotation: vi.fn() }; triggerRepaint = vi.fn(); resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off() {} emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  getCanvas() { return { setAttribute() {} }; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
},
  Marker: class { constructor() { h.markerCreates++; } setLngLat() { return this; } addTo() { return this; } remove = h.markerRemove; setOffset = h.offset; getLngLat() { return [37.6, 55.7]; } },
}));
import { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import type { VenueSummary } from "../src/lib/consumer-types";
class FakeMap {
  handlers = new Map<string, ((event: unknown) => void)[]>();
  touchZoomRotate = { disableRotation: vi.fn() }; triggerRepaint = vi.fn(); resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off() {} emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  getCanvas() { return { setAttribute() {} }; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
}

// The dynamic boundary remains identifiable; the harness reconciles its real child
// with a separate hook store instead of letting the server renderer run its hooks.
vi.mock("next/dynamic", () => ({ default: () => DynamicMap }));
function DynamicMap() { return null; }
vi.mock("../src/components/consumer/games/GamesMapDebugPanel", () => ({ GamesMapDebugPanel: () => null }));
vi.mock("../src/components/consumer/NavIcon", () => ({ shuttlecockElement: () => ({ setAttribute() {} }) }));
const api = vi.hoisted(() => ({ venues: [] as ((value: unknown) => void)[], games: [] as ((value: unknown) => void)[] }));
vi.mock("../src/lib/api-client", () => ({
  listAllCityVenues: vi.fn(() => new Promise(resolve => api.venues.push(resolve))),
  listAllUpcomingCityGames: vi.fn(() => new Promise(resolve => api.games.push(resolve))),
}));
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import type { Game } from "../src/lib/consumer-types";
type Store = { slots: unknown[]; cleanups: (() => void)[] };
let parent: Store;
let child: Store;
let mounted: boolean;
let childTree: React.ReactNode;
let lastProps: Parameters<typeof GamesVenueMap>[0] | undefined;
const venue = { id: "v", cityId: MOSCOW_BUNDLE.cityId, name: "Зал", latitude: 55.7, longitude: 37.6, timezone: "Europe/Moscow" } as VenueSummary;
const game = { id: "g", venue, status: "published", visibility: "public", availablePlaces: 2,
  startsAt: "2026-10-20T12:00:00Z", applicationDeadlineAt: "2026-10-20T11:00:00Z" } as Game;
function inStore<T>(store: Store, run: () => T): T {
  h.slots = store.slots; h.cleanups = store.cleanups; h.cursor = 0;
  const result = run();
  h.effects.splice(0).forEach(effect => effect());
  return result;
}
function findMap(node: React.ReactNode): Parameters<typeof GamesVenueMap>[0] | undefined {
  if (!isValidElement<{ children?: React.ReactNode }>(node)) return;
  if (node.type === DynamicMap) return node.props as Parameters<typeof GamesVenueMap>[0];
  for (const item of Children.toArray(node.props.children)) { const found = findMap(item); if (found) return found; }
}
function dispose(store: Store) { store.cleanups.splice(0).forEach(cleanup => cleanup?.()); store.slots = []; }
function render(day = "") {
  const tree = inStore(parent, () => GamesMapView({ cityId: MOSCOW_BUNDLE.cityId, day }));
  lastProps = findMap(tree);
  if (!lastProps) {
    if (mounted) dispose(child);
    mounted = false;
    return tree;
  }
  mounted = true;
  childTree = inStore(child, () => {
    const result = GamesVenueMap(lastProps!);
    const attach = (node: React.ReactNode): void => {
      if (!isValidElement<{ ref?: { current: unknown }; children?: React.ReactNode }>(node)) return;
      if (node.props.ref) node.props.ref.current = { getBoundingClientRect: () => ({ width: 400, height: 400 }) };
      Children.forEach(node.props.children, attach);
    };
    attach(result); return result;
  });
  return tree;
}
async function settle(ok = true) {
  const venues = api.venues.shift(); const games = api.games.shift();
  expect(venues).toBeDefined(); expect(games).toBeDefined();
  venues!({ ok, data: [venue] }); games!({ ok, data: [game] });
  await vi.advanceTimersByTimeAsync(0);
}
function clickRetry(node: React.ReactNode): void {
  if (!isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(node)) return;
  if (node.props.children === "Повторить") node.props.onClick?.();
  Children.forEach(node.props.children, clickRetry);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  parent = { slots: [], cleanups: [] }; child = { slots: [], cleanups: [] }; mounted = false;
  h.maps = []; h.effects = []; api.venues = []; api.games = [];
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru" } }));
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, createElement: () => ({ addEventListener() {}, setAttribute() {}, replaceChildren: h.replace, append() {} }) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(MOSCOW_BUNDLE.styleHash.match(/../g)!.map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  dispose(parent); if (mounted) dispose(child);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it.each(["unmount", "retry"])("preserves one actual Map through all A2 transitions, then removes on %s", async ending => {
  render(); render(); await settle(); render();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.maps).toHaveLength(1);
  const map = h.maps[0]!;
  map.emit("load"); map.emit("sourcedata", { sourceId: "protomaps", tile: { state: "loaded" } });
  render();
  const alive = () => { expect(mounted).toBe(true); expect(h.maps).toHaveLength(1); expect(map.remove).not.toHaveBeenCalled(); };
  expect(lastProps?.counts?.get("v")).toBe(1); alive();

  // Automatic background refresh, followed by focus and online revalidation.
  await vi.advanceTimersByTimeAsync(30000); render();
  expect(api.games).toHaveLength(1); expect(lastProps?.counts?.get("v")).toBe(1); alive();
  await settle(); render(); alive();
  window.dispatchEvent(new Event("focus")); render();
  expect(api.games).toHaveLength(1); expect(lastProps?.counts?.get("v")).toBe(1); alive();
  await settle(); render(); alive();
  window.dispatchEvent(new Event("online")); render();
  expect(api.games).toHaveLength(1); alive();
  await settle(); render(); alive();

  // A failed poll after success must pass gamesReady=false as null counts.
  await vi.advanceTimersByTimeAsync(30000); render(); alive();
  await settle(false);
  expect(renderToStaticMarkup(render())).toContain('role="alert"');
  expect(lastProps?.counts).toBeNull(); alive();
  render(); expect(lastProps?.counts).toBeNull(); alive(); // same Moscow cityId

  // Day change retains the Map while polling, then updates the counts again.
  render("2026-10-21"); expect(api.games).toHaveLength(1);
  expect(lastProps?.counts).toBeNull(); alive();
  await settle(); render("2026-10-21");
  expect(lastProps?.counts?.get("v")).toBe(0); alive();
  render("2026-10-21"); alive();

  if (ending === "unmount") {
    dispose(parent); dispose(child); mounted = false;
    expect(map.remove).toHaveBeenCalledOnce();
    expect(h.maps).toHaveLength(1);
  } else {
    map.emit("error", { error: { message: "WebGL context lost" } });
    render("2026-10-21");
    expect(renderToStaticMarkup(childTree)).toContain("Карта не загрузилась"); alive();
    clickRetry(childTree); render("2026-10-21");
    await vi.advanceTimersByTimeAsync(0);
    expect(map.remove).toHaveBeenCalledOnce(); expect(h.maps).toHaveLength(2);
    const replacement = h.maps[1]!;
    expect(replacement.remove).not.toHaveBeenCalled();
    dispose(parent); dispose(child); mounted = false;
    expect(map.remove).toHaveBeenCalledOnce(); expect(replacement.remove).toHaveBeenCalledOnce();
  }
});
