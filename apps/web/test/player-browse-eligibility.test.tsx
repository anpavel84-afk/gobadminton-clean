import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type * as React from "react";
import type { OwnSocialProfile, PublicPlayer } from "../src/lib/consumer-types";
import type { PlayInterestView } from "@gobadminton/contracts/friendship-types";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as Array<(() => void) | undefined>,
}));

const apiMocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMySocialProfile: vi.fn(),
}));

const playInterestMocks = vi.hoisted(() => ({
  getPlayInterestStates: vi.fn(),
  getPlayInterestState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const ReactActual = await importOriginal<typeof React>();
  return {
    ...ReactActual,
    useState<T>(initial: T | (() => T)) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) {
        hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        hooks.slots[index] as T,
        (value: T | ((previous: T) => T)) => {
          hooks.slots[index] = typeof value === "function"
            ? (value as (previous: T) => T)(hooks.slots[index] as T)
            : value;
        },
      ];
    },
    useRef<T>(initial: T) {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index] as { current: T };
    },
    useMemo<T>(fn: () => T, deps: unknown[]) {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as { deps: unknown[]; value: T } | undefined;
      if (!prev || deps.some((value, i) => !Object.is(value, prev.deps[i]))) {
        hooks.slots[index] = { deps, value: fn() };
      }
      return (hooks.slots[index] as { value: T }).value;
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]) {
      const index = hooks.cursor++;
      const prev = hooks.slots[index] as { deps: unknown[]; fn: T } | undefined;
      if (!prev || deps.some((value, i) => !Object.is(value, prev.deps[i]))) {
        hooks.slots[index] = { deps, fn };
      }
      return (hooks.slots[index] as { fn: T }).fn;
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as unknown[] | undefined;
      const nextDeps = deps ?? [];
      if (!previous || nextDeps.some((value, i) => !Object.is(value, previous[i]))) {
        hooks.slots[index] = nextDeps;
        hooks.effects.push(() => {
          hooks.cleanups[index]?.();
          const cleanup = effect();
          hooks.cleanups[index] = typeof cleanup === "function" ? cleanup : undefined;
        });
      }
    },
  };
});

vi.mock("../src/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api-client")>();
  return {
    ...actual,
    getMe: apiMocks.getMe,
    getMySocialProfile: apiMocks.getMySocialProfile,
  };
});

vi.mock("../src/lib/play-interests", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/play-interests")>();
  return {
    ...actual,
    getPlayInterestStates: playInterestMocks.getPlayInterestStates,
    getPlayInterestState: playInterestMocks.getPlayInterestState,
  };
});

import { PlayerBrowseFinderGate } from "../src/components/consumer/players/PlayerBrowseOffers";
import {
  classifyFinderBatchEmpty,
  ownSocialFinderStatusFromProfile,
  usePlayerBrowseOffers,
  type FinderEligibility,
  type PlayerBrowseOffersApi,
} from "../src/components/consumer/players/usePlayerBrowseOffers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const offersHookSource = readFileSync(
  join(root, "src/components/consumer/players/usePlayerBrowseOffers.ts"),
  "utf8",
);
const offersUiSource = readFileSync(
  join(root, "src/components/consumer/players/PlayerBrowseOffers.tsx"),
  "utf8",
);

const baseProfile = (over: Partial<OwnSocialProfile> = {}): OwnSocialProfile => ({
  publicPlayerId: "own-1",
  version: 1,
  displayName: "Я",
  cityId: null,
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

const peer = (id: string, name = id): PublicPlayer => ({
  publicPlayerId: id,
  displayName: name,
  cityId: "city",
  areaKey: null,
  level: null,
  bio: null,
  trainer: false,
  lookingForGame: false,
});

const unavailableView: PlayInterestView = {
  interestId: null,
  relationship: "unavailable",
  version: null,
  capabilities: { canSend: false, canWithdraw: false },
};

const noneView: PlayInterestView = {
  interestId: null,
  relationship: "none",
  version: null,
  capabilities: { canSend: true, canWithdraw: false },
};

type OfferProps = Parameters<typeof usePlayerBrowseOffers>[0];

function resetHookFiber() {
  hooks.cleanups.forEach((fn) => fn?.());
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
}

function renderOffers(props: OfferProps): PlayerBrowseOffersApi {
  hooks.cursor = 0;
  hooks.effects = [];
  const api = usePlayerBrowseOffers(props);
  hooks.effects.splice(0).forEach((effect) => effect());
  return api;
}

/** Drive auth → own profile → capability batch through the real hooked effects. */
async function settleOffers(props: OfferProps, rounds = 24): Promise<PlayerBrowseOffersApi> {
  let api = renderOffers(props);
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
    await Promise.resolve();
    api = renderOffers(props);
  }
  return api;
}

describe("player browse eligibility · own profile gate (#438)", () => {
  it("delayed own profile stays loading — not exhausted — until social profile resolves", () => {
    expect(ownSocialFinderStatusFromProfile(null, false).status).toBe("error");
    expect(offersHookSource).toContain('ownSocialStatus === "loading"');
    expect(offersHookSource).toContain('setEligibilityKind("checking")');
    expect(offersHookSource).toMatch(/Auth may be ready before own social profile/);
    expect(offersHookSource).toContain("retireEligibilityBookkeeping()");
    expect(offersHookSource).toContain("ownSocialFinderStatusFromProfile");
    // Premature batch must not run while own gate is unresolved.
    expect(offersHookSource).toContain('ownSocialStatus !== "ready"');
    expect(offersHookSource).not.toMatch(/setAuthState\("ready"\);\s*const social = await getMySocialProfile/);
  });

  it("own private/hidden profile maps to prerequisite and blocks sends", () => {
    const hidden = ownSocialFinderStatusFromProfile(
      baseProfile({ directoryVisible: false }),
      true,
    );
    expect(hidden).toEqual({ status: "hidden", publicPlayerId: "own-1" });
    const ineligible = ownSocialFinderStatusFromProfile(
      baseProfile({ socialEligible: false }),
      true,
    );
    expect(ineligible.status).toBe("hidden");
    expect(offersHookSource).toContain("own_prerequisite");
    expect(offersHookSource).toContain('ownSocialStatus === "hidden"');
    expect(offersHookSource).toContain("admitSend");
    expect(offersHookSource).toMatch(/ownSocialStatus !== "ready"\) return false/);
    expect(offersUiSource).toContain("К настройкам профиля");
    expect(offersUiSource).toContain('href="/profile"');
    expect(offersUiSource).not.toContain("directoryVisible: true");
    const gate: FinderEligibility = {
      kind: "own_prerequisite",
      players: [],
      message: "В режиме «Свайп» предложения доступны, когда ваш профиль виден в каталоге.",
      canContinue: false,
    };
    const html = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, { eligibility: gate }));
    expect(html).toContain("Сначала откройте свой профиль");
    expect(html).toContain("К настройкам профиля");
    expect(html).not.toContain("Подборка по этим фильтрам закончилась");
  });

  it("own visible + eligible peers stay ready path; missing profile is retry error not empty", () => {
    expect(ownSocialFinderStatusFromProfile(baseProfile(), true)).toEqual({
      status: "ready",
      publicPlayerId: "own-1",
    });
    expect(ownSocialFinderStatusFromProfile(baseProfile({ publicPlayerId: null }), true).status).toBe("error");
    expect(offersHookSource).toContain("Не удалось загрузить профиль");
    expect(offersUiSource).toContain("Не удалось загрузить профиль");
    expect(offersUiSource).toContain("Повторить");
    const errGate: FinderEligibility = {
      kind: "error",
      players: [],
      message: "Не удалось загрузить профиль",
      canContinue: false,
    };
    const html = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, {
      eligibility: errGate,
      onRetry: () => undefined,
    }));
    expect(html).toContain("Не удалось загрузить профиль");
    expect(html).not.toContain("Подборка по этим фильтрам закончилась");
    expect(html).not.toContain("В этой части списка новых предложений нет");
  });

  it("all peers unavailable is not exhausted; outgoing/mutual still classify as end", () => {
    const unavailable = "unavailable" as PlayInterestView["relationship"];
    const outgoing = "outgoing" as PlayInterestView["relationship"];
    const mutual = "mutual" as PlayInterestView["relationship"];
    expect(classifyFinderBatchEmpty({
      hasMore: false,
      relationships: [unavailable, unavailable],
    })).toBe("peers_unavailable");
    expect(classifyFinderBatchEmpty({
      hasMore: true,
      relationships: [unavailable],
    })).toBe("peers_unavailable");
    expect(classifyFinderBatchEmpty({
      hasMore: false,
      relationships: [outgoing, mutual],
    })).toBe("exhausted");
    expect(classifyFinderBatchEmpty({
      hasMore: true,
      relationships: [outgoing, unavailable],
    })).toBe("empty_page");
    expect(offersHookSource).toContain("classifyFinderBatchEmpty");
    expect(offersHookSource).toContain("peers_unavailable");
    expect(offersUiSource).toContain("Сейчас нельзя предложить игру");
    const gate: FinderEligibility = {
      kind: "peers_unavailable",
      players: [],
      message: "Подходящие предложения временно недоступны.",
      canContinue: false,
    };
    const html = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, {
      eligibility: gate,
      onRetry: () => undefined,
      onContinue: () => undefined,
    }));
    expect(html).toContain("Сейчас нельзя предложить игру");
    expect(html).not.toContain("Продолжить поиск");
    expect(html).not.toContain("Подборка по этим фильтрам закончилась");
    expect(html).not.toMatch(/недоступен.*приват|скрыт.*игрок/i);
  });

  it("unavailable page with hasMore exposes Continue while keeping generic copy", () => {
    expect(offersHookSource).toMatch(
      /eligibilityKind === "empty_page" \|\| eligibilityKind === "peers_unavailable"/,
    );
    expect(offersUiSource).toContain("Продолжить поиск");
    const gate: FinderEligibility = {
      kind: "peers_unavailable",
      players: [],
      message: "Подходящие предложения временно недоступны.",
      canContinue: true,
    };
    const html = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, {
      eligibility: gate,
      onRetry: () => undefined,
      onContinue: () => undefined,
    }));
    expect(html).toContain("Сейчас нельзя предложить игру");
    expect(html).toContain("Подходящие предложения временно недоступны.");
    expect(html).toContain("Продолжить поиск");
    expect(html).toContain("Повторить");
  });

  it("preserves account-switch / UNKNOWN bookkeeping and does not invent privacy bypass", () => {
    const expire = offersHookSource.indexOf("const expire = () =>");
    expect(expire).toBeGreaterThan(-1);
    const expireBody = offersHookSource.slice(expire, expire + 1200);
    expect(expireBody).toContain("batchGen.current += 1");
    expect(expireBody).toContain('setEligibilityKind("guest")');
    expect(expireBody).toContain("setOwnPublicPlayerId(null)");
    expect(expireBody).toContain('setOwnSocialStatus("loading")');
    expect(offersHookSource).toContain("gb-session-changed");
    expect(offersHookSource).toContain("gb-private-expired");
    expect(offersHookSource).toContain("unresolvedRef.current.some");
    expect(offersHookSource).toContain("readValidatedPending");
    expect(offersHookSource).not.toContain("directoryVisible: true");
    expect(offersHookSource).not.toContain("putMySocialProfileVisibility");
    expect(offersUiSource).not.toContain("putMySocialProfileVisibility");
    // Error hold must not depend on eligibilityKind effect dependency (auto-retry loop).
    expect(offersHookSource).toContain("eligibilityKindRef");
    expect(offersHookSource).toContain('eligibilityKindRef.current === "error"');
    const effectDeps = offersHookSource.slice(
      offersHookSource.indexOf("void runBatch(unchecked,"),
      offersHookSource.indexOf("void runBatch(unchecked,") + 500,
    );
    expect(effectDeps).not.toMatch(/eligibleIds\.length,\s*eligibilityKind,/);
  });
});

describe("player browse eligibility · hooked effect flow (#438 repair)", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    resetHookFiber();
    storage.clear();
    vi.resetAllMocks();
    apiMocks.getMe.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: "actor-1",
        displayName: "Actor",
        locale: "ru",
        linkedProviders: [],
        csrfToken: "csrf",
      },
    });
    apiMocks.getMySocialProfile.mockResolvedValue({
      ok: true,
      status: 200,
      data: baseProfile(),
    });
    vi.stubGlobal("window", Object.assign(new EventTarget(), {}));
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
      get length() { return storage.size; },
      key: (index: number) => [...storage.keys()][index] ?? null,
    });
  });

  afterEach(() => {
    resetHookFiber();
    vi.unstubAllGlobals();
  });

  it("persistent 503 yields one capability batch with no automatic retry; explicit retry starts one new batch", async () => {
    playInterestMocks.getPlayInterestStates.mockResolvedValue({
      ok: false,
      status: 503,
      error: "unavailable",
    });
    const catalogPlayers = [peer("p1"), peer("p2")];
    const props: OfferProps = {
      finderActive: true,
      ordinaryScope: "scope-a",
      catalogPlayers,
      catalogState: "ready",
      hasMore: true,
      moreBusy: false,
      onLoadMore: () => undefined,
    };

    const afterFail = await settleOffers(props, 20);
    expect(playInterestMocks.getPlayInterestStates).toHaveBeenCalledTimes(1);
    expect(afterFail.eligibility.kind).toBe("error");
    expect(afterFail.eligibility.message).toContain("Не удалось проверить подборку");

    // Parent re-renders (new catalog array identity) must not auto-loop.
    const churnProps: OfferProps = { ...props, catalogPlayers: [...catalogPlayers] };
    const afterChurn = await settleOffers(churnProps, 12);
    expect(playInterestMocks.getPlayInterestStates).toHaveBeenCalledTimes(1);
    expect(afterChurn.eligibility.kind).toBe("error");

    afterChurn.retryEligibility();
    const afterRetry = await settleOffers(churnProps, 16);
    expect(playInterestMocks.getPlayInterestStates).toHaveBeenCalledTimes(2);
    expect(afterRetry.eligibility.kind).toBe("error");
  });

  it("unavailable first page with hasMore continues to an eligible next page via existing pagination", async () => {
    playInterestMocks.getPlayInterestStates.mockImplementation(async (ids: readonly string[]) => ({
      ok: true as const,
      status: 200,
      data: {
        items: ids.map((id) => (id.startsWith("next-") ? noneView : unavailableView)),
      },
    }));

    let catalogPlayers = [peer("page-a"), peer("page-b")];
    let hasMore = true;
    let moreBusy = false;
    const onLoadMore = vi.fn(() => {
      moreBusy = true;
    });

    const propsFor = (): OfferProps => ({
      finderActive: true,
      ordinaryScope: "scope-a",
      catalogPlayers,
      catalogState: moreBusy ? "loading" : "ready",
      hasMore,
      moreBusy,
      onLoadMore,
    });

    let api = await settleOffers(propsFor(), 20);
    expect(api.eligibility.kind).toBe("peers_unavailable");
    expect(api.eligibility.canContinue).toBe(true);
    expect(playInterestMocks.getPlayInterestStates).toHaveBeenCalledTimes(1);

    const gateHtml = renderToStaticMarkup(createElement(PlayerBrowseFinderGate, {
      eligibility: api.eligibility,
      onContinue: () => api.continueSearch(),
      onRetry: () => api.retryEligibility(),
    }));
    expect(gateHtml).toContain("Сейчас нельзя предложить игру");
    expect(gateHtml).toContain("Продолжить поиск");

    api.continueSearch();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    api = await settleOffers(propsFor(), 6);
    expect(api.eligibility.kind).toBe("checking");

    // Parent delivers next catalogue page (existing pagination callback contract).
    catalogPlayers = [...catalogPlayers, peer("next-c"), peer("next-d")];
    moreBusy = false;
    api = await settleOffers(propsFor(), 16);
    expect(playInterestMocks.getPlayInterestStates).toHaveBeenCalledTimes(2);
    expect(api.eligibility.kind).toBe("ready");
    expect(api.eligibility.players.map((p) => p.publicPlayerId)).toEqual(["next-c", "next-d"]);
  });
});
