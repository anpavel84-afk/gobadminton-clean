import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Venue, VenueProfile } from "../src/lib/consumer-types";
import { VenuePublicProfile } from "../src/components/consumer/venues/VenuePublicProfile";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
const coverUrl = `/v1/media/venue-covers/${"a".repeat(64)}.png`;
const credit = { kind: "photo" as const, text: "Фото: Спортзал", url: "https://example.org/photos" };
const profile: VenueProfile = {
  courtCount: 6, amenities: { parking: true, showers: false }, description: "Короткое описание зала",
  updatedAt: "2026-10-22T23:30:00.000Z",
  gallery: { coverage: "ordered", items: [{ id: "a0000000-0000-4000-8000-000000000001", url: coverUrl, credit }] },
};
type Projection = Pick<Venue, "profile" | "publicContacts" | "cover">;
function render(venue: Projection) { return renderToStaticMarkup(<VenuePublicProfile venue={venue} />); }
function values(html: string) { return [...html.matchAll(/<dd>(.*?)<\/dd>/g)].map(match => match[1]); }
const full: Projection = {
  profile, cover: { uploadedUrl: coverUrl, credit },
  publicContacts: { phone: " +7 (999) 123-45-67 ", website: "https://пример.рф/contact", messengers: [] },
};

describe("existing V1a public venue projection", () => {
  it("renders actual facts, UTC content date, approved contacts and the one eligible cover photo", () => {
    const html = render(full);
    expect(values(html)).toEqual(["6", "Есть", "Нет"]);
    expect(html).toMatch(/datetime="2026-10-22T23:30:00.000Z"/i);
    expect(html).toContain("22 октября 2026");
    expect(html).toContain("Содержимое обновлено:");
    expect(html).toContain('href="tel:+79991234567"');
    expect(html).toContain('href="https://xn--e1afmkfd.xn--p1ai/contact" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Короткое описание зала");
    expect(html).toContain(`src="${coverUrl}"`);
    expect(html).toContain('alt="Фото площадки"');
    expect(html).toContain('href="https://example.org/photos" target="_blank" rel="noopener noreferrer nofollow"');
    expect(html).not.toMatch(/Рейтинг|Отзывы|Проверено|cover_only/);
  });

  it("keeps zero/false distinct from unknown, and supports null and legacy responses", () => {
    expect(values(render({ profile: { ...profile, courtCount: 0, amenities: { parking: false, showers: null } } })))
      .toEqual(["0", "Нет", "Нет данных"]);
    const missing: Projection[] = [{}, { profile: null }, { profile: { courtCount: null, amenities: { parking: null, showers: null }, updatedAt: null, gallery: { coverage: "ordered", items: [] } } }];
    for (const venue of missing) {
      const html = render(venue);
      expect(values(html)).toEqual(["Нет данных", "Нет данных", "Нет данных"]);
      expect(html).toContain("Контакты пока не добавлены");
      expect(html).not.toContain("Содержимое обновлено");
      expect(html).not.toContain("Фото площадки");
      expect(html).not.toContain("<img");
    }
  });

  it("never renders private fields or arbitrary object values, including inside public fields", () => {
    const sentinel = "PRIVATE_SENTINEL_205";
    const venue = {
      ...full, bookingNote: sentinel, contactPhone: sentinel, contactWebsite: `https://${sentinel}.example`, provenance: sentinel,
      updatedAt: "2020-01-01T00:00:00.000Z", contactUpdatedAt: sentinel, rating: 5, reviewCount: 99,
      profile: { ...profile, courtCount: { sentinel }, amenities: { parking: { sentinel }, showers: "false" }, updatedAt: { sentinel }, gallery: { sentinel }, bookingNote: sentinel },
      publicContacts: { phone: { sentinel }, website: { sentinel }, contactPhone: sentinel, contactWebsite: sentinel, messengers: [{ kind: "private", url: sentinel }] },
    } as unknown as Projection;
    const html = render(venue);
    expect(values(html)).toEqual(["Нет данных", "Нет данных", "Нет данных"]);
    expect(html).not.toContain(sentinel);
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("2020");
    expect(html).not.toContain("<a");
  });

  it("rejects dangerous/malformed public contacts while preserving safe neighbors", () => {
    for (const website of ["javascript:alert(1)", "data:text/html,x", "//example.org", "https://user@example.org", "https://example.org:444", "https://example.org/\n", "https://example.org/\\x", "https://foo／bar.example", "https://example.org/" + "я".repeat(100)]) {
      const html = render({ publicContacts: { phone: "+1234567", website, messengers: [] } });
      expect(html).toContain('href="tel:+1234567"');
      expect(html.match(/<a /g)).toHaveLength(1);
    }
    const html = render({ publicContacts: { phone: "123\n4567", website: "https://example.org", messengers: [] } });
    expect(html).not.toContain("tel:");
    expect(html).toContain('href="https://example.org/"');
  });

  it("fails closed for malformed facts/dates instead of displaying fallback timestamps", () => {
    for (const count of [-1, 1.5, 2147483648, "6", {}, []]) {
      const html = render({ profile: { ...profile, courtCount: count } as VenueProfile });
      expect(values(html)[0]).toBe("Нет данных");
    }
    for (const updatedAt of [null, "bad", "2026-02-30T00:00:00.000Z", "2026-10-22", 123]) {
      expect(render({ profile: { ...profile, updatedAt } as VenueProfile })).not.toContain("<time");
    }
    for (const malformed of [[], "raw", { amenities: null }, { courtCount: 0 }]) {
      expect(render({ profile: malformed as unknown as VenueProfile })).not.toContain("[object Object]");
    }
  });

  it("does not invent a gallery from the cover, or display unsupported/ineligible gallery content", () => {
    const invalid = [
      undefined, null, { coverage: "all", items: profile.gallery.items },
      { coverage: "ordered", items: [] },
      ...["https://external.example/photo.png", "javascript:x"].map(url => ({ coverage: "ordered", items: [{ url, credit }] })),
      ...["logo", "illustration", "unknown"].map(kind => ({ coverage: "ordered", items: [{ url: coverUrl, credit: { ...credit, kind } }] })),
      ...["javascript:x", "https://user@example.org", "https://example.org:444", "https://example.org/a b", "https://example.org/\n", "https://example.org/%xx", "https://example.org/<bad>"].map(url => ({ coverage: "ordered", items: [{ url: coverUrl, credit: { ...credit, url } }] })),
    ];
    for (const gallery of invalid) {
      const html = render({ ...full, profile: { ...profile, gallery } as VenueProfile });
      expect(html).not.toContain("<img");
      expect(html).not.toContain("Фото площадки");
    }
    expect(render({ ...full, profile: undefined })).not.toContain("<img");
    // Ordered gallery photos remain visible even when the legacy single cover slot is empty.
    expect(render({ ...full, cover: { uploadedUrl: null } })).toContain(`src="${coverUrl}"`);
  });

  it("renders ordered multi-photo gallery with distinct allowlisted local cover URLs", () => {
    const secondUrl = `/v1/media/venue-covers/${"b".repeat(64)}.png`;
    const secondCredit = { kind: "photo" as const, text: "Фото: Второй зал", url: "https://example.org/second" };
    const html = render({
      ...full,
      profile: {
        ...profile,
        gallery: {
          coverage: "ordered",
          items: [
            { id: "a0000000-0000-4000-8000-000000000001", url: coverUrl, credit },
            { id: "a0000000-0000-4000-8000-000000000002", url: secondUrl, credit: secondCredit },
          ],
        },
      },
    });
    expect(html).toContain(`src="${coverUrl}"`);
    expect(html).toContain(`src="${secondUrl}"`);
    expect(html).toContain("Фото: Спортзал");
    expect(html).toContain("Фото: Второй зал");
    expect(html).toContain('href="https://example.org/photos"');
    expect(html).toContain('href="https://example.org/second"');
    expect(html).not.toContain("PRIVATE_SENTINEL");
  });
});
