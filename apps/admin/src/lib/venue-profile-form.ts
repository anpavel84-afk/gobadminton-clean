// Browser-only form model. Keep validation aligned with the existing admin edit
// DTO and public-venue-contacts schema; the API still authorizes and validates.
export type MessengerKind = "telegram" | "whatsapp" | "vk";
export type PublicContacts = {
  phone: string | null;
  website: string | null;
  messengers: { kind: MessengerKind; url: string }[];
};
export type EditableProfile = {
  courtCount: number | null;
  amenities: { parking: boolean | null; showers: boolean | null };
  description?: string | null;
};
export type VenueProfileSource = {
  publicContacts?: PublicContacts | null;
  profile?: (EditableProfile & { updatedAt?: string | null; gallery?: unknown }) | null;
};
export type NullableChoice = "unknown" | "yes" | "no";
export type VenueProfileDraft = {
  phone: string;
  website: string;
  messengers: PublicContacts["messengers"];
  courtCount: string;
  parking: NullableChoice;
  showers: NullableChoice;
  description: string;
  contactsChanged: boolean;
  profileChanged: boolean;
};
export type VenueProfileErrors = Partial<Record<"phone" | "website" | "courtCount" | "description" | `messenger-${number}`, string>>;
export type VenueProfilePatch = { publicContacts?: PublicContacts | null; profile?: EditableProfile | null };

const choice = (value: boolean | null | undefined): NullableChoice => value == null ? "unknown" : value ? "yes" : "no";
export function initializeVenueProfile(source: VenueProfileSource): VenueProfileDraft {
  return {
    phone: source.publicContacts?.phone ?? "",
    website: source.publicContacts?.website ?? "",
    messengers: source.publicContacts?.messengers?.map(item => ({ ...item })) ?? [],
    courtCount: source.profile?.courtCount == null ? "" : String(source.profile.courtCount),
    parking: choice(source.profile?.amenities?.parking),
    showers: choice(source.profile?.amenities?.showers),
    description: source.profile?.description ?? "",
    contactsChanged: false,
    profileChanged: false,
  };
}

function forbidden(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || character === "\\";
  });
}
/** Equivalent of apps/api originalHttpAuthority + httpUrlAgreesWithOriginalAuthority for public contacts. */
function originalHttpAuthority(text: string): { scheme: "http" | "https"; host: string; port: string } | null {
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
function httpUrlAgreesWithOriginalAuthority(text: string): boolean {
  if (/[\ud800-\udfff]/u.test(text)) return false;
  const authority = originalHttpAuthority(text);
  if (!authority) return false;
  try {
    if (forbidden(decodeURIComponent(text))) return false;
    const url = new URL(text);
    const protocol = `${authority.scheme}:`;
    if (url.protocol !== protocol || !url.hostname || url.username || url.password) return false;
    const hostOnly = new URL(`${authority.scheme}://${authority.host}/`);
    if (hostOnly.protocol !== protocol || !hostOnly.hostname || hostOnly.username || hostOnly.password || hostOnly.port
      || hostOnly.pathname !== "/" || hostOnly.search || hostOnly.hash) return false;
    const expectedHost = hostOnly.hostname + (authority.port ? `:${authority.port}` : "");
    if (url.hostname !== hostOnly.hostname || url.port !== authority.port || url.host !== expectedHost) return false;
    const stable = new URL(url.href);
    return !(stable.href !== url.href || stable.protocol !== protocol || stable.hostname !== url.hostname
      || stable.port !== url.port || stable.host !== url.host || stable.origin !== url.origin || stable.username || stable.password);
  } catch {
    return false;
  }
}
const hosts = { telegram: "t.me", whatsapp: "wa.me", vk: "vk.com" } as const;
function contactUrl(value: string, kind?: MessengerKind): string | null {
  if (forbidden(value)) return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || raw.split(/[/?#]/)[2]?.includes("@")) return null;
  if (!httpUrlAgreesWithOriginalAuthority(raw)) return null;
  try {
    const url = new URL(raw);
    if (!url.hostname.startsWith("[") && (url.hostname.length > 253 || !url.hostname.split(".").every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return null;
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 300) return null;
    if (kind && (url.protocol !== "https:" || url.hostname !== hosts[kind] || url.pathname === "/")) return null;
    return url.href;
  } catch { return null; }
}

export function validateVenueProfile(draft: VenueProfileDraft): { patch: VenueProfilePatch; errors: VenueProfileErrors } {
  const patch: VenueProfilePatch = {};
  const errors: VenueProfileErrors = {};
  if (draft.contactsChanged) {
    const phone = draft.phone.trim() || null;
    const digits = phone?.replace(/[^0-9]/g, "").length ?? 0;
    if (phone !== null && (forbidden(draft.phone) || phone.length > 40 || !/^\+?[0-9 ()-]+$/.test(phone) || digits < 7 || digits > 15)) {
      errors.phone = "Укажите телефон: 7–15 цифр, допустимы +, пробелы, скобки и дефис (до 40 символов).";
    }
    const website = draft.website.trim() ? contactUrl(draft.website) : null;
    if (draft.website.trim() && !website) errors.website = "Укажите HTTP(S)-адрес до 300 символов без логина, пароля и нестандартного порта.";
    const seen = new Set<MessengerKind>();
    const messengers: PublicContacts["messengers"] = [];
    draft.messengers.forEach((item, index) => {
      const url = contactUrl(item.url, item.kind);
      if (seen.has(item.kind)) errors[`messenger-${index}`] = "Этот мессенджер уже указан. Выберите другой или удалите строку.";
      else if (!url || index >= 3) errors[`messenger-${index}`] = `Нужен HTTPS-адрес ${hosts[item.kind]} с непустым путём. Допустимо до трёх разных мессенджеров.`;
      seen.add(item.kind);
      if (url) messengers.push({ kind: item.kind, url });
    });
    patch.publicContacts = phone === null && website === null && messengers.length === 0 ? null : { phone, website, messengers };
  }
  if (draft.profileChanged) {
    const raw = draft.courtCount.trim();
    const courtCount = raw === "" ? null : Number(raw);
    if (raw !== "" && (!/^\d+$/.test(raw) || !Number.isInteger(courtCount) || courtCount! > 2147483647)) {
      errors.courtCount = "Укажите целое число от 0 до 2147483647 или оставьте поле пустым, если неизвестно.";
    }
    const descriptionRaw = draft.description.trim();
    if (descriptionRaw.length > 500 || Array.from(draft.description).some(character => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })) {
      errors.description = "Краткое описание до 500 символов без управляющих символов, или пустое поле.";
    }
    const flag = (value: NullableChoice): boolean | null => value === "unknown" ? null : value === "yes";
    const parking = flag(draft.parking), showers = flag(draft.showers);
    const description = descriptionRaw === "" ? null : descriptionRaw;
    patch.profile = courtCount === null && parking === null && showers === null && description === null
      ? null
      : { courtCount, amenities: { parking, showers }, description };
  }
  return { patch, errors };
}
