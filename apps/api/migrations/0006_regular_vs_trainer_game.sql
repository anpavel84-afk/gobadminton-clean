-- Checkpoint B: TrainerProfile + Game activityKind + settlement purpose.
-- Additive only: preserves 0001–0005. Does NOT classify legacy games as regular.

CREATE TABLE trainer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  display_name text NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 160),
  bio text NULL
    CHECK (bio IS NULL OR char_length(bio) BETWEEN 1 AND 1000),
  declaration_source text NOT NULL DEFAULT 'self_declared'
    CHECK (declaration_source = 'self_declared'),
  declared_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trainer_profiles_user_uidx UNIQUE (user_id)
);

CREATE INDEX trainer_profiles_status_idx
  ON trainer_profiles (status)
  WHERE status = 'active';

ALTER TABLE games
  ADD COLUMN activity_kind text NULL
    CHECK (
      activity_kind IS NULL
      OR activity_kind IN ('regular', 'trainer_led')
    ),
  ADD COLUMN trainer_profile_id uuid NULL
    REFERENCES trainer_profiles (id),
  ADD COLUMN trainer_display_name_snapshot text NULL
    CHECK (
      trainer_display_name_snapshot IS NULL
      OR char_length(trainer_display_name_snapshot) BETWEEN 1 AND 160
    ),
  ADD COLUMN training_description text NULL
    CHECK (
      training_description IS NULL
      OR char_length(training_description) BETWEEN 1 AND 2000
    ),
  ADD COLUMN settlement_purpose text NULL
    CHECK (
      settlement_purpose IS NULL
      OR settlement_purpose IN ('no_trainer_fee', 'trainer_fee')
    ),
  ADD COLUMN price_status text NULL
    CHECK (
      price_status IS NULL
      OR price_status IN ('fixed', 'by_agreement')
    ),
  ADD COLUMN price_unit text NULL
    CHECK (
      price_unit IS NULL
      OR price_unit = 'per_player_per_session'
    );

-- Classified-row local consistency (nullable legacy rows exempt).
ALTER TABLE games
  ADD CONSTRAINT games_activity_settlement_chk CHECK (
    activity_kind IS NULL
    OR (
      activity_kind = 'regular'
      AND settlement_purpose = 'no_trainer_fee'
      AND trainer_profile_id IS NULL
      AND trainer_display_name_snapshot IS NULL
      AND training_description IS NULL
      AND price_status IS NULL
      AND price_unit IS NULL
      AND price_minor IS NULL
      AND currency IS NULL
    )
    OR (
      activity_kind = 'trainer_led'
      AND settlement_purpose = 'trainer_fee'
      AND trainer_profile_id IS NOT NULL
      AND trainer_display_name_snapshot IS NOT NULL
      AND (
        (
          price_status = 'fixed'
          AND price_unit = 'per_player_per_session'
          AND price_minor IS NOT NULL
          AND price_minor::numeric > 0
          AND currency IS NOT NULL
        )
        OR (
          price_status = 'by_agreement'
          AND price_unit IS NULL
          AND price_minor IS NULL
          AND currency IS NULL
        )
      )
    )
  );

CREATE INDEX games_activity_kind_idx
  ON games (activity_kind)
  WHERE activity_kind IS NOT NULL;

-- Intentionally no blanket backfill of activity_kind/settlement_purpose.
-- Unknown legacy rows remain unclassified until an explicit Owner/process mapping.
