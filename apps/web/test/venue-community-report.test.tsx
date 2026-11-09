/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../src/lib/consumer-types";
import type { EntityCommentPage } from "../src/lib/comments-types";
import type * as ApiClientModule from "../src/lib/api-client";
import type * as CommentsApiModule from "../src/lib/comments-api";
import type * as VenueCommunityApiModule from "../src/lib/venue-community-api";

const VENUE_ID = "10000000-0000-4000-8000-000000000001";
const COMMENT_ID = "20000000-0000-4000-8000-000000000001";
const ACTOR_A = "30000000-0000-4000-8000-000000000001";
const ACTOR_B = "30000000-0000-4000-8000-000000000002";
const CSRF_A = "csrf-token-actor-a-exact-memory-value";
const CSRF_B = "csrf-token-actor-b-exact-memory-value";

const transport = vi.hoisted(() => ({
  calls: [] as Array<{
    path: string;
    method?: string;
    body?: unknown;
    csrfToken?: string;
    idempotencyKey?: string;
  }>,
  handler: null as null | ((
    path: string,
    init?: RequestInit & { csrfToken?: string },
  ) => Promise<unknown> | unknown),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("../src/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    apiFetch: async (path: string, init: RequestInit & { csrfToken?: string } = {}) => {
      const headers = new Headers(init.headers);
      const rawBody = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
      transport.calls.push({
        path,
        method: init.method,
        body: rawBody,
        csrfToken: init.csrfToken,
        idempotencyKey: headers.get("Idempotency-Key") ?? undefined,
      });
      if (!transport.handler) {
        return { ok: false, status: 503, error: "missing handler" };
      }
      return transport.handler(path, init);
    },
  };
});

vi.mock("../src/lib/comments-api", async (importOriginal) => {
  const actual = await importOriginal<typeof CommentsApiModule>();
  return {
    ...actual,
    listEntityComments: vi.fn(async () => ({
      ok: true,
      status: 200,
      data: {
        entityKind: "venue",
        entityId: VENUE_ID,
        parentCommentId: null,
        items: [
          {
            id: COMMENT_ID,
            entityKind: "venue",
            entityId: VENUE_ID,
            parentCommentId: null,
            body: "Где вход в зал?",
            deleted: false,
            version: 2,
            createdAt: "2026-11-08T12:00:00.000Z",
            updatedAt: "2026-11-08T12:00:00.000Z",
            edited: false,
            mine: false,
            author: {
              publicPlayerId: "40000000-0000-4000-8000-000000000001",
              displayName: "Участник",
              avatar: { uploadedUrl: null, providerUrl: null },
              profilePublic: true,
            },
            replyCount: 0,
          },
          {
            id: "20000000-0000-4000-8000-000000000099",
            entityKind: "venue",
            entityId: VENUE_ID,
            parentCommentId: null,
            body: null,
            deleted: true,
            version: 3,
            createdAt: "2026-11-08T11:00:00.000Z",
            updatedAt: "2026-11-08T11:30:00.000Z",
            edited: false,
            mine: false,
            author: null,
            replyCount: 0,
          },
        ],
        nextCursor: null,
        visibleCount: 1,
        canCreate: true,
      } satisfies EntityCommentPage,
    })),
  };
});

vi.mock("../src/lib/venue-community-api", async (importOriginal) => {
  const actual = await importOriginal<typeof VenueCommunityApiModule>();
  return {
    ...actual,
    fetchCommunitySummaries: vi.fn(async () => ({
      items: [{
        venueId: VENUE_ID,
        canonicalVenueId: VENUE_ID,
        average: 4.2,
        count: 5,
        state: "available" as const,
      }],
    })),
    fetchOwnCommunityRating: vi.fn(async () => ({
      own: {
        venueId: VENUE_ID,
        canonicalVenueId: VENUE_ID,
        value: 4,
        version: 3,
        withdrawn: false,
        moderationState: "clear" as const,
        allowedActions: { upsert: true, update: true, withdraw: true },
      },
      summary: {
        venueId: VENUE_ID,
        canonicalVenueId: VENUE_ID,
        average: 4.2,
        count: 5,
        state: "available" as const,
      },
    })),
  };
});

function polyfillDialog() {
  if (typeof HTMLDialogElement === "undefined") return;
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
}

function me(actorId: string, csrf: string): Me {
  return {
    id: actorId,
    displayName: "Тест",
    locale: "ru",
    linkedProviders: [],
    csrfToken: csrf,
  };
}

async function openAggregateDialog(actorId: string, csrf: string) {
  const { VenueCommunityRating } = await import(
    "../src/components/consumer/venues/VenueCommunityRating"
  );
  const view = render(
    createElement(VenueCommunityRating, {
      venueId: VENUE_ID,
      signedIn: true,
      actorId,
      csrfToken: csrf,
      authReturnPath: `/venues/${VENUE_ID}`,
    }),
  );
  await screen.findByText("4,2");
  fireEvent.click(screen.getByTestId("venue-community-report-aggregate"));
  await screen.findByLabelText("Пожаловаться на сводку оценок");
  return view;
}

describe("#507 I1 F3 consumer venue_community report UI", () => {
  beforeEach(() => {
    polyfillDialog();
    transport.calls = [];
    transport.handler = null;
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("posts aggregate payload through /v1/reports without inventing fields", async () => {
    transport.handler = async () => ({
      ok: true,
      status: 201,
      data: {
        reportId: "50000000-0000-4000-8000-000000000001",
        status: "submitted",
        createdAt: "2026-11-08T14:00:00.000Z",
      },
    });
    await openAggregateDialog(ACTOR_A, CSRF_A);
    fireEvent.change(screen.getByTestId("venue-community-report-detail"), {
      target: { value: "Подозрительная сводка" },
    });
    const countBefore = screen.getByText(/5 оценок/);
    expect(countBefore).toBeTruthy();
    fireEvent.click(screen.getByTestId("venue-community-report-submit"));
    await screen.findByTestId("venue-community-report-success");
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({
      path: "/v1/reports",
      method: "POST",
      csrfToken: CSRF_A,
      body: {
        targetKind: "venue_community",
        subjectKind: "aggregate",
        venueId: VENUE_ID,
        reasonCode: "inappropriate",
        detail: "Подозрительная сводка",
      },
    });
    expect(transport.calls[0]?.body).not.toHaveProperty("commentId");
    expect(transport.calls[0]?.body).not.toHaveProperty("expectedVersion");
    expect(transport.calls[0]?.body).not.toHaveProperty("voteId");
    expect(transport.calls[0]?.idempotencyKey).toBeTruthy();
    expect(screen.getByText(/5 оценок/)).toBeTruthy();
    expect(screen.queryByText("Жалоба отправлена.")).toBeNull();
  });

  it("posts own_vote with exact current version and keeps withheld value reportable", async () => {
    const api = await import("../src/lib/venue-community-api");
    vi.mocked(api.fetchOwnCommunityRating).mockResolvedValueOnce({
      own: {
        venueId: VENUE_ID,
        canonicalVenueId: VENUE_ID,
        value: 2,
        version: 7,
        withdrawn: false,
        moderationState: "withheld",
        allowedActions: { upsert: true, update: true, withdraw: true },
      },
      summary: {
        venueId: VENUE_ID,
        canonicalVenueId: VENUE_ID,
        average: 4.2,
        count: 5,
        state: "available",
      },
    });
    transport.handler = async () => ({
      ok: true,
      status: 201,
      data: {
        reportId: "50000000-0000-4000-8000-000000000002",
        status: "submitted",
        createdAt: "2026-11-08T14:00:00.000Z",
      },
    });
    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );
    render(
      createElement(VenueCommunityRating, {
        venueId: VENUE_ID,
        signedIn: true,
        actorId: ACTOR_A,
        csrfToken: CSRF_A,
        authReturnPath: `/venues/${VENUE_ID}`,
      }),
    );
    await screen.findByText("Оценка снята с публичной сводки");
    fireEvent.click(screen.getByTestId("venue-community-report-own-vote"));
    await screen.findByLabelText("Пожаловаться на свою оценку");
    fireEvent.click(screen.getByTestId("venue-community-report-submit"));
    await screen.findByTestId("venue-community-report-success");
    expect(transport.calls[0]?.body).toEqual({
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId: VENUE_ID,
      expectedVersion: 7,
      reasonCode: "inappropriate",
      detail: null,
    });
  });

  it("posts venue_comment with selected commentId+version; tombstone has no report", async () => {
    transport.handler = async () => ({
      ok: true,
      status: 201,
      data: {
        reportId: "50000000-0000-4000-8000-000000000003",
        status: "submitted",
        createdAt: "2026-11-08T14:00:00.000Z",
      },
    });
    const { CommentsSection } = await import(
      "../src/components/consumer/comments/CommentsSection"
    );
    render(
      createElement(CommentsSection, {
        kind: "venue",
        entityId: VENUE_ID,
        me: me(ACTOR_A, CSRF_A),
        description: "Обсуждение площадки",
        authReturnPath: `/venues/${VENUE_ID}#discussion`,
        parentPublic: true,
      }),
    );
    await screen.findByText("Где вход в зал?");
    expect(screen.getByText("Комментарий удалён")).toBeTruthy();
    const menus = screen.getAllByLabelText("Действия с комментарием");
    expect(menus).toHaveLength(1);
    fireEvent.click(menus[0]!);
    fireEvent.click(screen.getByTestId("venue-community-report-comment"));
    await screen.findByLabelText("Пожаловаться на публикацию");
    fireEvent.click(screen.getByTestId("venue-community-report-submit"));
    await screen.findByTestId("venue-community-report-success");
    expect(transport.calls[0]?.body).toEqual({
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId: VENUE_ID,
      commentId: COMMENT_ID,
      expectedVersion: 2,
      reasonCode: "inappropriate",
      detail: null,
    });
    expect(screen.getByText("Где вход в зал?")).toBeTruthy();
  });

  it("guest aggregate report opens auth chooser and does not POST", async () => {
    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );
    render(
      createElement(VenueCommunityRating, {
        venueId: VENUE_ID,
        signedIn: false,
        actorId: null,
        csrfToken: null,
        authReturnPath: `/venues/${VENUE_ID}`,
      }),
    );
    await screen.findByText("4,2");
    fireEvent.click(screen.getByTestId("venue-community-report-aggregate"));
    await screen.findByLabelText("Войти в GoBadminton");
    expect(transport.calls.every((call) => call.path !== "/v1/reports")).toBe(true);
  });

  it("failure and 409/429 do not claim success; unknown keeps same key", async () => {
    let attempt = 0;
    const deferred: Array<(value: unknown) => void> = [];
    transport.handler = () => new Promise((resolve) => {
      attempt += 1;
      if (attempt === 1) {
        deferred.push(resolve);
        return;
      }
      resolve({
        ok: false,
        status: 409,
        error: "conflict",
        problem: { code: "VERSION_CONFLICT", title: "Устарело" },
      });
    });
    await openAggregateDialog(ACTOR_A, CSRF_A);
    fireEvent.click(screen.getByTestId("venue-community-report-submit"));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    const firstKey = transport.calls[0]?.idempotencyKey;
    expect(firstKey).toBeTruthy();
    deferred[0]!({ ok: false, status: 0, error: "network" });
    await screen.findByText(/Результат не подтверждён|не подтвержд/i);
    expect(screen.queryByTestId("venue-community-report-success")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Проверить отправку" }));
    await waitFor(() => expect(transport.calls.length).toBeGreaterThanOrEqual(2));
    expect(transport.calls[1]?.idempotencyKey).toBe(firstKey);
    expect(transport.calls[1]?.body).toEqual(transport.calls[0]?.body);
  });

  it("actor/CSRF change clears private detail immediately and blocks wrong-context retry", async () => {
    const deferred: { resolve: ((value: unknown) => void) | null } = { resolve: null };
    transport.handler = () => new Promise((resolve) => {
      deferred.resolve = resolve;
    });
    const { VenueCommunityRating } = await import(
      "../src/components/consumer/venues/VenueCommunityRating"
    );
    const view = render(
      createElement(VenueCommunityRating, {
        venueId: VENUE_ID,
        signedIn: true,
        actorId: ACTOR_A,
        csrfToken: CSRF_A,
        authReturnPath: `/venues/${VENUE_ID}`,
      }),
    );
    await screen.findByText("4,2");
    fireEvent.click(screen.getByTestId("venue-community-report-aggregate"));
    const detail = await screen.findByTestId("venue-community-report-detail");
    fireEvent.change(detail, { target: { value: "SECRET_COMPLAINANT_DETAIL" } });
    fireEvent.click(screen.getByTestId("venue-community-report-submit"));
    await waitFor(() => expect(transport.calls).toHaveLength(1));
    const frozenKey = transport.calls[0]?.idempotencyKey;
    view.rerender(
      createElement(VenueCommunityRating, {
        venueId: VENUE_ID,
        signedIn: true,
        actorId: ACTOR_B,
        csrfToken: CSRF_B,
        authReturnPath: `/venues/${VENUE_ID}`,
      }),
    );
    expect(screen.queryByDisplayValue("SECRET_COMPLAINANT_DETAIL")).toBeNull();
    expect(document.body.textContent).not.toContain("SECRET_COMPLAINANT_DETAIL");
    expect(document.body.innerHTML).not.toContain(CSRF_A);
    expect(document.body.innerHTML).not.toContain(CSRF_B);
    deferred.resolve?.({
      ok: true,
      status: 201,
      data: {
        reportId: "50000000-0000-4000-8000-000000000099",
        status: "submitted",
        createdAt: "2026-11-08T14:00:00.000Z",
      },
    });
    await waitFor(() => {
      expect(screen.queryByTestId("venue-community-report-success")).toBeNull();
    });
    // Re-open under new actor must not reuse old UNKNOWN key automatically.
    fireEvent.click(screen.getByTestId("venue-community-report-aggregate"));
    await screen.findByLabelText("Пожаловаться на сводку оценок");
    expect(screen.queryByRole("button", { name: "Проверить отправку" })).toBeNull();
    transport.handler = async () => ({
      ok: true,
      status: 201,
      data: {
        reportId: "50000000-0000-4000-8000-000000000010",
        status: "submitted",
        createdAt: "2026-11-08T14:05:00.000Z",
      },
    });
    fireEvent.click(screen.getByTestId("venue-community-report-submit"));
    await screen.findByTestId("venue-community-report-success");
    const last = transport.calls[transport.calls.length - 1];
    expect(last?.csrfToken).toBe(CSRF_B);
    expect(last?.idempotencyKey).not.toBe(frozenKey);
  });

  it("game comments never expose venue_community report control", async () => {
    const commentsApi = await import("../src/lib/comments-api");
    vi.mocked(commentsApi.listEntityComments).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        entityKind: "game",
        entityId: "60000000-0000-4000-8000-000000000001",
        parentCommentId: null,
        items: [{
          id: "70000000-0000-4000-8000-000000000001",
          entityKind: "game",
          entityId: "60000000-0000-4000-8000-000000000001",
          parentCommentId: null,
          body: "Игровой комментарий",
          deleted: false,
          version: 1,
          createdAt: "2026-11-08T12:00:00.000Z",
          updatedAt: "2026-11-08T12:00:00.000Z",
          edited: false,
          mine: false,
          author: {
            publicPlayerId: "40000000-0000-4000-8000-000000000001",
            displayName: "Игрок",
            avatar: { uploadedUrl: null, providerUrl: null },
            profilePublic: true,
          },
          replyCount: 0,
        }],
        nextCursor: null,
        visibleCount: 1,
        canCreate: true,
      },
    });
    const { CommentsSection } = await import(
      "../src/components/consumer/comments/CommentsSection"
    );
    render(
      createElement(CommentsSection, {
        kind: "game",
        entityId: "60000000-0000-4000-8000-000000000001",
        me: me(ACTOR_A, CSRF_A),
        description: "Игра",
        authReturnPath: "/games/x",
        parentPublic: true,
      }),
    );
    await screen.findByText("Игровой комментарий");
    fireEvent.click(screen.getByLabelText("Действия с комментарием"));
    const menu = screen.getByRole("menu");
    // Game threads may keep player-author safety; venue_community report control must stay absent.
    expect(within(menu).queryByTestId("venue-community-report-comment")).toBeNull();
    expect(document.body.innerHTML).not.toContain("venue_community");
  });
  it("uses the same aggregate report subject inside the embedded community", async () => {
    transport.handler = async path => path.includes("experience-reviews")
      ? {ok:true,status:200,data:{venueId:VENUE_ID,publishedCount:0,items:[],nextCursor:null,canWriteHint:false}}
      : {ok:true,status:201,data:{reportId:"50000000-0000-4000-8000-000000000001",status:"submitted",createdAt:"2026-11-09T12:00:00Z"}};
    const { VenueCommunityContent } = await import("../src/components/consumer/venues/VenueCommunityContent");
    render(createElement(VenueCommunityContent,{venueId:VENUE_ID,me:me(ACTOR_A,CSRF_A),authReturnPath:"/games?view=map",embedded:true}));
    await screen.findByText("4,2");
    fireEvent.click(screen.getByTestId("venue-community-report-aggregate"));
    fireEvent.click(await screen.findByTestId("venue-community-report-submit"));
    await screen.findByTestId("venue-community-report-success");
    expect(transport.calls.find(call=>call.path==="/v1/reports")).toMatchObject({body:{targetKind:"venue_community",subjectKind:"aggregate",venueId:VENUE_ID},csrfToken:CSRF_A});
    expect(document.querySelector(`[data-venue-community="${VENUE_ID}"]`)).toBeTruthy();
  });

});


describe("report lifecycle propagation", () => {
  beforeEach(() => { polyfillDialog(); transport.calls = []; sessionStorage.clear(); });
  afterEach(cleanup);
  it.each(["aggregate", "own_vote", "venue_comment"] as const)("holds %s report through pending/503/close and retries exact context", async subjectKind => {
    const { VenueCommunityReportDialog } = await import("../src/components/consumer/venues/VenueCommunityReportDialog");
    let settle!: (result: unknown) => void;
    transport.handler = () => new Promise(resolve => { settle = resolve; });
    const unresolved = vi.fn(), close = vi.fn();
    const subject = subjectKind === "aggregate" ? { subjectKind, venueId: VENUE_ID }
      : subjectKind === "own_vote" ? { subjectKind, venueId: VENUE_ID, expectedVersion: 9 }
      : { subjectKind, venueId: VENUE_ID, commentId: COMMENT_ID, expectedVersion: 4 };
    render(createElement(VenueCommunityReportDialog, { subject, actorId: ACTOR_A, csrfToken: CSRF_A,
      authReturnPath: "/games?view=map", onClose: close, onUnresolvedChange: unresolved }));
    fireEvent.change(screen.getByTestId("venue-community-report-detail"), { target: { value: "Точное описание" } });
    fireEvent.click(screen.getByTestId("venue-community-report-submit"));
    expect(unresolved).toHaveBeenLastCalledWith(true);
    const first = structuredClone(transport.calls[0]);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    await act(async () => settle({ ok: false, status: 503, error: "unknown" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(close).not.toHaveBeenCalled(); expect(unresolved).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Проверить отправку" }));
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]).toEqual(first);
    expect(first).toMatchObject({ path: "/v1/reports", method: "POST", csrfToken: CSRF_A,
      body: { subjectKind, venueId: VENUE_ID, detail: "Точное описание" } });
    await act(async () => settle({ ok: true, status: 201, data: {
      reportId: "50000000-0000-4000-8000-000000000001", status: "submitted", createdAt: "2026-11-09T12:00:00Z" } }));
    expect(unresolved).toHaveBeenLastCalledWith(false);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ORs independent rating, report and review operations; each resolution leaves the others held", async () => {
    const { VenueCommunityContent } = await import("../src/components/consumer/venues/VenueCommunityContent");
    const ratingApi = await import("../src/lib/venue-community-api");
    const summary = { venueId: VENUE_ID, canonicalVenueId: VENUE_ID, state: "available" as const, average: 4.2, count: 5 };
    const own = { venueId: VENUE_ID, canonicalVenueId: VENUE_ID, value: 4, version: 3, withdrawn: false, moderationState: "clear" as const, allowedActions: { upsert: true, update: true, withdraw: true } };
    vi.mocked(ratingApi.fetchOwnCommunityRating).mockResolvedValue({ own, summary });
    let reportSettle!: (result: unknown) => void;
    let reviewAttempts = 0, voteAttempts = 0;
    transport.handler = (path, init) => {
      if (path.includes("experience-reviews")) return { ok: true, status: 200, data: { items: [], publishedCount: 0 } };
      if (path.includes("eligibility")) return { ok: true, status: 200, data: { bases: [{ gameId: "game-one", gameTitle: "Игра", admission: "may_submit", outcomeVersion: 2, attendanceVersion: 6 }] } };
      if (path === `/v1/venues/${VENUE_ID}/community-rating`) return ++voteAttempts === 1
        ? { ok: false, status: 503, error: "unknown rating" }
        : { ok: true, status: 200, data: { own: { ...own, value: 5, version: 4 }, summary } };
      if (path === "/v1/me/venue-reviews" && init?.method === "POST") return ++reviewAttempts === 1
        ? { ok: false, status: 503, error: "unknown review" }
        : { ok: true, status: 201, data: { status: "self_draft", receiptToken: "receipt" } };
      if (path === "/v1/reports") return new Promise(resolve => { reportSettle = resolve; });
      throw new Error(path);
    };
    const unresolved = vi.fn();
    render(createElement(VenueCommunityContent, { venueId: VENUE_ID, me: me(ACTOR_A, CSRF_A), authReturnPath: "/games?view=map", onUnresolvedChange: unresolved }));
    await waitFor(() => expect((screen.getByRole("radio", { name: "5 из 5" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("radio", { name: "5 из 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить изменение" }));
    await screen.findByTestId("venue-community-vote-unknown");
    expect(unresolved).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByTestId("venue-community-report-aggregate"));
    fireEvent.click(await screen.findByTestId("venue-community-report-submit"));
    expect(unresolved).toHaveBeenLastCalledWith(true);
    await act(async () => reportSettle({ ok: false, status: 503, error: "unknown report" }));
    const reportDialog = screen.getByRole("dialog", { name: "Пожаловаться на сводку оценок" });
    fireEvent(reportDialog, new Event("cancel", { cancelable: true }));
    expect(reportDialog.hasAttribute("open")).toBe(true);
    fireEvent.click(within(reportDialog).getByRole("button", { name: "Проверить отправку" }));
    await act(async () => reportSettle({ ok: true, status: 201, data: { reportId: "50000000-0000-4000-8000-000000000001", status: "submitted", createdAt: "2026-11-09T12:00:00Z" } }));
    expect(unresolved).toHaveBeenLastCalledWith(true);
    fireEvent(reportDialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByTestId("venue-community-vote-unknown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Поделиться опытом" }));
    await screen.findByText("Можно поделиться опытом");
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Отзыв" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить", exact: true }));
    await screen.findByText("Не удалось подтвердить отправку. Текст сохранён");
    expect(unresolved).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Проверить отправку" }));
    await screen.findByText("Сохранено только вам.");
    expect(unresolved).toHaveBeenLastCalledWith(true);
    fireEvent(screen.getByRole("dialog", { name: "Как вам площадка?" }), new Event("cancel", { cancelable: true }));
    fireEvent.click(screen.getByRole("button", { name: "Повторить тот же запрос" }));
    await waitFor(() => expect(unresolved).toHaveBeenLastCalledWith(false));
  });
});
