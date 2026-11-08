import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeVenueCommunityReport,
  normalizeVenueCommunityReportDetail,
  venueCommunityCommentReportFingerprint,
  venueCommunityReportBindingKey,
  venueCommunityVoteReportFingerprint,
  VENUE_COMMUNITY_COMMENT_FINGERPRINT_NS,
  VENUE_COMMUNITY_VOTE_FINGERPRINT_NS,
} from "../../src/venues/venue-community-report";

describe("#507 I1 F3 venue-community report policy", () => {
  const venueId = "00000000-0000-4000-8000-000000000001";
  const commentId = "00000000-0000-4000-8000-000000000002";

  it("normalizes aggregate without version or commentId", () => {
    const n = normalizeVenueCommunityReport({
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "other",
      detail: "  suspected stuffing  ",
    });
    expect(n).toEqual({
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      commentId: null,
      expectedVersion: null,
      reasonCode: "other",
      detail: "suspected stuffing",
    });
  });

  it("requires expectedVersion for own_vote and rejects client voteId", () => {
    expect(() =>
      normalizeVenueCommunityReport({
        targetKind: "venue_community",
        subjectKind: "own_vote",
        venueId,
        reasonCode: "inappropriate",
      } as never),
    ).toThrow();
    expect(() =>
      normalizeVenueCommunityReport({
        targetKind: "venue_community",
        subjectKind: "own_vote",
        venueId,
        expectedVersion: 1,
        reasonCode: "inappropriate",
        voteId: venueId,
      } as never),
    ).toThrow();
    const ok = normalizeVenueCommunityReport({
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId,
      expectedVersion: 2,
      reasonCode: "inappropriate",
    });
    expect(ok.expectedVersion).toBe(2);
    expect(ok.commentId).toBeNull();
  });

  it("requires commentId+version for venue_comment and rejects fingerprint forgery", () => {
    expect(() =>
      normalizeVenueCommunityReport({
        targetKind: "venue_community",
        subjectKind: "venue_comment",
        venueId,
        expectedVersion: 1,
        reasonCode: "spam",
      } as never),
    ).toThrow();
    expect(() =>
      normalizeVenueCommunityReport({
        targetKind: "venue_community",
        subjectKind: "venue_comment",
        venueId,
        commentId,
        expectedVersion: 1,
        reasonCode: "spam",
        contentFingerprint: "a".repeat(64),
      } as never),
    ).toThrow();
    const ok = normalizeVenueCommunityReport({
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId,
      expectedVersion: 3,
      reasonCode: "harassment",
      detail: null,
    });
    expect(ok.commentId).toBe(commentId);
    expect(ok.expectedVersion).toBe(3);
  });

  it("rejects control characters and empty detail", () => {
    expect(() => normalizeVenueCommunityReportDetail("a\nb")).toThrow();
    expect(() => normalizeVenueCommunityReportDetail("")).toThrow();
    expect(normalizeVenueCommunityReportDetail(null)).toBeNull();
  });

  it("builds exact comment/vote fingerprints without exposing raw authority", () => {
    const secret = "unit-venue-community-fingerprint-secret!!";
    const commentFp = venueCommunityCommentReportFingerprint(secret, {
      commentId,
      entityId: venueId,
      resourceVersion: 1,
      bodyText: "hello",
    });
    expect(commentFp).toBe(
      createHmac("sha256", secret)
        .update(
          `${VENUE_COMMUNITY_COMMENT_FINGERPRINT_NS}:${commentId}:${venueId}:1:`,
        )
        .update("hello", "utf8")
        .digest("hex"),
    );
    const voteFp = venueCommunityVoteReportFingerprint(secret, {
      voteId: commentId,
      canonicalVenueId: venueId,
      userId: "00000000-0000-4000-8000-000000000003",
      resourceVersion: 2,
      value: 5,
      moderationState: "withheld",
      withdrawn: false,
    });
    expect(voteFp).toHaveLength(64);
    expect(voteFp).toBe(
      createHmac("sha256", secret)
        .update(
          `${VENUE_COMMUNITY_VOTE_FINGERPRINT_NS}:${commentId}:${venueId}:00000000-0000-4000-8000-000000000003:2:5:withheld:0`,
        )
        .digest("hex"),
    );
    expect(
      venueCommunityReportBindingKey({
        subjectKind: "aggregate",
        canonicalVenueId: venueId,
        voteId: null,
        commentId: null,
        reportedResourceVersion: null,
        contentFingerprint: null,
      }),
    ).toBe(`aggregate:${venueId}`);
  });
});
