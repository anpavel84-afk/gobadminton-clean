import { describe, expect, it } from "vitest";
import {
  communityHumanDecisionAllowed,
  communityHumanDecisionOptions,
  communityVoteEligibleForPublicCount,
  decodeCommunityAggregateVoteCursor,
  encodeCommunityAggregateVoteCursor,
  evaluateCommunityCommentSourceAvailability,
  evaluateCommunityVoteSourceAvailability,
} from "../../src/admin/venue-community-source";

const SECRET = "venue-community-case-source-unit-fingerprint!";
const CASE_ID = "a0000000-0000-4000-8000-000000000001";
const REPORT_ID = "b0000000-0000-4000-8000-000000000001";
const VENUE_ID = "c0000000-0000-4000-8000-000000000001";
const VOTE_ID = "d0000000-0000-4000-8000-000000000001";
const OTHER_REPORT = "b0000000-0000-4000-8000-000000000099";
const OTHER_VENUE = "c0000000-0000-4000-8000-000000000099";

describe("#507 I1 F3 community Cases source policy helpers", () => {
  it("marks merged or fingerprint-mismatched votes unavailable without inventing current text", () => {
    expect(
      evaluateCommunityVoteSourceAvailability({
        voteExists: true,
        mergedIntoVoteId: "00000000-0000-4000-8000-000000000099",
        expectedFingerprint: "a".repeat(64),
        reportedFingerprint: "a".repeat(64),
        revisionFound: true,
      }),
    ).toEqual({ available: false, reason: "merged_superseded" });

    expect(
      evaluateCommunityVoteSourceAvailability({
        voteExists: true,
        mergedIntoVoteId: null,
        expectedFingerprint: "a".repeat(64),
        reportedFingerprint: "b".repeat(64),
        revisionFound: true,
      }),
    ).toEqual({ available: false, reason: "fingerprint_mismatch" });

    expect(
      evaluateCommunityVoteSourceAvailability({
        voteExists: true,
        mergedIntoVoteId: null,
        expectedFingerprint: "a".repeat(64),
        reportedFingerprint: "a".repeat(64),
        revisionFound: true,
      }),
    ).toEqual({ available: true });
  });

  it("keeps exact reported comment body; edited/deleted/withheld are publication metadata only", () => {
    const edited = evaluateCommunityCommentSourceAvailability({
      revisionFound: true,
      reportedBody: "EXACT_REPORTED_BODY",
      expectedFingerprint: "c".repeat(64),
      reportedFingerprint: "c".repeat(64),
      currentDeleted: false,
      currentWithheld: false,
      currentVersion: 3,
      reportedVersion: 1,
    });
    expect(edited).toEqual({
      available: true,
      text: "EXACT_REPORTED_BODY",
      currentPublication: "edited",
      currentVersion: 3,
    });

    const withheld = evaluateCommunityCommentSourceAvailability({
      revisionFound: true,
      reportedBody: "OWN_WITHHELD_BODY",
      expectedFingerprint: "d".repeat(64),
      reportedFingerprint: "d".repeat(64),
      currentDeleted: false,
      currentWithheld: true,
      currentVersion: 1,
      reportedVersion: 1,
    });
    expect(withheld).toEqual({
      available: true,
      text: "OWN_WITHHELD_BODY",
      currentPublication: "withheld",
      currentVersion: 1,
    });

    const deleted = evaluateCommunityCommentSourceAvailability({
      revisionFound: true,
      reportedBody: "OLD_BODY",
      expectedFingerprint: "e".repeat(64),
      reportedFingerprint: "e".repeat(64),
      currentDeleted: true,
      currentWithheld: false,
      currentVersion: 2,
      reportedVersion: 1,
    });
    expect(deleted.available).toBe(true);
    if (deleted.available) {
      expect(deleted.text).toBe("OLD_BODY");
      expect(deleted.currentPublication).toBe("deleted");
    }

    expect(
      evaluateCommunityCommentSourceAvailability({
        revisionFound: true,
        reportedBody: "OLD_BODY",
        expectedFingerprint: "e".repeat(64),
        reportedFingerprint: "f".repeat(64),
        currentDeleted: false,
        currentWithheld: false,
        currentVersion: 1,
        reportedVersion: 1,
      }).available,
    ).toBe(false);
  });

  it("computes public-count eligibility from current flags only", () => {
    expect(
      communityVoteEligibleForPublicCount({
        mergedIntoVoteId: null,
        withdrawnAt: null,
        moderationState: "clear",
        value: 4,
        userActive: true,
        userUnrestricted: true,
        venueLifecycleOk: true,
      }),
    ).toBe(true);
    expect(
      communityVoteEligibleForPublicCount({
        mergedIntoVoteId: null,
        withdrawnAt: null,
        moderationState: "withheld",
        value: 4,
        userActive: true,
        userUnrestricted: true,
        venueLifecycleOk: true,
      }),
    ).toBe(false);
    expect(
      communityVoteEligibleForPublicCount({
        mergedIntoVoteId: null,
        withdrawnAt: new Date(),
        moderationState: "clear",
        value: null,
        userActive: true,
        userUnrestricted: true,
        venueLifecycleOk: true,
      }),
    ).toBe(false);
  });

  it("binds aggregate vote cursor to case/report/venue and rejects tamper/cross-report/cross-venue", () => {
    const binding = {
      caseId: CASE_ID,
      reportId: REPORT_ID,
      canonicalVenueId: VENUE_ID,
    };
    const cursor = encodeCommunityAggregateVoteCursor(SECRET, {
      ...binding,
      beforeVoteId: VOTE_ID,
    });
    expect(decodeCommunityAggregateVoteCursor(SECRET, cursor, binding)).toBe(VOTE_ID);

    // HMAC mismatch / tamper
    const [body] = cursor.split(".");
    expect(
      decodeCommunityAggregateVoteCursor(SECRET, `${body}.deadbeef`, binding),
    ).toBeNull();
    expect(
      decodeCommunityAggregateVoteCursor(SECRET, `${cursor}x`, binding),
    ).toBeNull();

    // Cross-report / cross-venue binding rejection
    expect(
      decodeCommunityAggregateVoteCursor(SECRET, cursor, {
        ...binding,
        reportId: OTHER_REPORT,
      }),
    ).toBeNull();
    expect(
      decodeCommunityAggregateVoteCursor(SECRET, cursor, {
        ...binding,
        canonicalVenueId: OTHER_VENUE,
      }),
    ).toBeNull();

    // Raw UUID is not a valid opaque cursor (no data oracle)
    expect(decodeCommunityAggregateVoteCursor(SECRET, VOTE_ID, binding)).toBeNull();
  });

  it("limits human withhold/restore to live clear/withheld resources and keeps retain metadata-only", () => {
    expect(
      communityHumanDecisionOptions({
        moderationState: "clear",
        withdrawn: false,
        deleted: false,
        merged: false,
      }),
    ).toEqual(["retain", "withhold"]);
    expect(
      communityHumanDecisionOptions({
        moderationState: "withheld",
        withdrawn: false,
        deleted: false,
        merged: false,
      }),
    ).toEqual(["retain", "restore"]);
    expect(
      communityHumanDecisionOptions({
        moderationState: "withheld",
        withdrawn: true,
        deleted: false,
        merged: false,
      }),
    ).toEqual(["retain"]);
    expect(
      communityHumanDecisionAllowed("restore", {
        moderationState: "withheld",
        withdrawn: false,
        deleted: true,
        merged: false,
      }),
    ).toBe(false);
    expect(
      communityHumanDecisionAllowed("withhold", {
        moderationState: "clear",
        withdrawn: false,
        deleted: false,
        merged: true,
      }),
    ).toBe(false);
  });
});
