import { describe, expect, it } from "vitest";
import {
  acknowledgeAttendanceRequest,
  helpDisputeRequest,
  parse,
  putAttendanceRequest,
  respondDisputeRequest,
} from "../../src/games/game-attendance.policy";
import {
  attendanceDisputeIntakeSchema,
  attendanceDisputeResolveSchema,
} from "../../src/admin/attendance-disputes.dto";
import { parse as adminParse } from "../../src/admin/dto";

const disputeId = "10000000-0000-4000-8000-000000000021";

describe("PG-2 attendance dispute policy", () => {
  it("allows correction to unknown with reason; rejects initial unknown", () => {
    expect(() => parse(putAttendanceRequest, { expectedVersion: 0, value: "unknown" })).toThrow();
    expect(
      parse(putAttendanceRequest, {
        expectedVersion: 1,
        value: "unknown",
        correctionReason: "Не удалось подтвердить",
      }).value,
    ).toBe("unknown");
  });

  it("ack requires dispute id and version together; unknown not in request shape alone", () => {
    expect(parse(acknowledgeAttendanceRequest, { attendanceVersion: 2 }).attendanceVersion).toBe(2);
    expect(() =>
      parse(acknowledgeAttendanceRequest, {
        attendanceVersion: 2,
        resolvingDisputeId: disputeId,
      }),
    ).toThrow();
    expect(
      parse(acknowledgeAttendanceRequest, {
        attendanceVersion: 2,
        resolvingDisputeId: disputeId,
        expectedDisputeVersion: 1,
      }).expectedDisputeVersion,
    ).toBe(1);
  });

  it("manager respond accepts optional correction; help is explanation-only", () => {
    expect(
      parse(respondDisputeRequest, {
        expectedVersion: 1,
        explanation: "Проверил состав — вас не заметили на втором корте.",
      }).explanation.length,
    ).toBeGreaterThan(0);
    expect(
      parse(respondDisputeRequest, {
        expectedVersion: 1,
        explanation: "Исправляю",
        correction: {
          expectedAttendanceVersion: 1,
          value: "present",
          correctionReason: "Участник был на втором корте",
        },
      }).correction?.value,
    ).toBe("present");
    expect(
      parse(helpDisputeRequest, {
        expectedVersion: 1,
        explanation: "Нужна помощь по уточнению",
      }).explanation,
    ).toContain("помощь");
  });

  it("admin intake/resolve enums stay bounded without client independently_verified", () => {
    expect(
      adminParse(attendanceDisputeIntakeSchema, {
        disputeId,
        expectedDisputeVersion: 2,
        reasonCode: "attendance_intake",
        assignToSelf: true,
      }).assignToSelf,
    ).toBe(true);
    expect(() =>
      adminParse(attendanceDisputeResolveSchema, {
        expectedCaseVersion: 1,
        expectedDisputeVersion: 2,
        expectedAttendanceVersion: 1,
        resolution: "uphold_current",
        reason: "Подтверждено по материалам",
        reasonCode: "attendance_resolve",
        independentlyVerified: true,
      }),
    ).toThrow();
    expect(
      adminParse(attendanceDisputeResolveSchema, {
        expectedCaseVersion: 1,
        expectedDisputeVersion: 2,
        expectedAttendanceVersion: 1,
        resolution: "insufficient_evidence",
        reason: "Недостаточно независимых сведений",
        reasonCode: "attendance_resolve",
      }).resolution,
    ).toBe("insufficient_evidence");
  });
});
