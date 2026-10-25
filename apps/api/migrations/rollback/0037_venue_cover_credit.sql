-- Only empty installations may remove this additive schema.
LOCK TABLE venues IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM venues WHERE cover_credit_kind IS NOT NULL
            OR cover_credit_text IS NOT NULL OR cover_credit_url IS NOT NULL) THEN
  RAISE EXCEPTION '0037: rollback forbidden while cover credits exist' USING ERRCODE='23514';
 END IF;
END $$;
DROP TRIGGER venue_cover_credit_reset ON venues;
DROP FUNCTION clear_stale_venue_cover_credit();
ALTER TABLE venues DROP CONSTRAINT venue_cover_credit_shape,
 DROP COLUMN cover_credit_kind, DROP COLUMN cover_credit_text, DROP COLUMN cover_credit_url;
DELETE FROM schema_migrations WHERE id='0037_venue_cover_credit';
