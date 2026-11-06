/**
 * Strict public projection of B4U_SOURCE_V1 review markers.
 * Never expose raw review_markers, contact provenance, digest, or private fields.
 */

const MARKER_PREFIX = "B4U_SOURCE_V1=";
const PROVIDER = "badminton4u.ru" as const;
const CLUB_PATH_RE = /^https:\/\/badminton4u\.ru\/clubs\/([0-9]+)\/?$/i;
const SOURCE_VENUE_RE = /^B4U-V-[0-9A-F]{8}$/;
const CLUB_ID_RE = /^B4U-C-[0-9]+$/;
const MAX_CLUBS = 8;
const MAX_NAME = 160;
const MAX_URL = 300;

export type VenueCatalogSourceClub = {
  id: string;
  name: string;
  url: string;
};

export type VenueCatalogSource = {
  provider: typeof PROVIDER;
  venueId: string;
  clubs: VenueCatalogSourceClub[];
};

function hasControlChars(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

function httpsClubUrl(raw: unknown): { href: string; digits: string } | null {
  if (typeof raw !== "string" || hasControlChars(raw) || raw !== raw.trim()) return null;
  if (!/^https:\/\//i.test(raw) || raw.includes("\\") || raw.split(/[/?#]/)[2]?.includes("@")) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.hostname !== "badminton4u.ru" ||
      url.href.length > MAX_URL
    ) {
      return null;
    }
    const pathOnly = `${url.origin}${url.pathname}`.replace(/\/$/, "");
    const match = pathOnly.match(CLUB_PATH_RE) ?? url.href.split(/[?#]/)[0]?.match(CLUB_PATH_RE);
    if (!match?.[1]) return null;
    // Reject spoof hosts (badminton4u.ru.evil) — hostname already exact.
    return { href: url.href, digits: match[1] };
  } catch {
    return null;
  }
}

function plainClubName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_NAME) return null;
  if (hasControlChars(name) || /[<>]/.test(name)) return null;
  return name;
}

type SourcePayload = {
  sourceVenueId?: unknown;
  sourceUrls?: unknown;
  clubSources?: unknown;
};

function parsePayload(raw: string): SourcePayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as SourcePayload;
  } catch {
    return null;
  }
}

/**
 * Parse durable B4U_SOURCE_V1 markers into the public VenueProfile.catalogSource DTO.
 * Invalid / legacy / duplicate markers → omit (null).
 */
export function parseVenueCatalogSource(markers: unknown): VenueCatalogSource | null {
  if (!Array.isArray(markers)) return null;
  const payloads: string[] = [];
  for (const marker of markers) {
    if (typeof marker !== "string" || !marker.startsWith(MARKER_PREFIX)) continue;
    payloads.push(marker.slice(MARKER_PREFIX.length));
  }
  if (payloads.length !== 1) return null;
  const payload = parsePayload(payloads[0]!);
  if (!payload) return null;

  if (typeof payload.sourceVenueId !== "string" || !SOURCE_VENUE_RE.test(payload.sourceVenueId)) {
    return null;
  }
  if (!Array.isArray(payload.sourceUrls) || payload.sourceUrls.length < 1) return null;
  if (!Array.isArray(payload.clubSources) || payload.clubSources.length < 1) return null;
  if (payload.clubSources.length > MAX_CLUBS) return null;

  const sourceUrls: string[] = [];
  for (const raw of payload.sourceUrls) {
    const url = httpsClubUrl(raw);
    if (!url) return null;
    sourceUrls.push(url.href);
  }

  const clubs: VenueCatalogSourceClub[] = [];
  const seenIds = new Set<string>();
  for (const row of payload.clubSources) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const club = row as { clubId?: unknown; name?: unknown; url?: unknown };
    if (typeof club.clubId !== "string" || !CLUB_ID_RE.test(club.clubId)) return null;
    if (seenIds.has(club.clubId)) return null;
    seenIds.add(club.clubId);
    const name = plainClubName(club.name);
    if (!name) return null;
    const url = httpsClubUrl(club.url);
    if (!url) return null;
    const digits = club.clubId.slice("B4U-C-".length);
    if (url.digits !== digits) return null;
    if (!sourceUrls.includes(url.href)) return null;
    clubs.push({ id: club.clubId, name, url: url.href });
  }

  return {
    provider: PROVIDER,
    venueId: payload.sourceVenueId,
    clubs,
  };
}
