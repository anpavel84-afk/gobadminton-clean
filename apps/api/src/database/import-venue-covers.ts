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
  planPublicDataReplay,
  planPublicDataRow,
  planPublicDataVersion,
  publicDataDigest,
  publicDataKeyHash,
  publicDataPatchFingerprint,
  validatePublicDataManifest,
  type AcceptedPublicDataReceipt,
  type PublicDataManifest,
  type PublicDataVenueRow,
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
import { projectVenueMainCover } from "../venues/venue-gallery.service";
import { VENUE_GALLERY_MAX } from "../venues/venue-gallery";

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

const publicDataSelect = `SELECT name,address,lifecycle_state,version,canonical_venue_id,public_contacts,court_count,amenity_parking,amenity_showers,public_description
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
  if ("publicContacts" in after) {
    receipt.publicContacts = after.publicContacts as AcceptedPublicDataReceipt["publicContacts"];
  }
  if ("profile" in after) {
    receipt.profile = after.profile as AcceptedPublicDataReceipt["profile"];
  }
  return receipt;
}

type Services = {media:Pick<AvatarService,"stage"|"verifyStage"|"releaseStage">; moderation:Pick<ContentModerationService,"approveImage"|"bindImage">};
export async function importVenueCovers(pool:Pool, batch:{manifest:CoverManifest;images:Map<string,Buffer>}, principalId:string,
  apply:boolean, services:Services, emit:(line:object)=>void) {
  const userId = await requireImportActor(pool,principalId,apply);
  const totals = {APPLIED:0,SKIPPED:0,FAILED:0,READY:0};
  for (const item of batch.manifest.items) {
    let key:string|undefined;
    let name = "";
    let result:{action:keyof typeof totals;reason:string};
    try {
      const row = (await pool.query<VenueSnapshot>("SELECT name,lifecycle_state,cover_key,cover_credit_kind,version FROM venues WHERE id=$1",[item.venueId])).rows[0];
      name = row?.name ?? "";
      result = planCover(row);
      if (result.action === "READY" && apply) {
        const bytes = batch.images.get(item.venueId);
        if (!bytes) throw new Error("INVALID_IMAGE");
        const sanitized = await sanitizeAvatar(bytes,"image/jpeg","cover");
        key = `${randomBytes(32).toString("hex")}.png`;
        const staged = await services.media.stage(key,sanitized);
        const approval = await services.moderation.approveImage(userId,sanitized,"cover");
        const storageKey = key;
        result = await adminTransaction(pool,async c => {
          if (await requireImportActor(c,principalId) !== userId) throw new Error("IMPORT_ACTOR_REFUSED");
          const current = (await c.query<VenueSnapshot>("SELECT name,lifecycle_state,cover_key,cover_credit_kind,version FROM venues WHERE id=$1 FOR UPDATE",[item.venueId])).rows[0];
          const plan = planCover(current);
          if (plan.action !== "READY") return plan;
          const verified = await services.media.verifyStage(c,storageKey,staged);
          const approvalId = await services.moderation.bindImage(c,approval,verified,"cover");
          const updated = (await c.query<{version:number}>(`UPDATE venues SET cover_key=$2,cover_moderation_approval_id=$3,cover_actor_id=$4,
            cover_credit_kind=$5,cover_credit_text=$6,cover_credit_url=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING version`,
            [item.venueId,storageKey,approvalId,userId,item.kind,item.credit_text,item.source_page_url])).rows[0];
          if (!updated) throw new Error("VENUE_NOT_FOUND");
          await c.query("DELETE FROM avatar_media_gc WHERE storage_key=$1",[storageKey]);
          // Keep gallery main atomic with legacy cover columns after batch import.
          const main = (await c.query<{id:string}>(
            `SELECT id FROM venue_gallery_items WHERE venue_id=$1 AND active AND is_main FOR UPDATE`,
            [item.venueId],
          )).rows[0];
          if (main) {
            await c.query(
              `UPDATE venue_gallery_items SET storage_key=$2, moderation_approval_id=$3, actor_id=$4,
                 credit_kind=$5, credit_text=$6, credit_url=$7, source_url=$8, permission_basis=$9,
                 source_fingerprint=$10, updated_at=now() WHERE id=$1`,
              [main.id, storageKey, approvalId, userId, item.kind, item.credit_text, item.source_page_url,
                item.kind === "photo" ? item.source_page_url : null, item.basis_note, item.sha256.toLowerCase()],
            );
          } else {
            await c.query(
              `INSERT INTO venue_gallery_items(
                 venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
                 credit_kind, credit_text, credit_url, source_url, permission_basis, source_fingerprint
               ) VALUES ($1,0,true,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [item.venueId, storageKey, approvalId, userId, item.kind, item.credit_text, item.source_page_url,
                item.kind === "photo" ? item.source_page_url : null, item.basis_note, item.sha256.toLowerCase()],
            );
          }
          const audit = await appendAudit(c,{actor:{principalId,roles:["superadmin"]},action:"venue.cover_changed",targetType:"venue",targetId:item.venueId,
            permission:"venue.manage",reason:"venue_cover_batch_import",after:{batch:batch.manifest.batch,kind:item.kind,sha256:item.sha256.toLowerCase(),basis_note:item.basis_note}});
          await c.query("INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'cover',$3,$4)",[item.venueId,updated.version,principalId,audit]);
          return {action:"APPLIED" as const,reason:"IMPORTED"};
        });
      }
    } catch (error:unknown) {
      const body=error instanceof ProblemHttpException ? error.getResponse() : undefined;
      const code=typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
      result = {action:"FAILED",reason:typeof code === "string" && /^[A-Z_]{1,80}$/.test(code) ? code : "IMPORT_ROW_FAILED"};
    }
    finally { if (key) await services.media.releaseStage(key); }
    totals[result.action]++;
    emit({venueId:item.venueId,name,kind:item.kind,...result});
  }
  emit({totals,digest:manifestDigest(batch.manifest)});
  return totals.FAILED === 0 ? 0 : 1;
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
  moderation: Pick<ContentModerationService, "approveImage" | "bindImage">;
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

export async function importVenuePublicData(
  pool: Pool,
  manifest: PublicDataManifest,
  principalId: string,
  apply: boolean,
  emit: (line: object) => void,
): Promise<number> {
  const totals = { APPLIED: 0, SKIPPED: 0, FAILED: 0, READY: 0 };
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
          name = row?.name ?? "";
          const gate = planPublicDataRow(row, item);
          if (gate.action !== "READY" || !row) {
            result = gate;
          } else {
            const keyHash = publicDataKeyHash(manifest.batch, item.venueId);
            const fingerprint = publicDataPatchFingerprint(item);
            const receipt = await loadAcceptedPublicDataReceipt(client, keyHash);
            if (receipt) {
              result = planPublicDataReplay(row, fingerprint, receipt);
            } else {
              result = planPublicDataVersion(row, item);
            }
          }
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
    emit({ totals, digest: publicDataDigest(manifest) });
    return totals.FAILED === 0 ? 0 : 1;
  }

  const userId = await requireImportActor(pool, principalId, true);
  for (const item of manifest.items) {
    let name = "";
    let result: { action: keyof typeof totals; reason: string };
    try {
      const preview = (await pool.query<PublicDataVenueRow>(publicDataSelect, [item.venueId])).rows[0];
      name = preview?.name ?? "";
      result = await adminTransaction(pool, async (c) => {
        if (await requireImportActor(c, principalId) !== userId) throw new Error("IMPORT_ACTOR_REFUSED");
        await c.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
        const current = (await c.query<PublicDataVenueRow>(`${publicDataSelect} FOR UPDATE`, [item.venueId])).rows[0];
        name = current?.name ?? name;
        const gate = planPublicDataRow(current, item);
        if (gate.action !== "READY" || !current) return gate;

        const keyHash = publicDataKeyHash(manifest.batch, item.venueId);
        const fingerprint = publicDataPatchFingerprint(item);
        const receipt = await loadAcceptedPublicDataReceipt(c, keyHash);
        if (receipt) {
          return planPublicDataReplay(current, fingerprint, receipt);
        }

        const versionPlan = planPublicDataVersion(current, item);
        if (versionPlan.action !== "READY") return versionPlan;

        const touchContacts = item.publicContacts !== undefined;
        const touchProfile = item.profile !== undefined;
        const contactsJson = touchContacts
          ? (item.publicContacts === null ? null : JSON.stringify(item.publicContacts))
          : null;
        const touchDescription = touchProfile && item.profile !== null
          && Object.prototype.hasOwnProperty.call(item.profile, "description");
        const clearProfile = touchProfile && item.profile === null;
        const updated = (await c.query<{
          version: number;
          public_contacts: unknown;
          court_count: number | null;
          amenity_parking: boolean | null;
          amenity_showers: boolean | null;
          public_description: string | null;
        }>(`UPDATE venues SET
            public_contacts=CASE WHEN $2::boolean THEN $3::jsonb ELSE public_contacts END,
            court_count=CASE WHEN $4::boolean THEN $5::integer ELSE court_count END,
            amenity_parking=CASE WHEN $4::boolean THEN $6::boolean ELSE amenity_parking END,
            amenity_showers=CASE WHEN $4::boolean THEN $7::boolean ELSE amenity_showers END,
            public_description=CASE WHEN $8::boolean THEN $9::text WHEN $10::boolean THEN NULL ELSE public_description END,
            version=version+1, updated_at=now()
          WHERE id=$1 AND version=$11
          RETURNING version, public_contacts, court_count, amenity_parking, amenity_showers, public_description`,
        [
          item.venueId,
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
        if (!updated) return { action: "FAILED" as const, reason: "VENUE_VERSION_CONFLICT" };

        const applied = buildAppliedPatch(item);
        const afterRow: PublicDataVenueRow = {
          ...current,
          version: updated.version,
          public_contacts: updated.public_contacts,
          court_count: updated.court_count,
          amenity_parking: updated.amenity_parking,
          amenity_showers: updated.amenity_showers,
          public_description: updated.public_description,
        };
        if (!appliedPublicFieldsMatch(afterRow, applied)) {
          throw new Error("PUBLIC_DATA_READBACK_MISMATCH");
        }

        const before: Record<string, unknown> = { version: current.version };
        const after: Record<string, unknown> = {
          version: updated.version,
          fingerprint: applied.fingerprint,
          batch: manifest.batch,
          provenance: "venue_public_data_batch_import",
          // Same transactional after_diff: validated sources for operator provenance.
          sources: applied.sources,
        };
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
        return { action: "APPLIED" as const, reason: "IMPORTED" };
      });
    } catch (error: unknown) {
      const body = error instanceof ProblemHttpException ? error.getResponse() : undefined;
      const code = typeof body === "object" && body !== null && "code" in body ? body.code : undefined;
      result = { action: "FAILED", reason: typeof code === "string" && /^[A-Z_]{1,80}$/.test(code) ? code : "IMPORT_ROW_FAILED" };
    }
    totals[result.action]++;
    emit({ venueId: item.venueId, name, action: result.action, reason: result.reason });
  }
  emit({ totals, digest: publicDataDigest(manifest) });
  return totals.FAILED === 0 ? 0 : 1;
}

export async function main(argv:string[], raw:NodeJS.ProcessEnv = process.env):Promise<number> {
  guardImportEnv(raw);
  const options = new Map<string,string>(); let apply=false; let publicData=false; let gallery=false;
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (arg === "--apply" && !apply) {apply=true;continue;}
    if (arg === "--public-data" && !publicData) {publicData=true;continue;}
    if (arg === "--gallery" && !gallery) {gallery=true;continue;}
    if (!arg || !["--dir","--manifest","--actor-principal-id"].includes(arg) || options.has(arg)) throw new Error("INVALID_ARGUMENTS");
    const value=argv[++i]; if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS"); options.set(arg,value);
  }
  if (publicData && gallery) throw new Error("INVALID_ARGUMENTS");
  const dir=options.get("--dir"), file=options.get("--manifest"), actor=options.get("--actor-principal-id");
  if (!dir || !file || !actor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor)) throw new Error("INVALID_ARGUMENTS");
  if (publicData) {
    const manifest = validatePublicDataManifest(JSON.parse((await readBatchFile(dir, file, 256 * 1024)).toString("utf8")));
    const env = loadEnv(raw), { pool } = createDatabase(env.DATABASE_URL);
    try {
      return await importVenuePublicData(pool, manifest, actor, apply, (line) => console.log(JSON.stringify(line)));
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
