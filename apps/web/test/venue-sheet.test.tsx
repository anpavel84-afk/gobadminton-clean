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

import { CreateGamePage } from "../src/components/consumer/pages/CreateGamePage";
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { CloseButton } from "../src/components/consumer/CloseButton";
import { GameTerms } from "../src/components/consumer/games/GameDetailComposition";
import { formatSeats } from "../src/lib/game-presentation";
import { venueDays, venueDayLabel } from "../src/lib/venue-popup";
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
const venue: VenueSummary = { id: "a", cityId: "city", name: "Зал", address: "Адрес", timezone: "Europe/Berlin" };
function fixture(id: string, startsAt = "2026-10-25T00:30:00Z"): Game {
  return { id, version: 1, title: `Игра ${id}`, venue, startsAt, endsAt: "2026-10-25T02:30:00Z", timezone: venue.timezone,
    status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
    organizer: { id: null, displayName: "Анна", publicContact: "" }, applicationDeadlineAt: startsAt,
    capacity: 4, externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles",
    levelRule: { scaleId: "test", scaleVersion: 1, allowedLevelIds: ["B"] },
    settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
class FocusTarget {
  isConnected = true;
  tabIndex = 0;
  disabled = false;
  hidden = false;
  inert = false;
  inputHidden = false;
  visibility = "visible";
  rendered = true;
  matches = () => this.disabled || this.inputHidden;
  closest = () => this.hidden || this.inert ? this : null;
  getClientRects = () => this.rendered ? [{}] : [];
  focus = vi.fn(() => { Object.assign(document, { activeElement: this }); });
}
const first = new FocusTarget(); const last = new FocusTarget(); const initiator = new FocusTarget();
const collapse = vi.fn(); const deselect = vi.fn(); const focus = first.focus;
let props: React.ComponentProps<typeof VenueSheet>;
function render() {
  hooks.cursor = 0; const tree = VenueSheet(props);
  for (const node of elements(tree)) {
    const ref = node.props.ref as { current: unknown } | undefined;
    if (ref) ref.current = node.props.className === "gb-venue-sheet" ? panel : first;
  }
  hooks.effects.splice(0).forEach(effect => effect()); return tree;
}
const handle = new FocusTarget();
let excludedTargets: FocusTarget[] = [];
let nestedDialog: string | null = null;
const popupBoundary = { contains: (target: unknown) => target === handle || target === first || target === last, querySelectorAll: () => [...excludedTargets, handle, first, last, ...excludedTargets] };
const panel = { closest: () => popupBoundary, scrollTop: 0, contains: (target: unknown) => target === first || target === last, querySelectorAll: () => [...excludedTargets, first, last, ...excludedTargets] };
function click(tree: React.ReactNode, text: string) {
  const button = elements(tree).find(node => (node.type === "button" || node.type === CloseButton) && (node.props["aria-label"] === text || renderToStaticMarkup(node).includes(text)));
  if (!button) throw new Error(`Missing ${text}`);
  (button.props.onClick as () => void)();
}
beforeEach(() => {
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0; collapse.mockClear(); deselect.mockClear(); focus.mockClear(); panel.scrollTop = 0; last.focus.mockClear(); initiator.focus.mockClear();
  excludedTargets = []; nestedDialog = null;
  props = { venue, games: [fixture("b"), fixture("a"), fixture("c", "2026-10-26T12:00:00Z")], gamesReady: true, now: Date.parse("2026-10-24T22:30:00Z"), onCollapse: collapse, onDeselect: deselect };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { getComputedStyle: (target: FocusTarget) => ({ visibility: target.visibility }) }));
  vi.stubGlobal("document", { activeElement: initiator, body: { style: { overflow: "auto" } }, querySelector: (selector: string) => selector === ".gb-venue-picker, dialog[open]" ? nestedDialog ? { className: nestedDialog } : null : ({ focus }) });
  vi.stubGlobal("HTMLElement", FocusTarget);
});
afterEach(() => { hooks.cleanups.forEach(fn => fn?.()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("renders cover, single modal, focuses close and restores overflow on cleanup", () => {
  const html = renderToStaticMarkup(render());
  expect(html.match(/role="dialog"/g)).toHaveLength(1); expect(html).toContain('aria-modal="true"'); expect(html).toContain('aria-labelledby="venue-title"');
  expect(html).toContain('data-cover="default"'); expect(focus).toHaveBeenCalled(); expect(document.body.style.overflow).toBe("hidden");
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }); window.dispatchEvent(event);
  expect(collapse).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(true);
  hooks.cleanups.forEach(fn => fn?.()); expect(document.body.style.overflow).toBe("auto");
});
it("goes info → schedule → detail → same date and back to info without links", () => {
  click(render(), "Показать игры"); let tree = render();
  expect(renderToStaticMarkup(tree)).toContain("Сегодня"); expect(renderToStaticMarkup(tree)).toContain("Организатор"); expect(renderToStaticMarkup(tree)).toContain("Анна");
  click(tree, "Игра a"); tree = render(); expect(elements(tree).some(node => node.type === GameTerms)).toBe(true);
  const terms = elements(tree).find(node => node.type === GameTerms);
  if (!terms) throw new Error("No terms");
  (terms.props.onVenueClick as () => void)(); expect(renderToStaticMarkup(render())).toContain("Показать игры");
  click(render(), "Показать игры"); click(render(), "26 окт."); click(render(), "Игра c"); click(render(), "К расписанию");
  expect(renderToStaticMarkup(render())).toContain("Игра c"); expect(renderToStaticMarkup(render())).not.toContain("Игра a");
});
it("falls back when game/date disappear and clears stale detail immediately on failure", () => {
  click(render(), "Показать игры"); click(render(), "Игра a"); props = { ...props, games: [fixture("b")] };
  expect(renderToStaticMarkup(render())).toContain("Игры на этой площадке");
  props = { ...props, gamesReady: false }; const html = renderToStaticMarkup(render());
  expect(html).toContain("Расписание временно недоступно"); expect(html).not.toContain("Показать игры"); expect(html).not.toContain("Игра b");
  props = { ...props, gamesReady: true, games: [] }; expect(renderToStaticMarkup(render())).not.toContain("Игры на этой площадке");
});
it("uses venue calendar and startsAt/id ordering at DST and midnight", () => {
  const days = venueDays([fixture("b"), fixture("a"), fixture("c", "2026-10-26T00:00:00Z")], venue.timezone);
  expect(days[0]?.games.map(game => game.id)).toEqual(["a", "b"]);
  expect(venueDayLabel("2026-10-26", venue.timezone, props.now, "2026-10-26T00:00:00Z")).toBe("Завтра");
});
it("keeps old GameTerms Link unless callback is supplied", () => {
  const game = fixture("a");
  expect(renderToStaticMarkup(<GameTerms game={game} />)).toContain('href="/venues/a"');
  const html = renderToStaticMarkup(<GameTerms game={game} onVenueClick={() => {}} />);
  expect(html).not.toContain('href="/venues/a"'); expect(html).toContain("<button");
});
it.each([false, true])("traps actual Tab boundary with shift=%s and allows interior Tab", shiftKey => {
  render(); Object.assign(document, { activeElement: shiftKey ? first : last });
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(shiftKey ? last : first);
  const interior = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey });
  window.dispatchEvent(interior); expect(interior.defaultPrevented).toBe(false);
  hooks.cleanups.forEach(fn => fn?.()); expect(document.activeElement).toBe(initiator);
  const after = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey });
  window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
});
it("removes Escape and Tab listeners after cleanup and a fresh reopening", () => {
  const escape = () => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    window.dispatchEvent(event);
    return event;
  };
  for (let opening = 0; opening < 2; opening++) {
    // A remount has fresh hook slots but retains the same real window EventTarget.
    hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0;
    render();
    expect(document.body.style.overflow).toBe("hidden");
    expect(escape().defaultPrevented).toBe(true);
    expect(collapse).toHaveBeenCalledTimes(opening + 1);
    hooks.cleanups.splice(0).forEach(fn => fn?.());
    expect(document.activeElement).toBe(initiator);
    expect(document.body.style.overflow).toBe("auto");
    expect(escape().defaultPrevented).toBe(false);
    expect(collapse).toHaveBeenCalledTimes(opening + 1);
    const tab = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey: false });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(initiator);
  }
});
it("restores preview focus when the initiating element was removed", () => {
  render(); initiator.isConnected = false;
  hooks.cleanups.forEach(fn => fn?.()); expect(document.activeElement).toBe(first);
  initiator.isConnected = true;
});
it("background deselects, close collapses, inner clicks do neither", () => {
  const tree = render(); expect(collapse).not.toHaveBeenCalled(); expect(deselect).not.toHaveBeenCalled();
  const close = elements(tree).find(node => node.type === CloseButton);
  if (!isValidElement<React.ComponentProps<typeof CloseButton>>(close)) throw new Error("No production CloseButton");
  expect(close.props.onClick).toBe(collapse);
  expect(close.props.ref).toEqual({ current: first });
  const native = CloseButton(close.props);
  expect(native.type).toBe("button"); expect(native.props.ref).toBe(close.props.ref);
  click(tree, "Закрыть"); expect(collapse).toHaveBeenCalledOnce();
  const backdrop = elements(tree).find(node => node.props.className === "gb-venue-sheet-backdrop");
  if (!backdrop) throw new Error("No backdrop"); (backdrop.props.onClick as () => void)(); expect(deselect).toHaveBeenCalledOnce();
});
it("preserves the selected date through detail and chooses the first remaining date on removal", () => {
  click(render(), "Показать игры"); click(render(), "26 окт.");
  let tree = render(); expect(renderToStaticMarkup(tree)).toContain("Игра c");
  expect(renderToStaticMarkup(tree)).toContain(formatSeats(fixture("c")));
  expect(renderToStaticMarkup(tree)).toContain("B");
  expect(renderToStaticMarkup(tree)).not.toContain("Любой уровень");
  click(tree, "Игра c"); click(render(), "К расписанию");
  tree = render(); expect(renderToStaticMarkup(tree)).not.toContain("Игра a");
  props = { ...props, games: [fixture("a")] };
  tree = render(); expect(renderToStaticMarkup(tree)).toContain("Игра a");
  expect(renderToStaticMarkup(tree)).not.toContain("Игра c");
  props = { ...props, games: [] };
  expect(renderToStaticMarkup(render())).not.toContain("Игры на этой площадке");
});

import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";

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
  const pointerCard = (handler: string, y: number, time: number, extra: Record<string, unknown> = {}) => {
    const event = { clientX: 0, clientY: y, timeStamp: time, pointerId: 3, isPrimary: true,
      button: 0, pointerType: "touch", currentTarget: target,
      target: { closest: () => null }, preventDefault: vi.fn(), ...extra };
    const action = find("gb-venue-popup").props[handler] as ((event: unknown) => void) | undefined;
    if (!action) throw new Error("Missing compact-only handler: " + handler);
    action(event); return event;
  };
  Object.assign(window, { matchMedia: () => ({ matches: reduced }) });
  return { render: renderPopup, find, pointer, pointerCard, change, deselect: deselectPopup, capture, target,
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
it("opens by dragging any part of the compact card, while retaining an ordinary tap", () => {
  const h = popupHarness(false, true);
  // A touch on the preview title/photo/arrow bubbles to the compact popup shell.
  h.pointerCard("onPointerDown", 600, 0);
  h.pointerCard("onPointerMove", 597, 15);
  expect(h.height()).toBe("172px"); expect(h.capture.size).toBe(0);
  h.pointerCard("onPointerUp", 597, 18);
  expect(h.change).not.toHaveBeenCalled();
  expect(h.click(1).preventDefault).not.toHaveBeenCalled(); // normal button click survives
  const preview = popupElements(h.render()).find(node => node.type === VenuePreviewCard);
  if (!preview) throw new Error("No preview card");
  (preview.props.onOpen as () => void)();
  expect(h.change).toHaveBeenLastCalledWith(true);
  h.dispose();

  const swipe = popupHarness(false, true);
  swipe.pointerCard("onPointerDown", 600, 0);
  swipe.pointerCard("onPointerMove", 480, 1000);
  expect(swipe.height()).toBe("calc(172px + 120px)");
  expect(swipe.capture.has(3)).toBe(true);
  swipe.pointerCard("onPointerUp", 470, 1200);
  expect(swipe.change).toHaveBeenCalledOnce();
  expect(swipe.change).toHaveBeenLastCalledWith(true);
  expect(swipe.deselect).not.toHaveBeenCalled();
  expect(swipe.height()).toBe("88dvh");
  expect(swipe.capture.size).toBe(0);
  expect(swipe.click(1).preventDefault).toHaveBeenCalledOnce();
  swipe.dispose();
});

it("keeps the compact preview mounted and pointer-addressable during a real swipe", () => {
  // Regression for Owner iPhone UAT FAIL #179: the old hidden={moving} turned
  // the original touch target display:none on the first move. WebKit then
  // cancelled the pointer stream even though the root had pointer capture.
  const h = popupHarness(false, false);
  const before = h.find("gb-venue-popup-preview-surface");
  expect(before.props.hidden).toBeUndefined();
  expect(before.props.style).toMatchObject({ opacity: 1, pointerEvents: "auto" });
  h.pointerCard("onPointerDown", 600, 0);
  h.pointerCard("onPointerMove", 575, 20);
  const movingPreview = h.find("gb-venue-popup-preview-surface");
  expect(movingPreview.props.hidden).toBeUndefined();
  expect(movingPreview.props.style).toMatchObject({ opacity: 0, pointerEvents: "auto" });
  expect(h.find("gb-venue-popup").props["data-moving"]).toBe(true);
  expect(h.capture.has(3)).toBe(true);
  // Subsequent pointermove is still deliverable after preview transitions.
  h.pointerCard("onPointerMove", 505, 80);
  expect(h.height()).toBe("calc(172px + 95px)");
  h.pointerCard("onPointerUp", 505, 100);
  expect(h.change).toHaveBeenLastCalledWith(true);
  const openedPreview = h.find("gb-venue-popup-preview-surface");
  expect(openedPreview.props.hidden).toBeUndefined();
  expect(openedPreview.props.style).toMatchObject({ opacity: 0, pointerEvents: "none" });
  expect(h.capture.size).toBe(0);
  h.dispose();
});

it("dismisses the selected venue on a downward compact-card swipe, also from its handle", () => {
  const card = popupHarness(false, true);
  card.pointerCard("onPointerDown", 500, 0);
  card.pointerCard("onPointerMove", 590, 200);
  card.pointerCard("onPointerUp", 600, 320);
  expect(card.deselect).toHaveBeenCalledOnce();
  expect(card.change).not.toHaveBeenCalled();
  expect(card.capture.size).toBe(0);
  expect(card.click(1).preventDefault).toHaveBeenCalledOnce();
  card.dispose();

  const handle = popupHarness(false, true);
  handle.pointer("onPointerDown", 500, 0);
  handle.pointer("onPointerMove", 590, 200);
  handle.pointer("onPointerUp", 600, 320);
  expect(handle.deselect).toHaveBeenCalledOnce();
  expect(handle.change).not.toHaveBeenCalled();
  handle.dispose();
});

it("ignores compact horizontal/secondary/cancel gestures without changing expanded interactions", () => {
  const compact = popupHarness(false, true);
  compact.pointerCard("onPointerDown", 600, 0, { isPrimary: false });
  compact.pointerCard("onPointerDown", 600, 1, { button: 2 });
  expect(compact.capture.size).toBe(0);
  compact.pointerCard("onPointerDown", 600, 10);
  compact.pointerCard("onPointerMove", 590, 30, { clientX: 100 });
  compact.pointerCard("onPointerUp", 590, 35, { clientX: 100 });
  expect(compact.height()).toBe("172px");
  expect(compact.deselect).not.toHaveBeenCalled();
  expect(compact.change).not.toHaveBeenCalled();
  expect(compact.click(1).preventDefault).not.toHaveBeenCalled();
  compact.pointerCard("onPointerDown", 600, 50);
  compact.pointerCard("onPointerMove", 510, 100);
  compact.pointerCard("onPointerCancel", 510, 110);
  expect(compact.height()).toBe("172px");
  expect(compact.capture.size).toBe(0);
  expect(compact.change).not.toHaveBeenCalled();
  expect(compact.deselect).not.toHaveBeenCalled();
  compact.dispose();

  const expanded = popupHarness(true, true);
  const surface = expanded.find("gb-venue-popup");
  expect(surface.props.onPointerDown).toBeUndefined();
  expect(surface.props.onPointerMove).toBeUndefined();
  expect(surface.props.onPointerUp).toBeUndefined();
  // The original handle gesture in the expanded sheet is retained.
  expanded.pointer("onPointerDown", 100, 0);
  expanded.pointer("onPointerMove", 500, 1000);
  expanded.pointer("onPointerUp", 500, 1200);
  expect(expanded.change).toHaveBeenLastCalledWith(false);
  expect(expanded.deselect).not.toHaveBeenCalled();
  expanded.dispose();
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
  expect(typeof h.find("gb-venue-popup").props.onPointerMove).toBe("function");
  const arrowKey = { key: "ArrowUp", preventDefault: vi.fn() };
  (h.find("gb-venue-handle").props.onKeyDown as (event: unknown) => void)(arrowKey);
  expect(arrowKey.preventDefault).toHaveBeenCalledOnce(); expect(h.change).toHaveBeenLastCalledWith(true); h.dispose();
});

it("offers a local create button only for a verified empty schedule", () => {
  props = { ...props, venue: { ...venue, id: "зал /?&=+" }, games: [] };
  const html = renderToStaticMarkup(render());
  expect(html).toContain("Создать игру на этой площадке");
  const cta = elements(render()).find(node => node.type === "button" && renderToStaticMarkup(node).includes("Создать игру на этой площадке"));
  expect(cta).toBeDefined(); expect(cta?.props.href).toBeUndefined();
  expect(html).not.toContain("Показать игры на этой площадке");
  props = { ...props, gamesReady: false };
  const unavailable = renderToStaticMarkup(render());
  expect(unavailable).toContain("Расписание временно недоступно"); expect(unavailable).not.toContain("Создать игру на этой площадке");
});
it("active=false restores modal effects before the closing surface unmounts", () => {
  render(); props = { ...props, active: false }; render();
  expect(document.body.style.overflow).toBe("auto"); expect(document.activeElement).toBe(initiator);
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false); expect(collapse).not.toHaveBeenCalled();
});

// Exercise the complete release/click sequence, including interrupted settlement.
it.each([false, true])("horizontal release preserves settled state during settlement=%s", interrupted => {
  vi.useFakeTimers(); const h = popupHarness(false);
  if (interrupted) {
    h.pointer("onPointerDown", 700, 0); h.pointer("onPointerMove", 200, 1000);
    h.pointer("onPointerUp", 200, 1200);
  }
  const before = h.change.mock.calls.length;
  h.pointer("onPointerDown", 500, 1300);
  h.pointer("onPointerMove", 490, 1400, { clientX: 100 });
  h.pointer("onPointerUp", 490, 1500, { clientX: 100 });
  const click = h.click(1);
  if (!click.preventDefault.mock.calls.length) (h.find("gb-venue-handle").props.onClick as () => void)();
  expect(click.preventDefault).toHaveBeenCalledOnce();
  expect(h.change).toHaveBeenCalledTimes(before);
  vi.advanceTimersByTime(220);
  expect(h.height()).toBe(interrupted ? "88dvh" : "172px");
  expect(h.click(1).preventDefault).not.toHaveBeenCalled();
  (h.find("gb-venue-handle").props.onClick as () => void)();
  expect(h.change).toHaveBeenLastCalledWith(!interrupted); h.dispose();
});
it.each(["onPointerCancel", "onLostPointerCapture"])("%s does not swallow the next tap", handler => {
  const h = popupHarness(false, true);
  h.pointer("onPointerDown", 700, 0); h.pointer("onPointerMove", 400, 1000);
  h.pointer(handler, 400, 1100);
  expect(h.click(1).preventDefault).not.toHaveBeenCalled();
  h.pointer("onPointerDown", 700, 1200); h.pointer("onPointerUp", 700, 1300);
  expect(h.click(1).preventDefault).not.toHaveBeenCalled();
  (h.find("gb-venue-handle").props.onClick as () => void)();
  expect(h.change).toHaveBeenLastCalledWith(true); h.dispose();
});

it("embedded modal Tab includes the shared handle in both directions", () => {
  props = { ...props, embedded: true }; const sheet = render();
  expect(renderToStaticMarkup(sheet)).not.toContain('role="dialog"');
  const popup = popupHarness(true, true);
  expect(popup.find("gb-venue-popup").props).toMatchObject({ role: "dialog", "aria-modal": "true" });
  Object.assign(document, { activeElement: first });
  const backwards = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey: true });
  window.dispatchEvent(backwards);
  expect(backwards.defaultPrevented).toBe(false); // Native previous target is the handle.
  Object.assign(document, { activeElement: last });
  const forwards = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey: false });
  window.dispatchEvent(forwards); expect(forwards.defaultPrevented).toBe(true); expect(document.activeElement).toBe(handle);
  const wrap = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey: true });
  window.dispatchEvent(wrap); expect(wrap.defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
  expect(popup.click(0).preventDefault).not.toHaveBeenCalled();
  (popup.find("gb-venue-handle").props.onClick as () => void)();
  expect(popup.change).toHaveBeenLastCalledWith(false); popup.dispose();
});


it.each([".gb-venue-picker", "dialog[open]"])("yields Tab and Escape to an existing %s", selector => {
  render(); nestedDialog = selector; Object.assign(document, { activeElement: last });
  for (const key of ["Tab", "Escape"]) {
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key, shiftKey: false });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  }
  expect(collapse).not.toHaveBeenCalled(); expect(document.activeElement).toBe(last);
});
it("excludes hidden, inert, disabled, negative-tabindex and unrendered focus targets", () => {
  excludedTargets = [
    { hidden: true }, { inert: true }, { disabled: true }, { inputHidden: true },
    { tabIndex: -1 }, { visibility: "hidden" }, { visibility: "collapse" }, { rendered: false },
  ].map(properties => Object.assign(new FocusTarget(), properties));
  render();
  for (const shiftKey of [false, true]) {
    Object.assign(document, { activeElement: shiftKey ? first : last });
    const event = Object.assign(new Event("keydown", { cancelable: true }), { key: "Tab", shiftKey });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(shiftKey ? last : first);
  }
  expect(excludedTargets.every(target => target.focus.mock.calls.length === 0)).toBe(true);
});

it("keeps local create open through unavailable/empty schedules and keys its draft by popup venue/city", () => {
  props = { ...props, games: [] }; click(render(), "Создать игру на этой площадке");
  const create = () => {
    const node = elements(render()).find(element => element.type === CreateGamePage);
    if (!node) throw new Error("No embedded create");
    return node;
  };
  const initial = create(); expect(initial.props.embedded).toBe(true); expect(initial.props.initialVenue).toBe(props.venue);
  props = { ...props, gamesReady: false }; expect(create().key).toBe(initial.key);
  props = { ...props, gamesReady: true, games: [] }; expect(create().key).toBe(initial.key);
  props = { ...props, games: [fixture("later")] }; expect(create().key).toBe(initial.key);
  props = { ...props, venue: { ...venue, id: "next" } }; const next = create(); expect(next.key).not.toBe(initial.key);
  props = { ...props, venue: { ...props.venue, cityId: "other" } }; expect(create().key).not.toBe(next.key);
  (create().props.onClose as () => void)();
  expect(elements(render()).some(element => element.type === CreateGamePage)).toBe(false);
});
