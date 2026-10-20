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

import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
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
  focus = vi.fn(() => { Object.assign(document, { activeElement: this }); });
}
const first = new FocusTarget(); const last = new FocusTarget(); const initiator = new FocusTarget();
const collapse = vi.fn(); const deselect = vi.fn(); const focus = first.focus;
let props: React.ComponentProps<typeof VenueSheet>;
function render() {
  hooks.cursor = 0; const tree = VenueSheet(props);
  for (const node of elements(tree)) {
    const ref = node.props.ref as { current: unknown } | undefined;
    if (ref) ref.current = node.props.role === "dialog" ? panel : first;
  }
  hooks.effects.splice(0).forEach(effect => effect()); return tree;
}
const panel = { scrollTop: 0, contains: (target: unknown) => target === first || target === last, querySelectorAll: () => [first, last] };
function click(tree: React.ReactNode, text: string) {
  const button = elements(tree).find(node => node.type === "button" && (node.props["aria-label"] === text || renderToStaticMarkup(node).includes(text)));
  if (!button) throw new Error(`Missing ${text}`);
  (button.props.onClick as () => void)();
}
beforeEach(() => {
  hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0; collapse.mockClear(); deselect.mockClear(); focus.mockClear(); panel.scrollTop = 0; last.focus.mockClear(); initiator.focus.mockClear();
  props = { venue, games: [fixture("b"), fixture("a"), fixture("c", "2026-10-26T12:00:00Z")], gamesReady: true, now: Date.parse("2026-10-24T22:30:00Z"), onCollapse: collapse, onDeselect: deselect };
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { activeElement: initiator, body: { style: { overflow: "auto" } }, querySelector: () => ({ focus }) });
  vi.stubGlobal("HTMLElement", FocusTarget);
});
afterEach(() => { hooks.cleanups.forEach(fn => fn?.()); vi.unstubAllGlobals(); });
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
  const tree = render(); expect(collapse).not.toHaveBeenCalled(); expect(deselect).not.toHaveBeenCalled(); click(tree, "Закрыть"); expect(collapse).toHaveBeenCalledOnce();
  const backdrop = elements(tree).find(node => node.props.className === "gb-venue-sheet-backdrop");
  if (!backdrop) throw new Error("No backdrop"); (backdrop.props.onClick as () => void)(); expect(deselect).toHaveBeenCalledOnce();
});
it.each([80, 81])("handle down swipe threshold %s", distance => {
  class Target { closest() { return true; } } vi.stubGlobal("Element", Target);
  const tree = render(); const dialog = elements(tree).find(node => node.props.role === "dialog"); if (!dialog) throw new Error("No dialog");
  const event = { target: new Target(), clientX: 0, clientY: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } };
  (dialog.props.onPointerDown as (value: unknown) => void)(event);
  (dialog.props.onPointerUp as (value: unknown) => void)({ ...event, clientY: distance });
  expect(collapse).toHaveBeenCalledTimes(distance > 80 ? 1 : 0);
});
it.each(["horizontal", "cancel", "scroll", "control"])("ignores %s gesture", reason => {
  class Target { closest() { return reason !== "control"; } } vi.stubGlobal("Element", Target);
  const dialog = elements(render()).find(node => node.props.role === "dialog"); if (!dialog) throw new Error("No dialog");
  const event = { target: new Target(), clientX: 0, clientY: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } };
  if (reason === "scroll") panel.scrollTop = 1;
  (dialog.props.onPointerDown as (value: unknown) => void)(event);
  if (reason === "cancel") (dialog.props.onPointerCancel as () => void)();
  (dialog.props.onPointerUp as (value: unknown) => void)({ ...event, clientX: reason === "horizontal" ? 100 : 0, clientY: 81 });
  expect(collapse).not.toHaveBeenCalled();
});
it("notifies the persistent owner before collapsing and removing the sheet", () => {
  class Target { closest() { return true; } } vi.stubGlobal("Element", Target);
  const order: string[] = [];
  props = { ...props, onSwipe: () => order.push("suppress"), onCollapse: () => { order.push("collapse"); hooks.cleanups.forEach(fn => fn?.()); } };
  const dialog = elements(render()).find(node => node.props.role === "dialog"); if (!dialog) throw new Error("No dialog");
  const event = { target: new Target(), clientX: 0, clientY: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } };
  (dialog.props.onPointerDown as (value: unknown) => void)(event);
  (dialog.props.onPointerUp as (value: unknown) => void)({ ...event, clientY: 81 });
  expect(order).toEqual(["suppress", "collapse"]);
  expect(document.body.style.overflow).toBe("auto");
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
