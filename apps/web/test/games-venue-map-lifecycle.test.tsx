import { Children, isValidElement } from "react";
import type * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], maps: [] as FakeMap[], width: 400, markerCreates: 0, markerRemove: vi.fn(), resizeCallback: () => {}, lngLat: vi.fn(), replace: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useRef(initial: unknown) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useState(initial: unknown) {
    const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? next(h.slots[i]) : next; }];
  },
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
  off() {} emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  canvas = Object.assign(new EventTarget(), { setAttribute() {} }); triggerRepaint = vi.fn();
  getCanvas() { return this.canvas; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
},
  Marker: class { constructor() { h.markerCreates++; } setLngLat() { h.lngLat(); return this; } addTo() { return this; } remove = h.markerRemove; setOffset() {} getLngLat() { return [37.6, 55.7]; } },
}));
import { GamesMapViewport } from "../src/components/consumer/games/GamesMapViewport";
import { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import type { VenueSummary } from "../src/lib/consumer-types";
class FakeMap {
  handlers = new Map<string, ((event: unknown) => void)[]>();
  touchZoomRotate = { disableRotation: vi.fn() }; resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off() {} emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  canvas = Object.assign(new EventTarget(), { setAttribute() {} }); triggerRepaint = vi.fn();
  getCanvas() { return this.canvas; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
}
const venue = { id: "v", name: "Зал", latitude: 55.7, longitude: 37.6 } as VenueSummary;
const errorCard = vi.fn();
const availability = vi.fn(); const back = vi.fn();
function render() {
  h.cursor = 0;
  const tree = GamesVenueMap({ venues: [venue], counts: new Map([["v", 1]]), onSelect: vi.fn(), onAvailability: availability, onErrorCardChange: errorCard, onReturnToList: back });
  const attach = (node: React.ReactNode): void => {
    if (!isValidElement<{ ref?: { current: unknown }; children?: React.ReactNode }>(node)) return;
    if (node.props.ref) node.props.ref.current = { getBoundingClientRect: () => ({ width: h.width, height: 400 }) };
    Children.forEach(node.props.children, attach);
  };
  attach(tree); h.effects.splice(0).forEach(fn => fn()); return tree;
}
function click(tree: React.ReactNode, label: string): void {
  if (!isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(tree)) return;
  if (tree.props.children === label) tree.props.onClick?.();
  Children.forEach(tree.props.children, child => click(child, label));
}
async function start() { render(); await vi.waitFor(() => expect(h.maps).toHaveLength(1)); h.maps[0]!.emit("load"); return h.maps[0]!; }
beforeEach(() => {
  vi.useFakeTimers(); h.slots = []; h.cursor = 0; h.effects = []; h.cleanups = []; h.maps = []; h.width = 400;
  errorCard.mockClear(); availability.mockClear(); back.mockClear(); h.markerCreates = 0; h.markerRemove.mockClear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru" } }));
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { h.resizeCallback = fn; } observe() {} disconnect() {} });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", createElement: () => ({ addEventListener() {}, setAttribute() {}, replaceChildren: h.replace, append() {} }) }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(MOSCOW_BUNDLE.styleHash.match(/../g)!.map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { h.cleanups.forEach(fn => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("keeps markers and map for warnings; fatal failure offers retry and list; rebuilds once", async () => {
  const map = await start(); render();
  expect(errorCard).toHaveBeenLastCalledWith(false);
  map.emit("sourcedata", { sourceId: "protomaps", tile: { state: "loaded" } });
  map.emit("error", { error: { message: "glyph failed" } });
  expect(renderToStaticMarkup(render())).not.toContain("Карта не загрузилась");
  expect(availability).not.toHaveBeenCalledWith(false); expect(map.remove).not.toHaveBeenCalled();
  expect(h.markerCreates).toBe(1); expect(h.markerRemove).not.toHaveBeenCalled();
  map.emit("error", { error: { message: "WebGL context lost" } });
  await vi.advanceTimersByTimeAsync(4000);
  const failed = render(); const html = renderToStaticMarkup(failed);
  expect(html).toContain("Карта не загрузилась"); expect(html).toContain("Повторить"); expect(html).toContain("← К списку");
  expect(errorCard).toHaveBeenLastCalledWith(true);
  click(failed, "← К списку"); expect(back).toHaveBeenCalledOnce();
  click(failed, "Повторить"); expect(renderToStaticMarkup(render())).not.toContain("Карта не загрузилась");
  expect(errorCard).toHaveBeenLastCalledWith(false);
  await vi.waitFor(() => expect(h.maps).toHaveLength(2)); expect(map.remove).toHaveBeenCalledOnce();
});
it("reports zero vector tiles eight seconds after load", async () => {
  await start(); await vi.advanceTimersByTimeAsync(8000);
  expect(renderToStaticMarkup(render())).toContain('data-map-error="tiles"');
  expect(availability).toHaveBeenCalledWith(false);
});
it("does not construct a map in a zero-width container", async () => {
  h.width = 0; render(); await Promise.resolve(); expect(h.maps).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
});

it("shares the original DOM loss deadline with classified errors and keeps late restore fatal", async () => {
  const map = await start();
  const event = new Event("webglcontextlost", { cancelable: true });
  map.getCanvas().dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  map.emit("error", { error: { message: "WebGL context lost" } });
  await vi.advanceTimersByTimeAsync(999);
  expect(renderToStaticMarkup(render())).not.toContain("Карта не загрузилась");
  await vi.advanceTimersByTimeAsync(1);
  expect(availability).toHaveBeenCalledWith(false);
  map.getCanvas().dispatchEvent(new Event("webglcontextrestored")); map.emit("load");
  expect(renderToStaticMarkup(render())).toContain("Карта не загрузилась");
});
it("restores at 3999ms, repaints on visible and opens a fresh grace", async () => {
  const map = await start();
  map.emit("sourcedata", { sourceId: "protomaps", tile: { state: "loaded" } });
  map.getCanvas().dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  await vi.advanceTimersByTimeAsync(3999);
  map.getCanvas().dispatchEvent(new Event("webglcontextrestored"));
  expect(map.triggerRepaint).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(availability).not.toHaveBeenCalledWith(false);
  Object.assign(document, { visibilityState: "hidden" }); document.dispatchEvent(new Event("visibilitychange"));
  expect(map.triggerRepaint).toHaveBeenCalledOnce();
  Object.assign(document, { visibilityState: "visible" }); document.dispatchEvent(new Event("visibilitychange"));
  expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
  map.getCanvas().dispatchEvent(new Event("webglcontextlost"));
  await vi.advanceTimersByTimeAsync(4000); expect(availability).toHaveBeenCalledWith(false);
});
it("coalesces changed layout, ignores unchanged positives and remembers observed zero", async () => {
  const map = await start(); map.emit("idle"); map.resize.mockClear();
  h.resizeCallback(); await vi.advanceTimersByTimeAsync(16); expect(map.resize).not.toHaveBeenCalled();
  h.width = 500; h.resizeCallback(); h.width = 600; h.resizeCallback();
  await vi.advanceTimersByTimeAsync(16); expect(map.resize).toHaveBeenCalledTimes(1);
  h.width = 0; h.resizeCallback(); await vi.advanceTimersByTimeAsync(16);
  expect(map.resize).toHaveBeenCalledTimes(1); expect(map.remove).not.toHaveBeenCalled();
  h.width = 600; h.resizeCallback(); await vi.advanceTimersByTimeAsync(16);
  expect(map.resize).toHaveBeenCalledTimes(2); expect(h.maps).toHaveLength(1);
});
it("does not rewrite unchanged markers and cleanup cancels grace and resize", async () => {
  const map = await start(); render(); h.lngLat.mockClear(); h.replace.mockClear();
  render(); render(); expect(h.lngLat).not.toHaveBeenCalled(); expect(h.replace).not.toHaveBeenCalled();
  map.getCanvas().dispatchEvent(new Event("webglcontextlost")); h.resizeCallback();
  h.cleanups.forEach(fn => fn?.()); h.cleanups = [];
  await vi.advanceTimersByTimeAsync(10000); expect(availability).not.toHaveBeenCalledWith(false);
  expect(map.remove).toHaveBeenCalledOnce();
});

it.each([false, true])("writes only changed viewport geometry (fullscreen=%s)", fullscreen => {
  const writes = vi.fn();
  const style = new Proxy({ height: "", top: "", left: "", width: "" }, {
    set(target, key: keyof typeof target, value: string) { writes(key, value); target[key] = value; return true; },
  });
  const viewport = Object.assign(new EventTarget(), { height: 700, width: 400, offsetTop: 10, offsetLeft: 0 });
  Object.assign(window, { visualViewport: viewport, scrollTo() {} });
  h.cursor = 0;
  const tree = GamesMapViewport({ children: null, fullscreen });
  const element = { style, closest: () => null, getBoundingClientRect: () => ({ top: 100 }), parentElement: null };
  (tree.props.ref as { current: unknown }).current = element;
  h.effects.splice(0).forEach(fn => fn()); writes.mockClear();
  viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll"));
  vi.advanceTimersByTime(16); expect(writes).not.toHaveBeenCalled();
  viewport.height = 600; viewport.dispatchEvent(new Event("resize")); vi.advanceTimersByTime(16);
  expect(writes).toHaveBeenCalledWith("height", fullscreen ? "600px" : "510px");
  writes.mockClear(); viewport.dispatchEvent(new Event("resize"));
  h.cleanups.forEach(fn => fn?.()); h.cleanups = [];
  vi.advanceTimersByTime(16); expect(writes).not.toHaveBeenCalled();
});

it("allows another fatal and the tile watchdog to fail during WebGL grace", async () => {
  const map = await start();
  await vi.advanceTimersByTimeAsync(6000);
  map.getCanvas().dispatchEvent(new Event("webglcontextlost"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(renderToStaticMarkup(render())).toContain("Не удалось загрузить улицы");
  map.getCanvas().dispatchEvent(new Event("webglcontextrestored"));
  expect(availability).toHaveBeenCalledWith(false);
});
it("does not defer a style fatal behind WebGL grace", async () => {
  const map = await start(); map.getCanvas().dispatchEvent(new Event("webglcontextlost"));
  map.emit("error", { kind: "style" });
  expect(renderToStaticMarkup(render())).toContain("Не удалось загрузить оформление");
  expect(availability).toHaveBeenCalledWith(false);
});
