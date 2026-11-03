import { z } from "zod";
import {
  ORGANIZATION_TOPICS,
  ROLE_REPUTATION_TEXT_MAX,
  TRAINING_TOPICS,
  uuid,
  type RoleKind,
} from "./role-reputation.policy";

/** Multiline plain text: CRLF→LF, allow LF, reject NUL/other controls, trim, bound. */
const plainBounded = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) =>
      value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim(),
    )
    .refine((value) => value.length >= 1 && value.length <= max, { message: "bounds" })
    .refine((value) => {
      for (const ch of value) {
        const code = ch.codePointAt(0) ?? 0;
        if (code === 0x0a) continue;
        if (code < 0x20 || code === 0x7f) return false;
      }
      return true;
    }, { message: "plain text" });

const topicEnum = z.enum([
  ...ORGANIZATION_TOPICS,
  ...TRAINING_TOPICS,
]);

const handle32 = z
  .string()
  .regex(/^[0-9a-f]{32}$/i)
  .transform((v) => v.toLowerCase());

const consentHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((v) => v.toLowerCase());

export const createRoleReviewRequest = z
  .object({
    gameId: uuid,
    role: z.enum(["organization", "training"]),
    expectedBasisVersions: z
      .object({
        proofVersion: z.number().int().min(1).max(2147483647),
        outcomeVersion: z.number().int().min(0).max(2147483647),
        attendanceVersion: z.number().int().min(0).max(2147483647),
      })
      .strict(),
    text: plainBounded(ROLE_REPUTATION_TEXT_MAX),
    topics: z.array(topicEnum).max(2).default([]),
    consentProjectionHash: consentHash,
  })
  .strict();

export type CreateRoleReviewRequest = z.infer<typeof createRoleReviewRequest>;

export const roleReviewCommandRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("submit_revision"),
      expectedVersion: z.number().int().min(1).max(2147483647),
      gameId: uuid,
      expectedBasisVersions: z
        .object({
          proofVersion: z.number().int().min(1).max(2147483647),
          outcomeVersion: z.number().int().min(0).max(2147483647),
          attendanceVersion: z.number().int().min(0).max(2147483647),
        })
        .strict(),
      text: plainBounded(ROLE_REPUTATION_TEXT_MAX),
      topics: z.array(topicEnum).max(2).default([]),
      consentProjectionHash: consentHash,
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
      expectedBasisVersions: z
        .object({
          proofVersion: z.number().int().min(1).max(2147483647),
          outcomeVersion: z.number().int().min(0).max(2147483647),
          attendanceVersion: z.number().int().min(0).max(2147483647),
        })
        .strict(),
      text: plainBounded(ROLE_REPUTATION_TEXT_MAX),
      topics: z.array(topicEnum).max(2).default([]),
      consentProjectionHash: consentHash,
    })
    .strict(),
  z
    .object({
      action: z.literal("appeal"),
      expectedVersion: z.number().int().min(1).max(2147483647),
      explanation: plainBounded(ROLE_REPUTATION_TEXT_MAX),
    })
    .strict(),
]);

export type RoleReviewCommandRequest = z.infer<typeof roleReviewCommandRequest>;

export const roleReplyCommandRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("submit_revision"),
      expectedVersion: z.number().int().min(0).max(2147483647),
      expectedReviewRevision: z.number().int().min(1).max(2147483647),
      text: plainBounded(ROLE_REPUTATION_TEXT_MAX),
      consentProjectionHash: consentHash,
    })
    .strict(),
  z
    .object({
      action: z.literal("withdraw"),
      expectedVersion: z.number().int().min(1).max(2147483647),
    })
    .strict(),
]);

export type RoleReplyCommandRequest = z.infer<typeof roleReplyCommandRequest>;

export const roleReviewReportRequest = z
  .object({
    targetKind: z.enum(["review", "reply"]),
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
    explanation: plainBounded(ROLE_REPUTATION_TEXT_MAX).optional(),
  })
  .strict();

export type RoleReviewReportRequest = z.infer<typeof roleReviewReportRequest>;

const consentPreviewReviewBody = z
  .object({
    targetKind: z.literal("review").optional(),
    role: z.enum(["organization", "training"]),
    subjectRoleHandle: handle32,
    text: plainBounded(ROLE_REPUTATION_TEXT_MAX),
    topics: z.array(topicEnum).max(2).default([]),
  })
  .strict();

const consentPreviewReplyBody = z
  .object({
    targetKind: z.literal("reply"),
    reviewHandle: handle32,
    text: plainBounded(ROLE_REPUTATION_TEXT_MAX),
  })
  .strict();

/** Review shape stays backwards-compatible (targetKind optional/omitted). Reply is strict. */
export const consentPreviewRequest = z.union([
  consentPreviewReplyBody,
  consentPreviewReviewBody,
]);

export type ConsentPreviewRequest = z.infer<typeof consentPreviewRequest>;

export type PublicRoleReplyDto = {
  text: string;
  experienceState: "published";
  publishedRevision: number;
};

/** Subject-only reply tip metadata — no pending body text in public projection. */
export type SubjectOwnReplyContextDto = {
  status: string;
  version: number;
  pendingRevision: number | null;
};

export type PublicRoleReviewItemDto = {
  reviewHandle: string;
  role: RoleKind;
  text: string;
  topics: string[];
  authorLabel: "Участник игры" | "Участник тренировки";
  experienceState: "published" | "basis_under_review";
  /** Approved review revision resource_version (for report/reply expectedRevision). */
  publishedRevision: number;
  /** Reply tip aggregate version; 0 when no reply row yet (first submit expectedVersion). */
  replyAggregateVersion: number;
  reply: PublicRoleReplyDto | null;
  /** Populated only for the role subject viewer; null for other readers. */
  subjectOwnReply: SubjectOwnReplyContextDto | null;
  allowedActions: {
    canReport: boolean;
    canReply: boolean;
  };
};

export type RoleReputationSummaryDto = {
  roleHandle: string;
  role: RoleKind;
  subjectDisplayName: string | null;
  heldGamesCount: number | null;
  countScope: "confirmed_history";
  historyMayBeIncomplete: true;
  publishedReviewCount: number;
  projectionVersion: string;
  items: PublicRoleReviewItemDto[];
  nextCursor: string | null;
  availability: "available" | "unavailable";
};

/** Compact card footer projection — no review bodies; server-computed counts only. */
export type RoleReputationCardSummaryDto = {
  roleHandle: string;
  role: RoleKind;
  subjectDisplayName: string | null;
  heldGamesCount: number | null;
  countScope: "confirmed_history";
  historyMayBeIncomplete: true;
  publishedReviewCount: number;
  projectionVersion: string;
  availability: "available" | "unavailable";
};

export type GameRoleReputationCardDto = {
  gameId: string;
  organization: RoleReputationCardSummaryDto | null;
  training: RoleReputationCardSummaryDto | null;
};

export type OwnEligibilityBasisDto = {
  gameId: string;
  role: RoleKind;
  endsAt: string;
  proofVersion: number;
  outcomeVersion: number;
  attendanceVersion: number;
  projectionHashPreview: string | null;
  admission: "may_submit" | "deny" | "hold";
  reason: string | null;
};

export type OwnEligibilityDto = {
  roleHandle: string;
  role: RoleKind;
  bases: OwnEligibilityBasisDto[];
};

export type OwnRoleReviewDto = {
  id: string;
  reviewHandle: string;
  role: RoleKind;
  /** Opaque public subject handle — UI recipient without private subject user id. */
  roleHandle: string;
  subjectDisplayName: string | null;
  status: string;
  version: number;
  text: string | null;
  topics: string[];
  receiptToken: string | null;
  pendingIntakeStatus: "waiting_intake" | "linked" | "none";
  approvedRevision: number | null;
  pendingRevision: number | null;
};

export type RoleReviewMutationReceiptDto = {
  id: string;
  reviewHandle: string;
  version: number;
  status: string;
  receiptToken: string;
  pendingIntakeStatus: "waiting_intake" | "linked";
};
