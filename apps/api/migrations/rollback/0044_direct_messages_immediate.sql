-- Source-compatible rollback for 0044. Restores contact_policy DB default and the pre-0044
-- friendship_profile_epoch_fence (including contact_policy requests→closed epoch bump) for
-- future operations only. Do NOT demote accepted conversations or new immediate-DM message
-- history, and do not rewrite existing relationship/message rows or epochs.
-- Historical pending→accepted conversion is intentionally irreversible here;
-- approved full recovery uses the existing pre-migration backup, not a blind demote.
-- Old app builds remain compatible with accepted + NULL request_expires_at rows.

ALTER TABLE player_social_profiles
  ALTER COLUMN contact_policy SET DEFAULT 'closed';

CREATE OR REPLACE FUNCTION friendship_profile_epoch_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.directory_visible AND NOT NEW.directory_visible)
    OR (OLD.contact_policy = 'requests' AND NEW.contact_policy = 'closed')
    OR (OLD.social_eligible AND NOT NEW.social_eligible)
  THEN
    NEW.social_action_epoch = OLD.social_action_epoch + 1;
  ELSIF NEW.social_action_epoch < OLD.social_action_epoch THEN
    RAISE EXCEPTION 'social epoch may not decrease' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DELETE FROM schema_migrations WHERE id = '0044_direct_messages_immediate';
