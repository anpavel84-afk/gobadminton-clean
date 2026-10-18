import { Children, isValidElement } from "react";
import type * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], maps: [] as FakeMap[], width: 400, markerCreates: 0, markerRemove: vi.fn() }));
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
  touchZoomRotate = { disableRotation: vi.fn() }; resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off() {} emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  getCanvas() { return { setAttribute() {} }; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
},
  Marker: class { constructor() { h.markerCreates++; } setLngLat() { return this; } addTo() { return this; } remove = h.markerRemove; setOffset() {} getLngLat() { return [37.6, 55.7]; } },
}));
import { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import type { VenueSummary } from "../src/lib/consumer-types";
class FakeMap {
  handlers = new Map<string, ((event: unknown) => void)[]>();
  touchZoomRotate = { disableRotation: vi.fn() }; resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off() {} emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  getCanvas() { return { setAttribute() {} }; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
}
const venue = { id: "v", name: "Зал", latitude: 55.7, longitude: 37.6 } as VenueSummary;
const availability = vi.fn(); const back = vi.fn();
function render() {
  h.cursor = 0;
  const tree = GamesVenueMap({ venues: [venue], counts: new Map([["v", 1]]), onSelect: vi.fn(), onAvailability: availability, onReturnToList: back });
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
  availability.mockClear(); back.mockClear(); h.markerCreates = 0; h.markerRemove.mockClear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru" } }));
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("document", { createElement: () => ({ addEventListener() {}, setAttribute() {}, replaceChildren() {} }) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(MOSCOW_BUNDLE.styleHash.match(/../g)!.map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { h.cleanups.forEach(fn => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("keeps markers and map for warnings; fatal failure offers retry and list; rebuilds once", async () => {
  const map = await start(); render();
  map.emit("sourcedata", { sourceId: "protomaps", tile: { state: "loaded" } });
  map.emit("error", { error: { message: "glyph failed" } });
  expect(renderToStaticMarkup(render())).not.toContain("Карта не загрузилась");
  expect(availability).not.toHaveBeenCalledWith(false); expect(map.remove).not.toHaveBeenCalled();
  expect(h.markerCreates).toBe(1); expect(h.markerRemove).not.toHaveBeenCalled();
  map.emit("error", { error: { message: "WebGL context lost" } });
  const failed = render(); const html = renderToStaticMarkup(failed);
  expect(html).toContain("Карта не загрузилась"); expect(html).toContain("Повторить"); expect(html).toContain("← К списку");
  click(failed, "← К списку"); expect(back).toHaveBeenCalledOnce();
  click(failed, "Повторить"); expect(renderToStaticMarkup(render())).not.toContain("Карта не загрузилась");
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
