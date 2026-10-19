import { Children, isValidElement } from "react";
import type * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], maps: [] as FakeMap[], width: 400, buttons: [] as HTMLButtonElement[], markerCreates: 0, markerRemove: vi.fn(), resizeCallback: () => {}, lngLat: vi.fn(), replace: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useRef(initial: unknown) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useState(initial: unknown) {
    const i = h.cursor++; const slots = h.slots; if (!(i in slots)) slots[i] = initial;
    return [slots[i], (next: unknown) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) h.slots[i] = { deps, value: fn() };
    return (h.slots[i] as { value: unknown }).value;
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as unknown[] | undefined;
    if (!prev || deps.some((v, n) => v !== prev[n])) { h.slots[i] = deps; h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = effect() || (() => {}); }); }
  },
}));
vi.mock("../src/components/consumer/radar/RadarPage", () => ({ RadarPage: () => null }));
vi.mock("../src/components/consumer/NavIcon", () => ({ shuttlecockElement: () => ({ setAttribute() {} }) }));
vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(), addProtocol: vi.fn(),
  Map: class {
  constructor() { h.maps.push(this); }
  handlers = new Map<string, ((event: unknown) => void)[]>();
  touchZoomRotate = { disableRotation: vi.fn() }; resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off(name: string, fn: (event: unknown) => void) { this.handlers.set(name, (this.handlers.get(name) ?? []).filter(listener => listener !== fn)); } emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  canvas = Object.assign(new EventTarget(), { setAttribute() {} }); triggerRepaint = vi.fn();
  getCanvas() { return this.canvas; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
},
  Marker: class { constructor() { h.markerCreates++; } setLngLat() { h.lngLat(); return this; } addTo() { return this; } remove = h.markerRemove; setOffset() {} getLngLat() { return [37.6, 55.7]; } },
}));
vi.mock("next/dynamic", async () => {
  const module = await import("../src/components/consumer/games/GamesVenueMap");
  return { default: () => module.GamesVenueMap };
});
vi.mock("../src/lib/api-client", () => ({
  listAllCityVenues: () => transport.venues(),
  listAllUpcomingCityGames: () => transport.games(),
}));
const transport = vi.hoisted(() => ({ venues: vi.fn(), games: vi.fn() }));
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import type { VenueSummary } from "../src/lib/consumer-types";
class FakeMap {
  handlers = new Map<string, ((event: unknown) => void)[]>();
  touchZoomRotate = { disableRotation: vi.fn() }; resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off(name: string, fn: (event: unknown) => void) { this.handlers.set(name, (this.handlers.get(name) ?? []).filter(listener => listener !== fn)); } emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  canvas = Object.assign(new EventTarget(), { setAttribute() {} }); triggerRepaint = vi.fn();
  getCanvas() { return this.canvas; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
}
const venue = { id: "v", name: "Зал", latitude: 55.7, longitude: 37.6 } as VenueSummary;
const errorCard = vi.fn();
const availability = vi.fn(); const back = vi.fn();
function hasAlert(node: React.ReactNode): boolean {
  if (!isValidElement<{ role?: string; children?: React.ReactNode }>(node)) return false;
  return node.props.role === "alert" || Children.toArray(node.props.children).some(hasAlert);
}
beforeEach(() => {
  vi.useFakeTimers(); h.slots = []; h.cursor = 0; h.effects = []; h.cleanups = []; h.maps = []; h.width = 400;
  transport.games.mockReset(); transport.venues.mockReset();
  errorCard.mockClear(); availability.mockClear(); back.mockClear(); h.markerCreates = 0; h.markerRemove.mockClear(); h.buttons = []; h.lngLat.mockClear(); h.replace.mockClear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru" } }));
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { h.resizeCallback = fn; } observe() {} disconnect() {} });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, createElement: () => { const button = { addEventListener() {}, setAttribute() {}, replaceChildren: h.replace, append() {}, focus() { Object.assign(document, { activeElement: button }); } } as unknown as HTMLButtonElement; h.buttons.push(button); return button; } }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(MOSCOW_BUNDLE.styleHash.match(/../g)!.map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { h.cleanups.forEach(fn => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Separate hook storage for parent and child models React component identity.
it.each(["games", "venues", "reject"] as const)("keeps the real Moscow map through initial failure, automatic polling and %s refresh failure", async resource => {
  const child = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
  let childMounted = false;
  const countsSeen: (Map<string, number> | null)[] = [];
  const cycle = (day = "") => {
    h.cursor = 0;
    const tree = GamesMapView({ cityId: MOSCOW_BUNDLE.cityId, day });
    h.effects.splice(0).forEach(fn => fn());
    const parent = { slots: h.slots, cleanups: h.cleanups };
    const visit = (node: React.ReactNode): void => {
      if (!isValidElement<React.ComponentProps<typeof GamesVenueMap> & { children?: React.ReactNode }>(node)) return;
      if (node.type === GamesVenueMap) {
        countsSeen.push(node.props.counts); childMounted = true;
        h.slots = child.slots; h.cleanups = child.cleanups; h.cursor = 0;
        const mapTree = GamesVenueMap(node.props);
        const attach = (item: React.ReactNode): void => {
          if (!isValidElement<{ ref?: { current: unknown }; children?: React.ReactNode }>(item)) return;
          if (item.props.ref) item.props.ref.current = { getBoundingClientRect: () => ({ width: 400, height: 400 }) };
          Children.forEach(item.props.children, attach);
        };
        attach(mapTree); h.effects.splice(0).forEach(fn => fn());
        child.slots = h.slots; child.cleanups = h.cleanups;
        h.slots = parent.slots; h.cleanups = parent.cleanups;
      } else Children.forEach(node.props.children, visit);
    };
    visit(tree);
    return tree;
  };
  transport.venues.mockResolvedValue({ ok: false }); transport.games.mockResolvedValue({ ok: true, data: [] });
  cycle(); expect(childMounted).toBe(true); expect(countsSeen.at(-1)).toBeNull();
  await vi.waitFor(() => expect(h.maps).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(hasAlert(cycle())).toBe(true);
  expect(countsSeen.at(-1)).toBeNull();
  const map = h.maps[0]!; map.emit("load");
  transport.venues.mockResolvedValue({ ok: true, data: [venue] });
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); cycle(); cycle();
  expect(countsSeen.at(-1)?.get("v")).toBe(0);
  const verified = countsSeen.at(-1);
  const button = h.buttons[0]!; button.focus();
  h.lngLat.mockClear(); h.replace.mockClear();
  const calls = transport.games.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000); cycle(); cycle();
  expect(transport.games.mock.calls.length).toBeGreaterThan(calls);
  await vi.advanceTimersByTimeAsync(30000); cycle(); cycle();
  expect(countsSeen.at(-1)).toBe(verified);
  expect(h.buttons).toEqual([button]); expect(document.activeElement).toBe(button);
  expect(h.lngLat).not.toHaveBeenCalled(); expect(h.replace).not.toHaveBeenCalled();
  cycle("2026-10-20"); await vi.advanceTimersByTimeAsync(0); cycle("2026-10-20");
  if (resource === "reject") transport.games.mockRejectedValue(new Error("offline"));
  else if (resource === "games") transport.games.mockResolvedValue({ ok: false });
  else transport.venues.mockResolvedValue({ ok: false });
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); cycle("2026-10-20");
  expect(hasAlert(cycle("2026-10-20"))).toBe(true);
  expect(countsSeen.at(-1)).toBeNull(); expect(h.maps).toHaveLength(1); expect(map.remove).not.toHaveBeenCalled();
  child.cleanups.forEach(fn => fn?.()); expect(map.remove).toHaveBeenCalledOnce();
});
