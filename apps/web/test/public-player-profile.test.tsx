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

import { PublicPlayerProfile } from "../src/components/consumer/players/PublicPlayerProfile";
import { PublicPlayerProfilePage } from "../src/components/consumer/pages/PublicPlayerProfilePage";
import { PlayerProfileContent } from "../src/components/consumer/players/PlayerProfileContent";

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
