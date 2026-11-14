-- Additive, feature-off by default. No browser credentials or replay history removed.
ALTER TABLE app_sessions DROP CONSTRAINT app_sessions_audience_check;
ALTER TABLE app_sessions ALTER COLUMN session_hash DROP NOT NULL;
ALTER TABLE app_sessions ALTER COLUMN csrf_ciphertext DROP NOT NULL;
ALTER TABLE app_sessions ADD CONSTRAINT app_sessions_transport_check CHECK (
  (audience = 'consumer_browser' AND session_hash IS NOT NULL AND csrf_ciphertext IS NOT NULL)
  OR (audience = 'consumer_native' AND session_hash IS NULL AND csrf_ciphertext IS NULL)
);
CREATE TABLE native_auth_transactions (
  id_hash text PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  challenge text NOT NULL CHECK (length(challenge)=43),
  callback_state text NOT NULL CHECK (length(callback_state) BETWEEN 16 AND 128),
  return_path text NOT NULL CHECK (length(return_path)<=512),
  binding_hash text,
  user_id uuid REFERENCES users(id),
  browser_session_id uuid REFERENCES app_sessions(id),
  code_hash text UNIQUE,
  code_expires_at timestamptz,
  completed_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_auth_transactions_expiry ON native_auth_transactions(expires_at);
CREATE TABLE native_refresh_families (
  session_id uuid PRIMARY KEY REFERENCES app_sessions(id),
  client_id text NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE native_refresh_tokens (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES native_refresh_families(session_id),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_refresh_tokens_session ON native_refresh_tokens(session_id);
CREATE TABLE native_access_tokens (
  token_hash text PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES native_refresh_families(session_id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX native_access_tokens_session ON native_access_tokens(session_id);
-- Fixed-window counters: hashed IP/client/operation, expired buckets pruned on use.
CREATE TABLE native_auth_budgets (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts>0),
  expires_at timestamptz NOT NULL
);
