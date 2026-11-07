import {
  clientAcceptsMediaWebp,
  deriveCoverWebp,
  resolveMediaImageResponse,
  type MediaImageBody,
  MEDIA_IMAGE_PRESETS,
  MEDIA_WEBP_QUALITY,
} from "./media-image-response";

/** Public venue-cover GET may emit a bounded WebP derivative only when Accept explicitly allows it. */
export const VENUE_COVER_WEBP_QUALITY = MEDIA_WEBP_QUALITY;
export const VENUE_COVER_WEBP_MAX_WIDTH = MEDIA_IMAGE_PRESETS.cover.maxWidth;
export const VENUE_COVER_WEBP_MAX_HEIGHT = MEDIA_IMAGE_PRESETS.cover.maxHeight;

export type VenueCoverBody = MediaImageBody;

/**
 * True only when Accept explicitly lists image/webp with a positive weight.
 * Wildcards (* / *, image/*) do not imply WebP. Honour image/webp;q=0.
 * Malformed, out-of-range, nonfinite, duplicate, or bare (name q, no "=") q on that
 * media item is rejected (no fallback to default weight 1).
 */
export function clientAcceptsVenueCoverWebp(accept: string | string[] | undefined): boolean {
  return clientAcceptsMediaWebp(accept);
}

/** Convert authorized PNG bytes to a bounded WebP. Caller must have already authorized/read. */
export async function deriveVenueCoverWebp(pngBytes: Buffer): Promise<Buffer> {
  return deriveCoverWebp(pngBytes);
}

/**
 * Choose PNG or WebP for an already-authorized cover buffer.
 * Conversion failures keep the original PNG; do not call this before authorization/read.
 */
export async function resolveVenueCoverResponse(
  pngBytes: Buffer,
  accept: string | string[] | undefined,
  derive: (bytes: Buffer) => Promise<Buffer> = deriveVenueCoverWebp,
): Promise<VenueCoverBody> {
  return resolveMediaImageResponse(pngBytes, accept, derive);
}
