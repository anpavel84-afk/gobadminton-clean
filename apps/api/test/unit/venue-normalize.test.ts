import { describe, expect, it } from "vitest";
import {
  NORMALIZATION_LIMITS,
  extractIdentityDiscriminator,
  isAdvisoryFuzzyNeighbor,
  jaccard,
  normalizeVenueText,
  venueDedupeKey,
} from "../../src/venues/venue-normalize";

describe("venue v1 normalization", () => {
  it("applies NFKC, ё→е, case, spacing and punctuation while keeping hall numbers", () => {
    expect(normalizeVenueText("  Олимпийский   ЗАЛ-1  ")).toBe("олимпийский зал 1");
    expect(normalizeVenueText("Ёлки-зал")).toBe("елки зал");
    expect(normalizeVenueText("Hall - 2")).toBe("hall 2");
  });

  it("treats case/spacing equivalents as the same identity key", () => {
    const cityId = "a0000000-0000-4000-8000-000000000001";
    const a = venueDedupeKey({
      cityId,
      normalizedName: normalizeVenueText("Спортзал Олимп"),
      normalizedAddress: normalizeVenueText("ул. Ленина, 10"),
      identityDiscriminator: "",
    });
    const b = venueDedupeKey({
      cityId,
      normalizedName: normalizeVenueText("  спортзал   олимп "),
      normalizedAddress: normalizeVenueText("ул Ленина 10"),
      identityDiscriminator: "",
    });
    expect(a).toBe(b);
  });

  it("keeps distinct hall/building/unit identities", () => {
    expect(extractIdentityDiscriminator("Олимпийский зал 1", "Ленина 10")).toContain(
      "hall:1",
    );
    expect(extractIdentityDiscriminator("Олимпийский зал 2", "Ленина 10")).toContain(
      "hall:2",
    );
    expect(extractIdentityDiscriminator("QA Спортзал зал 2", "QA Avenue")).toBe(
      "hall:2",
    );
    expect(extractIdentityDiscriminator("QA Спортзал", "QA Avenue")).toBe("");
    expect(extractIdentityDiscriminator("Корпус 3", "unit 4")).toBe(
      "building:3|unit:4",
    );
  });

  it("does not treat nearby different names as exact, only conservative fuzzy", () => {
    expect(jaccard("s00a court", "ls04 court")).toBeLessThan(0.4);
    expect(
      isAdvisoryFuzzyNeighbor({
        nameJaccard: jaccard("олимпиискии зал 1", "олимпиискии зал 2"),
        addressJaccard: 1,
        distanceMeters: 15,
      }),
    ).toBe(true);
    expect(
      isAdvisoryFuzzyNeighbor({
        nameJaccard: jaccard("s00a court", "ls04 court"),
        addressJaccard: 1,
        distanceMeters: 0,
      }),
    ).toBe(false);
  });

  it("documents v1 limits", () => {
    expect(NORMALIZATION_LIMITS.length).toBeGreaterThan(3);
  });
});
