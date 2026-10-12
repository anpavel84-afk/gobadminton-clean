import { createHash } from "node:crypto";

export const VENUE_NORMALIZATION_VERSION = 1;

/** Conservative v1: NFKC, ё→е, lower, punctuation→space, keep letters/digits (hall/building/unit). */
export function normalizeVenueText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function extractIdentityDiscriminator(
  name: string,
  address: string,
  explicit?: string,
): string {
  const trimmed = explicit?.trim() ?? "";
  if (trimmed.length > 0) {
    return normalizeVenueText(trimmed).slice(0, 80);
  }
  const hay = `${name} ${address}`;
  const found: string[] = [];
  // Token-boundary so "Спортзал зал 2" yields hall:2, not a suffix match on "зал".
  const rules: Array<[string, RegExp]> = [
    [
      "building",
      /(?:^|[^\p{L}\p{N}])(?:корпус|корп\.?|строение|стр\.?|building|bldg\.?)\s*([0-9a-zа-я]+)/giu,
    ],
    ["hall", /(?:^|[^\p{L}\p{N}])(?:зал|hall|корт|court)\s*([0-9a-zа-я]+)/giu],
    ["unit", /(?:^|[^\p{L}\p{N}])(?:unit|помещение|пом\.?)\s*([0-9a-zа-я]+)/giu],
  ];
  for (const [kind, re] of rules) {
    for (const match of hay.matchAll(re)) {
      const value = normalizeVenueText(match[1] ?? "");
      if (value.length > 0) found.push(`${kind}:${value}`);
    }
  }
  return [...new Set(found)].sort().join("|");
}

export function venueDedupeKey(input: {
  cityId: string;
  normalizedName: string;
  normalizedAddress: string;
  identityDiscriminator: string;
  normalizationVersion?: number;
}): string {
  const version = input.normalizationVersion ?? VENUE_NORMALIZATION_VERSION;
  const payload = [
    version,
    input.cityId,
    input.normalizedName,
    input.normalizedAddress,
    input.identityDiscriminator,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function venueProposalFingerprint(input: {
  dedupeKey: string;
  timezone: string;
  latitude: number;
  longitude: number;
}): string {
  const payload = [
    input.dedupeKey,
    input.timezone,
    input.latitude.toFixed(6),
    input.longitude.toFixed(6),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokens(text: string): Set<string> {
  return new Set(text.split(" ").filter((part) => part.length > 0));
}

export function jaccard(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 && right.size === 0) return 1;
  let inter = 0;
  for (const item of left) {
    if (right.has(item)) inter += 1;
  }
  const union = left.size + right.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Advisory only. Coordinates never form identity.
 * Name overlap is required so unrelated nearby courts do not collide.
 */
export function isAdvisoryFuzzyNeighbor(input: {
  nameJaccard: number;
  addressJaccard: number;
  distanceMeters: number | null;
}): boolean {
  if (input.nameJaccard >= 0.55) return true;
  if (
    input.nameJaccard >= 0.4 &&
    (input.addressJaccard >= 0.5 ||
      (input.distanceMeters !== null && input.distanceMeters <= 200))
  ) {
    return true;
  }
  return false;
}

export const NORMALIZATION_LIMITS = [
  "v1 does not transliterate Latin↔Cyrillic (Sportzal ≠ Спортзал).",
  "v1 does not use coordinates as an identity key.",
  "v1 does not strip building/hall/unit numbers.",
  "Abbreviations (СК vs спорткомплекс) are not expanded.",
  "Fuzzy neighbors are suggestions only; they never auto-merge.",
] as const;
