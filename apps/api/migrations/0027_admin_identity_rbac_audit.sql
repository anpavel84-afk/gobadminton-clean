-- A0a only: separate authority, sessions and append-only privileged audit.
CREATE TABLE admin_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending_mfa' CHECK (status IN ('pending_mfa','active','suspended','revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_role_grants (
  principal_id uuid NOT NULL REFERENCES admin_principals(id),
  role text NOT NULL CHECK (role IN ('superadmin','content_manager','moderator','support')),
  active boolean NOT NULL DEFAULT true,
  actor_id uuid REFERENCES admin_principals(id),
  reason_code text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, role)
);
CREATE TABLE admin_webauthn_credentials (
  credential_id text PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES admin_principals(id),
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count BETWEEN 0 AND 4294967295),
  transports jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_credentials_principal ON admin_webauthn_credentials(principal_id);
CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES admin_principals(id),
  credential_id text NOT NULL REFERENCES admin_webauthn_credentials(credential_id),
  audience text NOT NULL DEFAULT 'gobadminton-admin' CHECK (audience='gobadminton-admin'),
  token_hash text NOT NULL UNIQUE,
  csrf_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  step_up_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours',
  revoked_at timestamptz,
  CHECK (expires_at <= created_at + interval '8 hours')
);
CREATE INDEX admin_sessions_principal ON admin_sessions(principal_id) WHERE revoked_at IS NULL;
CREATE TABLE admin_auth_transactions (
  state_hash text PRIMARY KEY,
  provider_key text NOT NULL CHECK (provider_key IN ('vk','yandex')),
  binding_hash text NOT NULL,
  verifier_ciphertext text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  consumed_at timestamptz
);
CREATE TABLE admin_mfa_tickets (
  token_hash text PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES admin_principals(id),
  csrf_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  consumed_at timestamptz
);
CREATE TABLE admin_activation_tokens (
  principal_id uuid PRIMARY KEY REFERENCES admin_principals(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  consumed_at timestamptz
);
CREATE TABLE admin_webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES admin_principals(id),
  ticket_hash text REFERENCES admin_mfa_tickets(token_hash),
  session_id uuid REFERENCES admin_sessions(id),
  purpose text NOT NULL CHECK (purpose IN ('enroll','login','step_up')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  consumed_at timestamptz,
  CHECK ((purpose IN ('enroll','login') AND ticket_hash IS NOT NULL AND session_id IS NULL)
      OR (purpose='step_up' AND ticket_hash IS NULL AND session_id IS NOT NULL))
);
CREATE TABLE admin_bootstrap_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  operation_id uuid NOT NULL UNIQUE,
  principal_id uuid NOT NULL REFERENCES admin_principals(id),
  activation_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE privileged_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES admin_principals(id),
  system_actor text CHECK (system_actor IN ('system_bootstrap','break_glass')),
  session_id uuid REFERENCES admin_sessions(id),
  roles_snapshot jsonb NOT NULL,
  permission_key text NOT NULL,
  action_key text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason_code text NOT NULL,
  internal_note text CHECK (length(internal_note)<=500),
  case_id uuid,
  before_diff jsonb NOT NULL DEFAULT '{}',
  after_diff jsonb NOT NULL DEFAULT '{}',
  request_id uuid NOT NULL,
  idempotency_hash text,
  reversal_of uuid REFERENCES privileged_audit_events(id),
  retention_class text NOT NULL DEFAULT 'admin_security',
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_id IS NOT NULL AND system_actor IS NULL) OR (actor_id IS NULL AND system_actor IS NOT NULL))
);
CREATE INDEX privileged_audit_target_time ON privileged_audit_events(target_type,target_id,created_at DESC);
CREATE INDEX privileged_audit_actor_time ON privileged_audit_events(actor_id,created_at DESC);
CREATE FUNCTION reject_privileged_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'privileged audit is append-only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER privileged_audit_immutable BEFORE UPDATE OR DELETE ON privileged_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_privileged_audit_mutation();
CREATE TRIGGER privileged_audit_no_truncate BEFORE TRUNCATE ON privileged_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_privileged_audit_mutation();
CREATE TABLE admin_command_receipts (
  actor_id uuid NOT NULL REFERENCES admin_principals(id),
  key_hash text NOT NULL,
  fingerprint text NOT NULL,
  response_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,key_hash)
);
-- Direct grant/credential changes cannot race the principal fence unnoticed.
CREATE FUNCTION fence_admin_authority_child() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM admin_principals WHERE id=COALESCE(NEW.principal_id,OLD.principal_id) FOR UPDATE;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER admin_grant_parent_fence BEFORE INSERT OR UPDATE OR DELETE ON admin_role_grants
  FOR EACH ROW EXECUTE FUNCTION fence_admin_authority_child();
CREATE TRIGGER admin_credential_parent_fence BEFORE INSERT OR UPDATE OR DELETE ON admin_webauthn_credentials
  FOR EACH ROW EXECUTE FUNCTION fence_admin_authority_child();
CREATE TABLE admin_rate_windows (
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK(attempts>0),
  PRIMARY KEY(key_hash,window_start)
);
