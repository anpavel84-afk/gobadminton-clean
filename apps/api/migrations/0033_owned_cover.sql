-- Additive slot in the existing owned-media store and deletion journal.
ALTER TABLE player_social_profiles ADD COLUMN cover_key text UNIQUE
  CHECK (cover_key IS NULL OR cover_key ~ '^[a-f0-9]{64}\.png$');
ALTER TABLE player_social_profiles ADD COLUMN cover_moderation_approval_id uuid REFERENCES content_moderation_approvals(id);
ALTER TABLE player_social_profiles ADD CONSTRAINT cover_approval_requires_key
  CHECK ((cover_key IS NULL) = (cover_moderation_approval_id IS NULL));
ALTER TABLE content_moderation_approvals DROP CONSTRAINT content_moderation_approvals_surface_key_check;
ALTER TABLE content_moderation_approvals ADD CONSTRAINT content_moderation_approvals_surface_key_check
  CHECK (surface_key IN ('avatar_image','cover_image','profile_display_name','profile_bio','trainer_display_name','game_title','game_host_display_name','game_training_description','game_settlement_terms'));
CREATE FUNCTION queue_owned_cover_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cover_key IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR OLD.cover_key IS DISTINCT FROM NEW.cover_key THEN
      INSERT INTO avatar_media_gc(storage_key) VALUES (OLD.cover_key) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER owned_cover_cleanup AFTER UPDATE OF cover_key OR DELETE ON player_social_profiles
  FOR EACH ROW EXECUTE FUNCTION queue_owned_cover_cleanup();
CREATE FUNCTION retire_inactive_account_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE player_social_profiles SET cover_key=NULL, cover_moderation_approval_id=NULL,
      version=version+1, updated_at=now() WHERE user_id=NEW.id AND cover_key IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER inactive_account_cover AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION retire_inactive_account_cover();
