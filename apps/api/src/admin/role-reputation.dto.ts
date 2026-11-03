import { z } from "zod";
import { reason, uuid } from "./dto";

const plainRationale = z
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
  }, { message: "plain text" });

export const roleReputationPendingPageSchema = z
  .object({
    beforeId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    kind: z
      .enum(["review_submit", "reply_submit", "report", "appeal", "basis_dispute"])
      .optional(),
  })
  .strict();

export const roleReputationIntakeSchema = z
  .object({
    pendingIntakeId: uuid,
    expectedIntakeVersion: z.number().int().positive().max(2147483646),
    reasonCode: reason,
    assignToSelf: z.literal(true),
  })
  .strict();

export type RoleReputationIntake = z.infer<typeof roleReputationIntakeSchema>;

export const roleReviewDecideSchema = z
  .object({
    action: z.literal("role_review_decide"),
    expectedCaseVersion: z.number().int().positive().max(2147483646),
    expectedResourceVersion: z.number().int().min(1).max(2147483647),
    targetKind: z.enum(["review", "reply"]),
    exactRevisionId: uuid,
    decision: z.enum(["approve", "retain", "request_correction", "remove", "restore"]),
    rationale: plainRationale,
    reasonCode: reason,
  })
  .strict();

export const roleBasisResolveSchema = z
  .object({
    action: z.literal("role_basis_resolve"),
    expectedCaseVersion: z.number().int().positive().max(2147483646),
    expectedProofVersion: z.number().int().min(1).max(2147483647),
    gameId: uuid,
    role: z.enum(["organization", "training"]),
    decision: z.enum(["resolve_held", "resolve_role"]),
    subjectUserId: uuid,
    acceptedForCount: z.boolean(),
    rationale: plainRationale,
    reasonCode: reason,
  })
  .strict();

export type RoleReviewDecide = z.infer<typeof roleReviewDecideSchema>;
export type RoleBasisResolve = z.infer<typeof roleBasisResolveSchema>;
