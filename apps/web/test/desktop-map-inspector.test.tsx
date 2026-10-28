import { Children, isValidElement, type ReactNode } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useId: () => "venue-title",
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
}));

import { DesktopMapInspector, DESKTOP_MAP_INSPECTOR_MQ, useDesktopMapInspector } from "../src/components/consumer/games/DesktopMapInspector";
import { VenuePopup } from "../src/components/consumer/games/VenuePopup";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { CloseButton } from "../src/components/consumer/CloseButton";

const venue: VenueSummary = { id: "a", cityId: "city", name: "ФОК", address: "Адрес", timezone: "Europe/Moscow" };
function fixture(id: string): Game {
  return { id, version: 1, title: `Игра ${id}`, venue, startsAt: "2026-11-07T16:00:00Z", endsAt: "2026-11-07T18:00:00Z", timezone: venue.timezone,
    status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
    organizer: { id: null, displayName: "Анна", publicContact: "" }, applicationDeadlineAt: "2026-11-07T16:00:00Z",
    capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles",
    levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: ["3.0"] },
    settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
}

function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

let mediaMatches = false;
const mediaListeners = new Set<() => void>();
function stubWindow(desktop: boolean) {
  mediaMatches = desktop;
  mediaListeners.clear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    matchMedia: (query: string) => ({
      // Getter so change listeners observe later mediaMatches updates.
      get matches() { return query === DESKTOP_MAP_INSPECTOR_MQ ? mediaMatches : false; },
      media: query,
      addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
    }),
    getComputedStyle: () => ({ visibility: "visible" }),
  }));
  vi.stubGlobal("document", { activeElement: null, body: { style: { overflow: "auto" } }, querySelector: () => null, querySelectorAll: () => [] });
}

beforeEach(() => {
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  stubWindow(false);
});
afterEach(() => { hooks.cleanups.forEach(fn => fn?.()); vi.unstubAllGlobals(); });

it("exposes the Owner desktop breakpoint constant", () => {
  expect(DESKTOP_MAP_INSPECTOR_MQ).toBe("(min-width: 1024px)");
});

it("DesktopMapInspector stays inert when closed and dismisses via dim", () => {
  expect(DesktopMapInspector({ open: false, onDismiss: () => {}, children: <p>x</p> })).toBeNull();
  const dismiss = vi.fn();
  const tree = DesktopMapInspector({ open: true, label: "Панель", onDismiss: dismiss, children: <p>content</p> });
  const html = renderToStaticMarkup(tree!);
  expect(html).toContain('data-desktop-inspector="true"');
  expect(html).toContain("content");
  expect(html).toContain('aria-modal="false"');
  const dim = elements(tree).find(node => node.props.className === "gb-desktop-map-inspector-dim");
  expect(dim).toBeDefined();
  (dim!.props.onClick as () => void)();
  expect(dismiss).toHaveBeenCalledOnce();
});

it("VenuePopup uses the desktop rail without compact handle when the breakpoint matches", () => {
  stubWindow(true);
  const change = vi.fn();
  const deselect = vi.fn();
  hooks.cursor = 0;
  VenuePopup({
    expanded: false, onExpandedChange: change, onDeselect: deselect,
    preview: <div>compact</div>,
    children: <div className="gb-venue-sheet" data-view="info">sheet</div>,
  });
  hooks.effects.splice(0).forEach(effect => effect());
  hooks.cursor = 0;
  const desktopTree = VenuePopup({
    expanded: false, onExpandedChange: change, onDeselect: deselect,
    preview: <div>compact</div>,
    children: <div className="gb-venue-sheet" data-view="info">sheet</div>,
  });
  const html = renderToStaticMarkup(desktopTree);
  expect(html).toContain("gb-desktop-map-inspector");
  expect(html).toContain("gb-venue-popup--desktop");
  expect(html).toContain("sheet");
  expect(html).not.toContain("<div>compact</div>");
  expect(html).toContain('aria-modal="false"');
  // One nonmodal inspector on the aside — inner popup must not fake a second dialog.
  expect(html.match(/role="dialog"/g)?.length ?? 0).toBe(1);
  const handle = elements(desktopTree).find(node => node.props.className === "gb-venue-handle");
  expect(handle?.props.tabIndex).toBe(-1);
  expect(elements(desktopTree).some(node => node.props.className === "gb-venue-sheet-backdrop")).toBe(false);
});

it("empty verified schedule shows honest empty copy without invented amenities or ratings", () => {
  stubWindow(true);
  hooks.cursor = 0;
  VenueSheet({
    venue, games: [], gamesReady: true, now: 0, embedded: true, active: true,
    onCollapse: () => {}, onDeselect: () => {},
  });
  hooks.effects.splice(0).forEach(effect => effect());
  hooks.cursor = 0;
  const tree = VenueSheet({
    venue, games: [], gamesReady: true, now: 0, embedded: true, active: true,
    onCollapse: () => {}, onDeselect: () => {},
  });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("На этой площадке пока нет игр");
  expect(html).toContain("Ближайшие игры");
  expect(html).toContain("Создать игру на этой площадке");
  expect(html).toContain("gb-venue-sheet-empty");
  expect(html).not.toContain("4.8");
  expect(html).not.toContain("отзывов");
  expect(html).not.toContain("Популярная площадка");
  expect(html).not.toContain("кортов");
  expect(html).not.toContain("Парковка");
});

it("loading schedule never claims the venue has no games", () => {
  const tree = VenueSheet({
    venue, games: [], gamesReady: false, now: 0, embedded: true, active: true,
    onCollapse: () => {}, onDeselect: () => {},
  });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("Расписание временно недоступно");
  expect(html).not.toContain("На этой площадке пока нет игр");
  expect(html).not.toContain("Создать игру на этой площадке");
});

it("desktop Close deselects while mobile Close still collapses", () => {
  const collapse = vi.fn();
  const deselect = vi.fn();
  stubWindow(false);
  hooks.cursor = 0;
  let tree = VenueSheet({ venue, games: [fixture("g")], gamesReady: true, now: Date.parse("2026-11-01T12:00:00Z"), embedded: true, active: true, onCollapse: collapse, onDeselect: deselect });
  hooks.effects.splice(0).forEach(effect => effect());
  const mobileClose = elements(tree).find(node => node.type === CloseButton);
  expect(mobileClose?.props.onClick).toBe(collapse);

  stubWindow(true);
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
  tree = VenueSheet({ venue, games: [fixture("g")], gamesReady: true, now: Date.parse("2026-11-01T12:00:00Z"), embedded: true, active: true, onCollapse: collapse, onDeselect: deselect });
  hooks.effects.splice(0).forEach(effect => effect());
  hooks.cursor = 0;
  tree = VenueSheet({ venue, games: [fixture("g")], gamesReady: true, now: Date.parse("2026-11-01T12:00:00Z"), embedded: true, active: true, onCollapse: collapse, onDeselect: deselect });
  const desktopClose = elements(tree).find(node => node.type === CloseButton);
  expect(desktopClose?.props.onClick).toBe(deselect);
});

it("useDesktopMapInspector follows matchMedia changes", () => {
  stubWindow(false);
  hooks.cursor = 0;
  let value = false;
  function Probe() {
    value = useDesktopMapInspector();
    return null;
  }
  Probe();
  hooks.effects.splice(0).forEach(effect => effect());
  expect(value).toBe(false);
  mediaMatches = true;
  mediaListeners.forEach(fn => fn());
  hooks.cursor = 0;
  Probe();
  expect(value).toBe(true);
});

it("retains the same content child across desktop breakpoint changes", () => {
  const change = vi.fn();
  const deselect = vi.fn();
  const child = <div className="gb-venue-sheet" data-view="create" data-draft="kept">draft</div>;
  stubWindow(false);
  hooks.cursor = 0;
  VenuePopup({
    expanded: true, onExpandedChange: change, onDeselect: deselect,
    preview: <div>preview</div>, children: child,
  });
  hooks.effects.splice(0).forEach(effect => effect());
  hooks.cursor = 0;
  const mobile = VenuePopup({
    expanded: true, onExpandedChange: change, onDeselect: deselect,
    preview: <div>preview</div>, children: child,
  });
  const mobileContent = elements(mobile).find(node => node.props.className === "gb-venue-popup-content");
  expect(mobileContent?.props.children).toBe(child);

  mediaMatches = true;
  mediaListeners.forEach(fn => fn());
  hooks.cursor = 0;
  const desktop = VenuePopup({
    expanded: true, onExpandedChange: change, onDeselect: deselect,
    preview: <div>preview</div>, children: child,
  });
  const desktopContent = elements(desktop).find(node => node.props.className === "gb-venue-popup-content");
  expect(desktopContent?.props.children).toBe(child);
  expect(renderToStaticMarkup(desktop)).toContain('data-desktop-inspector="true"');
  expect(renderToStaticMarkup(desktop)).toContain('data-draft="kept"');
});
