import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { managerRosterRowStatusLabel } from "../src/components/consumer/games/GameResultsComposition";
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
    expect(composition).toContain("venueId={game?.venue?.id ?? null}");
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
