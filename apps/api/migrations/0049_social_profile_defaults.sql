-- Owner #448: product defaults directory_visible=true and contact_policy=requests
-- for new / missing normal-user social profiles. Owner default is NOT individual
-- consent — do not forge consent stamps or invent city/level.
-- 0048 is RESERVED by an unmerged authorized PG3 candidate; do not steal it.
-- No bulk flip of existing directory OFF / contact closed rows in this migration.

ALTER TABLE player_social_profiles
  ALTER COLUMN directory_visible SET DEFAULT true;

-- 0044 already set contact_policy default to requests; reaffirm for this revision.
ALTER TABLE player_social_profiles
  ALTER COLUMN contact_policy SET DEFAULT 'requests';

ALTER TABLE player_social_profiles
  ADD COLUMN IF NOT EXISTS directory_visibility_provenance text NOT NULL DEFAULT 'owner_default'
    CHECK (
      directory_visibility_provenance IN (
        'owner_default',
        'user_consent',
        'user_opt_out'
      )
    );

COMMENT ON COLUMN player_social_profiles.directory_visibility_provenance IS
  'owner_default = Owner #448 product default ON without individual consent; user_consent = explicit directory consent stamps; user_opt_out = explicit directory hide. Distinct from Radar consent.';

-- Existing visible rows already satisfied the old city+consent opt-in gate.
UPDATE player_social_profiles
SET directory_visibility_provenance = 'user_consent'
WHERE directory_visible = true
  AND consent_policy_version IS NOT NULL
  AND opted_in_at IS NOT NULL
  AND directory_visibility_provenance = 'owner_default';

ALTER TABLE player_social_profiles
  DROP CONSTRAINT IF EXISTS player_social_profiles_directory_opt_in_chk;

ALTER TABLE player_social_profiles
  ADD CONSTRAINT player_social_profiles_directory_opt_in_chk CHECK (
    directory_visible = false
    OR (
      char_length(display_name) BETWEEN 1 AND 80
      AND directory_visibility_provenance IN ('owner_default', 'user_consent')
      AND (
        directory_visibility_provenance = 'owner_default'
        OR (
          consent_policy_version IS NOT NULL
          AND opted_in_at IS NOT NULL
        )
      )
    )
  );
