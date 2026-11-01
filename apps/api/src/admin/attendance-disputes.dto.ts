import { z } from "zod";
import { reason, uuid } from "./dto";

export const ATTENDANCE_DISPUTE_RESOLUTIONS = [
  "uphold_current",
  "correct_present",
  "correct_absent",
  "clear_unknown",
  "insufficient_evidence",
] as const;

export const attendanceDisputeIntakeSchema = z
  .object({
    disputeId: uuid,
    expectedDisputeVersion: z.number().int().positive().max(2147483646),
    reasonCode: reason,
    assignToSelf: z.literal(true),
  })
  .strict();

export const attendanceDisputeResolveSchema = z
  .object({
    expectedCaseVersion: z.number().int().positive().max(2147483646),
    expectedDisputeVersion: z.number().int().positive().max(2147483646),
    expectedAttendanceVersion: z.number().int().min(0).max(2147483647),
    resolution: z.enum(ATTENDANCE_DISPUTE_RESOLUTIONS),
    reason: z
      .string()
      .max(500)
      .transform((value) => value.trim())
      .refine((value) => value.length >= 1 && value.length <= 500, { message: "bounds" })
      .refine((value) => {
        for (const ch of value) {
          const code = ch.codePointAt(0) ?? 0;
          if (code < 0x20 || code === 0x7f) return false;
        }
        return true;
      }, { message: "plain text" }),
    reasonCode: reason,
  })
  .strict();

export type AttendanceDisputeIntake = z.infer<typeof attendanceDisputeIntakeSchema>;
export type AttendanceDisputeResolve = z.infer<typeof attendanceDisputeResolveSchema>;
