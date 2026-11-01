-- Caller owns transaction. Authorized recovery of UNUSED installation only.
-- Populated history: keep schema and roll application writes back with flag OFF.
LOCK TABLE
  game_attendance_dispute_revisions,
  game_attendance_disputes,
  game_attendance_notices,
  game_attendance_revisions,
  game_attendance
IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM game_attendance)
     OR EXISTS (SELECT 1 FROM game_attendance_revisions)
     OR EXISTS (SELECT 1 FROM game_attendance_notices)
     OR EXISTS (SELECT 1 FROM game_attendance_disputes)
     OR EXISTS (SELECT 1 FROM game_attendance_dispute_revisions) THEN
    RAISE EXCEPTION '0046 rollback refuses populated history' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE game_attendance_dispute_revisions;
DROP TABLE game_attendance_disputes;
DROP TABLE game_attendance_notices;
DROP TABLE game_attendance_revisions;
DROP TABLE game_attendance;
DROP FUNCTION game_attendance_notice_ack_guard();
DROP FUNCTION game_attendance_guard();
DROP FUNCTION deny_game_attendance_history_rewrite();
DELETE FROM schema_migrations WHERE id = '0046_game_attendance';
