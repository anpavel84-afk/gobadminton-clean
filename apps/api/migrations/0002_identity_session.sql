-- F-02 identity + browser session foundation.
-- Internal User UUID is provider-independent. Email/phone are not identity keys.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'deletion_pending')),
  locale text NOT NULL DEFAULT 'ru',
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deletion_requested_at timestamptz NULL
);

CREATE TABLE external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  provider_key text NOT NULL
    CHECK (provider_key IN ('vk', 'yandex')),
  issuer_namespace text NOT NULL,
  subject text NOT NULL,
  email text NULL,
  display_name text NULL,
  avatar_url text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identities_namespace_subject_uidx
    UNIQUE (issuer_namespace, subject)
);

CREATE INDEX external_identities_user_id_idx
  ON external_identities (user_id);

CREATE TABLE auth_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  state_hash text NOT NULL UNIQUE,
  provider_key text NOT NULL
    CHECK (provider_key IN ('vk', 'yandex')),
  client_audience text NOT NULL DEFAULT 'browser'
    CHECK (client_audience IN ('browser')),
  redirect_uri text NOT NULL,
  return_path text NOT NULL,
  binding_hash text NOT NULL,
  pkce_verifier_ciphertext text NOT NULL,
  pkce_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_transactions_expires_idx
  ON auth_transactions (expires_at);

CREATE TABLE app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  audience text NOT NULL DEFAULT 'consumer_browser'
    CHECK (audience IN ('consumer_browser')),
  session_hash text NOT NULL UNIQUE,
  csrf_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_sessions_user_id_idx
  ON app_sessions (user_id);

CREATE INDEX app_sessions_active_expiry_idx
  ON app_sessions (expires_at)
  WHERE revoked_at IS NULL;
