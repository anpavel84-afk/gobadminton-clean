-- Owner #448: product defaults directory_visible=true and contact_policy=requests
-- for new / missing normal-user social profiles. Owner default is NOT individual
-- consent — do not forge consent stamps or invent city/level.
-- 0048 is RESERVED by an unmerged authorized PG3 candidate; do not steal it.
--
-- Provenance: existing rows are labeled truthfully as legacy (unknown/implicit history),
-- not owner_default and not user_opt_out without proof. Visible legacy rows that already
-- carry real consent stamps become user_consent. Column DEFAULT for future inserts is
-- owner_default. Explicit API OFF sets user_opt_out in application code.
--
-- One-time scoped enable (operator-verified cohorts):
--   * demo seed OFF flags: reserved d0f00001-* + demo:synthetic:foundation-v001
--     + version=1 + epoch=1 → enable directory/contact defaults only
--   * pristine non-demo hidden: legacy + v1 + epoch1 + no stamps + not email-shaped
--     + no retained explicit visibility=false receipt → directory ON only (never flip
--     non-demo contact closed)
-- CAS on version=1 prevents re-enable on reapply / after user OFF (version bumps).
-- Missing ACTIVE unrestricted users get INSERT … ON CONFLICT DO NOTHING.

SELECT pg_advisory_xact_lock(hashtext('gobadminton_social448_defaults'));

ALTER TABLE player_social_profiles
  ALTER COLUMN directory_visible SET DEFAULT true;

-- 0044 already set contact_policy default to requests; reaffirm for this revision.
ALTER TABLE player_social_profiles
  ALTER COLUMN contact_policy SET DEFAULT 'requests';

-- Add nullable first so existing rows are not mass-labeled owner_default.
ALTER TABLE player_social_profiles
  ADD COLUMN IF NOT EXISTS directory_visibility_provenance text;

UPDATE player_social_profiles
SET directory_visibility_provenance = 'legacy'
WHERE directory_visibility_provenance IS NULL;

-- Visible rows that already satisfied the old city+consent opt-in gate.
UPDATE player_social_profiles
SET directory_visibility_provenance = 'user_consent'
WHERE directory_visible = true
  AND consent_policy_version IS NOT NULL
  AND opted_in_at IS NOT NULL
  AND directory_visibility_provenance = 'legacy';

-- Any remaining visible row (should be empty under the old constraint) uses Owner default
-- without inventing consent stamps.
UPDATE player_social_profiles
SET directory_visibility_provenance = 'owner_default'
WHERE directory_visible = true
  AND directory_visibility_provenance = 'legacy';

ALTER TABLE player_social_profiles
  ALTER COLUMN directory_visibility_provenance SET DEFAULT 'owner_default';

ALTER TABLE player_social_profiles
  ALTER COLUMN directory_visibility_provenance SET NOT NULL;

ALTER TABLE player_social_profiles
  DROP CONSTRAINT IF EXISTS player_social_profiles_directory_visibility_provenance_chk;

ALTER TABLE player_social_profiles
  ADD CONSTRAINT player_social_profiles_directory_visibility_provenance_chk CHECK (
    directory_visibility_provenance IN (
      'owner_default',
      'user_consent',
      'user_opt_out',
      'legacy'
    )
  );

COMMENT ON COLUMN player_social_profiles.directory_visibility_provenance IS
  'owner_default = Owner #448 product default ON without individual consent; user_consent = explicit directory consent stamps; user_opt_out = explicit directory hide via API; legacy = pre-#448 row without Owner-default or proven opt-out. Distinct from Radar consent.';

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

-- ---------------------------------------------------------------------------
-- Demo synthetic fixtures (both DEV/PROD seed): enable directory+contact OFF flags
-- only. Identity proof: reserved demo user UUID + exact demo issuer + v1 + epoch1.
-- Preserve city/name/consent stamps/safety/Radar/social_eligible. version+1 once.
-- ---------------------------------------------------------------------------
UPDATE player_social_profiles AS p
SET directory_visible = true,
    contact_policy = 'requests',
    directory_visibility_provenance = CASE
      WHEN p.directory_visible = true
        AND p.consent_policy_version IS NOT NULL
        AND p.opted_in_at IS NOT NULL
        THEN 'user_consent'
      ELSE 'owner_default'
    END,
    version = p.version + 1,
    updated_at = now()
WHERE p.user_id::text ~* '^d0f00001-0000-4000-8000-[0-9a-f]{12}$'
  AND p.version = 1
  AND p.social_action_epoch = 1
  AND (p.directory_visible = false OR p.contact_policy = 'closed')
  AND EXISTS (
    SELECT 1
    FROM external_identities ei
    WHERE ei.user_id = p.user_id
      AND ei.issuer_namespace = 'demo:synthetic:foundation-v001'
  )
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p.user_id AND u.status = 'active'
  );

-- ---------------------------------------------------------------------------
-- Pristine non-demo implicit directory OFF: enable directory only.
-- Never flip non-demo contact closed. Never treat unknown old OFF as user_opt_out.
-- ---------------------------------------------------------------------------
UPDATE player_social_profiles AS p
SET directory_visible = true,
    directory_visibility_provenance = 'owner_default',
    version = p.version + 1,
    updated_at = now()
WHERE p.directory_visible = false
  AND p.directory_visibility_provenance = 'legacy'
  AND p.version = 1
  AND p.social_action_epoch = 1
  AND p.consent_policy_version IS NULL
  AND p.opted_in_at IS NULL
  AND btrim(p.display_name) <> ''
  AND p.display_name !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  AND p.user_id::text !~* '^d0f00001-0000-4000-8000-[0-9a-f]{12}$'
  AND NOT EXISTS (
    SELECT 1
    FROM external_identities ei
    WHERE ei.user_id = p.user_id
      AND ei.issuer_namespace = 'demo:synthetic:foundation-v001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM idempotency_records ir
    WHERE ir.actor_id = p.user_id
      AND ir.operation = 'social_profile.visibility'
      AND ir.reservation_state = 'completed'
      AND ir.response_body ? 'directoryVisible'
      AND (ir.response_body->'directoryVisible') = 'false'::jsonb
  )
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = p.user_id AND u.status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_restrictions ur
    WHERE ur.user_id = p.user_id
      AND ur.capability IN ('account.access', 'profile.public', 'social.directory')
      AND ur.revoked_at IS NULL
      AND ur.starts_at <= clock_timestamp()
      AND ur.expires_at > clock_timestamp()
  );

-- ---------------------------------------------------------------------------
-- Materialize missing ACTIVE unrestricted users. Safe public name; optional real
-- city only (users have no city — leave NULL). No fake consent. DO NOTHING on conflict.
-- ---------------------------------------------------------------------------
INSERT INTO player_social_profiles (
  user_id,
  display_name,
  city_id,
  directory_visible,
  contact_policy,
  directory_visibility_provenance,
  social_eligible,
  version
)
SELECT
  u.id,
  CASE
    WHEN NULLIF(btrim(u.display_name), '') IS NULL THEN 'Игрок'
    WHEN u.display_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN 'Игрок'
    ELSE left(btrim(u.display_name), 80)
  END,
  NULL,
  true,
  'requests',
  'owner_default',
  true,
  1
FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM player_social_profiles p WHERE p.user_id = u.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_restrictions ur
    WHERE ur.user_id = u.id
      AND ur.capability IN ('account.access', 'profile.public', 'social.directory')
      AND ur.revoked_at IS NULL
      AND ur.starts_at <= clock_timestamp()
      AND ur.expires_at > clock_timestamp()
  )
ON CONFLICT (user_id) DO NOTHING;
