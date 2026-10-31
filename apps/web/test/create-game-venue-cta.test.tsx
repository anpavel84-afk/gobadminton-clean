import { Children, isValidElement } from "react";
import type * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VenueSummary } from "../src/lib/consumer-types";
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useId: () => "venue-title",
  useState<T>(initial: T) {
    const index = hooks.cursor++; const slots = hooks.slots;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [slots[index], (next: T | ((old: T) => T)) => {
      slots[index] = typeof next === "function" ? (next as (old: T) => T)(slots[index] as T) : next;
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

import { CreateGamePage, CreateGamePresentation } from "../src/components/consumer/pages/CreateGamePage";
import { GameLevelRange } from "../src/components/consumer/games/GameLevelRange";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { venueCreatePath } from "../src/lib/games-venue-map";
import { AuthEntry } from "../src/components/consumer/players/ProfileComposition";
const city = { cityId: "city", timezone: "Europe/Moscow", cityName: "Москва" };
vi.mock("../src/components/consumer/discovery/DiscoveryCityProvider", () => ({ useDiscoveryCity: () => ({ location: city }) }));
const venue: VenueSummary = { id: "зал /?&=+", cityId: "city", timezone: city.timezone, name: "Зал", address: "Улица" };
let mode: "guest" | "setup" | "ready";
let catalog: VenueSummary[];
let finishCatalog: (() => void) | undefined;
const requests: { url: string; method: string }[] = [];
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
let pageProps: React.ComponentProps<typeof CreateGamePage> = {};
function render() {
  hooks.cursor = 0; const page = CreateGamePage(pageProps);
  const tree = CreateGamePresentation(page.props as React.ComponentProps<typeof CreateGamePresentation>);
  hooks.effects.splice(0).forEach(effect => effect()); return tree;
}
function fromCta() {
  // Separate component instance: do not mix sheet and form hook slots.
  const sheetProps = { venue, games: [], gamesReady: true, now: 0, active: false, embedded: true, onCollapse() {}, onDeselect() {} };
  const tree = VenueSheet(sheetProps);
  const cta = elements(tree).find(node => node.type === "button" && Children.toArray(node.props.children as React.ReactNode).includes("Создать игру на этой площадке"));
  if (!cta) throw new Error("Missing create CTA");
  expect(cta.props.href).toBeUndefined(); (cta.props.onClick as () => void)();
  hooks.cursor = 0;
  const create = elements(VenueSheet(sheetProps)).find(node => node.type === CreateGamePage);
  if (!create) throw new Error("Missing embedded create");
  pageProps = create.props as React.ComponentProps<typeof CreateGamePage>;
  const route = new URL(venueCreatePath(new URLSearchParams({ venueId: venue.id }).toString()), "https://dev.gobadminton.ru");
  expect(route.pathname).toBe("/games/create"); expect(route.searchParams.get("venueId")).toBe(venue.id);
  Object.assign(window.location, { search: "?venueId=unrelated" });
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  return route;
}
beforeEach(() => {
  pageProps = {}; mode = "ready"; catalog = [venue]; finishCatalog = undefined; requests.length = 0;
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search: "" }, sessionStorage: { getItem: () => null, removeItem() {} } }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET" });
    let status = 200; let body: unknown;
    if (url.startsWith("/v1/venues?")) {
      await new Promise<void>(resolve => { finishCatalog = resolve; }); body = { items: catalog, nextCursor: null };
    } else if (url === "/v1/me") { status = mode === "guest" ? 401 : 200; body = { id: "me", displayName: "Игрок", csrfToken: "test" }; }
    else if (url === "/v1/me/social-profile") body = { cityId: mode === "setup" ? null : city.cityId };
    else if (url === "/v1/me/trainer-profile") { status = 404; body = {}; }
    else if (url === "/v1/me/game-preferences") body = { defaultPublicGameContact: null };
    else throw new Error(`Unexpected transport: ${url}`);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { hooks.cleanups.forEach(fn => fn?.()); vi.unstubAllGlobals(); });
it.each(["guest", "setup"] as const)("preserves encoded venueId through %s return route without writes", async nextMode => {
  mode = nextMode; const route = fromCta(); render();
  await vi.waitFor(() => {
    const nodes = elements(render());
    if (mode === "guest") {
      const auth = nodes.find(node => node.type === AuthEntry);
      expect(auth?.props.returnPath).toBe(route.pathname + route.search);
      const path = String(auth?.props.returnPath);
      expect(new URL(path, route.origin).searchParams.get("venueId")).toBe(venue.id);
    } else {
      const setup = nodes.find(node => typeof node.props.href === "string" && node.props.href.startsWith("/profile/setup?"));
      expect(setup).toBeDefined();
      const returnTo = new URL(String(setup?.props.href), route.origin).searchParams.get("returnTo");
      expect(new URL(returnTo ?? "", route.origin).searchParams.get("venueId")).toBe(venue.id);
    }
  });
  finishCatalog?.(); await Promise.resolve();
  expect(requests.every(request => request.method === "GET")).toBe(true);
  expect(requests.some(request => /publish|^\/v1\/games/.test(request.url))).toBe(false);
});
it.each(["same", "foreign", "unknown"] as const)("selects only a loaded same-city catalog ID (%s)", kind => {
  catalog = kind === "foreign" ? [{ ...venue, cityId: "other" }] : kind === "unknown" ? [{ ...venue, id: "unknown" }] : [venue];
  const route = fromCta(); pageProps = {}; Object.assign(window.location, { search: route.search }); render();
  const triggerBefore = elements(render()).find(node => node.props.id === "venueId");
  if (triggerBefore) expect(elements(triggerBefore).some(node => node.props.children === venue.name)).toBe(false);
  return (async () => {
    await vi.waitFor(() => expect(finishCatalog).toBeDefined()); finishCatalog?.();
    await vi.waitFor(() => {
      const trigger = elements(render()).find(node => node.props.id === "venueId"); expect(trigger).toBeDefined();
      expect(elements(trigger).some(node => node.props.children === venue.name)).toBe(kind === "same");
    });
    expect(requests.every(request => request.method === "GET")).toBe(true);
    expect(requests.some(request => /publish|^\/v1\/games/.test(request.url))).toBe(false);
  })();
});
it("wires GameLevelRange into create form and payload preview", async () => {
  pageProps = {};
  Object.assign(window.location, { search: "" });
  render();
  await vi.waitFor(() => {
    expect(elements(render()).some((node) => node.type === GameLevelRange)).toBe(true);
  });
  finishCatalog?.();
  const level = elements(render()).find((node) => node.type === GameLevelRange);
  expect(level?.props.value).toBe("3.0, 3.5");
  (level!.props.onChange as (next: string) => void)("4.0, 4.5, 5.0");
  hooks.cursor = 0;
  const page = CreateGamePage(pageProps);
  expect(page.props.previewPayload?.levelRule.allowedLevelIds).toEqual(["4.0", "4.5", "5.0"]);
  const tree = CreateGamePresentation(page.props as React.ComponentProps<typeof CreateGamePresentation>);
  const again = elements(tree).find((node) => node.type === GameLevelRange);
  expect(again?.props.value).toBe("4.0, 4.5, 5.0");
});
