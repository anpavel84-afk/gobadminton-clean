-- Optional UNUSED installation rollback only. Caller owns transaction and stops writers.
LOCK TABLE venues IN ACCESS EXCLUSIVE MODE;
LOCK TABLE venue_gallery_items IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM venue_gallery_items)
     OR EXISTS (SELECT 1 FROM venues WHERE public_description IS NOT NULL) THEN
    RAISE EXCEPTION '0045 rollback refuses populated venue gallery/description state' USING ERRCODE='23514';
  END IF;
END $$;
DROP TRIGGER IF EXISTS venue_gallery_cleanup ON venue_gallery_items;
DROP FUNCTION IF EXISTS queue_venue_gallery_cleanup();
DROP FUNCTION IF EXISTS venue_gallery_item_url(uuid);
DROP TABLE IF EXISTS venue_gallery_items;
-- Restore prior public-profile trigger body (description column removed after).
CREATE OR REPLACE FUNCTION record_venue_public_profile_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.public_profile_updated_at := clock_timestamp();
  ELSIF ROW(NEW.name, NEW.address, NEW.timezone, ST_AsEWKB(NEW.location::geometry),
      NEW.identity_discriminator, NEW.public_contacts,
      NEW.court_count, NEW.amenity_parking, NEW.amenity_showers,
      NEW.cover_key, NEW.cover_moderation_approval_id, NEW.cover_actor_id,
      NEW.cover_credit_kind, NEW.cover_credit_text, NEW.cover_credit_url)
    IS DISTINCT FROM
    ROW(OLD.name, OLD.address, OLD.timezone, ST_AsEWKB(OLD.location::geometry),
      OLD.identity_discriminator, OLD.public_contacts,
      OLD.court_count, OLD.amenity_parking, OLD.amenity_showers,
      OLD.cover_key, OLD.cover_moderation_approval_id, OLD.cover_actor_id,
      OLD.cover_credit_kind, OLD.cover_credit_text, OLD.cover_credit_url) THEN
    NEW.public_profile_updated_at := clock_timestamp();
  ELSE
    NEW.public_profile_updated_at := OLD.public_profile_updated_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION retire_inactive_venue_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE venues SET cover_key=NULL,cover_moderation_approval_id=NULL,cover_actor_id=NULL,
      version=version+1,updated_at=now() WHERE cover_actor_id=NEW.id AND cover_key IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
ALTER TABLE venues DROP COLUMN IF EXISTS public_description;
DELETE FROM schema_migrations WHERE id='0045_venue_gallery';
