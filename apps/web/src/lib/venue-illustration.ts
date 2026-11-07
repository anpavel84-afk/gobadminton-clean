import type { CSSProperties } from "react";

/** Source-controlled equipment illustrations for published illustration gallery items. */
export const VENUE_ILLUSTRATION_URLS = [
  "/discovery/venue-illustrations/racket-v1.webp",
  "/discovery/venue-illustrations/hand-v1.webp",
  "/discovery/venue-illustrations/shuttles-v1.webp",
  "/discovery/venue-illustrations/pair-v1.webp",
] as const;

export const VENUE_ILLUSTRATION_ALT = "Иллюстрация: бадминтон";

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

/**
 * Calm static skeleton for pending media (paper/line tokens). No spinner, shimmer,
 * motion, or equipment SVG. Prefer CSS `[data-pending]` rules; this inline form is
 * for SelectedVenueCover morph slots that paint via element.style.
 */
export function venueMediaSkeletonStyle(): CSSProperties {
  const bar = "var(--gb-line, #dfe4dc)";
  return {
    backgroundColor: "var(--gb-paper, #f5f6f2)",
    backgroundImage: `linear-gradient(${bar}, ${bar}), linear-gradient(${bar}, ${bar})`,
    backgroundSize: "42% 10px, 28% 10px",
    backgroundPosition: "center calc(50% - 10px), center calc(50% + 10px)",
    backgroundRepeat: "no-repeat",
  };
}
