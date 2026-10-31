import { Children, isValidElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[], maps: [] as FakeMap[], width: 400, buttons: [] as HTMLButtonElement[], markerCreates: 0, markerRemove: vi.fn(), resizeCallback: () => {}, lngLat: vi.fn(), jump: vi.fn(), replace: vi.fn() }));
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useId: () => "venue-integration",
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
  useCallback(fn: unknown, deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as { deps: unknown[]; fn: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) h.slots[i] = { deps, fn };
    return (h.slots[i] as { fn: unknown }).fn;
  },
  useContext(context: { _currentValue: unknown }) { return context._currentValue; },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = h.cursor++; const prev = h.slots[i] as unknown[] | undefined;
    if (!prev || deps.some((v, n) => v !== prev[n])) { h.slots[i] = deps; h.effects.push(() => { h.cleanups[i]?.(); h.cleanups[i] = effect() || (() => {}); }); }
  },
}));
vi.mock("../src/components/consumer/radar/RadarPage", () => ({ RadarPage: () => null }));
// This suite verifies map lifetime and venue navigation, not authenticated Game UI.
// Its global hook-array fixture intentionally does not model nested client actions.
// Real VenueGameActions contract has a separate SSR test in venue-popup-actions-174.
vi.mock("../src/components/consumer/games/VenueGameActions", () => ({
  VenueGameActions: ({ gameId }: { gameId: string }) => <section data-game-actions-for={gameId} />,
}));
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
  getContainer() { return { querySelector: () => null }; } project() { return { x: 0, y: 0 }; } jumpTo = h.jump;
},
  Marker: class { constructor() { h.markerCreates++; } setLngLat() { h.lngLat(); return this; } addTo() { return this; } remove = h.markerRemove; setOffset() {} getLngLat() { return [37.6, 55.7]; } },
}));
vi.mock("next/dynamic", async () => {
  const module = await import("../src/components/consumer/games/GamesVenueMap");
  return { default: () => module.GamesVenueMap };
});
vi.mock("../src/lib/api-client", () => ({
  apiFetch: vi.fn(() => { throw new Error("Unexpected apiFetch in map-only harness"); }),
  listAllCityVenues: () => transport.venues(),
  listAllUpcomingCityGames: () => transport.games(),
}));
const transport = vi.hoisted(() => ({ venues: vi.fn(), games: vi.fn() }));
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { VenuePopup } from "../src/components/consumer/games/VenuePopup";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
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
const venue: VenueSummary = { id: "v", cityId: MOSCOW_BUNDLE.cityId, name: "Зал", address: "Адрес", timezone: "Europe/Moscow", latitude: 55.7, longitude: 37.6 };
const game: Game = {
  id: "g", version: 1, title: "Вечерняя игра", venue, startsAt: "2026-11-04T16:00:00Z", endsAt: "2026-11-04T18:00:00Z", timezone: venue.timezone,
  status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Анна", publicContact: "" }, applicationDeadlineAt: "2026-11-04T16:00:00Z",
  capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles",
  levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: ["B"] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" }
};
/** Selected-day cycles must match fixture game local calendar day (not frozen clock day). */
const selectedDay = new Intl.DateTimeFormat("en-CA", { timeZone: game.venue.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(game.startsAt));
const navigation = { assign: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), setItem: vi.fn(), returnFlag: vi.fn() };
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
const errorCard = vi.fn();
const availability = vi.fn(); const back = vi.fn();
function hasAlert(node: React.ReactNode): boolean {
  if (!isValidElement<{ role?: string; children?: React.ReactNode }>(node)) return false;
  return node.props.role === "alert" || Children.toArray(node.props.children).some(hasAlert);
}
beforeEach(() => {
  Object.values(navigation).forEach(fn => fn.mockClear());
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z")); h.slots = []; h.cursor = 0; h.effects = []; h.cleanups = []; h.maps = []; h.width = 400;
  transport.games.mockReset(); transport.venues.mockReset();
  errorCard.mockClear(); availability.mockClear(); back.mockClear(); h.markerCreates = 0; h.markerRemove.mockClear(); h.buttons = []; h.lngLat.mockClear(); h.replace.mockClear(); h.jump.mockClear();
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://dev.gobadminton.ru", assign: navigation.assign }, history: navigation }));
  window.addEventListener("gb-map-return", navigation.returnFlag);
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: navigation.setItem, removeItem() {} });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { constructor(fn: () => void) { h.resizeCallback = fn; } observe() {} disconnect() {} });
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", activeElement: null, body: { style: { overflow: "" } }, querySelector: () => null, createElement: () => { const button = { addEventListener() {}, setAttribute() {}, replaceChildren: h.replace, append() {}, focus() { Object.assign(document, { activeElement: button }); } } as unknown as HTMLButtonElement; h.buttons.push(button); return button; } }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('{"version":8,"sources":{},"layers":[]}') })));
  vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array((MOSCOW_BUNDLE.styleHash.match(/../g) ?? []).map(hex => parseInt(hex, 16))).buffer } });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { h.cleanups.forEach(fn => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (node.type === VenuePopup) return [node, ...elements((node.props.expanded ? node.props.children : node.props.preview) as React.ReactNode)];
  return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
// Separate hook storage for parent and child models React component identity.
it.each(["games", "venues", "reject"] as const)("keeps the real Moscow map through initial failure, automatic polling and %s refresh failure", async resource => {
  const child = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
  let childMounted = false;
  const popupState = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
  let popupTree: React.ReactNode = null;
  let popupRendered = false;
  const captures = new Set<number>();
  const handleTarget = { setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) };
  const pointer = (handler: string, y: number, time: number) => {
    const handle = elements(popupTree).find(node => node.props.className === "gb-venue-handle");
    if (!handle) throw new Error("No handle");
    (handle.props[handler] as (event: unknown) => void)({ clientX: 0, clientY: y, timeStamp: time, pointerId: 1, isPrimary: true, button: 0, currentTarget: handleTarget, preventDefault() {} });
  };
  const sheet = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
  let sheetTree: React.ReactNode = null;
  let sheetMounted = false;
  const sheetClick = (text: string) => {
    const button = elements(sheetTree).find(node => node.type === "button" && (node.props["aria-label"] === text || renderToStaticMarkup(node).includes(text)));
    if (!button) throw new Error(`Missing sheet button ${text}`);
    (button.props.onClick as () => void)();
  };
  const countsSeen: (Map<string, number> | null)[] = [];
  const cycle = (day = "") => {
    h.cursor = 0;
    const tree = GamesMapView({ cityId: MOSCOW_BUNDLE.cityId, day });
    h.effects.splice(0).forEach(fn => fn());
    const parent = { slots: h.slots, cleanups: h.cleanups };
    let sawSheet = false;
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
      } else if (node.type === VenuePopup) {
        h.slots = popupState.slots; h.cleanups = popupState.cleanups; h.cursor = 0;
        popupTree = VenuePopup(node.props as unknown as React.ComponentProps<typeof VenuePopup>);
        popupRendered = true;
        for (const item of elements(popupTree)) {
          const ref = item.props.ref as { current: unknown } | undefined;
          if (ref) ref.current = { getBoundingClientRect: () => ({ height: item.props.className === "gb-venue-popup-full-measure" ? 772 : 172 }) };
        }
        h.effects.splice(0).forEach(fn => fn()); popupState.slots = h.slots; popupState.cleanups = h.cleanups;
        h.slots = parent.slots; h.cleanups = parent.cleanups;
        Children.forEach(popupTree, visit);
      } else if (node.type === VenueSheet) {
        h.slots = sheet.slots; h.cleanups = sheet.cleanups; h.cursor = 0;
        sawSheet = true; sheetMounted = true;
        sheetTree = VenueSheet(node.props as unknown as React.ComponentProps<typeof VenueSheet>);
        h.effects.splice(0).forEach(fn => fn()); sheet.slots = h.slots; sheet.cleanups = h.cleanups;
        h.slots = parent.slots; h.cleanups = parent.cleanups;
      } else Children.forEach(node.props.children, visit);
    };
    visit(tree);
    if (sheetMounted && !sawSheet) {
      sheet.cleanups.forEach(fn => fn?.()); sheet.slots = []; sheet.cleanups = []; sheetTree = null; sheetMounted = false;
    }
    return tree;
  };
  transport.venues.mockResolvedValue({ ok: false }); transport.games.mockResolvedValue({ ok: true, data: [game] });
  cycle(); expect(childMounted).toBe(true); expect(countsSeen.at(-1)).toBeNull();
  await vi.waitFor(() => expect(h.maps).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(hasAlert(cycle())).toBe(true);
  expect(countsSeen.at(-1)).toBeNull();
  const map = h.maps[0]; if (!map) throw new Error("Map missing"); map.emit("load");
  transport.venues.mockResolvedValue({ ok: true, data: [venue] });
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); cycle(); cycle();
  expect(countsSeen.at(-1)?.get("v")).toBe(1);
  const tree = cycle();
  const mapNode = elements(tree).find(node => node.type === GamesVenueMap);
  if (!mapNode) throw new Error("No map component");
  const callsBefore = transport.games.mock.calls.length;
  const venueCallsBefore = transport.venues.mock.calls.length; const cameraCalls = h.jump.mock.calls.length;
  (mapNode.props.onSelect as (value: VenueSummary) => void)(venue);
  const selected = cycle(); const preview = elements(selected).find(node => node.type === VenuePreviewCard);
  if (!preview) throw new Error("No preview");
  expect(popupRendered).toBe(true);
  pointer("onPointerDown", 700, 0); pointer("onPointerMove", 600, 1000); cycle();
  const firstPosition = elements(popupTree).find(node => node.props.className === "gb-venue-popup")?.props.style;
  pointer("onPointerMove", 200, 2000); cycle();
  expect(elements(popupTree).find(node => node.props.className === "gb-venue-popup")?.props.style).not.toEqual(firstPosition);
  expect(sheetTree).toBeNull(); // do not mount expanded cover at first swipe movement
  expect(transport.games).toHaveBeenCalledTimes(callsBefore); expect(transport.venues).toHaveBeenCalledTimes(venueCallsBefore);
  pointer("onPointerUp", 200, 2200); cycle();
  expect(sheetTree).toBeNull(); // keep cover in compact DOM until settle
  await vi.advanceTimersByTimeAsync(220); const expanded = cycle(); const popup = elements(expanded).find(node => node.type === VenueSheet);
  if (!popup) throw new Error("No sheet");
  expect(h.maps).toHaveLength(1); expect(map.remove).not.toHaveBeenCalled();
  sheetClick("Показать игры"); cycle();
  expect(renderToStaticMarkup(sheetTree)).toContain("Игры на этой площадке");
  sheetClick("Вечерняя игра"); cycle();
  expect(renderToStaticMarkup(sheetTree)).toContain("Вечерняя игра");
  sheetClick("К расписанию"); cycle();
  expect(renderToStaticMarkup(sheetTree)).toContain("Игры на этой площадке");
  expect(h.maps).toHaveLength(1); expect(map.remove).not.toHaveBeenCalled();
  // Collapse the same surface; its click guard survives the content unmount.
  pointer("onPointerDown", 100, 3000); pointer("onPointerMove", 650, 4000); cycle();
  pointer("onPointerUp", 650, 4200); cycle(); await vi.advanceTimersByTimeAsync(220);
  const collapsed = cycle(); expect(sheetTree).toBeNull();
  const shell = elements(popupTree).find(node => node.props.className === "gb-venue-popup");
  if (!shell) throw new Error("No persistent popup");
  const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  (shell.props.onClickCapture as (event: unknown) => void)(click);
  expect(click.preventDefault).toHaveBeenCalledOnce();
  expect(transport.games).toHaveBeenCalledTimes(callsBefore);
  expect(transport.venues).toHaveBeenCalledTimes(venueCallsBefore); expect(h.jump).toHaveBeenCalledTimes(cameraCalls);
  // Reopen into detail, then invalidate the session before the new transport settles.
  const nextPreview = elements(collapsed).find(node => node.type === VenuePreviewCard);
  if (!nextPreview) throw new Error("No collapsed preview");
  (nextPreview.props.onOpen as () => void)(); cycle(); sheetClick("Показать игры"); cycle(); sheetClick("Вечерняя игра"); cycle();
  window.dispatchEvent(new Event("gb-session-changed")); cycle();
  expect(renderToStaticMarkup(sheetTree)).toContain("Расписание временно недоступно");
  expect(renderToStaticMarkup(sheetTree)).not.toContain("Вечерняя игра");
  expect(renderToStaticMarkup(sheetTree)).not.toContain("Показать игры");
  await vi.advanceTimersByTimeAsync(0); cycle(); cycle();
  const verified = countsSeen.at(-1);
  const button = h.buttons[0]; if (!button) throw new Error("Marker missing"); button.focus();
  h.lngLat.mockClear(); h.replace.mockClear();
  const calls = transport.games.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000); cycle(); cycle();
  expect(transport.games.mock.calls.length).toBeGreaterThan(calls);
  await vi.advanceTimersByTimeAsync(30000); cycle(); cycle();
  expect(countsSeen.at(-1)).toBe(verified);
  expect(h.buttons).toEqual([button]); expect(document.activeElement).toBe(button);
  expect(h.lngLat).not.toHaveBeenCalled(); expect(h.replace).not.toHaveBeenCalled();
  cycle(selectedDay); await vi.advanceTimersByTimeAsync(0); cycle(selectedDay);
  if (resource === "reject") transport.games.mockRejectedValue(new Error("offline"));
  else if (resource === "games") transport.games.mockResolvedValue({ ok: false });
  else transport.venues.mockResolvedValue({ ok: false });
  sheetClick("Показать игры"); cycle(selectedDay); sheetClick("Вечерняя игра"); cycle(selectedDay);
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); cycle(selectedDay);
  expect(renderToStaticMarkup(sheetTree)).toContain("Расписание временно недоступно");
  expect(renderToStaticMarkup(sheetTree)).not.toContain("Вечерняя игра");
  expect(renderToStaticMarkup(sheetTree)).not.toContain("Показать игры");
  expect(navigation.assign).not.toHaveBeenCalled(); expect(navigation.pushState).not.toHaveBeenCalled(); expect(navigation.replaceState).not.toHaveBeenCalled();
  expect(navigation.setItem).not.toHaveBeenCalled(); expect(navigation.returnFlag).not.toHaveBeenCalled();
  expect(hasAlert(cycle(selectedDay))).toBe(true);
  expect(countsSeen.at(-1)).toBeNull(); expect(h.maps).toHaveLength(1); expect(map.remove).not.toHaveBeenCalled();
  popupState.cleanups.forEach(fn => fn?.()); sheet.cleanups.forEach(fn => fn?.()); h.cleanups.forEach(fn => fn?.());
  child.cleanups.forEach(fn => fn?.()); expect(map.remove).toHaveBeenCalledOnce();
});
