import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
import type { Me, Venue } from "../src/lib/consumer-types";
import type { EntityComment, EntityCommentPage } from "../src/lib/comments-types";

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
    useId() {
      return "comments-test-id";
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
  onSuccess: null as null | ((data: EntityComment, pending?: {
    path: string; method: string; body: object; key: string;
  }) => void),
  onRefresh: null as null | (() => void),
  options: null as null | {
    holdCorruptStorage?: boolean;
    validateSuccess?: (data: EntityComment, pending?: {
      path: string; method: string; body: object; key: string;
    }) => boolean;
    validatePending?: (pending: {
      path: string; method: string; body: object; key: string;
    }) => boolean;
  },
  storageKey: "" as string,
}));

vi.mock("../src/components/consumer/messages/useSocialMutation", () => ({
  useSocialMutation: (
    scope: string,
    _csrf: string,
    onSuccess: (data: EntityComment, pending?: {
      path: string; method: string; body: object; key: string;
    }) => void,
    onRefresh: () => void,
    _persist?: boolean,
    options?: typeof mutation.options,
  ) => {
    mutation.onSuccess = onSuccess;
    mutation.onRefresh = onRefresh;
    mutation.options = options ?? null;
    mutation.storageKey = `gb-fr04-pending:${scope}`;
    return mutation;
  },
}));

vi.mock("../src/lib/api-client", () => ({
  getMe: vi.fn(),
}));

vi.mock("../src/lib/comments-api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listEntityComments: vi.fn(),
  };
});

vi.mock("next/link", () => ({
  default: (props: { children?: React.ReactNode }) => props.children ?? null,
}));
vi.mock("../src/components/consumer/ConsumerShell", () => ({
  ConsumerShell: ({ children }: { children: React.ReactNode }) => children,
}));
const buttons = vi.hoisted(() => ({
  clicks: [] as Array<() => void>,
}));

vi.mock("../src/components/consumer/Button", () => ({
  Button: (props: { children?: React.ReactNode; onClick?: () => void }) => {
    if (typeof props.onClick === "function") buttons.clicks.push(props.onClick);
    return props.children ?? null;
  },
}));
vi.mock("../src/components/consumer/venues/VenueGallery", () => ({
  VenueGallery: () => null,
}));
vi.mock("../src/components/consumer/venues/VenuePublicProfile", () => ({
  VenuePublicProfile: () => null,
}));
vi.mock("../src/components/consumer/games/VenueSheet", () => ({
  VenuePublicContacts: () => null,
}));
vi.mock("../src/components/consumer/games/GamesMapView", () => ({
  GamesMapView: () => null,
}));
vi.mock("../src/lib/games-venue-map", () => ({
  gamesMapReturnPath: () => "/games?view=map",
}));
vi.mock("../src/components/consumer/messages/MessageComposition", () => ({
  MutationNotice: () => null,
}));
vi.mock("../src/components/consumer/players/ProfileComposition", () => ({
  AuthChooser: () => null,
  Avatar: () => null,
  ProfileDialog: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock("../src/components/consumer/messages/ConversationSafety", () => ({
  ConversationSafety: () => null,
}));

import { getMe } from "../src/lib/api-client";
import { listEntityComments } from "../src/lib/comments-api";
import { CommentsSection } from "../src/components/consumer/comments/CommentsSection";
import { VenuePage } from "../src/components/consumer/venues/VenuePage";

const venueId = "20000000-0000-4000-8000-000000000002";
const commentId = "30000000-0000-4000-8000-000000000003";
const otherCommentId = "30000000-0000-4000-8000-000000000099";
const actorA = "actor-a";
const me: Me = {
  id: actorA,
  csrfToken: "csrf-a",
  displayName: "Actor A",
  locale: "ru",
  linkedProviders: [],
};
const venue: Venue = {
  id: venueId,
  name: "Comments venue",
  address: "Synthetic",
  cityId: "city",
  timezone: "Europe/Moscow",
  latitude: 55.75,
  longitude: 37.62,
  dataStatus: "unverified",
  provenance: "owner",
  publicContacts: null,
};

const emptyPage: EntityCommentPage = {
  entityKind: "venue",
  entityId: venueId,
  parentCommentId: null,
  items: [],
  nextCursor: null,
  visibleCount: 0,
  canCreate: true,
};

const replyComment: EntityComment = {
  id: "40000000-0000-4000-8000-000000000004",
  entityKind: "venue",
  entityId: venueId,
  parentCommentId: commentId,
  body: "late reply from old actor",
  deleted: false,
  edited: false,
  version: 1,
  mine: true,
  createdAt: "2026-11-02T08:00:00.000Z",
  updatedAt: "2026-11-02T08:00:00.000Z",
  replyCount: 0,
  author: {
    displayName: "Old actor",
    publicPlayerId: "player-old",
    avatar: { uploadedUrl: null, providerUrl: null },
    profilePublic: true,
  },
};

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
  buttons.clicks = [];
  mutation.busy = false;
  mutation.pending = false;
  mutation.notice = "";
  mutation.code = "";
  mutation.onSuccess = null;
  mutation.onRefresh = null;
  mutation.options = null;
  mutation.storageKey = "";
  mutation.run.mockClear();
  memoryStore.clear();
  const win = new EventTarget() as EventTarget & {
    location: { search: string };
  };
  win.location = { search: "" };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    getElementById: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStore.set(key, value); },
    removeItem: (key: string) => { memoryStore.delete(key); },
    clear: () => { memoryStore.clear(); },
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => venue,
  })));
  vi.mocked(getMe).mockReset();
  vi.mocked(listEntityComments).mockReset();
  vi.mocked(listEntityComments).mockResolvedValue({ ok: true, status: 200, data: emptyPage });
});

afterEach(() => {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.cleanups = [];
  memoryStore.clear();
  vi.unstubAllGlobals();
});

describe("#394 comments private boundary", () => {
  it("hides prior actor page in render before effects on actor switch", async () => {
    const pageA: EntityCommentPage = {
      ...emptyPage,
      items: [{
        ...replyComment,
        id: commentId,
        parentCommentId: null,
        body: "actor-a blocked-filter body",
        mine: true,
        replyCount: 0,
      }],
      visibleCount: 7,
      canCreate: true,
    };
    const pageB: EntityCommentPage = {
      ...emptyPage,
      items: [{
        ...replyComment,
        id: otherCommentId,
        parentCommentId: null,
        body: "actor-b different block result",
        mine: false,
        replyCount: 0,
      }],
      visibleCount: 1,
      canCreate: true,
    };
    vi.mocked(listEntityComments).mockResolvedValue({ ok: true, status: 200, data: pageA });

    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(12);

    hooks.cursor = 0;
    let tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    expect(renderToStaticMarkup(tree)).toContain("actor-a blocked-filter body");
    expect(renderToStaticMarkup(tree)).toContain("7 комментариев");

    const meB: Me = {
      ...me,
      id: "actor-b",
      csrfToken: "csrf-b",
      displayName: "Actor B",
    };
    vi.mocked(listEntityComments).mockResolvedValue({ ok: true, status: 200, data: pageB });
    // Render under B before running effects — prior count/body/mine must not paint.
    hooks.effects = [];
    hooks.cursor = 0;
    tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me: meB,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    const htmlBeforeEffects = renderToStaticMarkup(tree);
    expect(htmlBeforeEffects).not.toContain("actor-a blocked-filter body");
    expect(htmlBeforeEffects).not.toContain("7 комментариев");
    expect(htmlBeforeEffects).not.toContain("Ваш комментарий");
    expect(hooks.effects.length).toBeGreaterThan(0);

    await settle(12);
    hooks.cursor = 0;
    tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me: meB,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    const htmlAfter = renderToStaticMarkup(tree);
    expect(htmlAfter).toContain("actor-b different block result");
    expect(htmlAfter).not.toContain("actor-a blocked-filter body");
  });

  it("guest me=null private-expired rejects stale GET and accepts fresh public read", async () => {
    const pendingOld = deferred<{ ok: true; status: number; data: EntityCommentPage }>();
    const pendingFresh = deferred<{ ok: true; status: number; data: EntityCommentPage }>();
    const pendingRetry = deferred<{ ok: true; status: number; data: EntityCommentPage }>();
    let wave = 0;
    vi.mocked(listEntityComments).mockImplementation(() => {
      wave += 1;
      if (wave === 1) return pendingOld.promise as never;
      if (wave === 2) return pendingFresh.promise as never;
      return pendingRetry.promise as never;
    });

    const guestProps = {
      kind: "venue" as const,
      entityId: venueId,
      me: null as Me | null,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    };

    hooks.cursor = 0;
    CommentsSection(guestProps);
    await settle(4);
    expect(wave).toBe(1);

    // Ordinary getMe 401 → private-expired while host me stays null.
    window.dispatchEvent(new Event("gb-private-expired"));
    // Re-render so guestReadEpoch dep schedules one bounded public reload.
    hooks.cursor = 0;
    CommentsSection(guestProps);
    await settle(8);
    expect(wave).toBeGreaterThanOrEqual(2);

    pendingOld.resolve({
      ok: true,
      status: 200,
      data: {
        ...emptyPage,
        items: [{ ...replyComment, body: "stale guest pre-expiry body", mine: false }],
        visibleCount: 3,
        canCreate: false,
      },
    });
    await settle(6);

    hooks.cursor = 0;
    let tree = CommentsSection(guestProps);
    expect(renderToStaticMarkup(tree)).not.toContain("stale guest pre-expiry body");
    expect(renderToStaticMarkup(tree)).not.toContain("3 комментариев");

    pendingFresh.resolve({
      ok: true,
      status: 200,
      data: {
        ...emptyPage,
        items: [{ ...replyComment, body: "fresh guest body", mine: false }],
        visibleCount: 1,
        canCreate: false,
      },
    });
    await settle(10);

    hooks.cursor = 0;
    tree = CommentsSection(guestProps);
    expect(renderToStaticMarkup(tree)).toContain("fresh guest body");
    expect(vi.mocked(getMe)).not.toHaveBeenCalled();

    // Sort (order slot) triggers a fresh public read under guest.
    const callsBeforeSort = vi.mocked(listEntityComments).mock.calls.length;
    // useState order is the second state slot (after authOpen).
    hooks.slots[1] = "desc";
    hooks.cursor = 0;
    CommentsSection(guestProps);
    await settle(10);
    expect(vi.mocked(listEntityComments).mock.calls.length).toBeGreaterThan(callsBeforeSort);
    expect(vi.mocked(listEntityComments).mock.calls.some((c) =>
      Boolean(c[2] && (c[2] as { order?: string }).order === "desc"))).toBe(true);

    // Force error then user retry without getMe / mutation replay.
    vi.mocked(listEntityComments).mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: null,
    } as never);
    hooks.slots[1] = "asc";
    hooks.cursor = 0;
    CommentsSection(guestProps);
    await settle(10);

    hooks.cursor = 0;
    tree = CommentsSection(guestProps);
    expect(renderToStaticMarkup(tree)).toContain("Не удалось загрузить комментарии");

    // User retry: another private-expired with me=null unchanged → bounded public refresh.
    vi.mocked(listEntityComments).mockImplementation(() => pendingRetry.promise as never);
    const callsBeforeRetry = vi.mocked(listEntityComments).mock.calls.length;
    window.dispatchEvent(new Event("gb-private-expired"));
    hooks.cursor = 0;
    CommentsSection(guestProps);
    await settle(8);
    expect(vi.mocked(listEntityComments).mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    pendingRetry.resolve({
      ok: true,
      status: 200,
      data: {
        ...emptyPage,
        items: [{ ...replyComment, body: "retry guest body", mine: false }],
        visibleCount: 1,
        canCreate: false,
      },
    });
    await settle(10);
    hooks.cursor = 0;
    tree = CommentsSection(guestProps);
    expect(renderToStaticMarkup(tree)).toContain("retry guest body");
    expect(vi.mocked(getMe)).not.toHaveBeenCalled();
    expect(mutation.run).not.toHaveBeenCalled();
  });

  it("VenuePage shows honest reviews placeholder without broad CommentsSection composer", async () => {
    vi.mocked(getMe).mockResolvedValue({ ok: true, status: 200, data: me });

    hooks.cursor = 0;
    VenuePage({ venueId });
    flushEffects();
    await settle(6);

    hooks.cursor = 0;
    const html = renderToStaticMarkup(VenuePage({ venueId }));
    expect(html).toContain("Отзывы после игр появятся здесь");
    expect(html).not.toContain("Ваш комментарий");
    expect(html).not.toContain("Войдите, чтобы оставить комментарий");
    expect(html).not.toContain("напишите");
    expect(html).not.toMatch(/canCreate|eligibility|Можно поделиться/i);
    // VenuePage no longer mounts session-bound comments me path.
    expect(vi.mocked(getMe)).not.toHaveBeenCalled();
    expect(vi.mocked(listEntityComments)).not.toHaveBeenCalled();
  });

  it("CommentsSection ignores late replies and mutation success after session/expiry fence", async () => {
    const pendingReplies = deferred<{ ok: true; status: number; data: EntityCommentPage }>();
    const rootPage: EntityCommentPage = {
      ...emptyPage,
      items: [{
        ...replyComment,
        id: commentId,
        parentCommentId: null,
        body: "root",
        replyCount: 1,
        mine: true,
      }],
      visibleCount: 2,
    };
    vi.mocked(listEntityComments).mockImplementation((_kind, _id, query) => {
      if (query && "parentCommentId" in query && query.parentCommentId) {
        return pendingReplies.promise as never;
      }
      return Promise.resolve({ ok: true, status: 200, data: rootPage }) as never;
    });

    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(12);

    hooks.cursor = 0;
    let tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    expect(renderToStaticMarkup(tree)).toContain("root");

    const validMinePending = {
      path: `/v1/venues/${venueId}/comments`,
      method: "POST",
      key: "idem-valid",
      body: { text: "mine ok", parentCommentId: null as string | null },
    };
    const validMineBody: EntityComment = {
      ...replyComment,
      id: commentId,
      parentCommentId: null,
      body: "mine ok",
      mine: true,
      replyCount: 0,
    };
    // Live session: captured validateSuccess accepts matching mine 2xx.
    expect(mutation.options?.validateSuccess?.(validMineBody, validMinePending)).toBe(true);

    // Invoke loadReplies through the real mutation-success handler (parentCommentId branch).
    mutation.onSuccess?.({
      ...replyComment,
      body: "ack before fence",
    }, {
      path: `/v1/venues/${venueId}/comments`,
      method: "POST",
      key: "idem-start",
      body: { text: "ack before fence", parentCommentId: commentId },
    });
    await settle(4);
    expect(vi.mocked(listEntityComments).mock.calls.some((c) =>
      Boolean(c[2] && (c[2] as { parentCommentId?: string }).parentCommentId === commentId))).toBe(true);

    window.dispatchEvent(new Event("gb-private-expired"));
    await settle(4);

    // Expiry: validateSuccess must reject before shared-hook settlement (not only onSuccess hide).
    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    expect(mutation.options?.validateSuccess?.(validMineBody, validMinePending)).toBe(false);

    pendingReplies.resolve({
      ok: true,
      status: 200,
      data: {
        ...emptyPage,
        parentCommentId: commentId,
        items: [{ ...replyComment, body: "late reply from old actor" }],
        visibleCount: 1,
      },
    });
    await settle(6);

    const late: EntityComment = { ...replyComment, body: "should not paint" };
    mutation.onSuccess?.(late, {
      path: `/v1/venues/${venueId}/comments`,
      method: "POST",
      key: "idem-old",
      body: { text: "should not paint", parentCommentId: commentId },
    });
    await settle(4);

    hooks.cursor = 0;
    tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain("should not paint");
    expect(html).not.toContain("late reply from old actor");
    expect(html).not.toContain("ack before fence");

    // UNKNOWN marker for same actor+entity scope is not deleted by expiry clear.
    const key = `gb-fr04-pending:comments:venue:${venueId}:${actorA}`;
    sessionStorage.setItem(key, JSON.stringify({
      path: `/v1/comments/${commentId}`,
      method: "PUT",
      key: "idem-preserved",
      body: { text: "held", expectedVersion: 1 },
    }));
    window.dispatchEvent(new Event("gb-private-expired"));
    await settle(2);
    expect(sessionStorage.getItem(key)).toContain("idem-preserved");
    // Second expiry event: settlement fence still rejects valid mine 2xx.
    expect(mutation.options?.validateSuccess?.(validMineBody, validMinePending)).toBe(false);

    // Session-changed: same fence — validateSuccess false while me.id prop unchanged.
    window.dispatchEvent(new Event("gb-session-changed"));
    await settle(2);
    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    expect(mutation.options?.validateSuccess?.(validMineBody, validMinePending)).toBe(false);

    // Same actor + new CSRF: reactivate fresh public read; old pre-boundary reply closure rejected.
    const callsBeforeReauth = vi.mocked(listEntityComments).mock.calls.length;
    const meReauth: Me = { ...me, csrfToken: "csrf-a-rotated" };
    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me: meReauth,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(12);
    expect(vi.mocked(listEntityComments).mock.calls.length).toBeGreaterThan(callsBeforeReauth);
    expect(mutation.options?.validateSuccess?.(validMineBody, validMinePending)).toBe(true);

    const pendingOldCsrfReplies = deferred<{ ok: true; status: number; data: EntityCommentPage }>();
    vi.mocked(listEntityComments).mockImplementation((_kind, _id, query) => {
      if (query && "parentCommentId" in query && query.parentCommentId) {
        return pendingOldCsrfReplies.promise as never;
      }
      return Promise.resolve({ ok: true, status: 200, data: rootPage }) as never;
    });
    // Mount under prior csrf, start reply GET, then rotate csrf while in flight.
    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(8);
    mutation.onSuccess?.({
      ...replyComment,
      body: "trigger replies old csrf",
    }, {
      path: `/v1/venues/${venueId}/comments`,
      method: "POST",
      key: "idem-old-csrf-replies",
      body: { text: "trigger replies old csrf", parentCommentId: commentId },
    });
    await settle(2);
    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me: meReauth,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(8);
    pendingOldCsrfReplies.resolve({
      ok: true,
      status: 200,
      data: {
        ...emptyPage,
        parentCommentId: commentId,
        items: [{ ...replyComment, body: "stale pre-csrf-boundary reply" }],
        visibleCount: 1,
      },
    });
    await settle(6);
    hooks.cursor = 0;
    tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me: meReauth,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    expect(renderToStaticMarkup(tree)).not.toContain("stale pre-csrf-boundary reply");
  });

  it("own comment menu hides Edit/Delete when canCreate=false; allowed still shows", async () => {
    const ownBody = "restricted own body stays readable";
    const restrictedPage: EntityCommentPage = {
      ...emptyPage,
      items: [{
        ...replyComment,
        id: commentId,
        parentCommentId: null,
        body: ownBody,
        replyCount: 0,
        mine: true,
      }],
      visibleCount: 1,
      canCreate: false,
    };
    const allowedPage: EntityCommentPage = {
      ...restrictedPage,
      canCreate: true,
    };
    vi.mocked(listEntityComments).mockResolvedValue({ ok: true, status: 200, data: restrictedPage });

    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(12);

    // menuFor is the 15th useState slot (0-based index 14) in CommentsSection.
    hooks.slots[14] = commentId;
    hooks.cursor = 0;
    let tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    let html = renderToStaticMarkup(tree);
    expect(html).toContain(ownBody);
    expect(html).toContain("Чтение доступно. Отправка комментариев сейчас недоступна.");
    expect(html).not.toContain("Изменить");
    expect(html).not.toContain("Удалить");
    expect(html).not.toContain("Ваш комментарий");

    vi.mocked(listEntityComments).mockResolvedValue({ ok: true, status: 200, data: allowedPage });
    // Force reload under allowed canCreate (order flip triggers fetch via effect).
    hooks.slots[1] = "desc";
    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(12);

    hooks.slots[14] = commentId;
    hooks.cursor = 0;
    tree = CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    html = renderToStaticMarkup(tree);
    expect(html).toContain(ownBody);
    expect(html).toContain("Изменить");
    expect(html).toContain("Удалить");
    expect(html).toContain("Ваш комментарий");
  });

  it("PUT/DELETE validateSuccess binds exact pending.path comment id", async () => {
    hooks.cursor = 0;
    CommentsSection({
      kind: "venue",
      entityId: venueId,
      me,
      parentPublic: true,
      authReturnPath: `/venues/${venueId}`,
      description: "Вопросы о площадке",
    });
    await settle(8);

    expect(mutation.options?.holdCorruptStorage).toBe(true);
    const validate = mutation.options?.validateSuccess;
    expect(validate).toBeTypeOf("function");

    const matching: EntityComment = {
      ...replyComment,
      id: commentId,
      parentCommentId: null,
      body: "edited",
      version: 2,
      edited: true,
      mine: true,
    };
    expect(validate?.(matching, {
      path: `/v1/comments/${commentId}`,
      method: "PUT",
      key: "k1",
      body: { text: "edited", expectedVersion: 1 },
    })).toBe(true);

    // Unrelated comment id with same version/body must not resolve UNKNOWN.
    expect(validate?.({ ...matching, id: otherCommentId }, {
      path: `/v1/comments/${commentId}`,
      method: "PUT",
      key: "k1",
      body: { text: "edited", expectedVersion: 1 },
    })).toBe(false);

    expect(validate?.({
      ...matching,
      deleted: true,
      body: null,
      version: 2,
    }, {
      path: `/v1/comments/${otherCommentId}`,
      method: "DELETE",
      key: "k2",
      body: { expectedVersion: 1 },
    })).toBe(false);

    expect(validate?.({
      ...matching,
      id: commentId,
      deleted: true,
      body: null,
      version: 2,
    }, {
      path: `/v1/comments/${commentId}`,
      method: "DELETE",
      key: "k2",
      body: { expectedVersion: 1 },
    })).toBe(true);
  });
});
