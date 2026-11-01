-- Source-compatible rollback for 0049. Restores directory_visible DEFAULT false and
-- the pre-#448 city+consent directory opt-in constraint. Rows that are visible under
-- owner_default without city/consent cannot satisfy the restored constraint — hide
-- those first without inventing consent. Explicit user_consent / user_opt_out rows
-- and contact_policy values are otherwise preserved. contact_policy DEFAULT stays
-- requests (0044). Do not bulk-rewrite historical privacy choices beyond the hide
-- required for constraint restoration.

UPDATE player_social_profiles
SET directory_visible = false,
    directory_visibility_provenance = CASE
      WHEN directory_visibility_provenance = 'user_opt_out' THEN 'user_opt_out'
      WHEN consent_policy_version IS NOT NULL AND opted_in_at IS NOT NULL THEN 'user_consent'
      ELSE 'owner_default'
    END,
    updated_at = now()
WHERE directory_visible = true
  AND (
    city_id IS NULL
    OR consent_policy_version IS NULL
    OR opted_in_at IS NULL
    OR char_length(display_name) < 1
  );

ALTER TABLE player_social_profiles
  DROP CONSTRAINT IF EXISTS player_social_profiles_directory_opt_in_chk;

ALTER TABLE player_social_profiles
  ADD CONSTRAINT player_social_profiles_directory_opt_in_chk CHECK (
    directory_visible = false
    OR (
      char_length(display_name) BETWEEN 1 AND 80
      AND city_id IS NOT NULL
      AND consent_policy_version IS NOT NULL
      AND opted_in_at IS NOT NULL
    )
  );

ALTER TABLE player_social_profiles
  ALTER COLUMN directory_visible SET DEFAULT false;

ALTER TABLE player_social_profiles
  DROP COLUMN IF EXISTS directory_visibility_provenance;

DELETE FROM schema_migrations WHERE id = '0049_social_profile_defaults';
