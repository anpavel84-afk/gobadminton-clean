-- FR-3A / #181. Additive private references only; no seat, invitation, copied
-- game/profile/contact content, delivery job, outbox notification or graph edge.
CREATE TABLE game_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  friendship_id uuid NOT NULL REFERENCES friendships(id),
  friendship_generation bigint NOT NULL CHECK (friendship_generation >= 1),
  game_id uuid NOT NULL REFERENCES games(id),
  sender_user_id uuid NOT NULL REFERENCES users(id),
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  sender_epoch bigint NOT NULL CHECK (sender_epoch >= 1),
  recipient_epoch bigint NOT NULL CHECK (recipient_epoch >= 1),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','withdrawn')),
  recipient_hidden boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483647),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days'),
  CHECK (sender_user_id <> recipient_user_id),
  CONSTRAINT game_recommendations_direction_idx UNIQUE (friendship_id, game_id, sender_user_id)
);
CREATE INDEX game_recommendations_received_idx
  ON game_recommendations(recipient_user_id,id)
  WHERE state='active' AND NOT recipient_hidden;
CREATE INDEX game_recommendations_sent_idx ON game_recommendations(sender_user_id,id);

-- Minimal immutable audit; no user-supplied content. History survives app rollback.
CREATE TABLE game_recommendation_actions (
  recommendation_id uuid NOT NULL REFERENCES game_recommendations(id),
  version integer NOT NULL CHECK (version >= 1),
  action text NOT NULL CHECK (action IN ('send','hide','withdraw')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (recommendation_id,version)
);
CREATE FUNCTION game_recommendation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f friendships%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO f FROM friendships WHERE id=NEW.friendship_id FOR SHARE;
    IF NOT FOUND OR f.state <> 'accepted' OR f.generation <> NEW.friendship_generation
      OR NOT ((NEW.sender_user_id=f.requester_user_id AND NEW.recipient_user_id=f.recipient_user_id)
        OR (NEW.sender_user_id=f.recipient_user_id AND NEW.recipient_user_id=f.requester_user_id))
      OR NEW.version <> 1 OR NEW.state <> 'active' OR NEW.recipient_hidden THEN
      RAISE EXCEPTION 'invalid recommendation relationship' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.friendship_id,NEW.friendship_generation,NEW.game_id,NEW.sender_user_id,
        NEW.recipient_user_id,NEW.sender_epoch,NEW.recipient_epoch,NEW.created_at,NEW.expires_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.friendship_id,OLD.friendship_generation,OLD.game_id,OLD.sender_user_id,
        OLD.recipient_user_id,OLD.sender_epoch,OLD.recipient_epoch,OLD.created_at,OLD.expires_at)
      OR NEW.version::bigint <> OLD.version::bigint+1 OR OLD.state <> 'active'
      OR NOT ((NEW.state='withdrawn' AND NEW.recipient_hidden=OLD.recipient_hidden)
        OR (NEW.state='active' AND NOT OLD.recipient_hidden AND NEW.recipient_hidden)) THEN
      RAISE EXCEPTION 'invalid recommendation transition' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER game_recommendations_guard BEFORE INSERT OR UPDATE ON game_recommendations
  FOR EACH ROW EXECUTE FUNCTION game_recommendation_guard();
CREATE FUNCTION game_recommendation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO game_recommendation_actions(recommendation_id,version,action,actor_user_id)
    VALUES(NEW.id,NEW.version,
      CASE WHEN TG_OP='INSERT' THEN 'send' WHEN NEW.state='withdrawn' THEN 'withdraw' ELSE 'hide' END,
      CASE WHEN TG_OP='UPDATE' AND NEW.state='active' THEN NEW.recipient_user_id ELSE NEW.sender_user_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER game_recommendations_audit AFTER INSERT OR UPDATE ON game_recommendations
  FOR EACH ROW EXECUTE FUNCTION game_recommendation_audit();
CREATE FUNCTION deny_game_recommendation_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recommendation history is retained' USING ERRCODE='23514';
END $$;
CREATE TRIGGER game_recommendations_deny_delete BEFORE DELETE ON game_recommendations
  FOR EACH ROW EXECUTE FUNCTION deny_game_recommendation_history_rewrite();
CREATE TRIGGER game_recommendations_deny_truncate BEFORE TRUNCATE ON game_recommendations
  FOR EACH STATEMENT EXECUTE FUNCTION deny_game_recommendation_history_rewrite();
CREATE TRIGGER game_recommendation_actions_immutable BEFORE UPDATE OR DELETE ON game_recommendation_actions
  FOR EACH ROW EXECUTE FUNCTION deny_game_recommendation_history_rewrite();
CREATE TRIGGER game_recommendation_actions_deny_truncate BEFORE TRUNCATE ON game_recommendation_actions
  FOR EACH STATEMENT EXECUTE FUNCTION deny_game_recommendation_history_rewrite();
