-- Source-only recovery for an unused 0043 installation; caller owns BEGIN/COMMIT.
-- Stop play-interest writers first. Populated rows refuse destructive rollback.
LOCK TABLE play_interests, social_action_rate_buckets, user_blocks, social_pairs IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM play_interests) THEN
    RAISE EXCEPTION '0043 rollback refuses populated play_interests' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TRIGGER IF EXISTS play_interest_on_block ON user_blocks;
DROP TRIGGER IF EXISTS play_interests_pair_guard ON play_interests;
DROP FUNCTION IF EXISTS play_interest_block_invalidate();
DROP FUNCTION IF EXISTS play_interest_pair_membership_guard();
DROP TABLE play_interests;
ALTER TABLE social_action_rate_buckets
  DROP CONSTRAINT IF EXISTS social_action_rate_buckets_bucket_check;
ALTER TABLE social_action_rate_buckets
  ADD CONSTRAINT social_action_rate_buckets_bucket_check
  CHECK (bucket IN ('friend.send', 'friend.receive', 'game.recommend'));
DELETE FROM schema_migrations WHERE id = '0043_play_interests';
