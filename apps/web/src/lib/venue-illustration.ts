import type { CSSProperties } from "react";

/** Source-controlled equipment illustrations for venues without a photograph. */
export const VENUE_ILLUSTRATION_URLS = [
  "/discovery/venue-illustrations/racket-v1.webp",
  "/discovery/venue-illustrations/hand-v1.webp",
  "/discovery/venue-illustrations/shuttles-v1.webp",
  "/discovery/venue-illustrations/pair-v1.webp",
] as const;

export const VENUE_ILLUSTRATION_ALT = "Иллюстрация: бадминтон";

/**
 * Immediate cold-network underlay: inline SVG (racket + net), no asset request.
 * Not a venue photograph — credits stay illustration/placeholder until a real image loads.
 */
const EQUIPMENT_PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">' +
  '<rect width="120" height="120" fill="#f3f4f1"/>' +
  '<rect x="22" y="30" width="76" height="58" rx="4" fill="#e8ebe4" stroke="#5c6560" stroke-width="2"/>' +
  '<path d="M22 44.5h76M22 59h76M22 73.5h76M41 30v58M60 30v58M79 30v58" stroke="#5c6560" stroke-width="1.25" opacity=".45"/>' +
  '<ellipse cx="78" cy="44" rx="17" ry="21" fill="#dff58a" fill-opacity=".4" stroke="#111111" stroke-width="2.5"/>' +
  '<path d="M70 36c4 2 8 6 10 12M74 32c5 3 9 8 11 14" stroke="#111111" stroke-width="1.1" opacity=".35"/>' +
  '<path d="M78 65v26" stroke="#111111" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M72 94h12" stroke="#111111" stroke-width="2.5" stroke-linecap="round"/>' +
  "</svg>";

/** data: URI — safe as CSS background; never fetched as a network image. */
export const VENUE_EQUIPMENT_PLACEHOLDER_DATA_URI =
  `data:image/svg+xml,${encodeURIComponent(EQUIPMENT_PLACEHOLDER_SVG)}`;

/** Deterministic FNV-1a index — same venue id ⇒ same asset on SSR and client. */
export function venueIllustrationIndex(venueId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < venueId.length; i++) {
    hash ^= venueId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % VENUE_ILLUSTRATION_URLS.length;
}

export function venueIllustrationUrl(venueId: string): string {
  return VENUE_ILLUSTRATION_URLS[venueIllustrationIndex(venueId)]!;
}

/** Immediate equipment underlay while a network illustration/photo is still pending. */
export function venueEquipmentPlaceholderStyle(): CSSProperties {
  return {
    backgroundImage: `url("${VENUE_EQUIPMENT_PLACEHOLDER_DATA_URI}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}
