import { Children, isValidElement } from "react";
import type * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], maps: [] as FakeMap[], width: 400, buttons: [] as HTMLButtonElement[], selected: null as string | null, markerCreates: 0, markerRemove: vi.fn(), resizeCallback: () => {}, lngLat: vi.fn(), replace: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useRef(initial: unknown) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useState(initial: unknown) {
    const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? next(h.slots[i]) : next; }];
  },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) h.slots[i] = { deps, value: fn() };
    return (h.slots[i] as { value: unknown }).value;
  },
  useCallback(fn: unknown, deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as { deps: unknown[]; fn: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) h.slots[i] = { deps, fn };
    return (h.slots[i] as { fn: unknown }).fn;
  },
  useContext(context: { _currentValue: unknown }) { return context._currentValue; },
  useLayoutEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as unknown[] | undefined;
    if (!prev || deps.some((v, n) => v !== prev[n])) { h.slots[i] = deps; h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = effect() || (() => {}); }); }
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
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo = vi.fn(); isMoving() { return false; }
},
  Marker: class { constructor() { h.markerCreates++; } setLngLat(position: number[]) { h.lngLat(position); return this; } addTo() { return this; } remove = h.markerRemove; setOffset() {} getLngLat() { return [37.6, 55.7]; } },
}));
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
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo = vi.fn(); isMoving() { return false; }
}
const venue: VenueSummary = { id: "v", name: "Зал", latitude: 55.7, longitude: 37.6, cityId: "city", address: "Улица", timezone: "Europe/Moscow" };
const other: VenueSummary = { ...venue, id: "b", name: "Зал Б" };
const errorCard = vi.fn();
const availability = vi.fn(); const back = vi.fn();
function render(overrides: Partial<React.ComponentProps<typeof GamesVenueMap>> = {}) {
  h.cursor = 0;
  const tree = GamesVenueMap({ venues: [venue, other], counts: new Map([["v", 1], ["b", 2]]), onSelect: vi.fn(), onAvailability: availability, onErrorCardChange: errorCard, onReturnToList: back, ...overrides });
  const attach = (node: React.ReactNode): void => {
    if (!isValidElement<{ ref?: { current: unknown }; children?: React.ReactNode }>(node)) return;
    if (node.props.ref) node.props.ref.current = { getBoundingClientRect: () => ({ width: h.width, height: 400 }) };
    Children.forEach(node.props.children, attach);
  };
  attach(tree); h.effects.splice(0).forEach(fn => fn()); return tree;
}
async function start() { render(); await vi.waitFor(() => expect(h.maps).toHaveLength(1)); const map = h.maps[0]; if (!map) throw new Error("Map missing"); map.emit("load"); return map; }
beforeEach(() => {
  vi.useFakeTimers(); h.slots = []; h.cursor = 0; h.effects = []; h.cleanups = []; h.maps = []; h.width = 400;
  errorCard.mockClear(); availability.mockClear(); back.mockClear(); h.markerCreates = 0; h.markerRemove.mockClear(); h.buttons = []; h.selected = null;
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru" } }));
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => key === "gb-games-map-selected" ? h.selected : null, setItem: vi.fn(), removeItem() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { h.resizeCallback = fn; } observe() {} disconnect() {} });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, createElement: () => {
    const target = new EventTarget();
    const attributes = new Map<string, string>();
    const button = { className: "", textContent: "", addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target), setAttribute: vi.fn((key: string, value: string) => attributes.set(key, value)), getAttribute: (key: string) => attributes.get(key), replaceChildren: h.replace, append() {}, focus() { Object.assign(document, { activeElement: button }); } } as unknown as HTMLButtonElement;
    h.buttons.push(button); return button;
  } }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array((MOSCOW_BUNDLE.styleHash.match(/../g) ?? []).map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { h.cleanups.forEach(fn => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function button(index: number) { const value = h.buttons[index]; if (!value) throw new Error("Button missing"); return value; }
function activate(index: number) { button(index).dispatchEvent(Object.assign(new Event("click"), { detail: 1 })); }
it("reconciles controlled null/A/B in place without changing map, markers or camera", async () => {
  const map = await start(); render({ selectedVenueId: null });
  const a = button(0), b = button(1); h.lngLat.mockClear();
  expect(a.getAttribute("aria-pressed")).toBe("false"); expect(b.getAttribute("aria-pressed")).toBe("false");
  render({ selectedVenueId: "v" }); expect(a.getAttribute("aria-pressed")).toBe("true"); expect(b.getAttribute("aria-pressed")).toBe("false");
  render({ selectedVenueId: "b" }); expect(a.getAttribute("aria-pressed")).toBe("false"); expect(b.getAttribute("aria-pressed")).toBe("true");
  expect(h.maps).toEqual([map]); expect(h.buttons).toEqual([a, b]); expect(h.markerCreates).toBe(2);
  expect(map.jumpTo).not.toHaveBeenCalled(); expect(h.lngLat).not.toHaveBeenCalled(); expect(map.remove).not.toHaveBeenCalled();
});
it("marker activation selects only; canvas deselects while marker/control do not; drag guard and cleanup", async () => {
  const map = await start(); const select = vi.fn(), deselect = vi.fn(), returned = vi.fn();
  window.addEventListener("gb-map-return", returned);
  render({ selectedVenueId: null, onSelect: select, onDeselect: deselect });
  vi.mocked(sessionStorage.setItem).mockClear();
  activate(0); expect(select).toHaveBeenCalledExactlyOnceWith(venue); expect(deselect).not.toHaveBeenCalled();
  expect(returned).not.toHaveBeenCalled(); expect(sessionStorage.setItem).not.toHaveBeenCalled();
  // Controls live outside the canvas: a control click must never reach its listener.
  const control = new EventTarget(); control.dispatchEvent(new Event("click")); expect(deselect).not.toHaveBeenCalled();
  map.canvas.dispatchEvent(new Event("click")); expect(deselect).toHaveBeenCalledOnce();
  button(0).dispatchEvent(Object.assign(new Event("pointerdown"), { clientX: 0, clientY: 0 }));
  button(0).dispatchEvent(Object.assign(new Event("pointermove"), { clientX: 20, clientY: 0 }));
  activate(0); expect(select).toHaveBeenCalledOnce();
  button(0).dispatchEvent(Object.assign(new Event("click"), { detail: 0 })); expect(select).toHaveBeenCalledTimes(2);
  h.cleanups.forEach(cleanup => cleanup?.()); h.cleanups = [];
  map.canvas.dispatchEvent(new Event("click")); expect(deselect).toHaveBeenCalledOnce();
  expect([...map.handlers.values()].flat()).toHaveLength(0);
});
it("keeps legacy storage semantics only when controlled selection is undefined", async () => {
  await start(); h.selected = "v"; render(); expect(button(0).getAttribute("aria-pressed")).toBe("true");
  render({ selectedVenueId: null }); expect(button(0).getAttribute("aria-pressed")).toBe("false");
  h.selected = "b"; render(); expect(button(0).getAttribute("aria-pressed")).toBe("false"); expect(button(1).getAttribute("aria-pressed")).toBe("true");
});
