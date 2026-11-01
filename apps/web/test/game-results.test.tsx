import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  attendanceLabel,
  canOfferAttendanceWrites,
  defaultOpenDisputeId,
  listOpenAttendanceDisputes,
  resultsPath,
} from "../src/lib/game-results";
import type { AttendanceRecord, GameResults } from "../src/lib/consumer-types";

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

  it("builds results path under my-games", () => {
    expect(resultsPath("10000000-0000-4000-8000-000000000001")).toBe(
      "/my-games/10000000-0000-4000-8000-000000000001/results",
    );
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
    expect(composition).toContain("useGameResultsMutation");
    expect(composition).not.toContain("Кнопки отправки сейчас не предлагаются");
    expect(composition).toContain("Согласен с этой отметкой");
    expect(composition).not.toContain('|| "Исправление"');
    expect(composition).not.toContain("phantom");
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
