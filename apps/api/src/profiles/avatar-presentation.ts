import type { Pool, PoolClient } from "pg";
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "../lib/original-http-authority";
import { unrestrictedSql } from "../restrictions/policy";
export type PlayerAvatar = { uploadedUrl: string | null; providerUrl: string | null };
export const emptyAvatar = (): PlayerAvatar => ({ uploadedUrl: null, providerUrl: null });

/**
 * Shared public projection — called AFTER the owning surface authorized the person.
 * Unreviewed VK/Yandex providerUrl is quarantined (null); uploaded M1 key / initials remain.
 * OAuth ingest keeps using safeProviderAvatar separately; no remote download here.
 */
export async function avatarForUser(db: Pool | PoolClient, userId: string): Promise<PlayerAvatar> {
  const result = await db.query<{ avatar_key: string | null }>(
    `SELECT p.avatar_key
     FROM users u LEFT JOIN player_social_profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND u.status = 'active'`, [userId]);
  const row = result.rows[0];
  return { uploadedUrl: safeUploadedAvatar(row?.avatar_key), providerUrl: null };
}
/** Hostname sanitizer for OAuth/identity INGEST and stored metadata only — not a public pixel approval. */
export function safeProviderAvatar(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048 || !httpUrlAgreesWithOriginalAuthority(raw, forbiddenUrlScalars)) return null;
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "avatars.yandex.net" || url.hostname.endsWith(".userapi.com")) ? url.href : null; } catch { return null; }
}
export async function avatarForPlayer(db: Pool | PoolClient, publicPlayerId: string): Promise<PlayerAvatar> {
  const r = await db.query<{ user_id: string }>("SELECT user_id FROM player_social_profiles WHERE public_player_id = $1", [publicPlayerId]);
  return r.rows[0] ? avatarForUser(db, r.rows[0].user_id) : emptyAvatar();
}

/** Only the public creator profile may decorate a game; managers and trainers are unrelated. */
export async function avatarForGameCreator(db: Pool | PoolClient, gameId: string, restrictionsEnabled: boolean, viewerId: string | null = null): Promise<PlayerAvatar> {
  const eligible = await db.query<{ user_id: string }>(`SELECT p.user_id
    FROM games g JOIN player_social_profiles p ON p.user_id = g.created_by_user_id
    JOIN users u ON u.id = p.user_id
    WHERE g.id = $1 AND u.status = 'active' AND p.directory_visible AND p.social_eligible
      AND ${unrestrictedSql(restrictionsEnabled, "p.user_id", ["account.access", "profile.public", "social.directory"])}
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_user_id = $2::uuid AND b.blocked_user_id = p.user_id) OR
        (b.blocked_user_id = $2::uuid AND b.blocker_user_id = p.user_id))`, [gameId, viewerId]);
  return eligible.rows[0] ? avatarForUser(db, eligible.rows[0].user_id) : emptyAvatar();
}
export function safeUploadedAvatar(key: string | null | undefined): string | null {
  return key && /^[a-f0-9]{64}\.png$/.test(key) ? `/v1/media/avatars/${key}` : null;
}
