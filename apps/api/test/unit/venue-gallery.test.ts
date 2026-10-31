import { describe, expect, it } from "vitest";
import {
  VENUE_GALLERY_MAX,
  decodeGalleryHeaderValue,
  galleryEvidenceSchema,
  galleryReorderSchema,
  mapPublicGalleryItem,
  parseGalleryEvidenceHeaders,
} from "../../src/venues/venue-gallery";

describe("venue gallery validation", () => {
  it("bounds gallery size and rejects duplicate reorder ids", () => {
    expect(VENUE_GALLERY_MAX).toBe(8);
    expect(galleryReorderSchema.safeParse({
      expectedVersion: 1,
      orderedIds: Array.from({ length: 8 }, (_, i) => `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    }).success).toBe(true);
    expect(galleryReorderSchema.safeParse({
      expectedVersion: 1,
      orderedIds: ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000001"],
    }).success).toBe(false);
  });

  it("requires honest photo source/permission and rejects fake approved licenses", () => {
    const photo = {
      creditKind: "photo",
      creditText: "Фото: Клуб",
      creditUrl: "https://club.example/photo",
      sourceUrl: "https://club.example/photo",
      permissionBasis: "Письменное согласие клуба от 2026-10-01",
    };
    expect(galleryEvidenceSchema.safeParse(photo).success).toBe(true);
    expect(galleryEvidenceSchema.safeParse({ ...photo, permissionBasis: "approved" }).success).toBe(false);
    expect(galleryEvidenceSchema.safeParse({ ...photo, sourceUrl: null }).success).toBe(false);
    expect(galleryEvidenceSchema.safeParse({ ...photo, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(galleryEvidenceSchema.safeParse({
      creditKind: "illustration", creditText: "Иллюстрация", creditUrl: null, permissionBasis: "legacy_preserved_unknown",
    }).success).toBe(true);
  });

  it("parses evidence headers and maps only approved public URLs", () => {
    const evidence = parseGalleryEvidenceHeaders({
      "x-gallery-credit-kind": "logo",
      "x-gallery-credit-text": encodeURIComponent("Логотип: Клуб"),
      "x-gallery-credit-url": encodeURIComponent("https://club.example/logo"),
      "x-gallery-permission-basis": encodeURIComponent("Материалы правообладателя"),
      "x-gallery-source-url": "null",
      "x-gallery-source-author": "null",
      "x-gallery-source-fingerprint": "null",
    });
    expect(evidence.creditKind).toBe("logo");
    expect(evidence.creditText).toBe("Логотип: Клуб");
    expect(evidence.permissionBasis).toBe("Материалы правообладателя");
    expect(evidence.sourceUrl).toBeNull();
    const key = `${"a".repeat(64)}.png`;
    expect(mapPublicGalleryItem({
      id: "a0000000-0000-4000-8000-000000000001",
      venue_id: "a0000000-0000-4000-8000-000000000002",
      position: 0, is_main: true, storage_key: key,
      moderation_approval_id: "a0000000-0000-4000-8000-000000000003",
      actor_id: "a0000000-0000-4000-8000-000000000004",
      credit_kind: "logo", credit_text: "Логотип: Клуб", credit_url: "https://club.example/logo",
      source_url: null, source_author: null, permission_basis: "x", source_fingerprint: null, active: true,
      public_url: `/v1/media/venue-covers/${key}`,
    })?.credit.kind).toBe("logo");
    expect(mapPublicGalleryItem({
      id: "a0000000-0000-4000-8000-000000000001",
      venue_id: "a0000000-0000-4000-8000-000000000002",
      position: 0, is_main: true, storage_key: key,
      moderation_approval_id: "a0000000-0000-4000-8000-000000000003",
      actor_id: "a0000000-0000-4000-8000-000000000004",
      credit_kind: "photo", credit_text: "Фото: Клуб", credit_url: "https://club.example/photo",
      source_url: null, source_author: null, permission_basis: "x", source_fingerprint: null, active: true,
      public_url: null,
    })).toBeNull();
  });

  it("round-trips encodeURIComponent wire values and rejects malformed/raw/array headers", () => {
    const russian = "Фото: Клуб «Орёл»";
    expect(decodeGalleryHeaderValue(encodeURIComponent(russian))).toBe(russian);
    expect(() => decodeGalleryHeaderValue(russian)).toThrow();
    expect(() => decodeGalleryHeaderValue("%E0%A4%A")).toThrow();
    expect(() => decodeGalleryHeaderValue("ok%00bad")).toThrow();
    const headers = {
      "x-gallery-credit-kind": "illustration",
      "x-gallery-credit-text": encodeURIComponent("Иллюстрация"),
      "x-gallery-credit-url": "null",
      "x-gallery-permission-basis": encodeURIComponent("Письменное согласие клуба"),
      "x-gallery-source-url": "null",
      "x-gallery-source-author": "null",
      "x-gallery-source-fingerprint": "null",
    };
    expect(parseGalleryEvidenceHeaders(headers).creditText).toBe("Иллюстрация");
    expect(() => parseGalleryEvidenceHeaders({
      ...headers,
      "x-gallery-credit-text": ["Иллюстрация", "dup"],
    })).toThrow();
    expect(() => parseGalleryEvidenceHeaders({
      ...headers,
      "x-gallery-credit-text": "Иллюстрация",
    })).toThrow();
  });

  it("constructs real Fetch Headers/Request with encoded Cyrillic metadata (preflight regression)", () => {
    const creditText = "Фото: Клуб";
    const permission = "Письменное согласие клуба от 2026-10-01";
    expect(() => new Headers({ "X-Gallery-Credit-Text": creditText })).toThrow(TypeError);
    const headers = new Headers({
      "Content-Type": "image/png",
      "X-Gallery-Credit-Kind": "photo",
      "X-Gallery-Credit-Text": encodeURIComponent(creditText),
      "X-Gallery-Credit-Url": encodeURIComponent("https://club.example/photo"),
      "X-Gallery-Source-Url": encodeURIComponent("https://club.example/photo"),
      "X-Gallery-Source-Author": "null",
      "X-Gallery-Permission-Basis": encodeURIComponent(permission),
      "X-Gallery-Source-Fingerprint": "null",
      "X-Venue-Version": "1",
    });
    const request = new Request("http://127.0.0.1/v1/admin/venues/a/gallery", {
      method: "POST",
      headers,
      body: new Uint8Array([1, 2, 3]),
    });
    expect(request.headers.get("X-Gallery-Credit-Text")).toBe(encodeURIComponent(creditText));
    const parsed = parseGalleryEvidenceHeaders(Object.fromEntries(
      [...request.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]),
    ));
    expect(parsed).toMatchObject({
      creditKind: "photo",
      creditText,
      permissionBasis: permission,
      creditUrl: "https://club.example/photo",
      sourceUrl: "https://club.example/photo",
    });
  });
});
