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

export const venueReviewPendingPageSchema = z
  .object({
    beforeId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const venueReviewIntakeSchema = z
  .object({
    pendingIntakeId: uuid,
    expectedIntakeVersion: z.number().int().positive().max(2147483646),
    reasonCode: reason,
    assignToSelf: z.literal(true),
  })
  .strict();

export type VenueReviewIntake = z.infer<typeof venueReviewIntakeSchema>;

export const venueReviewDecideSchema = z
  .object({
    action: z.literal("venue_review_decide"),
    expectedCaseVersion: z.number().int().positive().max(2147483646),
    expectedResourceVersion: z.number().int().min(1).max(2147483647),
    exactRevisionId: uuid,
    decision: z.enum(["approve", "retain", "request_correction", "remove", "restore"]),
    rationale: plainRationale,
    reasonCode: reason,
  })
  .strict();

export type VenueReviewDecide = z.infer<typeof venueReviewDecideSchema>;
