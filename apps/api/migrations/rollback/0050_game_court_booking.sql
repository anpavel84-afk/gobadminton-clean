-- Rollback for 0050 (#386 court-booking).
-- Prefer app-only rollback retaining additive schema/data.
-- Optional DB rollback refuses when any organizer-declared status row exists
-- (preserves written facts; never destructive cleaning of populated state).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM game_court_booking LIMIT 1) THEN
    RAISE EXCEPTION
      '0050 DB rollback refused: game_court_booking has populated organizer-declared status. Prefer app-only rollback retaining additive schema/data, or restore from the operator pre-migration DB backup. Do not destroy written court-booking facts to force PASS.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TABLE IF EXISTS game_court_booking;

DELETE FROM schema_migrations WHERE id = '0050_game_court_booking';
