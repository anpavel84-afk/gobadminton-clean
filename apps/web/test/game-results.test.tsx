/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type * as ReviewApi from "../src/lib/venue-reviews-api";
import type * as ResultsApi from "../src/lib/api-client";
import type { Game, Me } from "../src/lib/consumer-types";
import { GameResultsComposition, managerRosterRowStatusLabel } from "../src/components/consumer/games/GameResultsComposition";
import {
  attendanceLabel,
  canOfferAttendanceWrites,
  defaultOpenDisputeId,
  listOpenAttendanceDisputes,
  ownResultPendingNotice,
  parseResultsSection,
  pendingOwnNotice,
  resultsPath,
} from "../src/lib/game-results";
import type { AttendanceRecord, GameResults, MeGameResultsPage } from "../src/lib/consumer-types";

describe("PG-1b game results helpers", () => {
  it("labels attendance without inventing present/absent from time", () => {
    expect(attendanceLabel("unknown")).toBe("Не отмечено");
    expect(attendanceLabel("present")).toBe("Пришёл");
    expect(attendanceLabel("absent")).toBe("Не пришёл");
  });

  it("does not offer writes when server readiness is off", () => {
    const off: GameResults = {
      gameId: "10000000-0000-4000-8000-000000000001",
      outcome: { value: "unknown", version: 0, reason: null, provenance: null },
      attendance: {
        installed: true,
        writesEnabled: false,
        myAttendance: null,
        roster: null,
        rosterNextCursor: null,
        summary: null,
        allowedActions: { canRecordAttendance: false, canBulkPresent: false },
      },
      allowedActions: { canRecordOutcome: false },
    };
    expect(canOfferAttendanceWrites(off)).toBe(false);
    expect(canOfferAttendanceWrites({
      ...off,
      attendance: { ...off.attendance!, writesEnabled: true },
    })).toBe(true);
  });

  it("builds results path under my-games with validated section entry", () => {
    expect(resultsPath("10000000-0000-4000-8000-000000000001")).toBe(
      "/my-games/10000000-0000-4000-8000-000000000001/results",
    );
    expect(resultsPath("10000000-0000-4000-8000-000000000001", "feedback")).toBe(
      "/my-games/10000000-0000-4000-8000-000000000001/results?section=feedback",
    );
    expect(resultsPath("10000000-0000-4000-8000-000000000001", "clarification")).toContain(
      "section=clarification",
    );
    expect(parseResultsSection("feedback")).toBe("feedback");
    expect(parseResultsSection("attendance")).toBe("attendance");
    expect(parseResultsSection("clarification")).toBe("clarification");
    expect(parseResultsSection("admin")).toBe("attendance");
    expect(parseResultsSection(undefined)).toBe("attendance");
  });

  it("results page host wires GameResultsPage without fake PG-2/3 writes", () => {
    const page = readFileSync(
      path.resolve(__dirname, "../src/app/my-games/[gameId]/results/page.tsx"),
      "utf8",
    );
    const composition = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameResultsComposition.tsx"),
      "utf8",
    );
    expect(page).toContain("GameResultsPage");
    expect(composition).toContain("Участники / Итоги");
    expect(composition).toContain("GameFeedbackPanel");
    expect(composition).toContain("GameVenueReviewEntry");
    expect(composition).toContain("useGameResultsMutation");
    expect(composition).toContain("parseResultsSection");
    expect(composition).toContain("selectTab");
    expect(composition).toContain('href="/my-games?view=history"');
    expect(composition).not.toContain("Кнопки отправки сейчас не предлагаются");
    expect(composition).toContain("Согласен с этой отметкой");
    expect(composition).not.toContain('|| "Исправление"');
    expect(composition).not.toContain("phantom");
  });

  it("missing attendance heading stays truthful — not a static organizer-marked claim", () => {
    const composition = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameResultsComposition.tsx"),
      "utf8",
    );
    expect(composition).toContain('"Организатор отметил ваше посещение"');
    expect(composition).toContain('"Вы отметили своё посещение"');
    expect(composition).toContain('"Отмечено вами"');
    expect(composition).toContain('? "Отметка требует уточнения"');
    expect(composition).toContain(': "Посещение ещё не отмечено"');
    expect(composition).toContain('my.assertion.source === "self_attested"');
    // Static-only heading would always claim organizer marked attendance.
    expect(composition).not.toMatch(
      /<SectionHeader title="Организатор отметил ваше посещение"\s*\/>/,
    );
    expect(composition).not.toMatch(
      /<SectionHeader title="Вы отметили своё посещение"\s*\/>/,
    );
  });

  it("pending own notice ignores self_attested and superseded versions", () => {
    const base = {
      gameId: "10000000-0000-4000-8000-000000000001",
      contextId: "10000000-0000-4000-8000-000000000011",
      gameTitle: "Игра",
      endsAt: "2026-10-24T17:00:00.000Z",
      attendance: {
        contextId: "10000000-0000-4000-8000-000000000011",
        value: "present" as const,
        version: 2,
        late: false,
        assertion: {
          actorDisplay: "Я",
          source: "self_attested" as const,
          at: "2026-10-24T18:00:00.000Z",
        },
        acknowledgedVersion: null,
        dispute: null,
        displayName: "Я",
        allowedActions: {
          canSetAttendance: false,
          canAcknowledge: false,
          canDispute: true,
          canWithdrawDispute: false,
        },
      },
      notice: {
        id: "10000000-0000-4000-8000-000000000021",
        attendanceVersion: 2,
        value: "present" as const,
        late: false,
        source: "self_attested" as const,
        actorDisplay: "Я",
        createdAt: "2026-10-24T18:00:00.000Z",
        acknowledgedAt: null,
      },
    };
    expect(ownResultPendingNotice(base)).toBe(false);
    expect(
      ownResultPendingNotice({
        ...base,
        notice: null,
      }),
    ).toBe(false);
    expect(
      ownResultPendingNotice({
        ...base,
        attendance: {
          ...base.attendance,
          assertion: { ...base.attendance.assertion, source: "manager_explicit" },
        },
        notice: {
          ...base.notice!,
          source: "manager_explicit",
          attendanceVersion: 1,
        },
      }),
    ).toBe(false);
    const externalCurrent = {
      ...base,
      attendance: {
        ...base.attendance,
        assertion: {
          actorDisplay: "Ольга",
          source: "manager_explicit" as const,
          at: "2026-10-24T19:00:00.000Z",
        },
      },
      notice: {
        ...base.notice!,
        source: "manager_explicit" as const,
        actorDisplay: "Ольга",
        attendanceVersion: 2,
      },
    };
    expect(ownResultPendingNotice(externalCurrent)).toBe(true);
    const page: MeGameResultsPage = {
      items: [base, externalCurrent],
      nextCursor: null,
    };
    expect(pendingOwnNotice(page)).toBe(1);
  });

  it("OwnedGameSummary exposes contextual Results entry via resultsPath", () => {
    const summary = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/pages/OwnedGameSummaryPage.tsx"),
      "utf8",
    );
    expect(summary).toContain("resultsPath");
    expect(summary).toContain("Участники / Итоги");
    expect(summary).not.toContain("ManageGamePage");
    expect(summary).not.toContain("MyGameDetailPage");
  });

  it("manager roster status: own self_attested stays neutral; external wait and dispute preserved", () => {
    const baseActions = {
      canSetAttendance: true,
      canAcknowledge: false,
      canDispute: false,
      canWithdrawDispute: false,
      canRespondDispute: true,
    };
    const ownSelf: AttendanceRecord = {
      contextId: "20000000-0000-4000-8000-000000000010",
      value: "present",
      version: 1,
      late: false,
      assertion: {
        actorDisplay: "Я",
        source: "self_attested",
        at: "2026-11-08T12:00:00.000Z",
      },
      acknowledgedVersion: null,
      dispute: null,
      displayName: "Я (организатор)",
      allowedActions: baseActions,
    };
    const externalPending: AttendanceRecord = {
      contextId: "20000000-0000-4000-8000-000000000011",
      value: "present",
      version: 2,
      late: false,
      assertion: {
        actorDisplay: "Mgr",
        source: "manager_explicit",
        at: "2026-11-08T12:05:00.000Z",
      },
      acknowledgedVersion: null,
      dispute: null,
      displayName: "Анна",
      allowedActions: baseActions,
    };
    const disputed: AttendanceRecord = {
      contextId: "20000000-0000-4000-8000-000000000012",
      value: "absent",
      version: 2,
      late: false,
      assertion: {
        actorDisplay: "Mgr",
        source: "manager_explicit",
        at: "2026-11-08T12:10:00.000Z",
      },
      acknowledgedVersion: null,
      dispute: {
        id: "30000000-0000-4000-8000-000000000012",
        status: "open",
        challengedVersion: 1,
        version: 1,
      },
      displayName: "Борис",
      allowedActions: baseActions,
    };
    const externalAgreed: AttendanceRecord = {
      ...externalPending,
      contextId: "20000000-0000-4000-8000-000000000013",
      displayName: "Вера",
      acknowledgedVersion: 2,
    };
    const disputedSelf: AttendanceRecord = {
      ...ownSelf,
      contextId: "20000000-0000-4000-8000-000000000014",
      displayName: "Самоспор",
      dispute: {
        id: "30000000-0000-4000-8000-000000000014",
        status: "open",
        challengedVersion: 1,
        version: 1,
      },
    };

    expect(managerRosterRowStatusLabel(ownSelf)).toBe("Сами отметили");
    expect(managerRosterRowStatusLabel(ownSelf)).not.toBe("Ждёт ответа участника");
    expect(managerRosterRowStatusLabel(ownSelf)).not.toBe("Участник подтвердил");
    expect(managerRosterRowStatusLabel(externalPending)).toBe("Ждёт ответа участника");
    expect(managerRosterRowStatusLabel(disputed)).toBe("На уточнении");
    expect(managerRosterRowStatusLabel(disputedSelf)).toBe("На уточнении");
    expect(managerRosterRowStatusLabel(externalAgreed)).toBe("Участник подтвердил");
    expect(
      managerRosterRowStatusLabel({
        ...ownSelf,
        value: "unknown",
        version: 0,
        assertion: { actorDisplay: null, source: null, at: null },
      }),
    ).toBe("Ещё без отметки");

    const composition = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameResultsComposition.tsx"),
      "utf8",
    );
    expect(composition).toContain("managerRosterRowStatusLabel(row)");
    expect(composition).toContain('"Сами отметили"');
    expect(composition).toContain('"Ждёт ответа участника"');
  });

  it("manager open-dispute list exposes two concurrent roster disputes without closing the first", () => {
    const row = (
      id: string,
      disputeId: string,
      name: string,
      over: Partial<AttendanceRecord> = {},
    ): AttendanceRecord => ({
      contextId: id,
      value: "absent",
      version: 2,
      late: false,
      assertion: { actorDisplay: "Mgr", source: "manager_explicit", at: "2026-11-01T00:00:00.000Z" },
      acknowledgedVersion: null,
      dispute: {
        id: disputeId,
        status: "open",
        challengedVersion: 1,
        version: 1,
      },
      displayName: name,
      allowedActions: {
        canSetAttendance: true,
        canAcknowledge: false,
        canDispute: false,
        canWithdrawDispute: false,
        canRespondDispute: true,
      },
      ...over,
    });
    const results: GameResults = {
      gameId: "10000000-0000-4000-8000-000000000001",
      outcome: { value: "held", version: 1, reason: null, provenance: null },
      attendance: {
        installed: true,
        writesEnabled: true,
        myAttendance: null,
        roster: [
          row("20000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000001", "Анна"),
          row("20000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000002", "Борис"),
        ],
        rosterNextCursor: null,
        summary: { rosterCount: 2, marked: 2, unknown: 0, underClarification: 2, agreed: 0 },
        allowedActions: { canRecordAttendance: true, canBulkPresent: true },
      },
      allowedActions: { canRecordOutcome: true },
    };
    const open = listOpenAttendanceDisputes(results);
    expect(open).toHaveLength(2);
    expect(open.map((item) => item.disputeId)).toEqual([
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ]);
    expect(open[1]?.displayName).toBe("Борис");
    expect(defaultOpenDisputeId(results)).toBe("30000000-0000-4000-8000-000000000001");
    // Second remains selectable while first stays open — list is not collapsed to one.
    expect(open.every((item) => item.version === 1)).toBe(true);

    const composition = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameResultsComposition.tsx"),
      "utf8",
    );
    expect(composition).toContain("selectOpenDispute");
    expect(composition).toContain("Открыть уточнение");
    expect(composition).toContain("listOpenAttendanceDisputes");
    expect(composition).toContain("resetDraft: true");
    expect(composition).toContain("gb-postgame__dispute-picks");
  });
});


const reviewApi = vi.hoisted(() => ({ eligibility: vi.fn<typeof ReviewApi.getOwnVenueReviewEligibility>(),
  send: vi.fn<typeof ReviewApi.createVenueReview>() }));
const resultsApi = vi.hoisted(() => ({ me: vi.fn<typeof ResultsApi.getMe>(), game: vi.fn<typeof ResultsApi.getGame>(),
  results: vi.fn<typeof ResultsApi.getGameResults>(), refresh: null as null | (() => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("section=feedback") }));
vi.mock("../src/lib/api-client", async original => ({ ...await original<typeof ResultsApi>(),
  getMe: resultsApi.me, getGame: resultsApi.game, getGameResults: resultsApi.results }));
vi.mock("../src/lib/venue-reviews-api", async original => ({ ...await original<typeof ReviewApi>(),
  getOwnVenueReviewEligibility: reviewApi.eligibility, createVenueReview: reviewApi.send }));
vi.mock("../src/components/consumer/games/useGameResultsMutation", () => ({
  useGameResultsMutation: (_actor: string, _game: string, _csrf: string, _success: unknown, refresh: () => void) => {
    resultsApi.refresh = refresh;
    return { busy: false, pending: false, notice: null };
  },
}));
const reviewBasis: ReviewApi.OwnVenueEligibilityBasis = { gameId: "current-game", gameTitle: "Сыгранная игра",
  admission: "may_submit", reason: null, helpHint: null, outcomeVersion: 4, attendanceVersion: 9, firstEligibleAt: null };
const reviewResults: GameResults = { gameId: "current-game",
  outcome: { value: "held", version: 4, reason: null, provenance: null }, allowedActions: { canRecordOutcome: false } };
const reviewGame = { id: "current-game", title: "Игра", venue: { id: "venue-one", name: "Зал" } } as Game;
const reviewActor: Me = { id: "actor-one", csrfToken: "session-one", displayName: "Игрок", locale: "ru", linkedProviders: [] };
const reviewReceipt: ReviewApi.VenueReviewMutationReceipt = { id: "review-one", version: 1, status: "self_draft",
  receiptToken: "receipt", reviewHandle: "handle", publicVisible: false, notBefore: null };

beforeEach(() => {
  vi.resetAllMocks();
  resultsApi.refresh = null;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  resultsApi.me.mockResolvedValue({ ok: true, status: 200, data: reviewActor });
  resultsApi.game.mockResolvedValue({ ok: true, status: 200, data: reviewGame });
  resultsApi.results.mockResolvedValue({ ok: true, status: 200, data: reviewResults });
  reviewApi.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: [reviewBasis] } });
  reviewApi.send.mockResolvedValue({ ok: true, status: 201, data: reviewReceipt });
});
afterEach(cleanup);

describe("results fixed-game venue review", () => {
  it("offers the exact server-admitted game beside private feedback and writes privately", async () => {
    render(createElement(GameResultsComposition, { gameId: "current-game" }));
    fireEvent.click(await screen.findByRole("button", { name: "Оставить отзыв о площадке" }));
    await screen.findByText("Можно поделиться опытом");
    expect(screen.queryByText("Поделиться опытом о площадке")).toBeNull();
    expect(screen.queryByLabelText("Игра, после которой оставляете отзыв")).toBeNull();
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Точный отзыв" } });
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await screen.findByText("Сохранено только вам.");
    expect(reviewApi.send.mock.calls[0]?.[0]).toMatchObject({ gameId: "current-game", venueId: "venue-one",
      audience: "self_draft", expectedBasisVersions: { outcomeVersion: 4, attendanceVersion: 9 } });
    expect(reviewApi.eligibility).toHaveBeenCalledTimes(3); // Entry, open, new write.
  });

  it.each([
    { bases: [{ ...reviewBasis, gameId: "other-eligible" }], message: /Не удалось подтвердить возможность/ },
    { bases: [{ ...reviewBasis, admission: "hold" as const, helpHint: "attendance_clarifying" as const }], message: /Уточняем посещение/ },
    { bases: [{ ...reviewBasis, admission: "deny" as const, reason: "window_closed" }], message: /Срок подачи отзыва/ },
    { bases: [{ ...reviewBasis, admission: "hold" as const, helpHint: "attendance_unmarked" as const }], message: /Посещение ещё не отмечено/ },
  ])("hides entry when exact eligibility is unavailable: $message", async ({ bases, message }) => {
    reviewApi.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases } });
    render(createElement(GameResultsComposition, { gameId: "current-game" }));
    await screen.findByText(message);
    expect(screen.queryByRole("button", { name: "Оставить отзыв о площадке" })).toBeNull();
    expect(reviewApi.send).not.toHaveBeenCalled();
  });

  it("rechecks when opening instead of trusting an earlier positive entry", async () => {
    render(createElement(GameResultsComposition, { gameId: "current-game" }));
    const entry = await screen.findByRole("button", { name: "Оставить отзыв о площадке" });
    reviewApi.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: [] } });
    fireEvent.click(entry);
    await screen.findByText("Не удалось подтвердить возможность отзыва по этой игре.");
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Текст" } });
    expect((screen.getByRole("button", { name: /^Сохранить$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(reviewApi.send).not.toHaveBeenCalled();
  });

  it("refreshes admission in an idle open form without losing its draft", async () => {
    render(createElement(GameResultsComposition, { gameId: "current-game" }));
    fireEvent.click(await screen.findByRole("button", { name: "Оставить отзыв о площадке" }));
    await screen.findByText("Можно поделиться опытом");
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Мой черновик" } });
    reviewApi.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: [
      { ...reviewBasis, admission: "hold", helpHint: "attendance_clarifying" },
    ] } });
    resultsApi.results.mockResolvedValueOnce({ ok: true, status: 200, data: { ...reviewResults } });
    await act(async () => { resultsApi.refresh?.(); });
    await screen.findByText(/Уточняем посещение/);
    expect((screen.getByLabelText("Ваш опыт на площадке") as HTMLTextAreaElement).value).toBe("Мой черновик");
    expect((screen.getByRole("button", { name: /^Сохранить$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(reviewApi.send).not.toHaveBeenCalled();
  });

  it("retains the admitted owner across tab change and same-session refresh with missing public game", async () => {
    reviewApi.send.mockResolvedValueOnce({ ok: false, status: 503, error: "unconfirmed" });
    const view = render(createElement(GameResultsComposition, { gameId: "current-game" }));
    fireEvent.click(await screen.findByRole("button", { name: "Оставить отзыв о площадке" }));
    await screen.findByText("Можно поделиться опытом");
    fireEvent.change(screen.getByLabelText("Ваш опыт на площадке"), { target: { value: "Замороженный текст" } });
    fireEvent.click(screen.getByRole("button", { name: /^Сохранить$/ }));
    await screen.findByText(/Не удалось подтвердить отправку/);
    const packet = structuredClone(reviewApi.send.mock.calls[0]);
    const dialog = screen.getByRole("dialog");
    resultsApi.game.mockResolvedValueOnce({ ok: false, status: 503, error: "unavailable" });
    resultsApi.results.mockResolvedValueOnce({ ok: true, status: 200, data: { ...reviewResults } });
    reviewApi.eligibility.mockResolvedValue({ ok: true, status: 200, data: { bases: [] } });
    await act(async () => { resultsApi.refresh?.(); });
    view.rerender(createElement(GameResultsComposition, { gameId: "current-game" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(screen.getByRole("tab", { name: "Посещение" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(screen.getByRole("button", { name: "Проверить отправку" }));
    await screen.findByText("Сохранено только вам.");
    expect(reviewApi.send.mock.calls[1]).toEqual(packet);
    expect(reviewApi.send).toHaveBeenCalledTimes(2);
  });

  it("ignores a late positive entry read after session change", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof ReviewApi.getOwnVenueReviewEligibility>>) => void;
    reviewApi.eligibility.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(createElement(GameResultsComposition, { gameId: "current-game" }));
    await waitFor(() => expect(reviewApi.eligibility).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("gb-session-changed")));
    await act(async () => resolve({ ok: true, status: 200, data: { bases: [reviewBasis] } }));
    expect(screen.queryByRole("button", { name: "Оставить отзыв о площадке" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(reviewApi.send).not.toHaveBeenCalled();
  });
});
