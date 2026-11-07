import sharp from "sharp";

/** Shared Accept→WebP negotiation for authorized media GET bodies (avatars + covers). */
export const MEDIA_WEBP_QUALITY = 82;
export const MEDIA_WEBP_ALPHA_QUALITY = 100;
export const MEDIA_WEBP_EFFORT = 4;
const WEBP_TIMEOUT_MS = 5_000;

export type MediaImageKind = "avatar" | "cover";

export const MEDIA_IMAGE_PRESETS = {
  avatar: {
    maxWidth: 512,
    maxHeight: 512,
    limitInputPixels: 512 * 512,
  },
  cover: {
    maxWidth: 1200,
    maxHeight: 400,
    limitInputPixels: 1200 * 400,
  },
} as const;

export type MediaImageBody = {
  body: Buffer;
  contentType: "image/png" | "image/webp";
};

/** RFC 9110 qvalue: 0[.ddd] | 1[.000], at most 3 fractional digits. */
const MEDIA_ACCEPT_Q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * True only when Accept explicitly lists image/webp with a positive weight.
 * Wildcards (* / *, image/*) do not imply WebP. Honour image/webp;q=0.
 * Malformed, out-of-range, nonfinite, duplicate, or bare (name q, no "=") q on that
 * media item is rejected (no fallback to default weight 1).
 */
export function clientAcceptsMediaWebp(accept: string | string[] | undefined): boolean {
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
    let bareQ = false;
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq < 0) {
        // Bare token with exact name q and no "=" is an explicit malformed q.
        if (param.trim().toLowerCase() === "q") {
          bareQ = true;
          break;
        }
        continue;
      }
      if (eq === 0) continue;
      const name = param.slice(0, eq).trim().toLowerCase();
      if (name !== "q") continue;
      qValues.push(param.slice(eq + 1).trim());
    }
    if (bareQ) continue;

    let q: number;
    if (qValues.length === 0) {
      q = 1;
    } else if (qValues.length === 1) {
      const value = qValues[0]!;
      if (!MEDIA_ACCEPT_Q.test(value)) continue;
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

async function sourceHasTransparency(pngBytes: Buffer, limitInputPixels: number): Promise<boolean> {
  const stats = await sharp(pngBytes, {
    failOn: "warning",
    limitInputPixels,
    limitInputChannels: 4,
  })
    .ensureAlpha()
    .stats();
  const alpha = stats.channels[3];
  return alpha != null && alpha.min < 255;
}

/** Convert authorized PNG bytes to a bounded WebP. Caller must have already authorized/read. */
export async function deriveMediaImageWebp(pngBytes: Buffer, kind: MediaImageKind): Promise<Buffer> {
  const preset = MEDIA_IMAGE_PRESETS[kind];
  const transparent = await sourceHasTransparency(pngBytes, preset.limitInputPixels);
  const webpOpts = transparent
    ? { lossless: true as const, effort: MEDIA_WEBP_EFFORT, alphaQuality: MEDIA_WEBP_ALPHA_QUALITY }
    : {
        quality: MEDIA_WEBP_QUALITY,
        effort: MEDIA_WEBP_EFFORT,
        alphaQuality: MEDIA_WEBP_ALPHA_QUALITY,
      };

  return sharp(pngBytes, {
    failOn: "warning",
    limitInputPixels: preset.limitInputPixels,
    limitInputChannels: 4,
  })
    .rotate()
    .resize(preset.maxWidth, preset.maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp(webpOpts)
    .timeout({ seconds: Math.ceil(WEBP_TIMEOUT_MS / 1000) })
    .toBuffer();
}

export async function deriveAvatarWebp(pngBytes: Buffer): Promise<Buffer> {
  return deriveMediaImageWebp(pngBytes, "avatar");
}

export async function deriveCoverWebp(pngBytes: Buffer): Promise<Buffer> {
  return deriveMediaImageWebp(pngBytes, "cover");
}

/**
 * Choose PNG or WebP for an already-authorized media buffer.
 * Conversion failures keep the original PNG; do not call this before authorization/read.
 */
export async function resolveMediaImageResponse(
  pngBytes: Buffer,
  accept: string | string[] | undefined,
  derive: (bytes: Buffer) => Promise<Buffer>,
): Promise<MediaImageBody> {
  if (!clientAcceptsMediaWebp(accept)) {
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
