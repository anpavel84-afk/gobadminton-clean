import { z } from "zod";
import {
  VENUE_REVIEW_TEXT_MAX,
  VENUE_TOPICS,
  uuid,
} from "./venue-reviews.policy";

const plainBounded = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim())
    .refine((value) => value.length >= 1 && value.length <= max, { message: "bounds" })
    .refine((value) => {
      for (const ch of value) {
        const code = ch.codePointAt(0) ?? 0;
        if (code === 0x0a) continue;
        if (code < 0x20 || code === 0x7f) return false;
      }
      return true;
    }, { message: "plain text" });

const topicEnum = z.enum(VENUE_TOPICS);
const consentHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((v) => v.toLowerCase());

export const createVenueReviewRequest = z
  .object({
    venueId: uuid,
    gameId: uuid,
    audience: z.enum(["self_draft", "public_venue"]),
    expectedBasisVersions: z
      .object({
        outcomeVersion: z.number().int().min(0).max(2147483647),
        attendanceVersion: z.number().int().min(0).max(2147483647),
      })
      .strict(),
    text: plainBounded(VENUE_REVIEW_TEXT_MAX),
    topics: z.array(topicEnum).max(3).default([]),
    consentProjectionHash: consentHash.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.audience === "public_venue" && !body.consentProjectionHash) {
      ctx.addIssue({
        code: "custom",
        path: ["consentProjectionHash"],
        message: "consent required for public",
      });
    }
    if (body.audience === "self_draft" && body.consentProjectionHash !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["consentProjectionHash"],
        message: "consent only for public",
      });
    }
  });

export type CreateVenueReviewRequest = z.infer<typeof createVenueReviewRequest>;

export const venueReviewCommandRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("submit_revision"),
      expectedVersion: z.number().int().min(1).max(2147483647),
      gameId: uuid,
      audience: z.enum(["self_draft", "public_venue"]),
      expectedBasisVersions: z
        .object({
          outcomeVersion: z.number().int().min(0).max(2147483647),
          attendanceVersion: z.number().int().min(0).max(2147483647),
        })
        .strict(),
      text: plainBounded(VENUE_REVIEW_TEXT_MAX),
      topics: z.array(topicEnum).max(3).default([]),
      consentProjectionHash: consentHash.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("withdraw"),
      expectedVersion: z.number().int().min(1).max(2147483647),
    })
    .strict(),
  z
    .object({
      action: z.literal("resubmit"),
      expectedVersion: z.number().int().min(1).max(2147483647),
      gameId: uuid,
      audience: z.enum(["public_venue"]),
      expectedBasisVersions: z
        .object({
          outcomeVersion: z.number().int().min(0).max(2147483647),
          attendanceVersion: z.number().int().min(0).max(2147483647),
        })
        .strict(),
      text: plainBounded(VENUE_REVIEW_TEXT_MAX),
      topics: z.array(topicEnum).max(3).default([]),
      consentProjectionHash: consentHash,
    })
    .strict(),
  z
    .object({
      action: z.literal("appeal"),
      expectedVersion: z.number().int().min(1).max(2147483647),
      explanation: plainBounded(VENUE_REVIEW_TEXT_MAX),
    })
    .strict(),
]);

export type VenueReviewCommandRequest = z.infer<typeof venueReviewCommandRequest>;

export const venueReviewReportRequest = z
  .object({
    expectedRevision: z.number().int().min(1).max(2147483647),
    reasonCode: z.enum([
      "harassment",
      "spam",
      "inappropriate",
      "pii",
      "threat",
      "fabrication",
      "other",
    ]),
    explanation: plainBounded(VENUE_REVIEW_TEXT_MAX).optional(),
  })
  .strict();

export const consentPreviewRequest = z
  .object({
    venueId: uuid,
    text: plainBounded(VENUE_REVIEW_TEXT_MAX),
    topics: z.array(topicEnum).max(3).default([]),
  })
  .strict();

export type PublicVenueReviewItemDto = {
  reviewHandle: string;
  authorLabel: typeof import("./venue-reviews.policy").PUBLIC_AUTHOR_LABEL;
  text: string;
  topics: string[];
  publishedRevision: number;
  publishedAt: string;
};

export type VenueReviewsSummaryDto = {
  venueId: string;
  publishedCount: number;
  items: PublicVenueReviewItemDto[];
  nextCursor: string | null;
  canWriteHint: boolean;
};

export type OwnVenueEligibilityBasisDto = {
  gameId: string;
  gameTitle: string | null;
  admission: "may_submit" | "hold" | "deny" | "missing_history";
  reason: string | null;
  outcomeVersion: number;
  attendanceVersion: number;
  firstEligibleAt: string | null;
  helpHint: "attendance_unmarked" | "attendance_clarifying" | "missing_history" | null;
};

export type OwnVenueReviewDto = {
  id: string;
  reviewHandle: string;
  venueId: string;
  status: string;
  version: number;
  audience: "self_draft" | "public_venue" | null;
  text: string | null;
  topics: string[];
  pendingRevision: number | null;
  approvedRevision: number | null;
  publicVisible: boolean;
  notBefore: string | null;
  firstEligibleAt: string | null;
  receiptToken: string | null;
};

/** Owner-only selected snapshot. Provenance belongs to the selected persisted revision. */
export type SelectedOwnVenueReviewDto = OwnVenueReviewDto & {
  editContext: {
    revisionId: string;
    resourceVersion: number;
    gameId: string;
    basis: OwnVenueEligibilityBasisDto;
  } | null;
  editUnavailableReason: "withdrawn" | "missing_history" | null;
};

export type VenueReviewMutationReceiptDto = {
  id: string;
  version: number;
  status: string;
  reviewHandle: string;
  receiptToken: string | null;
  publicVisible: boolean;
  notBefore: string | null;
};
