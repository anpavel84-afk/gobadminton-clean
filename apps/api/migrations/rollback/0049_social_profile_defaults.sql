-- Rollback for 0049 (#448 social defaults).
-- Preferred path: app-only rollback — retain additive schema/data (column, defaults,
-- provenance values, enabled rows). Revert application writers to the prior contract.
--
-- Optional DB rollback restores directory_visible DEFAULT false and the pre-#448
-- city+consent directory opt-in constraint, then drops provenance.
-- It HOLD/refuses when any visible row cannot meet that old contract.
-- Never silently hide user-visible rows, forge consent, delete profiles, or rewrite
-- user choices to force a green restore. Operator DB backup/restore is separate.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM player_social_profiles
    WHERE directory_visible = true
      AND (
        city_id IS NULL
        OR consent_policy_version IS NULL
        OR opted_in_at IS NULL
        OR char_length(display_name) < 1
      )
  ) THEN
    RAISE EXCEPTION
      '0049 DB rollback refused: visible rows are incompatible with the pre-#448 city+consent directory contract. Prefer app-only rollback retaining additive schema/data, or restore from the operator pre-migration DB backup. Do not forge consent, hide profiles, or delete user choices to force PASS.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

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
  DROP CONSTRAINT IF EXISTS player_social_profiles_directory_visibility_provenance_chk;

ALTER TABLE player_social_profiles
  DROP COLUMN IF EXISTS directory_visibility_provenance;

-- contact_policy DEFAULT stays requests (0044).

DELETE FROM schema_migrations WHERE id = '0049_social_profile_defaults';
