/** One-off DEV operator entry; importing this module has no effects. */
import "reflect-metadata";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { createDatabase } from "./client";
import { ProblemHttpException } from "../auth/problem";
import { loadEnv } from "../config/env";
import { adminTransaction, appendAudit } from "../admin/admin-db";
import { AvatarService } from "../profiles/avatar.service";
import { sanitizeAvatar } from "../profiles/avatar-image";
import { ContentModerationService } from "../moderation/moderation.service";
import { OpenAIModerationProvider } from "../moderation/openai-provider";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { ActorFenceService } from "../common/actor-fence.service";
import { manifestDigest, planCover, validateImage, validateManifest, type CoverManifest, type VenueSnapshot } from "../venues/venue-cover-import";
import {
  appliedPublicFieldsMatch,
  buildAppliedPatch,
  planPublicDataEligibility,
  planPublicDataIdentityCollision,
  planPublicDataIdentityMatch,
  planPublicDataReplay,
  planPublicDataVersion,
  publicDataDigest,
  publicDataKeyHash,
  publicDataPatchFingerprint,
  resolvePublicDataIdentity,
  validatePublicDataManifest,
  type AcceptedPublicDataReceipt,
  type PublicDataItem,
  type PublicDataManifest,
  type PublicDataPlan,
  type PublicDataVenueRow,
  type ResolvedPublicDataIdentity,
} from "../venues/venue-public-data-import";
import {
  buildAcceptedGalleryReceipt,
  galleryAdmissionKeyHash,
  galleryItemFingerprint,
  galleryManifestDigest,
  planGalleryAttemptReplay,
  planGalleryManifestBind,
  planGalleryReplay,
  planGalleryRow,
  validateGalleryManifest,
  validateImage as validateGalleryImage,
  type AcceptedGalleryReceipt,
  type GalleryActiveRow,
  type GalleryAttemptRecord,
  type GalleryImportItem,
  type GalleryImportPlan,
  type GalleryImportReport,
  type GalleryManifest,
  type GalleryVenueRow,
} from "../venues/venue-gallery-import";
import {
  applyOrderedGalleryPositions,
  projectVenueMainCover,
} from "../venues/venue-gallery.service";
import { VENUE_GALLERY_MAX } from "../venues/venue-gallery";
import {
  bindVenueCreditPublication,
  bindVenueDescriptionPublication,
  captureCoverAdmission,
  coverAdmissionFingerprint,
  coverAdmissionKeyHash,
  coverCaptureMatches,
  coverSnapshotDigest,
  emptyVenueImportTextPrep,
  freeCreditTextCandidate,
  needsCreditTextPrepare,
  needsPublicDataTextPrepare,
  planCoverAcceptedReplay,
  planCoverAttemptReplay,
  planPublicDataAttemptReplay,
  publicDataDescriptionCandidate,
  type CoverAdmissionCapture,
  type CoverAdmissionRecord,
  type PublicDataAttemptRecord,
  type VenueImportTextPrep,
} from "../venues/venue-import-moderation";
import {
  buildAcceptedGalleryMaintenanceReceipt,
  galleryMaintenanceAdmissionKeyHash,
  galleryMaintenanceItemFingerprint,
  galleryMaintenanceManifestDigest,
  planGalleryMaintenanceManifestBind,
  planGalleryMaintenanceReplay,
  planGalleryMaintenanceRow,
  validateGalleryMaintenanceManifest,
  type AcceptedGalleryMaintenanceReceipt,
  type GalleryMaintenanceActiveRow,
  type GalleryMaintenanceItem,
  type GalleryMaintenanceManifest,
  type GalleryMaintenanceReport,
  type GalleryMaintenanceVenueRow,
} from "../venues/venue-gallery-maintenance";
export function guardImportEnv(env: NodeJS.ProcessEnv): void {
  if (!["mvp","stage"].includes(env.APP_ENV ?? "") || env.PUBLIC_WEB_ORIGIN !== "https://dev.gobadminton.ru" ||
    !env.AVATAR_MEDIA_ROOT || env.CONTENT_MODERATION_PROVIDER !== "openai") throw new Error("IMPORT_ENV_REFUSED");
}
export async function readBatchFile(dir: string, file: string, limit: number): Promise<Buffer> {
  if (!path.isAbsolute(dir) || path.basename(file) !== file || file === "." || file === "..") throw new Error("INVALID_BATCH_PATH");
  // Canonical directory plus O_NOFOLLOW prevents file symlink substitution; bounded read prevents growth races.
  const root = await realpath(dir);
  const handle = await open(path.join(root,file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("INVALID_BATCH_FILE");
    const bytes = Buffer.alloc(limit+1);
    let length=0;
    while (length < bytes.length) {
      const result=await handle.read(bytes,length,bytes.length-length,length);
      if (result.bytesRead === 0) break;
      length+=result.bytesRead;
    }
    if (length > limit) throw new Error("INVALID_BATCH_FILE");
    return bytes.subarray(0,length);
  } finally { await handle.close(); }
}
export async function loadBatch(dir:string, file:string) {
  const manifest = validateManifest(JSON.parse((await readBatchFile(dir,file,256*1024)).toString("utf8")));
  const images = new Map<string,Buffer>();
  for (const item of manifest.items) {
    const bytes = await readBatchFile(dir,item.file,2*1024*1024);
    validateImage(bytes,item.sha256); images.set(item.venueId,bytes);
  }
  return {manifest,images};
}
export async function requireImportActor(
  c: Pick<PoolClient,"query">,
  principalId: string,
  lock = true,
): Promise<string> {
  const locking = lock ? " FOR UPDATE OF p,u,g" : "";
  const row = (await c.query<{user_id:string}>(`SELECT p.user_id FROM admin_principals p JOIN users u ON u.id=p.user_id
    JOIN admin_role_grants g ON g.principal_id=p.id AND g.role='superadmin' AND g.active=true
    WHERE p.id=$1 AND p.status='active' AND u.status='active'${locking}`,[principalId])).rows[0];
  if (!row) throw new Error("IMPORT_ACTOR_REFUSED");
  return row.user_id;
}

const publicDataSelect = `SELECT name,address,lifecycle_state,version,canonical_venue_id,city_id,identity_discriminator,public_contacts,court_count,amenity_parking,amenity_showers,public_description
  FROM venues WHERE id=$1`;

async function loadAcceptedPublicDataReceipt(
  c: Pick<PoolClient,"query">,
  keyHash: string,
): Promise<AcceptedPublicDataReceipt | undefined> {
  const row = (await c.query<{ after_diff: Record<string, unknown> }>(
    `SELECT after_diff FROM privileged_audit_events
     WHERE idempotency_hash=$1 AND action_key='venue.edit' AND reason_code='venue_public_data_batch_import'
     ORDER BY created_at DESC LIMIT 1`,
    [keyHash],
  )).rows[0];
  const after = row?.after_diff;
  if (!after || typeof after.fingerprint !== "string" || !Array.isArray(after.sources)) return undefined;
  const receipt: AcceptedPublicDataReceipt = {
    fingerprint: after.fingerprint,
    sources: after.sources as AcceptedPublicDataReceipt["sources"],
  };
  if ("identity" in after) {
    receipt.identity = after.identity as AcceptedPublicDataReceipt["identity"];
  }
  if ("publicContacts" in after) {
    receipt.publicContacts = after.publicContacts as AcceptedPublicDataReceipt["publicContacts"];
  }
  if ("profile" in after) {
    receipt.profile = after.profile as AcceptedPublicDataReceipt["profile"];
  }
  return receipt;
}

async function loadIdentityKeyClaimant(
  c: Pick<PoolClient, "query">,
  dedupeKey: string,
): Promise<string | undefined> {
  return (await c.query<{ venue_id: string }>(
    "SELECT venue_id FROM venue_identity_keys WHERE dedupe_key=$1",
    [dedupeKey],
  )).rows[0]?.venue_id;
}

/**
 * Legacy items (no identity): expectedName/address before receipt — external identity
 * drift must FAIL as VENUE_IDENTITY_MISMATCH, not false PUBLIC_DATA_REPLAY.
 * Identity-patch items: receipt first so own rename/address replay can SKIP.
 */
async function planPublicDataItemState(
  c: Pick<PoolClient, "query">,
  batch: string,
  item: PublicDataItem,
  row: PublicDataVenueRow | undefined,
): Promise<{ name: string; result: PublicDataPlan; nextIdentity?: ResolvedPublicDataIdentity }> {
  const name = row?.name ?? "";
  const eligibility = planPublicDataEligibility(row);
  if (eligibility.action !== "READY" || !row) return { name, result: eligibility };

  const keyHash = publicDataKeyHash(batch, item.venueId);
  const fingerprint = publicDataPatchFingerprint(item);
  const legacyPublicOnly = item.identity === undefined;
  if (legacyPublicOnly) {
    const identityMatch = planPublicDataIdentityMatch(row, item);
    if (identityMatch.action !== "READY") return { name, result: identityMatch };
  }

  const receipt = await loadAcceptedPublicDataReceipt(c, keyHash);
  if (receipt) {
    return { name, result: planPublicDataReplay(row, fingerprint, receipt) };
  }

  if (!legacyPublicOnly) {
    const identityMatch = planPublicDataIdentityMatch(row, item);
    if (identityMatch.action !== "READY") return { name, result: identityMatch };
  }

  const versionPlan = planPublicDataVersion(row, item);
  if (versionPlan.action !== "READY") return { name, result: versionPlan };

  if (legacyPublicOnly) return { name, result: { action: "READY", reason: "PUBLIC_DATA_READY" } };

  const nextIdentity = resolvePublicDataIdentity(row, item.identity!);
  const claimant = await loadIdentityKeyClaimant(c, nextIdentity.dedupeKey);
  const collision = planPublicDataIdentityCollision(claimant, item.venueId);
  if (collision.action !== "READY") return { name, result: collision };
  return { name, result: { action: "READY", reason: "PUBLIC_DATA_READY" }, nextIdentity };
}

type Services = {
  media: Pick<AvatarService, "stage" | "verifyStage" | "releaseStage">;
  moderation: Pick<ContentModerationService, "approveImage" | "bindImage" | "approveTexts" | "bindTexts">;
};

async function loadCoverAttempt(
  c: Pick<PoolClient, "query">,
  keyHash: string,
): Promise<CoverAdmissionRecord | undefined> {
  const row = (await c.query<{ after_diff: Record<string, unknown> }>(
    `SELECT after_diff FROM privileged_audit_events
     WHERE idempotency_hash=$1 AND action_key='venue.cover_changed'
       AND reason_code='venue_cover_batch_attempt'
     ORDER BY created_at DESC LIMIT 1`,
    [keyHash],
  )).rows[0];
  const after = row?.after_diff;
  if (!after || typeof after.fingerprint !== "string" || typeof after.digest !== "string"
    || typeof after.batch !== "string" || typeof after.venueId !== "string"
    || typeof after.sha256 !== "string" || typeof after.credit_text !== "string") {
    return undefined;
  }
  return {
    fingerprint: after.fingerprint,
    digest: after.digest,
    batch: after.batch,
    venueId: after.venueId,
    sha256: after.sha256,
    credit_text: after.credit_text,
    source_page_url: typeof after.source_page_url === "string" || after.source_page_url === null
      ? (after.source_page_url as string | null)
      : null,
  };
}

async function loadAcceptedCoverFingerprint(
  c: Pick<PoolClient, "query">,
  keyHash: string,
): Promise<string | undefined> {
  const row = (await c.query<{ after_diff: Record<string, unknown> }>(
    `SELECT after_diff FROM privileged_audit_events
     WHERE idempotency_hash=$1 AND action_key='venue.cover_changed'
       AND reason_code='venue_cover_batch_import'
     ORDER BY created_at DESC LIMIT 1`,
    [keyHash],
  )).rows[0];
  const fp = row?.after_diff?.fingerprint;
  return typeof fp === "string" ? fp : undefined;
}

/**
 * Short committed txn under claim: bind immutable input fingerprint before provider I/O.
 * Captured venue snapshot is stored for first-publish CAS only (separate snapshot digest).
 * Legacy image-hash digests stay compatible; admission is additive.
 */
async function commitCoverAttemptOrReplay(
  pool: Pool,
  principalId: string,
  userId: string,
  batch: string,
  item: CoverManifest["items"][number],
  captured: CoverAdmissionCapture,
  fingerprint: string,
  keyHash: string,
  currentDigest: string,
): Promise<{ action: "READY" | "SKIPPED" | "FAILED" | "HOLD"; reason: string }> {
  return adminTransaction(pool, async (c) => {
    if (await requireImportActor(c, principalId) !== userId) {
      throw new Error("IMPORT_ACTOR_REFUSED");
    }
    const acceptedFp = await loadAcceptedCoverFingerprint(c, keyHash);
    const accepted = planCoverAcceptedReplay(fingerprint, acceptedFp);
    if (accepted) return accepted;
    const prior = await loadCoverAttempt(c, keyHash);
    if (prior) return planCoverAttemptReplay(fingerprint, currentDigest, prior);
    await appendAudit(c, {
      actor: { principalId, roles: ["superadmin"] },
      action: "venue.cover_changed",
      targetType: "venue",
      targetId: item.venueId,
      permission: "venue.manage",
      reason: "venue_cover_batch_attempt",
      keyHash,
      after: {
        batch,
        venueId: item.venueId,
        fingerprint,
        digest: currentDigest,
        snapshot_digest: coverSnapshotDigest(captured),
        sha256: item.sha256.toLowerCase(),
        kind: item.kind,
        credit_text: item.credit_text,
        source_page_url: item.source_page_url,
        captured,
      },
    });
    return { action: "READY", reason: "ATTEMPT_RECORDED" };
  });
}

function coverFail(error: unknown): { action: "FAILED" | "HOLD"; reason: string } {
  const body = error instanceof ProblemHttpException ? error.getResponse() : undefined;
  const code = typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
  if (typeof code === "string" && /^[A-Z_]{1,80}$/.test(code)) {
    if (code === "MODERATION_TEMPORARILY_UNAVAILABLE" || code === "MODERATION_POLICY_MISMATCH"
      || code === "MODERATION_RATE_LIMITED" || code === "AVATAR_BUSY") {
      return { action: "HOLD", reason: code };
    }
    return { action: "FAILED", reason: code };
  }
  return { action: "FAILED", reason: "IMPORT_ROW_FAILED" };
}

export async function importVenueCovers(pool:Pool, batch:{manifest:CoverManifest;images:Map<string,Buffer>}, principalId:string,
  apply:boolean, services:Services, emit:(line:object)=>void) {
  const userId = await requireImportActor(pool,principalId,apply);
  const totals = {APPLIED:0,SKIPPED:0,FAILED:0,READY:0,HOLD:0};
  const currentDigest = manifestDigest(batch.manifest);
  for (const item of batch.manifest.items) {
    let key:string|undefined;
    let name = "";
    let result:{action:keyof typeof totals;reason:string};
    try {
      const row = (await pool.query<VenueSnapshot>("SELECT name,lifecycle_state,cover_key,cover_credit_kind,version FROM venues WHERE id=$1",[item.venueId])).rows[0];
      name = row?.name ?? "";
      result = planCover(row);
      // Apply: admission (accepted/attempt) before EXISTING_COVER shortcircuit; fresh actor first.
      if (apply && row) {
        if (await requireImportActor(pool, principalId, false) !== userId) {
          throw new Error("IMPORT_ACTOR_REFUSED");
        }
        const keyHash = coverAdmissionKeyHash(batch.manifest.batch, item.venueId);
        const fingerprint = coverAdmissionFingerprint({
          venueId: item.venueId,
          sha256: item.sha256,
          kind: item.kind,
          credit_text: item.credit_text,
          source_page_url: item.source_page_url,
          basis_note: item.basis_note,
        });
        const acceptedFp = await loadAcceptedCoverFingerprint(pool, keyHash);
        const accepted = planCoverAcceptedReplay(fingerprint, acceptedFp);
        if (accepted) {
          // Exact accepted replay SKIP; changed input CONFLICT — never restore deleted cover.
          result = accepted;
        } else {
          const priorAttempt = await loadCoverAttempt(pool, keyHash);
          if (priorAttempt) {
            result = planCoverAttemptReplay(fingerprint, currentDigest, priorAttempt);
          } else if (result.action === "READY") {
            const captured = captureCoverAdmission(row);
            const attemptGate = await commitCoverAttemptOrReplay(
              pool, principalId, userId, batch.manifest.batch, item, captured,
              fingerprint, keyHash, currentDigest,
            );
            if (attemptGate.action !== "READY") {
              result = attemptGate;
            } else {
              const bytes = batch.images.get(item.venueId);
              if (!bytes) throw new Error("INVALID_IMAGE");
              validateImage(bytes, item.sha256);
              let textPrep: VenueImportTextPrep = emptyVenueImportTextPrep();
              const creditCandidate = freeCreditTextCandidate(item.credit_text, item.kind);
              if (creditCandidate) {
                const approval = await services.moderation.approveTexts(userId, [creditCandidate]);
                textPrep = {
                  approval,
                  committed: [{ surface: "venue_credit_text", text: item.credit_text }],
                };
              }
              const sanitized = await sanitizeAvatar(bytes,"image/jpeg","cover");
              key = `${randomBytes(32).toString("hex")}.png`;
              const staged = await services.media.stage(key,sanitized);
              const approval = await services.moderation.approveImage(userId,sanitized,"cover");
              const storageKey = key;
              result = await adminTransaction(pool,async c => {
                if (await requireImportActor(c,principalId) !== userId) throw new Error("IMPORT_ACTOR_REFUSED");
                const liveAccepted = await loadAcceptedCoverFingerprint(c, keyHash);
                const liveReplay = planCoverAcceptedReplay(fingerprint, liveAccepted);
                if (liveReplay) return liveReplay;
                const current = (await c.query<VenueSnapshot>("SELECT name,lifecycle_state,cover_key,cover_credit_kind,version FROM venues WHERE id=$1 FOR UPDATE",[item.venueId])).rows[0];
                if (!current || !coverCaptureMatches(current, captured)) {
                  return { action: "FAILED" as const, reason: "COVER_IMPORT_CONFLICT" };
                }
                const plan = planCover(current);
                if (plan.action !== "READY") return plan;
                const verified = await services.media.verifyStage(c,storageKey,staged);
                const approvalId = await services.moderation.bindImage(c,approval,verified,"cover");
                const updated = (await c.query<{version:number}>(`UPDATE venues SET cover_key=$2,cover_moderation_approval_id=$3,cover_actor_id=$4,
                  cover_credit_kind=$5,cover_credit_text=$6,cover_credit_url=$7,version=version+1,updated_at=now() WHERE id=$1 AND version=$8 RETURNING version`,
                  [item.venueId,storageKey,approvalId,userId,item.kind,item.credit_text,item.source_page_url,captured.version])).rows[0];
                if (!updated) return { action: "FAILED" as const, reason: "VENUE_VERSION_CONFLICT" };
                await c.query("DELETE FROM avatar_media_gc WHERE storage_key=$1",[storageKey]);
                // Keep gallery main atomic with legacy cover columns after batch import.
                const main = (await c.query<{id:string}>(
                  `SELECT id FROM venue_gallery_items WHERE venue_id=$1 AND active AND is_main FOR UPDATE`,
                  [item.venueId],
                )).rows[0];
                let galleryItemId: string;
                if (main) {
                  await c.query(
                    `UPDATE venue_gallery_items SET storage_key=$2, moderation_approval_id=$3, actor_id=$4,
                       credit_kind=$5, credit_text=$6, credit_url=$7, source_url=$8, permission_basis=$9,
                       source_fingerprint=$10, updated_at=now() WHERE id=$1`,
                    [main.id, storageKey, approvalId, userId, item.kind, item.credit_text, item.source_page_url,
                      item.kind === "photo" ? item.source_page_url : null, item.basis_note, item.sha256.toLowerCase()],
                  );
                  galleryItemId = main.id;
                } else {
                  const inserted = (await c.query<{id:string}>(
                    `INSERT INTO venue_gallery_items(
                       venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
                       credit_kind, credit_text, credit_url, source_url, permission_basis, source_fingerprint
                     ) VALUES ($1,0,true,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
                    [item.venueId, storageKey, approvalId, userId, item.kind, item.credit_text, item.source_page_url,
                      item.kind === "photo" ? item.source_page_url : null, item.basis_note, item.sha256.toLowerCase()],
                  )).rows[0];
                  if (!inserted) throw new Error("GALLERY_INSERT_FAILED");
                  galleryItemId = inserted.id;
                }
                await bindVenueCreditPublication(c, services.moderation, textPrep, {
                  galleryItemId,
                  resourceVersion: updated.version,
                  actorUserId: userId,
                  actorPrincipalId: principalId,
                });
                // Additive input fingerprint on accepted receipt; old image-hash digests remain compatible.
                const audit = await appendAudit(c,{actor:{principalId,roles:["superadmin"]},action:"venue.cover_changed",targetType:"venue",targetId:item.venueId,
                  permission:"venue.manage",reason:"venue_cover_batch_import",keyHash,after:{
                    batch:batch.manifest.batch,kind:item.kind,sha256:item.sha256.toLowerCase(),basis_note:item.basis_note,
                    fingerprint, snapshot_digest: coverSnapshotDigest(captured),
                    credit_text: item.credit_text, source_page_url: item.source_page_url,
                    galleryItemId, version: updated.version,
                  }});
                await c.query("INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'cover',$3,$4)",[item.venueId,updated.version,principalId,audit]);
                return {action:"APPLIED" as const,reason:"IMPORTED"};
              });
            }
          }
          // else keep planCover EXISTING_COVER / VENUE_INELIGIBLE when no prior admission
        }
      }
    } catch (error:unknown) {
      result = coverFail(error);
    }
    finally { if (key) await services.media.releaseStage(key); }
    totals[result.action]++;
    emit({venueId:item.venueId,name,kind:item.kind,...result});
  }
  emit({totals,digest:currentDigest});
  return totals.FAILED === 0 && totals.HOLD === 0 ? 0 : 1;
}

const galleryVenueSelect = `SELECT name,address,lifecycle_state,version,canonical_venue_id FROM venues WHERE id=$1`;

async function loadAcceptedGalleryReceipt(
  c: Pick<PoolClient, "query">,
  keyHash: string,
): Promise<AcceptedGalleryReceipt | undefined> {
  const row = (await c.query<{ after_diff: Record<string, unknown> }>(
    `SELECT after_diff FROM privileged_audit_events
     WHERE idempotency_hash=$1 AND action_key='venue.gallery_add' AND reason_code='venue_gallery_batch_import'
     ORDER BY created_at DESC LIMIT 1`,
    [keyHash],
  )).rows[0];
  const after = row?.after_diff;
  if (!after || typeof after.fingerprint !== "string" || typeof after.batch !== "string"
    || typeof after.file !== "string" || typeof after.sha256 !== "string"
    || typeof after.itemIndex !== "number" || typeof after.evidence !== "object" || after.evidence === null) {
    return undefined;
  }
  return {
    fingerprint: after.fingerprint,
    batch: after.batch,
    file: after.file,
    sha256: after.sha256,
    itemIndex: after.itemIndex,
    evidence: after.evidence as AcceptedGalleryReceipt["evidence"],
  };
}

async function loadGalleryAttempt(
  c: Pick<PoolClient, "query">,
  keyHash: string,
): Promise<GalleryAttemptRecord | undefined> {
  const row = (await c.query<{ after_diff: Record<string, unknown> }>(
    `SELECT after_diff FROM privileged_audit_events
     WHERE idempotency_hash=$1 AND action_key='venue.gallery_add' AND reason_code='venue_gallery_batch_attempt'
     ORDER BY created_at DESC LIMIT 1`,
    [keyHash],
  )).rows[0];
  const after = row?.after_diff;
  if (!after || typeof after.fingerprint !== "string" || typeof after.digest !== "string"
    || typeof after.batch !== "string" || typeof after.file !== "string"
    || typeof after.sha256 !== "string" || typeof after.itemIndex !== "number") {
    return undefined;
  }
  return {
    fingerprint: after.fingerprint,
    digest: after.digest,
    batch: after.batch,
    file: after.file,
    sha256: after.sha256,
    itemIndex: after.itemIndex,
  };
}

/** Retained full-manifest digests: accepted publications and pre-provider attempts. */
async function loadGalleryBatchDigests(
  c: Pick<PoolClient, "query">,
  batch: string,
): Promise<string[]> {
  const rows = (await c.query<{ digest: string | null }>(
    `SELECT after_diff->>'digest' AS digest FROM privileged_audit_events
     WHERE action_key='venue.gallery_add'
       AND reason_code IN ('venue_gallery_batch_import', 'venue_gallery_batch_attempt')
       AND after_diff->>'batch'=$1`,
    [batch],
  )).rows;
  return rows
    .map((row) => row.digest)
    .filter((digest): digest is string => typeof digest === "string" && digest.length > 0);
}

/**
 * Short committed txn under claim: bind full manifest + item identity before provider I/O.
 * Retained attempt without accepted receipt → HOLD; this call's fresh append proceeds.
 */
async function commitGalleryAttemptOrReplay(
  pool: Pool,
  principalId: string,
  userId: string,
  manifest: GalleryManifest,
  item: GalleryImportItem,
  itemIndex: number,
  fingerprint: string,
  keyHash: string,
  currentDigest: string,
): Promise<GalleryImportPlan> {
  return adminTransaction(pool, async (c) => {
    if (await requireImportActor(c, principalId) !== userId) {
      throw new Error("IMPORT_ACTOR_REFUSED");
    }
    const liveDigests = await loadGalleryBatchDigests(c, manifest.batch);
    const liveBind = planGalleryManifestBind(currentDigest, liveDigests);
    if (liveBind) return liveBind;
    const terminal = await loadAcceptedGalleryReceipt(c, keyHash);
    if (terminal) return planGalleryReplay(fingerprint, terminal);
    const prior = await loadGalleryAttempt(c, keyHash);
    if (prior) return planGalleryAttemptReplay(fingerprint, currentDigest, prior);
    await appendAudit(c, {
      actor: { principalId, roles: ["superadmin"] },
      action: "venue.gallery_add",
      targetType: "venue",
      targetId: item.venueId,
      permission: "venue.manage",
      reason: "venue_gallery_batch_attempt",
      keyHash,
      after: {
        batch: manifest.batch,
        file: item.file,
        fingerprint,
        itemIndex,
        sha256: item.sha256.toLowerCase(),
        digest: currentDigest,
        expectedVersion: item.expectedVersion,
        source: item.evidence.sourceUrl ?? null,
      },
    });
    return { action: "READY", reason: "ATTEMPT_RECORDED" };
  });
}

async function loadGalleryActive(
  c: Pick<PoolClient, "query">,
  venueId: string,
  forUpdate = false,
): Promise<GalleryActiveRow[]> {
  const locking = forUpdate ? " FOR UPDATE" : "";
  return (await c.query<GalleryActiveRow>(
    `SELECT position, is_main, source_fingerprint FROM venue_gallery_items
     WHERE venue_id=$1 AND active ORDER BY position${locking}`,
    [venueId],
  )).rows;
}

export async function loadGalleryBatch(dir: string, file: string) {
  const manifest = validateGalleryManifest(JSON.parse((await readBatchFile(dir, file, 256 * 1024)).toString("utf8")));
  const images = new Map<string, Buffer>();
  for (const item of manifest.items) {
    const bytes = await readBatchFile(dir, item.file, 2 * 1024 * 1024);
    validateGalleryImage(bytes, item.sha256);
    images.set(item.file, bytes);
  }
  return { manifest, images };
}

function problemCode(error: unknown): string | undefined {
  const body = error instanceof ProblemHttpException ? error.getResponse() : undefined;
  const code = typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
  return typeof code === "string" && /^[A-Z_]{1,80}$/.test(code) ? code : undefined;
}

function galleryFail(error: unknown): GalleryImportPlan {
  const code = problemCode(error);
  if (code === "MODERATION_TEMPORARILY_UNAVAILABLE" || code === "MODERATION_POLICY_MISMATCH"
    || code === "MODERATION_RATE_LIMITED" || code === "AVATAR_BUSY") {
    return { action: "HOLD", reason: code };
  }
  return { action: "FAILED", reason: code ?? "IMPORT_ROW_FAILED" };
}

type GalleryServices = {
  media: Pick<AvatarService, "stage" | "verifyStage" | "releaseStage">;
  moderation: Pick<ContentModerationService, "approveImage" | "bindImage" | "approveTexts" | "bindTexts">;
};

type GalleryTotals = { APPLIED: number; SKIPPED: number; FAILED: number; READY: number; HOLD: number };

function emitGalleryLine(
  emit: (line: object) => void,
  item: GalleryImportItem,
  itemIndex: number,
  name: string,
  result: GalleryImportReport,
  extra: Record<string, unknown> = {},
) {
  emit({
    venueId: item.venueId,
    name,
    file: item.file,
    itemIndex,
    sha256: item.sha256.toLowerCase(),
    source: item.evidence.sourceUrl ?? null,
    usage: "UNKNOWN",
    action: result.action,
    reason: result.reason,
    ...extra,
  });
}

async function planGalleryItemState(
  c: Pick<PoolClient, "query">,
  manifest: GalleryManifest,
  item: GalleryImportItem,
  itemIndex: number,
  currentDigest: string,
  simulated: Map<string, { appends: number; versionBump: number }>,
): Promise<{ name: string; result: GalleryImportPlan; fingerprint: string; keyHash: string }> {
  const fingerprint = galleryItemFingerprint(item);
  const keyHash = galleryAdmissionKeyHash(manifest.batch, itemIndex);
  const sim = simulated.get(item.venueId) ?? { appends: 0, versionBump: 0 };
  const row = (await c.query<GalleryVenueRow>(galleryVenueSelect, [item.venueId])).rows[0];
  const name = row?.name ?? "";
  const receipt = await loadAcceptedGalleryReceipt(c, keyHash);
  if (receipt) {
    return { name, result: planGalleryReplay(fingerprint, receipt), fingerprint, keyHash };
  }
  const attempt = await loadGalleryAttempt(c, keyHash);
  if (attempt) {
    return {
      name,
      result: planGalleryAttemptReplay(fingerprint, currentDigest, attempt),
      fingerprint,
      keyHash,
    };
  }
  const active = await loadGalleryActive(c, item.venueId);
  // Dry-run: prior READY rows for this venue simulate version bumps and capacity use.
  const adjustedRow = row
    ? { ...row, version: row.version + sim.versionBump }
    : row;
  const result = planGalleryRow(adjustedRow, item, active, { simulatedAppends: sim.appends });
  return { name, result, fingerprint, keyHash };
}

export async function importVenueGallery(
  pool: Pool,
  batch: { manifest: GalleryManifest; images: Map<string, Buffer> },
  principalId: string,
  apply: boolean,
  services: GalleryServices,
  emit: (line: object) => void,
): Promise<number> {
  const totals: GalleryTotals = { APPLIED: 0, SKIPPED: 0, FAILED: 0, READY: 0, HOLD: 0 };
  const blockedVenues = new Set<string>();
  const simulated = new Map<string, { appends: number; versionBump: number }>();
  const currentDigest = galleryManifestDigest(batch.manifest);
  const batchLease = `venue_gallery_batch_v1:${batch.manifest.batch}`;
  let batchBlocked = false;

  if (!apply) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await requireImportActor(client, principalId, false);
      const retained = await loadGalleryBatchDigests(client, batch.manifest.batch);
      const manifestBind = planGalleryManifestBind(currentDigest, retained);
      if (manifestBind) batchBlocked = true;
      for (let itemIndex = 0; itemIndex < batch.manifest.items.length; itemIndex++) {
        const item = batch.manifest.items[itemIndex]!;
        let name = "";
        let result: GalleryImportReport;
        try {
          if (batchBlocked && manifestBind) {
            result = itemIndex === 0 ? manifestBind : { action: "FAILED", reason: "DEPENDENT_ITEM_FAILED" };
          } else if (blockedVenues.has(item.venueId)) {
            result = { action: "FAILED", reason: "DEPENDENT_ITEM_FAILED" };
          } else {
            const planned = await planGalleryItemState(
              client, batch.manifest, item, itemIndex, currentDigest, simulated,
            );
            name = planned.name;
            result = planned.result;
            if (result.action === "READY") {
              const sim = simulated.get(item.venueId) ?? { appends: 0, versionBump: 0 };
              simulated.set(item.venueId, { appends: sim.appends + 1, versionBump: sim.versionBump + 1 });
            } else if (result.action === "FAILED" || result.action === "HOLD") {
              blockedVenues.add(item.venueId);
            }
          }
        } catch (error: unknown) {
          result = galleryFail(error);
          blockedVenues.add(item.venueId);
        }
        totals[result.action]++;
        emitGalleryLine(emit, item, itemIndex, name, result);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    emit({ totals, digest: currentDigest });
    return totals.FAILED === 0 && totals.HOLD === 0 ? 0 : 1;
  }

  const userId = await requireImportActor(pool, principalId, true);
  let lockClient: PoolClient | undefined;
  try {
    lockClient = await pool.connect();
    const claimed = (await lockClient.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok",
      [batchLease],
    )).rows[0];
    if (!claimed?.ok) {
      for (let itemIndex = 0; itemIndex < batch.manifest.items.length; itemIndex++) {
        const item = batch.manifest.items[itemIndex]!;
        const result: GalleryImportReport = { action: "HOLD", reason: "OPERATION_IN_PROGRESS" };
        totals.HOLD++;
        emitGalleryLine(emit, item, itemIndex, "", result);
      }
      emit({ totals, digest: currentDigest });
      return 1;
    }

    // Digest gate while batch claim held — before any paid provider call.
    const retained = await loadGalleryBatchDigests(pool, batch.manifest.batch);
    const manifestBind = planGalleryManifestBind(currentDigest, retained);
    if (manifestBind) batchBlocked = true;

    for (let itemIndex = 0; itemIndex < batch.manifest.items.length; itemIndex++) {
      const item = batch.manifest.items[itemIndex]!;
      let key: string | undefined;
      let name = "";
      let result: GalleryImportReport;
      let itemId: string | undefined;
      const fingerprint = galleryItemFingerprint(item);
      const keyHash = galleryAdmissionKeyHash(batch.manifest.batch, itemIndex);
      try {
        if (batchBlocked && manifestBind) {
          result = itemIndex === 0 ? manifestBind : { action: "FAILED", reason: "DEPENDENT_ITEM_FAILED" };
        } else if (blockedVenues.has(item.venueId)) {
          result = { action: "FAILED", reason: "DEPENDENT_ITEM_FAILED" };
        } else {
          // Pre-paid gates on unlocked snapshot queries (no catalog/user row locks across provider I/O).
          if (await requireImportActor(pool, principalId, false) !== userId) {
            throw new Error("IMPORT_ACTOR_REFUSED");
          }
          const receipt = await loadAcceptedGalleryReceipt(pool, keyHash);
          if (receipt) {
            result = planGalleryReplay(fingerprint, receipt);
          } else {
            const priorAttempt = await loadGalleryAttempt(pool, keyHash);
            if (priorAttempt) {
              result = planGalleryAttemptReplay(fingerprint, currentDigest, priorAttempt);
            } else {
              const preview = (await pool.query<GalleryVenueRow>(galleryVenueSelect, [item.venueId])).rows[0];
              name = preview?.name ?? "";
              const active = await loadGalleryActive(pool, item.venueId);
              result = planGalleryRow(preview, item, active);
              if (result.action === "READY") {
                const bytes = batch.images.get(item.file);
                if (!bytes) throw new Error("INVALID_IMAGE");
                validateGalleryImage(bytes, item.sha256);
                // Durable attempt before stage/provider; retained across publication rollback.
                const attemptGate = await commitGalleryAttemptOrReplay(
                  pool, principalId, userId, batch.manifest, item, itemIndex,
                  fingerprint, keyHash, currentDigest,
                );
                if (attemptGate.action !== "READY") {
                  result = attemptGate;
                } else {
                  // Same durable attempt admits both free credit text and image provider I/O.
                  let textPrep: VenueImportTextPrep = emptyVenueImportTextPrep();
                  if (needsCreditTextPrepare(item.evidence)) {
                    const candidate = freeCreditTextCandidate(
                      item.evidence.creditText,
                      item.evidence.creditKind,
                    );
                    if (candidate) {
                      const textApproval = await services.moderation.approveTexts(userId, [candidate]);
                      textPrep = {
                        approval: textApproval,
                        committed: [{ surface: "venue_credit_text", text: item.evidence.creditText }],
                      };
                    }
                  }
                  const sanitized = await sanitizeAvatar(bytes, "image/jpeg", "cover");
                  key = `${randomBytes(32).toString("hex")}.png`;
                  const staged = await services.media.stage(key, sanitized);
                  const approval = await services.moderation.approveImage(userId, sanitized, "cover");
                  const storageKey = key;
                  const applied = await adminTransaction(pool, async (c) => {
                    if (await requireImportActor(c, principalId) !== userId) {
                      throw new Error("IMPORT_ACTOR_REFUSED");
                    }
                    await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
                    const liveDigests = await loadGalleryBatchDigests(c, batch.manifest.batch);
                    const liveBind = planGalleryManifestBind(currentDigest, liveDigests);
                    if (liveBind) return liveBind;
                    const terminal = await loadAcceptedGalleryReceipt(c, keyHash);
                    if (terminal) return { ...planGalleryReplay(fingerprint, terminal) };

                    const current = (await c.query<GalleryVenueRow>(
                      `${galleryVenueSelect} FOR UPDATE`,
                      [item.venueId],
                    )).rows[0];
                    name = current?.name ?? name;
                    const lockedActive = await loadGalleryActive(c, item.venueId, true);
                    const gate = planGalleryRow(current, item, lockedActive);
                    if (gate.action !== "READY" || !current) return gate;

                    // Row lock held: version is stable; CAS still required so a mismatch rolls back.
                    if (current.version !== item.expectedVersion) {
                      return { action: "FAILED" as const, reason: "VENUE_VERSION_CONFLICT" };
                    }
                    const verified = await services.media.verifyStage(c, storageKey, staged);
                    const approvalId = await services.moderation.bindImage(c, approval, verified, "cover");
                    const position = lockedActive.length;
                    if (position >= VENUE_GALLERY_MAX) {
                      return { action: "FAILED" as const, reason: "VENUE_GALLERY_FULL" };
                    }
                    const isMain = lockedActive.length === 0;
                    const inserted = (await c.query<{ id: string }>(
                      `INSERT INTO venue_gallery_items(
                         venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
                         credit_kind, credit_text, credit_url, source_url, source_author, permission_basis, source_fingerprint
                       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
                      [
                        item.venueId, position, isMain, storageKey, approvalId, userId,
                        item.evidence.creditKind, item.evidence.creditText, item.evidence.creditUrl,
                        item.evidence.sourceUrl ?? null, item.evidence.sourceAuthor ?? null,
                        item.evidence.permissionBasis, item.sha256.toLowerCase(),
                      ],
                    )).rows[0];
                    if (!inserted) throw new Error("GALLERY_INSERT_FAILED");
                    await c.query("DELETE FROM avatar_media_gc WHERE storage_key=$1", [storageKey]);
                    await projectVenueMainCover(c, item.venueId);
                    const updated = (await c.query<{ version: number }>(
                      `UPDATE venues SET version=version+1, updated_at=now()
                       WHERE id=$1 AND version=$2 RETURNING version`,
                      [item.venueId, item.expectedVersion],
                    )).rows[0];
                    if (!updated) throw new Error("VENUE_VERSION_CONFLICT");
                    await bindVenueCreditPublication(c, services.moderation, textPrep, {
                      galleryItemId: inserted.id,
                      resourceVersion: updated.version,
                      actorUserId: userId,
                      actorPrincipalId: principalId,
                    });

                    const receiptBody = buildAcceptedGalleryReceipt(batch.manifest, item, itemIndex);
                    const audit = await appendAudit(c, {
                      actor: { principalId, roles: ["superadmin"] },
                      action: "venue.gallery_add",
                      targetType: "venue",
                      targetId: item.venueId,
                      permission: "venue.manage",
                      reason: "venue_gallery_batch_import",
                      keyHash,
                      before: { version: current.version },
                      after: {
                        version: updated.version,
                        batch: receiptBody.batch,
                        file: receiptBody.file,
                        fingerprint: receiptBody.fingerprint,
                        itemIndex: receiptBody.itemIndex,
                        itemId: inserted.id,
                        sha256: receiptBody.sha256,
                        evidence: receiptBody.evidence,
                        position,
                        isMain,
                        digest: currentDigest,
                      },
                    });
                    await c.query(
                      "INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'gallery',$3,$4)",
                      [item.venueId, updated.version, principalId, audit],
                    );
                    return { action: "APPLIED" as const, reason: "IMPORTED", itemId: inserted.id };
                  });
                  result = { action: applied.action, reason: applied.reason };
                  if (applied.action === "APPLIED" && "itemId" in applied && typeof applied.itemId === "string") {
                    itemId = applied.itemId;
                  }
                }
              }
            }
          }
        }
      } catch (error: unknown) {
        result = galleryFail(error);
        itemId = undefined;
        blockedVenues.add(item.venueId);
      } finally {
        if (key) await services.media.releaseStage(key);
      }
      if (result.action === "FAILED" || result.action === "HOLD") blockedVenues.add(item.venueId);
      totals[result.action]++;
      emitGalleryLine(emit, item, itemIndex, name, result, itemId ? { id: itemId } : {});
    }
  } finally {
    if (lockClient) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [batchLease]);
      } catch { /* unlock best-effort */ }
      lockClient.release();
    }
  }
  emit({ totals, digest: currentDigest });
  return totals.FAILED === 0 && totals.HOLD === 0 ? 0 : 1;
}

async function loadAcceptedGalleryMaintenanceReceipt(
  c: Pick<PoolClient, "query">,
  keyHash: string,
): Promise<AcceptedGalleryMaintenanceReceipt | undefined> {
  const row = (await c.query<{ after_diff: Record<string, unknown> }>(
    `SELECT after_diff FROM privileged_audit_events
     WHERE idempotency_hash=$1 AND action_key='venue.gallery_reorder'
       AND reason_code='venue_gallery_maintenance'
     ORDER BY created_at DESC LIMIT 1`,
    [keyHash],
  )).rows[0];
  const after = row?.after_diff;
  if (!after || typeof after.fingerprint !== "string" || typeof after.operation !== "string"
    || typeof after.venueId !== "string" || typeof after.itemIndex !== "number"
    || !Array.isArray(after.orderedActiveIds) || !Array.isArray(after.removeIds)
    || !(after.mainId === null || typeof after.mainId === "string")) {
    return undefined;
  }
  return {
    fingerprint: after.fingerprint,
    operation: after.operation,
    venueId: after.venueId,
    itemIndex: after.itemIndex,
    orderedActiveIds: after.orderedActiveIds as string[],
    mainId: after.mainId as string | null,
    removeIds: after.removeIds as string[],
  };
}

async function loadGalleryMaintenanceOperationDigests(
  c: Pick<PoolClient, "query">,
  operation: string,
): Promise<string[]> {
  const rows = (await c.query<{ digest: string | null }>(
    `SELECT after_diff->>'digest' AS digest FROM privileged_audit_events
     WHERE action_key='venue.gallery_reorder'
       AND reason_code='venue_gallery_maintenance'
       AND after_diff->>'operation'=$1`,
    [operation],
  )).rows;
  return rows
    .map((row) => row.digest)
    .filter((digest): digest is string => typeof digest === "string" && digest.length > 0);
}

async function loadGalleryMaintenanceActive(
  c: Pick<PoolClient, "query">,
  venueId: string,
  forUpdate = false,
): Promise<GalleryMaintenanceActiveRow[]> {
  return (await c.query<GalleryMaintenanceActiveRow>(
    `SELECT id, position, is_main FROM venue_gallery_items
     WHERE venue_id=$1 AND active
     ORDER BY position ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [venueId],
  )).rows;
}

function maintenanceFail(error: unknown): GalleryMaintenanceReport {
  const body = error instanceof ProblemHttpException ? error.getResponse() : undefined;
  const code = typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
  if (typeof code === "string" && /^[A-Z_]{1,80}$/.test(code)) {
    return { action: "FAILED", reason: code };
  }
  const message = error instanceof Error ? error.message : "";
  if (/^[A-Z_]{1,80}$/.test(message)) return { action: "FAILED", reason: message };
  return { action: "FAILED", reason: "MAINTENANCE_ROW_FAILED" };
}

function emitMaintenanceLine(
  emit: (line: object) => void,
  item: GalleryMaintenanceItem,
  itemIndex: number,
  name: string,
  result: GalleryMaintenanceReport,
): void {
  emit({
    venueId: item.venueId,
    name,
    itemIndex,
    orderedActiveIds: item.orderedActiveIds,
    mainId: item.mainId,
    removeIds: item.removeIds,
    action: result.action,
    reason: result.reason,
  });
}

/**
 * Trusted CLI maintenance: reorder / promote MAIN / soft-remove already-approved gallery
 * rows under exact CAS + identity. No provider/media I/O. Default dry-run is read-only.
 */
export async function importVenueGalleryMaintenance(
  pool: Pool,
  manifest: GalleryMaintenanceManifest,
  principalId: string,
  apply: boolean,
  emit: (line: object) => void,
): Promise<number> {
  const totals = { APPLIED: 0, SKIPPED: 0, FAILED: 0, READY: 0, HOLD: 0 };
  const currentDigest = galleryMaintenanceManifestDigest(manifest);
  const operationLease = `venue_gallery_maintenance_v1:${manifest.operation}`;
  let operationBlocked = false;

  if (!apply) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await requireImportActor(client, principalId, false);
      const retained = await loadGalleryMaintenanceOperationDigests(client, manifest.operation);
      const manifestBind = planGalleryMaintenanceManifestBind(currentDigest, retained);
      if (manifestBind) operationBlocked = true;
      for (let itemIndex = 0; itemIndex < manifest.items.length; itemIndex++) {
        const item = manifest.items[itemIndex]!;
        let name = "";
        let result: GalleryMaintenanceReport;
        try {
          if (operationBlocked && manifestBind) {
            result = itemIndex === 0 ? manifestBind : { action: "FAILED", reason: "DEPENDENT_ITEM_FAILED" };
          } else {
            const keyHash = galleryMaintenanceAdmissionKeyHash(manifest.operation, itemIndex);
            const fingerprint = galleryMaintenanceItemFingerprint(item);
            const receipt = await loadAcceptedGalleryMaintenanceReceipt(client, keyHash);
            if (receipt) {
              result = planGalleryMaintenanceReplay(fingerprint, receipt);
            } else {
              const preview = (await client.query<GalleryMaintenanceVenueRow>(galleryVenueSelect, [item.venueId])).rows[0];
              name = preview?.name ?? "";
              const active = await loadGalleryMaintenanceActive(client, item.venueId);
              result = planGalleryMaintenanceRow(preview, item, active);
            }
          }
        } catch (error: unknown) {
          result = maintenanceFail(error);
        }
        totals[result.action]++;
        emitMaintenanceLine(emit, item, itemIndex, name, result);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    emit({ totals, digest: currentDigest });
    return totals.FAILED === 0 && totals.HOLD === 0 ? 0 : 1;
  }

  const userId = await requireImportActor(pool, principalId, true);
  let lockClient: PoolClient | undefined;
  try {
    lockClient = await pool.connect();
    const claimed = (await lockClient.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok",
      [operationLease],
    )).rows[0];
    if (!claimed?.ok) {
      for (let itemIndex = 0; itemIndex < manifest.items.length; itemIndex++) {
        const item = manifest.items[itemIndex]!;
        const result: GalleryMaintenanceReport = { action: "HOLD", reason: "OPERATION_IN_PROGRESS" };
        totals.HOLD++;
        emitMaintenanceLine(emit, item, itemIndex, "", result);
      }
      emit({ totals, digest: currentDigest });
      return 1;
    }

    const retained = await loadGalleryMaintenanceOperationDigests(pool, manifest.operation);
    const manifestBind = planGalleryMaintenanceManifestBind(currentDigest, retained);
    if (manifestBind) operationBlocked = true;

    for (let itemIndex = 0; itemIndex < manifest.items.length; itemIndex++) {
      const item = manifest.items[itemIndex]!;
      let name = "";
      let result: GalleryMaintenanceReport;
      const fingerprint = galleryMaintenanceItemFingerprint(item);
      const keyHash = galleryMaintenanceAdmissionKeyHash(manifest.operation, itemIndex);
      try {
        if (operationBlocked && manifestBind) {
          result = itemIndex === 0 ? manifestBind : { action: "FAILED", reason: "DEPENDENT_ITEM_FAILED" };
        } else if (await requireImportActor(pool, principalId, false) !== userId) {
          throw new Error("IMPORT_ACTOR_REFUSED");
        } else {
          const receipt = await loadAcceptedGalleryMaintenanceReceipt(pool, keyHash);
          if (receipt) {
            result = planGalleryMaintenanceReplay(fingerprint, receipt);
          } else {
            const applied = await adminTransaction(pool, async (c) => {
              if (await requireImportActor(c, principalId) !== userId) {
                throw new Error("IMPORT_ACTOR_REFUSED");
              }
              await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
              const liveDigests = await loadGalleryMaintenanceOperationDigests(c, manifest.operation);
              const liveBind = planGalleryMaintenanceManifestBind(currentDigest, liveDigests);
              if (liveBind) return liveBind;
              const terminal = await loadAcceptedGalleryMaintenanceReceipt(c, keyHash);
              if (terminal) return planGalleryMaintenanceReplay(fingerprint, terminal);

              const current = (await c.query<GalleryMaintenanceVenueRow>(
                `${galleryVenueSelect} FOR UPDATE`,
                [item.venueId],
              )).rows[0];
              name = current?.name ?? name;
              const lockedActive = await loadGalleryMaintenanceActive(c, item.venueId, true);
              const gate = planGalleryMaintenanceRow(current, item, lockedActive);
              if (gate.action !== "READY" || !current) return gate;

              if (item.removeIds.length > 0) {
                await c.query(
                  `UPDATE venue_gallery_items SET active=false, is_main=false, updated_at=now()
                   WHERE venue_id=$1 AND id = ANY($2::uuid[]) AND active`,
                  [item.venueId, item.removeIds],
                );
              }
              await c.query(
                `UPDATE venue_gallery_items SET is_main=false, updated_at=now()
                 WHERE venue_id=$1 AND active AND is_main`,
                [item.venueId],
              );
              await applyOrderedGalleryPositions(c, item.venueId, item.orderedActiveIds);
              if (item.mainId) {
                await c.query(
                  `UPDATE venue_gallery_items SET is_main=true, updated_at=now()
                   WHERE id=$1 AND venue_id=$2 AND active`,
                  [item.mainId, item.venueId],
                );
              }
              await projectVenueMainCover(c, item.venueId);
              const updated = (await c.query<{ version: number }>(
                `UPDATE venues SET version=version+1, updated_at=now()
                 WHERE id=$1 AND version=$2 RETURNING version`,
                [item.venueId, item.expectedVersion],
              )).rows[0];
              if (!updated) throw new Error("VENUE_VERSION_CONFLICT");

              const receiptBody = buildAcceptedGalleryMaintenanceReceipt(manifest, item, itemIndex);
              const audit = await appendAudit(c, {
                actor: { principalId, roles: ["superadmin"] },
                action: "venue.gallery_reorder",
                targetType: "venue",
                targetId: item.venueId,
                permission: "venue.manage",
                reason: "venue_gallery_maintenance",
                keyHash,
                before: { version: current.version },
                after: {
                  version: updated.version,
                  operation: receiptBody.operation,
                  venueId: receiptBody.venueId,
                  itemIndex: receiptBody.itemIndex,
                  fingerprint: receiptBody.fingerprint,
                  orderedActiveIds: receiptBody.orderedActiveIds,
                  mainId: receiptBody.mainId,
                  removeIds: receiptBody.removeIds,
                  digest: currentDigest,
                },
              });
              await c.query(
                "INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'gallery',$3,$4)",
                [item.venueId, updated.version, principalId, audit],
              );
              return { action: "APPLIED" as const, reason: "MAINTAINED" };
            });
            result = { action: applied.action, reason: applied.reason };
          }
        }
      } catch (error: unknown) {
        result = maintenanceFail(error);
      }
      totals[result.action]++;
      emitMaintenanceLine(emit, item, itemIndex, name, result);
    }
  } finally {
    if (lockClient) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [operationLease]);
      } catch { /* unlock best-effort */ }
      lockClient.release();
    }
  }
  emit({ totals, digest: currentDigest });
  return totals.FAILED === 0 && totals.HOLD === 0 ? 0 : 1;
}

type PublicDataServices = {
  moderation: Pick<ContentModerationService, "approveTexts" | "bindTexts">;
};

async function loadPublicDataAttempt(
  c: Pick<PoolClient, "query">,
  keyHash: string,
): Promise<PublicDataAttemptRecord | undefined> {
  const row = (await c.query<{ after_diff: Record<string, unknown> }>(
    `SELECT after_diff FROM privileged_audit_events
     WHERE idempotency_hash=$1 AND action_key='venue.edit'
       AND reason_code='venue_public_data_batch_attempt'
     ORDER BY created_at DESC LIMIT 1`,
    [keyHash],
  )).rows[0];
  const after = row?.after_diff;
  if (!after || typeof after.fingerprint !== "string" || typeof after.digest !== "string"
    || typeof after.batch !== "string" || typeof after.venueId !== "string") {
    return undefined;
  }
  return {
    fingerprint: after.fingerprint,
    digest: after.digest,
    batch: after.batch,
    venueId: after.venueId,
  };
}

/**
 * Narrow durable claim before text I/O — same audit-pattern as gallery attempt.
 * Attempt fingerprint mismatch rejects before accepted/eligibility; matching
 * accepted retains known replay/drift via planning. Matching pending stays HOLD.
 */
async function commitPublicDataAttemptOrReplay(
  pool: Pool,
  principalId: string,
  userId: string,
  manifest: PublicDataManifest,
  item: PublicDataItem,
  fingerprint: string,
  keyHash: string,
  currentDigest: string,
): Promise<PublicDataPlan | { action: "HOLD"; reason: string }> {
  return adminTransaction(pool, async (c) => {
    if (await requireImportActor(c, principalId) !== userId) {
      throw new Error("IMPORT_ACTOR_REFUSED");
    }
    const current = (await c.query<PublicDataVenueRow>(publicDataSelect, [item.venueId])).rows[0];
    // Same ordering as apply path: retained attempt mismatch before accepted/planning.
    const prior = await loadPublicDataAttempt(c, keyHash);
    if (prior) {
      const attemptReplay = planPublicDataAttemptReplay(fingerprint, currentDigest, prior);
      if (attemptReplay.action === "FAILED") return attemptReplay;
      const terminal = await loadAcceptedPublicDataReceipt(c, keyHash);
      if (terminal) {
        const planned = await planPublicDataItemState(c, manifest.batch, item, current);
        return planned.result;
      }
      return attemptReplay;
    }
    const planned = await planPublicDataItemState(c, manifest.batch, item, current);
    if (planned.result.action !== "READY") return planned.result;
    const terminal = await loadAcceptedPublicDataReceipt(c, keyHash);
    if (terminal) {
      return planPublicDataReplay(current!, fingerprint, terminal);
    }
    const raced = await loadPublicDataAttempt(c, keyHash);
    if (raced) return planPublicDataAttemptReplay(fingerprint, currentDigest, raced);
    await appendAudit(c, {
      actor: { principalId, roles: ["superadmin"] },
      action: "venue.edit",
      targetType: "venue",
      targetId: item.venueId,
      permission: "venue.manage",
      reason: "venue_public_data_batch_attempt",
      keyHash,
      after: {
        batch: manifest.batch,
        venueId: item.venueId,
        fingerprint,
        digest: currentDigest,
        expectedVersion: item.expectedVersion,
      },
    });
    return { action: "READY", reason: "ATTEMPT_RECORDED" };
  });
}

function publicDataFail(error: unknown): { action: "FAILED" | "HOLD"; reason: string } {
  const body = error instanceof ProblemHttpException ? error.getResponse() : undefined;
  const code = typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
  if (typeof code === "string" && /^[A-Z_]{1,80}$/.test(code)) {
    if (code === "MODERATION_TEMPORARILY_UNAVAILABLE" || code === "MODERATION_POLICY_MISMATCH"
      || code === "MODERATION_RATE_LIMITED") {
      return { action: "HOLD", reason: code };
    }
    return { action: "FAILED", reason: code };
  }
  return { action: "FAILED", reason: "IMPORT_ROW_FAILED" };
}

async function applyPublicDataItem(
  c: PoolClient,
  principalId: string,
  userId: string,
  manifest: PublicDataManifest,
  item: PublicDataItem,
  textPrep: VenueImportTextPrep,
  services: PublicDataServices | undefined,
): Promise<{ action: "APPLIED" | "READY" | "SKIPPED" | "FAILED"; reason: string }> {
  if (await requireImportActor(c, principalId) !== userId) throw new Error("IMPORT_ACTOR_REFUSED");
  await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
  const current = (await c.query<PublicDataVenueRow>(`${publicDataSelect} FOR UPDATE`, [item.venueId])).rows[0];
  const planned = await planPublicDataItemState(c, manifest.batch, item, current);
  if (planned.result.action !== "READY" || !current) return planned.result;

  const keyHash = publicDataKeyHash(manifest.batch, item.venueId);
  const touchIdentity = item.identity !== undefined;
  const nextIdentity = touchIdentity
    ? (planned.nextIdentity ?? resolvePublicDataIdentity(current, item.identity!))
    : undefined;

  const touchContacts = item.publicContacts !== undefined;
  const touchProfile = item.profile !== undefined;
  const contactsJson = touchContacts
    ? (item.publicContacts === null ? null : JSON.stringify(item.publicContacts))
    : null;
  const touchDescription = touchProfile && item.profile !== null
    && Object.prototype.hasOwnProperty.call(item.profile, "description");
  const clearProfile = touchProfile && item.profile === null;
  // Row CAS first so a version miss cannot leave a new identity key committed alone.
  const updated = (await c.query<{
    version: number;
    name: string;
    address: string;
    identity_discriminator: string;
    public_contacts: unknown;
    court_count: number | null;
    amenity_parking: boolean | null;
    amenity_showers: boolean | null;
    public_description: string | null;
  }>(`UPDATE venues SET
      name=CASE WHEN $2::boolean THEN $3::text ELSE name END,
      address=CASE WHEN $2::boolean THEN $4::text ELSE address END,
      normalized_name=CASE WHEN $2::boolean THEN $5::text ELSE normalized_name END,
      normalized_address=CASE WHEN $2::boolean THEN $6::text ELSE normalized_address END,
      identity_discriminator=CASE WHEN $2::boolean THEN $7::text ELSE identity_discriminator END,
      public_contacts=CASE WHEN $8::boolean THEN $9::jsonb ELSE public_contacts END,
      court_count=CASE WHEN $10::boolean THEN $11::integer ELSE court_count END,
      amenity_parking=CASE WHEN $10::boolean THEN $12::boolean ELSE amenity_parking END,
      amenity_showers=CASE WHEN $10::boolean THEN $13::boolean ELSE amenity_showers END,
      public_description=CASE WHEN $14::boolean THEN $15::text WHEN $16::boolean THEN NULL ELSE public_description END,
      version=version+1, updated_at=now()
    WHERE id=$1 AND version=$17
    RETURNING version, name, address, identity_discriminator, public_contacts,
              court_count, amenity_parking, amenity_showers, public_description`,
  [
    item.venueId,
    touchIdentity,
    nextIdentity?.name ?? current.name,
    nextIdentity?.address ?? current.address,
    nextIdentity?.normalizedName ?? null,
    nextIdentity?.normalizedAddress ?? null,
    nextIdentity?.identityDiscriminator ?? current.identity_discriminator,
    touchContacts,
    contactsJson,
    touchProfile,
    item.profile?.courtCount ?? null,
    item.profile?.amenities.parking ?? null,
    item.profile?.amenities.showers ?? null,
    touchDescription,
    touchDescription ? (item.profile?.description ?? null) : null,
    clearProfile,
    item.expectedVersion,
  ])).rows[0];
  if (!updated) return { action: "FAILED", reason: "VENUE_VERSION_CONFLICT" };

  if (touchIdentity && nextIdentity) {
    await c.query(
      "INSERT INTO venue_identity_keys(dedupe_key,venue_id,normalization_version) VALUES($1,$2,1) ON CONFLICT(dedupe_key) DO NOTHING",
      [nextIdentity.dedupeKey, item.venueId],
    );
    const claimant = await loadIdentityKeyClaimant(c, nextIdentity.dedupeKey);
    const collision = planPublicDataIdentityCollision(claimant, item.venueId);
    if (collision.action !== "READY") {
      throw new Error("VENUE_IDENTITY_CONFLICT");
    }
  }

  const applied = buildAppliedPatch(item);
  const afterRow: PublicDataVenueRow = {
    ...current,
    version: updated.version,
    name: updated.name,
    address: updated.address,
    identity_discriminator: updated.identity_discriminator,
    public_contacts: updated.public_contacts,
    court_count: updated.court_count,
    amenity_parking: updated.amenity_parking,
    amenity_showers: updated.amenity_showers,
    public_description: updated.public_description,
  };
  if (!appliedPublicFieldsMatch(afterRow, applied)) {
    throw new Error("PUBLIC_DATA_READBACK_MISMATCH");
  }

  if (services && textPrep.committed.length > 0) {
    await bindVenueDescriptionPublication(c, services.moderation, textPrep, {
      venueId: item.venueId,
      resourceVersion: updated.version,
      actorUserId: userId,
      actorPrincipalId: principalId,
    });
  }

  const before: Record<string, unknown> = { version: current.version };
  const after: Record<string, unknown> = {
    version: updated.version,
    fingerprint: applied.fingerprint,
    batch: manifest.batch,
    provenance: "venue_public_data_batch_import",
    sources: applied.sources,
  };
  if (touchIdentity) {
    before.identity = { name: current.name, address: current.address };
    after.identity = applied.identity;
  }
  if (touchContacts) {
    before.publicContacts = current.public_contacts ?? null;
    after.publicContacts = applied.publicContacts ?? null;
  }
  if (touchProfile) {
    before.profile = {
      courtCount: current.court_count,
      amenities: { parking: current.amenity_parking, showers: current.amenity_showers },
      description: current.public_description,
    };
    after.profile = applied.profile ?? null;
  }

  const audit = await appendAudit(c, {
    actor: { principalId, roles: ["superadmin"] },
    action: "venue.edit",
    targetType: "venue",
    targetId: item.venueId,
    permission: "venue.manage",
    reason: "venue_public_data_batch_import",
    keyHash,
    before,
    after,
  });
  await c.query(
    "INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'edit',$3,$4)",
    [item.venueId, updated.version, principalId, audit],
  );
  await c.query(
    "INSERT INTO outbox_events(type,aggregate_type,aggregate_id,aggregate_version,payload) VALUES($1,'venue',$2,$3,$4::jsonb)",
    ["venue.edit", item.venueId, updated.version, JSON.stringify({ venueId: item.venueId, canonicalVenueId: current.canonical_venue_id })],
  );
  return { action: "APPLIED", reason: "IMPORTED" };
}

export async function importVenuePublicData(
  pool: Pool,
  manifest: PublicDataManifest,
  principalId: string,
  apply: boolean,
  emit: (line: object) => void,
  services?: PublicDataServices,
): Promise<number> {
  const totals = { APPLIED: 0, SKIPPED: 0, FAILED: 0, READY: 0, HOLD: 0 };
  const currentDigest = publicDataDigest(manifest);
  if (!apply) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await requireImportActor(client, principalId, false);
      for (const item of manifest.items) {
        let name = "";
        let result: { action: keyof typeof totals; reason: string };
        try {
          const row = (await client.query<PublicDataVenueRow>(publicDataSelect, [item.venueId])).rows[0];
          const planned = await planPublicDataItemState(client, manifest.batch, item, row);
          name = planned.name;
          result = planned.result;
        } catch {
          result = { action: "FAILED", reason: "IMPORT_ROW_FAILED" };
        }
        totals[result.action]++;
        emit({ venueId: item.venueId, name, action: result.action, reason: result.reason });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    emit({ totals, digest: currentDigest });
    return totals.FAILED === 0 && totals.HOLD === 0 ? 0 : 1;
  }

  const userId = await requireImportActor(pool, principalId, true);
  for (const item of manifest.items) {
    let name = "";
    let result: { action: keyof typeof totals; reason: string };
    try {
      if (await requireImportActor(pool, principalId, false) !== userId) {
        throw new Error("IMPORT_ACTOR_REFUSED");
      }
      const preview = (await pool.query<PublicDataVenueRow>(publicDataSelect, [item.venueId])).rows[0];
      name = preview?.name ?? "";
      const keyHash = publicDataKeyHash(manifest.batch, item.venueId);
      const fingerprint = publicDataPatchFingerprint(item);

      // After auth: load ANY retained attempt; fingerprint/digest mismatch rejects
      // before accepted branch and mutable eligibility/version planning.
      // Matching accepted keeps known replay/drift; matching pending stays HOLD.
      // Do not convert matching accepted into pending HOLD.
      const priorAttempt = await loadPublicDataAttempt(pool, keyHash);
      let attemptConflict: { action: "FAILED"; reason: string } | undefined;
      let matchingPendingHold: { action: "HOLD"; reason: string } | undefined;
      if (priorAttempt) {
        const attemptReplay = planPublicDataAttemptReplay(fingerprint, currentDigest, priorAttempt);
        if (attemptReplay.action === "FAILED") {
          attemptConflict = attemptReplay;
        } else {
          matchingPendingHold = attemptReplay;
        }
      }
      if (attemptConflict) {
        result = attemptConflict;
      } else {
        const accepted = await loadAcceptedPublicDataReceipt(pool, keyHash);
        if (accepted) {
          const planned = await planPublicDataItemState(pool, manifest.batch, item, preview);
          name = planned.name || name;
          result = planned.result;
        } else if (matchingPendingHold) {
          result = matchingPendingHold;
        } else {
          const planned = await planPublicDataItemState(pool, manifest.batch, item, preview);
          name = planned.name || name;
          if (planned.result.action !== "READY" || !preview) {
            result = planned.result;
          } else {
            const needsText = needsPublicDataTextPrepare(preview, item);
            let textPrep: VenueImportTextPrep = emptyVenueImportTextPrep();
            if (needsText) {
              if (!services) throw new Error("PUBLIC_DATA_MODERATION_REQUIRED");
              const attemptGate = await commitPublicDataAttemptOrReplay(
                pool, principalId, userId, manifest, item, fingerprint, keyHash, currentDigest,
              );
              if (attemptGate.action !== "READY") {
                result = attemptGate;
              } else {
                const candidate = publicDataDescriptionCandidate(preview, item);
                if (candidate) {
                  const approval = await services.moderation.approveTexts(userId, [candidate]);
                  textPrep = {
                    approval,
                    committed: [{ surface: "venue_description", text: candidate.text }],
                  };
                }
                result = await adminTransaction(pool, async (c) =>
                  applyPublicDataItem(c, principalId, userId, manifest, item, textPrep, services),
                );
              }
            } else {
              // Fresh clear/omit/noop — zero provider egress; no new attempt claim.
              // Concurrent claim: attempt mismatch before accepted; matching accepted
              // must not become pending HOLD under the write TX.
              result = await adminTransaction(pool, async (c) => {
                if (await requireImportActor(c, principalId) !== userId) {
                  throw new Error("IMPORT_ACTOR_REFUSED");
                }
                const raced = await loadPublicDataAttempt(c, keyHash);
                if (raced) {
                  const racedReplay = planPublicDataAttemptReplay(fingerprint, currentDigest, raced);
                  if (racedReplay.action === "FAILED") return racedReplay;
                  const racedAccepted = await loadAcceptedPublicDataReceipt(c, keyHash);
                  if (!racedAccepted) return racedReplay;
                }
                return applyPublicDataItem(c, principalId, userId, manifest, item, textPrep, undefined);
              });
            }
          }
        }
      }
    } catch (error: unknown) {
      result = publicDataFail(error);
    }
    totals[result.action]++;
    emit({ venueId: item.venueId, name, action: result.action, reason: result.reason });
  }
  emit({ totals, digest: currentDigest });
  return totals.FAILED === 0 && totals.HOLD === 0 ? 0 : 1;
}

export async function main(argv:string[], raw:NodeJS.ProcessEnv = process.env):Promise<number> {
  guardImportEnv(raw);
  const options = new Map<string,string>(); let apply=false; let publicData=false; let gallery=false; let galleryMaintenance=false;
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (arg === "--apply" && !apply) {apply=true;continue;}
    if (arg === "--public-data" && !publicData) {publicData=true;continue;}
    if (arg === "--gallery" && !gallery) {gallery=true;continue;}
    if (arg === "--gallery-maintenance" && !galleryMaintenance) {galleryMaintenance=true;continue;}
    if (!arg || !["--dir","--manifest","--actor-principal-id"].includes(arg) || options.has(arg)) throw new Error("INVALID_ARGUMENTS");
    const value=argv[++i]; if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS"); options.set(arg,value);
  }
  if ([publicData, gallery, galleryMaintenance].filter(Boolean).length > 1) throw new Error("INVALID_ARGUMENTS");
  const dir=options.get("--dir"), file=options.get("--manifest"), actor=options.get("--actor-principal-id");
  if (!dir || !file || !actor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor)) throw new Error("INVALID_ARGUMENTS");
  if (publicData) {
    const manifest = validatePublicDataManifest(JSON.parse((await readBatchFile(dir, file, 256 * 1024)).toString("utf8")));
    const env = loadEnv(raw), { pool } = createDatabase(env.DATABASE_URL);
    try {
      // Narrow moderation injection for description gate only; dry-run still skips provider.
      const moderation = new ContentModerationService(pool, env, new OpenAIModerationProvider(env));
      return await importVenuePublicData(
        pool, manifest, actor, apply, (line) => console.log(JSON.stringify(line)),
        { moderation },
      );
    } finally { await pool.end(); }
  }
  if (galleryMaintenance) {
    // Manifest-only: no image bytes, no moderation provider construction.
    const manifest = validateGalleryMaintenanceManifest(
      JSON.parse((await readBatchFile(dir, file, 256 * 1024)).toString("utf8")),
    );
    const env = loadEnv(raw), { pool } = createDatabase(env.DATABASE_URL);
    try {
      return await importVenueGalleryMaintenance(pool, manifest, actor, apply, (line) => console.log(JSON.stringify(line)));
    } finally { await pool.end(); }
  }
  if (gallery) {
    const batch = await loadGalleryBatch(dir, file);
    const env = loadEnv(raw), { pool } = createDatabase(env.DATABASE_URL);
    try {
      const moderation = new ContentModerationService(pool, env, new OpenAIModerationProvider(env));
      const idempotency = new IdempotencyService(pool, env);
      const media = new AvatarService(pool, env, new MutationRunner(pool, idempotency, new ActorFenceService(env), env), moderation, idempotency);
      // No lifecycle hooks: dry-run must not start the collector or write storage.
      return await importVenueGallery(pool, batch, actor, apply, { media, moderation }, (line) => console.log(JSON.stringify(line)));
    } finally { await pool.end(); }
  }
  const batch=await loadBatch(dir,file);
  const env=loadEnv(raw), {pool}=createDatabase(env.DATABASE_URL);
  try {
    const moderation=new ContentModerationService(pool,env,new OpenAIModerationProvider(env));
    const idempotency=new IdempotencyService(pool,env);
    const media=new AvatarService(pool,env,new MutationRunner(pool,idempotency,new ActorFenceService(env),env),moderation,idempotency);
    // No lifecycle hooks: dry-run must not start the collector or write storage.
    return await importVenueCovers(pool,batch,actor,apply,{media,moderation},line=>console.log(JSON.stringify(line)));
  } finally {await pool.end();}
}
if (require.main === module) void main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(()=>{
  console.error("VENUE_COVER_IMPORT_REFUSED"); process.exitCode=1;
});
