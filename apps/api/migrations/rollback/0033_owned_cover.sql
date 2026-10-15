-- Unused-installation rollback only; caller owns transaction and stops writers.
-- Populated media/approvals must be retained with additive schema on source rollback.
LOCK TABLE player_social_profiles, content_moderation_approvals IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM player_social_profiles WHERE cover_key IS NOT NULL)
     OR EXISTS (SELECT 1 FROM content_moderation_approvals WHERE surface_key='cover_image') THEN
    RAISE EXCEPTION '0033 rollback refuses populated cover state' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER inactive_account_cover ON users;
DROP FUNCTION retire_inactive_account_cover();
DROP TRIGGER owned_cover_cleanup ON player_social_profiles;
DROP FUNCTION queue_owned_cover_cleanup();
ALTER TABLE player_social_profiles DROP CONSTRAINT cover_approval_requires_key;
ALTER TABLE player_social_profiles DROP COLUMN cover_moderation_approval_id, DROP COLUMN cover_key;
ALTER TABLE content_moderation_approvals DROP CONSTRAINT content_moderation_approvals_surface_key_check;
ALTER TABLE content_moderation_approvals ADD CONSTRAINT content_moderation_approvals_surface_key_check
  CHECK (surface_key IN ('avatar_image','profile_display_name','profile_bio','trainer_display_name','game_title','game_host_display_name','game_training_description','game_settlement_terms'));
DELETE FROM schema_migrations WHERE id='0033_owned_cover';
