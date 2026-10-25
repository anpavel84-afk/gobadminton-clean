import { z } from "zod";
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "../lib/original-http-authority";

export type PublicVenueContacts = {
  phone: string | null;
  website: string | null;
  messengers: { kind: "telegram" | "whatsapp" | "vk"; url: string }[];
};
const hasForbiddenContactCharacters = forbiddenUrlScalars;
const hosts = { telegram: "t.me", whatsapp: "wa.me", vk: "vk.com" } as const;
export function publicContactUrl(value: unknown, kind?: keyof typeof hosts): string | null {
  if (typeof value !== "string" || hasForbiddenContactCharacters(value)) return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || raw.split(/[/?#]/)[2]?.includes("@")) return null;
  if (!httpUrlAgreesWithOriginalAuthority(raw, hasForbiddenContactCharacters)) return null;
  try {
    const url = new URL(raw);
    if (!url.hostname.startsWith("[") && (url.hostname.length > 253 || !url.hostname.split(".").every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return null;
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 300) return null;
    if (kind && (url.protocol !== 'https:' || url.hostname !== hosts[kind] || url.pathname === '/')) return null;
    return url.href;
  } catch { return null; }
}
export function publicContactPhone(value: unknown): string | null {
  if (typeof value !== "string" || hasForbiddenContactCharacters(value)) return null;
  const phone = value.trim();
  const digits = phone.replace(/[^0-9]/g, "").length;
  return phone.length <= 40 && /^\+?[0-9 ()-]+$/.test(phone) && digits >= 7 && digits <= 15 ? phone : null;
}
const phone = z.string().transform((v, ctx) => {
  const result = publicContactPhone(v);
  if (result === null) { ctx.addIssue({code:"custom", message:"Некорректный публичный телефон"}); return z.NEVER; }
  return result;
});
const website = z.string().transform((v, ctx) => {
  const result = publicContactUrl(v);
  if (result === null) { ctx.addIssue({code:"custom", message:"Некорректный публичный URL"}); return z.NEVER; }
  return result;
});
export const publicVenueContactsSchema = z.object({
  phone: phone.nullable(), website: website.nullable(),
  messengers: z.array(z.object({kind:z.enum(["telegram","whatsapp","vk"]),url:z.string()}).strict().transform((v,ctx) => {
    const url = publicContactUrl(v.url,v.kind);
    if (!url) { ctx.addIssue({code:"custom",message:"Некорректный messenger URL"}); return z.NEVER; }
    return {...v,url};
  })).max(3).refine(v => new Set(v.map(m => m.kind)).size === v.length,"Повтор messenger kind"),
}).strict().nullable();
export function readPublicVenueContacts(value: unknown): PublicVenueContacts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const messengers: PublicVenueContacts['messengers'] = [];
  if (Array.isArray(row.messengers)) for (const item of row.messengers as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    if (m.kind !== 'telegram' && m.kind !== 'whatsapp' && m.kind !== 'vk') continue;
    const url = publicContactUrl(m.url,m.kind);
    if (url && !messengers.some(v => v.kind === m.kind) && messengers.length < 3) messengers.push({kind:m.kind,url});
  }
  return {phone:publicContactPhone(row.phone),website:publicContactUrl(row.website),messengers};
}
