import { Children, isValidElement } from "react";
import type * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], maps: [] as FakeMap[], width: 400, markerCreates: 0, replace: vi.fn(), offset: vi.fn(), observer: (() => {}) as () => void, markerRemove: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useRef(initial: unknown) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useState(initial: unknown) {
    const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial;
    return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === "function" ? next(h.slots[i]) : next; }];
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as unknown[] | undefined;
    if (!prev || deps.some((v, n) => v !== prev[n])) { h.slots[i] = deps; h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = effect() || (() => {}); }); }
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
const venue = { id: "v", name: "Зал", latitude: 55.7, longitude: 37.6 } as VenueSummary;
const errorCard = vi.fn();
const availability = vi.fn(); const back = vi.fn();
const venues = [venue];
function render(counts = new Map([["v", 1]])) {
  h.cursor = 0;
  const tree = GamesVenueMap({ venues, counts, onSelect: vi.fn(), onAvailability: availability, onErrorCardChange: errorCard, onReturnToList: back });
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
  errorCard.mockClear(); availability.mockClear(); back.mockClear(); h.markerCreates = 0; h.markerRemove.mockClear(); h.replace.mockClear(); h.offset.mockClear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru" } }));
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { h.observer = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, createElement: () => ({ addEventListener() {}, setAttribute() {}, replaceChildren: h.replace }) });
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

it("restores WebGL within the grace period without declaring failure", async () => {
  const map = await start();
  map.emit("sourcedata", { sourceId: "protomaps", tile: { state: "loaded" } });
  map.emit("webglcontextlost"); await vi.advanceTimersByTimeAsync(3999);
  expect(renderToStaticMarkup(render())).not.toContain("Карта не загрузилась");
  map.emit("webglcontextrestored"); await vi.advanceTimersByTimeAsync(4001);
  expect(map.triggerRepaint).toHaveBeenCalledOnce();
  expect(availability).not.toHaveBeenCalledWith(false);
  expect(renderToStaticMarkup(render())).not.toContain("Карта не загрузилась");
});
it("declares webgl fatal only after four seconds without restore", async () => {
  const map = await start(); map.emit("webglcontextlost");
  await vi.advanceTimersByTimeAsync(4000);
  expect(renderToStaticMarkup(render())).toContain('data-map-error="webgl"');
  expect(renderToStaticMarkup(render())).toContain("Карта не загрузилась");
  expect(map.remove).not.toHaveBeenCalled();
});
it("does not rewrite equal marker presentation or repeat separation", async () => {
  await start(); render(); h.replace.mockClear(); h.offset.mockClear();
  render(new Map([["v", 1]]));
  expect(h.replace).not.toHaveBeenCalled(); expect(h.offset).not.toHaveBeenCalled();
});
it("ignores unchanged and zero layout; resizes once on return to positive size", async () => {
  const map = await start(); map.resize.mockClear();
  h.observer(); await vi.advanceTimersByTimeAsync(16); expect(map.resize).not.toHaveBeenCalled();
  h.width = 0; h.observer(); await vi.advanceTimersByTimeAsync(16);
  expect(map.resize).not.toHaveBeenCalled(); expect(map.remove).not.toHaveBeenCalled();
  h.width = 400; h.observer(); h.observer(); await vi.advanceTimersByTimeAsync(16);
  expect(map.resize).toHaveBeenCalledOnce(); expect(h.maps).toHaveLength(1);
});
