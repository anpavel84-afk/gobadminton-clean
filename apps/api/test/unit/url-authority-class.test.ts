import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { IdempotencyService } from "../../src/common/idempotency.service";
import type { MutationRunner } from "../../src/common/mutation-runner.service";
import { venueCommand } from "../../src/admin/venues.dto";
import { httpsCreditUrl, privateContactWebsite } from "../../src/lib/original-http-authority";
import { safeProviderAvatar } from "../../src/profiles/avatar-presentation";
import { publicContactUrl, publicVenueContactsSchema } from "../../src/venues/public-venue-contacts";
import { validateManifest } from "../../src/venues/venue-cover-import";
import { readVenueProfile } from "../../src/venues/venue-profile";
import { VenuesService } from "../../src/venues/venues.service";

const grammar: unknown[] = [
  "https://@example.org/", "https://:@example.org/", "https:///@example.org/", "https:///:@example.org/",
  "https:////@example.org/", "https:////:@example.org/", "https:///@:@example.org/",
  "https://user@example.org/", "https://user:pass@example.org/", "https://u:@example.org/", "https://:p@example.org/",
  "https://a@b@example.org/", "https://@@example.org/",
  "https://example%40org/", "https://example%2Forg/", "https://example%5Corg/", "https://example%3A80/", "https://example%00org/",
  "https://%40example.org/", "https:///%40example.org/",
  "https://example.org:444/", "https://example.org:80/", "https://example.org:0/", "https://example.org:65536/",
  "https://example.org/\n", "https://example.org/\t", "https://example.org/\u0000", "https://example.org/%0a", "https://example.org/%00",
  "https://example.org/\ud800", "https://example.org/%C0%AF",
  "https:///@evil.example/phish", "https:///:@evil.example/", "https:////@evil.example/",
  "https://vk.com@evil.example/phish", "https://user:pass@evil.example/logo",
  "", " ", 42, false, {}, [], null, undefined,
  "https://a/?" + "'".repeat(97),
];
const privatePorts = new Set(["https://example.org:444/", "https://example.org:80/", "https://example.org:0/"]);
const preserved = [
  "https://club.example", "https://club.example/logo", "https://example.org/photos",
  "https://example.com", "https://example.com/", "https://example.invalid/",
  "https://example.org/@user", "https://example.org/path?q=a@b", "https://example.org:443/a",
  "https://[::1]:443/", "https://example.org/%D0%BA%D0%BE%D0%BD%D1%82%D0%B0%D0%BA%D1%82%D1%8B",
  "https://[::1]/", "https:///example.org/path", "https://example.org/%40",
];
const badCreditPorts = [
  "https://example.org:0443/a", "https://example.org:00443/a", "https://example.org:/a",
  "https://[::1]:0443/", "https://[::1]:/",
];
const id = "a0000000-0000-4000-8000-000000000003";
const cityId = "a0000000-0000-4000-8000-000000000001";
const coverUrl = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const fields = { cityId, name: "Зал", address: "Адрес", timezone: "Europe/Moscow", latitude: 55, longitude: 37 };

function manifest(source: string | null) {
  return {
    schema: "VENUE_COVER_BATCH_V1", batch: "reviewed-1", count: 1,
    items: [{
      venueId: id, file: `${id}.jpg`, sha256: "a".repeat(64), kind: "photo" as const,
      credit_text: "Фото: Клуб", source_page_url: source, basis_note: "private basis",
    }],
  };
}
function row(url: string) {
  return {
    id, city_id: cityId, name: "Зал", address: "Адрес", timezone: "Europe/Moscow", latitude: 55, longitude: 37,
    data_status: "verified", provenance: "admin_created", lifecycle_state: "verified", identity_discriminator: "",
    canonical_venue_id: null, public_contacts: null, cover_url: coverUrl,
    cover_credit_kind: "photo" as const, cover_credit_text: "Фото: Клуб", cover_credit_url: url,
  };
}
function mapped(url: string) {
  const query = (async () => ({ rows: [row(url)], rowCount: 1, command: "SELECT", oid: 0, fields: [] })) as Pool["query"];
  return new VenuesService({ query } as Pool, {} as IdempotencyService, {} as MutationRunner).getById(id);
}

describe("public URL authority class", () => {
  it("returns a serialized credit href within 300 characters and rejects the authority grammar", () => {
    const bomb = "https://a/?" + "'".repeat(97);
    expect(bomb).toHaveLength(108);
    expect(new URL(bomb).href).toHaveLength(302);
    expect(httpsCreditUrl(bomb)).toBeNull();
    for (const url of preserved) {
      const href = new URL(url).href;
      expect(href.length).toBeLessThanOrEqual(300);
      expect(httpsCreditUrl(url)).toBe(href);
    }
    for (const url of grammar) expect(httpsCreditUrl(url)).toBeNull();
    for (const url of badCreditPorts) expect(httpsCreditUrl(url)).toBeNull();
    expect(httpsCreditUrl("https://example.org/" + "a".repeat(280))).toBe("https://example.org/" + "a".repeat(280));
  });

  it("rejects the grammar at import while a reviewed https credit still imports", () => {
    expect(validateManifest(manifest("https://example.com")).items[0]?.source_page_url).toBe("https://example.com");
    expect(validateManifest(manifest("https://club.example/logo")).items[0]?.source_page_url).toBe("https://club.example/logo");
    for (const url of grammar) {
      if (typeof url !== "string" || !url.startsWith("https://")) continue;
      expect(() => validateManifest(manifest(url))).toThrow();
    }
  });

  it("does not publish a disagreeing credit from the profile or mapVenue", async () => {
    for (const url of preserved) {
      expect(readVenueProfile({ ...row(url), cover_credit_url: url }).gallery.items[0]?.credit.url).toBe(url);
      expect((await mapped(url)).cover?.credit).toEqual({ kind: "photo", text: "Фото: Клуб", url });
    }
    for (const url of grammar) {
      if (typeof url !== "string") continue;
      expect(readVenueProfile({ ...row(url), cover_credit_url: url }).gallery.items).toEqual([]);
      expect((await mapped(url)).cover?.credit).toEqual({ kind: "photo", text: "Фото: Клуб", url: null });
    }
    for (const url of badCreditPorts) {
      const profile = readVenueProfile({ ...row(url), cover_credit_url: url });
      const venue = await mapped(url);
      expect(profile.gallery.items).toEqual([]);
      expect(venue.cover?.credit).toEqual({ kind: "photo", text: "Фото: Клуб", url: null });
      expect(JSON.stringify(profile)).not.toContain(url);
      expect(JSON.stringify(venue.cover)).not.toContain(url);
    }
  });

  it("keeps public contact normalization and rejects the same grammar", () => {
    expect(publicContactUrl(" HTTP://пример.рф:80/a/../b ")).toBe("http://xn--e1afmkfd.xn--p1ai/b");
    expect(publicContactUrl("https://t.me/club", "telegram")).toBe("https://t.me/club");
    expect(publicContactUrl("https://vk.com/club", "vk")).toBe("https://vk.com/club");
    expect(publicContactUrl("https://wa.me/79991234567", "whatsapp")).toBe("https://wa.me/79991234567");
    expect(publicContactUrl("https://example.org:444/")).toBeNull();
    expect(publicContactUrl("https://t.me/", "telegram")).toBeNull();
    expect(publicContactUrl("http://t.me/club", "telegram")).toBeNull();
    for (const url of grammar) expect(publicContactUrl(url)).toBeNull();
    for (const url of ["https:///@t.me/club", "https://user@t.me/club", "https:////@vk.com/club", "https://vk.com@evil.example/phish"]) {
      expect(publicContactUrl(url, "telegram")).toBeNull();
      expect(publicContactUrl(url, "vk")).toBeNull();
    }
    const contacts = { phone: null, website: "https://example.com/", messengers: [] };
    expect(publicVenueContactsSchema.safeParse(contacts).success).toBe(true);
    for (const website of grammar) {
      if (typeof website !== "string") continue;
      expect(publicVenueContactsSchema.safeParse({ ...contacts, website }).success).toBe(false);
    }
  });

  it("rejects the grammar on the admin contact form and the private website mapper", () => {
    const edit = (contactWebsite: string) => ({ action: "edit" as const, expectedVersion: 1, reasonCode: "synthetic_review", fields: { ...fields, contactWebsite } });
    const edited = (contactWebsite: string) => {
      const parsed = venueCommand.parse(edit(contactWebsite));
      if (parsed.action !== "edit") throw new Error("edit command");
      return parsed.fields;
    };
    expect(venueCommand.safeParse(edit("http://venue.example.invalid")).success).toBe(true);
    expect(venueCommand.safeParse(edit("")).success).toBe(true);
    expect(edited(" http://venue.example.invalid ")).toMatchObject({ contactWebsite: "http://venue.example.invalid" });
    for (const contactWebsite of grammar) {
      if (typeof contactWebsite !== "string") continue;
      const trimmed = contactWebsite.trim();
      // Trim still applies. A trailing control that leaves a normal http(s) URL is stored without that control.
      const kept = trimmed === "" || privateContactWebsite(trimmed) === trimmed;
      expect(venueCommand.safeParse(edit(contactWebsite)).success).toBe(kept);
      if (kept && trimmed !== "") expect(edited(contactWebsite)).toMatchObject({ contactWebsite: trimmed });
    }
    expect(privateContactWebsite("http://venue.example.invalid")).toBe("http://venue.example.invalid");
    expect(privateContactWebsite(" https://example.org/booking ")).toBe(" https://example.org/booking ");
    for (const url of privatePorts) expect(privateContactWebsite(url)).toBe(url);
    for (const url of grammar) {
      if (typeof url === "string" && privatePorts.has(url)) continue;
      expect(privateContactWebsite(url)).toBeNull();
    }
  });

  it("does not let empty userinfo land on an allowlisted avatar host", () => {
    expect(safeProviderAvatar("https://avatars.yandex.net/test")).toBe("https://avatars.yandex.net/test");
    expect(safeProviderAvatar("https://sun1-1.userapi.com/photo")).toBe("https://sun1-1.userapi.com/photo");
    for (const url of [
      "https:///@avatars.yandex.net/phish", "https:///:@avatars.yandex.net/", "https:////@sun1-1.userapi.com/phish",
      "https://avatars.yandex.net@evil.example/phish", "https://user:pass@evil.example/logo",
    ]) expect(safeProviderAvatar(url)).toBeNull();
  });
});
