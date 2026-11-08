-- Rollback 0067: refuse when typed message report history exists.
-- No history deletion.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM abuse_reports WHERE target_kind = 'message')
     OR EXISTS (SELECT 1 FROM message_report_bindings)
  THEN
    RAISE EXCEPTION
      'rollback 0067 blocked: typed message report history exists'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TRIGGER IF EXISTS message_report_bindings_immutable ON message_report_bindings;

DROP TABLE IF EXISTS message_report_bindings;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_report_binding_tuple_uidx;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_player_public_id_chk;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_target_kind_check;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_target_kind_check
  CHECK (target_kind IN ('player', 'game_review'));

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_player_public_id_chk
  CHECK (
    (target_kind = 'player' AND target_public_player_id IS NOT NULL)
    OR (target_kind = 'game_review')
  );

DELETE FROM schema_migrations WHERE id = '0067_private_message_reports';
