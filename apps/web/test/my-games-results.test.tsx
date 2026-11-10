import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type * as ReactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findOwnResultForGame,
  ownResultEndsAtBucket,
  ownResultsNotCoveredByGames,
  pendingOwnNotice,
  resultsPath,
} from "../src/lib/game-results";
import type { Game, ManagedGame, MeGameResultsPage } from "../src/lib/consumer-types";

const baseAttendance = {
  contextId: "10000000-0000-4000-8000-000000000011",
  value: "absent" as const,
  version: 1,
  late: false,
  assertion: {
    actorDisplay: "Ольга",
    source: "manager_explicit" as const,
    at: "2026-10-24T18:00:00.000Z",
  },
  acknowledgedVersion: null,
  dispute: null,
  displayName: "Анна",
  allowedActions: {
    canSetAttendance: false,
    canAcknowledge: true,
    canDispute: true,
    canWithdrawDispute: false,
  },
};

const ownItem = (
  gameId: string,
  over: Partial<MeGameResultsPage["items"][number]> = {},
): MeGameResultsPage["items"][number] => ({
  gameId,
  contextId: baseAttendance.contextId,
  gameTitle: "Субботний бадминтон",
  endsAt: "2026-10-24T17:00:00.000Z",
  attendance: baseAttendance,
  notice: {
    id: "10000000-0000-4000-8000-000000000021",
    attendanceVersion: 1,
    value: "absent",
    late: false,
    source: "manager_explicit",
    actorDisplay: "Ольга",
    createdAt: "2026-10-24T18:00:00.000Z",
    acknowledgedAt: null,
  },
  ...over,
});

describe("MyGames results notice discoverability", () => {
  it("counts only unacknowledged own notices", () => {
    const page: MeGameResultsPage = {
      items: [
        ownItem("10000000-0000-4000-8000-000000000001"),
        ownItem("10000000-0000-4000-8000-000000000002", {
          contextId: "10000000-0000-4000-8000-000000000012",
          gameTitle: "Другая",
          endsAt: null,
          attendance: {
            ...baseAttendance,
            contextId: "10000000-0000-4000-8000-000000000012",
            value: "present",
          },
          notice: {
            id: "10000000-0000-4000-8000-000000000022",
            attendanceVersion: 1,
            value: "present",
            late: false,
            source: "manager_explicit",
            actorDisplay: "Ольга",
            createdAt: "2026-10-24T19:00:00.000Z",
            acknowledgedAt: "2026-10-24T20:00:00.000Z",
          },
        }),
      ],
      nextCursor: null,
    };
    expect(pendingOwnNotice(page)).toBe(1);
    expect(pendingOwnNotice({ items: [], nextCursor: null })).toBe(0);
  });
});

describe("PG-4 own private history helpers", () => {
  it("keeps own results when public card game ids are missing and dedupes overlaps", () => {
    const a = ownItem("10000000-0000-4000-8000-000000000001");
    const b = ownItem("10000000-0000-4000-8000-000000000002", { gameTitle: "Вторая" });
    const covered = new Set(["10000000-0000-4000-8000-000000000001"]);
    expect(ownResultsNotCoveredByGames([a, b, b], covered)).toEqual([b]);
    expect(findOwnResultForGame([a, b], "10000000-0000-4000-8000-000000000002")).toBe(b);
    expect(findOwnResultForGame([a], "missing")).toBeUndefined();
  });

  it("buckets own endsAt for history without inventing attendance", () => {
    const now = Date.parse("2026-11-02T12:00:00.000Z");
    expect(ownResultEndsAtBucket("2026-10-24T17:00:00.000Z", now)).toBe("past");
    expect(ownResultEndsAtBucket("2026-12-01T17:00:00.000Z", now)).toBe("future");
    expect(ownResultEndsAtBucket(null, now)).toBe("unknown");
    expect(ownResultEndsAtBucket("not-a-date", now)).toBe("unknown");
  });

  it("links results feedback section without inventing attendance query", () => {
    expect(resultsPath("10000000-0000-4000-8000-000000000001")).toBe(
      "/my-games/10000000-0000-4000-8000-000000000001/results",
    );
    expect(resultsPath("10000000-0000-4000-8000-000000000001", "feedback")).toBe(
      "/my-games/10000000-0000-4000-8000-000000000001/results?section=feedback",
    );
  });
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
    useMemo<T>(factory: () => T) {
      return factory();
    },
  };
});

const nav = vi.hoisted(() => ({ search: "view=history" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href: string; children?: ReactNode; className?: string }) =>
      React.createElement("a", { href: props.href, className: props.className }, props.children),
  };
});

vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../src/components/consumer/games/GameRecommendationsSection", () => ({
  GameRecommendationsSection: () => null,
}));
vi.mock("../src/lib/messaging-api", () => ({
  listInvitations: vi.fn(), invitationPath: (id: string) => `/v1/invitations/${id}`,
}));
vi.mock("../src/components/consumer/games/PostgameReminders", () => ({
  usePostgameReminders: () => ({ items: [], loading: false, error: null, busyId: null, retry: vi.fn(), onLater: vi.fn() }),
  PostgameReminderActions: () => null,
}));

vi.mock("../src/components/consumer/games/GameReviewsHistory", () => ({
  GameReviewsHistory: () => null,
}));

vi.mock("../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
  getMe: vi.fn(),
  getGame: vi.fn(),
  listAllMyParticipations: vi.fn(),
  listAllMyManagedGames: vi.fn(),
  listMyGameResults: vi.fn(),
}));

import {
  apiFetch,
  getGame,
  getMe,
  listAllMyManagedGames,
  listAllMyParticipations,
  listMyGameResults,
} from "../src/lib/api-client";
import type { GameInvitation } from "../src/lib/messaging-types";
import { MutationNotice } from "../src/components/consumer/messages/MessageComposition";
import { listInvitations } from "../src/lib/messaging-api";
import { myGamesBucket, myGamesFilter, MyGamesInvitation, MyGamesPage } from "../src/components/consumer/pages/MyGamesPage";
import { GameRecommendationsSection } from "../src/components/consumer/games/GameRecommendationsSection";
import { OwnResultsHistoryCard, PersonalGameCard } from "../src/components/consumer/games/GameDetailComposition";

function walk(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  const composed = node.type === GameRecommendationsSection && typeof node.props.renderWithGames === "function"
    ? node.props.renderWithGames(new Map(), null)
    : null;
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(walk), ...walk(composed)];
}

function labelOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(labelOf).join("");
  if (isValidElement(node)) return labelOf((node.props as { children?: unknown }).children);
  return "";
}

function textOf(node: ReactNode): string {
  return walk(node).map((element) => labelOf(element.props.children)).join(" ");
}

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const entry of queued) entry.run();
}

function resetHooks() {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.cleanups = [];
}

function renderPage() {
  hooks.cursor = 0;
  return MyGamesPage();
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const participation = {
  id: "part-1",
  gameId: "10000000-0000-4000-8000-000000000001",
  userId: "actor-a",
  status: "withdrawn" as const,
  version: 1,
  attemptNumber: 1,
  requestedAt: "2026-10-01T00:00:00.000Z",
};

const unionGame: Game = {
  id: participation.gameId, version: 7, title: "44", status: "published", visibility: "public",
  activityKind: "regular", trainer: null, trainingDescription: null,
  organizer: { id: "organizer", displayName: "A", publicContact: "" },
  venue: { id: "venue", name: "Зал", cityId: "city", address: "Адрес", timezone: "Europe/Moscow" },
  startsAt: "2099-12-01T10:00:00Z", endsAt: "2099-12-01T12:00:00Z", timezone: "Europe/Moscow",
  applicationDeadlineAt: "2099-12-01T09:00:00Z", capacity: 8, externalReservedCount: 0, confirmedCount: 1, availablePlaces: 7,
  formatKey: "doubles", levelRule: { scaleId: "scale", scaleVersion: 1, allowedLevelIds: ["D"] },
  settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "Без оплаты" },
};
const unionInvite: GameInvitation = {
  id: "invite", gameId: participation.gameId, status: "pending", version: 3,
  inviterPublicPlayerId: "inviter", inviteePublicPlayerId: "recipient", expiresAt: "2099-12-01T09:00:00Z",
  decidedAt: null, participationId: null, createdAt: "2026-11-01T00:00:00Z",
};

beforeEach(() => {
  resetHooks();
  nav.search = "view=history";
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      addEventListener: EventTarget.prototype.addEventListener,
      removeEventListener: EventTarget.prototype.removeEventListener,
      dispatchEvent: EventTarget.prototype.dispatchEvent,
    }),
  );
  vi.mocked(listInvitations).mockResolvedValue({ ok: true, status: 200, data: { items: [], nextCursor: null } });
  vi.mocked(getMe).mockResolvedValue({
    ok: true,
    status: 200,
    data: { id: "actor-a", csrfToken: "csrf", displayName: "A", locale: "ru", linkedProviders: [] },
  });
  vi.mocked(listAllMyParticipations).mockResolvedValue({
    ok: true,
    status: 200,
    data: [participation],
  });
  vi.mocked(listAllMyManagedGames).mockResolvedValue({
    ok: true,
    status: 200,
    data: [],
  });
  vi.mocked(getGame).mockResolvedValue({
    ok: false,
    status: 404,
    error: "not found",
  });
});

afterEach(() => {
  resetHooks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PG-4 MyGames private history on public getGame 404", () => {
  it("renders OwnResultsHistoryCard content instead of only unavailable details", async () => {
    vi.mocked(listMyGameResults).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [ownItem("10000000-0000-4000-8000-000000000001")],
        nextCursor: null,
      },
    });
    renderPage();
    flushEffects();
    await settle();
    const tree = renderPage();
    flushEffects();
    const card = walk(tree).find((el) => el.type === OwnResultsHistoryCard);
    expect(card).toBeTruthy();
    expect((card!.props.item as { gameTitle: string }).gameTitle).toBe("Субботний бадминтон");
    const cardText = textOf(OwnResultsHistoryCard({ item: card!.props.item as never }));
    expect(cardText).toContain("Участники / Итоги");
    expect(cardText).toContain("Ждёт вашего ответа");
    expect(textOf(tree)).not.toContain("Детали игры недоступны");
  });

  it("OwnResultsHistoryCard surfaces server title/mark without inventing venue", () => {
    const markup = textOf(
      OwnResultsHistoryCard({ item: ownItem("10000000-0000-4000-8000-000000000001") }),
    );
    expect(markup).toContain("Субботний бадминтон");
    expect(markup).toContain("Не пришёл");
    expect(markup).not.toContain("Зал");
    expect(markup).not.toContain("соперник");
  });

  it("treats non-401 own-results failure as retryable error, not empty", async () => {
    vi.mocked(listMyGameResults).mockResolvedValue({
      ok: false,
      status: 500,
      error: "Сервер временно недоступен",
    });
    vi.mocked(listAllMyParticipations).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });
    renderPage();
    flushEffects();
    await settle();
    const tree = renderPage();
    flushEffects();
    const markup = textOf(tree);
    expect(markup).toContain("Не удалось загрузить: ваши итоги");
    expect(markup).toContain("Сервер временно недоступен");
    expect(markup).toContain("Обновить ваши итоги");
  });

  it("clears own results on session-changed and ignores deferred fetch", async () => {
    let resolveResults: (value: unknown) => void = () => undefined;
    vi.mocked(listMyGameResults).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResults = resolve as (value: unknown) => void;
        }) as never,
    );
    vi.mocked(listAllMyParticipations).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });
    renderPage();
    flushEffects();
    await settle();
    window.dispatchEvent(new Event("gb-session-changed"));
    await settle();
    resolveResults({
      ok: true,
      status: 200,
      data: { items: [ownItem("10000000-0000-4000-8000-000000000099")], nextCursor: null },
    });
    await settle();
    const markup = textOf(renderPage());
    expect(markup).not.toContain("Субботний бадминтон");
  });

  it("load-more preserves prior own rows and server cursor", async () => {
    const first = ownItem("10000000-0000-4000-8000-000000000001");
    const second = ownItem("10000000-0000-4000-8000-000000000002", {
      gameTitle: "Вторая встреча",
    });
    vi.mocked(listMyGameResults)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { items: [first], nextCursor: "cursor-2" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { items: [second], nextCursor: null },
      });
    vi.mocked(listAllMyParticipations).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });
    renderPage();
    flushEffects();
    await settle();
    let tree = renderPage();
    flushEffects();
    let cards = walk(tree).filter((el) => el.type === OwnResultsHistoryCard);
    expect(cards).toHaveLength(1);
    expect((cards[0]!.props.item as { gameTitle: string }).gameTitle).toBe("Субботний бадминтон");
    const more = walk(tree).find(
      (el) =>
        typeof el.props.onClick === "function" &&
        labelOf(el.props.children).includes("Показать ещё итоги"),
    );
    expect(more).toBeTruthy();
    (more!.props.onClick as () => void)();
    tree = renderPage();
    flushEffects();
    await settle();
    tree = renderPage();
    flushEffects();
    cards = walk(tree).filter((el) => el.type === OwnResultsHistoryCard);
    const titles = cards.map((el) => (el.props.item as { gameTitle: string }).gameTitle);
    expect(titles).toContain("Субботний бадминтон");
    expect(titles).toContain("Вторая встреча");
    expect(vi.mocked(listMyGameResults).mock.calls[1]?.[0]).toMatchObject({
      cursor: "cursor-2",
      limit: 20,
    });
  });

  it("confirmed + public 404 + past own endsAt leaves upcoming and stays once in history", async () => {
    const pastOwn = ownItem("10000000-0000-4000-8000-000000000001", {
      endsAt: "2026-10-24T17:00:00.000Z",
    });
    vi.mocked(listMyGameResults).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [pastOwn], nextCursor: null },
    });
    vi.mocked(listAllMyParticipations).mockResolvedValue({
      ok: true,
      status: 200,
      data: [{ ...participation, status: "confirmed" }],
    });

    nav.search = "";
    renderPage();
    flushEffects();
    await settle();
    const upcoming = renderPage();
    flushEffects();
    const upcomingMarkup = textOf(upcoming);
    expect(walk(upcoming).filter((el) => el.type === OwnResultsHistoryCard)).toHaveLength(1);
    expect(upcomingMarkup).toContain("Предстоящих игр пока нет.");
    expect(upcomingMarkup).toContain("Предстоящие");

    nav.search = "view=history";
    resetHooks();
    renderPage();
    flushEffects();
    await settle();
    const history = renderPage();
    flushEffects();
    const cards = walk(history).filter((el) => el.type === OwnResultsHistoryCard);
    expect(cards).toHaveLength(1);
    expect((cards[0]!.props.item as { gameId: string }).gameId).toBe(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(textOf(history)).toContain("История");
    expect(textOf(history)).toContain("Субботний бадминтон");
  });

  it("managed history does not leak orphan participant-only own results", async () => {
    nav.search = "tab=created&view=history";
    vi.mocked(listMyGameResults).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [ownItem("10000000-0000-4000-8000-000000000099", { gameTitle: "Чужое участие" })],
        nextCursor: null,
      },
    });
    vi.mocked(listAllMyManagedGames).mockResolvedValue({
      ok: true,
      status: 200,
      data: [],
    });
    renderPage();
    flushEffects();
    await settle();
    const tree = renderPage();
    flushEffects();
    const markup = textOf(tree);
    expect(markup).toContain("История");
    expect(markup).not.toContain("Чужое участие");
    expect(markup).not.toContain("own-results-orphan-history");
    expect(walk(tree).filter((el) => el.type === OwnResultsHistoryCard)).toHaveLength(0);
    expect(vi.mocked(listAllMyManagedGames)).toHaveBeenCalled();
  });
});


describe("#539 union and URL compatibility", () => {
  it("joins manager, participation, paginated invitations and own contexts into one card and one game fetch", async () => {
    vi.mocked(getGame).mockResolvedValue({ ok: true, status: 200, data: unionGame });
    vi.mocked(listAllMyManagedGames).mockResolvedValue({ ok: true, status: 200, data: [{ ...unionGame, management: { role: "manager", createdByMe: false } }] });
    vi.mocked(listAllMyParticipations).mockResolvedValue({ ok: true, status: 200, data: [{ ...participation, status: "confirmed" }] });
    vi.mocked(listInvitations)
      .mockResolvedValueOnce({ ok: true, status: 200, data: { items: [{ ...unionInvite, id: "old", status: "declined" }], nextCursor: "page2" } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { items: [unionInvite], nextCursor: null } });
    vi.mocked(listMyGameResults).mockResolvedValue({ ok: true, status: 200, data: { items: [ownItem(unionGame.id)], nextCursor: null } });
    renderPage(); flushEffects(); await settle(); await settle();
    const tree = renderPage(); flushEffects();
    const cards = walk(tree).filter((element) => element.type === PersonalGameCard);
    expect(cards).toHaveLength(1);
    expect(cards[0].props).toMatchObject({ owned: true, managementRelation: "Управляю", ownStatuses: ["confirmed"] });
    expect(walk(tree).filter((element) => element.type === MyGamesInvitation)).toHaveLength(2);
    expect(vi.mocked(listInvitations).mock.calls[1]).toEqual(["page2"]);
    expect(getGame).toHaveBeenCalledTimes(1);
  });

  it("private invitation cannot accept; decline UNKNOWN retains the Messages packet and key until explicit retry", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    vi.stubGlobal("crypto", { randomUUID: () => "immutable-key" });
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 500, error: "unknown" });
    const me = { id: "actor-a", csrfToken: "csrf", displayName: "A", locale: "ru", linkedProviders: [] };
    const render = () => { hooks.cursor = 0; return MyGamesInvitation({ invitation: unionInvite, game: null, me, changed: vi.fn() }); };
    let tree = render(); flushEffects();
    const accept = walk(tree).find((element) => labelOf(element.props.children) === "Принять приглашение");
    expect(accept?.props.disabled).toBe(true);
    const decline = walk(tree).find((element) => labelOf(element.props.children) === "Отклонить");
    expect(decline?.props.disabled).toBe(false);
    if (typeof decline?.props.onClick !== "function") throw new Error("Missing decline action");
    decline.props.onClick(); await settle();
    tree = render(); flushEffects();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get("gb-fr04-pending:actor-a:invitation:invite") ?? "null")).toEqual({ path: "/v1/invitations/invite/decline", body: { expectedVersion: 3 }, key: "immutable-key", method: "POST" });
    const notice = walk(tree).find((element) => element.type === MutationNotice);
    expect(notice?.props.mutation).toMatchObject({ pending: true });
    const mutation = notice?.props.mutation;
    if (!mutation || typeof mutation !== "object" || !("retry" in mutation) || typeof mutation.retry !== "function") throw new Error("Missing explicit retry");
    mutation.retry(); await settle();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(vi.mocked(apiFetch).mock.calls[0]);
  });

  it("defaults to all while retaining legacy manager entry and invalid query fallback", () => {
    expect(myGamesFilter(null, null)).toBe("all");
    expect(myGamesFilter(null, "created")).toBe("manage");
    expect(myGamesFilter("invites", "created")).toBe("invites");
    expect(myGamesFilter("invalid", "created")).toBe("all");
  });

  it("does not let a terminal participation hide active management, or an old draft become past", () => {
    const game: Game = { ...unionGame, endsAt: "2026-12-01T12:00:00Z" };
    const managed: ManagedGame = { ...game, management: { role: "manager", createdByMe: false } };
    const row = { id: "game", managed, parts: [participation], invites: [], own: [], reminders: [] };
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(myGamesBucket(row, game, now)).toBe("upcoming");
    expect(myGamesBucket({ ...row, managed: undefined }, game, now)).toBe("terminal");
    expect(myGamesBucket(row, { ...game, status: "draft", endsAt: "2020-01-01T12:00:00Z" }, now)).toBe("draft");
    expect(myGamesBucket({ ...row, managed: undefined, parts: [] }, null, now)).toBe("unknown");
  });
});
