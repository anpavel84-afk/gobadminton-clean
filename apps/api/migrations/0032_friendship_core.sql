-- GB-048..053: additive Friends S1 source schema. OFF until API/QA and Owner gates.
-- No relation is inferred from GameInvitation, DM, Radar or existing contacts.
-- Supports one current pair relation, immutable request attempt identities,
-- epoch fences, bounded action buckets and truthful replay after cancellation.
ALTER TABLE player_social_profiles
  ADD COLUMN social_action_epoch bigint NOT NULL DEFAULT 1
  CHECK (social_action_epoch >= 1);

CREATE TABLE friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL UNIQUE REFERENCES social_pairs(id),
  requester_user_id uuid NOT NULL REFERENCES users(id),
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL UNIQUE,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation >= 1),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  state text NOT NULL CHECK (state IN (
    'pending', 'accepted', 'declined', 'cancelled', 'removed', 'blocked', 'expired'
  )),
  requester_epoch bigint NOT NULL CHECK (requester_epoch >= 1),
  recipient_epoch bigint NOT NULL CHECK (recipient_epoch >= 1),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  accepted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT friendships_not_self CHECK (requester_user_id <> recipient_user_id),
  CONSTRAINT friendships_pending_expiry CHECK (
    (state = 'pending' AND expires_at IS NOT NULL AND expires_at > requested_at AND accepted_at IS NULL)
    OR (state = 'accepted' AND accepted_at IS NOT NULL AND expires_at IS NULL)
    OR (state NOT IN ('pending','accepted') AND accepted_at IS NULL)
  )
);

-- Immutable identities let stale request IDs fail even after a new attempt.
CREATE TABLE friendship_request_attempts (
  request_id uuid PRIMARY KEY,
  friendship_id uuid NOT NULL REFERENCES friendships(id),
  generation bigint NOT NULL CHECK (generation >= 1),
  requester_user_id uuid NOT NULL REFERENCES users(id),
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > requested_at),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (friendship_id, generation)
);
CREATE INDEX friendships_incoming_pending_idx
  ON friendships (recipient_user_id, requested_at DESC, request_id)
  WHERE state = 'pending';
CREATE INDEX friendships_outgoing_pending_idx
  ON friendships (requester_user_id, requested_at DESC, request_id)
  WHERE state = 'pending';
CREATE INDEX friendships_requester_accepted_idx
  ON friendships (requester_user_id, accepted_at DESC, id)
  WHERE state = 'accepted';
CREATE INDEX friendships_recipient_accepted_idx
  ON friendships (recipient_user_id, accepted_at DESC, id)
  WHERE state = 'accepted';
CREATE INDEX friendships_updated_idx ON friendships (updated_at, id);

CREATE TABLE social_action_rate_buckets (
  user_id uuid NOT NULL REFERENCES users(id),
  bucket text NOT NULL CHECK (bucket IN ('friend.send', 'friend.receive', 'game.recommend')),
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at timestamptz NOT NULL CHECK (expires_at > window_start),
  PRIMARY KEY (user_id, bucket, window_start)
);
CREATE INDEX social_action_rate_buckets_cleanup_idx
  ON social_action_rate_buckets (expires_at);

-- Direct SQL cannot link a friendship record to a pair belonging to others.
CREATE FUNCTION friendship_pair_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pair_low uuid;
  pair_high uuid;
BEGIN
  SELECT user_low,user_high INTO pair_low,pair_high FROM social_pairs
    WHERE id = NEW.pair_id FOR KEY SHARE;
  IF NOT FOUND OR LEAST(NEW.requester_user_id,NEW.recipient_user_id) IS DISTINCT FROM pair_low
    OR GREATEST(NEW.requester_user_id,NEW.recipient_user_id) IS DISTINCT FROM pair_high THEN
    RAISE EXCEPTION 'friendship endpoints do not match social pair' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.pair_id <> OLD.pair_id
      OR NEW.version <> OLD.version + 1
      OR NEW.generation < OLD.generation
      OR (NEW.generation > OLD.generation AND NEW.generation <> OLD.generation + 1)
      OR (NEW.generation = OLD.generation AND NEW.request_id <> OLD.request_id)
    THEN
      RAISE EXCEPTION 'stale or invalid friendship generation/version' USING ERRCODE='23514';
    END IF;
  END IF;
  -- Snapshot transactions can miss an already committed retired request ID.
  -- Request identity creation/rotation is supported only under READ COMMITTED;
  -- ordinary same-request version/state CAS remains allowed at higher isolation.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'friendship request creation requires read committed'
        USING ERRCODE = '25001';
    ELSIF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
      RAISE EXCEPTION 'friendship request rotation requires read committed'
        USING ERRCODE = '25001';
    END IF;
  END IF;
  -- Historical request identities cannot become current again. INSERT has no OLD.
  IF TG_OP = 'INSERT' THEN
    -- Serialize identity allocation before history lookup, including an ID
    -- currently uncommitted in a transaction that later rotates it.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.request_id::text, 217));
    IF EXISTS (SELECT 1 FROM friendship_request_attempts WHERE request_id = NEW.request_id) THEN
      RAISE EXCEPTION 'friendship request identity already used' USING ERRCODE='23505';
    END IF;
  ELSIF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    -- Serialize identity allocation before history lookup, including an ID
    -- currently uncommitted in a transaction that later rotates it.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.request_id::text, 217));
    IF EXISTS (SELECT 1 FROM friendship_request_attempts WHERE request_id = NEW.request_id) THEN
      RAISE EXCEPTION 'friendship request identity already used' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER friendships_pair_guard BEFORE INSERT OR UPDATE ON friendships
  FOR EACH ROW EXECUTE FUNCTION friendship_pair_membership_guard();

-- Epoch bump runs in the writer's existing profile row lock.
-- Do not scan Friendships from profile mutation (Pair lock inversion).
CREATE FUNCTION friendship_profile_epoch_fence() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER friendship_profile_epoch_before_update
  BEFORE UPDATE ON player_social_profiles FOR EACH ROW
  EXECUTE FUNCTION friendship_profile_epoch_fence();

-- Account deactivate/erase invalidates later requests without globally scanning
-- the pair graph. Existing account lock → own profile row is already supported.
CREATE FUNCTION friendship_account_status_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('disabled', 'deletion_pending') THEN
    UPDATE player_social_profiles
      SET social_action_epoch = social_action_epoch + 1
      WHERE user_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER friendship_account_epoch_status_change
  AFTER UPDATE OF status ON users FOR EACH ROW
  EXECUTE FUNCTION friendship_account_status_fence();

-- Blocking never grants relationship rights; future S1 service must recheck
-- blocks and epochs at every mutation. This table contains no user content,
-- location, private contact, GameInvitation or Participation snapshots.
CREATE FUNCTION deny_friendship_attempt_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'friendship attempt ledger is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER friendship_attempt_append_only BEFORE UPDATE OR DELETE
  ON friendship_request_attempts FOR EACH ROW EXECUTE FUNCTION deny_friendship_attempt_rewrite();

-- Lock the current relation before admitting its exact pending attempt. FOR SHARE
-- conflicts with non-key state/generation updates as well as key updates.
CREATE FUNCTION friendship_attempt_current_pending_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_friendship friendships%ROWTYPE;
BEGIN
  SELECT * INTO current_friendship FROM friendships
    WHERE id = NEW.friendship_id FOR SHARE;
  IF NOT FOUND OR current_friendship.state IS DISTINCT FROM 'pending'
    OR NEW.request_id IS DISTINCT FROM current_friendship.request_id
    OR NEW.generation IS DISTINCT FROM current_friendship.generation
    OR NEW.requester_user_id IS DISTINCT FROM current_friendship.requester_user_id
    OR NEW.recipient_user_id IS DISTINCT FROM current_friendship.recipient_user_id
    OR NEW.requested_at IS DISTINCT FROM current_friendship.requested_at
    OR NEW.expires_at IS DISTINCT FROM current_friendship.expires_at THEN
    RAISE EXCEPTION 'friendship attempt must match current pending relationship' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER friendship_attempt_current_pending BEFORE INSERT
  ON friendship_request_attempts FOR EACH ROW
  EXECUTE FUNCTION friendship_attempt_current_pending_guard();
CREATE TRIGGER friendship_attempt_deny_truncate BEFORE TRUNCATE
  ON friendship_request_attempts FOR EACH STATEMENT
  EXECUTE FUNCTION deny_friendship_attempt_rewrite();
