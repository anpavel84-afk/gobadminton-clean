import { Fragment, isValidElement, createElement } from "react";
import type * as React from "react";
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
type Store = { slots: unknown[]; cleanups: (() => void)[] };
type Loader = () => Promise<React.ComponentType<Record<string, unknown>>>;
const h = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], dirty: false,
  loaders: [] as { loader: Loader; component?: React.ComponentType<Record<string, unknown>> }[],
  maps: [] as FakeMap[], buttons: [] as HTMLButtonElement[], markerCreates: 0, markerRemove: vi.fn(), resizeCallback: () => {}, lngLat: vi.fn(), jump: vi.fn(), replace: vi.fn(),
}));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  useId: () => "photo-lifecycle",
  useRef(initial: unknown) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
  useState(initial: unknown) {
    const i = h.cursor++; const slots = h.slots;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next: unknown) => { const value = typeof next === "function" ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; h.dirty = true; } }];
  },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) h.slots[i] = { deps, value: fn() };
    return (h.slots[i] as { value: unknown }).value;
  },
  useEffect: effectHook,
  useLayoutEffect: effectHook,
}));
function effectHook(effect: () => void | (() => void), deps?: unknown[]) {
  const i = h.cursor++; const prev = h.slots[i] as unknown[] | undefined;
  if (!deps || !prev || deps.some((v, n) => v !== prev[n])) {
    h.slots[i] = deps;
    const cleanups = h.cleanups;
    h.effects.push(() => { cleanups[i]?.(); cleanups[i] = effect() || (() => {}); });
  }
}
vi.mock("next/dynamic", () => ({ default: (loader: Loader) => {
  const entry: { loader: Loader; component?: React.ComponentType<Record<string, unknown>> } = { loader };
  h.loaders.push(entry);
  return function DynamicBoundary(props: Record<string, unknown>) {
    if (!entry.component) throw new Error("Dynamic loader unresolved");
    return createElement(entry.component, props);
  };
} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/games" }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
const transport = vi.hoisted(() => ({ venues: vi.fn(), games: vi.fn() }));
vi.mock("../src/lib/api-client", () => ({ listAllCityVenues: () => transport.venues(), listAllUpcomingCityGames: () => transport.games() }));
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
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo = h.jump;
},
  Marker: class { constructor() { h.markerCreates++; } setLngLat() { h.lngLat(); return this; } addTo() { return this; } remove = h.markerRemove; setOffset() {} getLngLat() { return [37.6, 55.7]; } },
}));

import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import { GeographicRadarMap } from "../src/components/consumer/radar/GeographicRadarMap";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
class FakeMap {
  handlers = new Map<string, ((event: unknown) => void)[]>();
  touchZoomRotate = { disableRotation: vi.fn() }; resize = vi.fn(); remove = vi.fn();
  on(name: string, fn: (event: unknown) => void) { this.handlers.set(name, [...this.handlers.get(name) ?? [], fn]); }
  off(name: string, fn: (event: unknown) => void) { this.handlers.set(name, (this.handlers.get(name) ?? []).filter(listener => listener !== fn)); } emit(name: string, event = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  canvas = Object.assign(new EventTarget(), { setAttribute() {} }); triggerRepaint = vi.fn();
  getCanvas() { return this.canvas; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo() {}
}
const venue: VenueSummary = { id: "v", cityId: MOSCOW_BUNDLE.cityId, name: "Зал", address: "Адрес", timezone: "Europe/Moscow", latitude: 55.7, longitude: 37.6 };
const game: Game = {
  id: "g", version: 1, title: "Вечерняя игра", venue, startsAt: "2026-11-04T16:00:00Z", endsAt: "2026-11-04T18:00:00Z", timezone: venue.timezone,
  status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Анна", publicContact: "" }, applicationDeadlineAt: "2026-11-04T16:00:00Z",
  capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles",
  levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: ["B"] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" }
};

class Dom extends EventTarget {
  dataset: Record<string, string> = {}; children: Dom[] = []; parentNode: Dom | null = null;
  style = { overflow: "" }; loading = ""; decoding = ""; alt = ""; sources: string[] = [];
  set src(value: string) { this.sources.push(value); }
  removeAttribute() {} setAttribute() {} replaceChildren = h.replace;
  append() {} appendChild(child: Dom) { child.remove(); this.children.push(child); child.parentNode = this; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  isConnected = true;
  getBoundingClientRect() { return { width: 400, height: this.className === "gb-venue-popup-full-measure" ? 772 : 172 }; }
  className = "";
  closest() { return null; } contains(node: unknown) { return node === this; }
  querySelectorAll() { return focusTargets; }
  focus() { Object.assign(document, { activeElement: this }); }
}
function textContent(node: React.ReactNode, depth = 0): string {
  if (depth > 128) throw new Error("Text depth exceeded");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(child => textContent(child, depth + 1)).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textContent(node.props.children, depth + 1);
  return "";
}
let focusTargets: Dom[] = [];
let photos: Dom[] = [];
let renderer: Harness | undefined;
type Props = Record<string, unknown> & { children?: React.ReactNode; ref?: React.Ref<Dom> };
type Host = { node: React.ReactElement<Props>; dom: Dom };
class Harness {
  stores = new Map<string, Store>(); hosts = new Map<string, Host>();
  root: React.ReactNode = null;
  render(root: React.ReactNode) {
    this.root = root;
    for (let pass = 0; pass < 20; pass++) {
      h.dirty = false; let count = 0;
      const seen = new Set<string>(); const hosts = new Map<string, Host>();
      const visit = (node: React.ReactNode, path: string, depth: number): void => {
        if (++count > 10000 || depth > 128) throw new Error("Render budget exceeded (10000 nodes/depth128)");
        if (Array.isArray(node)) { node.forEach((child, i) => visit(child, `${path}/${i}`, depth + 1)); return; }
        if (!isValidElement<Props>(node)) return;
        const key = `${path}:${node.key ?? ""}`;
        if (node.type === Fragment) { visit(node.props.children, key, depth + 1); return; }
        if (typeof node.type === "function") {
          const store = this.stores.get(key) ?? { slots: [], cleanups: [] };
          this.stores.set(key, store); seen.add(key);
          h.slots = store.slots; h.cleanups = store.cleanups; h.cursor = 0;
          const component = node.type as (props: Props) => React.ReactNode;
          visit(component(node.props), key + "/component", depth + 1); return;
        }
        if (typeof node.type !== "string") throw new Error("Unsupported element type");
        const previous = this.hosts.get(key);
        const dom = previous?.dom ?? new Dom(); dom.className = String(node.props.className ?? "");
        hosts.set(key, { node, dom });
        visit(node.props.children, key + "/children", depth + 1);
      };
      visit(root, "root", 0);
      // Commit removals before attachments, including changed callback refs.
      for (const [key, old] of this.hosts) if (!hosts.has(key) || hosts.get(key)?.node.props.ref !== old.node.props.ref) this.ref(old.node.props.ref, null);
      for (const [key, store] of this.stores) if (!seen.has(key)) { store.cleanups.forEach(fn => fn?.()); this.stores.delete(key); }
      for (const [key, host] of hosts) if (!this.hosts.has(key) || this.hosts.get(key)?.node.props.ref !== host.node.props.ref) this.ref(host.node.props.ref, host.dom);
      this.hosts = hosts;
      focusTargets = [...hosts.values()].filter(host => host.node.type === "button").map(host => host.dom);
      h.effects.splice(0).forEach(fn => fn());
      if (!h.dirty) return;
    }
    throw new Error("Settle budget exceeded (20 passes)");
  }
  ref(ref: React.Ref<Dom> | undefined, value: Dom | null) { if (typeof ref === "function") ref(value); else if (ref) ref.current = value; }
  rerender() { this.render(this.root); }
  host(label: string) {
    const found = [...this.hosts.values()].find(({ node }) => node.props["aria-label"] === label || node.props.className === label || textContent(node.props.children) === label);
    if (!found) throw new Error(`Missing host ${label}`); return found;
  }
  click(label: string) { const fn = this.host(label).node.props.onClick; if (typeof fn !== "function") throw new Error("Missing click"); fn(); this.rerender(); }
  text() {
    const values: string[] = []; let count = 0;
    const visit = (node: React.ReactNode, depth: number): void => {
      if (++count > 10000 || depth > 128) throw new Error("Text budget exceeded");
      if (typeof node === "string" || typeof node === "number") values.push(String(node));
      else if (Array.isArray(node)) node.forEach(child => visit(child, depth + 1));
      else if (isValidElement<Props>(node) && typeof node.type === "string") visit(node.props.children, depth + 1);
    };
    for (const host of this.hosts.values()) visit(host.node.props.children, 0);
    return values.join(" ");
  }
  dispose() { this.render(null); }
}
beforeAll(async () => {
  for (const entry of h.loaders) entry.component = await entry.loader();
  expect(h.loaders.map(entry => entry.component)).toContain(GamesVenueMap);
  expect(h.loaders.map(entry => entry.component)).toContain(GeographicRadarMap);
  expect(GamesVenueMap).not.toBe(GeographicRadarMap);
});
beforeEach(() => {
  captures.clear();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  h.maps = []; h.buttons = []; h.effects = []; h.dirty = false; photos = []; focusTargets = [];
  transport.venues.mockResolvedValue({ ok: true, data: [{ ...venue, cover: { uploadedUrl: `/v1/media/venue-covers/${"a".repeat(64)}.png` } }] });
  transport.games.mockResolvedValue({ ok: true, data: [game] });
  vi.stubGlobal("HTMLElement", Dom);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru", assign: vi.fn() }, history: { pushState: vi.fn(), replaceState: vi.fn() } }));
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn(), removeItem() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { h.resizeCallback = fn; } observe() {} disconnect() {} });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, body: new Dom(), querySelector: () => null, createElement: (tag: string) => { const dom = new Dom(); if (tag === "img") photos.push(dom); else h.buttons.push(dom as unknown as HTMLButtonElement); return dom; } }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array((MOSCOW_BUNDLE.styleHash.match(/../g) ?? []).map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  renderer = new Harness();
});
afterEach(() => { renderer?.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup() {
  const r = renderer; if (!r) throw new Error("Harness missing");
  r.render(<GamesMapView cityId={MOSCOW_BUNDLE.cityId} day="" />);
  await vi.advanceTimersByTimeAsync(0); r.rerender();
  expect(photos).toHaveLength(0);
  const map = h.maps[0]; if (!map) throw new Error("Real GamesVenueMap did not initialize MapLibre");
  map.emit("error", { kind: "style" }); r.rerender();
  r.host("gb-games-map-fallback");
  r.click(r.text().includes("Зал · 0") ? "Зал · 0" : "Зал · 1");
  return r;
}
function photo() { const result = photos[0]; if (!result) throw new Error("Missing selected photo"); return result; }
function pointer(r: Harness, handler: string, y: number, time: number, x = 0) {
  const fn = r.host("gb-venue-handle").node.props[handler]; if (typeof fn !== "function") throw new Error(`Missing ${handler}`);
  fn({ clientX: x, clientY: y, timeStamp: time, pointerId: 1, isPrimary: true, button: 0, currentTarget: captureTarget, preventDefault() {} });
  r.rerender();
}
const captures = new Set<number>();
const captureTarget = { setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) };
it.each([false, true])("real UI preserves a %s-loaded photo through moving/settling, schedule, collapse and reopen", async loaded => {
  const r = await setup(); const image = photo(); if (loaded) image.dispatchEvent(new Event("load"));
  expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  pointer(r, "onPointerDown", 700, 0); pointer(r, "onPointerMove", 600, 1000);
  expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  pointer(r, "onPointerMove", 200, 2000); pointer(r, "onPointerUp", 200, 2200);
  expect(r.host("gb-venue-popup").node.props.role).toBe("dialog");
  expect(r.text()).toContain("Показать игры на этой площадке");
  r.click("Показать игры на этой площадке"); expect(r.text()).toContain("Игры на этой площадке"); expect(r.text()).toContain("Вечерняя игра");
  expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  r.click("К информации о площадке"); expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  r.click("Закрыть"); expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  r.click("Развернуть площадку"); expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  pointer(r, "onPointerDown", 100, 3000); pointer(r, "onPointerMove", 650, 4000); pointer(r, "onPointerUp", 650, 4200);
  expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  await vi.advanceTimersByTimeAsync(220); r.rerender(); expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  const guard = r.host("gb-venue-popup").node.props.onClickCapture; if (typeof guard !== "function") throw new Error("Guard missing");
  guard(click); guard(click); expect(click.preventDefault).toHaveBeenCalledOnce();
  expect(photos).toEqual([image]); expect(image.sources).toHaveLength(1);
  expect(window.location.assign).not.toHaveBeenCalled(); expect(window.history.pushState).not.toHaveBeenCalled(); expect(window.history.replaceState).not.toHaveBeenCalled();
  r.render(<GamesMapView cityId="different" day="" />); expect(image.parentNode).toBeNull();
});
it("retains empty/error actions, cancellation cleanup and horizontal consume-once", async () => {
  transport.games.mockResolvedValue({ ok: true, data: [] });
  const r = await setup();
  pointer(r, "onPointerDown", 700, 0); pointer(r, "onPointerMove", 690, 10, 100);
  expect(r.host("gb-venue-popup").node.props.style).toMatchObject({ height: "172px" });
  const guard = r.host("gb-venue-popup").node.props.onClickCapture; if (typeof guard !== "function") throw new Error("Guard missing");
  const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() }; guard(click); guard(click); expect(click.preventDefault).toHaveBeenCalledOnce();
  for (const handler of ["onPointerCancel", "onLostPointerCapture"]) {
    pointer(r, "onPointerDown", 700, 100); pointer(r, "onPointerMove", 500, 200); pointer(r, handler, 500, 300);
    const afterCancel = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() }; guard(afterCancel); expect(afterCancel.preventDefault).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(220); r.rerender(); expect(captures.size).toBe(0);
  }
  r.click("Развернуть площадку"); expect(r.text()).toContain("Создать игру на этой площадке");
  transport.games.mockResolvedValue({ ok: false }); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); r.rerender();
  expect(r.text()).toContain("Расписание временно недоступно");
  window.dispatchEvent(new Event("gb-session-changed")); r.rerender();
});
it.each([false, true])("keeps capture-phase focus cleanup with Shift=%s and deselects without navigation", async shift => {
  const added = vi.spyOn(window, "addEventListener"); const removed = vi.spyOn(window, "removeEventListener");
  const r = await setup(); r.click("Развернуть площадку");
  const popup = r.host("gb-venue-popup");
  expect(popup.node.props.role).toBe("dialog"); expect(r.host("gb-venue-handle")).toBeDefined();
  Object.assign(document, { activeElement: null });
  const event = new Event("keydown", { cancelable: true }); Object.assign(event, { key: "Tab", shiftKey: shift }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(shift ? focusTargets.at(-1) : focusTargets[0]);
  const capture = added.mock.calls.find(([type, , options]) => type === "keydown" && typeof options === "object" && options?.capture === true);
  if (!capture) throw new Error("Missing capture-phase Tab registration");
  r.click("Закрыть");
  expect(removed.mock.calls.some(([type, listener, options]) => type === "keydown" && listener === capture[1] && options === capture[2])).toBe(true);
  const escape = new Event("keydown", { cancelable: true }); Object.assign(escape, { key: "Escape" }); window.dispatchEvent(escape); r.rerender();
  expect(photo().parentNode).toBeNull(); expect(r.host("gb-games-map").node.props["data-venue-preview"]).toBe(false);
  expect(window.location.assign).not.toHaveBeenCalled();
});
