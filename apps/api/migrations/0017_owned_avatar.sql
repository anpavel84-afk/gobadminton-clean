-- Additive; shared social-profile version serializes avatar and text changes.
ALTER TABLE player_social_profiles ADD COLUMN avatar_key text UNIQUE
  CHECK (avatar_key IS NULL OR avatar_key ~ '^[a-f0-9]{64}\.png$');

-- Durable deletion journal survives profile/account deletion and process crashes.
CREATE TABLE avatar_media_gc (
  storage_key text PRIMARY KEY CHECK (storage_key ~ '^[a-f0-9]{64}\.png$'),
  not_before timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION queue_owned_avatar_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.avatar_key IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR OLD.avatar_key IS DISTINCT FROM NEW.avatar_key THEN
      INSERT INTO avatar_media_gc(storage_key) VALUES (OLD.avatar_key) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER owned_avatar_cleanup AFTER UPDATE OF avatar_key OR DELETE
  ON player_social_profiles FOR EACH ROW EXECUTE FUNCTION queue_owned_avatar_cleanup();

-- Product deletion remains disabled. Identity's deletion_pending transition
-- retires owned media immediately; explicit profile deletion also journals it.
CREATE FUNCTION retire_inactive_account_avatar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE player_social_profiles SET avatar_key = NULL, version = version + 1, updated_at = now()
      WHERE user_id = NEW.id AND avatar_key IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER inactive_account_avatar AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION retire_inactive_account_avatar();
