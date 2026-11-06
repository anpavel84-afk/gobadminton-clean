import { describe, expect, it } from "vitest";
import { parseVenueCatalogSource } from "../../src/venues/venue-catalog-source";
import { readVenueProfile } from "../../src/venues/venue-profile";

const clubUrl = "https://badminton4u.ru/clubs/208";
const payload = {
  sourceVenueId: "B4U-V-33540253",
  sourceUrls: [clubUrl],
  clubSources: [{ clubId: "B4U-C-208", name: "Badmclub НН", url: clubUrl }],
  collectedAt: "2026-10-07",
  nameBasis: "EXPLICIT_SOURCE_CLUB_LABEL",
  manifestDigest: "a".repeat(64),
};

describe("parseVenueCatalogSource", () => {
  it("projects a valid B4U_SOURCE_V1 marker and omits legacy/invalid", () => {
    const ok = parseVenueCatalogSource([
      "SOURCE_VENUE_ID=B4U-V-33540253",
      `B4U_SOURCE_V1=${JSON.stringify(payload)}`,
    ]);
    expect(ok).toEqual({
      provider: "badminton4u.ru",
      venueId: "B4U-V-33540253",
      clubs: [{ id: "B4U-C-208", name: "Badmclub НН", url: clubUrl }],
    });
    expect(parseVenueCatalogSource(undefined)).toBeNull();
    expect(parseVenueCatalogSource([])).toBeNull();
    expect(parseVenueCatalogSource(["SOURCE_VENUE_ID=B4U-V-33540253"])).toBeNull();
    expect(
      parseVenueCatalogSource([
        `B4U_SOURCE_V1=${JSON.stringify(payload)}`,
        `B4U_SOURCE_V1=${JSON.stringify(payload)}`,
      ]),
    ).toBeNull();
  });

  it("rejects spoof hosts, query/hash, credentials, HTML names and id/path mismatch", () => {
    const bad = [
      { ...payload, clubSources: [{ clubId: "B4U-C-208", name: "<b>x</b>", url: clubUrl }] },
      {
        ...payload,
        clubSources: [{ clubId: "B4U-C-208", name: "X", url: "https://badminton4u.ru.evil/clubs/208" }],
      },
      {
        ...payload,
        clubSources: [{ clubId: "B4U-C-208", name: "X", url: "https://badminton4u.ru/clubs/208?x=1" }],
      },
      {
        ...payload,
        clubSources: [{ clubId: "B4U-C-999", name: "X", url: clubUrl }],
      },
      {
        ...payload,
        clubSources: [{ clubId: "B4U-C-208", name: "X", url: "https://user:pass@badminton4u.ru/clubs/208" }],
      },
    ];
    for (const row of bad) {
      expect(parseVenueCatalogSource([`B4U_SOURCE_V1=${JSON.stringify(row)}`])).toBeNull();
    }
  });

  it("readVenueProfile emits whitelist catalogSource and never raw markers", () => {
    const profile = readVenueProfile({
      court_count: 2,
      amenity_parking: true,
      amenity_showers: null,
      public_description: null,
      public_profile_updated_at: null,
      review_markers: [
        "SOURCE_VENUE_ID=B4U-V-33540253",
        `B4U_SOURCE_V1=${JSON.stringify(payload)}`,
        "B4U_CONTACTS_V1={\"publicContacts\":null}",
        `REGIONS485_DIGEST=${"b".repeat(64)}`,
      ],
    });
    expect(profile.catalogSource).toEqual({
      provider: "badminton4u.ru",
      venueId: "B4U-V-33540253",
      clubs: [{ id: "B4U-C-208", name: "Badmclub НН", url: clubUrl }],
    });
    expect(JSON.stringify(profile)).not.toContain("review_markers");
    expect(JSON.stringify(profile)).not.toContain("manifestDigest");
    expect(JSON.stringify(profile)).not.toContain("B4U_CONTACTS");
    expect(readVenueProfile({}).catalogSource).toBeUndefined();
  });
});
