import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { apiFetch } from "../src/lib/api-client";
import { isWithdrawVenueReviewReceipt, listOwnVenueReviews, venueReviewCommand } from "../src/lib/venue-reviews-api";

vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));

describe("venue-reviews-api surface", () => {
  it("exports create/eligibility/consent helpers without inventing publish timestamps", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/lib/venue-reviews-api.ts"),
      "utf8",
    );
    expect(src).toMatch(/getOwnVenueReviewEligibility/);
    expect(src).toMatch(/previewVenueReviewConsent/);
    expect(src).toMatch(/createVenueReview/);
    expect(src).toMatch(/consentProjectionHash/);
    expect(src).not.toMatch(/publishedAt:\s*new Date/);
    expect(src).not.toMatch(/fake.*approv/i);
  });
});

describe("existing own read and withdraw wire contract", () => {
  beforeEach(() => vi.clearAllMocks());
  it("lists the owner collection and sends only action/version with explicit CSRF/key", async () => {
    await listOwnVenueReviews();
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/me/venue-reviews", { signal: undefined });
    await venueReviewCommand("returned/id", { action: "withdraw", expectedVersion: 7 }, "actor-csrf", "frozen-key");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/me/venue-reviews/returned%2Fid/commands", {
      method: "POST", body: JSON.stringify({ action: "withdraw", expectedVersion: 7 }),
      csrfToken: "actor-csrf", idempotent: true, headers: { "Idempotency-Key": "frozen-key" },
    });
  });
  it("validates the complete withdrawal receipt against the admitted own id/handle/version", () => {
    const own = { id: "returned", reviewHandle: "handle", version: 7 };
    const receipt = { id: own.id, reviewHandle: own.reviewHandle, version: 8, status: "withdrawn", publicVisible: false, receiptToken: null, notBefore: null };
    expect(isWithdrawVenueReviewReceipt(receipt, own)).toBe(true);
    expect(isWithdrawVenueReviewReceipt({ ...receipt, version: 9 }, own)).toBe(false);
    expect(isWithdrawVenueReviewReceipt({ ...receipt, notBefore: "later" }, own)).toBe(false);
    expect(isWithdrawVenueReviewReceipt({ ...receipt, id: "someone-else" }, own)).toBe(false);
    expect(isWithdrawVenueReviewReceipt(null, own)).toBe(false);
  });
});
