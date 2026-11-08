/** #507 I1 venue community rating + F3 report wire types — mirror OpenAPI 0.40 additive routes. */

export type CommunityAggregateState = "empty" | "available" | "unavailable";

export type CommunityRatingSummary = {
  venueId: string;
  canonicalVenueId: string | null;
  average: number | null;
  count: number | null;
  state: CommunityAggregateState;
};

export type CommunityOwnVote = {
  venueId: string;
  canonicalVenueId: string;
  value: number | null;
  version: number;
  withdrawn: boolean;
  moderationState: "clear" | "withheld";
  allowedActions: {
    upsert: boolean;
    update: boolean;
    withdraw: boolean;
  };
};

export type CommunityOwnVoteResponse = {
  own: CommunityOwnVote | null;
  summary: CommunityRatingSummary;
};

export type CommunitySummariesResponse = {
  items: CommunityRatingSummary[];
};

export type UpsertCommunityRatingRequest = {
  value: number;
  expectedVersion: number;
};

export type WithdrawCommunityRatingRequest = {
  expectedVersion: number;
};

/** Consumer POST /v1/reports targetKind=venue_community (F3 intake). */
export type VenueCommunityReportSubjectKind =
  | "aggregate"
  | "own_vote"
  | "venue_comment";

export type VenueCommunityReportReasonCode =
  | "harassment"
  | "spam"
  | "fake_profile"
  | "inappropriate"
  | "other";

export type CreateVenueCommunityReportRequest = {
  targetKind: "venue_community";
  subjectKind: VenueCommunityReportSubjectKind;
  venueId: string;
  /** Required when subjectKind=venue_comment. */
  commentId?: string;
  /** Required when subjectKind is own_vote or venue_comment. Aggregate has no revision. */
  expectedVersion?: number;
  reasonCode: VenueCommunityReportReasonCode;
  /** Private complainant input — never queued/logged/sent to providers. */
  detail?: string | null;
};

export type VenueCommunityReportReceipt = {
  reportId: string;
  status: "submitted";
  createdAt: string;
};

/** Assigned Cases GET /admin/cases/{id}/community-reports/{reportId} — exact source read only. */
export type CommunitySourceUnavailableReason =
  | "venue_unavailable"
  | "revision_missing"
  | "fingerprint_mismatch"
  | "merged_superseded"
  | "vote_missing"
  | "comment_missing"
  | "empty_body";

export type CommunityCommentPublication =
  | "live"
  | "edited"
  | "deleted"
  | "withheld"
  | "unavailable";

export type AdminCaseCommunityVoteItem = {
  voteId: string;
  value: number | null;
  version: number;
  moderationState: "clear" | "withheld";
  withdrawn: boolean;
  eligibleForPublicCount: boolean;
};

/** Present only when backend venue_community_decide exists — not a fake UI affordance. */
export type AdminCaseCommunityDecisionCapability = {
  action: "venue_community_decide";
  decisions: Array<"retain" | "withhold" | "restore">;
  resourceKind: "vote" | "comment";
  /** Aggregate reports require an exact current voteId from this venue page. */
  requiresExactVoteId?: boolean;
  voteId?: string;
  commentId?: string;
  expectedCaseVersion: number;
  expectedResourceVersion: number | null;
};

export type AdminCaseCommunityAggregateSource = {
  caseId: string;
  reportId: string;
  subjectKind: "aggregate";
  canonicalVenueId: string;
  reasonCode: string;
  reportState: string;
  detail: string | null;
  sourceAvailable: boolean;
  unavailableReason: CommunitySourceUnavailableReason | null;
  summary: CommunityRatingSummary;
  votes: {
    items: AdminCaseCommunityVoteItem[];
    /** Opaque HMAC-bound keyset cursor scoped to this case/report/venue; not a free UUID. */
    nextCursor: string | null;
    limit: number;
  };
  decisionCapability: AdminCaseCommunityDecisionCapability | null;
};

export type AdminCaseCommunityOwnVoteSource = {
  caseId: string;
  reportId: string;
  subjectKind: "own_vote";
  canonicalVenueId: string;
  reasonCode: string;
  reportState: string;
  detail: string | null;
  sourceAvailable: boolean;
  unavailableReason: CommunitySourceUnavailableReason | null;
  voteId: string;
  reportedVersion: number;
  currentVersion: number | null;
  reportedValue: number | null;
  reportedModerationState: "clear" | "withheld" | null;
  reportedWithdrawn: boolean | null;
  currentValue: number | null;
  currentModerationState: "clear" | "withheld" | null;
  currentWithdrawn: boolean | null;
  mergedIntoVoteId: string | null;
  decisionCapability: AdminCaseCommunityDecisionCapability | null;
};

export type AdminCaseCommunityCommentSource = {
  caseId: string;
  reportId: string;
  subjectKind: "venue_comment";
  canonicalVenueId: string;
  reasonCode: string;
  reportState: string;
  detail: string | null;
  sourceAvailable: boolean;
  unavailableReason: CommunitySourceUnavailableReason | null;
  commentId: string;
  reportedVersion: number;
  currentVersion: number | null;
  text: string | null;
  currentPublication: CommunityCommentPublication;
  decisionCapability: AdminCaseCommunityDecisionCapability | null;
};

export type AdminCaseCommunityReportSource =
  | AdminCaseCommunityAggregateSource
  | AdminCaseCommunityOwnVoteSource
  | AdminCaseCommunityCommentSource;
