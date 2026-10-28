import { Children, isValidElement } from "react";
import type * as React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicPlayer } from "../src/lib/consumer-types";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getPlayer: vi.fn(),
  listCities: vi.fn(),
  createAbuseReport: vi.fn(),
  putMyBlock: vi.fn(),
  deleteMyBlock: vi.fn(),
}));

vi.mock("../src/lib/api-client", () => api);
vi.mock("../src/components/consumer/friends/ProfileFriendship", () => ({
  ProfileFriendship: ({ peerId }: { peerId: string }) => <section data-friendship={peerId}>Друзья</section>,
}));
vi.mock("../src/components/consumer/players/ContactAction", () => ({
  useContactState: () => null,
  ContactAction: () => <button type="button">Написать</button>,
  ContactNote: () => null,
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

import { PublicPlayerProfile, reportUnknownScopeKey } from "../src/components/consumer/players/PublicPlayerProfile";
import { PublicPlayerProfilePage } from "../src/components/consumer/pages/PublicPlayerProfilePage";
import { PlayerProfileContent } from "../src/components/consumer/players/PlayerProfileContent";

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(tree: ReactNode): Node[] {
  const found: Node[] = [];
  function walk(node: ReactNode) {
    if (!isValidElement<Record<string, unknown>>(node)) return;
    found.push(node);
    Children.forEach(node.props.children as ReactNode, walk);
  }
  walk(tree);
  return found;
}
function activate(tree: ReactNode, label: string) {
  const node = nodes(tree).find(n => n.props.children === label || n.props["aria-label"] === label);
  if (!node) throw Error(`Missing ${label}`);
  (node.props.onClick as () => void)();
}

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  params: { publicPlayerId: "peer" as string },
  search: new URLSearchParams(),
}));

vi.mock("react", async original => ({
  ...await original<typeof React>(),
  useState<T>(initial: T) {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = initial;
    return [hooks.slots[i], (next: T | ((value: T) => T)) => {
      hooks.slots[i] = typeof next === "function" ? (next as (value: T) => T)(hooks.slots[i] as T) : next;
    }];
  },
  useRef(initial: unknown) {
    const i = hooks.cursor++;
    return (hooks.slots[i] ??= { current: initial });
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const i = hooks.cursor++;
    const old = hooks.slots[i] as unknown[] | undefined;
    if (!old || deps.some((v, n) => v !== old[n])) {
      hooks.slots[i] = deps;
      hooks.effects.push(() => {
        hooks.cleanups[i]?.();
        hooks.cleanups[i] = effect() || (() => {});
      });
    }
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => hooks.params,
  useSearchParams: () => hooks.search,
}));

vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: ReactNode }) => <div data-shell="">{children}</div>,
}));

const player: PublicPlayer = {
  publicPlayerId: "peer",
  displayName: "Мария Л.",
  cityId: "city",
  areaKey: "Сокол",
  level: null,
  bio: "Люблю парную игру",
  trainer: false,
  lookingForGame: true,
  cover: { uploadedUrl: "/v1/media/covers/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" },
  avatar: { uploadedUrl: null, providerUrl: null },
  canRequestContact: true,
};

function resetHooks() {
  hooks.cleanups.forEach(fn => fn?.());
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
}

function renderProfile(props: React.ComponentProps<typeof PublicPlayerProfile>) {
  hooks.cursor = 0;
  const tree = <PublicPlayerProfile {...props} />;
  // Execute PublicPlayerProfile through the mocked hook fiber.
  const element = PublicPlayerProfile(props);
  hooks.effects.splice(0).forEach(fn => fn());
  return { tree, element };
}

beforeEach(() => {
  resetHooks();
  api.getMe.mockReset();
  api.getPlayer.mockReset();
  api.listCities.mockReset();
  api.getMe.mockResolvedValue({ ok: true, status: 200, data: { id: "viewer", csrfToken: "csrf", displayName: "Viewer", locale: "ru", linkedProviders: [] } });
  api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: player });
  api.listCities.mockResolvedValue({ ok: true, status: 200, data: { items: [{ id: "city", nameRu: "Москва" }] } });
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
  }));
});

afterEach(() => {
  resetHooks();
  vi.unstubAllGlobals();
});

describe("shared PublicPlayerProfile ordinary + Radar composition", () => {
  it("route page stays a thin ConsumerShell/back-link wrapper over the shared body", () => {
    hooks.cursor = 0;
    const page = PublicPlayerProfilePage();
    const html = renderToStaticMarkup(page);
    expect(html).toContain('data-shell=""');
    expect(html).toContain('href="/players"');
    expect(html).toContain("← Все игроки");
    // Shared body mounts with the route id, not a second fetch owner in the page.
    expect(JSON.stringify(page)).toContain("peer");
  });

  it("renders the same public fields and safety actions once getPlayer resolves; distance stays optional", async () => {
    const ordinary = renderProfile({ publicPlayerId: "peer" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    hooks.cursor = 0;
    const readyOrdinary = PublicPlayerProfile({ publicPlayerId: "peer" });
    const ordinaryHtml = renderToStaticMarkup(readyOrdinary);
    expect(ordinaryHtml).toContain("player-profile-hero");
    expect(ordinaryHtml).toContain("Мария Л.");
    expect(ordinaryHtml).toContain("Люблю парную игру");
    expect(ordinaryHtml).toContain("Москва · Сокол");
    expect(ordinaryHtml).toContain("Заблокировать");
    expect(ordinaryHtml).toContain("Пожаловаться");
    expect(ordinaryHtml).toContain("Друзья");
    expect(ordinaryHtml).toContain("Ближайшие игры этого игрока пока недоступны");
    expect(ordinaryHtml).not.toContain("player-profile-distance");
    expect(ordinaryHtml).not.toContain("Приблизительное положение");

    resetHooks();
    api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: player });
    api.getMe.mockResolvedValue({ ok: true, status: 200, data: { id: "viewer", csrfToken: "csrf", displayName: "Viewer", locale: "ru", linkedProviders: [] } });
    api.listCities.mockResolvedValue({ ok: true, status: 200, data: { items: [{ id: "city", nameRu: "Москва" }] } });
    renderProfile({ publicPlayerId: "peer", embedded: true, distance: "≈ 1,2 км", nearbyGamesAction: null, contactActions: <span data-radar-contact="">RadarContact</span> });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    hooks.cursor = 0;
    const readyRadar = PublicPlayerProfile({
      publicPlayerId: "peer",
      embedded: true,
      distance: "≈ 1,2 км",
      nearbyGamesAction: null,
      contactActions: <span data-radar-contact="">RadarContact</span>,
    });
    const radarHtml = renderToStaticMarkup(readyRadar);
    expect(radarHtml).toContain('data-embedded="true"');
    expect(radarHtml).toContain("player-profile-hero");
    expect(radarHtml).toContain("Мария Л.");
    expect(radarHtml).toContain("Люблю парную игру");
    expect(radarHtml).toContain("Москва · Сокол");
    expect(radarHtml).toContain("player-profile-distance");
    expect(radarHtml).toContain("≈ 1,2 км");
    expect(radarHtml).toContain("data-radar-contact");
    expect(radarHtml).toContain("Заблокировать");
    expect(radarHtml).toContain("Пожаловаться");
    expect(radarHtml).toContain("Друзья");
    expect(radarHtml).not.toContain("Ближайшие игры этого игрока пока недоступны");
    expect(radarHtml).not.toContain("Приблизительное положение");
    // Presentation parity: same PlayerProfileContent fields aside from optional distance.
    const baseFields = { ...player };
    const withoutDistance = renderToStaticMarkup(<PlayerProfileContent player={baseFields} city="Москва" titleAs="h2" />);
    const withDistance = renderToStaticMarkup(<PlayerProfileContent player={baseFields} city="Москва" titleAs="h2" distance="≈ 1,2 км" />);
    expect(withDistance.replace(/<span class="player-profile-distance"[^>]*>.*?<\/span>/, "")).toBe(withoutDistance);
    expect(ordinary).toBeTruthy();
  });

  it("ignores late getPlayer after unmount or peer change", async () => {
    let resolvePlayer!: (value: unknown) => void;
    api.getPlayer.mockImplementation(() => new Promise(resolve => { resolvePlayer = resolve; }));
    const first = renderProfile({ publicPlayerId: "peer-a" });
    const cleanups = [...hooks.cleanups];
    cleanups.forEach(fn => fn?.());
    resolvePlayer({ ok: true, status: 200, data: { ...player, publicPlayerId: "peer-a", displayName: "Stale" } });
    await Promise.resolve();
    await Promise.resolve();
    // Fiber was cleaned; a fresh mount for another peer must not keep the stale name.
    resetHooks();
    api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: { ...player, publicPlayerId: "peer-b", displayName: "Актуальный" } });
    renderProfile({ publicPlayerId: "peer-b" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    hooks.cursor = 0;
    const html = renderToStaticMarkup(PublicPlayerProfile({ publicPlayerId: "peer-b" }));
    expect(html).toContain("Актуальный");
    expect(html).not.toContain("Stale");
    expect(first).toBeTruthy();
  });

  it("shows honest unavailable on public GET 404 without inventing cover/bio/city", async () => {
    api.getPlayer.mockResolvedValue({ ok: false, status: 404, error: "missing" });
    renderProfile({ publicPlayerId: "missing" });
    await Promise.resolve();
    await Promise.resolve();
    hooks.cursor = 0;
    const html = renderToStaticMarkup(PublicPlayerProfile({ publicPlayerId: "missing" }));
    expect(html).toContain("Профиль недоступен");
    expect(html).not.toContain("player-profile-hero");
    expect(html).not.toContain("Люблю парную игру");
    expect(html).not.toContain("Обложка профиля");
  });
});

describe("unknown-report latch across Radar remounts (shared body)", () => {
  async function readyProfile(props: React.ComponentProps<typeof PublicPlayerProfile>) {
    renderProfile(props);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    hooks.cursor = 0;
    return PublicPlayerProfile(props);
  }

  async function openAndSubmit(props: React.ComponentProps<typeof PublicPlayerProfile>) {
    let tree = await readyProfile(props);
    activate(tree, "Пожаловаться");
    hooks.cursor = 0;
    tree = PublicPlayerProfile(props);
    const form = nodes(tree).find(n => n.type === "form");
    if (!form) throw Error("Missing report form");
    await (form.props.onSubmit as (e: { preventDefault(): void }) => void | Promise<void>)({ preventDefault() {} });
    hooks.cursor = 0;
    return PublicPlayerProfile(props);
  }

  beforeEach(() => {
    api.createAbuseReport.mockReset();
    api.createAbuseReport.mockResolvedValue({ ok: false, status: 0, error: "network" });
  });

  it("parent latch blocks a second POST after dismiss → remount (games/collapse)", async () => {
    let latch = new Set<string>();
    const propsFor = (): React.ComponentProps<typeof PublicPlayerProfile> => ({
      publicPlayerId: "peer",
      embedded: true,
      nearbyGamesAction: null,
      reportUnknown: latch.has(reportUnknownScopeKey("viewer", "peer")),
      onReportUnknown: scope => { latch = new Set([...latch, scope]); },
    });

    await openAndSubmit(propsFor());
    expect(api.createAbuseReport).toHaveBeenCalledTimes(1);
    expect(latch.has(reportUnknownScopeKey("viewer", "peer"))).toBe(true);

    // Dismiss dialog while uncertain, then Radar replaces the profile subtree.
    hooks.cursor = 0;
    let tree = PublicPlayerProfile(propsFor());
    const dialog = nodes(tree).find(n => n.props.title === "Пожаловаться на игрока");
    (dialog!.props.onClose as () => void)();

    resetHooks();
    api.getMe.mockResolvedValue({ ok: true, status: 200, data: { id: "viewer", csrfToken: "csrf", displayName: "Viewer", locale: "ru", linkedProviders: [] } });
    api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: player });
    api.listCities.mockResolvedValue({ ok: true, status: 200, data: { items: [{ id: "city", nameRu: "Москва" }] } });

    tree = await openAndSubmit(propsFor());
    expect(api.createAbuseReport).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(tree)).toContain("disabled");
  });

  it("profile refresh clears generic uncertain UI but keeps unknown-report latch", async () => {
    let latch = new Set<string>();
    const propsFor = (): React.ComponentProps<typeof PublicPlayerProfile> => ({
      publicPlayerId: "peer",
      reportUnknown: latch.has(reportUnknownScopeKey("viewer", "peer")),
      onReportUnknown: scope => { latch = new Set([...latch, scope]); },
    });

    await openAndSubmit(propsFor());
    expect(api.createAbuseReport).toHaveBeenCalledTimes(1);

    hooks.cursor = 0;
    let tree = PublicPlayerProfile(propsFor());
    const dialog = nodes(tree).find(n => n.props.title === "Пожаловаться на игрока");
    (dialog!.props.onClose as () => void)();
    hooks.cursor = 0;
    tree = PublicPlayerProfile(propsFor());
    activate(tree, "Обновить профиль");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    hooks.cursor = 0;
    tree = PublicPlayerProfile(propsFor());
    // Refresh re-enabled block reconciliation, but report stays latched — no second POST.
    const reportBtn = nodes(tree).find(n => n.props.children === "Пожаловаться");
    expect(reportBtn?.props.disabled).toBe(true);
    if (reportBtn && !reportBtn.props.disabled) activate(tree, "Пожаловаться");
    expect(api.createAbuseReport).toHaveBeenCalledTimes(1);
  });

  it("late unknown completion after unmount latches original scope without poisoning another peer", async () => {
    let resolveReport!: (value: unknown) => void;
    api.createAbuseReport.mockImplementation(() => new Promise(resolve => { resolveReport = resolve; }));
    let latch = new Set<string>();

    const propsA = (): React.ComponentProps<typeof PublicPlayerProfile> => ({
      publicPlayerId: "peer-a",
      reportUnknown: latch.has(reportUnknownScopeKey("viewer", "peer-a")),
      onReportUnknown: scope => { latch = new Set([...latch, scope]); },
    });
    renderProfile(propsA());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    hooks.cursor = 0;
    let tree = PublicPlayerProfile(propsA());
    activate(tree, "Пожаловаться");
    hooks.cursor = 0;
    tree = PublicPlayerProfile(propsA());
    const form = nodes(tree).find(n => n.type === "form")!;
    const pending = (form.props.onSubmit as (e: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} });

    // Radar games/collapse unmounts the body before the POST settles.
    hooks.cleanups.forEach(fn => fn?.());
    resetHooks();
    resolveReport({ ok: false, status: 503, error: "upstream" });
    await pending;
    expect(latch.has(reportUnknownScopeKey("viewer", "peer-a"))).toBe(true);
    expect(api.createAbuseReport).toHaveBeenCalledTimes(1);

    api.getMe.mockResolvedValue({ ok: true, status: 200, data: { id: "viewer", csrfToken: "csrf", displayName: "Viewer", locale: "ru", linkedProviders: [] } });
    api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: { ...player, publicPlayerId: "peer-b", displayName: "Другой" } });
    api.listCities.mockResolvedValue({ ok: true, status: 200, data: { items: [{ id: "city", nameRu: "Москва" }] } });
    api.createAbuseReport.mockResolvedValue({ ok: true, status: 200, data: {} });

    const propsB = (): React.ComponentProps<typeof PublicPlayerProfile> => ({
      publicPlayerId: "peer-b",
      reportUnknown: latch.has(reportUnknownScopeKey("viewer", "peer-b")),
      onReportUnknown: scope => { latch = new Set([...latch, scope]); },
    });
    // Other peer is not latched by peer-a's pending/unknown result.
    expect(propsB().reportUnknown).toBe(false);
    await openAndSubmit(propsB());
    expect(api.createAbuseReport).toHaveBeenCalledTimes(2);

    resetHooks();
    api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: { ...player, publicPlayerId: "peer-a", displayName: "Мария Л." } });
    api.createAbuseReport.mockResolvedValue({ ok: false, status: 0, error: "network" });
    await openAndSubmit(propsA());
    // Original peer keeps the unknown latch — no third POST.
    expect(api.createAbuseReport).toHaveBeenCalledTimes(2);
  });

  it("A 503 then B 503 retains both; A reopen + games/back does not POST again", async () => {
    let latch = new Set<string>();
    const addScope = (scope: string) => { latch = new Set([...latch, scope]); };
    const propsA = (): React.ComponentProps<typeof PublicPlayerProfile> => ({
      publicPlayerId: "peer-a",
      embedded: true,
      nearbyGamesAction: null,
      reportUnknown: latch.has(reportUnknownScopeKey("viewer", "peer-a")),
      onReportUnknown: addScope,
    });
    const propsB = (): React.ComponentProps<typeof PublicPlayerProfile> => ({
      publicPlayerId: "peer-b",
      embedded: true,
      nearbyGamesAction: null,
      reportUnknown: latch.has(reportUnknownScopeKey("viewer", "peer-b")),
      onReportUnknown: addScope,
    });

    api.createAbuseReport.mockResolvedValue({ ok: false, status: 503, error: "upstream" });
    await openAndSubmit(propsA());
    expect(api.createAbuseReport).toHaveBeenCalledTimes(1);
    expect(latch.has(reportUnknownScopeKey("viewer", "peer-a"))).toBe(true);

    // Collapse/remount A, then select B and report unknown.
    resetHooks();
    api.getMe.mockResolvedValue({ ok: true, status: 200, data: { id: "viewer", csrfToken: "csrf", displayName: "Viewer", locale: "ru", linkedProviders: [] } });
    api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: { ...player, publicPlayerId: "peer-b", displayName: "Другой" } });
    api.listCities.mockResolvedValue({ ok: true, status: 200, data: { items: [{ id: "city", nameRu: "Москва" }] } });
    await openAndSubmit(propsB());
    expect(api.createAbuseReport).toHaveBeenCalledTimes(2);
    expect(latch.has(reportUnknownScopeKey("viewer", "peer-a"))).toBe(true);
    expect(latch.has(reportUnknownScopeKey("viewer", "peer-b"))).toBe(true);

    // A reopen (games/back remount): still latched — no third POST. B remains protected.
    resetHooks();
    api.getPlayer.mockResolvedValue({ ok: true, status: 200, data: { ...player, publicPlayerId: "peer-a", displayName: "Мария Л." } });
    const tree = await openAndSubmit(propsA());
    expect(api.createAbuseReport).toHaveBeenCalledTimes(2);
    expect(propsA().reportUnknown).toBe(true);
    expect(propsB().reportUnknown).toBe(true);
    expect(renderToStaticMarkup(tree)).toContain("disabled");

    // Late A callback after B cannot erase B; unrelated pair stays usable.
    addScope(reportUnknownScopeKey("viewer", "peer-a"));
    expect(latch.has(reportUnknownScopeKey("viewer", "peer-b"))).toBe(true);
    expect(latch.has(reportUnknownScopeKey("viewer", "peer-c"))).toBe(false);
  });

  it("viewer/peer scope key does not transfer a latch to another pair", () => {
    expect(reportUnknownScopeKey("viewer", "peer")).not.toBe(reportUnknownScopeKey("other", "peer"));
    expect(reportUnknownScopeKey("viewer", "peer")).not.toBe(reportUnknownScopeKey("viewer", "other"));
  });
});
