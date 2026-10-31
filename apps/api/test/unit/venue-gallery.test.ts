import { describe, expect, it } from "vitest";
import {
  VENUE_GALLERY_MAX,
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
      "x-gallery-credit-text": "Логотип: Клуб",
      "x-gallery-credit-url": "https://club.example/logo",
      "x-gallery-permission-basis": "Материалы правообладателя",
      "x-gallery-source-url": "null",
      "x-gallery-source-author": "null",
      "x-gallery-source-fingerprint": "null",
    });
    expect(evidence.creditKind).toBe("logo");
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
});
