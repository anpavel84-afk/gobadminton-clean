import type { MouseEvent as ReactMouseEvent } from "react";
import type { VenueCatalogSource } from "../../../lib/consumer-types";
import { httpsCreditUrl } from "../../../lib/original-http-authority";

const CLUB_PATH_RE = /^https:\/\/badminton4u\.ru\/clubs\/([0-9]+)\/?$/i;
const SOURCE_VENUE_RE = /^B4U-V-[0-9A-F]{8}$/;
const CLUB_ID_RE = /^B4U-C-[0-9]+$/;

/** Re-validate the public catalogSource DTO before creating anchors. */
export function safeCatalogSource(raw: unknown): VenueCatalogSource | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.provider !== "badminton4u.ru") return null;
  if (typeof row.venueId !== "string" || !SOURCE_VENUE_RE.test(row.venueId)) return null;
  if (!Array.isArray(row.clubs) || row.clubs.length < 1 || row.clubs.length > 8) return null;
  const clubs: VenueCatalogSource["clubs"] = [];
  const seen = new Set<string>();
  for (const item of row.clubs) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const club = item as Record<string, unknown>;
    if (typeof club.id !== "string" || !CLUB_ID_RE.test(club.id) || seen.has(club.id)) return null;
    seen.add(club.id);
    if (typeof club.name !== "string" || club.name.trim().length < 1 || club.name.length > 160) return null;
    if (/[<>]/.test(club.name) || Array.from(club.name).some((c) => c.charCodeAt(0) <= 31)) return null;
    const href = httpsCreditUrl(typeof club.url === "string" ? club.url : null);
    if (!href || href.includes("?") || href.includes("#")) return null;
    const path = href.split(/[?#]/)[0] ?? "";
    if (!CLUB_PATH_RE.test(path)) return null;
    const digits = club.id.slice("B4U-C-".length);
    const pathDigits = path.match(CLUB_PATH_RE)?.[1];
    if (pathDigits !== digits) return null;
    clubs.push({ id: club.id, name: club.name.trim(), url: href });
  }
  return { provider: "badminton4u.ru", venueId: row.venueId, clubs };
}

function stopCardGesture(event: ReactMouseEvent) {
  event.stopPropagation();
}

export function VenueSourceCredit({ catalogSource }: { catalogSource?: VenueCatalogSource | null }) {
  const source = safeCatalogSource(catalogSource);
  if (!source) return null;
  const primaryClub = source.clubs[0];
  if (!primaryClub) return null;
  return (
    <span
      className="gb-venue-cover-credit gb-venue-source-credit"
      data-kind="catalog-source"
      style={{
        fontSize: "var(--c23-meta)",
        lineHeight: "var(--c23-meta-lh)",
        color: "var(--gb-text-secondary)",
      }}
      onClick={stopCardGesture}
      onPointerDown={stopCardGesture}
    >
      <a
        href={primaryClub.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={stopCardGesture}
      >
        Источник: badminton4u.ru
      </a>
      {source.clubs.map((club, index) => (
        <span key={club.id}>
          {index === 0 ? " · " : ", "}
          <a
            href={club.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={stopCardGesture}
          >
            {club.name}
          </a>
        </span>
      ))}
    </span>
  );
}
