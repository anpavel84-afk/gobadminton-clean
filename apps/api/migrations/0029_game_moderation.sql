-- Internal-only orthogonal projection; no rewrite of existing game lifecycle.
CREATE TABLE game_moderation_state (
  game_id uuid PRIMARY KEY REFERENCES games(id),
  state text NOT NULL DEFAULT 'clear' CHECK (state IN ('clear','hidden','taken_down')),
  requests_locked boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_action_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE game_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id),
  audit_id uuid NOT NULL UNIQUE REFERENCES privileged_audit_events(id),
  action text NOT NULL CHECK (action IN ('hide','takedown','lock_requests','restore_moderation','force_cancel')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE game_moderation_state ADD CONSTRAINT game_moderation_last_action_fk
  FOREIGN KEY (last_action_id) REFERENCES game_moderation_actions(id);
CREATE INDEX game_moderation_actions_history ON game_moderation_actions(game_id,created_at DESC,id DESC);
CREATE FUNCTION reject_game_moderation_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'game moderation history is append-only'; END $$;
CREATE TRIGGER game_moderation_history_immutable BEFORE UPDATE OR DELETE ON game_moderation_actions
FOR EACH ROW EXECUTE FUNCTION reject_game_moderation_history_mutation();
CREATE TRIGGER game_moderation_history_no_truncate BEFORE TRUNCATE ON game_moderation_actions
FOR EACH STATEMENT EXECUTE FUNCTION reject_game_moderation_history_mutation();
