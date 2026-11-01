import { describe, expect, it } from "vitest";
import { pendingOwnNotice } from "../src/lib/game-results";
import type { MeGameResultsPage } from "../src/lib/consumer-types";

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

describe("MyGames results notice discoverability", () => {
  it("counts only unacknowledged own notices", () => {
    const page: MeGameResultsPage = {
      items: [
        {
          gameId: "10000000-0000-4000-8000-000000000001",
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
        },
        {
          gameId: "10000000-0000-4000-8000-000000000002",
          contextId: "10000000-0000-4000-8000-000000000012",
          gameTitle: "Другая",
          endsAt: null,
          attendance: { ...baseAttendance, contextId: "10000000-0000-4000-8000-000000000012", value: "present" },
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
        },
      ],
      nextCursor: null,
    };
    expect(pendingOwnNotice(page)).toBe(1);
    expect(pendingOwnNotice({ items: [], nextCursor: null })).toBe(0);
  });
});
