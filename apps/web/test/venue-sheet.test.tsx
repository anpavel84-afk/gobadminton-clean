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
import { VenueSheet } from "../src/components/consumer/games/VenueSheet";
import { GameTerms } from "../src/components/consumer/games/GameDetailComposition";
import { venueDays, venueHandleGesture } from "../src/lib/venue-popup";
const venue: VenueSummary = { id: "v", cityId: "city", name: "Зал", address: "Улица", timezone: "Europe/Berlin" };
function fixture(id: string, startsAt: string, levels: string[] = []): Game {
  return { id, version: 1, title: `Игра ${id}`, venue, startsAt, endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    timezone: venue.timezone, status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
    organizer: { id: null, displayName: "Анна", publicContact: "" }, applicationDeadlineAt: startsAt,
    capacity: 8, externalReservedCount: 1, confirmedCount: 2, availablePlaces: 5, formatKey: "doubles",
    levelRule: { scaleId: "t", scaleVersion: 1, allowedLevelIds: levels },
    settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
}
const a = fixture("a", "2026-10-25T22:30:00Z", ["B"]);
const b = fixture("b", "2026-10-26T23:30:00Z");
const now = Date.parse("2026-10-24T22:30:00Z");
const collapse = vi.fn(), dismiss = vi.fn();
class ElementStub {
  isConnected = true;
  focus = vi.fn(() => { Object.assign(document, { activeElement: this }); });
  closest() { return null; }
}
const first = new ElementStub(), last = new ElementStub(), initiator = new ElementStub();
const root = { scrollTop: 0, contains: (element: unknown) => element === first || element === last, querySelectorAll: () => [first, last] };
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
function render(games: Game[] = [b, a], gamesReady = true) {
  hooks.cursor = 0;
  const tree = VenueSheet({ venue, games, gamesReady, now, onCollapse: collapse, onDismiss: dismiss });
  for (const node of elements(tree)) {
    const ref = node.props.ref as { current: unknown } | undefined;
    if (ref) ref.current = node.props.role === "dialog" ? root : first;
  }
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
function click(tree: React.ReactNode, text: string) {
  const node = elements(tree).find(item => item.type === "button" && (item.props["aria-label"] === text || renderToStaticMarkup(item).includes(text)));
  if (!node) throw new Error(`Missing button ${text}`);
  (node.props.onClick as () => void)();
}
function key(key: string, shiftKey = false) {
  const event = Object.assign(new Event("keydown", { cancelable: true }), { key, shiftKey });
  window.dispatchEvent(event); return event;
}
beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = [];
  collapse.mockClear(); dismiss.mockClear(); first.focus.mockClear(); last.focus.mockClear(); initiator.focus.mockClear();
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { activeElement: initiator, body: { style: { overflow: "auto" } }, querySelector: () => first });
});
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup?.()); vi.unstubAllGlobals(); });
it("renders honest information, one modal, cover fallback and no fabricated facts; terms callback replaces only the venue link", () => {
  const html = renderToStaticMarkup(render());
  expect(html.match(/role="dialog"/g)).toHaveLength(1);
  expect(html).toContain('aria-modal="true" aria-labelledby="gb-venue-sheet-title"');
  expect(html).toContain('data-cover="default"');
  for (const text of ["1/4", "Рейтинг", "Контакты площадки", "/venues/", "/games/"]) expect(html).not.toContain(text);
  const terms = renderToStaticMarkup(<GameTerms game={a} onVenueClick={collapse} />);
  expect(terms).toContain("<button"); expect(terms).not.toContain("/venues/");
  expect(renderToStaticMarkup(<GameTerms game={a} />)).toContain('href="/venues/v"');
  click(GameTerms({ game: a, onVenueClick: collapse }), "Зал"); expect(collapse).toHaveBeenCalledOnce();
});
it("moves information → dates → game → same date; removes vanished dates/games and invalidates stale detail immediately", () => {
  let tree = render(); click(tree, "Показать игры"); tree = render();
  expect(renderToStaticMarkup(tree)).toContain("Игра a");
  expect(renderToStaticMarkup(tree)).toContain("Свободно 5 из 8");
  expect(renderToStaticMarkup(tree)).toContain("Организатор");
  expect(renderToStaticMarkup(tree)).not.toContain("Любой уровень");
  click(tree, "27 окт."); tree = render(); click(tree, "Игра b"); tree = render();
  expect(renderToStaticMarkup(tree)).toContain("Условия участия");
  click(tree, "Назад к расписанию"); tree = render();
  expect(renderToStaticMarkup(tree)).toContain("Игра b"); expect(renderToStaticMarkup(tree)).not.toContain("Игра a");
  click(tree, "Игра b"); render();
  tree = render([a]); expect(renderToStaticMarkup(tree)).toContain("Игра a");
  expect(renderToStaticMarkup(tree)).not.toContain("Условия участия");
  click(tree, "Игра a"); render();
  tree = render([a], false);
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("Расписание временно недоступно");
  for (const text of ["Игра a", "Условия участия", "Показать игры", "Пока нет игр", "На этой площадке"]) expect(html).not.toContain(text);
  expect(renderToStaticMarkup(render([]))).toContain("Пока нет игр");
});
it("focuses X, traps both Tab boundaries, consumes Escape, restores overflow/focus and wires X/background", () => {
  let tree = render();
  expect(first.focus).toHaveBeenCalled(); expect(document.body.style.overflow).toBe("hidden");
  Object.assign(document, { activeElement: last }); expect(key("Tab").defaultPrevented).toBe(true);
  Object.assign(document, { activeElement: first }); expect(key("Tab", true).defaultPrevented).toBe(true);
  const external = vi.fn(); window.addEventListener("keydown", external);
  expect(key("Escape").defaultPrevented).toBe(true); expect(external).not.toHaveBeenCalled();
  click(tree, "Закрыть"); expect(collapse).toHaveBeenCalledTimes(2);
  const backdrop = elements(tree).find(node => node.props.className === "gb-venue-backdrop");
  (backdrop?.props.onClick as () => void)(); expect(dismiss).toHaveBeenCalledOnce();
  // Internal content has no dismissal handler.
  expect(elements(tree).find(node => node.props.role === "dialog")?.props.onClick).toBeUndefined();
  hooks.cleanups.forEach(cleanup => cleanup?.()); hooks.cleanups = [];
  expect(document.body.style.overflow).toBe("auto"); expect(initiator.focus).toHaveBeenCalled();
  collapse.mockClear(); key("Escape"); expect(collapse).not.toHaveBeenCalled();
  tree = render(); expect(tree).toBeDefined();
});
it("groups timezone dates in startsAt/id order over local midnight and DST without changing input", () => {
  const same = { ...a, id: "0" };
  const days = venueDays([b, a, same], venue.timezone, now);
  expect(days.map(day => day.id)).toEqual(["2026-10-25", "2026-10-27"]);
  expect(days[0]?.label).toBe("Сегодня");
  expect(days[0]?.games.map(game => game.id)).toEqual(["0", "a"]);
  expect(venueDays([fixture("spring", "2026-03-29T22:00:00Z")], venue.timezone, Date.parse("2026-03-29T00:30:00Z"))[0]?.label).toBe("Завтра");
});
it("executes real handle gesture handlers: strict 80px, axes, cancel, controls, scrolling and click suppression", () => {
  const up = vi.fn(), down = vi.fn(); let scroll = 0;
  const handle = venueHandleGesture(up, down, () => scroll);
  const event = (x: number, y: number, control = false) => ({
    button: 0, pointerId: 1, clientX: x, clientY: y, target: { closest: () => control ? {} : null },
    currentTarget: { setPointerCapture() {} }, preventDefault: vi.fn(),
  }) as unknown as React.PointerEvent<HTMLElement>;
  const swipe = (x: number, y: number) => { handle.onPointerDown(event(0, 0)); handle.onPointerUp(event(x, y)); };
  swipe(0, -80); expect(up).not.toHaveBeenCalled();
  swipe(0, -81); expect(up).toHaveBeenCalledOnce();
  const clickEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.MouseEvent<HTMLElement>;
  handle.onClickCapture(clickEvent); expect(clickEvent.preventDefault).toHaveBeenCalledOnce();
  handle.onClickCapture(clickEvent); expect(clickEvent.preventDefault).toHaveBeenCalledOnce();
  swipe(90, 81); swipe(0, 80); expect(down).not.toHaveBeenCalled();
  scroll = 1; swipe(0, 81); expect(down).not.toHaveBeenCalled();
  scroll = 0; swipe(0, 81); expect(down).toHaveBeenCalledOnce();
  handle.onPointerDown(event(0, 0)); handle.onPointerCancel(); handle.onPointerUp(event(0, 100));
  handle.onPointerDown(event(0, 0, true)); handle.onPointerUp(event(0, 100));
  expect(down).toHaveBeenCalledOnce();
});
