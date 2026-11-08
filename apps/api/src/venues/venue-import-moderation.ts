/**
 * #506 B2b — scoped helpers for public-data description + gallery/cover credit gates.
 * Reuses ordinary approveTexts/bindTexts. No new service/broker/scheduler.
 * Private provenance (sources[].note, contact_phone/website, booking_note,
 * source_author/permission_basis/raw) is never forwarded to the provider.
 */

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { TextBatchApproval } from "../moderation/moderation.service";
import type { TextFieldCandidate } from "../moderation/text-policy";
import type { GalleryEvidence } from "./venue-gallery";
import type { PublicDataItem, PublicDataVenueRow } from "./venue-public-data-import";
import type { VenueSnapshot } from "./venue-cover-import";

/** Trusted application copy — never sent through the text provider. */
export const TRUSTED_ILLUSTRATION_CREDIT = "Иллюстрация";

export type VenueImportTextPrep = {
  approval: TextBatchApproval;
  committed: Array<{ surface: "venue_description" | "venue_credit_text"; text: string }>;
};

export function emptyVenueImportTextPrep(): VenueImportTextPrep {
  return {
    approval: Object.freeze({ fields: Object.freeze([]) }) as TextBatchApproval,
    committed: [],
  };
}

/** NEW/CHANGED nonempty public description only — clear/omit/same/empty → no candidate. */
export function publicDataDescriptionCandidate(
  row: Pick<PublicDataVenueRow, "public_description">,
  item: PublicDataItem,
): TextFieldCandidate | undefined {
  if (item.profile === undefined) return undefined;
  if (item.profile === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(item.profile, "description")) return undefined;
  const next = item.profile.description ?? null;
  if (next === null || next.length === 0) return undefined;
  if (next === row.public_description) return undefined;
  return { surface: "venue_description", text: next, fieldId: "profile.description" };
}

export function needsPublicDataTextPrepare(
  row: Pick<PublicDataVenueRow, "public_description">,
  item: PublicDataItem,
): boolean {
  return publicDataDescriptionCandidate(row, item) !== undefined;
}

/** Freeform photo/logo credit requires venue_credit_text; trusted illustration does not. */
export function freeCreditTextCandidate(
  creditText: string,
  creditKind: "photo" | "logo" | "illustration",
): TextFieldCandidate | undefined {
  if (creditKind === "illustration" && creditText === TRUSTED_ILLUSTRATION_CREDIT) {
    return undefined;
  }
  const trimmed = creditText.trim();
  if (trimmed.length === 0) return undefined;
  return { surface: "venue_credit_text", text: creditText, fieldId: "creditText" };
}

export function needsCreditTextPrepare(evidence: Pick<GalleryEvidence, "creditKind" | "creditText">): boolean {
  return freeCreditTextCandidate(evidence.creditText, evidence.creditKind) !== undefined;
}

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

const PUBLIC_DATA_ATTEMPT_NS = "venue_public_data_attempt_v1";
const COVER_ADMISSION_NS = "venue_cover_import_admission_v1";

export type PublicDataAttemptRecord = {
  fingerprint: string;
  digest: string;
  batch: string;
  venueId: string;
};

export function publicDataAttemptFingerprint(item: PublicDataItem): string {
  return createHash("sha256").update(stableStringify({
    venueId: item.venueId,
    expectedVersion: item.expectedVersion,
    expectedName: item.expectedName,
    expectedAddress: item.expectedAddress,
    identity: item.identity,
    publicContacts: item.publicContacts,
    profile: item.profile,
    // Provenance urls/checkedAt only — never note bodies.
    sources: item.sources.map((s) => ({ url: s.url, checkedAt: s.checkedAt })),
  })).digest("hex");
}

export function planPublicDataAttemptReplay(
  fingerprint: string,
  digest: string,
  attempt: PublicDataAttemptRecord,
): { action: "HOLD" | "FAILED"; reason: string } {
  if (attempt.fingerprint !== fingerprint || attempt.digest !== digest) {
    return { action: "FAILED", reason: "PUBLIC_DATA_CONFLICT" };
  }
  return { action: "HOLD", reason: "OPERATION_OUTCOME_UNKNOWN" };
}

export type CoverAdmissionCapture = {
  name: string;
  version: number;
  lifecycle_state: string;
  cover_key: string | null;
  cover_credit_kind: string | null;
};

export type CoverAdmissionRecord = {
  fingerprint: string;
  digest: string;
  batch: string;
  venueId: string;
  sha256: string;
  credit_text: string;
  source_page_url: string | null;
};

/**
 * Immutable cover INPUT only (credit/source/image/kind/basis).
 * Captured mutable venue snapshot is NOT part of admission conflict — it is CAS for first publish.
 * Row version/cover changes must not fake an input conflict on exact replay.
 */
export function coverAdmissionFingerprint(input: {
  venueId: string;
  sha256: string;
  kind: string;
  credit_text: string;
  source_page_url: string | null;
  basis_note: string;
}): string {
  return createHash("sha256").update(stableStringify({
    venueId: input.venueId,
    sha256: input.sha256.toLowerCase(),
    kind: input.kind,
    credit_text: input.credit_text,
    source_page_url: input.source_page_url,
    // basis_note is private provenance — bind into admission but never send to provider.
    basis_note: input.basis_note,
  })).digest("hex");
}

/** Snapshot digest for audit/CAS evidence — independent of input admission fingerprint. */
export function coverSnapshotDigest(captured: CoverAdmissionCapture): string {
  return createHash("sha256").update(stableStringify({ captured })).digest("hex");
}

export function coverAdmissionKeyHash(batch: string, venueId: string): string {
  return createHash("sha256").update(`${COVER_ADMISSION_NS}\n${batch}\n${venueId}`).digest("hex");
}

export function planCoverAttemptReplay(
  fingerprint: string,
  digest: string,
  attempt: CoverAdmissionRecord,
): { action: "HOLD" | "FAILED"; reason: string } {
  if (attempt.fingerprint !== fingerprint || attempt.digest !== digest) {
    return { action: "FAILED", reason: "COVER_IMPORT_CONFLICT" };
  }
  return { action: "HOLD", reason: "OPERATION_OUTCOME_UNKNOWN" };
}

export function planCoverAcceptedReplay(
  fingerprint: string,
  receiptFingerprint: string | undefined,
): { action: "SKIPPED" | "FAILED"; reason: string } | undefined {
  if (receiptFingerprint === undefined) return undefined;
  if (receiptFingerprint !== fingerprint) {
    return { action: "FAILED", reason: "COVER_IMPORT_CONFLICT" };
  }
  return { action: "SKIPPED", reason: "COVER_IMPORT_REPLAY" };
}

export function captureCoverAdmission(row: VenueSnapshot): CoverAdmissionCapture {
  return {
    name: row.name,
    version: row.version,
    lifecycle_state: row.lifecycle_state,
    cover_key: row.cover_key,
    cover_credit_kind: row.cover_credit_kind,
  };
}

/** Cover admission still matches captured venue snapshot under row lock. */
export function coverCaptureMatches(
  live: VenueSnapshot,
  captured: CoverAdmissionCapture,
): boolean {
  return live.name === captured.name
    && live.version === captured.version
    && live.lifecycle_state === captured.lifecycle_state
    && live.cover_key === captured.cover_key
    && live.cover_credit_kind === captured.cover_credit_kind;
}

type TextBinder = {
  bindTexts: (
    client: PoolClient,
    approval: TextBatchApproval,
    committed: ReadonlyArray<{ surface: "venue_description" | "venue_credit_text"; text: string }>,
    meta: {
      entityKind: "venue" | "venue_gallery_item";
      entityId: string;
      resourceVersion: number;
      actorUserId: string;
      actorPrincipalId?: string | null;
      bindingKind: "publication";
    },
  ) => Promise<void>;
};

export async function bindVenueDescriptionPublication(
  client: PoolClient,
  moderation: TextBinder,
  prep: VenueImportTextPrep,
  meta: {
    venueId: string;
    resourceVersion: number;
    actorUserId: string;
    actorPrincipalId: string;
  },
): Promise<void> {
  const committed = prep.committed.filter(
    (c): c is { surface: "venue_description"; text: string } => c.surface === "venue_description",
  );
  if (committed.length === 0 || prep.approval.fields.length === 0) return;
  const fields = prep.approval.fields.filter((f) => f.surface === "venue_description");
  if (fields.length === 0) return;
  await moderation.bindTexts(
    client,
    { fields } as TextBatchApproval,
    committed,
    {
      entityKind: "venue",
      entityId: meta.venueId,
      resourceVersion: meta.resourceVersion,
      actorUserId: meta.actorUserId,
      actorPrincipalId: meta.actorPrincipalId,
      bindingKind: "publication",
    },
  );
}

export async function bindVenueCreditPublication(
  client: PoolClient,
  moderation: TextBinder,
  prep: VenueImportTextPrep,
  meta: {
    galleryItemId: string;
    resourceVersion: number;
    actorUserId: string;
    actorPrincipalId: string | null;
  },
): Promise<void> {
  const committed = prep.committed.filter(
    (c): c is { surface: "venue_credit_text"; text: string } => c.surface === "venue_credit_text",
  );
  if (committed.length === 0 || prep.approval.fields.length === 0) return;
  const fields = prep.approval.fields.filter((f) => f.surface === "venue_credit_text");
  if (fields.length === 0) return;
  await moderation.bindTexts(
    client,
    { fields } as TextBatchApproval,
    committed,
    {
      entityKind: "venue_gallery_item",
      entityId: meta.galleryItemId,
      resourceVersion: meta.resourceVersion,
      actorUserId: meta.actorUserId,
      actorPrincipalId: meta.actorPrincipalId,
      bindingKind: "publication",
    },
  );
}

export function publicDataAttemptNamespace(): string {
  return PUBLIC_DATA_ATTEMPT_NS;
}
