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
const venue: VenueSummary = { id: "v", cityId: MOSCOW_BUNDLE.cityId, name: "Зал", address: "Улица", timezone: "Europe/Moscow", latitude: 55.7, longitude: 37.6 };
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
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru", assign: navigation }, history: { pushState: navigation, replaceState: navigation } }));
  navigation.mockClear(); writes.mockClear();
  vi.stubGlobal("HTMLElement", FocusStub);
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: writes, removeItem() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { h.resizeCallback = fn; } observe() {} disconnect() {} });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, body: { style: { overflow: "" } }, querySelector: () => null, createElement: () => { const button = { addEventListener() {}, setAttribute() {}, replaceChildren: h.replace, append() {}, focus() { Object.assign(document, { activeElement: button }); } } as unknown as HTMLButtonElement; h.buttons.push(button); return button; } }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(MOSCOW_BUNDLE.styleHash.match(/../g)!.map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { h.cleanups.forEach(fn => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
const navigation = vi.fn(), writes = vi.fn();
class FocusStub { isConnected = true; focus() {} }
const game: Game = {
  id: "g", version: 1, title: "Игра", venue, startsAt: "2026-11-04T10:00:00Z", endsAt: "2026-11-04T11:00:00Z", timezone: venue.timezone,
  status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Анна", publicContact: "" }, applicationDeadlineAt: "2026-11-04T09:00:00Z",
  capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles",
  levelRule: { scaleId: "t", scaleVersion: 1, allowedLevelIds: [] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" },
};
function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
it("keeps tree position/key, map instance and camera across all sheet views, invalidation and dismissal without navigation or transport", async () => {
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  transport.venues.mockResolvedValue({ ok: true, data: [venue] });
  transport.games.mockResolvedValue({ ok: true, data: [game] });
  type Store = { slots: unknown[]; cleanups: (() => void)[] };
  const parent: Store = { slots: [], cleanups: [] }, mapStore: Store = { slots: [], cleanups: [] };
  let sheetStore: Store | null = null;
  let mapElement: React.ReactElement<React.ComponentProps<typeof GamesVenueMap>>;
  let sheetTree: React.ReactNode;
  const execute = <T,>(store: Store, fn: () => T): T => {
    h.slots = store.slots; h.cleanups = store.cleanups; h.cursor = 0;
    const result = fn();
    h.effects.splice(0).forEach(effect => effect());
    store.slots = h.slots; store.cleanups = h.cleanups; return result;
  };
  const cycle = (cityId = venue.cityId) => {
    const tree = execute(parent, () => GamesMapView({ cityId, day: "", onReturnToList: back }));
    const entries = nodes(tree);
    const foundMap = entries.find(node => node.type === GamesVenueMap);
    if (foundMap) {
      mapElement = foundMap as React.ReactElement<React.ComponentProps<typeof GamesVenueMap>>;
      execute(mapStore, () => {
        const result = GamesVenueMap(mapElement.props);
        for (const node of nodes(result)) {
          const ref = node.props.ref as { current: unknown } | undefined;
          if (ref) ref.current = { getBoundingClientRect: () => ({ width: 400, height: 400 }) };
        }
      });
    }
    const sheet = entries.find(node => node.type === VenueSheet);
    sheetTree = null;
    if (sheet) {
      sheetStore ??= { slots: [], cleanups: [] };
      sheetTree = execute(sheetStore, () => {
        const result = VenueSheet((sheet as React.ReactElement<React.ComponentProps<typeof VenueSheet>>).props);
        for (const node of nodes(result)) {
          const ref = node.props.ref as { current: unknown } | undefined;
          if (ref) ref.current = node.props.role === "dialog" ? { scrollTop: 0, querySelectorAll: () => [], contains: () => false } : new FocusStub();
        }
        return result;
      });
    } else if (sheetStore) { sheetStore.cleanups.forEach(fn => fn?.()); sheetStore = null; }
    return { tree, entries, mapIndex: entries.indexOf(foundMap!) };
  };
  const activate = (label: string) => {
    const button = nodes(sheetTree).find(node => node.type === "button" && (node.props["aria-label"] === label || node.props.children === label));
    if (!button) throw new Error(`Missing ${label}`);
    (button.props.onClick as () => void)();
  };
  cycle(); await vi.waitFor(() => expect(h.maps).toHaveLength(1)); await vi.advanceTimersByTimeAsync(0);
  const initial = cycle(); const key = mapElement!.key;
  const map = h.maps[0]!; map.emit("load"); cycle();
  const requests = transport.games.mock.calls.length, assets = vi.mocked(fetch).mock.calls.length;
  const camera = { center: map.getCenter(), zoom: map.getZoom() };
  mapElement!.props.onSelect(venue); let state = cycle();
  expect(state.entries.some(node => node.type === VenuePreviewCard)).toBe(true);
  const preview = state.entries.find(node => node.type === VenuePreviewCard) as React.ReactElement<React.ComponentProps<typeof VenuePreviewCard>>;
  preview.props.onOpen(); state = cycle();
  expect(nodes(sheetTree).filter(node => node.props.role === "dialog")).toHaveLength(1);
  activate("Показать игры на этой площадке"); cycle();
  const row = nodes(sheetTree).find(node => node.props.className === "gb-venue-game-row");
  (row?.props.onClick as () => void)(); cycle();
  activate("Назад к расписанию"); cycle(); activate("Назад к информации"); cycle();
  activate("Закрыть"); state = cycle();
  expect(state.mapIndex).toBe(initial.mapIndex); expect(mapElement!.key).toBe(key);
  expect(h.maps).toHaveLength(1); expect(map.remove).not.toHaveBeenCalled();
  expect({ center: map.getCenter(), zoom: map.getZoom() }).toEqual(camera);
  expect(transport.games).toHaveBeenCalledTimes(requests); expect(fetch).toHaveBeenCalledTimes(assets);
  expect(navigation).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  preview.props.onOpen(); cycle(); activate("Показать игры на этой площадке"); cycle();
  window.dispatchEvent(new Event("gb-session-changed")); cycle();
  expect(nodes(sheetTree).some(node => node.props.className === "gb-venue-game-row")).toBe(false);
  expect(nodes(sheetTree).some(node => node.props.children === "Расписание временно недоступно")).toBe(true);
  await vi.advanceTimersByTimeAsync(0); cycle();
  transport.venues.mockResolvedValue({ ok: true, data: [] });
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  state = cycle(); cycle();
  expect(state.entries.some(node => node.type === VenueSheet || node.type === VenuePreviewCard)).toBe(false);
  // City clears both preview and sheet immediately.
  state = cycle("other"); expect(state.entries.some(node => node.type === VenueSheet || node.type === VenuePreviewCard)).toBe(false);
  parent.cleanups.forEach(fn => fn?.()); mapStore.cleanups.forEach(fn => fn?.());
  h.cleanups = [];
  expect(map.remove).toHaveBeenCalledOnce(); expect(document.body.style.overflow).toBe("");
});
