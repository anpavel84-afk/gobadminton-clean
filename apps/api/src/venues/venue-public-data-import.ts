import { createHash } from "node:crypto";
import { z } from "zod";
import { publicContactUrl, publicVenueContactsSchema, readPublicVenueContacts, type PublicVenueContacts } from "./public-venue-contacts";
import { extractIdentityDiscriminator, normalizeVenueText, venueDedupeKey } from "./venue-normalize";
import { venueProfileEditSchema } from "./venue-profile";

const sourceUrl = z.string().transform((value, ctx) => {
  const url = publicContactUrl(value);
  if (url === null) {
    ctx.addIssue({ code: "custom", message: "INVALID_SOURCE_URL" });
    return z.NEVER;
  }
  return url;
});

const sourceSchema = z.object({
  url: sourceUrl,
  checkedAt: z.string().min(20).max(40).refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
    const time = Date.parse(value);
    return Number.isFinite(time);
  }, "INVALID_CHECKED_AT"),
  note: z.string().min(1).max(240),
}).strict();

const identityPatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  address: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((identity, ctx) => {
  if (identity.name === undefined && identity.address === undefined) {
    ctx.addIssue({ code: "custom", message: "EMPTY_IDENTITY_PATCH" });
  }
});

const itemSchema = z.object({
  venueId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  expectedName: z.string().trim().min(1).max(160),
  expectedAddress: z.string().trim().min(1).max(500),
  identity: identityPatchSchema.optional(),
  publicContacts: publicVenueContactsSchema.optional(),
  profile: venueProfileEditSchema.optional(),
  sources: z.array(sourceSchema).min(1).max(10),
}).strict().superRefine((item, ctx) => {
  if (item.publicContacts === undefined && item.profile === undefined && item.identity === undefined) {
    ctx.addIssue({ code: "custom", message: "MISSING_PATCH_FIELD" });
  }
});

const manifestSchema = z.object({
  schema: z.literal("VENUE_PUBLIC_DATA_BATCH_V1"),
  batch: z.string().regex(/^[a-z0-9-]{1,40}$/),
  count: z.number().int().min(0).max(50),
  items: z.array(itemSchema).max(50),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.count !== manifest.items.length
    || new Set(manifest.items.map((item) => item.venueId)).size !== manifest.count) {
    ctx.addIssue({ code: "custom", message: "INVALID_COUNT_OR_DUPLICATE" });
  }
});

export type PublicDataManifest = z.infer<typeof manifestSchema>;
export type PublicDataItem = PublicDataManifest["items"][number];
export type PublicDataIdentityPatch = NonNullable<PublicDataItem["identity"]>;
export type PublicDataVenueRow = {
  name: string;
  address: string;
  lifecycle_state: string;
  version: number;
  canonical_venue_id: string | null;
  city_id: string;
  identity_discriminator: string;
  public_contacts: unknown;
  court_count: number | null;
  amenity_parking: boolean | null;
  amenity_showers: boolean | null;
  public_description: string | null;
};

export type PublicDataPlan = { action: "READY" | "SKIPPED" | "FAILED"; reason: string };

export type ResolvedPublicDataIdentity = {
  name: string;
  address: string;
  normalizedName: string;
  normalizedAddress: string;
  identityDiscriminator: string;
  dedupeKey: string;
};

const NAMESPACE = "venue_public_data_v1";

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) out[key] = sortValue(nested);
    return out;
  }
  return value;
}

export function validatePublicDataManifest(raw: unknown): PublicDataManifest {
  return manifestSchema.parse(raw);
}

export function publicDataKeyHash(batch: string, venueId: string): string {
  return createHash("sha256").update(`${NAMESPACE}\n${batch}\n${venueId}`).digest("hex");
}

/** Fingerprint of the COMPLETE normalized accepted item (identity, version, patch, sources). */
export function publicDataPatchFingerprint(item: PublicDataItem): string {
  return createHash("sha256").update(stableStringify({
    venueId: item.venueId,
    expectedVersion: item.expectedVersion,
    expectedName: item.expectedName,
    expectedAddress: item.expectedAddress,
    identity: item.identity,
    publicContacts: item.publicContacts,
    profile: item.profile,
    sources: item.sources,
  })).digest("hex");
}

export function publicDataDigest(manifest: PublicDataManifest): string {
  return createHash("sha256").update(
    manifest.items.map((item) => `${item.venueId}:${publicDataPatchFingerprint(item)}`).sort().join("\n"),
  ).digest("hex");
}

export function contactsEqual(left: PublicVenueContacts | null, right: PublicVenueContacts | null): boolean {
  return stableStringify(left) === stableStringify(right);
}

export function profileFactsEqual(
  row: Pick<PublicDataVenueRow, "court_count" | "amenity_parking" | "amenity_showers" | "public_description">,
  profile: z.infer<typeof venueProfileEditSchema>,
): boolean {
  if (profile === null) {
    return row.court_count === null && row.amenity_parking === null && row.amenity_showers === null
      && row.public_description === null;
  }
  const descriptionMatches = !Object.prototype.hasOwnProperty.call(profile, "description")
    ? true
    : row.public_description === (profile.description ?? null);
  return row.court_count === profile.courtCount
    && row.amenity_parking === profile.amenities.parking
    && row.amenity_showers === profile.amenities.showers
    && descriptionMatches;
}

export function identityPatchMatches(
  row: Pick<PublicDataVenueRow, "name" | "address">,
  identity: PublicDataIdentityPatch,
): boolean {
  if (identity.name !== undefined && row.name !== identity.name) return false;
  if (identity.address !== undefined && row.address !== identity.address) return false;
  return true;
}

export function appliedPublicFieldsMatch(
  row: PublicDataVenueRow,
  applied: {
    publicContacts?: PublicVenueContacts | null;
    profile?: z.infer<typeof venueProfileEditSchema>;
    identity?: PublicDataIdentityPatch;
  },
): boolean {
  if ("identity" in applied && applied.identity !== undefined) {
    if (!identityPatchMatches(row, applied.identity)) return false;
  }
  if ("publicContacts" in applied) {
    if (!contactsEqual(readPublicVenueContacts(row.public_contacts), applied.publicContacts ?? null)) return false;
  }
  if ("profile" in applied) {
    if (!profileFactsEqual(row, applied.profile ?? null)) return false;
  }
  return true;
}

/** Lifecycle/existence gate; identity expectation is checked only when no own receipt. */
export function planPublicDataEligibility(row: PublicDataVenueRow | undefined): PublicDataPlan {
  if (!row) return { action: "FAILED", reason: "VENUE_NOT_FOUND" };
  if (!["unverified", "verified"].includes(row.lifecycle_state)) {
    return { action: "SKIPPED", reason: "VENUE_INELIGIBLE" };
  }
  return { action: "READY", reason: "PUBLIC_DATA_READY" };
}

/** Exact expected old name/address precondition for a first-time apply. */
export function planPublicDataIdentityMatch(row: PublicDataVenueRow, item: PublicDataItem): PublicDataPlan {
  if (row.name !== item.expectedName || row.address !== item.expectedAddress) {
    return { action: "FAILED", reason: "VENUE_IDENTITY_MISMATCH" };
  }
  return { action: "READY", reason: "PUBLIC_DATA_READY" };
}

/** Combined eligibility + expected identity (unit helper; importer checks receipt first). */
export function planPublicDataRow(row: PublicDataVenueRow | undefined, item: PublicDataItem): PublicDataPlan {
  const eligibility = planPublicDataEligibility(row);
  if (eligibility.action !== "READY" || !row) return eligibility;
  return planPublicDataIdentityMatch(row, item);
}

export function planPublicDataVersion(row: PublicDataVenueRow, item: PublicDataItem): PublicDataPlan {
  if (row.version !== item.expectedVersion) return { action: "FAILED", reason: "VENUE_VERSION_CONFLICT" };
  return { action: "READY", reason: "PUBLIC_DATA_READY" };
}

/**
 * Resolve post-patch name/address. Only supplied identity fields change.
 * Non-empty identity_discriminator is preserved so a name-only fix keeps unit boundaries.
 */
export function resolvePublicDataIdentity(
  row: Pick<PublicDataVenueRow, "name" | "address" | "city_id" | "identity_discriminator">,
  identity: PublicDataIdentityPatch,
): ResolvedPublicDataIdentity {
  const name = identity.name !== undefined ? identity.name : row.name;
  const address = identity.address !== undefined ? identity.address : row.address;
  const normalizedName = normalizeVenueText(name);
  const normalizedAddress = normalizeVenueText(address);
  // Keep stored discriminator bytes when present; do not re-normalize through the
  // explicit path (ё/punct rules would rewrite "hall:2" and change the unit key).
  const preserved = row.identity_discriminator.trim();
  const identityDiscriminator = preserved.length > 0
    ? row.identity_discriminator
    : extractIdentityDiscriminator(name, address);
  return {
    name,
    address,
    normalizedName,
    normalizedAddress,
    identityDiscriminator,
    dedupeKey: venueDedupeKey({
      cityId: row.city_id,
      normalizedName,
      normalizedAddress,
      identityDiscriminator,
    }),
  };
}

export function planPublicDataIdentityCollision(
  claimantVenueId: string | undefined,
  venueId: string,
): PublicDataPlan {
  if (claimantVenueId !== undefined && claimantVenueId !== venueId) {
    return { action: "FAILED", reason: "VENUE_IDENTITY_CONFLICT" };
  }
  return { action: "READY", reason: "PUBLIC_DATA_READY" };
}

export type AcceptedPublicDataReceipt = {
  fingerprint: string;
  publicContacts?: PublicVenueContacts | null;
  profile?: z.infer<typeof venueProfileEditSchema>;
  identity?: PublicDataIdentityPatch;
  sources: PublicDataItem["sources"];
};

export function planPublicDataReplay(
  row: PublicDataVenueRow,
  fingerprint: string,
  receipt: AcceptedPublicDataReceipt,
): PublicDataPlan {
  if (receipt.fingerprint !== fingerprint) return { action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" };
  if (!appliedPublicFieldsMatch(row, receipt)) return { action: "FAILED", reason: "PUBLIC_DATA_DRIFT" };
  return { action: "SKIPPED", reason: "PUBLIC_DATA_REPLAY" };
}

export function buildAppliedPatch(item: PublicDataItem): AcceptedPublicDataReceipt {
  const applied: AcceptedPublicDataReceipt = {
    fingerprint: publicDataPatchFingerprint(item),
    sources: item.sources,
  };
  if (item.identity !== undefined) applied.identity = item.identity;
  if (item.publicContacts !== undefined) applied.publicContacts = item.publicContacts;
  if (item.profile !== undefined) applied.profile = item.profile;
  return applied;
}
