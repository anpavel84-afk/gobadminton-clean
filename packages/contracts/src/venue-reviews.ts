/** #394 venue experience review wire types — mirror OpenAPI 0.34 additive routes. */

export type VenueReviewTopic = "surface" | "lighting" | "amenities";
export type VenueReviewAudience = "self_draft" | "public_venue";

export type PublicVenueReviewItem = {
  reviewHandle: string;
  authorLabel: "Участник игры";
  text: string;
  topics: VenueReviewTopic[];
  publishedRevision: number;
  publishedAt: string;
};

export type VenueReviewsSummary = {
  venueId: string;
  publishedCount: number;
  items: PublicVenueReviewItem[];
  nextCursor: string | null;
  canWriteHint: boolean;
};

export type CreateVenueReviewRequest = {
  venueId: string;
  gameId: string;
  audience: VenueReviewAudience;
  expectedBasisVersions: {
    outcomeVersion: number;
    attendanceVersion: number;
  };
  text: string;
  topics?: VenueReviewTopic[];
  consentProjectionHash?: string;
};
