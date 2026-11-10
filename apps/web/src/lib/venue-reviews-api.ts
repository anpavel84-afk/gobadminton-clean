import { apiFetch } from "./api-client";

export type VenueTopic = "surface" | "lighting" | "amenities";
export type VenueAudience = "self_draft" | "public_venue";

export type PublicVenueReviewItem = {
  reviewHandle: string;
  authorLabel: string;
  text: string;
  topics: string[];
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

export type OwnVenueEligibilityBasis = {
  gameId: string;
  gameTitle: string | null;
  admission: "may_submit" | "hold" | "deny" | "missing_history";
  reason: string | null;
  outcomeVersion: number;
  attendanceVersion: number;
  firstEligibleAt: string | null;
  helpHint: "attendance_unmarked" | "attendance_clarifying" | "missing_history" | null;
};

export type OwnVenueReview = {
  id: string;
  reviewHandle: string;
  venueId: string;
  status: string;
  version: number;
  audience: VenueAudience | null;
  text: string | null;
  topics: string[];
  pendingRevision: number | null;
  approvedRevision: number | null;
  publicVisible: boolean;
  notBefore: string | null;
  firstEligibleAt: string | null;
  receiptToken: string | null;
};

export type VenueReviewMutationReceipt = {
  id: string;
  version: number;
  status: string;
  reviewHandle: string;
  receiptToken: string | null;
  publicVisible: boolean;
  notBefore: string | null;
};

export type WithdrawVenueReviewCommand = Readonly<{
  action: "withdraw";
  expectedVersion: number;
}>;

/** The existing withdraw contract increments exactly once and clears publication/intake. */
export function isWithdrawVenueReviewReceipt(
  value: unknown,
  own: Pick<OwnVenueReview, "id" | "reviewHandle" | "version">,
): value is VenueReviewMutationReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<VenueReviewMutationReceipt>;
  return receipt.id === own.id && receipt.reviewHandle === own.reviewHandle
    && Number.isSafeInteger(own.version) && own.version >= 1
    && receipt.version === own.version + 1 && receipt.status === "withdrawn"
    && receipt.publicVisible === false && receipt.receiptToken === null
    && receipt.notBefore === null;
}

export function getVenueExperienceReviews(
  venueId: string,
  opts?: { cursor?: string; limit?: number; signal?: AbortSignal },
) {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return apiFetch<VenueReviewsSummary>(
    `/v1/venues/${encodeURIComponent(venueId)}/experience-reviews${qs ? `?${qs}` : ""}`,
    { signal: opts?.signal },
  );
}

export function getOwnVenueReviewEligibility(venueId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ venueId });
  return apiFetch<{ bases: OwnVenueEligibilityBasis[] }>(
    `/v1/me/venue-reviews/eligibility?${params.toString()}`,
    { signal },
  );
}

export function previewVenueReviewConsent(
  body: { venueId: string; text: string; topics: VenueTopic[] },
  csrfToken: string,
) {
  return apiFetch<{ consentProjectionHash: string; authorLabel: string }>(
    "/v1/me/venue-reviews/consent-preview",
    { method: "POST", body: JSON.stringify(body), csrfToken },
  );
}

export function createVenueReview(
  body: {
    venueId: string;
    gameId: string;
    audience: VenueAudience;
    expectedBasisVersions: { outcomeVersion: number; attendanceVersion: number };
    text: string;
    topics: VenueTopic[];
    consentProjectionHash?: string;
  },
  csrfToken: string,
  idempotencyKey?: string,
) {
  return apiFetch<VenueReviewMutationReceipt>("/v1/me/venue-reviews", {
    method: "POST",
    body: JSON.stringify(body),
    csrfToken,
    idempotent: true,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

export function listOwnVenueReviews(signal?: AbortSignal) {
  return apiFetch<{ items: OwnVenueReview[] }>("/v1/me/venue-reviews", { signal });
}

export function venueReviewCommand(
  id: string,
  body: WithdrawVenueReviewCommand,
  csrfToken: string,
  idempotencyKey?: string,
) {
  return apiFetch<VenueReviewMutationReceipt>(
    `/v1/me/venue-reviews/${encodeURIComponent(id)}/commands`,
    {
      method: "POST",
      body: JSON.stringify(body),
      csrfToken,
      idempotent: true,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    },
  );
}

export function reportVenueReview(
  reviewHandle: string,
  body: {
    expectedRevision: number;
    reasonCode: string;
    explanation?: string;
  },
  csrfToken: string,
  idempotencyKey?: string,
) {
  return apiFetch<{ receiptToken: string }>(
    `/v1/venue-reviews/${encodeURIComponent(reviewHandle)}/reports`,
    {
      method: "POST",
      body: JSON.stringify(body),
      csrfToken,
      idempotent: true,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    },
  );
}
