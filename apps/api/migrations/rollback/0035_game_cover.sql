-- Unused installation rollback only. Normal rollback retains additive schema and cover-aware GC.
LOCK TABLE games IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM games WHERE cover_key IS NOT NULL) THEN
  RAISE EXCEPTION '0035 rollback refuses populated game cover state' USING ERRCODE='23514';
 END IF;
END $$;
DROP TRIGGER inactive_game_cover ON users;
DROP FUNCTION retire_inactive_game_cover();

DROP TRIGGER game_cover_cleanup ON games;
DROP FUNCTION game_effective_cover_url(uuid);
DROP FUNCTION game_own_cover_url(uuid);
ALTER TABLE games DROP CONSTRAINT game_cover_binding;
ALTER TABLE games DROP COLUMN cover_actor_id, DROP COLUMN cover_moderation_approval_id, DROP COLUMN cover_key;
DELETE FROM schema_migrations WHERE id='0035_game_cover';
