-- F-03 organizer / venue / game + discovery foundation.
-- Preserves F-01/F-02 tables. No participations (F-04).

CREATE TABLE organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  kind text NOT NULL DEFAULT 'personal'
    CHECK (kind IN ('personal')),
  display_name text NOT NULL
    CHECK (char_length(display_name) BETWEEN 1 AND 160),
  public_contact text NOT NULL
    CHECK (char_length(public_contact) BETWEEN 1 AND 320),
  onboarding_status text NOT NULL DEFAULT 'active'
    CHECK (onboarding_status IN ('active', 'suspended')),
  created_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX organizers_created_by_user_id_idx
  ON organizers (created_by_user_id);

CREATE TABLE organizer_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organizer_id uuid NOT NULL REFERENCES organizers (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL
    CHECK (role IN ('owner', 'manager')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  CONSTRAINT organizer_memberships_organizer_user_uidx
    UNIQUE (organizer_id, user_id)
);

CREATE INDEX organizer_memberships_user_active_idx
  ON organizer_memberships (user_id)
  WHERE status = 'active';

CREATE TABLE cities (
  id uuid PRIMARY KEY NOT NULL,
  country_code text NOT NULL
    CHECK (char_length(country_code) = 2),
  name_ru text NOT NULL
    CHECK (char_length(name_ru) BETWEEN 1 AND 120),
  name_en text NOT NULL
    CHECK (char_length(name_en) BETWEEN 1 AND 120),
  default_timezone text NOT NULL
    CHECK (char_length(default_timezone) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Moscow pilot catalog seed (stable UUID for tests and fixtures).
INSERT INTO cities (id, country_code, name_ru, name_en, default_timezone)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'RU',
  'Москва',
  'Moscow',
  'Europe/Moscow'
);

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  city_id uuid NOT NULL REFERENCES cities (id),
  name text NOT NULL
    CHECK (char_length(name) BETWEEN 1 AND 160),
  address text NOT NULL
    CHECK (char_length(address) BETWEEN 1 AND 500),
  timezone text NOT NULL
    CHECK (char_length(timezone) BETWEEN 1 AND 64),
  location geography(Point, 4326) NOT NULL,
  data_status text NOT NULL DEFAULT 'verified'
    CHECK (data_status IN ('verified', 'unverified', 'stale')),
  provenance text NOT NULL DEFAULT 'organizer_submitted'
    CHECK (provenance IN ('organizer_submitted', 'operator_seeded')),
  created_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venues_city_id_idx ON venues (city_id);
CREATE INDEX venues_location_gix ON venues USING GIST (location);

CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  organizer_id uuid NOT NULL REFERENCES organizers (id),
  venue_id uuid NOT NULL REFERENCES venues (id),
  title text NOT NULL
    CHECK (char_length(title) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  visibility text NOT NULL
    CHECK (visibility IN ('public', 'unlisted')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL
    CHECK (char_length(timezone) BETWEEN 1 AND 64),
  application_deadline_at timestamptz NOT NULL,
  capacity integer NOT NULL
    CHECK (capacity > 0 AND capacity <= 1000),
  external_reserved_count integer NOT NULL DEFAULT 0
    CHECK (external_reserved_count >= 0 AND external_reserved_count <= 1000),
  format_key text NOT NULL
    CHECK (char_length(format_key) BETWEEN 1 AND 64),
  level_scale_id text NOT NULL
    CHECK (char_length(level_scale_id) BETWEEN 1 AND 64),
  level_scale_version integer NOT NULL
    CHECK (level_scale_version >= 1),
  allowed_level_ids jsonb NOT NULL,
  settlement_mode text NOT NULL
    CHECK (settlement_mode IN ('external')),
  price_minor bigint NULL
    CHECK (price_minor IS NULL OR price_minor >= 0),
  currency text NULL
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  settlement_terms text NOT NULL
    CHECK (char_length(settlement_terms) BETWEEN 1 AND 2000),
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  cancel_reason text NULL
    CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 1 AND 1000),
  created_by_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  CONSTRAINT games_time_order_chk CHECK (starts_at < ends_at),
  CONSTRAINT games_deadline_chk CHECK (application_deadline_at <= starts_at),
  CONSTRAINT games_external_capacity_chk CHECK (external_reserved_count <= capacity),
  CONSTRAINT games_currency_when_price_chk CHECK (
    (price_minor IS NULL AND currency IS NULL)
    OR (price_minor IS NOT NULL AND currency IS NOT NULL)
  )
);

CREATE INDEX games_venue_starts_id_idx
  ON games (venue_id, starts_at, id);
CREATE INDEX games_organizer_starts_id_idx
  ON games (organizer_id, starts_at, id);
CREATE INDEX games_discovery_public_idx
  ON games (starts_at, id)
  WHERE status = 'published' AND visibility = 'public';

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  type text NOT NULL
    CHECK (char_length(type) BETWEEN 1 AND 128),
  event_version integer NOT NULL DEFAULT 1
    CHECK (event_version >= 1),
  aggregate_type text NOT NULL
    CHECK (char_length(aggregate_type) BETWEEN 1 AND 64),
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL
    CHECK (aggregate_version >= 1),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  lease_until timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_events_pending_idx
  ON outbox_events (next_attempt_at)
  WHERE delivered_at IS NULL;

CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  actor_id uuid NOT NULL,
  operation text NOT NULL
    CHECK (char_length(operation) BETWEEN 1 AND 128),
  key_hash text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL
    CHECK (status_code BETWEEN 100 AND 599),
  response_body jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_records_actor_op_key_uidx
    UNIQUE (actor_id, operation, key_hash)
);

CREATE INDEX idempotency_records_expires_idx
  ON idempotency_records (expires_at);
