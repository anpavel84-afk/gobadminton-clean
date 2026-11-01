-- PG-1b / #372. Additive attendance + notices + disputes.
-- Absence of a row projects as unknown/version 0; time/status never insert present/absent.
-- Outcome (0042) unchanged. Writes remain gated by POST_GAME_INTERNAL_ENABLED.

CREATE TABLE game_attendance (
  participation_id uuid PRIMARY KEY REFERENCES participations (id),
  game_id uuid NOT NULL REFERENCES games (id),
  user_id uuid NOT NULL REFERENCES users (id),
  value text NOT NULL
    CHECK (value IN ('present', 'absent')),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  late boolean NOT NULL DEFAULT false,
  source text NOT NULL
    CHECK (source IN ('manager_explicit', 'self_attested')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  correction_reason text NULL
    CHECK (
      correction_reason IS NULL
      OR char_length(correction_reason) BETWEEN 1 AND 500
    ),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (late = false OR value = 'present'),
  CONSTRAINT game_attendance_game_participation_uidx UNIQUE (game_id, participation_id),
  CONSTRAINT game_attendance_game_user_uidx UNIQUE (game_id, user_id)
);

CREATE INDEX game_attendance_game_updated_idx
  ON game_attendance (game_id, updated_at, participation_id);

CREATE TABLE game_attendance_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  participation_id uuid NOT NULL REFERENCES participations (id),
  game_id uuid NOT NULL REFERENCES games (id),
  user_id uuid NOT NULL REFERENCES users (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  source text NOT NULL
    CHECK (source IN ('manager_explicit', 'self_attested')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  before_value text NULL
    CHECK (before_value IS NULL OR before_value IN ('present', 'absent')),
  after_value text NOT NULL
    CHECK (after_value IN ('present', 'absent')),
  before_late boolean NULL,
  after_late boolean NOT NULL,
  before_correction_reason text NULL
    CHECK (
      before_correction_reason IS NULL
      OR char_length(before_correction_reason) BETWEEN 1 AND 500
    ),
  after_correction_reason text NULL
    CHECK (
      after_correction_reason IS NULL
      OR char_length(after_correction_reason) BETWEEN 1 AND 500
    ),
  reason text NULL
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT game_attendance_revisions_context_version_uidx
    UNIQUE (participation_id, resource_version),
  CHECK (after_late = false OR after_value = 'present'),
  CHECK (
    (
      resource_version = 1
      AND before_value IS NULL
      AND before_late IS NULL
      AND before_correction_reason IS NULL
    )
    OR (
      resource_version > 1
      AND before_value IS NOT NULL
      AND before_late IS NOT NULL
      AND reason IS NOT NULL
    )
  )
);

CREATE INDEX game_attendance_revisions_game_recorded_idx
  ON game_attendance_revisions (game_id, recorded_at, resource_version);

CREATE TABLE game_attendance_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  participation_id uuid NOT NULL REFERENCES participations (id),
  game_id uuid NOT NULL REFERENCES games (id),
  user_id uuid NOT NULL REFERENCES users (id),
  attendance_version integer NOT NULL
    CHECK (attendance_version BETWEEN 1 AND 2147483647),
  value text NOT NULL
    CHECK (value IN ('present', 'absent')),
  late boolean NOT NULL,
  source text NOT NULL
    CHECK (source IN ('manager_explicit', 'self_attested')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  actor_display text NOT NULL
    CHECK (char_length(actor_display) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at timestamptz NULL,
  CONSTRAINT game_attendance_notices_context_version_uidx
    UNIQUE (participation_id, attendance_version),
  CHECK (late = false OR value = 'present'),
  CHECK (
    (acknowledged_at IS NULL)
    OR (acknowledged_at IS NOT NULL)
  )
);

CREATE INDEX game_attendance_notices_user_created_idx
  ON game_attendance_notices (user_id, created_at DESC, id);

CREATE INDEX game_attendance_notices_user_unacked_idx
  ON game_attendance_notices (user_id, created_at DESC, id)
  WHERE acknowledged_at IS NULL;

CREATE TABLE game_attendance_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  participation_id uuid NOT NULL REFERENCES participations (id),
  game_id uuid NOT NULL REFERENCES games (id),
  user_id uuid NOT NULL REFERENCES users (id),
  challenged_version integer NOT NULL
    CHECK (challenged_version BETWEEN 1 AND 2147483647),
  explanation text NOT NULL
    CHECK (char_length(explanation) BETWEEN 1 AND 500),
  status text NOT NULL
    CHECK (status IN ('open', 'withdrawn')),
  version integer NOT NULL DEFAULT 1
    CHECK (version BETWEEN 1 AND 2147483647),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_at timestamptz NULL,
  withdraw_reason text NULL
    CHECK (
      withdraw_reason IS NULL
      OR char_length(withdraw_reason) BETWEEN 1 AND 500
    ),
  CHECK (
    (status = 'open' AND withdrawn_at IS NULL AND withdraw_reason IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX game_attendance_disputes_one_open_uidx
  ON game_attendance_disputes (participation_id)
  WHERE status = 'open';

CREATE INDEX game_attendance_disputes_game_updated_idx
  ON game_attendance_disputes (game_id, updated_at, id);

CREATE TABLE game_attendance_dispute_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  dispute_id uuid NOT NULL REFERENCES game_attendance_disputes (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  action text NOT NULL
    CHECK (action IN ('opened', 'withdrawn')),
  explanation text NULL
    CHECK (explanation IS NULL OR char_length(explanation) BETWEEN 1 AND 500),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT game_attendance_dispute_revisions_uidx
    UNIQUE (dispute_id, resource_version)
);

CREATE FUNCTION game_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'initial attendance version must be 1' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.participation_id, NEW.game_id, NEW.user_id, NEW.recorded_at)
      IS DISTINCT FROM ROW(OLD.participation_id, OLD.game_id, OLD.user_id, OLD.recorded_at)
      OR NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'invalid attendance transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER game_attendance_guard
  BEFORE INSERT OR UPDATE ON game_attendance
  FOR EACH ROW EXECUTE FUNCTION game_attendance_guard();

CREATE FUNCTION deny_game_attendance_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'game attendance history is retained' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER game_attendance_deny_delete
  BEFORE DELETE ON game_attendance
  FOR EACH ROW EXECUTE FUNCTION deny_game_attendance_history_rewrite();

CREATE TRIGGER game_attendance_deny_truncate
  BEFORE TRUNCATE ON game_attendance
  FOR EACH STATEMENT EXECUTE FUNCTION deny_game_attendance_history_rewrite();

CREATE TRIGGER game_attendance_revisions_immutable
  BEFORE UPDATE OR DELETE ON game_attendance_revisions
  FOR EACH ROW EXECUTE FUNCTION deny_game_attendance_history_rewrite();

CREATE TRIGGER game_attendance_revisions_deny_truncate
  BEFORE TRUNCATE ON game_attendance_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION deny_game_attendance_history_rewrite();

CREATE TRIGGER game_attendance_notices_deny_delete
  BEFORE DELETE ON game_attendance_notices
  FOR EACH ROW EXECUTE FUNCTION deny_game_attendance_history_rewrite();

-- Acknowledgements only flip acknowledgement columns; identity/version/value stay immutable.
CREATE FUNCTION game_attendance_notice_ack_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.participation_id, NEW.game_id, NEW.user_id,
    NEW.attendance_version, NEW.value, NEW.late, NEW.source,
    NEW.actor_user_id, NEW.actor_display, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.participation_id, OLD.game_id, OLD.user_id,
    OLD.attendance_version, OLD.value, OLD.late, OLD.source,
    OLD.actor_user_id, OLD.actor_display, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'attendance notice identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.acknowledged_at IS NOT NULL
     AND (
       NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     ) THEN
    RAISE EXCEPTION 'attendance acknowledgement is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.acknowledged_at IS NOT NULL AND OLD.acknowledged_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.acknowledged_at IS NULL AND OLD.acknowledged_at IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid attendance notice update' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER game_attendance_notices_ack_guard
  BEFORE UPDATE ON game_attendance_notices
  FOR EACH ROW EXECUTE FUNCTION game_attendance_notice_ack_guard();

CREATE TRIGGER game_attendance_dispute_revisions_immutable
  BEFORE UPDATE OR DELETE ON game_attendance_dispute_revisions
  FOR EACH ROW EXECUTE FUNCTION deny_game_attendance_history_rewrite();

CREATE TRIGGER game_attendance_dispute_revisions_deny_truncate
  BEFORE TRUNCATE ON game_attendance_dispute_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION deny_game_attendance_history_rewrite();
