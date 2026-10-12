import type { Pool, PoolClient } from "pg";
export type PlayerAvatar = { uploadedUrl: string | null; providerUrl: string | null };
export const emptyAvatar = (): PlayerAvatar => ({ uploadedUrl: null, providerUrl: null });

/** Projection only, called AFTER the owning surface has authorized the person. No network I/O. */
export async function avatarForUser(db: Pool | PoolClient, userId: string): Promise<PlayerAvatar> {
  const result = await db.query<{ avatar_key: string | null; provider_url: string | null }>(
    `SELECT p.avatar_key, (SELECT e.avatar_url FROM external_identities e
      WHERE e.user_id = u.id AND e.provider_key IN ('vk','yandex') AND e.avatar_url IS NOT NULL ORDER BY e.created_at, e.id LIMIT 1) AS provider_url
     FROM users u LEFT JOIN player_social_profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND u.status = 'active'`, [userId]);
  const row = result.rows[0];
  return { uploadedUrl: row?.avatar_key ? `/v1/media/avatars/${row.avatar_key}` : null, providerUrl: safeProviderAvatar(row?.provider_url) };
}
export function safeProviderAvatar(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  try { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "avatars.yandex.net" || url.hostname.endsWith(".userapi.com")) ? url.href : null; } catch { return null; }
}
export async function avatarForPlayer(db: Pool | PoolClient, publicPlayerId: string): Promise<PlayerAvatar> {
  const r = await db.query<{ user_id: string }>("SELECT user_id FROM player_social_profiles WHERE public_player_id = $1", [publicPlayerId]);
  return r.rows[0] ? avatarForUser(db, r.rows[0].user_id) : emptyAvatar();
}
