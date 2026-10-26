import type { GameDetail } from "../../../lib/consumer-types";
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "../../../lib/original-http-authority";

function phoneLink(value: unknown): { text: string; href: string } | null {
  if (typeof value !== "string" || forbiddenUrlScalars(value)) return null;
  const text = value.trim(), digits = text.replace(/[^0-9]/g, "");
  if (text.length > 40 || !/^\+?[0-9 ()-]+$/.test(text) || digits.length < 7 || digits.length > 15) return null;
  return { text, href: `tel:${text.startsWith("+") ? "+" : ""}${digits}` };
}

function websiteLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300 || forbiddenUrlScalars(value)) return null;
  const text = value.trim();
  const url = httpUrlAgreesWithOriginalAuthority(text, forbiddenUrlScalars);
  if (!url || url.href.length > 300) return null;
  return url.href;
}

/** Only the current per-game response supplies these fields; no local role inference. */
export function GameVenueContacts({ venue }: { venue: GameDetail["venue"] }) {
  const phone = phoneLink(venue.contactPhone), website = websiteLink(venue.contactWebsite);
  const note = typeof venue.bookingNote === "string" ? venue.bookingNote.trim() : "";
  if (!phone && !website && !note) return null;
  const linkStyle = { display: "inline-flex", alignItems: "center", minHeight: 44, maxWidth: "100%", overflowWrap: "anywhere" as const };
  return <section className="gb-game-section" aria-label="Контакты площадки для игры" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <h2>Контакты площадки</h2>
    <dl className="gb-game-facts">
      {phone && <div><dt>Телефон</dt><dd><a href={phone.href} style={linkStyle}>{phone.text}</a></dd></div>}
      {website && <div><dt>Сайт</dt><dd style={{ minWidth: 0 }}><a href={website} target="_blank" rel="noopener noreferrer" style={linkStyle}>{website}</a></dd></div>}
      {note && <div><dt>Информация о бронировании</dt><dd style={{ whiteSpace: "pre-wrap", minWidth: 0 }}>{note}</dd></div>}
    </dl>
  </section>;
}
