import { describe, expect, it } from "vitest";
import { initializeVenueProfile, validateVenueProfile, type MessengerKind, type VenueProfileSource } from "../src/lib/venue-profile-form";

const full: VenueProfileSource = {
  publicContacts: { phone: "+7 (999) 123-45-67", website: "https://example.org/", messengers: [{ kind: "telegram", url: "https://t.me/venue" }] },
  profile: { courtCount: 0, amenities: { parking: false, showers: true }, updatedAt: "2026-10-22T10:00:00Z", gallery: { coverage: "cover_only", items: [] } },
};

describe("venue public profile form against the existing edit contract", () => {
  it("initializes authoritative facts without false/zero coercion, private copies or server-owned writes", () => {
    const draft = initializeVenueProfile(full);
    expect(draft).toMatchObject({ phone: full.publicContacts!.phone, website: full.publicContacts!.website, courtCount: "0", parking: "no", showers: "yes" });
    expect(validateVenueProfile(draft)).toEqual({ patch: {}, errors: {} });
    draft.messengers[0]!.url = "https://t.me/changed";
    expect(full.publicContacts!.messengers[0]!.url).toBe("https://t.me/venue");
    const result = validateVenueProfile({ ...draft, profileChanged: true, contactsChanged: true });
    expect(result.errors).toEqual({});
    expect(result.patch.profile).toEqual({ courtCount: 0, amenities: { parking: false, showers: true } });
    expect(Object.keys(result.patch.profile!)).toEqual(["courtCount", "amenities"]);
  });

  for (const source of [{}, { publicContacts: null, profile: null }, { profile: { courtCount: null, amenities: { parking: null, showers: null } } }]) {
    it("represents legacy/NULL values as unknown and omits untouched groups: " + JSON.stringify(source), () => {
      const draft = initializeVenueProfile(source);
      expect(draft).toMatchObject({ phone: "", website: "", messengers: [], courtCount: "", parking: "unknown", showers: "unknown" });
      expect(validateVenueProfile(draft)).toEqual({ patch: {}, errors: {} });
      expect(validateVenueProfile({ ...draft, contactsChanged: true, profileChanged: true })).toEqual({ patch: { publicContacts: null, profile: null }, errors: {} });
    });
  }

  it("never uses private booking contacts as public defaults", () => {
    const source = { contactPhone: "+79991234567", contactWebsite: "https://private.example", bookingNote: "private", publicContacts: undefined, profile: undefined };
    expect(initializeVenueProfile({ ...source })).toMatchObject({ phone: "", website: "", messengers: [] });
  });

  it("preserves unchanged neighbors when editing one field; intentional field clear differs from omission", () => {
    const draft = initializeVenueProfile(full);
    expect(validateVenueProfile({ ...draft, phone: "", contactsChanged: true }).patch).toEqual({ publicContacts: { ...full.publicContacts, phone: null } });
    expect(validateVenueProfile({ ...draft, courtCount: "", profileChanged: true }).patch).toEqual({ profile: { courtCount: null, amenities: { parking: false, showers: true } } });
    expect(validateVenueProfile({ ...draft, parking: "unknown", profileChanged: true }).patch.profile).toEqual({ courtCount: 0, amenities: { parking: null, showers: true } });
  });

  for (const value of ["0", "1", "2147483647", " 12 "]) {
    it("accepts integer count " + value, () => {
      const result = validateVenueProfile({ ...initializeVenueProfile({}), profileChanged: true, courtCount: value, parking: "no" });
      expect(result.errors).toEqual({});
      expect(result.patch.profile).toEqual({ courtCount: Number(value), amenities: { parking: false, showers: null } });
    });
  }
  for (const value of ["-1", "0.5", "2147483648", "NaN", "Infinity", "1e10", "abc"]) {
    it("rejects invalid court count " + value, () => {
      expect(validateVenueProfile({ ...initializeVenueProfile({}), profileChanged: true, courtCount: value }).errors.courtCount).toBeTruthy();
    });
  }
  for (const phone of ["123", "+1234567890123456", "+7 999 CALL", "1234567\\", "123\n4567", "１２３４５６７"]) {
    it("rejects invalid public phone " + JSON.stringify(phone), () => {
      expect(validateVenueProfile({ ...initializeVenueProfile({}), contactsChanged: true, phone }).errors.phone).toBeTruthy();
    });
  }
  for (const website of ["javascript:alert(1)", "ftp://example.org", "https://user:password@example.org", "https://@example.org", "https://example.org:8443", "https://bad_host.org", "https://example.org/\\path", "https://example.org/\npath", "https://example.org/" + "a".repeat(300)]) {
    it("rejects invalid website " + JSON.stringify(website), () => {
      expect(validateVenueProfile({ ...initializeVenueProfile({}), contactsChanged: true, website }).errors.website).toBeTruthy();
    });
  }
  for (const [kind, url] of [
    ["telegram", "http://t.me/venue"], ["telegram", "https://t.me/"], ["telegram", "https://t.me.evil.org/venue"],
    ["whatsapp", "https://t.me/1234567"], ["vk", "https://m.vk.com/venue"], ["vk", "https://user@vk.com/venue"],
  ] as [MessengerKind, string][]) {
    it("rejects wrong messenger scheme/host/credentials/path: " + url, () => {
      expect(validateVenueProfile({ ...initializeVenueProfile({}), contactsChanged: true, messengers: [{ kind, url }] }).errors["messenger-0"]).toBeTruthy();
    });
  }
  it("normalizes valid public URLs and supports exactly three distinct messenger kinds", () => {
    const result = validateVenueProfile({
      ...initializeVenueProfile({}), contactsChanged: true, phone: " +7 (999) 123-45-67 ", website: " HTTPS://ПРИМЕР.РФ ",
      messengers: [{ kind: "telegram", url: "https://t.me/venue" }, { kind: "whatsapp", url: "https://wa.me/79991234567" }, { kind: "vk", url: "https://vk.com/venue" }],
    });
    expect(result.errors).toEqual({});
    expect(result.patch.publicContacts?.website).toBe("https://xn--e1afmkfd.xn--p1ai/");
    expect(result.patch.publicContacts?.phone).toBe("+7 (999) 123-45-67");
    expect(result.patch.publicContacts?.messengers).toHaveLength(3);
    const duplicate = { ...initializeVenueProfile(full), contactsChanged: true };
    duplicate.messengers.push({ kind: "telegram", url: "https://t.me/other" });
    expect(validateVenueProfile(duplicate).errors["messenger-1"]).toContain("уже указан");
    const tooMany = { ...duplicate, messengers: [...duplicate.messengers, ...duplicate.messengers] };
    expect(validateVenueProfile(tooMany).errors["messenger-3"]).toBeTruthy();
  });
});
