-- Additive public attribution; writes remain outside the consumer API.
ALTER TABLE venues
 ADD COLUMN cover_credit_kind text,
 ADD COLUMN cover_credit_text text CHECK (char_length(cover_credit_text) <= 120),
 ADD COLUMN cover_credit_url text CHECK (char_length(cover_credit_url) <= 300 AND cover_credit_url ~ '^https://'),
 ADD CONSTRAINT venue_cover_credit_shape CHECK ((
   (cover_credit_kind IS NULL AND cover_credit_text IS NULL AND cover_credit_url IS NULL)
   OR (cover_key IS NOT NULL AND (
     (cover_credit_kind = 'illustration' AND cover_credit_text = 'Иллюстрация' AND cover_credit_url IS NULL)
     OR (cover_credit_kind = 'photo' AND cover_credit_text LIKE 'Фото: %' AND cover_credit_url IS NOT NULL)
     OR (cover_credit_kind = 'logo' AND cover_credit_text LIKE 'Логотип: %' AND cover_credit_url IS NOT NULL)
   ))
 ) IS TRUE);

CREATE FUNCTION clear_stale_venue_cover_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.cover_key IS DISTINCT FROM OLD.cover_key
    AND NEW.cover_credit_kind IS NOT DISTINCT FROM OLD.cover_credit_kind
    AND NEW.cover_credit_text IS NOT DISTINCT FROM OLD.cover_credit_text
    AND NEW.cover_credit_url IS NOT DISTINCT FROM OLD.cover_credit_url THEN
  NEW.cover_credit_kind := NULL;
  NEW.cover_credit_text := NULL;
  NEW.cover_credit_url := NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER venue_cover_credit_reset BEFORE UPDATE OF cover_key ON venues
 FOR EACH ROW EXECUTE FUNCTION clear_stale_venue_cover_credit();
