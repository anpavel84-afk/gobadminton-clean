-- Caller owns transaction. Authorized recovery of UNUSED installation only.
-- Populated history: keep schema and roll application back with Friends OFF.
LOCK TABLE game_recommendations,game_recommendation_actions IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM game_recommendations) OR EXISTS(SELECT 1 FROM game_recommendation_actions) THEN
    RAISE EXCEPTION '0040 rollback refuses populated history' USING ERRCODE='23514';
  END IF;
END $$;
DROP TABLE game_recommendation_actions;
DROP TABLE game_recommendations;
DROP FUNCTION game_recommendation_guard();
DROP FUNCTION game_recommendation_audit();
DROP FUNCTION deny_game_recommendation_history_rewrite();
DELETE FROM schema_migrations WHERE id='0040_game_recommendations';
