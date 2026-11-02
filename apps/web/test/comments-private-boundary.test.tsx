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
vi.mock("../src/components/consumer/Button", () => ({
  Button: (props: { children?: React.ReactNode }) => props.children ?? null,
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
  it("VenuePage private-expired fences deferred getMe without reload loop", async () => {
    const pendingMe = deferred<{ ok: true; status: number; data: Me }>();
    vi.mocked(getMe).mockImplementation(() => pendingMe.promise as never);

    hooks.cursor = 0;
    VenuePage({ venueId });
    flushEffects();
    await settle(4);

    expect(vi.mocked(getMe)).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("gb-private-expired"));
    await settle(4);

    // Must not start another getMe from private-expired (no meReload bump).
    expect(vi.mocked(getMe)).toHaveBeenCalledTimes(1);

    hooks.cursor = 0;
    VenuePage({ venueId });
    await settle(2);

    pendingMe.resolve({ ok: true, status: 200, data: me });
    await settle(6);

    hooks.cursor = 0;
    const tree = VenuePage({ venueId });
    // Late getMe must not restore me into comments after expiry.
    expect(renderToStaticMarkup(tree)).not.toContain("Ваш комментарий");
    expect(vi.mocked(getMe)).toHaveBeenCalledTimes(1);
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
