import { Children, isValidElement } from "react";
import type * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Game, Venue } from "../src/lib/consumer-types";

// Every function component has its own hook slots, dependency history and cleanup.
// Only shell chrome and the DOM/map engine are replaced; venue components and HTTP are real.
type Instance = { slots: unknown[]; cursor: number; cleanups: Map<number, () => void> };
const runtime = vi.hoisted(() => ({ current: null as Instance | null, pending: [] as (() => void)[] }));
function current() { if (!runtime.current) throw new Error("Hook outside component"); return runtime.current; }
vi.mock("react", async original => {
  const real = await original<typeof React>();
  function instance() { if (!runtime.current) throw new Error("Missing hook instance"); return runtime.current; }
  return { ...real,
    useState<T>(initial: T | (() => T)) {
      const state = instance(), index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [state.slots[index], (next: T | ((old: T) => T)) => {
        state.slots[index] = typeof next === "function" ? (next as (old: T) => T)(state.slots[index] as T) : next;
      }];
    },
    useRef(initial: unknown) { const state = instance(), index = state.cursor++; return state.slots[index] ??= { current: initial }; },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const state = instance(), index = state.cursor++;
      const previous = state.slots[index] as { deps: unknown[]; value: unknown } | undefined;
      if (!previous || deps.some((value, n) => value !== previous.deps[n])) state.slots[index] = { deps, value: fn() };
      return (state.slots[index] as { value: unknown }).value;
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const state = instance(), index = state.cursor++, previous = state.slots[index] as unknown[] | undefined;
      if (!deps || !previous || deps.some((value, n) => value !== previous[n])) {
        state.slots[index] = deps;
        runtime.pending.push(() => { state.cleanups.get(index)?.(); const cleanup = effect(); if (cleanup) state.cleanups.set(index, cleanup); else state.cleanups.delete(index); });
      }
    },
  };
});
vi.mock("../src/components/consumer/ConsumerShell", () => ({ ConsumerShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a> }));
vi.mock("next/dynamic", () => ({ default: () => function MapStub() { return <div data-map="stub" />; } }));
import { VenuePage } from "../src/components/consumer/venues/VenuePage";
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { getMe } from "../src/lib/api-client";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
const cover = "/v1/media/venue-covers/" + "a".repeat(64) + ".png";
const a: Venue = { id: "a", cityId: MOSCOW_BUNDLE.cityId, name: "Зал А", address: "Адрес А", timezone: "Europe/Moscow", latitude: 55.7, longitude: 37.6, dataStatus: "verified", provenance: "admin_created", cover: { uploadedUrl: cover, credit: { kind: "illustration", text: "Автор фото", url: null } } };
const b: Venue = { ...a, id: "b", name: "Зал Б", cover: { uploadedUrl: null } };
const game: Game = { id: "game", version: 1, title: "Тестовая игра", venue: a, startsAt: "2027-01-01T10:00:00Z", endsAt: "2027-01-01T11:00:00Z", timezone: a.timezone, status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null, organizer: { id: null, displayName: "Организатор", publicContact: "" }, applicationDeadlineAt: "2027-01-01T09:00:00Z", capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles", levelRule: { scaleId: "t", scaleVersion: 1, allowedLevelIds: [] }, settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
let instances = new Map<string, Instance>();
let nodes: React.ReactElement<Record<string, unknown>>[] = [];
let text = "";
let signedIn = false, publicFailure = false, gamesReady = true;
let games: Game[] = [];
const calls: string[] = [];
function cleanup(state: Instance) { state.cleanups.forEach(fn => fn()); }
function render(root: React.ReactNode) {
  nodes = []; text = ""; const seen = new Set<string>();
  function walk(node: React.ReactNode, path: string): void {
    if (typeof node === "string" || typeof node === "number") { text += node; return; }
    if (!isValidElement<Record<string, unknown>>(node)) return;
    nodes.push(node);
    if (typeof node.type === "function") {
      const key = `${path}:${node.type.name}:${node.key ?? ""}`;
      seen.add(key);
      let state = instances.get(key);
      if (!state) { state = { slots: [], cursor: 0, cleanups: new Map() }; instances.set(key, state); }
      runtime.current = state; current().cursor = 0;
      const output = (node.type as (props: Record<string, unknown>) => React.ReactNode)(node.props);
      runtime.current = null; walk(output, key); return;
    }
    Children.toArray(node.props.children as React.ReactNode).forEach((child, index) => walk(child, `${path}/${index}`));
  }
  walk(root, "root");
  for (const [key, state] of instances) if (!seen.has(key)) { cleanup(state); instances.delete(key); }
  runtime.pending.splice(0).forEach(effect => effect());
}
async function settle(root: React.ReactNode) {
  for (let round = 0; round < 8; round++) { render(root); await vi.advanceTimersByTimeAsync(1); }
  render(root);
}
function assertPublic() {
  expect(calls.filter(path => path.startsWith("/v1/admin/"))).toEqual([]);
  expect(nodes.some(node => typeof node.type === "function" && node.type.name === "VenueCoverEditor")).toBe(false);
  expect(text).not.toContain("Обложка площадки");
  expect(nodes.some(node => node.type === "input" && node.props.type === "file")).toBe(false);
}
function action(predicate: (node: React.ReactElement<Record<string, unknown>>) => boolean, prop: string): (...args: unknown[]) => void {
  const node = nodes.find(predicate), callback = node?.props[prop];
  if (typeof callback !== "function") throw new Error(`Missing action ${prop}`);
  return callback as (...args: unknown[]) => void;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  instances = new Map(); runtime.pending = []; calls.length = 0; games = [game]; signedIn = false; publicFailure = false; gamesReady = true;
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search: "", pathname: "/games", assign: vi.fn() } }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", querySelector: () => null }));
  vi.stubGlobal("sessionStorage", { setItem: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const path = String(input); calls.push(path);
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path.startsWith("/v1/admin/")) return reply({}, 403);
    if (path === "/v1/me") return reply(signedIn ? { user: { id: "member" }, profile: null } : {}, signedIn ? 200 : 401);
    if (path === "/v1/venues/a" || path === "/v1/venues/b") return reply(path.endsWith("/a") ? a : b, publicFailure ? 503 : 200);
    if (path.startsWith("/v1/venues?")) return reply({ items: [a, b], nextCursor: null });
    if (path.startsWith("/v1/games?")) return reply({ items: games, nextCursor: null }, gamesReady ? 200 : 503);
    throw new Error(`Unexpected request ${path}`);
  }));
});
afterEach(() => { instances.forEach(cleanup); runtime.pending = []; vi.useRealTimers(); vi.unstubAllGlobals(); });
for (const member of [false, true]) {
  it(`keeps public venue effects read-only for ${member ? "member" : "guest"}`, async () => {
    signedIn = member; expect((await getMe()).ok).toBe(member);
    let root = <VenuePage venueId="a" />; await settle(root);
    expect(text).toContain("Зал А"); expect(text).toContain("Адрес А"); expect(text).toContain("Автор фото"); expect(text).toContain("Тестовая игра");
    expect(nodes.some(node => node.type === "img" && node.props.src === cover)).toBe(true); assertPublic();
    await settle(root); assertPublic();
    games = []; window.dispatchEvent(new Event("focus")); await settle(root);
    expect(text).toContain("Нет предстоящих доступных игр"); assertPublic();
    gamesReady = false; window.dispatchEvent(new Event("focus")); await settle(root);
    expect(text).toContain("Расписание временно недоступно"); expect(text).not.toContain("Нет предстоящих доступных игр"); assertPublic();
    root = <VenuePage venueId="b" />; await settle(root);
    expect(text).toContain("Зал Б"); expect(nodes.some(node => node.props["data-cover"] === "default")).toBe(true); assertPublic();
    const map = <GamesMapView cityId={a.cityId} day="" />; await settle(map);
    action(node => typeof node.props.onSelect === "function", "onSelect")(a); await settle(map);
    expect(text).toContain("Зал А"); assertPublic();
    action(node => typeof node.props.onSelect === "function", "onSelect")(b); await settle(map);
    expect(text).toContain("Зал Б"); assertPublic();
  });
}
it("retries failed public GET successfully without any admin request", async () => {
  publicFailure = true; const root = <VenuePage venueId="a" />; await settle(root);
  expect(text).toContain("Площадка недоступна."); expect(text).toContain("Повторить"); assertPublic();
  publicFailure = false;
  action(node => node.type === "button" && node.props.children === "Повторить", "onClick")(); await settle(root);
  expect(text).toContain("Зал А"); expect(text).not.toContain("Площадка недоступна."); assertPublic();
  expect(calls.filter(path => path === "/v1/venues/a")).toHaveLength(2);
});
