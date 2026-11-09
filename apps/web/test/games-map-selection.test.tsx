import { Children, isValidElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";

// Explicit effect/state harness: real component, transport, pagination, timers and cards.
// No browser dependency is installed in this source checkout.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, active: false,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));

function manual<T>(render: () => T): T {
  const previous = hooks.active; hooks.active = true;
  try { return render(); } finally { hooks.active = previous; }
}
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useContext<T>(context: React.Context<T>) {
      return hooks.active ? (context as React.Context<T> & { _currentValue: T })._currentValue : actual.useContext(context);
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: React.DependencyList) {
      if (!hooks.active) return actual.useCallback(fn, deps);
      const i = hooks.cursor++;
      const previous = hooks.slots[i] as { deps: React.DependencyList; fn: T } | undefined;
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) hooks.slots[i] = { deps, fn };
      return (hooks.slots[i] as { fn: T }).fn;
    },
    useState<T>(initial: T | (() => T)) {
      if (!hooks.active) return actual.useState(initial);
      const index = hooks.cursor++; const slots = hooks.slots;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slots[index], (next: T | ((old: T) => T)) => {
        slots[index] = typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
      }];
    },
    useRef(initial: unknown) { if (!hooks.active) return actual.useRef(initial); const i = hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
    useMemo(fn: () => unknown, deps: unknown[]) {
      if (!hooks.active) return actual.useMemo(fn, deps);
      const i = hooks.cursor++; const prev = hooks.slots[i] as { deps: unknown[]; value: unknown } | undefined;
      if (!prev || deps.some((v, n) => v !== prev.deps[n])) hooks.slots[i] = { deps, value: fn() };
      return (hooks.slots[i] as { value: unknown }).value;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      if (!hooks.active) return actual.useEffect(effect, deps);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as unknown[] | undefined;
      if (!previous || deps.some((value, i) => value !== previous[i])) {
        hooks.slots[index] = deps;
        hooks.effects.push(() => { hooks.cleanups[index]?.(); hooks.cleanups[index] = effect() || (() => {}); });
      }
    },
    // This harness models synchronous render snapshots; detailed resource subscribe/unsubscribe covered by selected-venue-cover test.
    useSyncExternalStore<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T) { if (!hooks.active) return actual.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); hooks.cursor++; return getSnapshot(); },
  };
});
vi.mock("next/dynamic", () => ({ default: () => function CapturedMap() { return <div data-map="harness" />; } }));
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import { VenuePopup } from "../src/components/consumer/games/VenuePopup";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
const a: VenueSummary = { id: "a", cityId: MOSCOW_BUNDLE.cityId, name: "Зал А", address: "Улица А", timezone: "Europe/Moscow", latitude: 55.7, longitude: 37.6 };
const b: VenueSummary = { ...a, id: "b", name: "Зал Б", address: "Улица Б" };
const game: Game = { id: "game", version: 1, title: "Игра", venue: a, startsAt: "2026-11-04T10:00:00Z", endsAt: "2026-11-04T11:00:00Z", timezone: a.timezone,
  status: "published", visibility: "public", activityKind: "trainer_led", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Организатор", publicContact: "" }, applicationDeadlineAt: "2026-11-04T09:00:00Z", capacity: 4,
  externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles", levelRule: { scaleId: "t", scaleVersion: 1, allowedLevelIds: [] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
let venues: VenueSummary[]; let gamesReady: boolean; let dialog: boolean;
const assign = vi.fn(); const writes = vi.fn(); const returned = vi.fn();
function render(overrides: Partial<React.ComponentProps<typeof GamesMapView>> = {}) {
  hooks.cursor = 0;
  const tree = manual(() => GamesMapView({ cityId: a.cityId, day: "2026-11-10", activity: "trainer_led", ...overrides }));
  hooks.effects.splice(0).forEach(effect => effect()); return tree;
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (node.type === VenuePopup) return [node, ...elements((node.props.expanded ? node.props.children : node.props.preview) as React.ReactNode)];
    return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
function mapProps(tree: React.ReactNode) {
  const map = elements(tree).find(node => typeof node.props.onSelect === "function");
  if (!map) throw new Error("Map props missing");
  return map.props as { onSelect: (venue: VenueSummary) => void; selectedVenueId: string | null; onAvailability: (ready: boolean) => void; onReturnToList: () => void };
}
function preview(tree: React.ReactNode) {
  const card = elements(tree).find(node => node.type === VenuePreviewCard);
  if (!card) throw new Error("Preview missing");
  return card as React.ReactElement<React.ComponentProps<typeof VenuePreviewCard>>;
}
async function load() { render(); await vi.advanceTimersByTimeAsync(1); render(); return render(); }
function escape(prevented = false) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
  if (prevented) event.preventDefault();
  window.dispatchEvent(event); return event;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  venues = [a, b]; gamesReady = true; dialog = false; assign.mockClear(); writes.mockClear(); returned.mockClear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { origin: "https://example.test", hash: "", href: "https://example.test/games?view=map&day=2026-11-10", pathname: "/games", search: "?view=map&day=2026-11-10", assign } }));
  window.addEventListener("gb-map-return", returned);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", documentElement: { getAttribute: (name: string) => name === "data-gb-session-presence" ? "absent" : null }, querySelector: () => dialog ? {} : null }));
  vi.stubGlobal("sessionStorage", { setItem: writes });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const isVenues = url.startsWith("/v1/venues");
    return new Response(JSON.stringify({ items: isVenues ? venues : [game], nextCursor: null }), { status: isVenues || gamesReady ? 200 : 503 });
  }));
});
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup?.()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("selects A/B above the map without navigation, flags or requests; card expands without navigation", async () => {
  let tree = await load(); const requests = vi.mocked(fetch).mock.calls.length;
  expect(mapProps(tree).selectedVenueId).toBeNull();
  mapProps(tree).onSelect(a); tree = render();
  expect(preview(tree).props.venue).toEqual(a); expect(mapProps(tree).selectedVenueId).toBe("a");
  expect(renderToStaticMarkup(preview(tree))).toContain("13:00 – 14:00 · 4 нояб.");
  mapProps(tree).onSelect(a); tree = render(); expect(preview(tree).props.venue.id).toBe("a");
  mapProps(tree).onSelect(b); tree = render(); expect(preview(tree).props.venue).toEqual(b);
  expect(assign).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(returned).not.toHaveBeenCalled();
  expect(window.location.search).toBe("?view=map&day=2026-11-10"); expect(fetch).toHaveBeenCalledTimes(requests);
  preview(tree).props.onOpen();
  tree = render();
  expect(elements(tree).some(node => node.type === VenueSheet)).toBe(true);
  expect(assign).not.toHaveBeenCalled(); expect(returned).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
});
it("keeps fallback selection and activity while day does not restrict the preview", async () => {
  let tree = await load(); mapProps(tree).onAvailability(false); tree = render();
  const fallback = elements(tree).find(node => node.type === "button" && node.props.className === "gb-discovery-chip");
  if (!fallback) throw new Error("Fallback missing");
  (fallback.props.onClick as () => void)(); expect(preview(render()).props.venue.id).toBe("a"); expect(assign).not.toHaveBeenCalled();
  mapProps(tree).onSelect(a); tree = render({ activity: "regular" });
  expect(renderToStaticMarkup(preview(tree))).toContain("Пока нет игр");
});
it("capture Escape consumes selection before external handlers; respects dialogs and defaultPrevented", async () => {
  let tree = await load(); mapProps(tree).onSelect(a); render();
  const external = vi.fn((event: Event) => { if (!event.defaultPrevented) assign("list"); });
  window.addEventListener("keydown", external);
  expect(escape().defaultPrevented).toBe(true); tree = render();
  expect(elements(tree).some(node => node.type === VenuePreviewCard)).toBe(false); expect(assign).not.toHaveBeenCalled();
  expect(escape().defaultPrevented).toBe(false); expect(assign).toHaveBeenCalledWith("list");
  mapProps(tree).onSelect(a); render(); dialog = true; expect(escape().defaultPrevented).toBe(false);
  expect(preview(render()).props.venue.id).toBe("a"); dialog = false;
  escape(true); expect(preview(render()).props.venue.id).toBe("a"); window.removeEventListener("keydown", external);
});
it("clears selection on city change and venue removal; unavailable snapshot is never a verified empty", async () => {
  let tree = await load(); mapProps(tree).onSelect(a); render();
  gamesReady = false; window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(1);
  tree = render(); expect(renderToStaticMarkup(preview(tree))).toContain("Расписание временно недоступно");
  venues = [b]; await vi.advanceTimersByTimeAsync(751); // past bounded focus-refresh cooldown
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(1);
  tree = render(); render(); expect(elements(tree).some(node => node.type === VenuePreviewCard)).toBe(false);
  mapProps(tree).onSelect(b); render(); tree = render({ cityId: "other" });
  expect(elements(tree).some(node => node.type === VenuePreviewCard)).toBe(false);
});

it("keeps the popup identity and selected venue when presentation changes", async () => {
  let tree = await load(); mapProps(tree).onSelect(a); tree = render();
  const compact = elements(tree).find(node => node.type === VenuePopup);
  preview(tree).props.onOpen(); tree = render();
  const expanded = elements(tree).find(node => node.type === VenuePopup);
  expect(expanded?.key).toBe(compact?.key);
  expect(expanded?.props.expanded).toBe(true);
  expect(mapProps(tree).selectedVenueId).toBe(a.id);
  expect(assign).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(returned).not.toHaveBeenCalled();
});

it.each([true, false])("guards list navigation with caller callback=%s until unresolved operations and dialogs finish", async withCallback => {
  const onReturnToList = vi.fn();
  const overrides = { onReturnToList: withCallback ? onReturnToList : undefined };
  let tree = await load();
  mapProps(tree).onSelect(a);
  tree = render(overrides);
  preview(tree).props.onOpen();
  tree = render(overrides);
  const sheet = elements(tree).find(node => node.type === VenueSheet) as React.ReactElement<React.ComponentProps<typeof VenueSheet>> | undefined;
  if (!sheet?.props.onUnresolvedChange) throw new Error("Missing unresolved operation callback");
  sheet.props.onUnresolvedChange(true);
  mapProps(tree).onReturnToList();
  expect(onReturnToList).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
  tree = render(overrides);
  expect(mapProps(tree).selectedVenueId).toBe(a.id);
  expect(renderToStaticMarkup(tree)).toContain("Завершите текущую операцию");
  sheet.props.onUnresolvedChange(false);
  dialog = true;
  mapProps(tree).onReturnToList();
  expect(onReturnToList).not.toHaveBeenCalled(); expect(assign).not.toHaveBeenCalled();
  dialog = false;
  mapProps(tree).onReturnToList();
  if (withCallback) {
    expect(onReturnToList).toHaveBeenCalledOnce(); expect(assign).not.toHaveBeenCalled();
  } else {
    expect(assign).toHaveBeenCalledExactlyOnceWith("/games"); expect(onReturnToList).not.toHaveBeenCalled();
  }
});
