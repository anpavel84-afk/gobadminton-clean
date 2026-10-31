import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { z } from "zod";
import { httpsCreditUrl } from "../lib/original-http-authority";
import { publicContactUrl } from "./public-venue-contacts";
import { mapPublicGalleryItem, type PublicGalleryItem, type VenueGalleryItemRow } from "./venue-gallery";

const ajv = new Ajv2020();
addFormats(ajv);
// Credit is emitted unchanged. Validate that exact string, not just the WHATWG
// serialization, which can turn invalid URI characters (e.g. spaces) into escapes.
const attributionUri = ajv.compile({ type: "string", format: "uri" });

const descriptionSchema = z.string().trim().min(1).max(500).refine((value) => {
  return !Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}, "INVALID_DESCRIPTION").nullable();

export const venueProfileEditSchema = z.object({
  courtCount: z.number().int().min(0).max(2147483647).nullable(),
  amenities: z.object({
    parking: z.boolean().nullable(),
    showers: z.boolean().nullable(),
  }).strict(),
  /** Omitted preserves; null clears; string replaces. */
  description: descriptionSchema.optional(),
}).strict().nullable();

export type VenueProfileRow = {
  court_count?: unknown;
  amenity_parking?: unknown;
  amenity_showers?: unknown;
  public_description?: unknown;
  public_profile_updated_at?: unknown;
  cover_url?: unknown;
  cover_credit_kind?: unknown;
  cover_credit_text?: unknown;
  cover_credit_url?: unknown;
  gallery_items?: unknown;
};
export type VenueProfile = {
  courtCount: number | null;
  amenities: { parking: boolean | null; showers: boolean | null };
  description: string | null;
  updatedAt: string | null;
  gallery: {
    coverage: "ordered";
    items: PublicGalleryItem[];
  };
};

/** Per-key extraction is safe even on schema 0039, before description exists. */
export function venueProfileSelectSql(relation: "v" | "venues"): string {
  return ["court_count", "amenity_parking", "amenity_showers", "public_description", "public_profile_updated_at"]
    .map((key) => `to_jsonb(${relation})->'${key}' AS ${key}`).join(", ");
}

export function venueGallerySelectSql(relation: "v" | "venues"): string {
  return `(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'venue_id', g.venue_id,
      'position', g.position,
      'is_main', g.is_main,
      'storage_key', g.storage_key,
      'moderation_approval_id', g.moderation_approval_id,
      'actor_id', g.actor_id,
      'credit_kind', g.credit_kind,
      'credit_text', g.credit_text,
      'credit_url', g.credit_url,
      'source_url', g.source_url,
      'source_author', g.source_author,
      'permission_basis', g.permission_basis,
      'source_fingerprint', g.source_fingerprint,
      'active', g.active,
      'public_url', venue_gallery_item_url(g.id)
    ) ORDER BY g.position), '[]'::jsonb)
    FROM venue_gallery_items g
    WHERE g.venue_id = ${relation}.id AND g.active) AS gallery_items`;
}

function readDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 500) return null;
  if (Array.from(text).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  })) return null;
  return text;
}

function legacyCoverPhoto(row: VenueProfileRow): PublicGalleryItem[] {
  const attribution = typeof row.cover_credit_url === "string" ? row.cover_credit_url : null;
  const safeAttribution = publicContactUrl(attribution);
  const text = row.cover_credit_text;
  const url = typeof row.cover_url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(row.cover_url)
    ? row.cover_url : null;
  if (!(url && row.cover_credit_kind === "photo" && typeof text === "string"
    && text.startsWith("Фото: ") && text.trim().length > 6 && text.length <= 120
    && !Array.from(text).some((char) => char.charCodeAt(0) <= 31 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
    && attribution && attribution.length <= 300 && attribution === attribution.trim() && attribution.startsWith("https://")
    && httpsCreditUrl(attribution) !== null
    && safeAttribution?.startsWith("https://") && attributionUri(attribution))) {
    return [];
  }
  return [{ id: "00000000-0000-4000-8000-000000000000", url, credit: { kind: "photo", text, url: attribution } }];
}

function readOrderedGallery(row: VenueProfileRow): PublicGalleryItem[] {
  if (!Array.isArray(row.gallery_items)) return legacyCoverPhoto(row);
  const items: PublicGalleryItem[] = [];
  for (const raw of row.gallery_items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const mapped = mapPublicGalleryItem(raw as VenueGalleryItemRow & { public_url: string | null });
    if (mapped) items.push(mapped);
    if (items.length >= 8) break;
  }
  return items;
}

export function readVenueProfile(row: VenueProfileRow): VenueProfile {
  const count = row.court_count;
  const rawDate = row.public_profile_updated_at;
  const date = rawDate instanceof Date ? rawDate
    : typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}T/.test(rawDate) ? new Date(rawDate) : null;
  return {
    courtCount: typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 2147483647 ? count : null,
    amenities: {
      parking: typeof row.amenity_parking === "boolean" ? row.amenity_parking : null,
      showers: typeof row.amenity_showers === "boolean" ? row.amenity_showers : null,
    },
    description: readDescription(row.public_description),
    updatedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    gallery: { coverage: "ordered", items: readOrderedGallery(row) },
  };
}
