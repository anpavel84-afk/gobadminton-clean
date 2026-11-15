import { PublicApiError } from './public-api.ts';
import type { PublicApi, PublicGame } from './public-api.ts';
import { publicCoverPath } from './media.ts';
import { LatestResource } from './resource.ts';
import { futureItems } from './upcoming.ts';

export const isVenueId = (value: unknown): value is string => typeof value === 'string' && value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] === value;
export function venueCreatePath(id: string): string | null { return isVenueId(id) ? `/games/create/venue/${id}` : null; }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function publicText(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max && !forbiddenUrlScalars(v) ? v.trim() : null;
}
export type PublicContact = { label: string; url: string };
export type GalleryItem = { id: string; url: string; credit: { kind: 'photo' | 'logo' | 'illustration'; text: string; url: string | null } };
export type CatalogSource = { provider: 'badminton4u.ru'; venueId: string; clubs: { id: string; name: string; url: string }[] };
export type PublicVenue = { id: string; name: string; address: string; cityId: string; timezone: string; latitude: number; longitude: number;
  resolvedFromVenueId?: string; description: string | null; courtCount: number | null; parking: boolean | null; showers: boolean | null;
  updatedAt: string | null; gallery: GalleryItem[]; mainImage: string | null; contacts: PublicContact[]; catalogSource: CatalogSource | null };

// Pure port of accepted WEB original-http-authority; no DOM/server dependencies.
/** Same authority grammar as apps/api/src/lib/original-http-authority.ts.
 * Original HTTP(S) authority, recovered before WHATWG can discard empty userinfo.
 * Host is a bracketed IPv6 candidate or one token with no structural delimiter,
 * plus an optional decimal port. Default ports are mapped away. Callers keep
 * their own length, label, scheme and allowlist policy. */

export function forbiddenUrlScalars(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || character === "\\";
  });
}

export function originalHttpAuthority(text: string): { scheme: "http" | "https"; host: string; port: string } | null {
  const prefix = /^(https?):\/{2,}/i.exec(text);
  if (!prefix) return null;
  const remainder = text.slice(prefix[0].length);
  const boundary = remainder.search(/[/?#]/);
  const authority = boundary < 0 ? remainder : remainder.slice(0, boundary);
  const parts = /^(\[[0-9a-f:.]+\]|[^:[\]@/\\?#]+)(?::([0-9]*))?$/i.exec(authority);
  if (!parts) return null;
  const schemeName = prefix[1]!.toLowerCase();
  if (schemeName !== "http" && schemeName !== "https") return null;
  const host = parts[1]!;
  let port = parts[2] === undefined || parts[2] === "" ? "" : parts[2].replace(/^0+/, "") || "0";
  if (port.length > 5 || (port.length === 5 && port > "65535")) return null;
  if (port === (schemeName === "https" ? "443" : "80")) port = "";
  return { scheme: schemeName, host, port };
}

/** Parsed URL whose host and port agree with the original authority, and reparse stably. */
export function httpUrlAgreesWithOriginalAuthority(text: string, forbidden: (value: string) => boolean): URL | null {
  if (/[\ud800-\udfff]/u.test(text)) return null;
  const authority = originalHttpAuthority(text);
  if (!authority) return null;
  try {
    if (forbidden(decodeURIComponent(text))) return null;
    const url = new URL(text);
    const protocol = `${authority.scheme}:`;
    if (url.protocol !== protocol || !url.hostname || url.username || url.password) return null;
    const hostOnly = new URL(`${authority.scheme}://${authority.host}/`);
    if (hostOnly.protocol !== protocol || !hostOnly.hostname || hostOnly.username || hostOnly.password || hostOnly.port
      || hostOnly.pathname !== "/" || hostOnly.search || hostOnly.hash) return null;
    const expectedHost = hostOnly.hostname + (authority.port ? `:${authority.port}` : "");
    if (url.hostname !== hostOnly.hostname || url.port !== authority.port || url.host !== expectedHost) return null;
    const stable = new URL(url.href);
    if (stable.href !== url.href || stable.protocol !== protocol || stable.hostname !== url.hostname
      || stable.port !== url.port || stable.host !== url.host || stable.origin !== url.origin || stable.username || stable.password) return null;
    return url;
  } catch {
    return null;
  }
}

const creditCharset = /[^\x21-\x7e]|[\\<>"{}|^`]|%(?![0-9a-f]{2})/i;

function creditDnsLabels(hostname: string): boolean {
  return hostname.startsWith("[") || (hostname.length <= 253 && hostname.split(".").every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)));
}

/** Written credit port: absent, or the exact digits 443. An empty port and leading zeros stay rejected. */
function creditPortSpelling(value: string): boolean {
  const prefix = /^https:\/{2,}/i.exec(value);
  if (!prefix) return false;
  const remainder = value.slice(prefix[0].length);
  const boundary = remainder.search(/[/?#]/);
  const authority = boundary < 0 ? remainder : remainder.slice(0, boundary);
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 1) return false;
    const port = authority.slice(end + 1);
    return port === "" || port === ":443";
  }
  const colon = authority.lastIndexOf(":");
  if (colon < 0) return true;
  return authority.slice(colon) === ":443";
}

/** HTTPS credit/source URL. Port spelling is absent or exactly 443. Keeps the printable-ASCII, original-length and label policy, requires authority agreement, and returns the serialized href only when that href is at most 300 characters. */
export function httpsCreditUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300 || !value.startsWith("https://") || creditCharset.test(value) || !creditPortSpelling(value)) return null;
  const url = httpUrlAgreesWithOriginalAuthority(value, forbiddenUrlScalars);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port || url.href.length > 300 || !creditDnsLabels(url.hostname)) return null;
  return url.href;
}

const CLUB_PATH_RE = /^https:\/\/badminton4u\.ru\/clubs\/([0-9]+)\/?$/i;
const SOURCE_VENUE_RE = /^B4U-V-[0-9A-F]{8}$/;
const CLUB_ID_RE = /^B4U-C-[0-9]+$/;

/** Re-validate the public catalogSource DTO before creating anchors. */
export function safeCatalogSource(raw: unknown): CatalogSource | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.provider !== "badminton4u.ru") return null;
  if (typeof row.venueId !== "string" || !SOURCE_VENUE_RE.test(row.venueId)) return null;
  if (!Array.isArray(row.clubs) || row.clubs.length < 1 || row.clubs.length > 8) return null;
  const clubs: CatalogSource["clubs"] = [];
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


export function contactUrl(value: unknown, kind?: string): string | null {
  if (typeof value !== 'string' || forbiddenUrlScalars(value)) return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const url = httpUrlAgreesWithOriginalAuthority(raw, forbiddenUrlScalars);
  if (!url) return null;
  if (!url.hostname.startsWith('[') && (url.hostname.length > 253 || !url.hostname.split('.').every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return null;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 300) return null;
  const host = kind === 'telegram' ? 't.me' : kind === 'whatsapp' ? 'wa.me' : kind === 'vk' ? 'vk.com' : null;
  if (kind && (!host || url.protocol !== 'https:' || url.hostname !== host || url.pathname === '/')) return null;
  return url.href;
}
export function publicContacts(value: unknown): PublicContact[] {
  const r = record(value), result: PublicContact[] = [];
  const phone = typeof r.phone === 'string' ? r.phone.trim() : '', digits = phone.replace(/[^0-9]/g, '');
  if (typeof r.phone === 'string' && !forbiddenUrlScalars(r.phone) && phone.length <= 40 && /^\+?[0-9 ()-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15)
    result.push({ label: phone, url: `tel:${phone.startsWith('+') ? '+' : ''}${digits}` });
  const site = contactUrl(r.website);
  if (site) result.push({ label: new URL(site).hostname, url: site });
  for (const [kind, label] of [['telegram','Telegram'],['whatsapp','WhatsApp'],['vk','ВКонтакте']] as const) {
    if (!Array.isArray(r.messengers)) continue;
    for (const raw of r.messengers) {
      const item = record(raw), url = item.kind === kind ? contactUrl(item.url, kind) : null;
      if (url) { result.push({ label, url }); break; }
    }
  }
  return result;
}
function credit(value: unknown, legacy: boolean): GalleryItem['credit'] | null {
  const r = record(value), text = publicText(r.text, 120);
  if (!text) return null;
  if (r.kind === 'illustration') return r.url == null && (legacy || text === 'Иллюстрация') ? { kind: 'illustration', text, url: null } : null;
  if (r.kind !== 'photo' && r.kind !== 'logo') return null;
  const prefix = r.kind === 'photo' ? 'Фото: ' : 'Логотип: ';
  if (!text.startsWith(prefix) || text.length <= prefix.length) return null;
  const url = httpsCreditUrl(r.url);
  return url || legacy ? { kind: r.kind, text, url } : null;
}
export function venueGallery(profile: unknown, cover: unknown): GalleryItem[] {
  const gallery = record(record(profile).gallery), result: GalleryItem[] = [];
  if (gallery.coverage === 'ordered' && Array.isArray(gallery.items)) {
    for (const raw of gallery.items) {
      const r = record(raw), url = publicCoverPath(r.url, 'venue'), c = credit(r.credit, false);
      if (!url || !c) continue;
      result.push({ id: publicText(r.id, 128) ?? url, url, credit: c });
      if (result.length === 8) break;
    }
  }
  if (!result.length) {
    const r = record(cover), url = publicCoverPath(r.uploadedUrl, 'venue'), c = credit(r.credit, true);
    if (url && c) result.push({ id: url, url, credit: c });
  }
  return result;
}
export function parseVenue(value: unknown, requested: string): PublicVenue {
  const r = record(value);
  let validZone = false;
  try { if (typeof r.timezone === 'string' && r.timezone) { new Intl.DateTimeFormat('ru', { timeZone: r.timezone }); validZone = true; } } catch { /* invalid timezone */ }
  if (!isVenueId(requested) || !isVenueId(r.id) || !isVenueId(r.cityId) || !publicText(r.name, 300) || !publicText(r.address, 1000) || !validZone ||
      (r.id !== requested && r.resolvedFromVenueId !== requested) ||
      (r.resolvedFromVenueId !== undefined && !isVenueId(r.resolvedFromVenueId)) ||
      typeof r.latitude !== 'number' || !Number.isFinite(r.latitude) || Math.abs(r.latitude) > 90 ||
      typeof r.longitude !== 'number' || !Number.isFinite(r.longitude) || Math.abs(r.longitude) > 180) throw new PublicApiError('invalid');
  const profile = record(r.profile), amenities = record(profile.amenities);
  const updated = profile.updatedAt;
  let updatedAt: string | null = null;
  if (typeof updated === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updated) && Number.isFinite(Date.parse(updated)) && new Date(updated).toISOString() === updated) updatedAt = updated;
  return { id: r.id, name: publicText(r.name,300)!, address: publicText(r.address,1000)!, cityId: r.cityId, timezone: r.timezone as string,
    latitude: r.latitude, longitude: r.longitude,
    ...(r.resolvedFromVenueId === undefined ? {} : { resolvedFromVenueId: r.resolvedFromVenueId as string }),
    description: publicText(profile.description,500), courtCount: Number.isInteger(profile.courtCount) && Number(profile.courtCount) >= 0 && Number(profile.courtCount) <= 2147483647 ? Number(profile.courtCount) : null,
    parking: typeof amenities.parking === 'boolean' ? amenities.parking : null, showers: typeof amenities.showers === 'boolean' ? amenities.showers : null,
    updatedAt, gallery: venueGallery(profile,r.cover), mainImage: publicCoverPath(record(r.cover).uploadedUrl,'venue'),
    contacts: publicContacts(r.publicContacts), catalogSource: safeCatalogSource(profile.catalogSource) };
}
export function venueScheduleQuery(venue: Pick<PublicVenue, 'id' | 'cityId'>, startsFrom: string, cursor?: string): string {
  if (!isVenueId(venue.id) || !isVenueId(venue.cityId) || !Number.isFinite(Date.parse(startsFrom)) || new Date(startsFrom).toISOString() !== startsFrom ||
      (cursor !== undefined && (!cursor || cursor.length > 4096 || forbiddenUrlScalars(cursor)))) throw new PublicApiError('invalid');
  return `cityId=${encodeURIComponent(venue.cityId)}&venueId=${encodeURIComponent(venue.id)}&startsFrom=${encodeURIComponent(startsFrom)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}
export type ScheduleData = { items: PublicGame[]; nextCursor: string | null; used: string[] };
/** A refresh owns one frozen time/scope, alias cache and cancellation generation. */
export class VenueSchedule extends LatestResource<ScheduleData> {
  private api: Pick<PublicApi, 'venueGames'>;
  private now: () => number;
  private startsFrom = '';
  private bindings = new Map<string, PublicVenue>();
  private venue: PublicVenue;
  constructor(api: Pick<PublicApi, 'venueGames'>, venue: PublicVenue, now: () => number = Date.now) { super(); this.api = api; this.venue = venue; this.now = now; }
  refresh = () => {
    this.startsFrom = new Date(this.now()).toISOString(); this.bindings = new Map();
    const time = this.startsFrom, bindings = this.bindings;
    return this.load(this.venue.id, async signal => ({ ...await this.api.venueGames(this.venue,time,undefined,signal,bindings), used: [] }));
  };
  more = () => {
    const state = this.getSnapshot(), previous = state.data;
    if (state.status === 'loading' || !previous?.nextCursor) return Promise.resolve();
    const cursor = previous.nextCursor, time = this.startsFrom, bindings = this.bindings;
    return this.load(this.venue.id, async signal => {
      const page = await this.api.venueGames(this.venue,time,cursor,signal,bindings);
      if (page.nextCursor === cursor || page.nextCursor && previous.used.includes(page.nextCursor)) throw new PublicApiError('invalid');
      return { ...page, used: [...previous.used,cursor] };
    }, (old, page) => ({ ...page, items: futureItems([...new Map([...old.items,...page.items].map(item => [item.id,item])).values()],this.now()) }));
  };
}
