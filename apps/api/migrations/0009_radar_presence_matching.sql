-- LS-R1: ephemeral coarse RadarPresence + durable rate budgets.
-- Additive only. Preserves 0001–0008. No DM/invite/contact tables.
-- Presence is UNLOGGED (ephemeral; not durable history). Budgets remain logged.

CREATE UNLOGGED TABLE radar_presences (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  activation_id uuid NOT NULL,
  owner_session_id uuid NOT NULL REFERENCES app_sessions (id),
  version bigint NOT NULL
    CHECK (version >= 1),
  policy_version text NOT NULL
    CHECK (char_length(policy_version) BETWEEN 1 AND 64),
  region_id text NOT NULL
    CHECK (char_length(region_id) BETWEEN 1 AND 64),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  hard_expires_at timestamptz NOT NULL,
  foreground_until timestamptz NOT NULL,
  location_valid_until timestamptz NOT NULL,
  next_location_update_at timestamptz NOT NULL,
  next_radius_change_at timestamptz NOT NULL,
  radius_changes_window_started_at timestamptz NOT NULL,
  radius_changes_in_window integer NOT NULL DEFAULT 0
    CHECK (radius_changes_in_window >= 0),
  cell_i integer NOT NULL,
  cell_j integer NOT NULL,
  coarse_center geography(Point, 4326) NOT NULL,
  radius_bucket_km integer NOT NULL
    CHECK (radius_bucket_km IN (3, 5, 10)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_presences_activation_uidx UNIQUE (activation_id),
  CONSTRAINT radar_presences_ttl_chk CHECK (
    expires_at > started_at
    AND expires_at <= hard_expires_at
    AND hard_expires_at > started_at
  )
);

CREATE INDEX radar_presences_coarse_center_gix
  ON radar_presences USING GIST (coarse_center);

CREATE INDEX radar_presences_expires_idx
  ON radar_presences (expires_at);

-- Durable counters survive stop/start/takeover. No coordinates stored.
CREATE TABLE radar_rate_budgets (
  user_id uuid NOT NULL REFERENCES users (id),
  bucket text NOT NULL
    CHECK (char_length(bucket) BETWEEN 1 AND 64),
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
    CHECK (count >= 0),
  next_allowed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_rate_budgets_pk PRIMARY KEY (user_id, bucket)
);

CREATE INDEX radar_rate_budgets_updated_idx
  ON radar_rate_budgets (updated_at);
