-- #456 PWA Web Push: account preference + session-bound device subscriptions +
-- delivery claims + durable new-message intents (PgBoss enqueue may fail without
-- rolling back the message). Additive only. Preference defaults OFF.
-- Sensitive endpoint/keys stored sealed (auth AES-GCM). No CHECK(TRUE). Does not rewrite 0054.

CREATE TABLE web_push_preferences (
  user_id uuid PRIMARY KEY REFERENCES users (id),
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1
    CHECK (version BETWEEN 1 AND 2147483647),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  session_id uuid NOT NULL REFERENCES app_sessions (id),
  endpoint_hash text NOT NULL
    CHECK (char_length(endpoint_hash) = 64),
  endpoint_sealed text NOT NULL
    CHECK (char_length(endpoint_sealed) BETWEEN 32 AND 4096),
  p256dh_sealed text NOT NULL
    CHECK (char_length(p256dh_sealed) BETWEEN 32 AND 2048),
  auth_sealed text NOT NULL
    CHECK (char_length(auth_sealed) BETWEEN 32 AND 2048),
  endpoint_host text NOT NULL
    CHECK (char_length(endpoint_host) BETWEEN 1 AND 253),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  unbound_at timestamptz NULL,
  CONSTRAINT web_push_subscriptions_endpoint_hash_uidx UNIQUE (endpoint_hash)
);

CREATE INDEX web_push_subscriptions_user_active_idx
  ON web_push_subscriptions (user_id)
  WHERE unbound_at IS NULL;

CREATE INDEX web_push_subscriptions_session_active_idx
  ON web_push_subscriptions (session_id)
  WHERE unbound_at IS NULL;

-- Per-device delivery claim/dedupe. References only; never stores message body or keys.
CREATE TABLE web_push_delivery_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  message_id uuid NOT NULL REFERENCES messages (id),
  subscription_id uuid NOT NULL REFERENCES web_push_subscriptions (id),
  recipient_user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL
    CHECK (kind IN ('dm_message', 'game_chat_message')),
  status text NOT NULL
    CHECK (status IN ('claimed', 'sent', 'skipped', 'gone', 'failed', 'unknown')),
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT web_push_delivery_claims_msg_sub_uidx UNIQUE (message_id, subscription_id)
);

CREATE INDEX web_push_delivery_claims_recipient_idx
  ON web_push_delivery_claims (recipient_user_id, created_at DESC);

-- Durable new-message push intent. Survives PgBoss/queue outage inside the message TX.
-- Not a historical business-outbox replay table; only new intents from enabled push path.
CREATE TABLE web_push_delivery_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  message_id uuid NOT NULL REFERENCES messages (id),
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  recipient_user_id uuid NOT NULL REFERENCES users (id),
  author_user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL
    CHECK (kind IN ('dm_message', 'game_chat_message')),
  game_id uuid NULL REFERENCES games (id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'consumed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT web_push_delivery_intents_msg_recipient_uidx
    UNIQUE (message_id, recipient_user_id),
  CONSTRAINT web_push_delivery_intents_game_kind_chk
    CHECK (
      (kind = 'dm_message' AND game_id IS NULL)
      OR (kind = 'game_chat_message' AND game_id IS NOT NULL)
    )
);

CREATE INDEX web_push_delivery_intents_pending_idx
  ON web_push_delivery_intents (created_at ASC)
  WHERE status = 'pending';
