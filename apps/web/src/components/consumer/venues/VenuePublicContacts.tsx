"use client";

import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "../../../lib/original-http-authority";

// Validate untrusted/older API data independently of server normalization.
const hasForbiddenContactCharacters = forbiddenUrlScalars;

function contactUrl(value: unknown, kind?: string): string | null {
  if (typeof value !== "string" || hasForbiddenContactCharacters(value)) return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const url = httpUrlAgreesWithOriginalAuthority(raw, hasForbiddenContactCharacters);
  if (!url) return null;
  if (!url.hostname.startsWith("[") && (url.hostname.length > 253 || !url.hostname.split(".").every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return null;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 300) return null;
  const host = kind === "telegram" ? "t.me" : kind === "whatsapp" ? "wa.me" : kind === "vk" ? "vk.com" : null;
  if (kind && (!host || url.protocol !== "https:" || url.hostname !== host || url.pathname === "/")) return null;
  return url.href;
}

function ContactIcon({ kind }: { kind: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "website" ? <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>
      : kind === "phone" ? <path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z" />
      : kind === "telegram" ? <path d="m3 11 18-7-4 16-6-5-4 3 1-6 9-5-6 8" />
      : kind === "whatsapp" ? <><path d="m4 20 1-5a9 9 0 1 1 4 5l-5 1Z" /><path d="m9 8-1 2c1 3 3 5 6 6l2-2-3-2-1 1-2-2 1-1-2-2Z" /></>
      : <path d="M3 7c1 6 4 10 9 10h1v-4c2 0 3 2 5 4h3l-5-6 4-4h-3l-4 4V7h-3v7c-2-1-3-4-4-7H3Z" />}
  </svg>;
}

/** Shared public venue contacts: only `publicContacts`, never private booking fields. */
export function VenuePublicContacts({ value }: { value: unknown }) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawPhone = row.phone;
  const trimmed = typeof rawPhone === "string" ? rawPhone.trim() : "";
  const digits = trimmed.replace(/[^0-9]/g, "");
  const phone = typeof rawPhone === "string" && !hasForbiddenContactCharacters(rawPhone) && trimmed.length <= 40 && /^\+?[0-9 ()-]+$/.test(trimmed) && digits.length >= 7 && digits.length <= 15 ? trimmed : null;
  const website = contactUrl(row.website);
  const links: { kind: string; url: string; label: string }[] = [];
  for (const [kind, label] of [["telegram", "Telegram"], ["whatsapp", "WhatsApp"], ["vk", "ВКонтакте"]] as const) {
    if (!Array.isArray(row.messengers)) continue;
    for (const item of row.messengers as unknown[]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const messenger = item as Record<string, unknown>;
      if (messenger.kind !== kind) continue;
      const url = contactUrl(messenger.url, kind);
      if (url) { links.push({ kind, url, label }); break; }
    }
  }
  return <section className="gb-venue-contacts" aria-label="Контакты площадки"><h3>Контакты площадки</h3>
    <div className="gb-venue-contact-rows">
      {phone && <a className="gb-venue-contact-row" href={`tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`}><ContactIcon kind="phone" /><span>{phone}</span></a>}
      {website && <a className="gb-venue-contact-row" href={website} target="_blank" rel="noopener noreferrer"><ContactIcon kind="website" /><span>{new URL(website).hostname}</span><span aria-hidden="true">↗</span></a>}
      {links.length > 0 && <div className="gb-venue-contact-messengers">{links.map(link => <a className="gb-venue-contact-row" key={link.kind} href={link.url} target="_blank" rel="noopener noreferrer"><ContactIcon kind={link.kind} /><span>{link.label}</span></a>)}</div>}
    </div>
    {!phone && !website && !links.length && <p>Контакты пока не добавлены</p>}
  </section>;
}
