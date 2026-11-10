import { effectiveVenueCtes } from "../venues/effective-venue.query";
import type { PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { notFound } from "../auth/problem";
import { COMMUNITY_PHOTO_POLICY, type ContentModerationService } from "../moderation/moderation.service";
import { MODERATION_MODEL } from "../moderation/provider";
import type { AvatarService } from "../profiles/avatar.service";
import { unrestrictedSql } from "../restrictions/policy";
import { resolveCanonicalVenue } from "../venues/venue-community.query";
import type { CommentPhotoView } from "./comments.policy";

export const photoUnavailable = () => notFound("PHOTO_SUBMISSION_UNAVAILABLE", "Фото недоступно");
export type PhotoEvidence = { id: string; approvalId: string; fingerprint: string; sha256: string };
type Photo = { id: string; owner_user_id: string; venue_id: string; storage_key: string;
  image_sha256: string; image_approval_id: string; content_fingerprint: string;
  width: number; height: number; expires_at: Date; origin: string | null };
export function photoApprovalSql(_env: AppEnv): string {
  // Provider key is a bound parameter, never interpolated configuration.
  return `s.status='ready' AND s.version=1 AND s.purpose='comment_attachment'
    AND s.preset='community_photo' AND s.rights_version='community-photo-rights-v1'
    AND a.content_type='image' AND a.surface_key='community_photo_image' AND a.decision='allow'
    AND a.policy_version='${COMMUNITY_PHOTO_POLICY}' AND a.local_policy_version='none'
    AND a.fingerprint_version=1 AND a.provider_model='${MODERATION_MODEL}'`;
}
export async function revisionPhotoEvidence(client: PoolClient, commentId: string, version: number): Promise<PhotoEvidence[]> {
  return (await client.query<PhotoEvidence>(`SELECT s.id, s.image_approval_id AS "approvalId",
    a.content_fingerprint AS fingerprint, s.image_sha256 AS sha256
    FROM entity_comment_photos p JOIN venue_photo_submissions s ON s.id=p.photo_id
    JOIN content_moderation_approvals a ON a.id=s.image_approval_id
    WHERE p.comment_id=$1 AND p.resource_version=$2 ORDER BY p.position`, [commentId,version])).rows;
}
export async function currentPhotoIds(client: PoolClient, commentId: string, version: number): Promise<string[]> {
  return (await revisionPhotoEvidence(client, commentId, version)).map(p=>p.id);
}
/** No provider calls: stages already carry the paid exact-byte approval. */
export async function validatePublicationPhotos(client: PoolClient, env: AppEnv, media: AvatarService,
  moderation: ContentModerationService, input: { actorId: string; canonical: string; commentId?: string; version?: number; ids: string[] }): Promise<void> {
  if (input.ids.length > 4 || new Set(input.ids).size !== input.ids.length) throw photoUnavailable();
  // Lock submissions in stable UUID order, independent of display order.
  const rows = (await client.query<Photo>(`SELECT s.*,a.content_fingerprint,o.comment_id AS origin
    FROM venue_photo_submissions s JOIN content_moderation_approvals a ON a.id=s.image_approval_id
    LEFT JOIN entity_comment_photo_origins o ON o.photo_id=s.id
    WHERE s.id=ANY($1::uuid[]) AND ${photoApprovalSql(env)} AND a.provider_key=$2
    ORDER BY s.id FOR UPDATE OF s FOR SHARE OF a`, [input.ids,env.CONTENT_MODERATION_PROVIDER])).rows;
  if (rows.length !== input.ids.length) throw photoUnavailable();
  const retained = input.commentId ? await currentPhotoIds(client,input.commentId,input.version!) : [];
  for (const row of rows) {
    const sameCurrent = row.origin === input.commentId && retained.includes(row.id);
    if (row.owner_user_id!==input.actorId || (row.origin!==null && !sameCurrent)) throw photoUnavailable();
    const venue=await resolveCanonicalVenue(client,row.venue_id);
    if (!venue || venue.canonicalId!==input.canonical || (!sameCurrent &&
      (row.venue_id!==input.canonical || row.expires_at.getTime()<=Date.now()))) throw photoUnavailable();
    const bytes=await media.readPrivateStage(client,row.storage_key,row.image_sha256);
    if (moderation.fingerprint(bytes,"community_photo")!==row.content_fingerprint) throw photoUnavailable();
    // Recheck TTL after journal/disk waits, and again at SQL attachment insertion.
    if (!sameCurrent && row.expires_at.getTime()<=Date.now()) throw photoUnavailable();
  }
}
export async function bindPublicationPhotos(client: PoolClient, commentId: string, version: number, ids: string[]): Promise<void> {
  for (const [position,id] of ids.entries()) await client.query(`INSERT INTO entity_comment_photos
    (comment_id,resource_version,photo_id,position) VALUES($1,$2,$3,$4)`,[commentId,version,id,position]);
  await client.query(`UPDATE avatar_media_gc SET not_before=now() WHERE storage_key IN (
    SELECT s.storage_key FROM venue_photo_submissions s JOIN entity_comment_photo_origins o ON o.photo_id=s.id
    WHERE o.comment_id=$1)`,[commentId]);
}
export function publicPhotoAuthoritySql(env: AppEnv, viewerParam: string): string {
  return `c.entity_kind='venue' AND c.deleted_at IS NULL AND c.moderation_state='clear'
    AND p.resource_version=c.version AND ${photoApprovalSql(env)}
    AND EXISTS(${effectiveVenueCtes("SELECT c.entity_id AS id UNION SELECT s.venue_id AS id")}
      SELECT 1 FROM effective_venues ev WHERE ev.canonical_resolved AND ev.canonical_venue_id IS NULL
        AND ev.lifecycle_state IN ('unverified','verified')
      GROUP BY ev.id HAVING count(*)=CASE WHEN c.entity_id=s.venue_id THEN 1 ELSE 2 END)
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=c.author_user_id AND u.status='active'
      AND ${unrestrictedSql(env.USER_RESTRICTIONS_INTERNAL_ENABLED,"u.id",["account.access","profile.public"])})
    AND (${viewerParam}::uuid IS NULL OR NOT EXISTS(SELECT 1 FROM user_blocks b
      WHERE (b.blocker_user_id=${viewerParam}::uuid AND b.blocked_user_id=c.author_user_id)
         OR (b.blocked_user_id=${viewerParam}::uuid AND b.blocker_user_id=c.author_user_id)))`;
}
export function publicPhotoView(row: {id: string; width: number; height: number}, commentId: string, version: number): CommentPhotoView {
  return { id: row.id,width: row.width,height: row.height,
    url: `/v1/comments/${commentId}/revisions/${version}/photos/${row.id}` };
}
/** One statement binds each page item to its observed text revision and public photo authority. */
export async function projectCurrentPhotosBatch(client: PoolClient, env: AppEnv,
  comments: { id: string; version: number }[], viewerId: string | null): Promise<Map<string, CommentPhotoView[]>> {
  const photos = new Map<string, CommentPhotoView[]>(comments.map(c => [c.id, []]));
  if (!comments.length) return photos;
  const rows = (await client.query<{id: string; width: number; height: number; version: number; comment_id: string}>(`SELECT s.id,s.width,s.height,c.version,c.id AS comment_id
    FROM unnest($1::uuid[],$4::int[]) AS expected(id,version)
    JOIN entity_comments c ON c.id=expected.id AND c.version=expected.version
    JOIN entity_comment_photos p ON p.comment_id=c.id AND p.resource_version=c.version
    JOIN venue_photo_submissions s ON s.id=p.photo_id JOIN content_moderation_approvals a ON a.id=s.image_approval_id
    WHERE ${publicPhotoAuthoritySql(env,"$2")} AND a.provider_key=$3 ORDER BY c.id,p.position`,
    [comments.map(c=>c.id),viewerId,env.CONTENT_MODERATION_PROVIDER,comments.map(c=>c.version)])).rows;
  // publicPhotoAuthoritySql already resolves both comment and submission venues in this statement.
  for (const row of rows) photos.get(row.comment_id)!.push(publicPhotoView(row,row.comment_id,row.version));
  return photos;
}
export async function projectCurrentPhotos(client: PoolClient, env: AppEnv, commentId: string, viewerId: string | null, version: number): Promise<CommentPhotoView[]> {
  return (await projectCurrentPhotosBatch(client,env,[{id:commentId,version}],viewerId)).get(commentId)!;
}

/** A case may follow its own immutable staff-only state transitions, never a new authored revision. */
export async function sameReportedCommentLineage(client: PoolClient, input: {
  caseId: string; reportId: string; commentId: string; reportedVersion: number; currentVersion: number;
}): Promise<boolean> {
  if(input.currentVersion===input.reportedVersion) return true;
  if(input.currentVersion<input.reportedVersion) return false;
  const result=await client.query(`SELECT 1 WHERE NOT EXISTS(
    SELECT 1 FROM generate_series($4::int+1,$5::int) v(version)
    WHERE NOT EXISTS(SELECT 1 FROM venue_community_decisions d
      WHERE d.case_id=$1 AND d.report_id=$2 AND d.comment_id=$3 AND d.resource_kind='comment'
        AND d.expected_resource_version=v.version-1 AND d.resulting_resource_version=v.version
        AND d.decision IN ('withhold','restore')))
    AND (SELECT after_body FROM entity_comment_revisions WHERE comment_id=$3 AND resource_version=$4)
      IS NOT DISTINCT FROM (SELECT after_body FROM entity_comment_revisions WHERE comment_id=$3 AND resource_version=$5)`,
    [input.caseId,input.reportId,input.commentId,input.reportedVersion,input.currentVersion]);
  if(!result.rowCount) return false;
  return JSON.stringify(await revisionPhotoEvidence(client,input.commentId,input.reportedVersion))===
    JSON.stringify(await revisionPhotoEvidence(client,input.commentId,input.currentVersion));
}
