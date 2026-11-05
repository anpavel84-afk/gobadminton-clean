import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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
