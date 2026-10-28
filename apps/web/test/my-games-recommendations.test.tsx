import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../src/lib/consumer-types";
import {
  hideGameRecommendationPath,
  listGameRecommendations,
  recommendationsUiEnabled,
  withdrawGameRecommendationPath,
  type GameRecommendation,
  type GameRecommendationList,
  type GameRecommendationReceipt,
} from "../src/lib/game-recommendations";

vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "../src/lib/api-client";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", () => ({
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: T | ((previous: T) => T)) => {
      hooks.slots[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
    }];
  },
  useRef<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect(effect: () => unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = true;
      effect();
    }
  },
}));

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
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function renderMutation(scope = `${me.id}:game-rec:received`) {
  hooks.cursor = 0;
  return useSocialMutation<GameRecommendationReceipt>(scope, me.csrfToken, success, refresh);
}

const success = vi.fn();
const refresh = vi.fn();

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  storage.clear();
  vi.resetAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "same-rec-key" });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("FR-3B My Games recommendation mutations", () => {
  it("hide uses expectedVersion integer body and csrf/idempotency", async () => {
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
  });

  it("withdraw uses expectedVersion and records withdrawn outcome", async () => {
    const receipt: GameRecommendationReceipt = { id: item.id, version: 3, outcome: "withdrawn" };
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: receipt });
    renderMutation(`${me.id}:game-rec:sent`).run(withdrawGameRecommendationPath(item.id), { expectedVersion: item.version });
    await settle();
    expect(apiFetch).toHaveBeenCalledWith(withdrawGameRecommendationPath(item.id), expect.objectContaining({
      body: JSON.stringify({ expectedVersion: 2 }),
    }));
    expect(success).toHaveBeenCalledWith(receipt);
  });

  it("duplicate-safe same-key retry after unknown outcome does not invent a second key", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ ok: false, status: 0, error: "network" })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { id: item.id, version: 3, outcome: "hidden" } });
    const first = renderMutation();
    first.run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    first.run(hideGameRecommendationPath(item.id), { expectedVersion: 99 });
    await settle();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const pending = renderMutation();
    expect(pending.pending).toBe(true);
    pending.retry();
    await settle();
    expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(vi.mocked(apiFetch).mock.calls[0]);
    expect(success).toHaveBeenCalledOnce();
  });

  it("session/auth failure refreshes without success and without clearing only via absent list", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 401, error: "auth" });
    renderMutation().run(hideGameRecommendationPath(item.id), { expectedVersion: item.version });
    await settle();
    expect(refresh).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();
    expect(renderMutation().pending).toBe(false);
  });

  it("list encoding stays view-bound; empty list must not be treated as capability success when gated off", async () => {
    expect(recommendationsUiEnabled({
      friends: true, gameRecommendations: false, gameAttention: false, socialPush: false,
    })).toBe(false);
    vi.mocked(apiFetch).mockResolvedValue({ ok: true, status: 200, data: list });
    await listGameRecommendations("received");
    expect(apiFetch).toHaveBeenCalledWith("/v1/me/game-recommendations?view=received&limit=20");
    // Server may return rows while UI capability remains false — UI must still show unavailable.
    expect(list.items).toHaveLength(1);
    expect(recommendationsUiEnabled({
      friends: true, gameRecommendations: false, gameAttention: false, socialPush: false,
    })).toBe(false);
  });
});
