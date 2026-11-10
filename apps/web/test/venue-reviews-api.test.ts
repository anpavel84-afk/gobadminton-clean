import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { apiFetch } from "../src/lib/api-client";
import { getOwnVenueReview, isSubmitVenueReviewReceipt, isWithdrawVenueReviewReceipt, listOwnVenueReviews, venueReviewCommand } from "../src/lib/venue-reviews-api";
import type { SubmitVenueReviewCommand } from "../src/lib/venue-reviews-api";

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


describe("selected private edit wire contract", () => {
  it("reads only selected id and preserves exact revision command versions and consent", async () => {
    await getOwnVenueReview("returned/id");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/me/venue-reviews/returned%2Fid", { signal: undefined });
    const body = { action: "submit_revision", expectedVersion: 17, gameId: "persisted-game",
      audience: "public_venue", text: "Exact text", topics: ["surface", "lighting"],
      expectedBasisVersions: { outcomeVersion: 8, attendanceVersion: 9 }, consentProjectionHash: "exact-hash" } satisfies SubmitVenueReviewCommand;
    await venueReviewCommand("returned/id", body, "frozen-csrf", "frozen-key");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/me/venue-reviews/returned%2Fid/commands", {
      method: "POST", body: JSON.stringify(body), csrfToken: "frozen-csrf", idempotent: true,
      headers: { "Idempotency-Key": "frozen-key" },
    });
  });
  it("accepts only action-appropriate edit receipts with exact slot increment", () => {
    const own = { id: "own", reviewHandle: "handle", version: 17 };
    const receipt = { ...own, version: 18, status: "revision_waiting", publicVisible: true,
      receiptToken: "human-pending", notBefore: null };
    expect(isSubmitVenueReviewReceipt(receipt, own, "public_venue")).toBe(true);
    expect(isSubmitVenueReviewReceipt(receipt, own, "self_draft")).toBe(false);
    expect(isSubmitVenueReviewReceipt({ ...receipt, status: "published" }, own, "public_venue")).toBe(false);
    expect(isSubmitVenueReviewReceipt({ ...receipt, version: 19 }, own, "public_venue")).toBe(false);
    expect(isSubmitVenueReviewReceipt({ ...receipt, id: "other" }, own, "public_venue")).toBe(false);
    expect(isSubmitVenueReviewReceipt({ ...receipt, receiptToken: null }, own, "self_draft")).toBe(true);
  });
});
