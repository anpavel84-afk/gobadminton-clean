import { describe, expect, it } from "vitest";
import {
  countsTowardHeldGames,
  evaluateWriteAdmission,
  opaqueHandle,
  projectionHash,
  topicsAllowedForRole,
} from "../../src/games/role-reputation.policy";

const author = "10000000-0000-4000-8000-000000000001";
const subject = "10000000-0000-4000-8000-000000000002";

describe("role reputation policy", () => {
  it("counts only distinct confirmed historical held past games", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    expect(
      countsTowardHeldGames({
        endsAt: new Date("2026-11-01T12:00:00.000Z"),
        now,
        lifecycle: "completed",
        outcome: "held",
        proofAccepted: true,
        proofPhase: "performed",
        openRoleOrHeldDispute: false,
      }),
    ).toBe(true);
    expect(
      countsTowardHeldGames({
        endsAt: new Date("2026-11-03T12:00:00.000Z"),
        now,
        lifecycle: "published",
        outcome: "held",
        proofAccepted: true,
        proofPhase: "performed",
        openRoleOrHeldDispute: false,
      }),
    ).toBe(false);
    expect(
      countsTowardHeldGames({
        endsAt: new Date("2026-11-01T12:00:00.000Z"),
        now,
        lifecycle: "cancelled",
        outcome: "held",
        proofAccepted: true,
        proofPhase: "performed",
        openRoleOrHeldDispute: false,
      }),
    ).toBe(false);
    expect(
      countsTowardHeldGames({
        endsAt: new Date("2026-11-01T12:00:00.000Z"),
        now,
        lifecycle: "completed",
        outcome: "unknown",
        proofAccepted: true,
        proofPhase: "performed",
        openRoleOrHeldDispute: false,
      }),
    ).toBe(false);
    expect(
      countsTowardHeldGames({
        endsAt: new Date("2026-11-01T12:00:00.000Z"),
        now,
        lifecycle: "completed",
        outcome: "held",
        proofAccepted: false,
        proofPhase: "planned",
        openRoleOrHeldDispute: false,
      }),
    ).toBe(false);
  });

  it("admits own past role and denies outsider/self/self-mark", () => {
    const base = {
      authorUserId: author,
      subjectUserId: subject,
      role: "organization" as const,
      activityKind: "regular" as const,
      lifecycleOk: true,
      outcomeHeld: true,
      ownEligible: true,
      authorConfirmedPresent: true,
      authorOpenDispute: false,
      authorAttendance: {
        value: "present" as const,
        source: "manager_explicit" as const,
        actorUserId: subject,
      },
      proofPhase: "performed" as const,
      proofSubjectUserId: subject,
      proofAccepted: true,
      openRoleDispute: false,
      surfaceAvailable: true,
    };
    expect(evaluateWriteAdmission(base).status).toBe("may_submit");
    expect(evaluateWriteAdmission({ ...base, ownEligible: false }).status).toBe("deny");
    expect(
      evaluateWriteAdmission({ ...base, authorUserId: subject, subjectUserId: subject }).status,
    ).toBe("deny");
    expect(
      evaluateWriteAdmission({
        ...base,
        authorConfirmedPresent: false,
        authorAttendance: {
          value: "present",
          source: "self_attested",
          actorUserId: author,
        },
      }).status,
    ).toBe("deny");
    expect(
      evaluateWriteAdmission({
        ...base,
        proofPhase: null,
        proofAccepted: false,
        proofSubjectUserId: null,
        subjectUserId: null,
      }).status,
    ).toBe("hold");
  });

  it("binds consent hash to exact projection and validates topics", () => {
    const a = projectionHash({
      subjectUserId: subject,
      role: "organization",
      audience: "public",
      text: "Хорошая организация",
      topics: ["agreements"],
    });
    const b = projectionHash({
      subjectUserId: subject,
      role: "organization",
      audience: "public",
      text: "Хорошая организация",
      topics: ["agreements"],
    });
    const c = projectionHash({
      subjectUserId: subject,
      role: "organization",
      audience: "public",
      text: "Другой текст",
      topics: ["agreements"],
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(topicsAllowedForRole("organization", ["agreements", "flow"])).toBe(true);
    expect(topicsAllowedForRole("organization", ["explanations"])).toBe(false);
    expect(topicsAllowedForRole("training", ["explanations", "attention"])).toBe(true);
    expect(opaqueHandle()).toMatch(/^[0-9a-f]{32}$/);
  });
});
