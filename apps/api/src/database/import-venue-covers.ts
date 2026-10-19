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
export async function requireImportActor(c: Pick<PoolClient,"query">, principalId:string): Promise<string> {
  const row = (await c.query<{user_id:string}>(`SELECT p.user_id FROM admin_principals p JOIN users u ON u.id=p.user_id
    JOIN admin_role_grants g ON g.principal_id=p.id AND g.role='superadmin' AND g.active=true
    WHERE p.id=$1 AND p.status='active' AND u.status='active' FOR UPDATE OF p,u,g`,[principalId])).rows[0];
  if (!row) throw new Error("IMPORT_ACTOR_REFUSED");
  return row.user_id;
}
type Services = {media:Pick<AvatarService,"stage"|"verifyStage"|"releaseStage">; moderation:Pick<ContentModerationService,"approveImage"|"bindImage">};
export async function importVenueCovers(pool:Pool, batch:{manifest:CoverManifest;images:Map<string,Buffer>}, principalId:string,
  apply:boolean, services:Services, emit:(line:object)=>void) {
  const userId = await requireImportActor(pool,principalId);
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
export async function main(argv:string[], raw:NodeJS.ProcessEnv = process.env):Promise<number> {
  guardImportEnv(raw);
  const options = new Map<string,string>(); let apply=false;
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (arg === "--apply" && !apply) {apply=true;continue;}
    if (!arg || !["--dir","--manifest","--actor-principal-id"].includes(arg) || options.has(arg)) throw new Error("INVALID_ARGUMENTS");
    const value=argv[++i]; if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS"); options.set(arg,value);
  }
  const dir=options.get("--dir"), file=options.get("--manifest"), actor=options.get("--actor-principal-id");
  if (!dir || !file || !actor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor)) throw new Error("INVALID_ARGUMENTS");
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
