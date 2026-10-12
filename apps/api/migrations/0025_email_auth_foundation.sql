-- E1: additive verified consumer credentials; OAuth metadata is never imported.
ALTER TABLE app_sessions ADD COLUMN authenticated_at timestamptz;
UPDATE app_sessions SET authenticated_at = created_at;
ALTER TABLE app_sessions ALTER COLUMN authenticated_at SET DEFAULT now();
ALTER TABLE app_sessions ALTER COLUMN authenticated_at SET NOT NULL;

CREATE TABLE email_auth_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  email_canonical text NOT NULL,
  email_display text NOT NULL,
  normalization_version integer NOT NULL DEFAULT 1 CHECK (normalization_version = 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX email_auth_active_email_uidx ON email_auth_methods(email_canonical) WHERE status = 'active';
CREATE UNIQUE INDEX email_auth_active_user_uidx ON email_auth_methods(user_id) WHERE status = 'active';

CREATE TABLE email_auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('login_signup','link')),
  email_canonical text NOT NULL,
  email_display text NOT NULL,
  origin text NOT NULL,
  browser_binding_hash text,
  bound_user_id uuid REFERENCES users(id),
  bound_session_id uuid REFERENCES app_sessions(id),
  return_path text NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  code_hash text NOT NULL,
  code_ciphertext text,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sent','delivery_failed','consumed','superseded','locked','expired')),
  verify_attempts integer NOT NULL DEFAULT 0 CHECK (verify_attempts BETWEEN 0 AND 5),
  send_count integer NOT NULL DEFAULT 1 CHECK (send_count > 0),
  expires_at timestamptz NOT NULL,
  resend_after timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose = 'login_signup' AND browser_binding_hash IS NOT NULL AND bound_user_id IS NULL AND bound_session_id IS NULL)
    OR (purpose = 'link' AND browser_binding_hash IS NULL AND bound_user_id IS NOT NULL AND bound_session_id IS NOT NULL)),
  CHECK (state NOT IN ('consumed','superseded','locked','expired','delivery_failed') OR code_ciphertext IS NULL)
);
CREATE INDEX email_auth_challenge_expiry_idx ON email_auth_challenges(expires_at);
CREATE INDEX email_auth_challenge_binding_idx ON email_auth_challenges(browser_binding_hash,email_canonical,purpose);
CREATE INDEX email_auth_challenge_session_idx ON email_auth_challenges(bound_session_id);

CREATE TABLE email_auth_delivery_attempts (
  challenge_id uuid NOT NULL REFERENCES email_auth_challenges(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  attempt_no integer NOT NULL,
  state text NOT NULL CHECK (state IN ('sent','temporary_failure','permanent_failure')),
  provider_message_id text,
  error_class text CHECK (error_class IN ('temporary','permanent','ciphertext_invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id,generation,attempt_no)
);
CREATE TABLE email_auth_rate_buckets (
  key_hash text NOT NULL,
  bucket_kind text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_hash,bucket_kind,window_start)
);
CREATE INDEX email_auth_rate_expiry_idx ON email_auth_rate_buckets(expires_at);
