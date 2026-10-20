import { z } from "zod";

export type PublicVenueContacts = {
  phone: string | null;
  website: string | null;
  messengers: { kind: "telegram" | "whatsapp" | "vk"; url: string }[];
};
const controls = /[\x00-\x1f\x7f-\x9f]/;
const hosts = { telegram: "t.me", whatsapp: "wa.me", vk: "vk.com" } as const;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function safePublicPhone(value: unknown): string | null {
  if (typeof value !== "string" || controls.test(value)) return null;
  const phone = value.trim();
  const digits = phone.replace(/[^0-9]/g, "");
  return phone.length <= 40 && /^\+?[0-9 ()-]+$/.test(phone) && digits.length >= 7 && digits.length <= 15 ? phone : null;
}
export function safePublicUrl(value: unknown, kind?: keyof typeof hosts): string | null {
  if (typeof value !== "string" || controls.test(value) || value.includes("\\")) return null;
  const text = value.trim();
  if (text.length > 300 || text.split(/[/?#]/)[2]?.includes("@") || !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (kind && (url.protocol !== "https:" || url.hostname !== hosts[kind] || url.pathname === "/" || !url.pathname)) return null;
    return text;
  } catch { return null; }
}
export function readPublicVenueContacts(value: unknown): PublicVenueContacts | null {
  if (!record(value)) return null;
  const messengers: PublicVenueContacts["messengers"] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.messengers)) for (const item of value.messengers) {
    if (!record(item) || (item.kind !== "telegram" && item.kind !== "whatsapp" && item.kind !== "vk") || seen.has(item.kind)) continue;
    const url = safePublicUrl(item.url, item.kind);
    if (!url) continue;
    seen.add(item.kind); messengers.push({ kind: item.kind, url });
    if (messengers.length === 3) break;
  }
  return { phone: safePublicPhone(value.phone), website: safePublicUrl(value.website), messengers };
}
const phone = z.string().refine(v => safePublicPhone(v) !== null, "Некорректный публичный телефон").transform(v => v.trim());
const website = z.string().refine(v => safePublicUrl(v) !== null, "Некорректный публичный URL").transform(v => v.trim());
const messenger = z.object({ kind: z.enum(["telegram", "whatsapp", "vk"]), url: z.string() }).strict()
  .refine(v => safePublicUrl(v.url, v.kind) !== null, "Некорректный URL мессенджера")
  .transform(v => ({ ...v, url: v.url.trim() }));
export const publicVenueContactsSchema = z.object({
  phone: phone.nullable(), website: website.nullable(), messengers: z.array(messenger).max(3)
    .refine(v => new Set(v.map(m => m.kind)).size === v.length, "Повтор мессенджера"),
}).strict();
