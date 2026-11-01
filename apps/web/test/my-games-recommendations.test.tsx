import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import type { ApiResult } from "../src/lib/api-client";
import type { Me } from "../src/lib/consumer-types";
import {
  hideGameRecommendationPath,
  listGameRecommendations,
  readRecommendationPending,
  recommendationMutationScope,
  recommendationsUiEnabled,
  resetRecommendationPendingForTests,
  sendGameRecommendationPath,
  useGameRecommendationMutation,
  withdrawGameRecommendationPath,
  writeRecommendationPending,
  type GameRecommendation,
  type GameRecommendationList,
  type GameRecommendationReceipt,
} from "../src/lib/game-recommendations";

vi.mock("../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
  startAuth: vi.fn(),
  getMySocialProfile: vi.fn(),
}));
vi.mock("../src/lib/friendships", () => ({
  getSocialCapabilities: vi.fn(),
  listFriends: vi.fn(),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href: string; children?: ReactNode; className?: string }) =>
      React.createElement("a", { href: props.href, className: props.className }, props.children),
  };
});
vi.mock("../src/components/consumer/players/ProfileComposition", async () => {
  const React = await import("react");
  return {
    AuthChooser: (props: { returnPath: string }) =>
      React.createElement("div", { "data-auth-chooser": props.returnPath }),
    ProfileDialog: (props: { title: string; children: ReactNode; onClose: () => void }) =>
      React.createElement("div", { "data-profile-dialog": props.title }, props.children),
    ProfileState: (props: { title: string; children?: ReactNode }) =>
      React.createElement("section", { "data-profile-state": props.title }, props.children),
  };
});

import { apiFetch, getMySocialProfile } from "../src/lib/api-client";
import type { OwnSocialProfile } from "../src/lib/consumer-types";
import { getSocialCapabilities, listFriends } from "../src/lib/friendships";
import { GameRecommendationButton } from "../src/components/consumer/games/GameRecommendationButton";
import { GameRecommendationsSection } from "../src/components/consumer/games/GameRecommendationsSection";

const ownProfile = (over: Partial<OwnSocialProfile> = {}): OwnSocialProfile => ({
  publicPlayerId: "own-1",
  version: 1,
  displayName: "Я",
  cityId: "city",
  areaKey: null,
  level: null,
  bio: null,
  directoryVisible: true,
  contactPolicy: "requests",
  consentPolicyVersion: null,
  optedInAt: null,
  radarConsented: false,
  radarConsentPolicyVersion: null,
  radarConsentedAt: null,
  socialEligible: true,
  trainer: false,
  lookingForGame: null,
  ...over,
});

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<{ deps: unknown[] | undefined; run: () => void }>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof ReactModule>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) {
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        hooks.slots[index],
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index] as { current: T };
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as unknown[] | undefined;
      if (!prev || !deps || deps.some((value, offset) => value !== prev[offset])) {
        hooks.slots[index] = deps;
        hooks.effects.push({
          deps,
          run: () => {
            hooks.cleanups[index]?.();
            hooks.cleanups[index] = effect() || undefined;
          },
        });
      }
    },
  };
});

const me = { id: "actor-a", csrfToken: "csrf-a" } as Me;
const item: GameRecommendation = {
  id: "33333333-3333-4333-8333-333333333333",
  version: 2,
  state: "active",
  createdAt: "2026-10-28T10:00:00.000Z",
  expiresAt: "2026-10-29T18:00:00.000Z",
  game: {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Парная игра",
    startsAt: "2026-10-29T18:00:00.000Z",
    endsAt: "2026-10-29T20:00:00.000Z",
    timezone: "Europe/Moscow",
  },
  peer: {
    publicPlayerId: "55555555-5555-4555-8555-555555555555",
    displayName: "Борис П.",
  },
};
const list: GameRecommendationList = {
  items: [item],
  nextCursor: "next-page",
  asOf: "2026-10-28T10:00:00.000Z",
};
const storage = new Map<string, string>();
const sessionSet = vi.fn((key: string, value: string) => storage.set(key, value));
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const success = vi.fn();
const refresh = vi.fn();

function flushEffects() {
  const queued = hooks.effects.splice(0);
  queued.forEach((entry) => entry.run());
}

function resetHooks() {
  hooks.cleanups.forEach((fn) => fn?.());
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
}

function renderMutation(actorId = me.id, task = "game-rec:received", csrf = me.csrfToken) {
  hooks.cursor = 0;
  const mutation = useGameRecommendationMutation<GameRecommendationReceipt>(
    recommendationMutationScope(actorId, task),
    actorId,
    csrf,
    success,
    refresh,
  );
  flushEffects();
  return mutation;
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(elements)];
}

function labelOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelOf).join("");
  if (isValidElement(node)) return labelOf((node.props as { children?: unknown }).children);
  return "";
}

function activate(node: ReactNode, label: string) {
  const target = elements(node).find((el) => typeof el.props.onClick === "function" && labelOf(el.props.children).includes(label));
  expect(target, `missing control ${label}`).toBeTruthy();
  (target!.props.onClick as () => void)();
}

beforeEach(() => {
  resetHooks();
  resetRecommendationPendingForTests();
  storage.clear();
  sessionSet.mockClear();
  vi.resetAllMocks();
  success.mockReset();
  refresh.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => "same-rec-key" });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: sessionSet,
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { addEventListener: EventTarget.prototype.addEventListener, removeEventListener: EventTarget.prototype.removeEventListener }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
});
afterEach(() => {
  resetHooks();
  resetRecommendationPendingForTests();
  vi.unstubAllGlobals();
});

describe("FR-3B recommendation helper transport", () => {
  it("list encoding stays view-bound; empty list must not be treated as capability success when gated off", async () => {
    expect(recommendationsUiEnabled({
      friends: true, gameRecommendations: false, gameAttention: false, socialPush: false,
    })).toBe(false);
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: list });
    await listGameRecommendations("received");
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/game-recommendations?view=received&limit=20");
    expect(list.items).toHaveLength(1);
  });
});

describe("FR-3B in-memory recommendation mutation ownership", () => {
  it("hide uses expectedVersion and never writes personal ids to sessionStorage", async () => {
    const receipt: GameRecommendationReceipt = { id: item.id, version: 3, outcome: "hidden" };
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: receipt });
    renderMutation().run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    await settle();
    expect(apiFetch).toHaveBeenCalledWith(hideGameRecommendationPath(item.id), expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedVersion: 2 }),
      csrfToken: "csrf-a",
      headers: { "Idempotency-Key": "same-rec-key" },
    }));
    expect(success).toHaveBeenCalledWith(receipt);
    expect(sessionSet).not.toHaveBeenCalled();
    expect([...storage.keys()].some((key) => key.includes("pending"))).toBe(false);
  });

  it("withdraw uses expectedVersion and records withdrawn outcome", async () => {
    const receipt: GameRecommendationReceipt = { id: item.id, version: 3, outcome: "withdrawn" };
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: receipt });
    renderMutation(me.id, "game-rec:sent").run(withdrawGameRecommendationPath(item.id), { expectedVersion: item.version });
    await settle();
    expect(apiFetch).toHaveBeenCalledWith(withdrawGameRecommendationPath(item.id), expect.objectContaining({
      body: JSON.stringify({ expectedVersion: 2 }),
    }));
    expect(success).toHaveBeenCalledWith(receipt);
  });

  it("UNKNOWN keeps same key across remount; explicit retry only; no second fresh write", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ ok: false, status: 0, error: "network" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { id: item.id, version: 3, outcome: "hidden" } });
    const first = renderMutation();
    first.run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    first.run(hideGameRecommendationPath(item.id), { expectedVersion: 99 });
    await settle();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const scope = recommendationMutationScope(me.id, "game-rec:received");
    expect(readRecommendationPending(scope, me.id)?.key).toBe("same-rec-key");

    resetHooks();
    const remounted = renderMutation();
    expect(remounted.pending).toBe(true);
    remounted.run(hideGameRecommendationPath(item.id), { expectedVersion: 99 });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    remounted.retry();
    await settle();
    expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(vi.mocked(apiFetch).mock.calls[0]);
    expect(success).toHaveBeenCalledOnce();
    expect(readRecommendationPending(scope, me.id)).toBeNull();
  });

  it("late success after session change does not publish into the new owner", async () => {
    let resolveFetch!: (value: ApiResult<unknown>) => void;
    vi.mocked(apiFetch).mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const first = renderMutation();
    first.run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    await settle();
    window.dispatchEvent(new Event("gb-session-changed"));
    resetHooks();
    success.mockClear();
    const nextActor = renderMutation("actor-b", "game-rec:received", "csrf-b");
    expect(nextActor.pending).toBe(false);
    resolveFetch({ ok: true, status: 200, data: { id: item.id, version: 3, outcome: "hidden" } });
    await settle();
    expect(success).not.toHaveBeenCalled();
    expect(readRecommendationPending(recommendationMutationScope("actor-a", "game-rec:received"), "actor-a")).toBeNull();
  });

  it("auth failure refreshes without success and without inventing storage writes", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 401, error: "auth" });
    renderMutation().run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    await settle();
    expect(refresh).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();
    expect(renderMutation().pending).toBe(false);
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("rejected same-key replay after UNKNOWN keeps pending, offers reread, blocks fresh write", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ ok: false, status: 0, error: "network" })
      .mockResolvedValueOnce({ ok: false, status: 404, error: "gone" });
    const first = renderMutation();
    first.run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    await settle();
    const scope = recommendationMutationScope(me.id, "game-rec:received");
    expect(readRecommendationPending(scope, me.id)?.key).toBe("same-rec-key");
    expect(refresh).not.toHaveBeenCalled();

    first.retry();
    await settle();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(vi.mocked(apiFetch).mock.calls[0]);
    expect(readRecommendationPending(scope, me.id)?.key).toBe("same-rec-key");
    expect(readRecommendationPending(scope, me.id)?.body).toEqual({ expectedVersion: item.version });
    expect(refresh).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();

    resetHooks();
    const remounted = renderMutation();
    expect(remounted.pending).toBe(true);
    remounted.run(hideGameRecommendationPath(item.id), { expectedVersion: 99 });
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});

describe("FR-3B recommendation UI lifecycle", () => {
  it("send selection yields receipt notice without sessionStorage pending", async () => {
    vi.mocked(getSocialCapabilities).mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: true, gameRecommendations: true, gameAttention: false, socialPush: false },
    });
    vi.mocked(listFriends).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [{
          friendshipId: "11111111-1111-4111-8111-111111111111",
          relationship: "friends",
          version: "1",
          request: null,
          peer: {
            publicPlayerId: "22222222-2222-4222-8222-222222222222",
            displayName: "Анна К.",
            avatar: { uploadedUrl: null, providerUrl: null },
          },
          capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: true },
        }],
        nextCursor: null,
        asOf: "2026-10-28T10:00:00.000Z",
      },
    });
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: "rec-1", version: 1, outcome: "sent" } satisfies GameRecommendationReceipt,
    });

    hooks.cursor = 0;
    let tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();
    activate(tree, "Посоветовать другу");
    hooks.cursor = 0;
    tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();
    const radio = elements(tree).find((el) => el.type === "input" && el.props.type === "radio");
    expect(radio).toBeTruthy();
    (radio!.props.onChange as () => void)();
    hooks.cursor = 0;
    tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();
    activate(tree, "Отправить совет");
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();
    const htmlBits = elements(tree).map((el) => el.props.children).flat().join(" ");
    expect(htmlBits).toContain("Совет отправлен другу");
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("received hide goes through section action with expectedVersion", async () => {
    vi.mocked(getSocialCapabilities).mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: true, gameRecommendations: true, gameAttention: false, socialPush: false },
    });
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ ok: true, status: 200, data: list })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { id: item.id, version: 3, outcome: "hidden" } })
      .mockResolvedValue({ ok: true, status: 200, data: { ...list, items: [] } });

    hooks.cursor = 0;
    let tree = GameRecommendationsSection({ me });
    flushEffects();
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationsSection({ me });
    flushEffects();
    activate(tree, "Скрыть");
    await settle();
    expect(apiFetch).toHaveBeenCalledWith(hideGameRecommendationPath(item.id), expect.objectContaining({
      body: JSON.stringify({ expectedVersion: 2 }),
      headers: { "Idempotency-Key": "same-rec-key" },
    }));
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("sent withdraw goes through section action with expectedVersion", async () => {
    vi.mocked(getSocialCapabilities).mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: true, gameRecommendations: true, gameAttention: false, socialPush: false },
    });
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { ...list, items: [] } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: list })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { id: item.id, version: 3, outcome: "withdrawn" } })
      .mockResolvedValue({ ok: true, status: 200, data: { ...list, items: [] } });

    hooks.cursor = 0;
    let tree = GameRecommendationsSection({ me });
    flushEffects();
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationsSection({ me });
    flushEffects();
    activate(tree, "Вы советовали");
    hooks.cursor = 0;
    tree = GameRecommendationsSection({ me });
    flushEffects();
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationsSection({ me });
    flushEffects();
    activate(tree, "Отозвать совет");
    await settle();
    expect(apiFetch).toHaveBeenCalledWith(withdrawGameRecommendationPath(item.id), expect.objectContaining({
      body: JSON.stringify({ expectedVersion: 2 }),
    }));
  });

  it("guest open uses parent onLogin only — no local AuthChooser twin", () => {
    const onLogin = vi.fn();
    hooks.cursor = 0;
    let tree = GameRecommendationButton({ gameId: "g1", me: null, eligible: true, onLogin });
    flushEffects();
    activate(tree, "Посоветовать другу");
    expect(onLogin).toHaveBeenCalledOnce();
    hooks.cursor = 0;
    tree = GameRecommendationButton({ gameId: "g1", me: null, eligible: true, onLogin });
    flushEffects();
    expect(elements(tree).some((el) => el.props["data-auth-chooser"])).toBe(false);
  });

  it("unavailable copy stays plain; module pending survives absent list without erasure", () => {
    const scope = recommendationMutationScope(me.id, "game-rec:received");
    writeRecommendationPending(scope, {
      path: hideGameRecommendationPath(item.id),
      body: { expectedVersion: 2 },
      key: "same-rec-key",
      method: "POST",
      actorId: me.id,
    });
    expect(readRecommendationPending(scope, me.id)?.key).toBe("same-rec-key");
    expect(recommendationsUiEnabled({
      friends: true, gameRecommendations: false, gameAttention: false, socialPush: false,
    })).toBe(false);
    expect(readRecommendationPending(scope, me.id)?.key).toBe("same-rec-key");
  });

  it("gated-off capability with hidden own profile shows /profile prerequisite, not a false outage", async () => {
    vi.mocked(getSocialCapabilities).mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: false, gameRecommendations: false, gameAttention: false, socialPush: false },
    });
    vi.mocked(getMySocialProfile).mockResolvedValue({
      ok: true,
      status: 200,
      data: ownProfile({ version: 0, directoryVisible: false, socialEligible: false }),
    });

    hooks.cursor = 0;
    GameRecommendationsSection({ me });
    flushEffects();
    await settle();
    expect(getSocialCapabilities).toHaveBeenCalled();
    expect(getMySocialProfile).toHaveBeenCalled();
    hooks.cursor = 0;
    const tree = GameRecommendationsSection({ me });
    flushEffects();

    // Titles live on ProfileState props; labelOf only walks children (pass1 FAIL). Link stays a component node until render.
    expect(elements(tree).some((el) => el.props.title === "Сначала настройте свой профиль")).toBe(true);
    expect(labelOf(tree)).toContain("Открыть профиль");
    expect(elements(tree).some((el) => el.props.title === "Рекомендации сейчас недоступны")).toBe(false);
    expect(
      elements(tree).some(
        (el) => el.props.href === "/profile" && labelOf(el.props.children).includes("Открыть профиль"),
      ),
    ).toBe(true);
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => String(path).includes("/v1/me/game-recommendations"))).toBe(false);
  });

  it("gated-off capability with already-eligible own profile stays genuinely unavailable", async () => {
    vi.mocked(getSocialCapabilities).mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: true, gameRecommendations: false, gameAttention: false, socialPush: false },
    });
    vi.mocked(getMySocialProfile).mockResolvedValue({
      ok: true,
      status: 200,
      data: ownProfile({ version: 3, directoryVisible: true, socialEligible: true }),
    });

    hooks.cursor = 0;
    GameRecommendationsSection({ me });
    flushEffects();
    await settle();
    expect(getSocialCapabilities).toHaveBeenCalled();
    expect(getMySocialProfile).toHaveBeenCalled();
    hooks.cursor = 0;
    const tree = GameRecommendationsSection({ me });
    flushEffects();

    expect(elements(tree).some((el) => el.props.title === "Рекомендации сейчас недоступны")).toBe(true);
    expect(elements(tree).some((el) => el.props.title === "Сначала настройте свой профиль")).toBe(false);
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => String(path).includes("/v1/me/game-recommendations"))).toBe(false);
  });

  it("send recovery control GETs actor-owned sent recommendations, not friends", async () => {
    const scope = recommendationMutationScope(me.id, "recommend:g1");
    writeRecommendationPending(scope, {
      path: sendGameRecommendationPath("g1"),
      body: { friendshipId: "11111111-1111-4111-8111-111111111111" },
      key: "same-rec-key",
      method: "POST",
      actorId: me.id,
    });
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [], nextCursor: null, asOf: "2026-10-28T10:00:00.000Z" },
    });

    hooks.cursor = 0;
    let tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();
    expect(labelOf(tree)).toContain("Обновить свой список");
    expect(elements(tree).some((el) => el.props.href === "/my-games?rec=sent")).toBe(true);
    activate(tree, "Обновить свой список");
    hooks.cursor = 0;
    tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationButton({ gameId: "g1", me, eligible: true });
    flushEffects();

    expect(apiFetch).toHaveBeenCalledWith("/v1/me/game-recommendations?view=sent&limit=20");
    expect(listFriends).not.toHaveBeenCalled();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => String(path).startsWith("/v1/games/"))).toBe(false);
    expect(readRecommendationPending(scope, me.id)?.key).toBe("same-rec-key");
    expect(readRecommendationPending(scope, me.id)?.body).toEqual({
      friendshipId: "11111111-1111-4111-8111-111111111111",
    });
    expect(labelOf(tree)).toContain("не подтверждает и не опровергает отправку");
  });

  it("empty first page with nextCursor is not an empty inbox; continuation can yield items", async () => {
    vi.mocked(getSocialCapabilities).mockResolvedValue({
      ok: true,
      status: 200,
      data: { friends: true, gameRecommendations: true, gameAttention: false, socialPush: false },
    });
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { items: [], nextCursor: "page-2", asOf: "2026-10-28T10:00:00.000Z" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { items: [item], nextCursor: null, asOf: "2026-10-28T10:00:00.000Z" },
      });

    hooks.cursor = 0;
    let tree = GameRecommendationsSection({ me });
    flushEffects();
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationsSection({ me });
    flushEffects();
    expect(elements(tree).some((el) => el.props.title === "Пока нет советов")).toBe(false);
    expect(elements(tree).some((el) => el.props.title === "Проверяем доступные советы")).toBe(true);
    activate(tree, "Ещё");
    hooks.cursor = 0;
    tree = GameRecommendationsSection({ me });
    flushEffects();
    await settle();
    hooks.cursor = 0;
    tree = GameRecommendationsSection({ me });
    flushEffects();
    expect(labelOf(tree)).toContain("Парная игра");
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/game-recommendations?view=received&limit=20&cursor=page-2");
  });
});
