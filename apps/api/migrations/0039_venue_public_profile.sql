-- Additive facts only: NULL is unknown; no defaults, backfill or private data copy.
ALTER TABLE venues
  ADD COLUMN court_count integer CHECK (court_count >= 0),
  ADD COLUMN amenity_parking boolean,
  ADD COLUMN amenity_showers boolean,
  ADD COLUMN public_profile_updated_at timestamptz;

-- Runs after venue_cover_credit_reset (PostgreSQL orders BEFORE triggers by name).
-- This date describes stored content edits, not verification or dynamic visibility.
CREATE FUNCTION record_venue_public_profile_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
    -- Ignore supplied dates, private/generic timestamps and lifecycle/version writes.
    NEW.public_profile_updated_at := OLD.public_profile_updated_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER venue_public_profile_change BEFORE INSERT OR UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION record_venue_public_profile_change();
