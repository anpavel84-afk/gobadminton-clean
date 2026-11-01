-- PG-2 / #372. Additive dispute response, help escalation, case mapping, reviewer resolution.
-- Extends 0046 present/absent rows with versioned unknown + case_reviewer provenance.
-- Does not edit 0042/0046 SQL. Open dispute retained across manager corrections.

-- Allow versioned unknown as a known-history row (not DELETE / reset to version 0).
ALTER TABLE game_attendance DROP CONSTRAINT IF EXISTS game_attendance_value_check;
ALTER TABLE game_attendance
  ADD CONSTRAINT game_attendance_value_check
  CHECK (value IN ('present', 'absent', 'unknown'));

ALTER TABLE game_attendance DROP CONSTRAINT IF EXISTS game_attendance_source_check;
ALTER TABLE game_attendance
  ADD CONSTRAINT game_attendance_source_check
  CHECK (source IN ('manager_explicit', 'self_attested', 'case_reviewer'));

ALTER TABLE game_attendance DROP CONSTRAINT IF EXISTS game_attendance_check;
ALTER TABLE game_attendance
  ADD CONSTRAINT game_attendance_late_value_check
  CHECK (
    (value = 'present')
    OR (value IN ('absent', 'unknown') AND late = false)
  );

ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_before_value_check;
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_before_value_check
  CHECK (before_value IS NULL OR before_value IN ('present', 'absent', 'unknown'));

ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_after_value_check;
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_after_value_check
  CHECK (after_value IN ('present', 'absent', 'unknown'));

ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_source_check;
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_source_check
  CHECK (source IN ('manager_explicit', 'self_attested', 'case_reviewer'));

ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_check;
ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_check1;
ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_check2;
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'game_attendance_revisions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%after_late%'
  LOOP
    EXECUTE format('ALTER TABLE game_attendance_revisions DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_late_value_check
  CHECK (
    (after_value = 'present')
    OR (after_value IN ('absent', 'unknown') AND after_late = false)
  );

ALTER TABLE game_attendance_notices DROP CONSTRAINT IF EXISTS game_attendance_notices_value_check;
ALTER TABLE game_attendance_notices
  ADD CONSTRAINT game_attendance_notices_value_check
  CHECK (value IN ('present', 'absent', 'unknown'));

ALTER TABLE game_attendance_notices DROP CONSTRAINT IF EXISTS game_attendance_notices_source_check;
ALTER TABLE game_attendance_notices
  ADD CONSTRAINT game_attendance_notices_source_check
  CHECK (source IN ('manager_explicit', 'self_attested', 'case_reviewer'));

ALTER TABLE game_attendance_notices DROP CONSTRAINT IF EXISTS game_attendance_notices_check;
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'game_attendance_notices'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%late%'
      AND pg_get_constraintdef(con.oid) ILIKE '%present%'
  LOOP
    EXECUTE format('ALTER TABLE game_attendance_notices DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;
ALTER TABLE game_attendance_notices
  ADD CONSTRAINT game_attendance_notices_late_value_check
  CHECK (
    (value = 'present')
    OR (value IN ('absent', 'unknown') AND late = false)
  );

-- Unknown has no known-fact acknowledgement.
ALTER TABLE game_attendance_notices
  ADD CONSTRAINT game_attendance_notices_unknown_no_ack_check
  CHECK (value <> 'unknown' OR acknowledged_at IS NULL);

-- Dispute columns first, then lifecycle check rewrite.
ALTER TABLE game_attendance_disputes
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS resolution_kind text NULL,
  ADD COLUMN IF NOT EXISTS latest_manager_response text NULL,
  ADD COLUMN IF NOT EXISTS help_requested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS help_progress text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_attendance_disputes_resolution_kind_check'
  ) THEN
    ALTER TABLE game_attendance_disputes
      ADD CONSTRAINT game_attendance_disputes_resolution_kind_check
      CHECK (
        resolution_kind IS NULL
        OR resolution_kind IN (
          'party_acknowledged',
          'reviewer_uphold_current',
          'reviewer_correct_present',
          'reviewer_correct_absent',
          'reviewer_clear_unknown'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_attendance_disputes_response_bounds_check'
  ) THEN
    ALTER TABLE game_attendance_disputes
      ADD CONSTRAINT game_attendance_disputes_response_bounds_check
      CHECK (
        latest_manager_response IS NULL
        OR char_length(latest_manager_response) BETWEEN 1 AND 500
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_attendance_disputes_help_progress_check'
  ) THEN
    ALTER TABLE game_attendance_disputes
      ADD CONSTRAINT game_attendance_disputes_help_progress_check
      CHECK (
        help_progress IS NULL
        OR help_progress IN (
          'requested',
          'case_opened',
          'in_review',
          'awaiting_information',
          'resolved',
          'left_open_insufficient_evidence'
        )
      );
  END IF;
END $$;

ALTER TABLE game_attendance_disputes DROP CONSTRAINT IF EXISTS game_attendance_disputes_status_check;
ALTER TABLE game_attendance_disputes
  ADD CONSTRAINT game_attendance_disputes_status_check
  CHECK (status IN ('open', 'withdrawn', 'resolved'));

ALTER TABLE game_attendance_disputes DROP CONSTRAINT IF EXISTS game_attendance_disputes_check;
ALTER TABLE game_attendance_disputes
  ADD CONSTRAINT game_attendance_disputes_lifecycle_check
  CHECK (
    (status = 'open' AND withdrawn_at IS NULL AND withdraw_reason IS NULL AND resolved_at IS NULL AND resolution_kind IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL AND resolved_at IS NULL AND resolution_kind IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolution_kind IS NOT NULL AND withdrawn_at IS NULL)
  );

ALTER TABLE game_attendance_dispute_revisions DROP CONSTRAINT IF EXISTS game_attendance_dispute_revisions_action_check;
ALTER TABLE game_attendance_dispute_revisions
  ADD CONSTRAINT game_attendance_dispute_revisions_action_check
  CHECK (action IN (
    'opened',
    'withdrawn',
    'manager_responded',
    'manager_corrected',
    'party_acknowledged',
    'help_requested',
    'case_linked',
    'reviewer_resolved',
    'left_open_insufficient_evidence'
  ));

CREATE TABLE IF NOT EXISTS game_attendance_dispute_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  dispute_id uuid NOT NULL REFERENCES game_attendance_disputes (id),
  dispute_version integer NOT NULL
    CHECK (dispute_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  explanation text NOT NULL
    CHECK (char_length(explanation) BETWEEN 1 AND 500),
  corrected_attendance_version integer NULL
    CHECK (
      corrected_attendance_version IS NULL
      OR corrected_attendance_version BETWEEN 1 AND 2147483647
    ),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT game_attendance_dispute_responses_version_uidx
    UNIQUE (dispute_id, dispute_version)
);

CREATE INDEX IF NOT EXISTS game_attendance_dispute_responses_dispute_recorded_idx
  ON game_attendance_dispute_responses (dispute_id, recorded_at, id);

CREATE TABLE IF NOT EXISTS game_attendance_dispute_case_links (
  dispute_id uuid PRIMARY KEY REFERENCES game_attendance_disputes (id),
  case_id uuid NOT NULL REFERENCES support_cases (id),
  game_id uuid NOT NULL REFERENCES games (id),
  created_by_principal_id uuid NOT NULL REFERENCES admin_principals (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT game_attendance_dispute_case_links_case_uidx UNIQUE (case_id),
  CONSTRAINT game_attendance_dispute_case_links_game_case_uidx UNIQUE (game_id, case_id)
);

CREATE TABLE IF NOT EXISTS game_attendance_dispute_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  dispute_id uuid NOT NULL REFERENCES game_attendance_disputes (id),
  dispute_version integer NOT NULL
    CHECK (dispute_version BETWEEN 1 AND 2147483647),
  case_id uuid NOT NULL REFERENCES support_cases (id),
  case_version integer NOT NULL
    CHECK (case_version BETWEEN 1 AND 2147483647),
  attendance_version integer NOT NULL
    CHECK (attendance_version BETWEEN 0 AND 2147483647),
  resolution text NOT NULL
    CHECK (resolution IN (
      'uphold_current',
      'correct_present',
      'correct_absent',
      'clear_unknown',
      'insufficient_evidence'
    )),
  reason text NOT NULL
    CHECK (char_length(reason) BETWEEN 1 AND 500),
  reviewer_principal_id uuid NOT NULL REFERENCES admin_principals (id),
  reviewer_user_id uuid NOT NULL REFERENCES users (id),
  independently_verified boolean NOT NULL DEFAULT false,
  leaves_open boolean NOT NULL DEFAULT false,
  audit_id uuid NOT NULL REFERENCES privileged_audit_events (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT game_attendance_dispute_resolutions_version_uidx
    UNIQUE (dispute_id, dispute_version),
  CHECK (
    (resolution = 'insufficient_evidence' AND leaves_open = true AND independently_verified = false)
    OR (resolution <> 'insufficient_evidence' AND leaves_open = false)
  ),
  CHECK (independently_verified = false OR resolution <> 'insufficient_evidence')
);

CREATE UNIQUE INDEX IF NOT EXISTS game_attendance_dispute_resolutions_one_closing_uidx
  ON game_attendance_dispute_resolutions (dispute_id)
  WHERE leaves_open = false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'game_attendance_dispute_responses_immutable'
  ) THEN
    CREATE TRIGGER game_attendance_dispute_responses_immutable
      BEFORE UPDATE OR DELETE ON game_attendance_dispute_responses
      FOR EACH ROW EXECUTE FUNCTION deny_game_attendance_history_rewrite();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'game_attendance_dispute_responses_deny_truncate'
  ) THEN
    CREATE TRIGGER game_attendance_dispute_responses_deny_truncate
      BEFORE TRUNCATE ON game_attendance_dispute_responses
      FOR EACH STATEMENT EXECUTE FUNCTION deny_game_attendance_history_rewrite();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'game_attendance_dispute_case_links_immutable'
  ) THEN
    CREATE TRIGGER game_attendance_dispute_case_links_immutable
      BEFORE UPDATE OR DELETE ON game_attendance_dispute_case_links
      FOR EACH ROW EXECUTE FUNCTION deny_game_attendance_history_rewrite();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'game_attendance_dispute_case_links_deny_truncate'
  ) THEN
    CREATE TRIGGER game_attendance_dispute_case_links_deny_truncate
      BEFORE TRUNCATE ON game_attendance_dispute_case_links
      FOR EACH STATEMENT EXECUTE FUNCTION deny_game_attendance_history_rewrite();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'game_attendance_dispute_resolutions_immutable'
  ) THEN
    CREATE TRIGGER game_attendance_dispute_resolutions_immutable
      BEFORE UPDATE OR DELETE ON game_attendance_dispute_resolutions
      FOR EACH ROW EXECUTE FUNCTION deny_game_attendance_history_rewrite();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'game_attendance_dispute_resolutions_deny_truncate'
  ) THEN
    CREATE TRIGGER game_attendance_dispute_resolutions_deny_truncate
      BEFORE TRUNCATE ON game_attendance_dispute_resolutions
      FOR EACH STATEMENT EXECUTE FUNCTION deny_game_attendance_history_rewrite();
  END IF;
END $$;
