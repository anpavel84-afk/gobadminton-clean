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

it("#507 I2b ordered exact photo evidence changes the fingerprint without changing legacy text identity",()=>{
  const base={commentId:"c",entityId:"v",resourceVersion:1,bodyText:"text"};
  const secret="synthetic-only";
  const legacy=createHmac("sha256",secret).update(`${VENUE_COMMUNITY_COMMENT_FINGERPRINT_NS}:c:v:1:`).update("text").digest("hex");
  expect(venueCommunityCommentReportFingerprint(secret,base)).toBe(legacy);
  expect(venueCommunityCommentReportFingerprint(secret,{...base,photos:[]})).toBe(legacy);
  const a={id:"a",approvalId:"approval-a",fingerprint:"fp-a",sha256:"sha-a"};
  const b={id:"b",approvalId:"approval-b",fingerprint:"fp-b",sha256:"sha-b"};
  const fingerprint=venueCommunityCommentReportFingerprint(secret,{...base,bodyText:null,photos:[a,b]});
  for(const input of [{...base,bodyText:null,photos:[b,a]}, {...base,bodyText:null,photos:[a]},
    {...base,bodyText:null,photos:[{...a,approvalId:"other"},b]}, {...base,photos:[a,b]},
    {...base,resourceVersion:2,bodyText:null,photos:[a,b]}]) {
    expect(venueCommunityCommentReportFingerprint(secret,input)).not.toBe(fingerprint);
  }
});
