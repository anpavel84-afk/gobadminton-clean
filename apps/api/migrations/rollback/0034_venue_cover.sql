-- Optional UNUSED installation rollback only. Caller owns transaction and stops writers.
-- Normal source rollback retains this additive schema and the cover-aware collector.
LOCK TABLE venues IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM venues WHERE cover_key IS NOT NULL)
     OR EXISTS (SELECT 1 FROM venue_admin_actions WHERE action='cover') THEN
    RAISE EXCEPTION '0034 rollback refuses populated venue cover state' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER inactive_venue_cover ON users;
DROP FUNCTION retire_inactive_venue_cover();
DROP TRIGGER venue_cover_cleanup ON venues;
DROP FUNCTION venue_cover_url(uuid);
ALTER TABLE venues DROP CONSTRAINT venue_cover_binding;
ALTER TABLE venues DROP COLUMN cover_key, DROP COLUMN cover_moderation_approval_id, DROP COLUMN cover_actor_id;
DELETE FROM schema_migrations WHERE id='0034_venue_cover';
