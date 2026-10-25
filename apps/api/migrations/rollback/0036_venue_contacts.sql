-- Только откат незаполненной установки; обычный откат API сохраняет схему.
LOCK TABLE venues IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM venues WHERE contact_phone IS NOT NULL OR contact_website IS NOT NULL
            OR booking_note IS NOT NULL OR contact_updated_at IS NOT NULL) THEN
  RAISE EXCEPTION '0036: откат запрещён при наличии контактных данных' USING ERRCODE='23514';
 END IF;
END $$;
ALTER TABLE venues DROP COLUMN contact_phone, DROP COLUMN contact_website,
 DROP COLUMN booking_note, DROP COLUMN contact_updated_at;
DELETE FROM schema_migrations WHERE id='0036_venue_contacts';
