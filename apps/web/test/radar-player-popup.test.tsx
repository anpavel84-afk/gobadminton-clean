import { Children, isValidElement } from "react";
import type * as React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UnifiedPreview, UnifiedRow, UnifiedSnapshot } from "@gobadminton/contracts";
import type { Map as LibreMap } from "maplibre-gl";
import type { Me, VenueSummary } from "../src/lib/consumer-types";
import { UnifiedDirectoryController } from "../src/lib/unified-directory";
import type { apiFetch } from "../src/lib/api-client";
import { MOSCOW_BUNDLE } from "../src/lib/radar-map-assets";
import { RadarPage } from "../src/components/consumer/radar/RadarPage";
import { UnifiedPlayerPreview } from "../src/components/consumer/radar/UnifiedPlayerPreview";
import { VenuePopup } from "../src/components/consumer/games/VenuePopup";
import { GamesMapView } from "../src/components/consumer/games/GamesMapView";
import { VenuePreviewCard } from "../src/components/consumer/games/VenuePreviewCard";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
const context = vi.hoisted(() => ({ directory: null as unknown, session: null as unknown, config: null as unknown }));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  useState<T>(initial: T) {
    const i = hooks.cursor++; const slots = hooks.slots;
    if (!(i in slots)) slots[i] = initial;
    return [slots[i], (next: T | ((value: T) => T)) => { slots[i] = typeof next === "function" ? (next as (value: T) => T)(slots[i] as T) : next; }];
  },
  useRef(initial: unknown) { const i = hooks.cursor++; return hooks.slots[i] ??= { current: initial }; },
  useMemo(fn: () => unknown, deps: unknown[]) {
    const i = hooks.cursor++; const old = hooks.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || deps.some((v, n) => v !== old.deps[n])) hooks.slots[i] = { deps, value: fn() };
    return (hooks.slots[i] as { value: unknown }).value;
  },
  useCallback(fn: unknown, deps: unknown[]) {
    const i = hooks.cursor++; const old = hooks.slots[i] as { deps: unknown[]; fn: unknown } | undefined;
    if (!old || deps.some((v, n) => v !== old.deps[n])) hooks.slots[i] = { deps, fn };
    return (hooks.slots[i] as { fn: unknown }).fn;
  },
  useContext(context: { _currentValue: unknown }) { return context._currentValue; },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = hooks.cursor++; const old = hooks.slots[i] as unknown[] | undefined;
    if (!old || deps.some((v, n) => v !== old[n])) {
      hooks.slots[i] = deps;
      hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect() || (() => {}); });
    }
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/dynamic", () => ({ default: () => function CapturedMap(props: Record<string, unknown>) { return <div data-map="harness" {...props} />; } }));
vi.mock("../src/components/consumer/radar/RadarSessionProvider", () => ({
  useUnifiedDirectory: () => context.directory,
  useRadarSession: () => context.session,
  useRadarConfig: () => context.config,
  useDirectoryFilters: () => ({ filters: { cityId: "a0000000-0000-4000-8000-000000000001", areaKey: "", name: "", lookingOnly: false, trainerOnly: false } }),
  RadarStatusAffordance: () => null,
}));
vi.mock("../src/components/consumer/radar/RadarContact", () => ({ RadarContact: () => null }));

const now = Date.parse("2030-01-01T00:00:00Z");
const until = new Date(now + 45000).toISOString();
const row: UnifiedRow = {
  publicPlayerId: "peer", projection: "directory",
  player: { publicPlayerId: "peer", displayName: "Игрок", cityId: MOSCOW_BUNDLE.cityId, areaKey: null, level: null, trainer: false, lookingForGame: false, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false },
  radar: { resultId: "r", resultRef: "private-proof", consentPolicyVersion: "radar-geographic-sharing-v2", validUntil: until, distance: null, geo: { latitude: 55.75, longitude: 37.6, crs: "EPSG:4326", model: "regional_grid_100m_v1", gridSizeMeters: 100, uncertaintyMeters: 100, quality: "approximate", sourceTimestampBucket: new Date(now).toISOString(), sourceAgeSeconds: 0 } },
};
const snapshot: UnifiedSnapshot = {
  contractVersion: "players-unified-radar-v1", policyVersion: "radar-geographic-sharing-v2", exposureMode: "synthetic_demo",
  cityId: MOSCOW_BUNDLE.cityId, regionId: "moscow", generatedAt: new Date(now).toISOString(), validUntil: until, refreshAfterSeconds: 30,
  query: { queryRef: "q", asOf: new Date(now).toISOString(), ordering: "radar_city_then_directory", originState: "none", originRef: null },
  totals: { matchingTotal: 1, radarTotal: 1, ordinaryOnlyTotal: 0, completeness: "exact_at_asOf" },
  map: { availability: "missing", mapId: null, version: null }, items: [row],
  page: { returnedCount: 1, rankStart: 1, rankEnd: 1, hasMore: false, nextCursor: null },
};
const preview: UnifiedPreview = {
  player: { publicPlayerId: "peer", displayName: "Игрок", level: null, trainer: false, avatar: { uploadedUrl: null, providerUrl: null }, canRequestContact: false },
  proximityBand: null,
  radar: { consentPolicyVersion: row.radar!.consentPolicyVersion, geo: row.radar!.geo, validUntil: until, distance: null },
  upcomingGames: [],
};
const venueA: VenueSummary = { id: "a", cityId: MOSCOW_BUNDLE.cityId, name: "Зал А", address: "Улица А", timezone: "Europe/Moscow", latitude: 55.7, longitude: 37.6 };

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(tree: ReactNode): Node[] {
  const found: Node[] = [];
  function walk(node: ReactNode) {
    if (!isValidElement<Record<string, unknown>>(node)) return;
    found.push(node);
    Children.forEach(node.props.children as ReactNode, walk);
    if ("preview" in node.props) walk(node.props.preview as ReactNode);
  }
  walk(tree);
  return found;
}
function activate(tree: ReactNode, label: string) {
  const node = nodes(tree).find(n => n.props.children === label || n.props["aria-label"] === label);
  if (!node) throw Error(`Missing ${label}`);
  (node.props.onClick as () => void)();
}

const listeners = new Map<string, Set<() => void>>();
const trigger = { isConnected: true, focus: vi.fn() };
let controller: UnifiedDirectoryController;
const request = vi.fn();
const map = {
  getCanvas: () => ({ setAttribute: vi.fn(), removeAttribute: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  on: vi.fn(), off: vi.fn(),
} as unknown as LibreMap;

beforeEach(async () => {
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = []; listeners.clear(); trigger.focus.mockClear(); request.mockReset();
  vi.useFakeTimers(); vi.setSystemTime(now);
  const history = {
    state: {} as Record<string, unknown>,
    pushState: vi.fn((state: Record<string, unknown>) => { history.state = state; }),
    back: vi.fn(() => { history.state = {}; listeners.get("popstate")?.forEach(fn => fn()); }),
  };
  vi.stubGlobal("window", {
    location: { origin: "https://dev.gobadminton.ru", href: "https://dev.gobadminton.ru/games?view=map", pathname: "/games", search: "?view=map", assign: vi.fn() },
    history,
    addEventListener: (name: string, fn: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn),
    setTimeout, clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  vi.stubGlobal("document", { activeElement: trigger, querySelector: () => null, body: { style: { overflow: "" } }, visibilityState: "visible" });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const isVenues = String(url).startsWith("/v1/venues");
    return new Response(JSON.stringify({ items: isVenues ? [venueA] : [], nextCursor: null }), { status: 200 });
  }));
  request.mockImplementation(async (path: string) => ({
    ok: true, status: 200,
    data: path.endsWith("/preview") ? preview : path.endsWith("/map")
      ? { ...snapshot, mapPage: { returnedCount: 1, rankStart: 1, rankEnd: 1, hasMore: false, nextMapCursor: null } }
      : snapshot,
  }));
  controller = new UnifiedDirectoryController(request as typeof apiFetch, Date.now);
  controller.bind({ id: "viewer", csrfToken: "csrf" } as Me);
  await controller.query({ cityId: MOSCOW_BUNDLE.cityId });
  await controller.map();
  context.session = { view: { me: { id: "viewer", csrfToken: "csrf", displayName: "Viewer" }, phase: "off", confirmedOn: false, pendingStop: false } };
  context.config = { exposureMode: "live", unifiedDirectory: { enabled: true }, cities: [{ cityId: MOSCOW_BUNDLE.cityId, map: { availability: "dev_preview", mapId: "moscow", version: MOSCOW_BUNDLE.version } }] };
});
afterEach(() => { hooks.cleanups.forEach(fn => fn?.()); controller.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function renderRadar(extra: Partial<React.ComponentProps<typeof RadarPage>> = {}) {
  context.directory = { controller, view: controller.view };
  hooks.cursor = 0;
  const tree = RadarPage({ sharedMap: map, ...extra });
  hooks.effects.splice(0).forEach(fn => fn());
  return tree;
}
function renderMap(overrides: Partial<React.ComponentProps<typeof GamesMapView>> = {}) {
  hooks.cursor = 0;
  const tree = GamesMapView({ cityId: venueA.cityId, day: "2026-11-10", ...overrides });
  hooks.effects.splice(0).forEach(fn => fn());
  return tree;
}

it("player selection uses VenuePopup; compact tap/handle expand; games internal with Back; close", () => {
  void controller.select(controller.view.pins[0]!);
  let tree = renderRadar();
  expect(nodes(tree).some(n => n.type === VenuePopup)).toBe(true);
  expect(nodes(tree).some(n => n.type === "aside")).toBe(false);
  const compact = nodes(tree).find(n => n.type === UnifiedPlayerPreview && n.props.surface === "compact")!;
  (compact.props.onOpen as () => void)();
  tree = renderRadar();
  let popup = nodes(tree).find(n => n.type === VenuePopup)!;
  expect(popup.props.expanded).toBe(true);
  (popup.props.onExpandedChange as (value: boolean) => void)(false);
  tree = renderRadar();
  popup = nodes(tree).find(n => n.type === VenuePopup)!;
  expect(popup.props.expanded).toBe(false);
  (popup.props.onExpandedChange as (value: boolean) => void)(true);
  tree = renderRadar();
  expect(nodes(tree).find(n => n.type === VenuePopup)!.props.expanded).toBe(true);
  // Detail surface owns games/back on the same sheet fiber slots
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = [];
  context.directory = { controller, view: controller.view };
  let detailTree = UnifiedPlayerPreview({ surface: "detail", onClose: () => controller.close(), onCollapse: () => {} });
  hooks.effects.splice(0).forEach(fn => fn());
  activate(detailTree, "Ближайшие публичные игры");
  hooks.cursor = 0;
  detailTree = UnifiedPlayerPreview({ surface: "detail", onClose: () => controller.close(), onCollapse: () => {} });
  expect((detailTree as Node).props["data-player-view"]).toBe("games");
  activate(detailTree, `Назад к профилю ${preview.player.displayName}`);
  hooks.cursor = 0;
  detailTree = UnifiedPlayerPreview({ surface: "detail", onClose: () => controller.close(), onCollapse: () => {} });
  expect((detailTree as Node).props["data-player-view"]).toBe("profile");
  hooks.slots = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = [];
  tree = renderRadar();
  (nodes(tree).find(n => n.type === VenuePopup)!.props.onDeselect as () => void)();
  tree = renderRadar();
  expect(controller.view.selected).toBeNull();
});

it("singleton handoff: gb-map-select-venue/player events are mutual exclusive", async () => {
  void controller.select(controller.view.pins[0]!);
  expect(nodes(renderRadar()).some(n => n.type === VenuePopup)).toBe(true);
  window.dispatchEvent(new Event("gb-map-select-venue"));
  expect(controller.view.selected).toBeNull();
  expect(controller.view.preview).toBeNull();
  expect(nodes(renderRadar()).some(n => n.type === VenuePopup)).toBe(false);

  await controller.select(controller.view.pins[0]!);
  const clearVenue = vi.fn();
  window.addEventListener("gb-map-select-player", clearVenue);
  const tree = renderRadar();
  const layer = nodes(tree).find(n => n.props.sharedMap === map)!;
  (layer.props.onSelect as (row: UnifiedRow) => void)(controller.view.pins[0]!);
  expect(clearVenue).toHaveBeenCalledOnce();
  window.removeEventListener("gb-map-select-player", clearVenue);
});

it("GamesMapView venue select dispatches venue event and clears on player event", async () => {
  renderMap();
  await vi.advanceTimersByTimeAsync(1);
  let tree = renderMap();
  const mapNode = nodes(tree).find(n => typeof n.props.onSelect === "function")!;
  const venueSelected = vi.fn();
  window.addEventListener("gb-map-select-venue", venueSelected);
  (mapNode.props.onSelect as (venue: VenueSummary) => void)(venueA);
  expect(venueSelected).toHaveBeenCalledOnce();
  window.removeEventListener("gb-map-select-venue", venueSelected);
  tree = renderMap();
  expect(nodes(tree).some(n => n.type === VenuePreviewCard || n.type === VenuePopup)).toBe(true);
  window.dispatchEvent(new Event("gb-map-select-player"));
  tree = renderMap();
  expect(nodes(tree).some(n => n.type === VenuePreviewCard)).toBe(false);
  expect(nodes(tree).find(n => typeof n.props.onSelect === "function")!.props.selectedVenueId).toBeNull();
});

it("stale/privacy stop hides player popup; image fallback and empty games remain honest", () => {
  void controller.select(controller.view.pins[0]!);
  controller.view = { ...controller.view, preview: { ...preview, player: { ...preview.player, publicPlayerId: "other" } } };
  expect(UnifiedPlayerPreview({ surface: "compact", onClose: () => {}, onOpen: () => {} })).toBeNull();
  controller.view = { ...controller.view, preview: { ...preview, upcomingGames: [] } };
  context.directory = { controller, view: controller.view };
  hooks.cursor = 0;
  let tree = UnifiedPlayerPreview({ surface: "detail", onClose: () => controller.close(), onCollapse: () => {} });
  hooks.effects.splice(0).forEach(fn => fn());
  activate(tree, "Ближайшие публичные игры");
  hooks.cursor = 0;
  tree = UnifiedPlayerPreview({ surface: "detail", onClose: () => controller.close(), onCollapse: () => {} });
  expect(JSON.stringify(tree)).toContain("Нет доступных ближайших публичных игр");
  controller.view = { ...controller.view, stale: true };
  context.directory = { controller, view: controller.view };
  hooks.cursor = 0;
  expect(UnifiedPlayerPreview({ surface: "detail", onClose: () => {}, onCollapse: () => {} })).toBeNull();
});

it("list access keeps aside without stacking a player VenuePopup", () => {
  controller.close();
  let tree = renderRadar();
  const summary = nodes(tree).find(n => n.props.children === "На карте: 1 из 1");
  expect(summary).toBeDefined();
  (summary!.props.onClick as () => void)();
  tree = renderRadar();
  expect(nodes(tree).some(n => n.type === "aside")).toBe(true);
  expect(nodes(tree).some(n => n.type === VenuePopup)).toBe(false);
});
