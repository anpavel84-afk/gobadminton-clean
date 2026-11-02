-- #394 confirmed-experience / missing-mark clarification.
-- Allow challenged_version 0 when no attendance row exists (missing mark).
-- Additive only: do not edit applied 0046/0047.

DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'game_attendance_disputes'::regclass
      AND con.contype = 'c'
      AND att.attname = 'challenged_version'
  LOOP
    EXECUTE format('ALTER TABLE game_attendance_disputes DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE game_attendance_disputes
  ADD CONSTRAINT game_attendance_disputes_challenged_version_check
  CHECK (challenged_version BETWEEN 0 AND 2147483647);
