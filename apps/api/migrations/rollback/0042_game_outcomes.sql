-- Caller owns transaction. Authorized recovery of UNUSED installation only.
-- Populated history: keep schema and roll application writes back with flag OFF.
LOCK TABLE game_outcomes, game_outcome_revisions IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM game_outcomes)
     OR EXISTS (SELECT 1 FROM game_outcome_revisions) THEN
    RAISE EXCEPTION '0042 rollback refuses populated history' USING ERRCODE = '23514';
  END IF;
END $$;
DROP TABLE game_outcome_revisions;
DROP TABLE game_outcomes;
DROP FUNCTION game_outcome_guard();
DROP FUNCTION deny_game_outcome_history_rewrite();
DELETE FROM schema_migrations WHERE id = '0042_game_outcomes';
