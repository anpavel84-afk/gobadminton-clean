import { z } from "zod";
import { httpsCreditUrl } from "../lib/original-http-authority";

export const VENUE_GALLERY_MAX = 8;

const controlFree = (value: string) =>
  !Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });

const httpsSource = z.string().max(300).refine((value) => {
  if (!value.startsWith("https://") || value !== value.trim() || !controlFree(value)) return false;
  return httpsCreditUrl(value) !== null;
}, "INVALID_SOURCE_URL");

export const galleryCreditKindSchema = z.enum(["photo", "logo", "illustration"]);

/** Admin-authored evidence for a gallery image. No hardcoded approved license. */
export const galleryEvidenceSchema = z.object({
  creditKind: galleryCreditKindSchema,
  creditText: z.string().min(1).max(120).refine(controlFree, "INVALID_CREDIT_TEXT"),
  creditUrl: z.string().max(300).nullable(),
  sourceUrl: httpsSource.nullable().optional(),
  sourceAuthor: z.string().trim().min(1).max(120).refine(controlFree, "INVALID_SOURCE_AUTHOR").nullable().optional(),
  permissionBasis: z.string().trim().min(1).max(600).refine(controlFree, "INVALID_PERMISSION_BASIS"),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (/^(approved|licensed|ok|yes|true)$/i.test(value.permissionBasis)) {
    ctx.addIssue({ code: "custom", message: "INVALID_PERMISSION_BASIS" });
  }
  if (value.creditKind === "illustration") {
    if (value.creditText !== "Иллюстрация" || value.creditUrl !== null) {
      ctx.addIssue({ code: "custom", message: "INVALID_CREDIT" });
    }
  } else if (value.creditKind === "photo") {
    if (!value.creditText.startsWith("Фото: ") || value.creditText.trim().length <= 6
      || value.creditUrl === null || !value.creditUrl.startsWith("https://")
      || httpsCreditUrl(value.creditUrl) === null) {
      ctx.addIssue({ code: "custom", message: "INVALID_CREDIT" });
    }
    if (!value.sourceUrl) {
      ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "PHOTO_SOURCE_REQUIRED" });
    }
  } else if (value.creditKind === "logo") {
    if (!value.creditText.startsWith("Логотип: ") || value.creditText.trim().length <= 9
      || value.creditUrl === null || !value.creditUrl.startsWith("https://")
      || httpsCreditUrl(value.creditUrl) === null) {
      ctx.addIssue({ code: "custom", message: "INVALID_CREDIT" });
    }
  }
  for (const key of ["creditUrl", "sourceUrl"] as const) {
    const url = value[key];
    if (typeof url === "string" && /^(javascript|data|blob|file):/i.test(url)) {
      ctx.addIssue({ code: "custom", path: [key], message: "UNSAFE_URL_PROTOCOL" });
    }
  }
});

export type GalleryEvidence = z.infer<typeof galleryEvidenceSchema>;

export const galleryReorderSchema = z.object({
  expectedVersion: z.number().int().positive().max(2147483647),
  orderedIds: z.array(z.string().uuid()).min(1).max(VENUE_GALLERY_MAX),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.orderedIds).size !== value.orderedIds.length) {
    ctx.addIssue({ code: "custom", message: "DUPLICATE_GALLERY_ID" });
  }
});

export const galleryItemCommandSchema = z.object({
  expectedVersion: z.number().int().positive().max(2147483647),
}).strict();

export type VenueGalleryItemRow = {
  id: string;
  venue_id: string;
  position: number;
  is_main: boolean;
  storage_key: string;
  moderation_approval_id: string;
  actor_id: string;
  credit_kind: "photo" | "logo" | "illustration";
  credit_text: string;
  credit_url: string | null;
  source_url: string | null;
  source_author: string | null;
  permission_basis: string;
  source_fingerprint: string | null;
  active: boolean;
  uploaded_url?: string | null;
};

export type VenueGalleryAdminItem = {
  id: string;
  position: number;
  isMain: boolean;
  kind: "photo" | "logo" | "illustration";
  uploadedUrl: string | null;
  credit: { kind: "photo" | "logo" | "illustration"; text: string; url: string | null };
  sourceUrl: string | null;
  sourceAuthor: string | null;
  permissionBasis: string;
  sourceFingerprint: string | null;
};

export type VenueGalleryReceipt = {
  version: number;
  items: VenueGalleryAdminItem[];
};

export type PublicGalleryItem = {
  id: string;
  url: string;
  credit: { kind: "photo" | "logo" | "illustration"; text: string; url: string | null };
};

export function mapAdminGalleryItem(row: VenueGalleryItemRow): VenueGalleryAdminItem {
  return {
    id: row.id,
    position: row.position,
    isMain: row.is_main,
    kind: row.credit_kind,
    uploadedUrl: row.uploaded_url ?? (row.storage_key ? `/v1/media/venue-covers/${row.storage_key}` : null),
    credit: { kind: row.credit_kind, text: row.credit_text, url: row.credit_url },
    sourceUrl: row.source_url,
    sourceAuthor: row.source_author,
    permissionBasis: row.permission_basis,
    sourceFingerprint: row.source_fingerprint,
  };
}

/** Public projection: approved URL only; credit kept truthful per kind. */
export function mapPublicGalleryItem(row: VenueGalleryItemRow & { public_url: string | null }): PublicGalleryItem | null {
  if (typeof row.public_url !== "string"
    || !/^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(row.public_url)) return null;
  const url = row.credit_url;
  const safeUrl = url == null ? null
    : (url.startsWith("https://") && httpsCreditUrl(url) !== null ? url : null);
  if (row.credit_kind === "photo" && safeUrl === null) return null;
  if (row.credit_kind === "logo" && safeUrl === null) return null;
  if (row.credit_kind === "illustration" && (row.credit_text !== "Иллюстрация" || safeUrl !== null)) return null;
  if (row.credit_kind === "photo" && (!row.credit_text.startsWith("Фото: ") || row.credit_text.trim().length <= 6)) return null;
  if (row.credit_kind === "logo" && (!row.credit_text.startsWith("Логотип: ") || row.credit_text.trim().length <= 9)) return null;
  if (!controlFree(row.credit_text) || row.credit_text.length > 120) return null;
  return {
    id: row.id,
    url: row.public_url,
    credit: { kind: row.credit_kind, text: row.credit_text, url: row.credit_kind === "illustration" ? null : safeUrl },
  };
}

export function parseGalleryEvidenceHeaders(headers: Record<string, unknown>): GalleryEvidence {
  const single = (key: string): string | undefined => {
    const value = headers[key];
    return typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
  };
  const optionalNull = (key: string): string | null | undefined => {
    const value = single(key);
    if (value === undefined) return undefined;
    if (value === "" || value === "null") return null;
    return value;
  };
  return galleryEvidenceSchema.parse({
    creditKind: single("x-gallery-credit-kind"),
    creditText: single("x-gallery-credit-text"),
    creditUrl: optionalNull("x-gallery-credit-url") ?? null,
    sourceUrl: optionalNull("x-gallery-source-url") ?? null,
    sourceAuthor: optionalNull("x-gallery-source-author") ?? null,
    permissionBasis: single("x-gallery-permission-basis"),
    sourceFingerprint: optionalNull("x-gallery-source-fingerprint") ?? null,
  });
}
