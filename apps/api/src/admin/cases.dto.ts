import { z } from "zod";
import { reason, uuid } from "./dto";
export const CASE_STATUSES = ["open", "in_review", "resolved", "closed"] as const;
export const CASE_NOTES = ["review_started", "awaiting_information", "information_checked", "escalated", "resolution_recorded"] as const;
const common = { expectedVersion: z.number().int().positive().max(2147483646), reasonCode: reason };
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
export const caseCreateSchema = z.object({ reportId: uuid, reasonCode: reason }).strict();
export const caseCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ...common, principalId: uuid.nullable() }).strict(),
  z.object({ action: z.literal("status"), ...common, status: z.enum(CASE_STATUSES) }).strict(),
  z.object({ action: z.literal("note"), ...common, noteCode: z.enum(CASE_NOTES) }).strict(),
  z.object({ action: z.literal("link_report"), ...common, reportId: uuid }).strict(),
  z.object({ action: z.literal("link_game"), ...common, gameId: uuid }).strict(),
  z.object({ action: z.literal("capture_evidence"), ...common, linkId: uuid }).strict(),
  z
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
    .strict(),
  z
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
    .strict(),
  z
    .object({
      action: z.literal("venue_review_decide"),
      expectedCaseVersion: z.number().int().positive().max(2147483646),
      expectedResourceVersion: z.number().int().min(1).max(2147483647),
      exactRevisionId: uuid,
      decision: z.enum(["approve", "retain", "request_correction", "remove", "restore"]),
      rationale: plainRationale,
      reasonCode: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("venue_community_decide"),
      expectedCaseVersion: z.number().int().positive().max(2147483646),
      expectedResourceVersion: z.number().int().min(1).max(2147483647),
      reportId: uuid,
      resourceKind: z.enum(["vote", "comment"]),
      voteId: uuid.optional(),
      commentId: uuid.optional(),
      decision: z.enum(["retain", "withhold", "restore"]),
      rationale: plainRationale,
      reasonCode: reason,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.resourceKind === "vote") {
        if (!value.voteId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "voteId required", path: ["voteId"] });
        }
        if (value.commentId !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "commentId forbidden", path: ["commentId"] });
        }
      } else {
        if (!value.commentId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "commentId required",
            path: ["commentId"],
          });
        }
        if (value.voteId !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "voteId forbidden", path: ["voteId"] });
        }
      }
    }),
]);
export type CaseCommand = z.infer<typeof caseCommandSchema>;
export type VenueCommunityDecide = Extract<CaseCommand, { action: "venue_community_decide" }>;
export const casePageSchema = z.object({ beforeId: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export const caseHistorySchema = z.object({ beforeVersion: z.coerce.number().int().positive().max(2147483647).optional() }).strict();
export const reportPageSchema = casePageSchema.extend({ reportId: uuid.optional() }).strict();
/**
 * Aggregate vote keyset only — ignored for own_vote / venue_comment subjects.
 * `cursor` is an opaque HMAC-bound token (case/report/venue + vote id); raw UUIDs are rejected.
 */
export const communityReportPageSchema = z
  .object({
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export type CommunityReportPage = z.infer<typeof communityReportPageSchema>;
