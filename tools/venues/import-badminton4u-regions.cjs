/**
 * Bounded DEV OPS adapter for Owner #485 regions import (REGIONS485_IMPORT_V1).
 * CommonJS; intended cwd /app/apps/api (createRequire from package.json).
 * Module load has no DB side effects. Writes only with --apply / --trial-rollback.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");

const SCHEMA = "REGIONS485_IMPORT_V1";
const SOURCE_ARCHIVE_SHA256 =
  "18022f227b237cd7d5b5e193dd0bf1c7b299c843297c4a356b6e2f9cb837221e";
const URL_NAMESPACE = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
const VENUE_NAME_PREFIX = "gobadminton:badminton4u:";
const MAX_VENUES = 50;
const DEDUPE_METERS = 150;
const CITY_RADIUS_METERS = 40000;
const REASON = "owner_regions485_import";
const MARKER_SOURCE = "SOURCE_VENUE_ID=";
const MARKER_DIGEST = "REGIONS485_DIGEST=";
const MARKER_SOURCE_JSON = "B4U_SOURCE_V1=";
const MARKER_CONTACTS_JSON = "B4U_CONTACTS_V1=";
/** Optional durable original→corrected provenance; absent on legacy rows stays compatible. */
const MARKER_REVIEW_RESOLUTION = "B4U_REVIEW_RESOLUTION_V1=";
const REVIEW_RESOLUTION_KIND = "EXPLICIT_PUBLIC_SOURCE_ADDRESS_POINT_CORRECTION";

/** Exact 11 approved regional cities (Челябинск / Уфа / Пермь excluded). */
const APPROVED_CITIES = Object.freeze({
  Новосибирск: Object.freeze({
    nameEn: "Novosibirsk",
    timezone: "Asia/Novosibirsk",
  }),
  Екатеринбург: Object.freeze({
    nameEn: "Yekaterinburg",
    timezone: "Asia/Yekaterinburg",
  }),
  Казань: Object.freeze({ nameEn: "Kazan", timezone: "Europe/Moscow" }),
  "Нижний Новгород": Object.freeze({
    nameEn: "Nizhny Novgorod",
    timezone: "Europe/Moscow",
  }),
  Самара: Object.freeze({ nameEn: "Samara", timezone: "Europe/Samara" }),
  Омск: Object.freeze({ nameEn: "Omsk", timezone: "Asia/Omsk" }),
  "Ростов-на-Дону": Object.freeze({
    nameEn: "Rostov-on-Don",
    timezone: "Europe/Moscow",
  }),
  Красноярск: Object.freeze({
    nameEn: "Krasnoyarsk",
    timezone: "Asia/Krasnoyarsk",
  }),
  Воронеж: Object.freeze({ nameEn: "Voronezh", timezone: "Europe/Moscow" }),
  Волгоград: Object.freeze({
    nameEn: "Volgograd",
    timezone: "Europe/Volgograd",
  }),
  Краснодар: Object.freeze({ nameEn: "Krasnodar", timezone: "Europe/Moscow" }),
});

const EXCLUDED_CITY_NAMES = new Set([
  "Челябинск",
  "Уфа",
  "Пермь",
  "Chelyabinsk",
  "Ufa",
  "Perm",
]);

const MANIFEST_KEYS = new Set([
  "schema",
  "batch",
  "sourceArchiveSha256",
  "cities",
  "venues",
]);
const CITY_KEYS = new Set([
  "id",
  "nameRu",
  "nameEn",
  "timezone",
  "centerLatitude",
  "centerLongitude",
  "centerSourceUrl",
  "centerCheckedAt",
]);
const VENUE_KEYS = new Set([
  "id",
  "sourceVenueId",
  "name",
  "address",
  "cityId",
  "latitude",
  "longitude",
  "importReady",
  "sourceUrls",
  "clubSources",
  "collectedAt",
  "nameBasis",
  "publicContacts",
  "contactSources",
  "courtCount",
  // Optional bounded extensions — absent keeps strict V1 byte-compatible markers.
  "sourceVenueAliases",
  "reviewResolution",
]);
const CLUB_KEYS = new Set(["clubId", "name", "url"]);
const CONTACT_SOURCE_KEYS = new Set([
  "contactType",
  "value",
  "sourceUrl",
  "checkedAt",
]);
const PUBLIC_CONTACT_KEYS = new Set(["phone", "website", "messengers"]);
const MESSENGER_KEYS = new Set(["kind", "url"]);
const REVIEW_RESOLUTION_KEYS = new Set([
  "kind",
  "original",
  "corrected",
  "primaryAddressSourceURL",
  "pointSourceURL",
  "pointCheckedAt",
  "reason",
]);
const REVIEW_ORIGINAL_KEYS = new Set([
  "address",
  "latitude",
  "longitude",
  "sourceVenueId",
  "importReady",
  "collectedAt",
]);
const REVIEW_CORRECTED_KEYS = new Set(["address", "latitude", "longitude"]);
const REVIEW_IMPORT_READY = new Set(["yes", "no", "after_review"]);
const PRIVATE_KEY_RE =
  /^(private|raw|secret|token|cookie|password|phoneRaw|privateRaw)/i;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_VENUE_RE = /^B4U-V-[0-9A-F]{8}$/;
const CLUB_ID_RE = /^B4U-C-[0-9]+$/;
const CLUB_PATH_RE = /^https:\/\/badminton4u\.ru\/clubs\/([0-9]+)\/?$/i;
const BATCH_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(code, detail) {
  const err = new Error(detail ? `${code}: ${detail}` : code);
  err.code = code;
  throw err;
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, "object required");
  }
}

function assertAllowlist(obj, allowed, code) {
  for (const key of Object.keys(obj)) {
    if (PRIVATE_KEY_RE.test(key) || key.toLowerCase().includes("privateraw")) {
      fail("PRIVATE_FIELD_REFUSED", key);
    }
    if (!allowed.has(key)) fail(code, `unknown key ${key}`);
  }
}

function isValidIana(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isDateLike(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 40) {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function hasForbiddenScalars(value) {
  return /[\u0000-\u001f\u007f]/.test(value) || value.includes("\\");
}

function httpsUrlOk(raw, { hostExact, pathRe } = {}) {
  if (typeof raw !== "string" || hasForbiddenScalars(raw)) return null;
  const trimmed = raw.trim();
  if (!/^https:\/\//i.test(trimmed) || trimmed.split(/[/?#]/)[2]?.includes("@")) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return null;
    }
    if (url.href.length > 300) return null;
    if (hostExact && url.hostname !== hostExact) return null;
    if (pathRe && !pathRe.test(url.href.split(/[?#]/)[0])) return null;
    return url.href;
  } catch {
    return null;
  }
}

function publicContactPhone(value) {
  if (value === null) return null;
  if (typeof value !== "string" || hasForbiddenScalars(value)) return null;
  const phone = value.trim();
  const digits = phone.replace(/[^0-9]/g, "").length;
  return phone.length <= 40 &&
    /^\+?[0-9 ()-]+$/.test(phone) &&
    digits >= 7 &&
    digits <= 15
    ? phone
    : null;
}

function publicContactUrl(value, kind) {
  if (value === null) return null;
  if (typeof value !== "string" || hasForbiddenScalars(value)) return null;
  const hosts = { telegram: "t.me", whatsapp: "wa.me", vk: "vk.com" };
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || raw.split(/[/?#]/)[2]?.includes("@")) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
      return null;
    }
    if (url.href.length > 300) return null;
    if (kind) {
      if (
        url.protocol !== "https:" ||
        url.hostname !== hosts[kind] ||
        url.pathname === "/"
      ) {
        return null;
      }
    }
    return url.href;
  } catch {
    return null;
  }
}

function parsePublicContacts(raw) {
  if (raw === undefined || raw === null) return null;
  assertPlainObject(raw, "INVALID_PUBLIC_CONTACTS");
  assertAllowlist(raw, PUBLIC_CONTACT_KEYS, "INVALID_PUBLIC_CONTACTS");
  if (!("phone" in raw) || !("website" in raw) || !("messengers" in raw)) {
    fail("INVALID_PUBLIC_CONTACTS", "phone/website/messengers required");
  }
  const phone =
    raw.phone === null
      ? null
      : publicContactPhone(raw.phone);
  if (raw.phone !== null && phone === null) {
    fail("INVALID_PUBLIC_CONTACTS", "phone");
  }
  const website =
    raw.website === null ? null : publicContactUrl(raw.website);
  if (raw.website !== null && website === null) {
    fail("INVALID_PUBLIC_CONTACTS", "website");
  }
  if (!Array.isArray(raw.messengers) || raw.messengers.length > 3) {
    fail("INVALID_PUBLIC_CONTACTS", "messengers");
  }
  const messengers = [];
  const kinds = new Set();
  for (const item of raw.messengers) {
    assertPlainObject(item, "INVALID_PUBLIC_CONTACTS");
    assertAllowlist(item, MESSENGER_KEYS, "INVALID_PUBLIC_CONTACTS");
    if (item.kind !== "telegram" && item.kind !== "whatsapp" && item.kind !== "vk") {
      fail("INVALID_PUBLIC_CONTACTS", "messenger kind");
    }
    if (kinds.has(item.kind)) fail("INVALID_PUBLIC_CONTACTS", "duplicate messenger");
    kinds.add(item.kind);
    const url = publicContactUrl(item.url, item.kind);
    if (!url) fail("INVALID_PUBLIC_CONTACTS", "messenger url");
    messengers.push({ kind: item.kind, url });
  }
  return { phone, website, messengers };
}

function uuidV5(name, namespaceBuf = URL_NAMESPACE) {
  const hash = crypto
    .createHash("sha1")
    .update(namespaceBuf)
    .update(String(name), "utf8")
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function venueIdForSourceVenueId(sourceVenueId) {
  return uuidV5(`${VENUE_NAME_PREFIX}${sourceVenueId}`);
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * R) / 2) ** 2 +
    Math.cos(lat1 * R) *
      Math.cos(lat2 * R) *
      Math.sin(((lon2 - lon1) * R) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableJson(value[key]);
    return out;
  }
  return value;
}

function buildReviewMarkers(venue, digest) {
  const sourcePayload = {
    sourceVenueId: venue.sourceVenueId,
    sourceUrls: venue.sourceUrls,
    clubSources: venue.clubSources,
    collectedAt: venue.collectedAt,
    nameBasis: venue.nameBasis,
    manifestDigest: digest,
  };
  if (venue.sourceVenueAliases && venue.sourceVenueAliases.length > 0) {
    sourcePayload.sourceVenueAliases = venue.sourceVenueAliases;
  }
  const contactsPayload = {
    publicContacts: venue.publicContacts,
    contactSources: venue.contactSources,
    courtCount: venue.courtCount === undefined ? null : venue.courtCount,
  };
  const markers = [
    `${MARKER_SOURCE}${venue.sourceVenueId}`,
  ];
  for (const alias of venue.sourceVenueAliases || []) {
    markers.push(`${MARKER_SOURCE}${alias}`);
  }
  markers.push(
    `${MARKER_DIGEST}${digest}`,
    `${MARKER_SOURCE_JSON}${JSON.stringify(stableJson(sourcePayload))}`,
    `${MARKER_CONTACTS_JSON}${JSON.stringify(stableJson(contactsPayload))}`,
  );
  if (venue.reviewResolution) {
    markers.push(
      `${MARKER_REVIEW_RESOLUTION}${JSON.stringify(stableJson(venue.reviewResolution))}`,
    );
  }
  return markers;
}

/**
 * Optional explicit public-source address/point correction.
 * Original archive/CSV untouched; provenance persists in review_markers.
 * Corrected tuple must match the manifest venue address+point exactly.
 */
function validateReviewResolution(raw, venue) {
  assertPlainObject(raw, "INVALID_REVIEW_RESOLUTION");
  assertAllowlist(raw, REVIEW_RESOLUTION_KEYS, "INVALID_REVIEW_RESOLUTION");
  for (const key of REVIEW_RESOLUTION_KEYS) {
    if (!(key in raw)) fail("INVALID_REVIEW_RESOLUTION", `missing ${key}`);
  }
  if (raw.kind !== REVIEW_RESOLUTION_KIND) {
    fail("INVALID_REVIEW_RESOLUTION", "kind");
  }
  assertPlainObject(raw.original, "INVALID_REVIEW_RESOLUTION");
  assertAllowlist(raw.original, REVIEW_ORIGINAL_KEYS, "INVALID_REVIEW_RESOLUTION");
  for (const key of REVIEW_ORIGINAL_KEYS) {
    if (!(key in raw.original)) fail("INVALID_REVIEW_RESOLUTION", `original.${key}`);
  }
  assertPlainObject(raw.corrected, "INVALID_REVIEW_RESOLUTION");
  assertAllowlist(raw.corrected, REVIEW_CORRECTED_KEYS, "INVALID_REVIEW_RESOLUTION");
  for (const key of REVIEW_CORRECTED_KEYS) {
    if (!(key in raw.corrected)) fail("INVALID_REVIEW_RESOLUTION", `corrected.${key}`);
  }
  if (typeof raw.original.address !== "string" || !raw.original.address.trim()) {
    fail("INVALID_REVIEW_RESOLUTION", "original.address");
  }
  if (raw.original.sourceVenueId !== venue.sourceVenueId) {
    fail("INVALID_REVIEW_RESOLUTION", "original.sourceVenueId");
  }
  if (!REVIEW_IMPORT_READY.has(raw.original.importReady)) {
    fail("INVALID_REVIEW_RESOLUTION", "original.importReady");
  }
  if (!isDateLike(raw.original.collectedAt)) {
    fail("INVALID_REVIEW_RESOLUTION", "original.collectedAt");
  }
  const origLat = raw.original.latitude;
  const origLon = raw.original.longitude;
  if (origLat !== null && !isFiniteNumber(origLat)) {
    fail("INVALID_REVIEW_RESOLUTION", "original.latitude");
  }
  if (origLon !== null && !isFiniteNumber(origLon)) {
    fail("INVALID_REVIEW_RESOLUTION", "original.longitude");
  }
  if ((origLat === null) !== (origLon === null)) {
    fail("INVALID_REVIEW_RESOLUTION", "original.coords_pair");
  }
  if (typeof raw.corrected.address !== "string" || !raw.corrected.address.trim()) {
    fail("INVALID_REVIEW_RESOLUTION", "corrected.address");
  }
  if (!isFiniteNumber(raw.corrected.latitude) || !isFiniteNumber(raw.corrected.longitude)) {
    fail("INVALID_REVIEW_RESOLUTION", "corrected.coords");
  }
  if (raw.corrected.address.trim() !== venue.address.trim()) {
    fail("REVIEW_RESOLUTION_CORRECTED_MISMATCH", "address");
  }
  if (
    Math.abs(raw.corrected.latitude - venue.latitude) > 1e-9 ||
    Math.abs(raw.corrected.longitude - venue.longitude) > 1e-9
  ) {
    fail("REVIEW_RESOLUTION_CORRECTED_MISMATCH", "coords");
  }
  const primaryUrl = httpsUrlOk(raw.primaryAddressSourceURL);
  if (!primaryUrl) fail("INVALID_REVIEW_RESOLUTION", "primaryAddressSourceURL");
  const pointUrl = httpsUrlOk(raw.pointSourceURL);
  if (!pointUrl) fail("INVALID_REVIEW_RESOLUTION", "pointSourceURL");
  if (!isDateLike(raw.pointCheckedAt)) {
    fail("INVALID_REVIEW_RESOLUTION", "pointCheckedAt");
  }
  if (typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 800) {
    fail("INVALID_REVIEW_RESOLUTION", "reason");
  }
  if (hasForbiddenScalars(raw.reason)) fail("INVALID_REVIEW_RESOLUTION", "reason");
  return {
    kind: REVIEW_RESOLUTION_KIND,
    original: {
      address: raw.original.address.trim(),
      latitude: origLat === null ? null : origLat,
      longitude: origLon === null ? null : origLon,
      sourceVenueId: raw.original.sourceVenueId,
      importReady: raw.original.importReady,
      collectedAt: raw.original.collectedAt,
    },
    corrected: {
      address: raw.corrected.address.trim(),
      latitude: raw.corrected.latitude,
      longitude: raw.corrected.longitude,
    },
    primaryAddressSourceURL: primaryUrl,
    pointSourceURL: pointUrl,
    pointCheckedAt: raw.pointCheckedAt,
    reason: raw.reason.trim(),
  };
}

/**
 * Optional non-primary B4U-V aliases for one physical venue (same clubs on one UUID).
 * Primary UUID stays uuidv5(namespace + primary sourceVenueId).
 */
function validateSourceVenueAliases(raw, primaryId, seenSourceIds) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail("INVALID_SOURCE_VENUE_ALIASES");
  if (raw.length === 0) fail("INVALID_SOURCE_VENUE_ALIASES", "empty");
  if (raw.length > 8) fail("INVALID_SOURCE_VENUE_ALIASES", "too_many");
  const out = [];
  const local = new Set();
  for (const item of raw) {
    if (typeof item !== "string" || !SOURCE_VENUE_RE.test(item)) {
      fail("INVALID_SOURCE_VENUE_ALIAS", String(item));
    }
    if (item === primaryId) {
      fail("ALIAS_EQUALS_PRIMARY", item);
    }
    if (local.has(item)) fail("DUPLICATE_SOURCE_VENUE_ALIAS", item);
    if (seenSourceIds.has(item)) {
      fail("ALIAS_CONFLICTS_WITH_SOURCE", item);
    }
    local.add(item);
    seenSourceIds.add(item);
    out.push(item);
  }
  out.sort();
  return out;
}

function markerSourceIds(markers) {
  const ids = [];
  if (!Array.isArray(markers)) return ids;
  for (const m of markers) {
    if (typeof m === "string" && m.startsWith(MARKER_SOURCE)) {
      ids.push(m.slice(MARKER_SOURCE.length));
    }
  }
  return ids;
}

function markerDigest(markers) {
  if (!Array.isArray(markers)) return null;
  for (const m of markers) {
    if (typeof m === "string" && m.startsWith(MARKER_DIGEST)) {
      return m.slice(MARKER_DIGEST.length);
    }
  }
  return null;
}

/** First marker payload after prefix, or null if absent. */
function markerPayload(markers, prefix) {
  if (!Array.isArray(markers)) return null;
  for (const m of markers) {
    if (typeof m === "string" && m.startsWith(prefix)) {
      return m.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Replay must keep durable B4U_SOURCE_V1 and B4U_REVIEW_RESOLUTION_V1 byte-identical.
 * SOURCE_VENUE_ID + REGIONS485_DIGEST alone are not enough: missing/altered provenance
 * → caller refuses IDEMPOTENT_REPLAY_CONFLICT.
 * B4U_CONTACTS_V1 is excluded so later public-contact enrichment can still SKIP.
 * Both sides absent for B4U_REVIEW_RESOLUTION_V1 = legacy optional-absent compatibility.
 */
function immutableProvenanceMarkersMatch(expectedMarkers, priorMarkers) {
  const expectedSource = markerPayload(expectedMarkers, MARKER_SOURCE_JSON);
  const priorSource = markerPayload(priorMarkers, MARKER_SOURCE_JSON);
  if (expectedSource === null || priorSource === null || expectedSource !== priorSource) {
    return false;
  }
  const expectedResolution = markerPayload(expectedMarkers, MARKER_REVIEW_RESOLUTION);
  const priorResolution = markerPayload(priorMarkers, MARKER_REVIEW_RESOLUTION);
  return expectedResolution === priorResolution;
}

function validateCity(city, seenIds, seenNames) {
  assertPlainObject(city, "INVALID_CITY");
  assertAllowlist(city, CITY_KEYS, "INVALID_CITY");
  for (const key of CITY_KEYS) {
    if (!(key in city)) fail("INVALID_CITY", `missing ${key}`);
  }
  if (!UUID_RE.test(city.id)) fail("INVALID_CITY", "id");
  if (seenIds.has(city.id)) fail("DUPLICATE_CITY_ID", city.id);
  seenIds.add(city.id);
  if (typeof city.nameRu !== "string" || !city.nameRu.trim()) {
    fail("INVALID_CITY", "nameRu");
  }
  if (EXCLUDED_CITY_NAMES.has(city.nameRu)) {
    fail("CITY_EXCLUDED", city.nameRu);
  }
  const approved = APPROVED_CITIES[city.nameRu];
  if (!approved) fail("CITY_NOT_APPROVED", city.nameRu);
  if (seenNames.has(city.nameRu)) fail("DUPLICATE_CITY_NAME", city.nameRu);
  seenNames.add(city.nameRu);
  if (city.nameEn !== approved.nameEn) {
    fail("CITY_NAME_EN_MISMATCH", city.nameRu);
  }
  if (city.timezone !== approved.timezone || !isValidIana(city.timezone)) {
    fail("CITY_TIMEZONE_INVALID", city.nameRu);
  }
  if (!isFiniteNumber(city.centerLatitude) || !isFiniteNumber(city.centerLongitude)) {
    fail("INVALID_CITY_CENTER", city.nameRu);
  }
  if (
    city.centerLatitude < 41 ||
    city.centerLatitude > 82 ||
    city.centerLongitude < 19 ||
    city.centerLongitude > 190
  ) {
    fail("INVALID_CITY_CENTER", city.nameRu);
  }
  const centerUrl = httpsUrlOk(city.centerSourceUrl);
  if (!centerUrl) fail("INVALID_CENTER_SOURCE_URL", city.nameRu);
  if (!isDateLike(city.centerCheckedAt)) fail("INVALID_CENTER_CHECKED_AT", city.nameRu);
  return {
    id: city.id,
    nameRu: city.nameRu,
    nameEn: city.nameEn,
    timezone: city.timezone,
    centerLatitude: city.centerLatitude,
    centerLongitude: city.centerLongitude,
    centerSourceUrl: centerUrl,
    centerCheckedAt: city.centerCheckedAt,
  };
}

function validateClubSources(clubSources, sourceUrls) {
  if (!Array.isArray(clubSources) || clubSources.length < 1) {
    fail("MISSING_CLUB_SOURCES");
  }
  const ids = new Set();
  const out = [];
  for (const club of clubSources) {
    assertPlainObject(club, "INVALID_CLUB_SOURCE");
    assertAllowlist(club, CLUB_KEYS, "INVALID_CLUB_SOURCE");
    if (!CLUB_ID_RE.test(club.clubId)) fail("INVALID_CLUB_ID", String(club.clubId));
    if (ids.has(club.clubId)) fail("DUPLICATE_CLUB_ID", club.clubId);
    ids.add(club.clubId);
    if (typeof club.name !== "string" || !club.name.trim()) {
      fail("INVALID_CLUB_NAME");
    }
    const url = httpsUrlOk(club.url, {
      hostExact: "badminton4u.ru",
      pathRe: CLUB_PATH_RE,
    });
    if (!url) fail("INVALID_CLUB_URL", club.clubId);
    const digits = club.clubId.slice("B4U-C-".length);
    const pathDigits = url.match(CLUB_PATH_RE)?.[1];
    if (pathDigits !== digits) fail("CLUB_URL_ID_MISMATCH", club.clubId);
    out.push({ clubId: club.clubId, name: club.name.trim(), url });
  }
  if (!Array.isArray(sourceUrls) || sourceUrls.length < 1) {
    fail("MISSING_SOURCE_URLS");
  }
  const normalizedUrls = [];
  for (const raw of sourceUrls) {
    const url = httpsUrlOk(raw, {
      hostExact: "badminton4u.ru",
      pathRe: CLUB_PATH_RE,
    });
    if (!url) fail("INVALID_SOURCE_URL", String(raw));
    normalizedUrls.push(url);
  }
  for (const club of out) {
    if (!normalizedUrls.includes(club.url)) {
      fail("CLUB_LINK_NOT_IN_SOURCE_URLS", club.clubId);
    }
  }
  return { clubSources: out, sourceUrls: normalizedUrls };
}

function validateContactSources(raw) {
  if (!Array.isArray(raw)) fail("INVALID_CONTACT_SOURCES");
  const out = [];
  for (const row of raw) {
    assertPlainObject(row, "INVALID_CONTACT_SOURCE");
    assertAllowlist(row, CONTACT_SOURCE_KEYS, "INVALID_CONTACT_SOURCE");
    if (typeof row.contactType !== "string" || !row.contactType.trim()) {
      fail("INVALID_CONTACT_SOURCE", "contactType");
    }
    if (typeof row.value !== "string") fail("INVALID_CONTACT_SOURCE", "value");
    const sourceUrl = httpsUrlOk(row.sourceUrl);
    if (!sourceUrl) fail("INVALID_CONTACT_SOURCE", "sourceUrl");
    if (!isDateLike(row.checkedAt)) fail("INVALID_CONTACT_SOURCE", "checkedAt");
    out.push({
      contactType: row.contactType.trim(),
      value: row.value,
      sourceUrl,
      checkedAt: row.checkedAt,
    });
  }
  return out;
}

function validateVenue(venue, citiesById, seenVenueIds, seenSourceIds) {
  assertPlainObject(venue, "INVALID_VENUE");
  assertAllowlist(venue, VENUE_KEYS, "INVALID_VENUE");
  const required = [
    "id",
    "sourceVenueId",
    "name",
    "address",
    "cityId",
    "latitude",
    "longitude",
    "importReady",
    "sourceUrls",
    "clubSources",
    "collectedAt",
    "nameBasis",
    "contactSources",
  ];
  for (const key of required) {
    if (!(key in venue)) fail("INVALID_VENUE", `missing ${key}`);
  }
  if (venue.importReady !== "yes") fail("IMPORT_READY_NOT_YES");
  if (!SOURCE_VENUE_RE.test(venue.sourceVenueId)) {
    fail("INVALID_SOURCE_VENUE_ID", String(venue.sourceVenueId));
  }
  if (seenSourceIds.has(venue.sourceVenueId)) {
    fail("DUPLICATE_SOURCE_VENUE_ID", venue.sourceVenueId);
  }
  seenSourceIds.add(venue.sourceVenueId);
  const expectedId = venueIdForSourceVenueId(venue.sourceVenueId);
  if (!UUID_RE.test(venue.id) || venue.id.toLowerCase() !== expectedId) {
    fail("VENUE_ID_MISMATCH", venue.sourceVenueId);
  }
  if (seenVenueIds.has(venue.id.toLowerCase())) {
    fail("DUPLICATE_VENUE_ID", venue.id);
  }
  seenVenueIds.add(venue.id.toLowerCase());
  if (typeof venue.name !== "string" || !venue.name.trim()) {
    fail("EMPTY_VENUE_NAME");
  }
  if (typeof venue.address !== "string" || !venue.address.trim()) {
    fail("EMPTY_VENUE_ADDRESS");
  }
  if (venue.name.trim().length > 160 || venue.address.trim().length > 500) {
    fail("VENUE_TEXT_TOO_LONG");
  }
  const city = citiesById.get(venue.cityId);
  if (!city) fail("VENUE_CITY_UNKNOWN", venue.cityId);
  if (!isFiniteNumber(venue.latitude) || !isFiniteNumber(venue.longitude)) {
    fail("INVALID_VENUE_COORDS");
  }
  if (venue.latitude < -90 || venue.latitude > 90 || venue.longitude < -180 || venue.longitude > 180) {
    fail("INVALID_VENUE_COORDS");
  }
  // City radius and 150 m dedup are authoritative only via PostGIS ST_DWithin
  // (loadStateForPlan). Spherical haversine must never reject those boundaries.
  if (
    venue.nameBasis !== "SOURCE_VENUE_NAME" &&
    venue.nameBasis !== "EXPLICIT_SOURCE_CLUB_LABEL"
  ) {
    fail("INVALID_NAME_BASIS");
  }
  if (!isDateLike(venue.collectedAt)) fail("INVALID_COLLECTED_AT");
  const { clubSources, sourceUrls } = validateClubSources(
    venue.clubSources,
    venue.sourceUrls,
  );
  const publicContacts = parsePublicContacts(venue.publicContacts);
  const contactSources = validateContactSources(venue.contactSources);
  assertContactProvenance(publicContacts, contactSources);
  let courtCount;
  if ("courtCount" in venue) {
    if (
      !Number.isInteger(venue.courtCount) ||
      venue.courtCount < 0 ||
      venue.courtCount > 10000
    ) {
      fail("INVALID_COURT_COUNT");
    }
    courtCount = venue.courtCount;
  }
  const sourceVenueAliases = validateSourceVenueAliases(
    venue.sourceVenueAliases,
    venue.sourceVenueId,
    seenSourceIds,
  );
  const trimmedVenue = {
    sourceVenueId: venue.sourceVenueId,
    address: venue.address.trim(),
    latitude: venue.latitude,
    longitude: venue.longitude,
  };
  let reviewResolution;
  if ("reviewResolution" in venue && venue.reviewResolution != null) {
    reviewResolution = validateReviewResolution(venue.reviewResolution, trimmedVenue);
  }
  return {
    id: venue.id.toLowerCase(),
    sourceVenueId: venue.sourceVenueId,
    name: venue.name.trim(),
    address: venue.address.trim(),
    cityId: venue.cityId,
    latitude: venue.latitude,
    longitude: venue.longitude,
    importReady: "yes",
    sourceUrls,
    clubSources,
    collectedAt: venue.collectedAt,
    nameBasis: venue.nameBasis,
    publicContacts,
    contactSources,
    courtCount,
    sourceVenueAliases,
    reviewResolution,
    // Convenience for planners; not a manifest key — do not re-validate this object.
    timezone: city.timezone,
  };
}

function assertContactProvenance(publicContacts, contactSources) {
  if (!publicContacts) return;
  const required = [];
  if (publicContacts.phone) {
    required.push({ contactType: "phone", value: publicContacts.phone });
  }
  if (publicContacts.website) {
    required.push({ contactType: "website", value: publicContacts.website });
  }
  for (const messenger of publicContacts.messengers) {
    required.push({ contactType: messenger.kind, value: messenger.url });
  }
  for (const need of required) {
    const matched = contactSources.some(
      (row) => row.contactType === need.contactType && row.value === need.value,
    );
    if (!matched) {
      fail("CONTACT_PROVENANCE_MISSING", `${need.contactType}`);
    }
  }
}

function validateManifest(raw) {
  assertPlainObject(raw, "INVALID_MANIFEST");
  assertAllowlist(raw, MANIFEST_KEYS, "INVALID_MANIFEST");
  if (raw.schema !== SCHEMA) fail("INVALID_SCHEMA");
  if (typeof raw.batch !== "string" || !BATCH_RE.test(raw.batch)) {
    fail("INVALID_BATCH");
  }
  if (raw.sourceArchiveSha256 !== SOURCE_ARCHIVE_SHA256) {
    fail("SOURCE_ARCHIVE_SHA256_MISMATCH");
  }
  if (!Array.isArray(raw.cities) || raw.cities.length !== 11) {
    fail("CITIES_COUNT_NOT_11");
  }
  if (!Array.isArray(raw.venues)) fail("INVALID_VENUES");
  if (raw.venues.length > MAX_VENUES) fail("VENUE_COUNT_EXCEEDED");
  const seenIds = new Set();
  const seenNames = new Set();
  const cities = raw.cities.map((c) => validateCity(c, seenIds, seenNames));
  if (seenNames.size !== 11) fail("CITIES_NOT_EXACT_APPROVED_SET");
  for (const name of Object.keys(APPROVED_CITIES)) {
    if (!seenNames.has(name)) fail("MISSING_APPROVED_CITY", name);
  }
  const citiesById = new Map(cities.map((c) => [c.id, c]));
  const seenVenueIds = new Set();
  const seenSourceIds = new Set();
  const venues = raw.venues.map((v) =>
    validateVenue(v, citiesById, seenVenueIds, seenSourceIds),
  );
  return { schema: SCHEMA, batch: raw.batch, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256, cities, venues };
}

function parseCliArgs(argv) {
  const options = new Map();
  let apply = false;
  let trialRollback = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      if (apply) fail("INVALID_ARGUMENTS", "duplicate --apply");
      apply = true;
      continue;
    }
    if (arg === "--trial-rollback") {
      if (trialRollback) fail("INVALID_ARGUMENTS", "duplicate --trial-rollback");
      trialRollback = true;
      continue;
    }
    if (
      !arg ||
      !["--manifest", "--manifest-sha256", "--actor-principal-id"].includes(arg) ||
      options.has(arg)
    ) {
      fail("INVALID_ARGUMENTS", arg || "empty");
    }
    const value = argv[++i];
    if (!value || value.startsWith("--")) fail("INVALID_ARGUMENTS", arg);
    options.set(arg, value);
  }
  if (apply && trialRollback) fail("INVALID_ARGUMENTS", "apply+trial");
  const manifestPath = options.get("--manifest");
  const manifestSha256 = options.get("--manifest-sha256");
  const actorPrincipalId = options.get("--actor-principal-id");
  if (!manifestPath || !manifestSha256 || !actorPrincipalId) {
    fail("INVALID_ARGUMENTS", "required flags");
  }
  if (!SHA256_RE.test(manifestSha256)) fail("INVALID_MANIFEST_SHA256");
  if (!UUID_RE.test(actorPrincipalId)) fail("INVALID_ACTOR_PRINCIPAL_ID");
  const mode = apply ? "APPLY" : trialRollback ? "TRIAL_ROLLBACK" : "DRY_RUN";
  return { manifestPath, manifestSha256, actorPrincipalId, mode };
}

function loadApiDeps(cwd = process.cwd()) {
  const req = createRequire(path.resolve(cwd, "package.json"));
  return {
    Pool: req("pg").Pool,
    normalize: req("./dist/venues/venue-normalize.js"),
    adminDb: req("./dist/admin/admin-db.js"),
    loadEnv: req("./dist/config/env.js").loadEnv,
  };
}

function rolesHaveVenueManage(roles) {
  return roles.includes("superadmin") || roles.includes("content_manager");
}

async function requireImportActorSafe(client, principalId, forUpdate) {
  // Lock principal+user in a valid non-aggregate query, then read active grants.
  // FOR UPDATE cannot combine with GROUP BY (PostgreSQL rejects the old shape).
  if (forUpdate) {
    const locked = (
      await client.query(
        `SELECT p.user_id
           FROM admin_principals p
           JOIN users u ON u.id = p.user_id
          WHERE p.id = $1 AND p.status = 'active' AND u.status = 'active'
          FOR UPDATE OF p, u`,
        [principalId],
      )
    ).rows[0];
    if (!locked) fail("IMPORT_ACTOR_REFUSED");
  }
  const row = (
    await client.query(
      `SELECT p.user_id,
              coalesce(array_agg(g.role ORDER BY g.role) FILTER (WHERE g.active = true), '{}') AS roles
         FROM admin_principals p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN admin_role_grants g ON g.principal_id = p.id
        WHERE p.id = $1 AND p.status = 'active' AND u.status = 'active'
        GROUP BY p.user_id`,
      [principalId],
    )
  ).rows[0];
  const roles = Array.isArray(row?.roles) ? row.roles : [];
  if (!row || !rolesHaveVenueManage(roles)) fail("IMPORT_ACTOR_REFUSED");
  return { userId: row.user_id, roles };
}

function contactsEqual(a, b) {
  return JSON.stringify(stableJson(a ?? null)) === JSON.stringify(stableJson(b ?? null));
}

function markersEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Pure planning against injectable snapshots (no live DB required in tests).
 */
function planAgainstState(manifest, digest, state, normalize) {
  const {
    normalizeVenueText,
    extractIdentityDiscriminator,
    venueDedupeKey,
    VENUE_NORMALIZATION_VERSION,
  } = normalize;
  // Batch/catalog 150 m + 40 km gates are PostGIS-only (loadStateForPlan).
  // Pure planner may consume spatialFacts already validated by the DB path.

  const cityById = new Map(manifest.cities.map((c) => [c.id, c]));
  const existingCities = state.cities || [];
  const citiesToInsert = [];
  const citiesReused = [];
  for (const city of manifest.cities) {
    const byId = existingCities.find((c) => c.id === city.id);
    const byName = existingCities.find((c) => c.name_ru === city.nameRu);
    if (byId && byName && byId.id !== byName.id) {
      fail("CITY_NAME_ID_COLLISION", city.nameRu);
    }
    if (byId) {
      if (
        byId.name_ru !== city.nameRu ||
        byId.name_en !== city.nameEn ||
        byId.default_timezone !== city.timezone ||
        byId.country_code !== "RU"
      ) {
        fail("CITY_CONFLICT", city.id);
      }
      citiesReused.push(city.id);
    } else if (byName) {
      fail("CITY_NAME_CONFLICT", city.nameRu);
    } else {
      citiesToInsert.push(city);
    }
  }

  const existingVenues = state.venues || [];
  const identityKeys = new Map((state.identityKeys || []).map((k) => [k.dedupe_key, k.venue_id]));
  const byId = new Map(existingVenues.map((v) => [v.id, v]));
  const bySource = new Map();
  for (const v of existingVenues) {
    const markers = Array.isArray(v.review_markers) ? v.review_markers : [];
    for (const sourceId of markerSourceIds(markers)) {
      const existing = bySource.get(sourceId);
      if (existing && existing.id !== v.id) {
        fail("SOURCE_ID_CONFLICT", sourceId);
      }
      bySource.set(sourceId, v);
    }
  }

  const toInsert = [];
  const toSkip = [];
  for (const venue of manifest.venues) {
    const markers = buildReviewMarkers(venue, digest);
    const normalizedName = normalizeVenueText(venue.name);
    const normalizedAddress = normalizeVenueText(venue.address);
    const identityDiscriminator = extractIdentityDiscriminator(venue.name, venue.address);
    const key = venueDedupeKey({
      cityId: venue.cityId,
      normalizedName,
      normalizedAddress,
      identityDiscriminator,
      normalizationVersion: VENUE_NORMALIZATION_VERSION,
    });
    const prepared = {
      ...venue,
      markers,
      normalizedName,
      normalizedAddress,
      identityDiscriminator,
      key,
      timezone: cityById.get(venue.cityId).timezone,
    };

    // Existing-catalog 150 m address collisions are authoritative via PostGIS in
    // loadStateForPlan (or spatialFacts). Do not haversine-reject here.

    const priorById = byId.get(venue.id);
    const claimedIds = [venue.sourceVenueId, ...(venue.sourceVenueAliases || [])];
    let priorBySource = null;
    for (const sourceId of claimedIds) {
      const hit = bySource.get(sourceId);
      if (!hit) continue;
      if (hit.id !== venue.id) {
        fail("SOURCE_ID_CONFLICT", sourceId);
      }
      if (priorBySource && priorBySource.id !== hit.id) {
        fail("SOURCE_MAPPING_CONFLICT", sourceId);
      }
      priorBySource = hit;
    }
    if (priorById && priorBySource && priorById.id !== priorBySource.id) {
      fail("SOURCE_MAPPING_CONFLICT", venue.sourceVenueId);
    }
    const prior = priorById || priorBySource;
    if (identityKeys.has(key) && identityKeys.get(key) !== venue.id) {
      fail("IDENTITY_KEY_CONFLICT", venue.sourceVenueId);
    }

    if (prior) {
      const lat = Number(prior.latitude);
      const lon = Number(prior.longitude);
      const priorDigest = markerDigest(prior.review_markers);
      const priorSources = new Set(markerSourceIds(prior.review_markers));
      const sourceIdsMatch =
        priorSources.has(venue.sourceVenueId) &&
        (venue.sourceVenueAliases || []).every((alias) => priorSources.has(alias));
      const provenanceMarkersOk = immutableProvenanceMarkersMatch(
        markers,
        prior.review_markers,
      );
      const coreIdentityOk =
        prior.id === venue.id &&
        prior.name === venue.name &&
        prior.address === venue.address &&
        prior.city_id === venue.cityId &&
        prior.timezone === prepared.timezone &&
        prior.data_status === "unverified" &&
        prior.lifecycle_state === "unverified" &&
        prior.provenance === "admin_created" &&
        prior.normalized_name === normalizedName &&
        prior.normalized_address === normalizedAddress &&
        prior.normalization_version === VENUE_NORMALIZATION_VERSION &&
        prior.identity_discriminator === identityDiscriminator &&
        Math.abs(lat - venue.latitude) <= 1e-6 &&
        Math.abs(lon - venue.longitude) <= 1e-6 &&
        (prior.court_count ?? null) === (venue.courtCount ?? null) &&
        identityKeys.get(key) === venue.id &&
        priorDigest === digest &&
        sourceIdsMatch &&
        provenanceMarkersOk;
      // Same source ID + same immutable digest + durable B4U_SOURCE_V1 /
      // B4U_REVIEW_RESOLUTION_V1 (legacy both-absent OK) + valid identity:
      // SKIP and preserve later authorized public-data contact enrichment (zero writes).
      // Do not blind-skip arbitrary existing UUIDs; refuse different digests / collisions.
      // Missing/altered source JSON or resolution marker → IDEMPOTENT_REPLAY_CONFLICT.
      // Different digest (or identity drift) that would overwrite contacts → IDEMPOTENT_REPLAY_CONFLICT.
      if (coreIdentityOk) {
        toSkip.push(prepared);
      } else {
        fail("IDEMPOTENT_REPLAY_CONFLICT", venue.sourceVenueId);
      }
    } else {
      // Alias must not collide with another row's durable source identity.
      for (const sourceId of claimedIds) {
        const hit = bySource.get(sourceId);
        if (hit && hit.id !== venue.id) fail("SOURCE_ID_CONFLICT", sourceId);
      }
      toInsert.push(prepared);
    }
  }

  return { citiesToInsert, citiesReused, toInsert, toSkip };
}

async function geographyWithin(client, lon1, lat1, lon2, lat2, meters) {
  const row = (
    await client.query(
      `SELECT ST_DWithin(
         ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,
         ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,
         $5
       ) AS inside`,
      [lon1, lat1, lon2, lat2, meters],
    )
  ).rows[0];
  return Boolean(row?.inside);
}

async function loadStateForPlan(client, manifest, normalizeVenueText) {
  const cityIds = manifest.cities.map((c) => c.id);
  const cityNames = manifest.cities.map((c) => c.nameRu);
  const cities = (
    await client.query(
      `SELECT id, country_code, name_ru, name_en, default_timezone
         FROM cities
        WHERE id = ANY($1::uuid[]) OR name_ru = ANY($2::text[])`,
      [cityIds, cityNames],
    )
  ).rows;

  const venues = (
    await client.query(
      `SELECT v.id, v.name, v.address, v.city_id, v.timezone, v.created_by_user_id,
              v.provenance, v.data_status, v.lifecycle_state, v.normalized_name,
              v.normalized_address, v.normalization_version, v.identity_discriminator,
              v.review_markers, v.public_contacts, v.court_count,
              ST_Y(v.location::geometry) AS latitude,
              ST_X(v.location::geometry) AS longitude
         FROM venues v
        WHERE v.lifecycle_state IS DISTINCT FROM 'merged'`,
    )
  ).rows;

  const identityKeys = (
    await client.query(`SELECT dedupe_key, venue_id FROM venue_identity_keys`)
  ).rows;

  for (const venue of manifest.venues) {
    const city = manifest.cities.find((c) => c.id === venue.cityId);
    const inside = await geographyWithin(
      client,
      venue.longitude,
      venue.latitude,
      city.centerLongitude,
      city.centerLatitude,
      CITY_RADIUS_METERS,
    );
    if (!inside) fail("VENUE_OUTSIDE_CITY_RADIUS", venue.sourceVenueId);

    const normalizedAddress = normalizeVenueText(venue.address);
    const ambiguous = (
      await client.query(
        `SELECT id FROM venues
          WHERE lifecycle_state IS DISTINCT FROM 'merged'
            AND id <> $1::uuid
            AND normalized_address = $2
            AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,
              $5
            )
          LIMIT 1`,
        [venue.id, normalizedAddress, venue.longitude, venue.latitude, DEDUPE_METERS],
      )
    ).rows[0];
    if (ambiguous) {
      fail("EXISTING_AMBIGUOUS_DEDUP", `${venue.sourceVenueId}/${ambiguous.id}`);
    }
  }

  // New-batch pairs: same normalized address + PostGIS ≤150 m → abort (no haversine).
  for (let i = 0; i < manifest.venues.length; i++) {
    for (let j = i + 1; j < manifest.venues.length; j++) {
      const a = manifest.venues[i];
      const b = manifest.venues[j];
      if (normalizeVenueText(a.address) !== normalizeVenueText(b.address)) continue;
      const near = await geographyWithin(
        client,
        a.longitude,
        a.latitude,
        b.longitude,
        b.latitude,
        DEDUPE_METERS,
      );
      if (near) {
        fail("BATCH_AMBIGUOUS_DEDUP", `${a.sourceVenueId}/${b.sourceVenueId}`);
      }
    }
  }

  return { cities, venues, identityKeys };
}

async function applyWrites(client, plan, actor, digest, appendAudit, normalizationVersion) {
  let citiesInserted = 0;
  let venuesInserted = 0;
  for (const city of plan.citiesToInsert) {
    const q = await client.query(
      `INSERT INTO cities(id, country_code, name_ru, name_en, default_timezone)
       VALUES ($1,'RU',$2,$3,$4)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [city.id, city.nameRu, city.nameEn, city.timezone],
    );
    citiesInserted += q.rowCount;
  }

  for (const venue of plan.toInsert) {
    const contactsJson =
      venue.publicContacts == null ? null : JSON.stringify(venue.publicContacts);
    const inserted = await client.query(
      `INSERT INTO venues (
         id, city_id, name, address, timezone, location,
         data_status, provenance, created_by_user_id, lifecycle_state,
         normalized_name, normalized_address, normalization_version,
         identity_discriminator, review_markers, public_contacts, court_count
       ) VALUES (
         $1,$2,$3,$4,$5,
         ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,
         'unverified','admin_created',$8,'unverified',
         $9,$10,$11,$12,$13::jsonb,$14::jsonb,$15
       ) RETURNING id, version`,
      [
        venue.id,
        venue.cityId,
        venue.name,
        venue.address,
        venue.timezone,
        venue.longitude,
        venue.latitude,
        actor.userId,
        venue.normalizedName,
        venue.normalizedAddress,
        normalizationVersion,
        venue.identityDiscriminator,
        JSON.stringify(venue.markers),
        contactsJson,
        venue.courtCount === undefined ? null : venue.courtCount,
      ],
    );
    if (inserted.rowCount !== 1) fail("INSERT_FAILED", venue.id);
    const version = inserted.rows[0].version;
    const keyIns = await client.query(
      `INSERT INTO venue_identity_keys(dedupe_key, venue_id, normalization_version)
       VALUES ($1,$2,$3) RETURNING venue_id`,
      [venue.key, venue.id, normalizationVersion],
    );
    if (keyIns.rowCount !== 1) fail("IDENTITY_RESERVATION_FAILED", venue.id);

    const auditId = await appendAudit(client, {
      actor: { principalId: actor.principalId, roles: actor.roles },
      action: "venue.create",
      targetType: "venue",
      targetId: venue.id,
      permission: "venue.manage",
      reason: REASON,
      after: {
        version,
        lifecycleState: "unverified",
        manifestDigest: digest,
        sourceVenueId: venue.sourceVenueId,
      },
    });
    await client.query(
      `INSERT INTO venue_admin_actions(venue_id, venue_version, action, actor_id, audit_id)
       VALUES ($1,$2,'create',$3,$4)`,
      [venue.id, version, actor.principalId, auditId],
    );
    await client.query(
      `INSERT INTO outbox_events(type, aggregate_type, aggregate_id, aggregate_version, payload)
       VALUES ('venue.create','venue',$1,$2,$3::jsonb)`,
      [
        venue.id,
        version,
        JSON.stringify({ venueId: venue.id, canonicalVenueId: null }),
      ],
    );
    venuesInserted += 1;
  }
  return { citiesInserted, venuesInserted };
}

function sanitizedReport(mode, digest, manifest, plan, writeResult) {
  return {
    schema: SCHEMA,
    transactionMode: mode,
    batch: manifest.batch,
    manifestDigest: digest,
    sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
    cities: {
      wouldInsert: plan.citiesToInsert.length,
      reused: plan.citiesReused.length,
      inserted: writeResult ? writeResult.citiesInserted : 0,
      ids: manifest.cities.map((c) => c.id),
    },
    venues: {
      wouldInsert: plan.toInsert.length,
      skipped: plan.toSkip.length,
      inserted: writeResult ? writeResult.venuesInserted : 0,
      insertIds: plan.toInsert.map((v) => v.id),
      skippedIds: plan.toSkip.map((v) => v.id),
      sourceVenueIds: manifest.venues.map((v) => v.sourceVenueId),
    },
  };
}

/**
 * @param {object} input
 * @param {'DRY_RUN'|'APPLY'|'TRIAL_ROLLBACK'} input.mode
 * @param {object} input.manifest validated manifest
 * @param {string} input.digest
 * @param {string} input.actorPrincipalId
 * @param {object} input.deps { client? | pool, normalize, appendAudit, adminTransaction? }
 */
async function runImport(input) {
  const { mode, manifest, digest, actorPrincipalId, deps } = input;
  const normalize = deps.normalize;
  if (!normalize?.normalizeVenueText || !normalize?.venueDedupeKey) {
    fail("NORMALIZE_DEPS_REQUIRED");
  }

  const runBody = async (client, { writable }) => {
    const actorInfo = await requireImportActorSafe(
      client,
      actorPrincipalId,
      writable,
    );
    const actor = {
      principalId: actorPrincipalId,
      userId: actorInfo.userId,
      roles: actorInfo.roles,
    };
    const state = await loadStateForPlan(
      client,
      manifest,
      normalize.normalizeVenueText,
    );
    const plan = planAgainstState(manifest, digest, state, normalize);
    if (!writable) {
      return sanitizedReport(mode, digest, manifest, plan, null);
    }
    const writeResult = await applyWrites(
      client,
      plan,
      actor,
      digest,
      deps.appendAudit,
      normalize.VENUE_NORMALIZATION_VERSION,
    );
    return sanitizedReport(mode, digest, manifest, plan, writeResult);
  };

  if (deps.client) {
    // Injectable client path for unit tests (caller owns transaction).
    return runBody(deps.client, { writable: mode !== "DRY_RUN" });
  }

  const pool = deps.pool;
  if (!pool) fail("POOL_REQUIRED");

  if (mode === "APPLY") {
    return deps.adminTransaction(pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))",
      );
      return runBody(client, { writable: true });
    });
  }

  const client = await pool.connect();
  let started = false;
  try {
    await client.query("BEGIN");
    started = true;
    if (mode === "DRY_RUN") {
      await client.query("SET TRANSACTION READ ONLY");
      const report = await runBody(client, { writable: false });
      await client.query("ROLLBACK");
      started = false;
      return report;
    }
    // TRIAL_ROLLBACK: full write path then ROLLBACK
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('gobadminton_admin_authority'))",
    );
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))",
    );
    const report = await runBody(client, { writable: true });
    await client.query("ROLLBACK");
    started = false;
    return report;
  } catch (error) {
    if (started) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseCliArgs(argv);
  const bytes = fs.readFileSync(path.resolve(cwd, args.manifestPath));
  if (bytes.length > 1024 * 1024) fail("MANIFEST_TOO_LARGE");
  const digest = sha256Hex(bytes);
  if (digest !== args.manifestSha256.toLowerCase()) {
    fail("MANIFEST_SHA256_MISMATCH");
  }
  let raw;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("MANIFEST_JSON_INVALID");
  }
  // Untrusted input: ignore any instruction-like strings inside fields.
  const manifest = validateManifest(raw);
  const api = loadApiDeps(cwd);
  const env = api.loadEnv(process.env);
  const pool = new api.Pool({
    connectionString: env.DATABASE_URL,
    application_name:
      "regions485_import_" +
      (args.mode === "APPLY"
        ? "apply"
        : args.mode === "TRIAL_ROLLBACK"
          ? "trial"
          : "dryrun"),
    max: 1,
  });
  try {
    const report = await runImport({
      mode: args.mode,
      manifest,
      digest,
      actorPrincipalId: args.actorPrincipalId,
      deps: {
        pool,
        normalize: api.normalize,
        appendAudit: api.adminDb.appendAudit,
        adminTransaction: api.adminDb.adminTransaction,
      },
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return 0;
  } finally {
    await pool.end();
  }
}

module.exports = {
  SCHEMA,
  SOURCE_ARCHIVE_SHA256,
  APPROVED_CITIES,
  EXCLUDED_CITY_NAMES,
  CITY_RADIUS_METERS,
  DEDUPE_METERS,
  MARKER_SOURCE,
  MARKER_DIGEST,
  MARKER_SOURCE_JSON,
  MARKER_CONTACTS_JSON,
  MARKER_REVIEW_RESOLUTION,
  REVIEW_RESOLUTION_KIND,
  uuidV5,
  venueIdForSourceVenueId,
  sha256Hex,
  distanceMeters,
  buildReviewMarkers,
  immutableProvenanceMarkersMatch,
  validateManifest,
  validateReviewResolution,
  validateSourceVenueAliases,
  parseCliArgs,
  planAgainstState,
  runImport,
  requireImportActorSafe,
  rolesHaveVenueManage,
  loadApiDeps,
  main,
};

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      const code = error && error.code ? String(error.code) : "IMPORT_REFUSED";
      process.stderr.write(`${JSON.stringify({ ok: false, code, message: error.message })}\n`);
      process.exitCode = 2;
    },
  );
}
