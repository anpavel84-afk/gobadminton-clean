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
  const options = new Map<string,string>(); let apply=false; let publicData=false;
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (arg === "--apply" && !apply) {apply=true;continue;}
    if (arg === "--public-data" && !publicData) {publicData=true;continue;}
    if (!arg || !["--dir","--manifest","--actor-principal-id"].includes(arg) || options.has(arg)) throw new Error("INVALID_ARGUMENTS");
    const value=argv[++i]; if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS"); options.set(arg,value);
  }
  const dir=options.get("--dir"), file=options.get("--manifest"), actor=options.get("--actor-principal-id");
  if (!dir || !file || !actor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor)) throw new Error("INVALID_ARGUMENTS");
  if (publicData) {
    const manifest = validatePublicDataManifest(JSON.parse((await readBatchFile(dir, file, 256 * 1024)).toString("utf8")));
    const env = loadEnv(raw), { pool } = createDatabase(env.DATABASE_URL);
    try {
      return await importVenuePublicData(pool, manifest, actor, apply, (line) => console.log(JSON.stringify(line)));
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
