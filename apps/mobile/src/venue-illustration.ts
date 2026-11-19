/** Deterministic venue illustration keys — same FNV-1a order as apps/web/src/lib/venue-illustration.ts. */
export const VENUE_ILLUSTRATION_KEYS = ['racket-v1', 'hand-v1', 'shuttles-v1', 'pair-v1'] as const;
export type VenueIllustrationKey = (typeof VENUE_ILLUSTRATION_KEYS)[number];

export const VENUE_ILLUSTRATION_ALT = 'Иллюстрация: бадминтон';
export const VENUE_ILLUSTRATION_BADGE = 'Иллюстрация';
export const VENUE_COURT_FALLBACK_ALT = 'Бадминтонный корт';

/** Deterministic FNV-1a index — same venue id ⇒ same asset as web. */
export function venueIllustrationIndex(venueId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < venueId.length; i++) {
    hash ^= venueId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % VENUE_ILLUSTRATION_KEYS.length;
}

export function venueIllustrationKey(venueId: string): VenueIllustrationKey {
  return VENUE_ILLUSTRATION_KEYS[venueIllustrationIndex(venueId)]!;
}

/** Photo path when present; otherwise the per-venue illustration key (never an invented empty label). */
export function venueCoverChoice(venueId: string, photoUrl: string | null): { kind: 'photo'; url: string } | { kind: 'illustration'; key: VenueIllustrationKey } {
  return photoUrl ? { kind: 'photo', url: photoUrl } : { kind: 'illustration', key: venueIllustrationKey(venueId) };
}
