import { Children, isValidElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";

// TR1-M3 preserves transport refresh semantics. Explicit effect/state harness: real component, transport, pagination, timers and cards.
// No browser dependency is installed in this source checkout.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: T | ((old: T) => T)) => {
      hooks.slots[index] = typeof next === "function" ? (next as (old: T) => T)(hooks.slots[index] as T) : next;
    }];
  },
  useRef(initial: unknown) { const i = hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const i = hooks.cursor++; const prev = hooks.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!prev || deps.some((v, n) => v !== prev.deps[n])) hooks.slots[i] = { deps, value: fn() };
    return (hooks.slots[i] as { value: unknown }).value;
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((value, i) => value !== previous[i])) {
      hooks.slots[index] = deps;
      hooks.effects.push(() => { hooks.cleanups[index]?.(); hooks.cleanups[index] = effect() || (() => {}); });
    }
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/dynamic", () => ({ default: () => () => <div>Map</div> }));
vi.mock("../src/components/consumer/discovery/DiscoveryGameCard", () => ({
  DiscoveryGameCard: ({ game }: { game: Game }) => <a href={`/games/${game.id}`}>{game.title}</a>,
}));
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import { GamesMapBackButton } from "../src/components/consumer/games/GamesMapBackButton";
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
const venue = { id: "venue-id", cityId: "city", name: "Venue", latitude: 55.75, longitude: 37.62, address: "Address", timezone: "Europe/Moscow" } as VenueSummary;
const game = { id: "game-id", title: "Delayed game", venue, status: "published", visibility: "public", availablePlaces: 2,
  startsAt: "2026-10-18T12:00:00Z", applicationDeadlineAt: "2026-10-18T11:00:00Z" } as Game;
let requests: { url: URL; signal: AbortSignal }[];
let inFlight: number;
let maxInFlight: number;
let fail: boolean;
let failResource: "games" | "venues" | "reject" | undefined;
let ignoreAbort: boolean;
let responseGame: Game;
function render(cityId = "city", day = "", venueId?: string, withReturn = false) {
  hooks.cursor = 0;
  const tree = GamesMapView({ cityId, day, venueId, onReturnToList: withReturn ? () => {} : undefined });
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function html(cityId = "city", day = "") { return renderToStaticMarkup(render(cityId, day)); }
function unmount() { for (const cleanup of hooks.cleanups) cleanup?.(); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  hooks.slots = []; hooks.cleanups = []; hooks.effects = []; hooks.cursor = 0;
  failResource = undefined;
  requests = []; inFlight = 0; maxInFlight = 0; fail = false; ignoreAbort = false;
  responseGame = game;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const parsed = new URL(url, "https://example.test");
    const signal = init.signal as AbortSignal;
    requests.push({ url: parsed, signal }); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    const finish = () => { inFlight--; signal.removeEventListener("abort", abort); };
    const abort = () => { if (ignoreAbort) return; clearTimeout(timer); finish(); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => {
      finish();
      const isVenue = parsed.pathname === "/v1/venues";
      if (failResource === "reject") { reject(new Error("offline")); return; }
      const resourceFailed = fail || (isVenue ? failResource === "venues" : failResource === "games");
      resolve(new Response(JSON.stringify(resourceFailed ? { title: "Offline" } : {
        items: [isVenue ? { ...venue, cityId: parsed.searchParams.get("cityId") } : responseGame],
        nextCursor: parsed.searchParams.has("cursor") ? null : "page-2",
      }), { status: resourceFailed ? 503 : 200 }));
    }, 20000);
    signal.addEventListener("abort", abort, { once: true });
  })));
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("finishes >30s sequential pagination, renders venues/schedules, and polls only after completion", async () => {
  render();
  await vi.advanceTimersByTimeAsync(31000);
  window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"));
  expect(requests).toHaveLength(4); // two resources, each on its second sequential page
  expect(html()).toContain("Загружаем");
  await vi.advanceTimersByTimeAsync(9000);
  const completed = html();
  expect(completed).toContain("Venue · 1");
  expect(completed).not.toContain("Delayed game"); // schedules live on the venue route
  expect(completed).not.toContain("Загружаем");
  await vi.advanceTimersByTimeAsync(29999);
  expect(requests).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toHaveLength(6);
  expect(html()).toContain("Venue · 1");
  expect(html()).not.toContain("Delayed game");
  await vi.advanceTimersByTimeAsync(40000);
  expect(html()).toContain("Venue · 1");
  expect(maxInFlight).toBe(2); // at most one request per resource, never two snapshots
});
it("retains public venues with unknown counts and truthful failure state", async () => {
  render(); await vi.advanceTimersByTimeAsync(40000);
  fail = true;
  await vi.advanceTimersByTimeAsync(50000);
  const failed = html();
  expect(failed).toContain("Venue · ?");
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Непроверенные количества не показываем");
  expect(failed).not.toContain("Delayed game");
  expect(failed).not.toContain("Загружаем");
});
it.each(["city", "date", "session", "unmount"])("cancels pending pages on %s and prevents stale completion or orphan polling", async change => {
  render(); await vi.advanceTimersByTimeAsync(25000);
  const old = [...requests];
  if (change === "city") render("other");
  if (change === "date") render("city", "2026-10-19");
  if (change === "session") { window.dispatchEvent(new Event("gb-session-changed")); render(); }
  if (change === "unmount") unmount();
  expect(old.every(request => request.signal.aborted)).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(inFlight).toBe(change === "unmount" ? 0 : 2);
  await vi.advanceTimersByTimeAsync(40000);
  if (change === "city") expect(html("other")).not.toContain("Delayed game");
  if (change === "date") {
    const dated = html("city", "2026-10-19");
    expect(dated).toContain("Venue · 0");
    expect(dated).not.toContain("Delayed game");
  }
  unmount();
  const count = requests.length;
  await vi.advanceTimersByTimeAsync(90000);
  expect(requests).toHaveLength(count);
  expect(inFlight).toBe(0);
});

it("ignores late responses from an aborted transport without continuing its pagination", async () => {
  ignoreAbort = true;
  render(); await vi.advanceTimersByTimeAsync(25000);
  render("other");
  await vi.advanceTimersByTimeAsync(15000); // abandoned city's final pages resolve despite abort
  expect(html("other")).not.toContain("Venue · 1");
  expect(html("other")).toContain("Загружаем");
  await vi.advanceTimersByTimeAsync(25000);
  expect(html("other")).toContain("Venue · 0");
  expect(html("other")).not.toContain("Delayed game");
  unmount();
  const count = requests.length;
  await vi.advanceTimersByTimeAsync(90000);
  expect(requests).toHaveLength(count);
});

it("navigates catalog selection to the full venue route and renders only that venue schedule there", async () => {
  const assign = vi.fn<(url: string) => void>();
  Object.assign(window, { location: { pathname: "/games", search: "?view=map&day=2026-10-18", assign } });
  render(); await vi.advanceTimersByTimeAsync(40000);
  const tree = render();
  const clickVenue = (node: React.ReactNode): void => {
    if (!isValidElement<{ children?: React.ReactNode; onClick?: () => void }>(node)) return;
    if (node.type === "button" && Children.toArray(node.props.children).join("") === "Venue · 1") node.props.onClick?.();
    Children.forEach(node.props.children, clickVenue);
  };
  clickVenue(tree);
  expect(assign).toHaveBeenCalledTimes(1);
  const navigation = assign.mock.calls[0];
  if (!navigation) throw new Error("Expected one venue navigation");
  const destination = new URL(navigation[0], "https://example.test");
  expect(destination.pathname).toBe("/venues/venue-id");
  expect(destination.searchParams.get("returnTo")).toBe("/games?view=map&day=2026-10-18");
  const full = renderToStaticMarkup(render("city", "", venue.id));
  expect(full).toContain('aria-label="Расписание площадки"');
  expect(full).toContain('href="/games/game-id"');
  expect(full).toContain("Delayed game");
  expect(full).not.toContain('aria-label="Все площадки города"');
  expect(renderToStaticMarkup(render("city", "", "other-venue"))).not.toContain("Delayed game");
});


it("does not mount redundant venue controls on the normal map; exposes a closed fallback only on failure", async () => {
  const cityId = MOSCOW_BUNDLE.cityId;
  const day = "2026-10-18";
  // The real API client rejects games whose venue belongs to another city.
  responseGame = { ...game, venue: { ...venue, cityId } };
  render(cityId, day); await vi.advanceTimersByTimeAsync(40000);
  const normal = renderToStaticMarkup(render(cityId, day));
  expect(normal).not.toContain('aria-label="Все площадки города"');
  expect(normal).not.toContain("Venue · 1");
  const failMap = (node: React.ReactNode): void => {
    if (!isValidElement<{ children?: React.ReactNode; onAvailability?: (available: boolean) => void }>(node)) return;
    node.props.onAvailability?.(false);
    Children.forEach(node.props.children, failMap);
  };
  failMap(render(cityId, day));
  const fallback = renderToStaticMarkup(render(cityId, day));
  expect(fallback).toContain('class="gb-games-map-fallback"');
  expect(fallback).toContain("Venue · 1");
  expect(fallback).not.toContain("<details open");
});

it("ties the single return capsule to the M0 card, including retry and city reinitialization", async () => {
  const city = MOSCOW_BUNDLE.cityId;
  const mapView = (cityId: string) => render(cityId, "", undefined, true);
  const returns = (tree: React.ReactNode): number => {
    if (!isValidElement<{ children?: React.ReactNode }>(tree)) return 0;
    return Number(tree.type === GamesMapBackButton) + Children.toArray(tree.props.children).reduce<number>((sum, child) => sum + returns(child), 0);
  };
  const report = (tree: React.ReactNode, available: boolean, shown: boolean): void => {
    if (!isValidElement<{ children?: React.ReactNode; onAvailability?: (value: boolean) => void; onErrorCardChange?: (value: boolean) => void }>(tree)) return;
    tree.props.onAvailability?.(available);
    tree.props.onErrorCardChange?.(shown);
    Children.forEach(tree.props.children, child => report(child, available, shown));
  };
  expect(returns(mapView(city))).toBe(1); // snapshot pending
  await vi.advanceTimersByTimeAsync(40000);
  expect(returns(mapView(city))).toBe(1); // working map
  report(mapView(city), false, true);
  expect(returns(mapView(city))).toBe(0); // fatal M0 card
  report(mapView(city), false, false);
  expect(returns(mapView(city))).toBe(1); // retry loading, still unavailable
  report(mapView(city), false, true);
  expect(returns(mapView("other-city"))).toBe(1);
  await vi.advanceTimersByTimeAsync(40000);
  expect(returns(mapView("other-city"))).toBe(1);
  expect(returns(mapView(city))).toBe(1);
  await vi.advanceTimersByTimeAsync(40000);
  expect(returns(mapView(city))).toBe(1); // Moscow reinitializes with stale availability=false
});

it.each(["games", "venues", "reject"] as const)("invalidates counts after %s failure and preserves geography while pending", async resource => {
  render(); await vi.advanceTimersByTimeAsync(40000); expect(html()).toContain("Venue · 1");
  failResource = resource; window.dispatchEvent(new Event("focus"));
  expect(html()).toContain("Venue · 1");
  await vi.advanceTimersByTimeAsync(40000);
  expect(html()).toContain("Venue · ?"); expect(html()).toContain('role="alert"');
});
it("invalidates session counts before a replacement request resolves", async () => {
  render(); await vi.advanceTimersByTimeAsync(40000); expect(html()).toContain("Venue · 1");
  window.dispatchEvent(new Event("gb-session-changed"));
  expect(html()).toContain("Venue · ?");
  expect(html()).not.toContain("Venue · 0"); // invalidation must not fabricate a checked empty schedule
});

it.each(["visible", "minute"])("expires eligibility on %s independently of the pending transport", async trigger => {
  const city = MOSCOW_BUNDLE.cityId;
  responseGame = { ...game, venue: { ...venue, cityId: city }, applicationDeadlineAt: "2026-10-16T12:00:45Z" };
  const mapCounts = (): Map<string, number> | null | undefined => {
    let counts: Map<string, number> | null | undefined;
    const visit = (node: React.ReactNode): void => {
      if (!isValidElement<{ counts?: Map<string, number> | null; children?: React.ReactNode }>(node)) return;
      if ("counts" in node.props) counts = node.props.counts;
      Children.forEach(node.props.children, visit);
    };
    visit(render(city)); return counts;
  };
  render(city); await vi.advanceTimersByTimeAsync(40000);
  const verified = mapCounts(); expect(verified?.get(venue.id)).toBe(1);
  await vi.advanceTimersByTimeAsync(10000);
  expect(mapCounts()).toBe(verified); // still the same minute, no visible event
  if (trigger === "visible") document.dispatchEvent(new Event("visibilitychange"));
  else await vi.advanceTimersByTimeAsync(10000);
  expect(mapCounts()?.get(venue.id)).toBe(0);
});


it("recalculates eligibility immediately on a successful response inside the same minute", async () => {
  responseGame = { ...game, applicationDeadlineAt: "2026-10-16T12:00:45Z" };
  render(); await vi.advanceTimersByTimeAsync(40000);
  expect(html()).toContain("Venue · 1");
  // A single-page refresh completes at :46, before the minute clock changes.
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({
    items: [new URL(url, "https://example.test").pathname === "/v1/venues" ? venue : responseGame], nextCursor: null,
  }))));
  await vi.advanceTimersByTimeAsync(6000);
  window.dispatchEvent(new Event("focus"));
  expect(html()).toContain("Venue · 1");
  await vi.advanceTimersByTimeAsync(0);
  expect(html()).toContain("Venue · 0");
});
