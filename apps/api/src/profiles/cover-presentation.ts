import type { Pool, PoolClient } from "pg";
export type PlayerCover = { uploadedUrl: string | null };
/** Own-profile projection; public surfaces must authorize their viewer first. */
export async function coverForUser(db: Pool | PoolClient, userId: string): Promise<PlayerCover> {
  const result = await db.query<{ cover_key: string | null }>(`SELECT p.cover_key FROM player_social_profiles p
    JOIN users u ON u.id=p.user_id JOIN content_moderation_approvals a ON a.id=p.cover_moderation_approval_id
    WHERE p.user_id=$1 AND u.status='active' AND a.decision='allow' AND a.surface_key='cover_image'`, [userId]);
  const key = result.rows[0]?.cover_key;
  return { uploadedUrl: key && /^[a-f0-9]{64}\.png$/.test(key) ? `/v1/media/covers/${key}` : null };
}
