-- Private explicit choice only. No backfill from profile, Radar, hint or providers.
CREATE TABLE user_discovery_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city_id uuid NULL REFERENCES cities(id) CHECK (city_id IN (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002'
  )),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Identity's existing user fence serializes deletion with writes/replays.
-- Clear the value but keep a version tombstone if deletion is later cancelled.
-- Receipts contain the private choice too: remove only this operation's receipts.
CREATE FUNCTION clear_deleted_account_discovery_preference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM idempotency_records WHERE actor_id = OLD.id AND operation = 'discovery_preference.put';
  ELSIF NEW.status = 'deletion_pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE user_discovery_preferences SET city_id = NULL,
      version = LEAST(version::bigint + 1, 2147483647)::integer, updated_at = now()
      WHERE user_id = NEW.id;
    DELETE FROM idempotency_records WHERE actor_id = NEW.id AND operation = 'discovery_preference.put';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER deleted_account_discovery_preference AFTER UPDATE OF status OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION clear_deleted_account_discovery_preference();
