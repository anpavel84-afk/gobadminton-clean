-- LS-01: opt-in SocialProfile, looking intent, PairFence, blocks, abuse reports.
-- Additive only. Preserves 0001–0007. No Radar presence/matching tables.

CREATE TABLE player_social_profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  public_player_id uuid NOT NULL DEFAULT gen_random_uuid(),
  display_name text NOT NULL DEFAULT ''
    CHECK (char_length(display_name) <= 80),
  city_id uuid NULL REFERENCES cities (id),
  area_key text NULL
    CHECK (area_key IS NULL OR char_length(area_key) BETWEEN 1 AND 64),
  level_scale_id text NULL
    CHECK (level_scale_id IS NULL OR char_length(level_scale_id) BETWEEN 1 AND 64),
  level_scale_version integer NULL
    CHECK (level_scale_version IS NULL OR level_scale_version >= 1),
  level_id text NULL
    CHECK (level_id IS NULL OR char_length(level_id) BETWEEN 1 AND 64),
  bio text NULL
    CHECK (bio IS NULL OR char_length(bio) BETWEEN 1 AND 500),
  directory_visible boolean NOT NULL DEFAULT false,
  contact_policy text NOT NULL DEFAULT 'closed'
    CHECK (contact_policy IN ('requests', 'closed')),
  consent_policy_version text NULL
    CHECK (
      consent_policy_version IS NULL
      OR char_length(consent_policy_version) BETWEEN 1 AND 64
    ),
  opted_in_at timestamptz NULL,
  radar_consented boolean NOT NULL DEFAULT false,
  radar_consent_policy_version text NULL
    CHECK (
      radar_consent_policy_version IS NULL
      OR char_length(radar_consent_policy_version) BETWEEN 1 AND 64
    ),
  radar_consented_at timestamptz NULL,
  social_eligible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_social_profiles_public_player_uidx UNIQUE (public_player_id),
  CONSTRAINT player_social_profiles_level_together_chk CHECK (
    (
      level_scale_id IS NULL
      AND level_scale_version IS NULL
      AND level_id IS NULL
    )
    OR (
      level_scale_id IS NOT NULL
      AND level_scale_version IS NOT NULL
      AND level_id IS NOT NULL
    )
  ),
  CONSTRAINT player_social_profiles_directory_opt_in_chk CHECK (
    directory_visible = false
    OR (
      char_length(display_name) BETWEEN 1 AND 80
      AND city_id IS NOT NULL
      AND consent_policy_version IS NOT NULL
      AND opted_in_at IS NOT NULL
    )
  ),
  CONSTRAINT player_social_profiles_radar_consent_chk CHECK (
    (
      radar_consented = false
      AND radar_consent_policy_version IS NULL
      AND radar_consented_at IS NULL
    )
    OR (
      radar_consented = true
      AND radar_consent_policy_version IS NOT NULL
      AND radar_consented_at IS NOT NULL
    )
  )
);

CREATE INDEX player_social_profiles_directory_idx
  ON player_social_profiles (directory_visible, city_id, public_player_id)
  WHERE directory_visible = true AND social_eligible = true;

CREATE INDEX player_social_profiles_display_name_idx
  ON player_social_profiles (lower(display_name) text_pattern_ops)
  WHERE directory_visible = true AND social_eligible = true;

CREATE TABLE player_looking_intents (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  active boolean NOT NULL DEFAULT false,
  city_id uuid NULL REFERENCES cities (id),
  area_key text NULL
    CHECK (area_key IS NULL OR char_length(area_key) BETWEEN 1 AND 64),
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  expires_at timestamptz NULL,
  format_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_looking_intents_window_chk CHECK (
    active = false
    OR (
      city_id IS NOT NULL
      AND starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND expires_at IS NOT NULL
      AND starts_at < ends_at
      AND expires_at <= ends_at
    )
  )
);

CREATE INDEX player_looking_intents_active_idx
  ON player_looking_intents (city_id, expires_at)
  WHERE active = true;

CREATE TABLE social_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_low uuid NOT NULL REFERENCES users (id),
  user_high uuid NOT NULL REFERENCES users (id),
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_pairs_order_chk CHECK (user_low < user_high),
  CONSTRAINT social_pairs_users_uidx UNIQUE (user_low, user_high)
);

CREATE TABLE user_blocks (
  blocker_user_id uuid NOT NULL REFERENCES users (id),
  blocked_user_id uuid NOT NULL REFERENCES users (id),
  pair_id uuid NOT NULL REFERENCES social_pairs (id),
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_pk PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT user_blocks_no_self_chk CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX user_blocks_blocked_idx
  ON user_blocks (blocked_user_id, blocker_user_id);

CREATE INDEX user_blocks_pair_idx
  ON user_blocks (pair_id);

CREATE TABLE abuse_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  reporter_user_id uuid NOT NULL REFERENCES users (id),
  target_kind text NOT NULL
    CHECK (target_kind IN ('player')),
  target_user_id uuid NOT NULL REFERENCES users (id),
  target_public_player_id uuid NOT NULL,
  reason_code text NOT NULL
    CHECK (
      reason_code IN (
        'harassment',
        'spam',
        'fake_profile',
        'inappropriate',
        'other'
      )
    ),
  detail text NULL
    CHECK (detail IS NULL OR char_length(detail) BETWEEN 1 AND 1000),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'submitted'
    CHECK (state IN ('submitted', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abuse_reports_no_self_chk CHECK (reporter_user_id <> target_user_id)
);

CREATE INDEX abuse_reports_reporter_created_idx
  ON abuse_reports (reporter_user_id, created_at DESC);
