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

/** RFC 9110 qvalue: 0[.ddd] | 1[.000], at most 3 fractional digits. */
const VENUE_COVER_ACCEPT_Q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * True only when Accept explicitly lists image/webp with a positive weight.
 * Wildcards (* / *, image/*) do not imply WebP. Honour image/webp;q=0.
 * Malformed, out-of-range, nonfinite, or duplicate q on that media item is rejected
 * (no fallback to default weight 1).
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

    const qValues: string[] = [];
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq <= 0) continue;
      const name = param.slice(0, eq).trim().toLowerCase();
      if (name !== "q") continue;
      qValues.push(param.slice(eq + 1).trim());
    }

    let q: number;
    if (qValues.length === 0) {
      q = 1;
    } else if (qValues.length === 1) {
      const value = qValues[0]!;
      if (!VENUE_COVER_ACCEPT_Q.test(value)) continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) continue;
      q = parsed;
    } else {
      // Duplicate q is ambiguous; do not guess a positive weight.
      continue;
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
