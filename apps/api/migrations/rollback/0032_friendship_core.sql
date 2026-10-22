-- Source-only recovery for an unused 0032 installation; caller owns BEGIN/COMMIT.
-- Stop Friends writers first. Populated ledgers require preserving 0032 and
-- rolling back application code with the feature OFF, not erasing history.
LOCK TABLE friendships, friendship_request_attempts, social_action_rate_buckets IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM friendships)
    OR EXISTS (SELECT 1 FROM friendship_request_attempts)
    OR EXISTS (SELECT 1 FROM social_action_rate_buckets) THEN
    RAISE EXCEPTION '0032 rollback refuses populated Friends tables' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER friendship_account_epoch_status_change ON users;
DROP TRIGGER friendship_profile_epoch_before_update ON player_social_profiles;
DROP TABLE friendship_request_attempts;
DROP TABLE friendships;
DROP TABLE social_action_rate_buckets;
DROP FUNCTION friendship_attempt_current_pending_guard();
DROP FUNCTION deny_friendship_attempt_rewrite();
DROP FUNCTION friendship_pair_membership_guard();
DROP FUNCTION friendship_account_status_fence();
DROP FUNCTION friendship_profile_epoch_fence();
ALTER TABLE player_social_profiles DROP COLUMN social_action_epoch;
DELETE FROM schema_migrations WHERE id='0032_friendship_core';
