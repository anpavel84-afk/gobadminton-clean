import { z } from "zod";
import { publicContactUrl } from "./public-venue-contacts";

export const venueProfileEditSchema = z.object({
  courtCount: z.number().int().min(0).max(2147483647).nullable(),
  amenities: z.object({
    parking: z.boolean().nullable(),
    showers: z.boolean().nullable(),
  }).strict(),
}).strict().nullable();

export type VenueProfileRow = {
  court_count?: unknown;
  amenity_parking?: unknown;
  amenity_showers?: unknown;
  public_profile_updated_at?: unknown;
  cover_url?: unknown;
  cover_credit_kind?: unknown;
  cover_credit_text?: unknown;
  cover_credit_url?: unknown;
};
export type VenueProfile = {
  courtCount: number | null;
  amenities: { parking: boolean | null; showers: boolean | null };
  updatedAt: string | null;
  gallery: {
    coverage: "cover_only";
    items: { url: string; credit: { kind: "photo"; text: string; url: string } }[];
  };
};

/** Per-key extraction is safe even on schema 0037, before these columns exist. */
export function venueProfileSelectSql(relation: "v" | "venues"): string {
  return ["court_count", "amenity_parking", "amenity_showers", "public_profile_updated_at"]
    .map(key => `to_jsonb(${relation})->'${key}' AS ${key}`).join(", ");
}

export function readVenueProfile(row: VenueProfileRow): VenueProfile {
  const count = row.court_count;
  const attribution = typeof row.cover_credit_url === "string" ? row.cover_credit_url : null;
  const safeAttribution = publicContactUrl(attribution);
  const text = row.cover_credit_text;
  // Only the existing venue_cover_url projection may supply an owned media URL.
  const url = typeof row.cover_url === "string" && /^\/v1\/media\/venue-covers\/[a-f0-9]{64}\.png$/.test(row.cover_url)
    ? row.cover_url : null;
  const items: VenueProfile["gallery"]["items"] = [];
  if (url && row.cover_credit_kind === "photo" && typeof text === "string"
    && text.startsWith("Фото: ") && text.trim().length > 6 && text.length <= 120
    && !Array.from(text).some(char => char.charCodeAt(0) <= 31 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
    && attribution && attribution.length <= 300 && attribution === attribution.trim() && attribution.startsWith("https://")
    && safeAttribution?.startsWith("https://")) {
    items.push({ url, credit: { kind: "photo", text, url: attribution } });
  }
  const rawDate = row.public_profile_updated_at;
  const date = rawDate instanceof Date ? rawDate
    : typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}T/.test(rawDate) ? new Date(rawDate) : null;
  return {
    courtCount: typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 2147483647 ? count : null,
    amenities: {
      parking: typeof row.amenity_parking === "boolean" ? row.amenity_parking : null,
      showers: typeof row.amenity_showers === "boolean" ? row.amenity_showers : null,
    },
    updatedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    gallery: { coverage: "cover_only", items },
  };
}
