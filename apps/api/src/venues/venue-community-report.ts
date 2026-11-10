import { createHmac } from "node:crypto";
import { unprocessable } from "../auth/problem";

/** #507 I1 F3 — venue-community abuse report subject kinds (exact binding). */
export const VENUE_COMMUNITY_REPORT_SUBJECT_KINDS = [
  "aggregate",
  "own_vote",
  "venue_comment",
] as const;

export type VenueCommunityReportSubjectKind =
  (typeof VENUE_COMMUNITY_REPORT_SUBJECT_KINDS)[number];

export const VENUE_COMMUNITY_REPORT_REASON_CODES = [
  "harassment",
  "spam",
  "fake_profile",
  "inappropriate",
  "other",
] as const;

export type VenueCommunityReportReasonCode =
  (typeof VENUE_COMMUNITY_REPORT_REASON_CODES)[number];

export const VENUE_COMMUNITY_COMMENT_FINGERPRINT_NS =
  "venue-community-comment-report-fingerprint:v1" as const;
export const VENUE_COMMUNITY_VOTE_FINGERPRINT_NS =
  "venue-community-vote-report-fingerprint:v1" as const;

/** Report intake rate — separate from content-moderation AI quotas. */
export const VENUE_COMMUNITY_REPORT_RATE_WINDOW = 30;
export const VENUE_COMMUNITY_REPORT_RATE_DAY = 100;

export type CreateVenueCommunityReportInput = {
  targetKind: "venue_community";
  subjectKind: VenueCommunityReportSubjectKind;
  venueId: string;
  commentId?: string;
  expectedVersion?: number;
  reasonCode: VenueCommunityReportReasonCode;
  detail?: string | null;
};

export type NormalizedVenueCommunityReport = {
  targetKind: "venue_community";
  subjectKind: VenueCommunityReportSubjectKind;
  venueId: string;
  commentId: string | null;
  expectedVersion: number | null;
  reasonCode: VenueCommunityReportReasonCode;
  detail: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isVenueCommunityReportUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isVenueCommunityReportSubjectKind(
  value: string,
): value is VenueCommunityReportSubjectKind {
  return (VENUE_COMMUNITY_REPORT_SUBJECT_KINDS as readonly string[]).includes(value);
}

export function isVenueCommunityReportReason(
  value: string,
): value is VenueCommunityReportReasonCode {
  return (VENUE_COMMUNITY_REPORT_REASON_CODES as readonly string[]).includes(value);
}

/** Plain complainant detail: bounds + no control chars. Never logged or sent to providers. */
export function normalizeVenueCommunityReportDetail(
  detail: unknown,
): string | null {
  if (detail === undefined || detail === null) return null;
  if (typeof detail !== "string") {
    throw unprocessable("REPORT_DETAIL_INVALID", "Некорректный detail");
  }
  const trimmed = detail.trim();
  if (trimmed.length < 1 || trimmed.length > 1000) {
    throw unprocessable("REPORT_DETAIL_INVALID", "Некорректный detail");
  }
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      throw unprocessable("REPORT_DETAIL_INVALID", "Некорректный detail");
    }
  }
  return trimmed;
}

export function normalizeVenueCommunityReport(
  input: CreateVenueCommunityReportInput,
): NormalizedVenueCommunityReport {
  if (!input || input.targetKind !== "venue_community") {
    throw unprocessable("TARGET_KIND_INVALID", "Некорректный targetKind");
  }
  if (!isVenueCommunityReportSubjectKind(input.subjectKind)) {
    throw unprocessable("SUBJECT_KIND_INVALID", "Некорректный subjectKind");
  }
  if (!input.venueId || !isVenueCommunityReportUuid(input.venueId)) {
    throw unprocessable("VENUE_ID_INVALID", "Некорректный venueId");
  }
  if (!isVenueCommunityReportReason(input.reasonCode)) {
    throw unprocessable("REASON_CODE_INVALID", "Некорректный reasonCode");
  }
  if (
    "evidenceRefs" in input &&
    (input as { evidenceRefs?: unknown }).evidenceRefs !== undefined
  ) {
    throw unprocessable(
      "EVIDENCE_REFS_INVALID",
      "evidenceRefs недопустимы для жалобы на сообщество площадки",
    );
  }
  if (
    "voteId" in input &&
    (input as { voteId?: unknown }).voteId !== undefined
  ) {
    throw unprocessable(
      "VOTE_ID_INVALID",
      "Идентификатор чужого голоса не принимается",
    );
  }
  if (
    "reporterUserId" in input &&
    (input as { reporterUserId?: unknown }).reporterUserId !== undefined
  ) {
    throw unprocessable("REPORTER_FORGERY", "reporterUserId недопустим");
  }
  if (
    "contentFingerprint" in input &&
    (input as { contentFingerprint?: unknown }).contentFingerprint !== undefined
  ) {
    throw unprocessable(
      "FINGERPRINT_FORGERY",
      "contentFingerprint недопустим от клиента",
    );
  }

  const detail = normalizeVenueCommunityReportDetail(input.detail);
  let commentId: string | null = null;
  let expectedVersion: number | null = null;

  if (input.subjectKind === "aggregate") {
    if (input.commentId !== undefined && input.commentId !== null) {
      throw unprocessable(
        "SUBJECT_FIELDS_INVALID",
        "commentId недопустим для aggregate",
      );
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      throw unprocessable(
        "SUBJECT_FIELDS_INVALID",
        "expectedVersion недопустим для aggregate",
      );
    }
  } else if (input.subjectKind === "own_vote") {
    if (input.commentId !== undefined && input.commentId !== null) {
      throw unprocessable(
        "SUBJECT_FIELDS_INVALID",
        "commentId недопустим для own_vote",
      );
    }
    if (
      input.expectedVersion === undefined ||
      input.expectedVersion === null ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.expectedVersion > 2147483647
    ) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    expectedVersion = input.expectedVersion;
  } else {
    if (!input.commentId || !isVenueCommunityReportUuid(input.commentId)) {
      throw unprocessable("COMMENT_ID_INVALID", "Некорректный commentId");
    }
    if (
      input.expectedVersion === undefined ||
      input.expectedVersion === null ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      input.expectedVersion > 2147483647
    ) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    commentId = input.commentId;
    expectedVersion = input.expectedVersion;
  }

  return {
    targetKind: "venue_community",
    subjectKind: input.subjectKind,
    venueId: input.venueId,
    commentId,
    expectedVersion,
    reasonCode: input.reasonCode,
    detail,
  };
}

/** Exact comment body HMAC — reference only; body stays in entity_comments. */
export function venueCommunityCommentReportFingerprint(
  secret: string,
  input: {
    commentId: string;
    entityId: string;
    resourceVersion: number;
    bodyText: string | null;
    photos?: readonly { id: string; approvalId: string; fingerprint: string; sha256: string }[];
  },
): string {
  if (input.photos?.length) return createHmac("sha256",secret)
    .update("venue-community-comment-photo-report-fingerprint:v2:")
    .update(JSON.stringify([input.commentId,input.entityId,input.resourceVersion,input.bodyText,
      input.photos.map(p=>[p.id,p.approvalId,p.fingerprint,p.sha256])])).digest("hex");
  return createHmac("sha256", secret)
    .update(
      `${VENUE_COMMUNITY_COMMENT_FINGERPRINT_NS}:${input.commentId}:${input.entityId}:${input.resourceVersion}:`,
    )
    .update(input.bodyText ?? "", "utf8")
    .digest("hex");
}

/** Exact own-vote reference HMAC — no public voter list; binds actor-owned row. */
export function venueCommunityVoteReportFingerprint(
  secret: string,
  input: {
    voteId: string;
    canonicalVenueId: string;
    userId: string;
    resourceVersion: number;
    value: number | null;
    moderationState: string;
    withdrawn: boolean;
  },
): string {
  const valuePart = input.value == null ? "null" : String(input.value);
  return createHmac("sha256", secret)
    .update(
      `${VENUE_COMMUNITY_VOTE_FINGERPRINT_NS}:${input.voteId}:${input.canonicalVenueId}:${input.userId}:${input.resourceVersion}:${valuePart}:${input.moderationState}:${input.withdrawn ? "1" : "0"}`,
    )
    .digest("hex");
}

/** Binding row shape used for idempotent same-source replay (no detail). */
export function venueCommunityReportBindingKey(input: {
  subjectKind: VenueCommunityReportSubjectKind;
  canonicalVenueId: string;
  voteId: string | null;
  commentId: string | null;
  reportedResourceVersion: number | null;
  contentFingerprint: string | null;
}): string {
  if (input.subjectKind === "aggregate") {
    return `aggregate:${input.canonicalVenueId}`;
  }
  if (input.subjectKind === "own_vote") {
    return `own_vote:${input.voteId}:${input.reportedResourceVersion}:${input.contentFingerprint}`;
  }
  return `venue_comment:${input.commentId}:${input.reportedResourceVersion}:${input.contentFingerprint}`;
}
