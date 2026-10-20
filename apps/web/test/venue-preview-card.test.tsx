import { Children, isValidElement } from "react";
import type * as React from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";
import { nearestGameLabel } from "../src/lib/venue-popup";
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

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
const venue: VenueSummary = { id: "a", name: "Зал А", address: "Улица 1", cityId: "city", timezone: "Europe/Moscow" };
function game(startsAt: string, endsAt: string): Game {
  return { id: startsAt, version: 1, title: "Игра", venue, startsAt, endsAt, timezone: venue.timezone,
    status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
    organizer: { id: null, displayName: "Организатор", publicContact: "" }, applicationDeadlineAt: startsAt,
    capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles",
    levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: [] },
    settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
}
it("renders the real cover and region with named keyboard buttons; opens once", () => {
  const onOpen = vi.fn();
  const tree = VenuePreviewCard({ venue, games: [], gamesReady: true, now: 0, onOpen });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain('role="region" aria-label="Выбранная площадка"');
  expect(html.match(/<button /g)).toHaveLength(2);
  expect(html).toContain('aria-label="Открыть площадку Зал А"');
  expect(html).toContain("Улица 1"); expect(html).toContain('data-cover="default"');
  function activate(node: ReactNode): void {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
    if (node.type === "button") node.props.onClick?.();
    Children.forEach(node.props.children, activate);
  }
  activate(tree); expect(onOpen).toHaveBeenCalledTimes(2);
  const uploadedUrl = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
  expect(renderToStaticMarkup(<VenuePreviewCard venue={{ ...venue, cover: { uploadedUrl } }} games={[]} gamesReady now={0} onOpen={onOpen} />)).toContain('data-cover="uploaded"');
});
it("distinguishes unavailable from checked empty and never shows stale time", () => {
  const games = [game("2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z")];
  const html = renderToStaticMarkup(<VenuePreviewCard venue={venue} games={games} gamesReady={false} now={0} onOpen={vi.fn()} />);
  expect(html).toContain("Расписание временно недоступно"); expect(html).not.toContain("13:00"); expect(html).not.toContain("Пока нет игр");
  expect(nearestGameLabel([], venue.timezone, 0)).toBe("Пока нет игр");
});
it("uses the earliest game without mutating input and formats local calendar dates", () => {
  const early = game("2026-11-04T10:00:00Z", "2026-11-04T11:30:00Z");
  const late = game("2026-11-05T10:00:00Z", "2026-11-05T11:00:00Z");
  const games = Object.freeze([late, early]);
  expect(nearestGameLabel(games, venue.timezone, Date.parse("2026-11-04T00:00:00Z"))).toBe("13:00 – 14:30 · Сегодня");
  expect(nearestGameLabel(games, venue.timezone, Date.parse("2026-11-03T00:00:00Z"))).toBe("13:00 – 14:30 · Завтра");
  expect(nearestGameLabel(games, venue.timezone, Date.parse("2026-11-01T00:00:00Z"))).toBe("13:00 – 14:30 · 4 нояб.");
  expect(games).toEqual([late, early]);
  expect(nearestGameLabel([early], venue.timezone, Date.parse("2026-11-03T22:00:00Z"))).toContain("Сегодня");
});
it.each([
  ["2026-03-29T00:30:00Z", "2026-03-29T22:00:00Z", "2026-03-29T23:00:00Z", "00:00 – 01:00 · Завтра"],
  ["2026-10-24T22:30:00Z", "2026-10-25T23:00:00Z", "2026-10-26T00:00:00Z", "00:00 – 01:00 · Завтра"],
])("handles DST calendar tomorrow at %s", (now, start, end, label) => {
  expect(nearestGameLabel([game(start, end)], "Europe/Berlin", Date.parse(now))).toBe(label);
});

it.each([[1, "1 игра"], [2, "2 игры"], [5, "5 игр"]] as const)("counts %s games", (count, label) => {
  const games = Array.from({ length: count }, () => game("2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z"));
  const html = renderToStaticMarkup(<VenuePreviewCard venue={venue} games={games} gamesReady now={0} onOpen={() => {}} />);
  expect(html).toContain(`На этой площадке ${label}`); expect(html).toContain("↑"); expect(html).toContain("gb-venue-handle");
});


import { VenueSheet } from "../src/components/consumer/games/VenueSheet";

// The popup, preview and sheet get independent hook storage, as separate React fibers do.
import { VenuePopup } from "../src/components/consumer/games/VenuePopup";
function popupHarness(initial: boolean, reduced = false) {
  const state = { slots: [] as unknown[], cleanups: [] as (() => void)[] };
  let expanded = initial;
  const capture = new Set<number>();
  const target = { setPointerCapture: vi.fn((id: number) => capture.add(id)), hasPointerCapture: (id: number) => capture.has(id), releasePointerCapture: vi.fn((id: number) => capture.delete(id)) };
  const change = vi.fn((value: boolean) => { expanded = value; });
  const deselectPopup = vi.fn();
  const run = <T,>(fn: () => T): T => {
    const saved = { slots: hooks.slots, cursor: hooks.cursor, cleanups: hooks.cleanups, effects: hooks.effects };
    hooks.slots = state.slots; hooks.cursor = 0; hooks.cleanups = state.cleanups; hooks.effects = [];
    const result = fn(); hooks.effects.splice(0).forEach(effect => effect());
    state.slots = hooks.slots; state.cleanups = hooks.cleanups;
    Object.assign(hooks, saved); return result;
  };
  const contentProps = { venue, games: [], gamesReady: true, now: 0, onCollapse: () => change(false), onDeselect: deselectPopup };
  const renderPopup = () => run(() => {
    const tree = VenuePopup({ expanded, onExpandedChange: change, onDeselect: deselectPopup,
      preview: <VenuePreviewCard {...contentProps} embedded onOpen={() => change(true)} />,
      children: <VenueSheet {...contentProps} embedded active={expanded} /> });
    for (const node of popupElements(tree)) {
      const ref = node.props.ref as { current: unknown } | undefined;
      if (ref) ref.current = { getBoundingClientRect: () => ({ height: node.props.className === "gb-venue-popup-full-measure" ? 772 : 172 }) };
    }
    return tree;
  });
  const find = (name: string) => {
    const node = popupElements(renderPopup()).find(item => item.props.className === name);
    if (!node) throw new Error(`Missing ${name}`); return node;
  };
  // Populate measurement refs before the initial pointerdown.
  renderPopup();
  const pointer = (handler: string, y: number, time: number, extra: Record<string, unknown> = {}) => {
    const event = { clientX: 0, clientY: y, timeStamp: time, pointerId: 1, isPrimary: true, button: 0, pointerType: "touch", currentTarget: target, preventDefault: vi.fn(), ...extra };
    (find("gb-venue-handle").props[handler] as (event: unknown) => void)(event); return event;
  };
  Object.assign(window, { matchMedia: () => ({ matches: reduced }) });
  return { render: renderPopup, find, pointer, change, capture, target,
    click(detail: number) { const event = { detail, preventDefault: vi.fn(), stopPropagation: vi.fn() }; (find("gb-venue-popup").props.onClickCapture as (event: unknown) => void)(event); return event; },
    dispose() { state.cleanups.forEach(fn => fn?.()); },
    height() { return (find("gb-venue-popup").props.style as { height: string }).height; },
  };
}
function popupElements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(popupElements)];
}
beforeEach(() => {
  // Preview tests also use the component hook harness; no browser renderer is needed.
  if (typeof window === "undefined") vi.stubGlobal("window", new EventTarget());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(["mouse", "touch", "pen"])("moves the real surface continuously before release for %s", pointerType => {
  vi.useFakeTimers(); const h = popupHarness(false);
  h.pointer("onPointerDown", 700, 0, { pointerType });
  h.pointer("onPointerMove", 600, 1000, { pointerType }); const firstHeight = h.height();
  h.pointer("onPointerMove", 400, 2000, { pointerType });
  expect(firstHeight).toBe("calc(172px + 100px)"); expect(h.height()).toBe("calc(172px + 300px)");
  expect(h.find("gb-venue-popup").props.style).toMatchObject({ transition: "none" });
  expect(popupElements(h.render()).some(node => node.type === VenueSheet)).toBe(true);
  // Render actual expanded info using a separate hook scope before release.
  const saved = { slots: hooks.slots, cursor: hooks.cursor, effects: hooks.effects };
  hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
  const info = VenueSheet({ venue, games: [], gamesReady: true, now: 0, embedded: true, active: false, onCollapse() {}, onDeselect() {} });
  expect(renderToStaticMarkup(info)).toContain("Создать игру на этой площадке");
  Object.assign(hooks, saved);
  expect(h.change).not.toHaveBeenCalled();
  h.pointer("onPointerUp", 400, 2200); expect(h.change).toHaveBeenLastCalledWith(true);
  vi.advanceTimersByTime(220); expect(h.height()).toBe("88dvh");
  h.pointer("onPointerDown", 100, 3000); h.pointer("onPointerMove", 350, 4000); const down = h.height();
  h.pointer("onPointerMove", 600, 5000); expect(h.height()).not.toBe(down);
  h.pointer("onPointerUp", 600, 5200); expect(h.change).toHaveBeenLastCalledWith(false);
  vi.advanceTimersByTime(220); expect(h.height()).toBe("172px"); h.dispose();
});
it.each([false, true])("clamps geometry and snaps with velocity, reduced motion=%s", reduced => {
  vi.useFakeTimers(); const h = popupHarness(false, reduced);
  h.pointer("onPointerDown", 700, 0); h.pointer("onPointerMove", 650, 20);
  h.pointer("onPointerUp", 650, 21); expect(h.change).toHaveBeenLastCalledWith(true);
  if (reduced) expect(h.height()).toBe("88dvh");
  else { expect(h.find("gb-venue-popup").props.style).toMatchObject({ transition: "height 220ms cubic-bezier(.2,.8,.2,1)" }); vi.advanceTimersByTime(220); }
  h.pointer("onPointerDown", 100, 1000); h.pointer("onPointerMove", 3000, 2000); expect(h.height()).toBe("calc(172px + 0px)");
  h.pointer("onPointerMove", -3000, 3000); expect(h.height()).toBe("calc(172px + 600px)");
  h.pointer("onPointerCancel", -3000, 3001); expect(h.change).toHaveBeenLastCalledWith(true); h.dispose();
});
it.each(["onPointerCancel", "onLostPointerCapture"])("%s restores origin and allows another drag", handler => {
  const h = popupHarness(false, true);
  h.pointer("onPointerDown", 700, 0); h.pointer("onPointerMove", 200, 1000);
  h.pointer(handler, 200, 1001); expect(h.change).toHaveBeenLastCalledWith(false); expect(h.capture.size).toBe(0);
  h.pointer("onPointerDown", 700, 2000); h.pointer("onPointerMove", 200, 3000); h.pointer("onPointerUp", 200, 3200);
  expect(h.change).toHaveBeenLastCalledWith(true); h.dispose();
});
it("rejects horizontal/nonprimary/nonleft/wrong-id and ignores a second pointer", () => {
  const h = popupHarness(false, true);
  h.pointer("onPointerDown", 700, 0, { isPrimary: false }); h.pointer("onPointerDown", 700, 0, { button: 2 }); expect(h.capture.size).toBe(0);
  h.pointer("onPointerDown", 700, 0); h.pointer("onPointerDown", 100, 1, { pointerId: 2 });
  h.pointer("onPointerMove", 100, 10, { pointerId: 2 }); expect(h.height()).toBe("172px");
  h.pointer("onPointerMove", 690, 20, { clientX: 100 }); expect(h.capture.size).toBe(0); expect(h.change).not.toHaveBeenCalled(); h.dispose();
});
it("keeps scroll/controls separate, consumes one synthesized click across collapse, and permits keyboard/tap", () => {
  const h = popupHarness(true, true);
  const content = h.find("gb-venue-popup-content");
  expect(content.props.onPointerDown).toBeUndefined(); expect(content.props.onPointerMove).toBeUndefined(); expect(content.props.onScroll).toBeUndefined();
  expect(h.find("gb-venue-popup").props.onPointerDown).toBeUndefined();
  const scroll = { target: { scrollTop: 500 }, clientY: 600, pointerId: 1, preventDefault: vi.fn() };
  // Dispatch along the content → shell path: neither scrolling nor controls may capture a gesture.
  for (const node of [content, h.find("gb-venue-popup")]) {
    for (const name of ["onScroll", "onPointerDown", "onPointerMove", "onPointerUp"]) {
      const handler = node.props[name] as ((event: unknown) => void) | undefined; handler?.(scroll);
    }
  }
  expect(scroll.preventDefault).not.toHaveBeenCalled(); expect(h.height()).toBe("88dvh"); expect(h.capture.size).toBe(0);
  h.pointer("onPointerDown", 100, 0); h.pointer("onPointerMove", 650, 1000); h.pointer("onPointerUp", 650, 1200);
  expect(h.click(0).preventDefault).not.toHaveBeenCalled(); expect(h.click(1).preventDefault).toHaveBeenCalledOnce(); expect(h.click(1).preventDefault).not.toHaveBeenCalled();
  (h.find("gb-venue-handle").props.onClick as () => void)(); expect(h.change).toHaveBeenLastCalledWith(true);
  h.pointer("onPointerDown", 100, 2000); h.pointer("onPointerMove", 500, 3000);
  window.dispatchEvent(new Event("resize")); expect(h.capture.size).toBe(0); expect(h.height()).toBe("88dvh");
  h.dispose(); expect(h.capture.size).toBe(0);
});

it.each([
  [false, 200, false], [false, 400, true], [true, 200, true], [true, 400, false],
] as const)("slow release uses geometric midpoint from expanded=%s distance=%s", (initial, distance, expected) => {
  const h = popupHarness(initial, true);
  const start = initial ? 100 : 700; const end = initial ? start + distance : start - distance;
  h.pointer("onPointerDown", start, 0); h.pointer("onPointerMove", end, 2000); h.pointer("onPointerUp", end, 2200);
  expect(h.change).toHaveBeenLastCalledWith(expected); h.dispose();
});
it("does not lock the body or mount expanded controls in settled compact mode", () => {
  const h = popupHarness(false); const tree = h.render();
  expect(popupElements(tree).some(node => node.type === VenueSheet)).toBe(false);
  expect(popupElements(tree).some(node => node.props.role === "dialog")).toBe(false);
  expect(h.find("gb-venue-popup").props.onPointerMove).toBeUndefined();
  const arrowKey = { key: "ArrowUp", preventDefault: vi.fn() };
  (h.find("gb-venue-handle").props.onKeyDown as (event: unknown) => void)(arrowKey);
  expect(arrowKey.preventDefault).toHaveBeenCalledOnce(); expect(h.change).toHaveBeenLastCalledWith(true); h.dispose();
});
