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

/** Recover the original authority before WHATWG can discard empty userinfo. */
function websiteAuthority(text: string) {
  const prefix = /^(https?):\/{2,}/i.exec(text);
  if (!prefix) return null;
  const remainder = text.slice(prefix[0].length);
  const boundary = remainder.search(/[/?#]/);
  const authority = boundary < 0 ? remainder : remainder.slice(0, boundary);
  const parts = /^(\[[0-9a-f:.]+\]|[^:[\]@/\\?#]+)(?::([0-9]*))?$/i.exec(authority);
  if (!parts) return null;
  const scheme = prefix[1]!.toLowerCase(), host = parts[1]!;
  let port = parts[2] === undefined || parts[2] === "" ? "" : parts[2].replace(/^0+/, "") || "0";
  if (port.length > 5 || (port.length === 5 && port > "65535")) return null;
  if (port === (scheme === "https" ? "443" : "80")) port = "";
  return { scheme, host, port };
}

function websiteLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300 || forbidden(value) || /[\ud800-\udfff]/u.test(value)) return null;
  const text = value.trim();
  const authority = websiteAuthority(text);
  if (!authority) return null;
  try {
    // Decode only for validation; keep the original URL as the destination.
    if (forbidden(decodeURIComponent(text))) return null;
    const url = new URL(text);
    const protocol = `${authority.scheme}:`;
    if (url.protocol !== protocol || !url.hostname || url.username || url.password || url.href.length > 300) return null;
    const hostOnly = new URL(`${authority.scheme}://${authority.host}/`);
    if (hostOnly.protocol !== protocol || !hostOnly.hostname || hostOnly.username || hostOnly.password || hostOnly.port
      || hostOnly.pathname !== "/" || hostOnly.search || hostOnly.hash) return null;
    const expectedHost = hostOnly.hostname + (authority.port ? `:${authority.port}` : "");
    if (url.hostname !== hostOnly.hostname || url.port !== authority.port || url.host !== expectedHost) return null;
    const stable = new URL(url.href);
    if (stable.href !== url.href || stable.protocol !== protocol || stable.hostname !== url.hostname
      || stable.port !== url.port || stable.host !== url.host || stable.origin !== url.origin || stable.username || stable.password) return null;
    return url.href;
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
