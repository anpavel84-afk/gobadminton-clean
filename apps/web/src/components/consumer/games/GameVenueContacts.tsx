import type { GameDetail } from "../../../lib/consumer-types";

function forbidden(value: string) {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || character === "\\";
  });
}

function phoneLink(value: unknown): { text: string; href: string } | null {
  if (typeof value !== "string" || forbidden(value)) return null;
  const text = value.trim(), digits = text.replace(/[^0-9]/g, "");
  if (text.length > 40 || !/^\+?[0-9 ()-]+$/.test(text) || digits.length < 7 || digits.length > 15) return null;
  return { text, href: `tel:${text.startsWith("+") ? "+" : ""}${digits}` };
}

function websiteLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300 || forbidden(value) || /[\ud800-\udfff]/u.test(value)) return null;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || text.split(/[/?#]/)[2]?.includes("@")) return null;
  try {
    // Decode only for validation; keep the original URL as the destination.
    if (forbidden(decodeURIComponent(text))) return null;
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password && url.href.length <= 300 ? url.href : null;
  } catch { return null; }
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
