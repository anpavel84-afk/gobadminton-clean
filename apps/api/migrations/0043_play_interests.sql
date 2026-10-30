-- #404 mutual play-interest product slice. Additive; independent of friendships.
-- Unilateral inbound interest is private; mutual only when both current intents are live.
-- Reuses social_pairs lock order and player_social_profiles.social_action_epoch fencing.

CREATE TABLE play_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES social_pairs(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  peer_user_id uuid NOT NULL REFERENCES users(id),
  interest_id uuid NOT NULL UNIQUE,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation >= 1),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  state text NOT NULL CHECK (state IN ('active', 'withdrawn')),
  actor_epoch bigint NOT NULL CHECK (actor_epoch >= 1),
  peer_epoch bigint NOT NULL CHECK (peer_epoch >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT play_interests_not_self CHECK (actor_user_id <> peer_user_id),
  CONSTRAINT play_interests_direction_uidx UNIQUE (pair_id, actor_user_id)
);

CREATE INDEX play_interests_actor_active_idx
  ON play_interests (actor_user_id, updated_at DESC, interest_id)
  WHERE state = 'active';
CREATE INDEX play_interests_peer_active_idx
  ON play_interests (peer_user_id, updated_at DESC, interest_id)
  WHERE state = 'active';
CREATE INDEX play_interests_pair_idx ON play_interests (pair_id);

-- Bounded send bucket reuses the existing rate primitive.
ALTER TABLE social_action_rate_buckets
  DROP CONSTRAINT IF EXISTS social_action_rate_buckets_bucket_check;
ALTER TABLE social_action_rate_buckets
  ADD CONSTRAINT social_action_rate_buckets_bucket_check
  CHECK (bucket IN ('friend.send', 'friend.receive', 'game.recommend', 'play.interest.send'));

CREATE FUNCTION play_interest_pair_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pair_low uuid;
  pair_high uuid;
BEGIN
  SELECT user_low, user_high INTO pair_low, pair_high FROM social_pairs
    WHERE id = NEW.pair_id FOR KEY SHARE;
  IF NOT FOUND
    OR LEAST(NEW.actor_user_id, NEW.peer_user_id) IS DISTINCT FROM pair_low
    OR GREATEST(NEW.actor_user_id, NEW.peer_user_id) IS DISTINCT FROM pair_high THEN
    RAISE EXCEPTION 'play interest endpoints do not match social pair' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.pair_id <> OLD.pair_id
      OR NEW.actor_user_id <> OLD.actor_user_id
      OR NEW.peer_user_id <> OLD.peer_user_id
      OR NEW.version <> OLD.version + 1
      OR NEW.generation < OLD.generation
      OR (NEW.generation > OLD.generation AND NEW.generation <> OLD.generation + 1)
      OR (NEW.generation = OLD.generation AND NEW.interest_id <> OLD.interest_id)
    THEN
      RAISE EXCEPTION 'stale or invalid play interest generation/version' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'play interest creation requires read committed' USING ERRCODE = '25001';
    ELSIF NEW.interest_id IS DISTINCT FROM OLD.interest_id THEN
      RAISE EXCEPTION 'play interest identity rotation requires read committed' USING ERRCODE = '25001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER play_interests_pair_guard BEFORE INSERT OR UPDATE ON play_interests
  FOR EACH ROW EXECUTE FUNCTION play_interest_pair_membership_guard();

-- Block writers already lock the pair; withdraw live intents so unblock cannot resurrect them.
CREATE FUNCTION play_interest_block_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE play_interests
    SET state = 'withdrawn',
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE pair_id = NEW.pair_id AND state = 'active';
  UPDATE social_pairs
    SET version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = NEW.pair_id;
  RETURN NEW;
END $$;
CREATE TRIGGER play_interest_on_block AFTER INSERT ON user_blocks
  FOR EACH ROW EXECUTE FUNCTION play_interest_block_invalidate();
