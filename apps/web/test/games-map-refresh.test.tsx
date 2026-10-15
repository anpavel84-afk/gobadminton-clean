import { Children, isValidElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";

// Explicit effect/state harness: real component, transport, pagination, timers and cards.
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
  useMemo: (fn: () => unknown) => fn(),
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
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
const venue = { id: "venue-id", cityId: "city", name: "Venue", address: "Address", timezone: "Europe/Moscow" } as VenueSummary;
const game = { id: "game-id", title: "Delayed game", venue, status: "published", visibility: "public", availablePlaces: 2,
  startsAt: "2026-10-18T12:00:00Z", applicationDeadlineAt: "2026-10-18T11:00:00Z" } as Game;
let requests: { url: URL; signal: AbortSignal }[];
let inFlight: number;
let maxInFlight: number;
let fail: boolean;
let ignoreAbort: boolean;
function render(cityId = "city", day = "") {
  hooks.cursor = 0;
  const tree = GamesMapView({ cityId, day });
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function html(cityId = "city", day = "") { return renderToStaticMarkup(render(cityId, day)); }
function unmount() { for (const cleanup of hooks.cleanups) cleanup?.(); }
function selectVenue() {
  // The selected immutable venue ID is the sixth state slot, after snapshot/error/loading/refresh/now.
  hooks.slots[5] = venue.id;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  hooks.slots = []; hooks.cleanups = []; hooks.effects = []; hooks.cursor = 0;
  requests = []; inFlight = 0; maxInFlight = 0; fail = false; ignoreAbort = false;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const parsed = new URL(url, "https://example.test");
    const signal = init.signal as AbortSignal;
    requests.push({ url: parsed, signal }); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    const finish = () => { inFlight--; signal.removeEventListener("abort", abort); };
    const abort = () => { if (ignoreAbort) return; clearTimeout(timer); finish(); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => {
      finish();
      const isVenue = parsed.pathname === "/v1/venues";
      resolve(new Response(JSON.stringify(fail ? { title: "Offline" } : {
        items: [isVenue ? { ...venue, cityId: parsed.searchParams.get("cityId") } : game],
        nextCursor: parsed.searchParams.has("cursor") ? null : "page-2",
      }), { status: fail ? 503 : 200 }));
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
  selectVenue();
  const completed = html();
  expect(completed).toContain("Venue · 1");
  expect(completed).toContain('href="/games/game-id"');
  expect(completed).toContain("Delayed game");
  expect(completed).not.toContain("Загружаем");
  await vi.advanceTimersByTimeAsync(29999);
  expect(requests).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(1);
  expect(requests).toHaveLength(6);
  expect(html()).toContain("Venue · ?");
  expect(html()).not.toContain("Delayed game");
  await vi.advanceTimersByTimeAsync(40000);
  expect(html()).toContain("Delayed game");
  expect(maxInFlight).toBe(2); // at most one request per resource, never two snapshots
});
it("retains public venues with unknown counts and truthful failure state", async () => {
  render(); await vi.advanceTimersByTimeAsync(40000); selectVenue();
  fail = true;
  await vi.advanceTimersByTimeAsync(50000);
  const failed = html();
  expect(failed).toContain("Venue · ?");
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Расписание временно недоступно");
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
    // Open the retained venue through its real list interaction before checking its schedule.
    let selected = false;
    const clickVenue = (node: React.ReactNode): void => {
      if (!isValidElement<{ children?: React.ReactNode; onClick?: () => void; "aria-pressed"?: boolean }>(node)) return;
      if (node.type === "button" && node.props["aria-pressed"] !== undefined && Children.toArray(node.props.children).join("") === "Venue · 0") {
        node.props.onClick?.(); selected = true;
      }
      Children.forEach(node.props.children, clickVenue);
    };
    clickVenue(render("city", "2026-10-19"));
    expect(selected).toBe(true);
    const dated = html("city", "2026-10-19");
    expect(dated).toContain("Нет игр в выбранную дату");
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
