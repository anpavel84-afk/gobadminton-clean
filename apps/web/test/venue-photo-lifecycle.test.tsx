import { Fragment, isValidElement } from "react";
import type { ReactNode } from "react";
import type * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type StateSlot = { value: unknown; setter: (next: unknown) => void };
type EffectSlot = { deps: readonly unknown[] | undefined; cleanup?: () => void };
type Store = { slots: unknown[]; cursor: number; alive: boolean };
const runtime = vi.hoisted(() => ({ current: null as Store | null, dirty: false, queue: [] as (() => void)[] }));
function active() { if (!runtime.current) throw new Error("Hook outside component"); return runtime.current; }
function equalDeps(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) {
  return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}
vi.mock("react", async original => {
  const actual = await original<typeof React>();
  const effect = (callback: () => void | (() => void), deps?: readonly unknown[]) => {
    const store = active(); const index = store.cursor++;
    const previous = store.slots[index] as EffectSlot | undefined;
    if (previous && equalDeps(previous.deps, deps)) return;
    const slot: EffectSlot = { deps }; store.slots[index] = slot;
    runtime.queue.push(() => {
      previous?.cleanup?.(); if (previous) previous.cleanup = undefined;
      if (store.alive) { const cleanup = callback(); if (cleanup) slot.cleanup = cleanup; }
    });
  };
  return { ...actual,
    useState(initial: unknown) {
      const store = active(); const index = store.cursor++;
      let slot = store.slots[index] as StateSlot | undefined;
      if (!slot) {
        slot = { value: typeof initial === "function" ? initial() : initial, setter: () => {} };
        const owned = slot;
        owned.setter = next => {
          const value = typeof next === "function" ? next(owned.value) : next;
          if (store.alive && !Object.is(value, owned.value)) { owned.value = value; runtime.dirty = true; }
        };
        store.slots[index] = owned;
      }
      return [slot.value, slot.setter];
    },
    useRef(initial: unknown) {
      const store = active(); const index = store.cursor++;
      return store.slots[index] ??= { current: initial };
    },
    useMemo(factory: () => unknown, deps?: readonly unknown[]) {
      const store = active(); const index = store.cursor++;
      const previous = store.slots[index] as { deps?: readonly unknown[]; value: unknown } | undefined;
      if (previous && equalDeps(previous.deps, deps)) return previous.value;
      const slot = { deps, value: factory() }; store.slots[index] = slot; return slot.value;
    },
    useEffect: effect, useLayoutEffect: effect,
    useId() { const store = active(); return `id-${store.cursor++}`; },
    useContext(context: { _currentValue: unknown }) { return context._currentValue; },
    useSyncExternalStore(_subscribe: unknown, snapshot: () => unknown) { return snapshot(); },
  };
});

class Node extends EventTarget {
  parentNode: Node | null = null;
  children: Node[] = [];
  rendered: Node[] = [];
  props: Record<string, unknown> = {};
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  style: Record<string, unknown> = {};
  className = ""; textContent = ""; alt = ""; loading = ""; decoding = "";
  srcWrites: string[] = []; source = ""; captured = new Set<number>();
  constructor(readonly tag = "div") { super(); }
  set src(value: string) { expect(this.loading).toBe("eager"); expect(this.decoding).toBe("async"); this.srcWrites.push(value); this.source = value; }
  get src() { return this.source; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); if (key === "src") this.source = ""; }
  appendChild(child: Node) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
  append(...nodes: Node[]) { nodes.forEach(node => this.appendChild(node)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  replaceChildren() { this.children.forEach(node => { node.parentNode = null; }); this.children = []; }
  get parentElement() { return this.parentNode; }
  get isConnected(): boolean { return this === body || !!this.parentNode?.isConnected; }
  focus() { dom.activeElement = this; }
  contains(node: unknown): boolean { return node === this || [...this.children, ...this.rendered].some(child => child.contains(node)); }
  matches(selector: string) {
    return selector.split(",").some(part => {
      const value = part.trim();
      if (value === "[hidden]") return !!this.props.hidden;
      if (value.includes("[role=dialog]")) return this.props.role === "dialog";
      if (value.startsWith("dialog")) return this.tag === "dialog" && !!this.props.open;
      if (value.includes(" ")) { const pieces = value.split(" "); const last = pieces.pop(); return !!last && this.matches(last) && !!this.parentNode?.closest(pieces.join(" ")); }
      if (value.startsWith(".")) return this.className.split(" ").includes(value.slice(1));
      if (value.startsWith("button")) return this.tag === "button" && !this.props.disabled;
      if (value === "a[href]") return this.tag === "a" && !!this.props.href;
      if (value === '[tabindex="0"]') return this.props.tabIndex === 0;
      return false;
    });
  }
  closest(selector: string): Node | null { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null; }
  querySelectorAll(selector: string): Node[] { return [...new Set([...this.children, ...this.rendered])].flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() { return { width: 400, height: this.className.includes("full-measure") ? 700 : this.className.includes("compact-measure") ? 172 : 400, top: 0 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
const body = new Node("body");
const created: Node[] = [];
const dom = Object.assign(new EventTarget(), { body, activeElement: null as Node | null, visibilityState: "visible",
  createElement(tag: string) { const node = new Node(tag); created.push(node); return node; },
  createElementNS(_namespace: string, tag: string) { return new Node(tag); },
  querySelector: (selector: string) => body.querySelector(selector),
});
function assignRef(ref: unknown, node: Node | null) {
  if (typeof ref === "function") ref(node);
  else if (ref && typeof ref === "object" && "current" in ref) ref.current = node;
}
const componentIds = new WeakMap<object, number>();
let componentSequence = 0;
class Renderer {
  stores = new Map<string, Store>();
  hosts = new Map<string, { node: Node; ref: unknown }>();
  tree: Node[] = [];
  constructor(public root: () => ReactNode) {}
  render() {
    let rounds = 0;
    do {
      if (++rounds > 20) throw new Error("Exceeded 20 settle renders");
      runtime.dirty = false;
      const seen = new Set<string>(); const next = new Map<string, { node: Node; ref: unknown }>();
      let count = 0;
      const walk = (value: ReactNode, path: string, depth: number): Node[] => {
        if (++count > 10000 || depth > 128) throw new Error("Render traversal limit");
        if (Array.isArray(value)) return value.flatMap((child, index) => walk(child, `${path}.${index}`, depth + 1));
        if (!isValidElement<Record<string, unknown>>(value)) {
          if (typeof value === "string" || typeof value === "number") { const node = new Node("text"); node.textContent = String(value); return [node]; }
          return [];
        }
        let typeId = 0;
        if (typeof value.type === "function") {
          typeId = componentIds.get(value.type) ?? ++componentSequence; componentIds.set(value.type, typeId);
        }
        const key = `${path}:${typeId}:${String(value.key ?? "")}`;
        if (value.type === Fragment) return walk(value.props.children as ReactNode, `${key}.fragment`, depth + 1);
        if (typeof value.type === "function") {
          let store = this.stores.get(key);
          if (!store) { store = { slots: [], cursor: 0, alive: true }; this.stores.set(key, store); }
          seen.add(key); store.cursor = 0; runtime.current = store;
          const output = (value.type as (props: Record<string, unknown>) => ReactNode)(value.props);
          runtime.current = null;
          return walk(output, `${key}.output`, depth + 1);
        }
        if (typeof value.type !== "string") throw new Error(`Unsupported element ${String(value.type)}`);
        const node = this.hosts.get(key)?.node ?? new Node(value.type);
        node.props = value.props; node.className = String(value.props.className ?? "");
        node.style = { ...(value.props.style as Record<string, unknown> | undefined) };
        node.rendered = walk(value.props.children as ReactNode, `${key}.children`, depth + 1);
        node.rendered.forEach(child => { child.parentNode = node; });
        next.set(key, { node, ref: value.props.ref }); return [node];
      };
      this.tree = walk(this.root(), "root", 0);
      for (const [key, host] of this.hosts) if (next.get(key)?.ref !== host.ref || !next.has(key)) assignRef(host.ref, null);
      for (const [key, store] of this.stores) if (!seen.has(key)) {
        store.alive = false;
        for (const value of store.slots) { const slot = value as EffectSlot | undefined; if (slot?.cleanup) { slot.cleanup(); slot.cleanup = undefined; } }
        this.stores.delete(key);
      }
      body.rendered = this.tree; this.tree.forEach(node => { node.parentNode = body; });
      for (const [key, host] of next) if (!this.hosts.has(key) || this.hosts.get(key)?.ref !== host.ref) assignRef(host.ref, host.node);
      for (const [key, host] of this.hosts) if (!next.has(key)) host.node.parentNode = null;
      this.hosts = next;
      runtime.queue.splice(0).forEach(effect => effect());
    } while (runtime.dirty);
  }
  replayRefs() {
    for (const host of this.hosts.values()) {
      assignRef(host.ref, null);
      assignRef(host.ref, host.node);
    }
  }
  unmount() { this.root = () => null; this.render(); }
  nodes() { return [...this.hosts.values()].map(host => host.node); }
  find(label: string) {
    const node = this.nodes().find(item => item.props["aria-label"] === label || text(item) === label);
    if (!node) throw new Error(`Missing control: ${label}`); return node;
  }
}
function text(node: Node): string { return node.textContent + node.rendered.map(text).join(""); }
function handler(node: Node, name: string, event: unknown = {}) {
  const fn = node.props[name]; if (typeof fn !== "function") throw new Error(`Missing ${name} on ${node.tag}`); fn(event);
}
const renderers: Renderer[] = [];
function mount(root: () => ReactNode) { const renderer = new Renderer(root); renderers.push(renderer); renderer.render(); return renderer; }
beforeEach(() => {
  runtime.current = null; runtime.dirty = false; runtime.queue = []; created.length = 0; body.rendered = []; body.style = {}; dom.activeElement = null;
  vi.stubGlobal("document", dom); vi.stubGlobal("HTMLElement", Node);
});
afterEach(async () => { renderers.splice(0).forEach(renderer => renderer.unmount()); await Promise.resolve(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

import type * as ApiClient from "../src/lib/api-client";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
const transport = vi.hoisted(() => ({ venues: vi.fn(), games: vi.fn(), apiFetch: vi.fn() }));
const dynamicRegistry = vi.hoisted(() => new Map<string, (props: Record<string, unknown>) => ReactNode>());
vi.mock("next/dynamic", () => ({ default: (loader: () => unknown) => {
  const key = String(loader).includes("GamesVenueMap") ? "venues" : "radar";
  return function Dynamic(props: Record<string, unknown>) {
    const component = dynamicRegistry.get(key); if (!component) throw new Error(`Missing dynamic loader ${key}`); return component(props);
  };
} }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/games", useRouter: () => ({ push: navigation, replace: navigation }), useSearchParams: () => new URLSearchParams() }));
vi.mock("../src/lib/api-client", async original => {
  const actual = await original<typeof ApiClient>();
  const partial: Pick<typeof ApiClient, "listAllCityVenues" | "listAllUpcomingCityGames" | "apiFetch"> = {
    listAllCityVenues: transport.venues, listAllUpcomingCityGames: transport.games, apiFetch: transport.apiFetch,
  };
  return { ...actual, ...partial };
});
vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(), addProtocol: vi.fn(),
  Map: class { constructor() { return new FakeMap(); } },
  Marker: class {
    button: Node;
    constructor({ element }: { element: Node }) { this.button = element; markerButtons.push(element); }
    setLngLat() { return this; } addTo() { return this; } remove() {} setOffset() {} getLngLat() { return [37.6, 55.7]; }
  },
}));
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import { GeographicRadarMap } from "../src/components/consumer/radar/GeographicRadarMap";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
// Registration after static imports avoids async module evaluation through RadarPage → GamesMapView.
dynamicRegistry.set("venues", props => <GamesVenueMap {...props as React.ComponentProps<typeof GamesVenueMap>} />);
dynamicRegistry.set("radar", props => <GeographicRadarMap {...props as React.ComponentProps<typeof GeographicRadarMap>} />);
const maps: FakeMap[] = []; const markerButtons: Node[] = []; const navigation = vi.fn();
class FakeMap {
  constructor() { maps.push(this); }
  handlers = new Map<string, Set<(event: unknown) => void>>();
  canvas = new Node("canvas"); touchZoomRotate = { disableRotation() {} };
  resize = vi.fn(); remove = vi.fn(); triggerRepaint = vi.fn();
  on(name: string, fn: (event: unknown) => void) { const listeners = this.handlers.get(name) ?? new Set(); listeners.add(fn); this.handlers.set(name, listeners); }
  off(name: string, fn: (event: unknown) => void) { this.handlers.get(name)?.delete(fn); }
  emit(name: string, event: unknown = {}) { this.handlers.get(name)?.forEach(fn => fn(event)); }
  getCanvas() { return this.canvas; } getCenter() { return { lng: 37.6, lat: 55.7 }; } getZoom() { return 10.5; }
  getContainer() { return body; } project() { return { x: 0, y: 0 }; } jumpTo() {} isMoving() { return false; }
}
const cover = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const venue: VenueSummary = { id: "venue", cityId: MOSCOW_BUNDLE.cityId, name: "Зал", address: "Адрес", timezone: "Europe/Moscow", latitude: 55.7, longitude: 37.6, cover: { uploadedUrl: cover } };
const game: Game = { id: "game", version: 1, title: "Вечерняя игра", status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
  venue, organizer: { id: null, displayName: "Организатор", publicContact: "Контакт" }, startsAt: "2027-01-01T15:00:00Z", endsAt: "2027-01-01T16:00:00Z", timezone: venue.timezone,
  capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles", applicationDeadlineAt: "2027-01-01T15:00:00Z",
  levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: ["test"] }, settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "Условия" } };
let currentCity = MOSCOW_BUNDLE.cityId;
const returnToList = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] }); maps.length = 0; markerButtons.length = 0; currentCity = MOSCOW_BUNDLE.cityId; navigation.mockClear(); returnToList.mockClear();
  transport.venues.mockReset().mockResolvedValue({ ok: true, data: [venue, { ...venue, id: "unselected", name: "Другой зал" }] });
  transport.games.mockReset().mockResolvedValue({ ok: true, data: [game] }); transport.apiFetch.mockReset();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: new URL(MOSCOW_BUNDLE.prefix).origin, assign: navigation }, matchMedia: () => ({ matches: false }), innerHeight: 800 }));
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  const bytes = MOSCOW_BUNDLE.styleHash.match(/../g); if (!bytes) throw new Error("Invalid hash");
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(bytes.map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); });
async function settle(renderer: Renderer) { for (let index = 0; index < 12; index++) { await Promise.resolve(); renderer.render(); } }
async function start() {
  const renderer = mount(() => <GamesMapView cityId={currentCity} day="" onReturnToList={returnToList} />);
  await settle(renderer); const map = maps[0]; if (!map) throw new Error("Map did not start");
  map.emit("load"); map.emit("sourcedata", { sourceId: "protomaps", tile: { state: "loaded" } }); await settle(renderer);
  expect(created.filter(node => node.tag === "img")).toHaveLength(0);
  const marker = markerButtons[0]; if (!marker) throw new Error("Missing marker");
  marker.dispatchEvent(Object.assign(new Event("click"), { detail: 1 })); renderer.render();
  return { renderer, map };
}
function photo() { const image = created.find(node => node.tag === "img"); if (!image) throw new Error("Missing photo"); return image; }
function click(renderer: Renderer, label: string) { const node = renderer.find(label); expect(node.tag).toBe("button"); handler(node, "onClick"); renderer.render(); }
function surface(renderer: Renderer) { const node = renderer.nodes().find(item => item.className === "gb-venue-popup"); if (!node) throw new Error("Missing popup"); return node; }
function gesture(renderer: Renderer, name: string, x: number, y: number, time = 0) {
  const handle = renderer.nodes().find(item => item.className === "gb-venue-handle"); if (!handle) throw new Error("Missing handle");
  handler(handle, name, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: time, currentTarget: handle, preventDefault() {} }); renderer.render(); return handle;
}
function output(renderer: Renderer) { return renderer.tree.map(text).join(""); }
it.each([false, true])("keeps selected photo before/after load=%s through moving, settling, schedule, collapse and refresh", async loaded => {
  const { renderer } = await start(); const image = photo(); renderer.replayRefs(); await Promise.resolve();
  expect(created.filter(node => node.tag === "img")).toEqual([image]); expect(image.srcWrites).toEqual([cover]);
  if (loaded) image.dispatchEvent(new Event("load"));
  const requests = transport.venues.mock.calls.length; const mapFetches = vi.mocked(fetch).mock.calls.length;
  gesture(renderer, "onPointerDown", 0, 600); gesture(renderer, "onPointerMove", 0, 200, 100);
  expect(surface(renderer).props["data-moving"]).toBe(true); expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  gesture(renderer, "onPointerUp", 0, 200, 110); expect(surface(renderer).props.role).toBe("dialog");
  await vi.advanceTimersByTimeAsync(220); renderer.render();
  click(renderer, "Показать игры на этой площадке"); expect(output(renderer)).toContain("Игры на этой площадке"); expect(output(renderer)).toContain("Вечерняя игра");
  expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  click(renderer, "К информации о площадке"); expect(image.parentNode?.className).toContain("gb-venue-sheet-cover");
  click(renderer, "Закрыть"); expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  click(renderer, "Развернуть площадку"); click(renderer, "Закрыть");
  transport.venues.mockResolvedValue({ ok: true, data: [{ ...venue, name: "Переименован" }] });
  window.dispatchEvent(new Event("focus")); await settle(renderer);
  expect(image.alt).toBe("Обложка: Переименован"); expect(image.srcWrites).toEqual([cover]);
  expect(created.filter(node => node.tag === "img")).toEqual([image]); expect(maps).toHaveLength(1);
  expect(navigation).not.toHaveBeenCalled(); expect(transport.venues).toHaveBeenCalledTimes(requests + 1);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(mapFetches);
});
it.each(["city", "deselect"])("cleans photo on %s", async mode => {
  const { renderer, map } = await start(); const image = photo();
  click(renderer, "Развернуть площадку");
  if (mode === "city") currentCity = "other"; else map.canvas.dispatchEvent(new Event("click"));
  renderer.render(); expect(image.parentNode).toBeNull(); await Promise.resolve(); expect(image.src).toBe("");
  image.dispatchEvent(new Event("error")); image.dispatchEvent(new Event("load")); expect(image.srcWrites).toEqual([cover]);
});
it("fatal map failure exposes a real fallback button and opens the same photo resource", async () => {
  const { renderer, map } = await start(); const image = photo();
  map.canvas.dispatchEvent(new Event("click")); renderer.render(); await Promise.resolve(); expect(image.src).toBe("");
  map.emit("error", { kind: "style" }); await settle(renderer);
  expect(output(renderer)).toContain("Карта не загрузилась");
  const fallback = renderer.nodes().find(node => node.tag === "button" && node.className === "gb-discovery-chip" && text(node).startsWith("Зал"));
  if (!fallback) throw new Error("Missing fallback button"); handler(fallback, "onClick"); renderer.render();
  expect(created.filter(node => node.tag === "img")).toHaveLength(2); click(renderer, "Развернуть площадку");
  expect(output(renderer)).toContain("Адрес"); expect(output(renderer)).toContain("Контакты площадки");
  expect(maps).toHaveLength(1); expect(navigation).not.toHaveBeenCalled();
});
it.each(["onPointerCancel", "onLostPointerCapture"])("cleans capture on %s and preserves compact guard after Sheet unmount", async event => {
  const { renderer } = await start(); const image = photo();
  const handle = gesture(renderer, "onPointerDown", 0, 600); gesture(renderer, "onPointerMove", 0, 500, 100);
  expect(handle.hasPointerCapture(1)).toBe(true); gesture(renderer, event, 0, 500, 110);
  expect(handle.hasPointerCapture(1)).toBe(false); await vi.advanceTimersByTimeAsync(220); renderer.render();
  expect(renderer.nodes().some(node => node.className === "gb-venue-sheet")).toBe(false);
  expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  gesture(renderer, "onPointerDown", 0, 600); gesture(renderer, "onPointerMove", 80, 601, 100);
  expect(surface(renderer).style.height).toBe("172px"); expect(surface(renderer).props["data-moving"]).toBe(false);
  const prevent = vi.fn(); const stop = vi.fn();
  handler(surface(renderer), "onClickCapture", { detail: 1, preventDefault: prevent, stopPropagation: stop });
  expect(prevent).toHaveBeenCalledOnce();
  handler(surface(renderer), "onClickCapture", { detail: 1, preventDefault: prevent, stopPropagation: stop });
  expect(prevent).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  click(renderer, "Развернуть площадку"); expect(surface(renderer).props.role).toBe("dialog");
  expect(surface(renderer).querySelector(".gb-venue-handle")).toBeTruthy();
});
it.each([false, true])("traps Tab shift=%s within the common dialog boundary, cleans capture options and restores focus", async shiftKey => {
  const { renderer } = await start(); const add = vi.spyOn(window, "addEventListener"); const remove = vi.spyOn(window, "removeEventListener");
  renderer.find("Развернуть площадку").focus(); click(renderer, "Развернуть площадку");
  expect(dom.activeElement?.props["aria-label"]).toBe("Закрыть");
  const boundary = surface(renderer); const targets = boundary.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]');
  const first = targets[0]; const last = targets.at(-1); if (!first || !last) throw new Error("Missing focus targets");
  (shiftKey ? first : last).focus();
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true); expect(dom.activeElement).toBe(shiftKey ? last : first);
  click(renderer, "Закрыть"); expect(dom.activeElement?.className).toBe("gb-venue-handle");
  const entry = add.mock.calls.find(([name, , options]) => name === "keydown" && typeof options === "object" && options?.capture);
  if (!entry) throw new Error("Missing capture key listener");
  expect(remove.mock.calls.some(([name, listener, options]) => name === entry[0] && listener === entry[1] && options === entry[2])).toBe(true);
  expect(body.style.overflow).toBeUndefined();
});
it("retains empty and unavailable schedule messages", async () => {
  transport.games.mockResolvedValue({ ok: true, data: [] }); const { renderer } = await start(); click(renderer, "Развернуть площадку");
  expect(output(renderer)).toContain("Создать игру на этой площадке");
  transport.games.mockResolvedValue({ ok: false }); window.dispatchEvent(new Event("focus")); await settle(renderer);
  expect(output(renderer)).toContain("Расписание временно недоступно"); expect(output(renderer)).not.toContain("Показать игры на этой площадке");
});
it("consumes the drag click once after the closing Sheet has unmounted", async () => {
  const { renderer } = await start(); const image = photo(); click(renderer, "Развернуть площадку");
  gesture(renderer, "onPointerDown", 0, 100); gesture(renderer, "onPointerMove", 0, 600, 100); gesture(renderer, "onPointerUp", 0, 600, 110);
  expect(surface(renderer).props["data-expanded"]).toBe(false);
  expect(renderer.nodes().some(node => node.className === "gb-venue-sheet")).toBe(true);
  await vi.advanceTimersByTimeAsync(220); renderer.render();
  expect(renderer.nodes().some(node => node.className === "gb-venue-sheet")).toBe(false);
  expect(image.parentNode?.className).toContain("gb-venue-preview-cover");
  const prevent = vi.fn(); const stop = vi.fn();
  handler(surface(renderer), "onClickCapture", { detail: 1, preventDefault: prevent, stopPropagation: stop });
  handler(surface(renderer), "onClickCapture", { detail: 1, preventDefault: prevent, stopPropagation: stop });
  expect(prevent).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  click(renderer, "Развернуть площадку"); expect(image.srcWrites).toEqual([cover]);
});
