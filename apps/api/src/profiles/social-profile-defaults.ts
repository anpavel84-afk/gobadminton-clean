import type { Pool, PoolClient } from "pg";

/** Safe public display fallback — never use email or invent a city. */
export const SOCIAL_PROFILE_SAFE_DISPLAY_NAME = "Игрок";

export const DIRECTORY_VISIBILITY_PROVENANCE = {
  OWNER_DEFAULT: "owner_default",
  USER_CONSENT: "user_consent",
  USER_OPT_OUT: "user_opt_out",
} as const;

export type DirectoryVisibilityProvenance =
  (typeof DIRECTORY_VISIBILITY_PROVENANCE)[keyof typeof DIRECTORY_VISIBILITY_PROVENANCE];

export type EnsureDefaultSocialProfileInput = {
  userId: string;
  /** Account / provider name when already known; falls back to Игрок. */
  displayName?: string | null;
  /** Only an actual optional city — never invent one. */
  cityId?: string | null;
};

/**
 * Materialize a missing social profile with Owner #448 defaults
 * (directory ON + contact requests, owner_default provenance, no consent stamps).
 * INSERT … ON CONFLICT DO NOTHING — never updates an existing row (preserves OFF).
 */
export async function ensureDefaultSocialProfile(
  client: Pool | PoolClient,
  input: EnsureDefaultSocialProfileInput,
): Promise<void> {
  const raw = (input.displayName ?? "").trim();
  const displayName = (
    raw.length > 0 ? raw : SOCIAL_PROFILE_SAFE_DISPLAY_NAME
  ).slice(0, 80);
  const cityId = input.cityId ?? null;
  await client.query(
    `INSERT INTO player_social_profiles (
       user_id,
       display_name,
       city_id,
       directory_visible,
       contact_policy,
       directory_visibility_provenance,
       social_eligible,
       version
     ) VALUES (
       $1, $2, $3, true, 'requests', $4, true, 1
     )
     ON CONFLICT (user_id) DO NOTHING`,
    [
      input.userId,
      displayName,
      cityId,
      DIRECTORY_VISIBILITY_PROVENANCE.OWNER_DEFAULT,
    ],
  );
}
