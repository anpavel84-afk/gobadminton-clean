/**
 * #507 I1 F3 — pure helpers for assigned Cases venue-community exact source read.
 * No Nest provider / no decision handlers / no retention or body copies.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type CommunitySourceUnavailableReason =
  | "venue_unavailable"
  | "revision_missing"
  | "fingerprint_mismatch"
  | "merged_superseded"
  | "vote_missing"
  | "comment_missing"
  | "empty_body";

/** Opaque aggregate vote keyset cursor — bound to case/report/physical venue; not a free UUID oracle. */
const COMMUNITY_AGGREGATE_CURSOR_NS = "venue-community-case-aggregate-cursor:v1";

export type CommunityAggregateCursorBinding = {
  caseId: string;
  reportId: string;
  canonicalVenueId: string;
};

export function encodeCommunityAggregateVoteCursor(
  secret: string,
  input: CommunityAggregateCursorBinding & { beforeVoteId: string },
): string {
  const body = Buffer.from(
    JSON.stringify([
      input.caseId,
      input.reportId,
      input.canonicalVenueId,
      input.beforeVoteId,
    ]),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`${COMMUNITY_AGGREGATE_CURSOR_NS}:`)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Validates HMAC and exact case/report/venue binding. Returns the keyset vote id.
 * Tamper / cross-report / cross-venue / malformed → null (caller maps to CURSOR_INVALID).
 */
export function decodeCommunityAggregateVoteCursor(
  secret: string,
  cursor: string,
  expected: CommunityAggregateCursorBinding,
): string | null {
  if (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 256) return null;
  const parts = cursor.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  const expectedSig = createHmac("sha256", secret)
    .update(`${COMMUNITY_AGGREGATE_CURSOR_NS}:`)
    .update(body)
    .digest("base64url");
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) return null;
  const [caseId, reportId, canonicalVenueId, beforeVoteId] = parsed;
  if (
    typeof caseId !== "string" ||
    typeof reportId !== "string" ||
    typeof canonicalVenueId !== "string" ||
    typeof beforeVoteId !== "string"
  ) {
    return null;
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(caseId) ||
    !uuid.test(reportId) ||
    !uuid.test(canonicalVenueId) ||
    !uuid.test(beforeVoteId)
  ) {
    return null;
  }
  if (
    caseId !== expected.caseId ||
    reportId !== expected.reportId ||
    canonicalVenueId !== expected.canonicalVenueId
  ) {
    return null;
  }
  return beforeVoteId;
}

export type CommunityCommentPublication =
  | "live"
  | "edited"
  | "deleted"
  | "withheld"
  | "unavailable";

export type CommunityVoteSourceAvailability =
  | { available: true }
  | { available: false; reason: CommunitySourceUnavailableReason };

export type CommunityCommentSourceAvailability =
  | {
      available: true;
      text: string | null;
      currentPublication: CommunityCommentPublication;
      currentVersion: number | null;
    }
  | {
      available: false;
      reason: CommunitySourceUnavailableReason;
      text: null;
      currentPublication: CommunityCommentPublication;
      currentVersion: number | null;
    };

/** Exact reported vote revision may be shown only when fingerprint matches and row is not superseded. */
export function evaluateCommunityVoteSourceAvailability(input: {
  voteExists: boolean;
  mergedIntoVoteId: string | null;
  expectedFingerprint: string;
  reportedFingerprint: string | null;
  revisionFound: boolean;
}): CommunityVoteSourceAvailability {
  if (!input.voteExists) return { available: false, reason: "vote_missing" };
  if (!input.revisionFound) return { available: false, reason: "revision_missing" };
  if (input.mergedIntoVoteId != null) {
    return { available: false, reason: "merged_superseded" };
  }
  if (
    input.reportedFingerprint == null ||
    input.reportedFingerprint !== input.expectedFingerprint
  ) {
    return { available: false, reason: "fingerprint_mismatch" };
  }
  return { available: true };
}

/**
 * Exact reported comment revision body (HMAC-bound). Never silently substitutes a newer revision.
 * Current publication is metadata only for staff orientation.
 */
export function evaluateCommunityCommentSourceAvailability(input: {
  revisionFound: boolean;
  reportedBody: string | null;
  reportedPhotoCount?: number;
  expectedFingerprint: string;
  reportedFingerprint: string | null;
  currentDeleted: boolean;
  currentWithheld: boolean;
  currentVersion: number | null;
  reportedVersion: number;
}): CommunityCommentSourceAvailability {
  const currentPublication: CommunityCommentPublication = !input.revisionFound
    ? "unavailable"
    : input.currentDeleted
      ? "deleted"
      : input.currentWithheld
        ? "withheld"
        : input.currentVersion != null && input.currentVersion !== input.reportedVersion
          ? "edited"
          : (input.reportedBody == null || input.reportedBody.length < 1) && !input.reportedPhotoCount
            ? "unavailable"
            : "live";

  if (!input.revisionFound) {
    return {
      available: false,
      reason: "revision_missing",
      text: null,
      currentPublication,
      currentVersion: input.currentVersion,
    };
  }
  if ((input.reportedBody == null || input.reportedBody.length < 1) && !input.reportedPhotoCount) {
    return {
      available: false,
      reason: "empty_body",
      text: null,
      currentPublication,
      currentVersion: input.currentVersion,
    };
  }
  if (
    input.reportedFingerprint == null ||
    input.reportedFingerprint !== input.expectedFingerprint
  ) {
    return {
      available: false,
      reason: "fingerprint_mismatch",
      text: null,
      currentPublication,
      currentVersion: input.currentVersion,
    };
  }
  return {
    available: true,
    text: input.reportedBody,
    currentPublication,
    currentVersion: input.currentVersion,
  };
}

/** Public-count eligibility mirrors venue-community.query predicates for one vote row. */
export function communityVoteEligibleForPublicCount(input: {
  mergedIntoVoteId: string | null;
  withdrawnAt: Date | string | null;
  moderationState: string;
  value: number | null;
  userActive: boolean;
  userUnrestricted: boolean;
  venueLifecycleOk: boolean;
}): boolean {
  return (
    input.mergedIntoVoteId == null &&
    input.withdrawnAt == null &&
    input.moderationState === "clear" &&
    input.value != null &&
    input.value >= 1 &&
    input.value <= 5 &&
    input.userActive &&
    input.userUnrestricted &&
    input.venueLifecycleOk
  );
}

export type CommunityHumanDecision = "retain" | "withhold" | "restore";

/**
 * Staff decision menu for an exact current vote/comment. Retain is metadata-only.
 * Withhold/restore require a live unsuperseded resource; restore never resurrects
 * withdrawn/deleted/tombstoned/merged rows.
 */
export function communityHumanDecisionOptions(input: {
  moderationState: "clear" | "withheld";
  withdrawn: boolean;
  deleted: boolean;
  merged: boolean;
}): CommunityHumanDecision[] {
  if (input.merged || input.deleted || input.withdrawn) {
    return ["retain"];
  }
  const decisions: CommunityHumanDecision[] = ["retain"];
  if (input.moderationState === "clear") decisions.push("withhold");
  if (input.moderationState === "withheld") decisions.push("restore");
  return decisions;
}

/** Whether the requested decision is allowed against the exact locked resource state. */
export function communityHumanDecisionAllowed(
  decision: CommunityHumanDecision,
  input: {
    moderationState: "clear" | "withheld";
    withdrawn: boolean;
    deleted: boolean;
    merged: boolean;
  },
): boolean {
  return communityHumanDecisionOptions(input).includes(decision);
}
