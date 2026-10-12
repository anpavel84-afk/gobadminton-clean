-- Venue A1a: lifecycle, versioned normalization, exact identity reservation.
-- Additive only. No admin principal FKs (Admin A0a is a later slice).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_data_status_check;
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_provenance_check;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS lifecycle_state text,
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS normalized_address text,
  ADD COLUMN IF NOT EXISTS normalization_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canonical_venue_id uuid REFERENCES venues (id),
  ADD COLUMN IF NOT EXISTS identity_discriminator text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS review_markers jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE venues
  ADD CONSTRAINT venues_data_status_check
    CHECK (data_status IN ('verified', 'unverified', 'stale')),
  ADD CONSTRAINT venues_provenance_check
    CHECK (provenance IN (
      'organizer_submitted',
      'operator_seeded',
      'user_submitted',
      'admin_created',
      'admin_corrected',
      'legacy'
    )),
  ADD CONSTRAINT venues_lifecycle_state_check
    CHECK (lifecycle_state IN ('unverified', 'verified', 'retired', 'merged')),
  ADD CONSTRAINT venues_normalization_version_check
    CHECK (normalization_version >= 1),
  ADD CONSTRAINT venues_canonical_merge_chk
    CHECK (
      (lifecycle_state = 'merged'
        AND canonical_venue_id IS NOT NULL
        AND canonical_venue_id <> id)
      OR (lifecycle_state IS DISTINCT FROM 'merged'
        AND (canonical_venue_id IS NULL OR canonical_venue_id = id))
    );

CREATE OR REPLACE FUNCTION venue_normalize_v1(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both FROM regexp_replace(
    replace(lower(normalize(coalesce(input, ''), NFKC)), 'ё', 'е'),
    '[^[:alnum:]]+',
    ' ',
    'g'
  ));
$$;

-- Legacy backfill keeps identity_discriminator empty unless already set.
-- Runtime writers extract hall/building/unit via application v1 rules.
UPDATE venues
SET
  lifecycle_state = CASE
    WHEN data_status = 'verified' THEN 'verified'
    ELSE 'unverified'
  END,
  review_markers = CASE
    WHEN data_status = 'stale' THEN '["legacy_stale"]'::jsonb
    ELSE coalesce(review_markers, '[]'::jsonb)
  END,
  normalized_name = venue_normalize_v1(name),
  normalized_address = venue_normalize_v1(address),
  normalization_version = 1
WHERE lifecycle_state IS NULL
   OR normalized_name IS NULL
   OR normalized_address IS NULL;

ALTER TABLE venues
  ALTER COLUMN lifecycle_state SET NOT NULL,
  ALTER COLUMN normalized_name SET NOT NULL,
  ALTER COLUMN normalized_address SET NOT NULL;

CREATE TABLE venue_identity_keys (
  dedupe_key text PRIMARY KEY
    CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  venue_id uuid NOT NULL REFERENCES venues (id),
  normalization_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX venue_identity_keys_venue_version_uidx
  ON venue_identity_keys (venue_id, normalization_version);

CREATE TABLE venue_duplicate_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  left_venue_id uuid NOT NULL REFERENCES venues (id),
  right_venue_id uuid NOT NULL REFERENCES venues (id),
  source text NOT NULL
    CHECK (source IN ('legacy_exact_collision', 'fuzzy_advisory')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (left_venue_id <> right_venue_id),
  UNIQUE (left_venue_id, right_venue_id, source)
);

CREATE TABLE venue_merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  source_venue_id uuid NOT NULL REFERENCES venues (id),
  target_venue_id uuid NOT NULL REFERENCES venues (id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_venue_id <> target_venue_id)
);

CREATE TABLE venue_proposal_confirm_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  token_hash text NOT NULL UNIQUE
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users (id),
  session_id uuid NOT NULL REFERENCES app_sessions (id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'confirm_distinct'
    CHECK (purpose = 'confirm_distinct'),
  proposal_fingerprint text NOT NULL
    CHECK (proposal_fingerprint ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venue_proposal_confirm_tokens_session_idx
  ON venue_proposal_confirm_tokens (session_id)
  WHERE used_at IS NULL;

CREATE INDEX venues_catalog_city_lifecycle_idx
  ON venues (city_id, lifecycle_state, id)
  WHERE lifecycle_state IN ('unverified', 'verified');

CREATE INDEX venues_normalized_name_idx
  ON venues (city_id, normalized_name);

-- Idempotent legacy backfill: one reservation per exact key; collisions stay
-- as separate Venue rows with Game FKs intact and a human-review candidate.
CREATE OR REPLACE FUNCTION venue_backfill_identity_keys()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  k text;
  claimed uuid;
  left_id uuid;
  right_id uuid;
BEGIN
  FOR rec IN
    SELECT
      id,
      city_id,
      normalized_name,
      normalized_address,
      identity_discriminator,
      normalization_version,
      created_at
    FROM venues
    ORDER BY created_at ASC, id ASC
  LOOP
    k := encode(
      digest(
        rec.normalization_version::text || '|' || rec.city_id::text || '|' ||
        rec.normalized_name || '|' || rec.normalized_address || '|' ||
        rec.identity_discriminator,
        'sha256'
      ),
      'hex'
    );
    SELECT venue_id INTO claimed
    FROM venue_identity_keys
    WHERE dedupe_key = k;
    IF claimed IS NULL THEN
      INSERT INTO venue_identity_keys (dedupe_key, venue_id, normalization_version)
      VALUES (k, rec.id, rec.normalization_version)
      ON CONFLICT (dedupe_key) DO NOTHING;
    ELSIF claimed <> rec.id THEN
      IF rec.id < claimed THEN
        left_id := rec.id;
        right_id := claimed;
      ELSE
        left_id := claimed;
        right_id := rec.id;
      END IF;
      INSERT INTO venue_duplicate_candidates (
        left_venue_id, right_venue_id, source, status
      ) VALUES (
        left_id, right_id, 'legacy_exact_collision', 'open'
      )
      ON CONFLICT (left_venue_id, right_venue_id, source) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

SELECT venue_backfill_identity_keys();
