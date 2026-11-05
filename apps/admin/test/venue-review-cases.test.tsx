import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("VenueReviewCases admin surface", () => {
  it("reuses Cases navigation and does not invent RBAC permissions", () => {
    const cases = readFileSync(
      path.resolve(__dirname, "../src/components/Cases.tsx"),
      "utf8",
    );
    const panel = readFileSync(
      path.resolve(__dirname, "../src/components/VenueReviewCases.tsx"),
      "utf8",
    );
    expect(cases).toMatch(/VenueReviewCases/);
    expect(panel).toMatch(/venue-reviews\/pending-intakes/);
    expect(panel).toMatch(/venue_review_decide/);
    expect(panel).toMatch(/pilot_viewer/);
    expect(panel).not.toMatch(/newPermission|grantCases|venue\.admin/);
  });
});
