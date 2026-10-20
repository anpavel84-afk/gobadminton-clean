import { Children, isValidElement, Fragment } from "react";
import type * as React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ current: "", cursor: 0, slots: new Map<string, unknown[]>(), effects: [] as (() => void)[], cleanups: new Map<string, () => void>() }));
function slots() { const s = h.slots.get(h.current) ?? []; h.slots.set(h.current, s); return s; }
vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useId() { return h.current; },
  useRef(initial: unknown) { const s = slots(); const i = h.cursor++; return s[i] ??= { current: initial }; },
  useState(initial: unknown) { const s = slots(); const i = h.cursor++; if (!(i in s)) s[i] = typeof initial === "function" ? initial() : initial; return [s[i], (next: unknown) => { s[i] = typeof next === "function" ? next(s[i]) : next; }]; },
  useMemo(fn: () => unknown, deps: unknown[]) { const s = slots(); const i = h.cursor++; const old = s[i] as { deps: unknown[]; value: unknown } | undefined; if (!old || deps.some((v, n) => v !== old.deps[n])) s[i] = { deps, value: fn() }; return (s[i] as { value: unknown }).value; },
  useEffect(fn: () => void | (() => void), deps: unknown[]) { const s = slots(); const i = h.cursor++; const key = `${h.current}:${i}`; const old = s[i] as unknown[] | undefined; if (!old || deps.some((v, n) => v !== old[n])) { s[i] = deps; h.effects.push(() => { h.cleanups.get(key)?.(); h.cleanups.set(key, fn() || (() => {})); }); } },
}));
vi.mock("next/dynamic", () => ({ default: () => GamesVenueMap }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
vi.mock("pmtiles", () => ({ Protocol: class {} }));
vi.mock("maplibre-gl", () => ({ Map: class {}, Marker: class {} }));
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { GamesVenueMap } from "../src/components/consumer/games/GamesVenueMap";
import type { Game, VenueSummary } from "../src/lib/consumer-types";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
const url = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const venue: VenueSummary = { id: "a", cityId: MOSCOW_BUNDLE.cityId, name: "Зал А", address: "Адрес А", timezone: "Europe/Moscow", cover: { uploadedUrl: url } };
const other: VenueSummary = { ...venue, id: "b", name: "Зал Б" };
const game: Game = { id: "game", version: 1, title: "Непустая игра", venue, startsAt: "2027-01-01T10:00:00Z", endsAt: "2027-01-01T11:00:00Z", timezone: venue.timezone,
  status: "published", visibility: "public", activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: null, displayName: "Организатор", publicContact: "" }, applicationDeadlineAt: "2027-01-01T09:00:00Z", capacity: 4,
  externalReservedCount: 0, confirmedCount: 0, availablePlaces: 4, formatKey: "doubles", levelRule: { scaleId: "t", scaleVersion: 1, allowedLevelIds: [] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "" } };
// DOM boundary only. Real UI functions have independent hook slots and commit refs.
class Host extends EventTarget {
  dataset: Record<string, string> = {}; style = { overflow: "" }; parentNode: Host | null = null; child: Host | null = null;
  className = ""; loading = ""; decoding = ""; alt = ""; value: string | null = null; writes: string[] = [];
  props: Record<string, unknown> = {}; listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  constructor(readonly tag: string) { super(); }
  set src(value: string) { expect(this.loading).toBe("eager"); expect(this.decoding).toBe("async"); this.value = value; this.writes.push(value); }
  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null) { if (!fn) return; const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); super.addEventListener(type, fn); }
  override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null) { if (fn) this.listeners.get(type)?.delete(fn); super.removeEventListener(type, fn); }
  appendChild(node: Host) { node.remove(); this.child = node; node.parentNode = this; }
  remove() { if (this.parentNode) this.parentNode.child = null; this.parentNode = null; }
  removeAttribute(key: string) { if (key === "src") this.value = null; }
  focus() {} closest() { return null; } querySelectorAll() { return []; }
  getBoundingClientRect() { return { width: 0, height: this.className.includes("full-measure") ? 600 : 172 }; }
  setPointerCapture() {} hasPointerCapture() { return false; } releasePointerCapture() {}
}
type Ref = ((node: unknown) => void) | { current: unknown } | undefined;
type Mounted = { node: Host; ref: Ref };
let mounted = new Map<string, Mounted>(); let images: Host[] = []; let text = ""; let city = venue.cityId;
let mapProps: React.ComponentProps<typeof GamesVenueMap> | undefined;
function setRef(ref: Ref, node: Host | null) { if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }
function render() {
  const next = new Map<string, Mounted>(); const used = new Set<string>(); text = "";
  function walk(value: React.ReactNode, path: string): void {
    if (typeof value === "string" || typeof value === "number") { text += value; return; }
    if (!isValidElement<Record<string, unknown>>(value)) return;
    const key = `${path}:${String(value.key ?? "")}`;
    if (typeof value.type === "function") {
      h.current = key; h.cursor = 0; used.add(key);
      if (value.type === GamesVenueMap) mapProps = value.props as React.ComponentProps<typeof GamesVenueMap>;
      const result = (value.type as (props: Record<string, unknown>) => React.ReactNode)(value.props);
      walk(result, `${key}/out`); return;
    }
    if (value.type !== Fragment) {
      const ref = value.props.ref as Ref; const old = mounted.get(key);
      const node = old?.node ?? new Host(String(value.type)); node.props = value.props; node.className = String(value.props.className ?? "");
      next.set(key, { node, ref });
    }
    Children.forEach(value.props.children as React.ReactNode, (child, i) => walk(child, `${key}/${i}`));
  }
  walk(<GamesMapView cityId={city} day="" />, "root");
  // Detach removed/changed refs before attaching new refs, as React mutation/layout commits do.
  for (const [key, old] of mounted) if (!next.has(key) || next.get(key)?.ref !== old.ref) setRef(old.ref, null);
  for (const [key, item] of next) if (!mounted.has(key) || mounted.get(key)?.ref !== item.ref) setRef(item.ref, item.node);
  mounted = next;
  for (const key of h.slots.keys()) if (!used.has(key)) { h.slots.delete(key); for (const [effectKey, cleanup] of h.cleanups) if (effectKey.startsWith(`${key}:`)) { cleanup(); h.cleanups.delete(effectKey); } }
  h.effects.splice(0).forEach(effect => effect());
}
function host(predicate: (node: Host) => boolean) { const node = [...mounted.values()].map(item => item.node).find(predicate); if (!node) throw new Error("Host missing"); return node; }
function click(label: string) { const node = host(n => n.props["aria-label"] === label || n.props.children === label); const fn = node.props.onClick; if (typeof fn !== "function") throw new Error("Click missing"); fn(); render(); }
function select(v: VenueSummary) { if (!mapProps) throw new Error("Map missing"); mapProps.onSelect(v); render(); }
function photo() { const node = images.at(-1); if (!node) throw new Error("Photo missing"); return node; }
function inSlot(mode: "preview" | "sheet") { expect(photo().parentNode?.className).toContain(`gb-venue-${mode}-cover`); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  h.slots.clear(); h.cleanups.clear(); h.effects = []; mounted = new Map(); images = []; city = venue.cityId; mapProps = undefined;
  vi.stubGlobal("HTMLElement", Host);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }), location: { origin: "https://dev.gobadminton.ru" } }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { body: new Host("body"), activeElement: null, visibilityState: "visible", querySelector: () => null,
    createElement: vi.fn((tag: string) => { const node = new Host(tag); if (tag === "img") images.push(node); return node; }) }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(JSON.stringify({ items: path.startsWith("/v1/venues") ? [venue, other] : [game], nextCursor: null }))));
});
afterEach(() => { for (const item of mounted.values()) setRef(item.ref, null); for (const cleanup of h.cleanups.values()) cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function load() { render(); await vi.advanceTimersByTimeAsync(1); render(); render(); }
it.each([false, true])("retains one selected node through real popup/sheet UI (loaded=%s)", async loaded => {
  await load(); expect(images).toHaveLength(0); select(venue); const image = photo(); inSlot("preview");
  if (loaded) image.dispatchEvent(new Event("load"));
  render(); expect(images).toHaveLength(1);
  click("Открыть площадку Зал А"); inSlot("sheet"); expect(text).toContain("Адрес А");
  click("Показать игры на этой площадке"); inSlot("preview"); expect(text).toContain("Непустая игра"); expect(text).toContain("Игры на этой площадке");
  click("К информации о площадке"); inSlot("sheet"); expect(text).toContain("Показать игры на этой площадке");
  click("Закрыть"); inSlot("preview"); click("Развернуть площадку"); inSlot("sheet");
  expect(photo()).toBe(image); expect(images).toHaveLength(1); expect(image.writes).toEqual([url]);
  expect(vi.mocked(document.createElement).mock.calls.filter(([tag]) => tag === "img")).toHaveLength(1);
  click("Закрыть"); mapProps?.onDeselect?.(); render(); expect(image.value).toBeNull(); expect(image.parentNode).toBeNull();
});
it("keeps the loaded selected image when a refreshed venue name changes", async () => {
  await load(); select(venue); const image = photo(); image.dispatchEvent(new Event("load"));
  const refreshed = { ...venue, name: "Обновлённый зал" };
  vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
    const path = String(input);
    return new Response(JSON.stringify({ items: path.startsWith("/v1/venues") ? [refreshed, other] : [{ ...game, venue: refreshed }], nextCursor: null }));
  });
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(1); render(); render();
  click("Открыть площадку Обновлённый зал"); inSlot("sheet");
  expect(text).toContain("Обновлённый зал"); expect(image.alt).toBe("Обложка: Обновлённый зал");
  click("Закрыть"); inSlot("preview");
  expect(photo()).toBe(image); expect(images).toHaveLength(1); expect(image.writes).toEqual([url]);
});
it("moves the same node during moving/settling and cleans up on city switch", async () => {
  await load(); select(venue); const image = photo();
  const handle = host(n => n.props["aria-label"] === "Развернуть площадку");
  const event = { pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 400, timeStamp: 1, currentTarget: handle, preventDefault() {} };
  const down = handle.props.onPointerDown; if (typeof down !== "function") throw new Error("Down missing"); down(event);
  const move = handle.props.onPointerMove; if (typeof move !== "function") throw new Error("Move missing"); move({ ...event, clientY: 380, timeStamp: 20 }); render();
  expect(host(n => n.className === "gb-venue-popup").props["data-moving"]).toBe(true); inSlot("sheet");
  const up = host(n => n.className === "gb-venue-handle").props.onPointerUp; if (typeof up !== "function") throw new Error("Up missing"); up({ ...event, clientY: 380, timeStamp: 200 }); render();
  inSlot("sheet"); await vi.advanceTimersByTimeAsync(220); render(); inSlot("preview");
  expect(photo()).toBe(image); expect(image.writes).toEqual([url]); city = "other"; render(); render(); expect(image.value).toBeNull();
  expect([...image.listeners.values()].flatMap(set => [...set])).toEqual([]);
});
