-- PG-1a / #375. Additive GameOutcome + append-only revisions.
-- Absence of a row projects as unknown; time never inserts held/not_held.
-- No attendance, notices, reviews or UI in this slice.

CREATE TABLE game_outcomes (
  game_id uuid PRIMARY KEY REFERENCES games (id),
  value text NOT NULL
    CHECK (value IN ('held', 'not_held')),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  reason text NULL
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  source text NOT NULL
    CHECK (source IN ('manager_explicit')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (value = 'held')
    OR (value = 'not_held' AND reason IS NOT NULL)
  )
);

CREATE TABLE game_outcome_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  source text NOT NULL
    CHECK (source IN ('manager_explicit')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  before_value text NULL
    CHECK (before_value IS NULL OR before_value IN ('held', 'not_held')),
  after_value text NOT NULL
    CHECK (after_value IN ('held', 'not_held')),
  before_reason text NULL
    CHECK (before_reason IS NULL OR char_length(before_reason) BETWEEN 1 AND 500),
  after_reason text NULL
    CHECK (after_reason IS NULL OR char_length(after_reason) BETWEEN 1 AND 500),
  reason text NULL
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT game_outcome_revisions_game_version_uidx
    UNIQUE (game_id, resource_version),
  CHECK (
    (
      resource_version = 1
      AND before_value IS NULL
      AND before_reason IS NULL
      AND (
        after_value = 'held'
        OR (after_value = 'not_held' AND after_reason IS NOT NULL)
      )
    )
    OR (
      resource_version > 1
      AND before_value IS NOT NULL
      AND reason IS NOT NULL
      AND (
        after_value = 'held'
        OR (after_value = 'not_held' AND after_reason IS NOT NULL)
      )
    )
  )
);

CREATE INDEX game_outcome_revisions_game_recorded_idx
  ON game_outcome_revisions (game_id, recorded_at, resource_version);

CREATE FUNCTION game_outcome_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'initial outcome version must be 1' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.game_id, NEW.recorded_at, NEW.source)
      IS DISTINCT FROM ROW(OLD.game_id, OLD.recorded_at, OLD.source)
      OR NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'invalid outcome transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER game_outcomes_guard
  BEFORE INSERT OR UPDATE ON game_outcomes
  FOR EACH ROW EXECUTE FUNCTION game_outcome_guard();

CREATE FUNCTION deny_game_outcome_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'game outcome history is retained' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER game_outcomes_deny_delete
  BEFORE DELETE ON game_outcomes
  FOR EACH ROW EXECUTE FUNCTION deny_game_outcome_history_rewrite();

CREATE TRIGGER game_outcomes_deny_truncate
  BEFORE TRUNCATE ON game_outcomes
  FOR EACH STATEMENT EXECUTE FUNCTION deny_game_outcome_history_rewrite();

CREATE TRIGGER game_outcome_revisions_immutable
  BEFORE UPDATE OR DELETE ON game_outcome_revisions
  FOR EACH ROW EXECUTE FUNCTION deny_game_outcome_history_rewrite();

CREATE TRIGGER game_outcome_revisions_deny_truncate
  BEFORE TRUNCATE ON game_outcome_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION deny_game_outcome_history_rewrite();
