-- Rollback 0052: restore challenged_version >= 1.
-- Refuse when any dispute stores challenged_version = 0.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM game_attendance_disputes WHERE challenged_version = 0
  ) THEN
    RAISE EXCEPTION
      'rollback 0052 blocked: disputes with challenged_version=0 exist'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE game_attendance_disputes
  DROP CONSTRAINT IF EXISTS game_attendance_disputes_challenged_version_check;

ALTER TABLE game_attendance_disputes
  ADD CONSTRAINT game_attendance_disputes_challenged_version_check
  CHECK (challenged_version BETWEEN 1 AND 2147483647);
