-- Internal simulation only. Expiry is evaluated using database time, without a worker.
CREATE TABLE user_restriction_state (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE user_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  capability text NOT NULL CHECK(capability IN ('account.access','game.create','participation.request','profile.public','social.directory','social.radar','social.dm_send','social.game_chat_send')),
  reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK(expires_at > starts_at),
  created_by uuid NOT NULL REFERENCES admin_principals(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES admin_principals(id),
  revoke_reason_code text CHECK(revoke_reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason_code IS NULL) OR
        (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason_code IS NOT NULL))
);
CREATE INDEX user_restrictions_effective ON user_restrictions(user_id,capability,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE user_restriction_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  restriction_id uuid REFERENCES user_restrictions(id),
  user_version integer NOT NULL CHECK(user_version > 1),
  audit_id uuid NOT NULL UNIQUE REFERENCES privileged_audit_events(id),
  action text NOT NULL CHECK(action IN ('restrict','revoke_restriction','revoke_consumer_sessions')),
  reason_code text NOT NULL CHECK(reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(user_id,user_version)
);
CREATE FUNCTION guard_user_restriction_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'restriction ledger is append-only'; END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.capability <> OLD.capability
    OR NEW.reason_code <> OLD.reason_code OR NEW.starts_at <> OLD.starts_at OR NEW.expires_at <> OLD.expires_at
    OR NEW.created_by <> OLD.created_by OR NEW.revoked_at IS NULL OR NEW.version <> OLD.version+1 THEN
    RAISE EXCEPTION 'restriction ledger permits one explicit reversal only';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_restrictions_guard BEFORE UPDATE OR DELETE ON user_restrictions FOR EACH ROW EXECUTE FUNCTION guard_user_restriction_ledger();
CREATE TRIGGER user_restrictions_no_truncate BEFORE TRUNCATE ON user_restrictions FOR EACH STATEMENT EXECUTE FUNCTION guard_user_restriction_ledger();
CREATE FUNCTION reject_user_restriction_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'restriction history is append-only'; END $$;
CREATE TRIGGER user_restriction_history_guard BEFORE UPDATE OR DELETE ON user_restriction_actions FOR EACH ROW EXECUTE FUNCTION reject_user_restriction_history_mutation();
CREATE TRIGGER user_restriction_history_no_truncate BEFORE TRUNCATE ON user_restriction_actions FOR EACH STATEMENT EXECUTE FUNCTION reject_user_restriction_history_mutation();
