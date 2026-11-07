import sharp from "sharp";

/** Public venue-cover GET may emit a bounded WebP derivative only when Accept explicitly allows it. */
export const VENUE_COVER_WEBP_QUALITY = 82;
export const VENUE_COVER_WEBP_MAX_WIDTH = 1200;
export const VENUE_COVER_WEBP_MAX_HEIGHT = 400;
const WEBP_TIMEOUT_MS = 5_000;
const WEBP_EFFORT = 4;

export type VenueCoverBody = {
  body: Buffer;
  contentType: "image/png" | "image/webp";
};

/**
 * True only when Accept explicitly lists image/webp with a positive weight.
 * Wildcards (* / *, image/*) do not imply WebP. Honour image/webp;q=0 (case/whitespace; finite valid q).
 */
export function clientAcceptsVenueCoverWebp(accept: string | string[] | undefined): boolean {
  if (accept == null) return false;
  const header = Array.isArray(accept) ? accept.join(",") : accept;
  if (!header.trim()) return false;

  let bestQ = Number.NaN;
  for (const raw of header.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const [mediaRaw, ...params] = part.split(";").map((s) => s.trim());
    if (!mediaRaw) continue;
    const media = mediaRaw.toLowerCase();
    if (media !== "image/webp") continue;

    let q = 1;
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq <= 0) continue;
      const name = param.slice(0, eq).trim().toLowerCase();
      if (name !== "q") continue;
      const value = param.slice(eq + 1).trim();
      // Finite valid q in [0, 1]; malformed q is ignored (default weight 1 for explicit type).
      if (/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value)) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    bestQ = Number.isNaN(bestQ) ? q : Math.max(bestQ, q);
  }
  return Number.isFinite(bestQ) && bestQ > 0;
}

/** Convert authorized PNG bytes to a bounded WebP. Caller must have already authorized/read. */
export async function deriveVenueCoverWebp(pngBytes: Buffer): Promise<Buffer> {
  return sharp(pngBytes, {
    failOn: "warning",
    limitInputPixels: VENUE_COVER_WEBP_MAX_WIDTH * VENUE_COVER_WEBP_MAX_HEIGHT,
    limitInputChannels: 4,
  })
    .rotate()
    .resize(VENUE_COVER_WEBP_MAX_WIDTH, VENUE_COVER_WEBP_MAX_HEIGHT, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: VENUE_COVER_WEBP_QUALITY, effort: WEBP_EFFORT })
    .timeout({ seconds: Math.ceil(WEBP_TIMEOUT_MS / 1000) })
    .toBuffer();
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
  if (!clientAcceptsVenueCoverWebp(accept)) {
    return { body: pngBytes, contentType: "image/png" };
  }
  try {
    const webp = await derive(pngBytes);
    if (!Buffer.isBuffer(webp) || webp.length === 0) {
      return { body: pngBytes, contentType: "image/png" };
    }
    return { body: webp, contentType: "image/webp" };
  } catch {
    return { body: pngBytes, contentType: "image/png" };
  }
}
