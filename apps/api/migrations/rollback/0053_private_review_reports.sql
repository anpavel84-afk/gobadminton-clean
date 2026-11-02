-- Rollback 0053: refuse when typed game_review report history exists.
-- No history deletion.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM abuse_reports WHERE target_kind = 'game_review')
     OR EXISTS (SELECT 1 FROM game_review_report_bindings)
  THEN
    RAISE EXCEPTION
      'rollback 0053 blocked: typed game_review report history exists'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TRIGGER IF EXISTS game_review_report_bindings_immutable ON game_review_report_bindings;

DROP TABLE IF EXISTS game_review_report_bindings;

ALTER TABLE game_review_revisions
  DROP CONSTRAINT IF EXISTS game_review_revisions_report_binding_tuple_uidx;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_player_public_id_chk;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_target_kind_check;

-- Restore player-only target_kind and NOT NULL public id (empty of game_review rows).
UPDATE abuse_reports
  SET target_public_player_id = target_public_player_id
  WHERE target_public_player_id IS NULL;

ALTER TABLE abuse_reports
  ALTER COLUMN target_public_player_id SET NOT NULL;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_target_kind_check
  CHECK (target_kind IN ('player'));

DELETE FROM schema_migrations WHERE id = '0053_private_review_reports';
