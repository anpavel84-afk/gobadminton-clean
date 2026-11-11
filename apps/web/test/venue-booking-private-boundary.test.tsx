import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import type { CourtBookingStatus, GameCourtBooking, ManagedGame, Me } from "../src/lib/consumer-types";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
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
          hooks.slots[index] =
            typeof value === "function"
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
    useMemo<T>(factory: () => T, deps?: readonly unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { deps: readonly unknown[]; value: T } | undefined;
      const nextDeps = deps ?? [];
      if (!previous || nextDeps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const value = factory();
        hooks.slots[index] = { deps: nextDeps, value };
        return value;
      }
      return previous.value;
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps?: readonly unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { deps: readonly unknown[]; value: T } | undefined;
      const nextDeps = deps ?? [];
      if (!previous || nextDeps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        hooks.slots[index] = { deps: nextDeps, value: fn };
        return fn;
      }
      return previous.value;
    },
  };
});

const mutation = vi.hoisted(() => ({
  busy: false,
  pending: false,
  notice: "",
  code: "",
  run: vi.fn(() => true),
  retry: vi.fn(),
  onSuccess: null as null | ((data: GameCourtBooking) => void),
  onRefresh: null as null | (() => void),
  storageKey: "" as string,
}));

vi.mock("../src/components/consumer/messages/useSocialMutation", () => ({
  useSocialMutation: (
    scope: string,
    _csrf: string,
    onSuccess: (data: GameCourtBooking) => void,
    onRefresh: () => void,
  ) => {
    mutation.onSuccess = onSuccess;
    mutation.onRefresh = onRefresh;
    mutation.storageKey = `gb-fr04-pending:${scope}`;
    return mutation;
  },
}));

vi.mock("../src/lib/api-client", () => ({
  getGameCourtBooking: vi.fn(),
  getMe: vi.fn(),
  getMyManagedGame: vi.fn(),
  listAllGameParticipations: vi.fn(),
  confirmParticipation: vi.fn(),
  rejectParticipation: vi.fn(),
  removeParticipation: vi.fn(),
  publishGame: vi.fn(),
}));

vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../src/components/consumer/Button", () => ({
  Button: (props: { children?: React.ReactNode }) => props.children ?? null,
}));
vi.mock("../src/components/consumer/games/GameDetailComposition", () => ({
  GameHero: ({ game }: { game: { title?: string } }) => game?.title ?? null,
  GameTerms: () => null,
  GameStatusBadge: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock("../src/components/consumer/games/GameCoverEditor", () => ({
  GameCoverEditor: () => null,
}));
vi.mock("../src/components/consumer/games/ManagerApplicants", () => ({
  ManagerApplicants: () => null,
}));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  AuthEntry: () => null,
}));
vi.mock("../src/lib/game-presentation", () => ({
  managedGameRelationLabel: () => "Создатель",
}));
vi.mock("../src/lib/game-results", () => ({
  resultsPath: (id: string) => `/my-games/${id}/results`,
}));

import {
  getGameCourtBooking,
  getMe,
  getMyManagedGame,
  listAllGameParticipations,
} from "../src/lib/api-client";
import { GameCourtBookingPanel } from "../src/components/consumer/games/GameCourtBooking";
import { OwnedGameSummaryPage } from "../src/components/consumer/pages/OwnedGameSummaryPage";

const gameId = "10000000-0000-4000-8000-000000000001";
const actorA = "actor-a";
const booking: GameCourtBooking = {
  gameId,
  status: "arranging" as CourtBookingStatus,
  version: 1,
  updatedAt: "2026-11-02T06:00:00.000Z",
  declarationSource: "organizer_declared",
  allowedActions: { canUpdate: true },
};
const me: Me = {
  id: actorA,
  csrfToken: "csrf-a",
  displayName: "Actor A",
  locale: "ru",
  linkedProviders: [],
};
const managed = {
  id: gameId,
  title: "Private court game",
  status: "published",
  startsAt: "2099-01-01T12:00:00.000Z",
  endsAt: "2099-01-01T14:00:00.000Z",
  timezone: "Europe/Moscow",
  applicationDeadlineAt: "2098-12-31T12:00:00.000Z",
  capacity: 4,
  confirmedCount: 1,
  externalReservedCount: 0,
  availablePlaces: 3,
  version: 2,
  visibility: "public",
  formatKey: "doubles",
  activityKind: "regular",
  trainer: null,
  trainingDescription: null,
  organizer: { id: actorA, displayName: "Host", publicContact: "telegram:@host" },
  venue: { id: "v", name: "Club", address: "Addr", cityId: "c", timezone: "Europe/Moscow" },
  levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0"] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "t" },
  management: { createdByMe: true, role: "owner" },
} as ManagedGame;

function resetHooks() {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
}

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const run of queued) run();
}

async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i += 1) {
    flushEffects();
    await Promise.resolve();
    hooks.cursor = 0;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

const memoryStore = new Map<string, string>();

beforeEach(() => {
  resetHooks();
  mutation.busy = false;
  mutation.pending = false;
  mutation.notice = "";
  mutation.code = "";
  mutation.onSuccess = null;
  mutation.onRefresh = null;
  mutation.storageKey = "";
  memoryStore.clear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    location: { search: "" },
  }));
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStore.set(key, value); },
    removeItem: (key: string) => { memoryStore.delete(key); },
    clear: () => { memoryStore.clear(); },
  });
  vi.mocked(getGameCourtBooking).mockReset();
  vi.mocked(getMe).mockReset();
  vi.mocked(getMyManagedGame).mockReset();
  vi.mocked(listAllGameParticipations).mockReset();
  vi.mocked(listAllGameParticipations).mockResolvedValue({ ok: true, status: 200, data: [] });
});

afterEach(() => {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.cleanups = [];
  memoryStore.clear();
  vi.unstubAllGlobals();
});

describe("#386 venue booking private boundary", () => {
  it("panel clears on gb-private-expired and ignores deferred GET + late PUT success", async () => {
    const pendingGet = deferred<{ ok: true; status: number; data: GameCourtBooking }>();
    vi.mocked(getGameCourtBooking).mockImplementationOnce(() => pendingGet.promise as never);

    hooks.cursor = 0;
    GameCourtBookingPanel({ gameId, meId: actorA, csrfToken: "csrf-a" });
    flushEffects();
    await settle(4);

    expect(vi.mocked(getGameCourtBooking)).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("gb-private-expired"));
    await settle(4);

    hooks.cursor = 0;
    expect(GameCourtBookingPanel({ gameId, meId: actorA, csrfToken: "csrf-a" })).toBeNull();

    pendingGet.resolve({ ok: true, status: 200, data: booking });
    await settle(6);
    hooks.cursor = 0;
    expect(GameCourtBookingPanel({ gameId, meId: actorA, csrfToken: "csrf-a" })).toBeNull();

    mutation.onSuccess?.(booking);
    await settle(2);
    hooks.cursor = 0;
    expect(GameCourtBookingPanel({ gameId, meId: actorA, csrfToken: "csrf-a" })).toBeNull();

    // UNKNOWN marker for same actor+game scope is not deleted by expiry clear.
    const key = `gb-fr04-pending:${actorA}:court-booking:${gameId}`;
    sessionStorage.setItem(key, JSON.stringify({
      path: `/v1/games/${gameId}/court-booking`,
      method: "PUT",
      key: "idem-preserved",
      body: { expectedVersion: 0, status: "arranging" },
    }));
    window.dispatchEvent(new Event("gb-session-changed"));
    await settle(2);
    expect(sessionStorage.getItem(key)).toContain("idem-preserved");
  });

  it("OwnedGameSummaryPage private-expired fences deferred getMe/getMyManagedGame without reload loop", async () => {
    const pendingMe = deferred<{ ok: true; status: number; data: Me }>();
    const pendingGame = deferred<{ ok: true; status: number; data: ManagedGame }>();
    vi.mocked(getMe).mockImplementation(() => pendingMe.promise as never);
    vi.mocked(getMyManagedGame).mockImplementation(() => pendingGame.promise as never);

    hooks.cursor = 0;
    OwnedGameSummaryPage({ gameId });
    flushEffects();
    await settle(4);

    expect(vi.mocked(getMe)).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("gb-private-expired"));
    await settle(4);

    // Must not start another getMe from private-expired (no reloadToken bump).
    expect(vi.mocked(getMe)).toHaveBeenCalledTimes(1);

    hooks.cursor = 0;
    let tree = OwnedGameSummaryPage({ gameId });
    expect(renderToStaticMarkup(tree)).toContain("Нужен вход");
    expect(renderToStaticMarkup(tree)).not.toContain("Private court game");

    pendingMe.resolve({ ok: true, status: 200, data: me });
    await settle(6);
    pendingGame.resolve({ ok: true, status: 200, data: managed });
    await settle(6);

    hooks.cursor = 0;
    tree = OwnedGameSummaryPage({ gameId });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Нужен вход");
    expect(html).not.toContain("Private court game");
    expect(html).not.toContain("Договорённость о корте");
  });

  it("OwnedGameSummaryPage session-changed reloads through existing path after clear", async () => {
    vi.mocked(getGameCourtBooking).mockResolvedValue({ ok: true, status: 200, data: booking });
    vi.mocked(getMe)
      .mockResolvedValueOnce({ ok: true, status: 200, data: me })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { ...me, id: "actor-b", csrfToken: "csrf-b" } });
    vi.mocked(getMyManagedGame)
      .mockResolvedValueOnce({ ok: true, status: 200, data: managed })
      .mockResolvedValueOnce({ ok: true, status: 200, data: null });

    hooks.cursor = 0;
    OwnedGameSummaryPage({ gameId });
    await settle(16);
    hooks.cursor = 0;
    expect(renderToStaticMarkup(OwnedGameSummaryPage({ gameId }))).toContain("Private court game");

    const callsBefore = vi.mocked(getMe).mock.calls.length;
    window.dispatchEvent(new Event("gb-session-changed"));
    // setReloadToken only takes effect on the next render pass (harness slots).
    hooks.cursor = 0;
    OwnedGameSummaryPage({ gameId });
    await settle(16);
    expect(vi.mocked(getMe).mock.calls.length).toBeGreaterThan(callsBefore);

    hooks.cursor = 0;
    const html = renderToStaticMarkup(OwnedGameSummaryPage({ gameId }));
    expect(html).not.toContain("Private court game");
    expect(html).toContain("Игра не в вашем списке управления");
  });
});
