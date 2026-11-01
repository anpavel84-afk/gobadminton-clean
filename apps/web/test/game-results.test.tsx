import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attendanceLabel, canOfferAttendanceWrites, resultsPath } from "../src/lib/game-results";
import type { GameResults } from "../src/lib/consumer-types";

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
    expect(composition).toContain("Кнопки отправки сейчас не предлагаются");
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
});
