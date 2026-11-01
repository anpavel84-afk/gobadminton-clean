-- Caller owns transaction. Authorized recovery of UNUSED installation only.
-- Populated new history: keep schema and roll application writes back with flag OFF.
LOCK TABLE
  game_attendance_dispute_resolutions,
  game_attendance_dispute_case_links,
  game_attendance_dispute_responses,
  game_attendance_dispute_revisions,
  game_attendance_disputes,
  game_attendance_notices,
  game_attendance_revisions,
  game_attendance
IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM game_attendance_dispute_resolutions)
     OR EXISTS (SELECT 1 FROM game_attendance_dispute_case_links)
     OR EXISTS (SELECT 1 FROM game_attendance_dispute_responses)
     OR EXISTS (
       SELECT 1 FROM game_attendance_disputes
       WHERE status = 'resolved'
          OR resolved_at IS NOT NULL
          OR latest_manager_response IS NOT NULL
          OR help_requested_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM game_attendance WHERE value = 'unknown' OR source = 'case_reviewer'
     )
     OR EXISTS (
       SELECT 1 FROM game_attendance_revisions
       WHERE after_value = 'unknown' OR before_value = 'unknown' OR source = 'case_reviewer'
     )
     OR EXISTS (
       SELECT 1 FROM game_attendance_notices
       WHERE value = 'unknown' OR source = 'case_reviewer'
     )
     OR EXISTS (
       SELECT 1 FROM game_attendance_dispute_revisions
       WHERE action NOT IN ('opened', 'withdrawn')
     ) THEN
    RAISE EXCEPTION '0047 rollback refuses populated PG-2 history' USING ERRCODE = '23514';
  END IF;
END $$;

DROP TRIGGER IF EXISTS game_attendance_dispute_resolutions_deny_truncate ON game_attendance_dispute_resolutions;
DROP TRIGGER IF EXISTS game_attendance_dispute_resolutions_immutable ON game_attendance_dispute_resolutions;
DROP TRIGGER IF EXISTS game_attendance_dispute_case_links_deny_truncate ON game_attendance_dispute_case_links;
DROP TRIGGER IF EXISTS game_attendance_dispute_case_links_immutable ON game_attendance_dispute_case_links;
DROP TRIGGER IF EXISTS game_attendance_dispute_responses_deny_truncate ON game_attendance_dispute_responses;
DROP TRIGGER IF EXISTS game_attendance_dispute_responses_immutable ON game_attendance_dispute_responses;

DROP TABLE IF EXISTS game_attendance_dispute_resolutions;
DROP TABLE IF EXISTS game_attendance_dispute_case_links;
DROP TABLE IF EXISTS game_attendance_dispute_responses;

ALTER TABLE game_attendance_dispute_revisions DROP CONSTRAINT IF EXISTS game_attendance_dispute_revisions_action_check;
ALTER TABLE game_attendance_dispute_revisions
  ADD CONSTRAINT game_attendance_dispute_revisions_action_check
  CHECK (action IN ('opened', 'withdrawn'));

ALTER TABLE game_attendance_disputes DROP CONSTRAINT IF EXISTS game_attendance_disputes_lifecycle_check;
ALTER TABLE game_attendance_disputes DROP CONSTRAINT IF EXISTS game_attendance_disputes_status_check;
ALTER TABLE game_attendance_disputes DROP CONSTRAINT IF EXISTS game_attendance_disputes_resolution_kind_check;
ALTER TABLE game_attendance_disputes DROP CONSTRAINT IF EXISTS game_attendance_disputes_response_bounds_check;
ALTER TABLE game_attendance_disputes DROP CONSTRAINT IF EXISTS game_attendance_disputes_help_progress_check;

ALTER TABLE game_attendance_disputes
  DROP COLUMN IF EXISTS help_progress,
  DROP COLUMN IF EXISTS help_requested_at,
  DROP COLUMN IF EXISTS latest_manager_response,
  DROP COLUMN IF EXISTS resolution_kind,
  DROP COLUMN IF EXISTS resolved_at;

ALTER TABLE game_attendance_disputes
  ADD CONSTRAINT game_attendance_disputes_status_check
  CHECK (status IN ('open', 'withdrawn'));

ALTER TABLE game_attendance_disputes
  ADD CONSTRAINT game_attendance_disputes_check
  CHECK (
    (status = 'open' AND withdrawn_at IS NULL AND withdraw_reason IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
  );

ALTER TABLE game_attendance_notices DROP CONSTRAINT IF EXISTS game_attendance_notices_unknown_no_ack_check;
ALTER TABLE game_attendance_notices DROP CONSTRAINT IF EXISTS game_attendance_notices_late_value_check;
ALTER TABLE game_attendance_notices DROP CONSTRAINT IF EXISTS game_attendance_notices_source_check;
ALTER TABLE game_attendance_notices DROP CONSTRAINT IF EXISTS game_attendance_notices_value_check;
ALTER TABLE game_attendance_notices
  ADD CONSTRAINT game_attendance_notices_value_check
  CHECK (value IN ('present', 'absent'));
ALTER TABLE game_attendance_notices
  ADD CONSTRAINT game_attendance_notices_source_check
  CHECK (source IN ('manager_explicit', 'self_attested'));
ALTER TABLE game_attendance_notices
  ADD CONSTRAINT game_attendance_notices_check
  CHECK (late = false OR value = 'present');

ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_late_value_check;
ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_source_check;
ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_after_value_check;
ALTER TABLE game_attendance_revisions DROP CONSTRAINT IF EXISTS game_attendance_revisions_before_value_check;
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_before_value_check
  CHECK (before_value IS NULL OR before_value IN ('present', 'absent'));
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_after_value_check
  CHECK (after_value IN ('present', 'absent'));
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_source_check
  CHECK (source IN ('manager_explicit', 'self_attested'));
ALTER TABLE game_attendance_revisions
  ADD CONSTRAINT game_attendance_revisions_check
  CHECK (after_late = false OR after_value = 'present');

ALTER TABLE game_attendance DROP CONSTRAINT IF EXISTS game_attendance_late_value_check;
ALTER TABLE game_attendance DROP CONSTRAINT IF EXISTS game_attendance_source_check;
ALTER TABLE game_attendance DROP CONSTRAINT IF EXISTS game_attendance_value_check;
ALTER TABLE game_attendance
  ADD CONSTRAINT game_attendance_value_check
  CHECK (value IN ('present', 'absent'));
ALTER TABLE game_attendance
  ADD CONSTRAINT game_attendance_source_check
  CHECK (source IN ('manager_explicit', 'self_attested'));
ALTER TABLE game_attendance
  ADD CONSTRAINT game_attendance_check
  CHECK (late = false OR value = 'present');

DELETE FROM schema_migrations WHERE id = '0047_attendance_dispute_resolution';
