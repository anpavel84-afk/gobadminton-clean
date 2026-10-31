import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initializeVenueProfile, validateVenueProfile } from "../src/lib/venue-profile-form";

describe("admin venue gallery/profile description form", () => {
  it("includes optional description without inventing license text", () => {
    const draft = initializeVenueProfile({
      profile: { courtCount: 2, amenities: { parking: true, showers: false }, description: "Зал у метро" },
    });
    expect(draft.description).toBe("Зал у метро");
    const saved = validateVenueProfile({ ...draft, profileChanged: true });
    expect(saved.errors).toEqual({});
    expect(saved.patch.profile).toEqual({
      courtCount: 2,
      amenities: { parking: true, showers: false },
      description: "Зал у метро",
    });
  });

  it("clears description with empty field and rejects control characters", () => {
    const draft = initializeVenueProfile({ profile: { courtCount: null, amenities: { parking: null, showers: null }, description: "x" } });
    expect(validateVenueProfile({ ...draft, description: "", profileChanged: true }).patch.profile).toBeNull();
    expect(validateVenueProfile({ ...draft, description: "bad\nline", profileChanged: true }).errors.description).toBeTruthy();
  });

  it("VenuePhoto encodes gallery metadata for Fetch ByteString wire", () => {
    const source = readFileSync(new URL("../src/components/VenuePhoto.tsx", import.meta.url), "utf8");
    expect(source).toContain("encodeURIComponent(value)");
    expect(source).toContain("X-Gallery-Credit-Text");
    expect(source).toContain("wireMeta(evidence.creditText)");
    expect(source).toContain('wireMeta(evidence.permissionBasis.trim())');
  });

  it("VenueProfileFields exposes description editor clear action", () => {
    const source = readFileSync(new URL("../src/components/VenueProfileFields.tsx", import.meta.url), "utf8");
    expect(source).toContain("Краткое публичное описание");
    expect(source).toContain("description: \"\"");
    expect(source).toContain("кортах, удобствах и описании");
  });
});
