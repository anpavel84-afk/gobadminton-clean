-- Empty additive account-owned preference. Never backfill from games/providers.
CREATE TABLE user_game_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_public_game_contact text NULL CHECK (
    default_public_game_contact IS NULL OR
    (char_length(default_public_game_contact) BETWEEN 1 AND 320 AND
     default_public_game_contact = btrim(default_public_game_contact))
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Identity's existing deletion_pending transition is the deletion fence.
-- Keep the version tombstone so reactivation cannot replay expectedVersion=0.
CREATE FUNCTION clear_deleted_account_game_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'deletion_pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE user_game_preferences SET default_public_game_contact = NULL,
      version = version + 1, updated_at = now() WHERE user_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER deleted_account_game_contact AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION clear_deleted_account_game_contact();
