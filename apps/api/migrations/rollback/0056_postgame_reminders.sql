-- Rollback 0056: refuse when any reminder or event history exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM game_outcome_reminder_events)
     OR EXISTS (SELECT 1 FROM game_outcome_reminders)
  THEN
    RAISE EXCEPTION
      'rollback 0056 blocked: postgame reminder history exists'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TABLE IF EXISTS game_outcome_reminder_events;
DROP TABLE IF EXISTS game_outcome_reminders;
