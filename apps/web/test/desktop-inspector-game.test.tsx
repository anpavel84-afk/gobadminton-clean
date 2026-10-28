import { Children, isValidElement, type ReactNode } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
import { capacityStatusLabel } from "../src/lib/game-presentation";
import { discoveryGameWhen } from "../src/lib/discovery-presentation";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useId: () => "desktop-game-desc",
  useState<T>(initial: T) {
    const index = hooks.cursor++; const slots = hooks.slots;
    if (!(index in slots)) slots[index] = initial;
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
  useCallback(fn: unknown) { return fn; },
}));

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import { DesktopInspectorGame } from "../src/components/consumer/games/DesktopInspectorGame";
import { VenueGameActions } from "../src/components/consumer/games/VenueGameActions";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { GameHero, GameTerms } from "../src/components/consumer/games/GameDetailComposition";
import { DESKTOP_MAP_INSPECTOR_MQ } from "../src/components/consumer/games/DesktopMapInspector";
import { readFileSync } from "node:fs";

const venue: VenueSummary = {
  id: "a", cityId: "city", name: "ФОК", address: "Адрес 1", timezone: "Europe/Moscow",
  cover: { uploadedUrl: null },
};
function fixture(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1", version: 1, title: "Demo Beginner Mix", venue, startsAt: "2026-11-07T16:00:00Z", endsAt: "2026-11-07T18:00:00Z",
    timezone: venue.timezone, status: "published", visibility: "public", activityKind: "regular", trainer: null,
    trainingDescription: null, organizer: { id: null, displayName: "Анна", publicContact: "" },
    applicationDeadlineAt: "2026-11-07T16:00:00Z", capacity: 8, externalReservedCount: 0, confirmedCount: 3,
    availablePlaces: 5, formatKey: "doubles",
    levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: ["3.0", "3.5"] },
    settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "Разделяем корт" },
    ...overrides,
  };
}

function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

let mediaMatches = false;
function stubWindow(desktop: boolean) {
  mediaMatches = desktop;
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    matchMedia: (query: string) => ({
      get matches() { return query === DESKTOP_MAP_INSPECTOR_MQ ? mediaMatches : false; },
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    getComputedStyle: () => ({ visibility: "visible" }),
  }));
  vi.stubGlobal("document", { activeElement: null, body: { style: { overflow: "auto" } }, querySelector: () => null, querySelectorAll: () => [] });
}

beforeEach(() => {
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  stubWindow(true);
});
afterEach(() => { hooks.cleanups.forEach(fn => fn?.()); vi.unstubAllGlobals(); });

it("renders compact desktop composition without GameHero classes or fabricated extras", () => {
  const game = fixture();
  const when = discoveryGameWhen(game);
  hooks.cursor = 0;
  const tree = DesktopInspectorGame({ game, onVenueClick: () => {} });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('data-view="game"');
  expect(html).toContain("gb-desktop-inspector-game");
  expect(html).toContain("gb-desktop-inspector-game__title");
  expect(html).toContain(game.title);
  expect(html).toContain(when.day);
  expect(html).toContain(when.time);
  expect(html).toContain("Анна");
  expect(html).toContain(capacityStatusLabel(game));
  expect(html).toContain("Разделяем корт");
  expect(html).toContain("3.0, 3.5");
  expect(html).toContain("Обычная игра");
  expect(html).toContain("ФОК");
  expect(html).toContain("Адрес 1");
  expect(html).not.toContain("gb-game-hero");
  expect(html).not.toContain("4.8");
  expect(html).not.toContain("участник");
  expect(html).not.toContain("Популярная");
  expect(html).not.toContain("Тренер · самостоятельно указано");
  expect(html).not.toContain("Условия аренды площадки уточняйте у организатора.");
  expect(elements(tree).some(node => node.type === VenueGameActions)).toBe(true);
  expect(elements(tree).some(node => node.type === GameHero)).toBe(false);
  expect(elements(tree).some(node => node.type === GameTerms)).toBe(false);
});

it("shows real trainer disclosure and rent note only for trainer_led with trainer", () => {
  const trainerGame = fixture({
    activityKind: "trainer_led",
    trainer: { profileId: "t", displayName: "Ирина Т.", declarationSource: "self_declared" },
    settlement: { mode: "external", purpose: "trainer_fee", priceMinor: null, currency: null, terms: "Оплата на месте", priceStatus: "by_agreement" },
  });
  hooks.cursor = 0;
  const trainerHtml = renderToStaticMarkup(DesktopInspectorGame({ game: trainerGame }));
  expect(trainerHtml).toContain("Ирина Т.");
  expect(trainerHtml).toContain("Тренер · самостоятельно указано");
  expect(trainerHtml).toContain("Анна");
  expect(trainerHtml).toContain("Оплата тренеру по договорённости · Оплата на месте");
  expect(trainerHtml).toContain("Условия аренды площадки уточняйте у организатора.");

  const regularHtml = renderToStaticMarkup(DesktopInspectorGame({ game: fixture() }));
  expect(regularHtml).not.toContain("Тренер · самостоятельно указано");
  expect(regularHtml).not.toContain("Условия аренды площадки уточняйте у организатора.");
  expect(regularHtml).toContain("Анна");
  expect(regularHtml).toContain("Разделяем корт");
});

it("expands a real long description via Подробнее without inventing copy", () => {
  const description = "A".repeat(200);
  const game = fixture({ activityKind: "trainer_led", trainingDescription: description, trainer: { profileId: "t", displayName: "Тренер", declarationSource: "self_declared" } });
  hooks.cursor = 0;
  let tree = DesktopInspectorGame({ game });
  let html = renderToStaticMarkup(tree);
  expect(html).toContain("Подробнее");
  expect(html).toContain("С тренером");
  expect(html).not.toContain(description);
  const more = elements(tree).find(node => node.type === "button" && renderToStaticMarkup(node).includes("Подробнее"));
  expect(more).toBeDefined();
  (more!.props.onClick as () => void)();
  hooks.cursor = 0;
  tree = DesktopInspectorGame({ game });
  html = renderToStaticMarkup(tree);
  expect(html).toContain(description);
  expect(html).toContain("Свернуть");
});

it("VenueSheet uses DesktopInspectorGame on desktop and keeps GameHero on mobile", () => {
  const games = [fixture()];
  const props = {
    venue, games, gamesReady: true, now: Date.parse("2026-11-01T12:00:00Z"),
    embedded: true, active: true, onCollapse: () => {}, onDeselect: () => {},
  };
  const click = (tree: ReactNode, text: string) => {
    const button = elements(tree).find(node => node.type === "button" && renderToStaticMarkup(node).includes(text));
    if (!button) throw new Error(`Missing ${text}`);
    (button.props.onClick as () => void)();
  };

  stubWindow(true);
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  VenueSheet(props);
  hooks.effects.splice(0).forEach(effect => effect());
  hooks.cursor = 0;
  let tree = VenueSheet(props);
  click(tree, "Показать игры");
  hooks.cursor = 0;
  tree = VenueSheet(props);
  click(tree, "Demo Beginner Mix");
  hooks.cursor = 0;
  tree = VenueSheet(props);
  expect(elements(tree).some(node => node.type === DesktopInspectorGame)).toBe(true);
  expect(elements(tree).some(node => node.type === GameHero)).toBe(false);

  stubWindow(false);
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  VenueSheet(props);
  hooks.effects.splice(0).forEach(effect => effect());
  hooks.cursor = 0;
  tree = VenueSheet(props);
  click(tree, "Показать игры");
  hooks.cursor = 0;
  tree = VenueSheet(props);
  click(tree, "Demo Beginner Mix");
  hooks.cursor = 0;
  tree = VenueSheet(props);
  expect(elements(tree).some(node => node.type === GameHero)).toBe(true);
  expect(elements(tree).some(node => node.type === GameTerms)).toBe(true);
  expect(elements(tree).some(node => node.type === DesktopInspectorGame)).toBe(false);
});

it("scopes compact desktop game styles without narrowing global GameHero", () => {
  const css = readFileSync(new URL("../src/styles/venue-popup.css", import.meta.url), "utf8");
  expect(css).toContain(".gb-desktop-inspector-game__title");
  expect(css).toContain("font-size:24px");
  expect(css).toContain("top:20px; right:20px; bottom:20px");
  expect(css).toContain("padding:0 24px 24px");
  expect(css).toContain(".gb-desktop-map-inspector .gb-venue-popup-content:has(.gb-desktop-inspector-game)");
  expect(css).not.toMatch(/\.gb-game-hero__image[^{]*\{[^}]*max-height:\s*530px/);
});
