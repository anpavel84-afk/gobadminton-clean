-- Ordered venue-owned gallery (max 8) + short public description.
-- Existing cover_* columns remain the projected main for games/old clients.

ALTER TABLE venues
  ADD COLUMN public_description text
    CHECK (public_description IS NULL OR (char_length(public_description) BETWEEN 1 AND 500
      AND public_description = btrim(public_description)
      AND public_description !~ '[[:cntrl:]]'));

CREATE TABLE venue_gallery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  position smallint NOT NULL CHECK (position >= 0 AND position < 8),
  is_main boolean NOT NULL DEFAULT false,
  storage_key text NOT NULL UNIQUE
    CHECK (storage_key ~ '^[a-f0-9]{64}\.png$'),
  moderation_approval_id uuid NOT NULL REFERENCES content_moderation_approvals(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  credit_kind text NOT NULL CHECK (credit_kind IN ('photo', 'logo', 'illustration')),
  credit_text text NOT NULL CHECK (char_length(credit_text) <= 120),
  credit_url text CHECK (credit_url IS NULL OR (char_length(credit_url) <= 300 AND credit_url ~ '^https://')),
  source_url text CHECK (source_url IS NULL OR (char_length(source_url) <= 300 AND source_url ~ '^https://')),
  source_author text CHECK (source_author IS NULL OR (char_length(source_author) BETWEEN 1 AND 120
    AND source_author = btrim(source_author) AND source_author !~ '[[:cntrl:]]')),
  permission_basis text NOT NULL CHECK (char_length(permission_basis) BETWEEN 1 AND 600
    AND permission_basis = btrim(permission_basis) AND permission_basis !~ '[[:cntrl:]]'),
  source_fingerprint text CHECK (source_fingerprint IS NULL OR source_fingerprint ~ '^[a-f0-9]{64}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_gallery_credit_shape CHECK ((
    (credit_kind = 'illustration' AND credit_text = 'Иллюстрация' AND credit_url IS NULL)
    OR (credit_kind = 'photo' AND credit_text LIKE 'Фото: %' AND credit_url IS NOT NULL)
    OR (credit_kind = 'logo' AND credit_text LIKE 'Логотип: %' AND credit_url IS NOT NULL)
  ) IS TRUE),
  CONSTRAINT venue_gallery_photo_source CHECK (
    credit_kind <> 'photo' OR source_url IS NOT NULL OR permission_basis = 'legacy_preserved_unknown'
  )
);

CREATE UNIQUE INDEX venue_gallery_active_position
  ON venue_gallery_items (venue_id, position) WHERE active;
CREATE UNIQUE INDEX venue_gallery_one_main
  ON venue_gallery_items (venue_id) WHERE active AND is_main;
CREATE INDEX venue_gallery_venue_active ON venue_gallery_items (venue_id) WHERE active;
CREATE INDEX venue_gallery_actor_active ON venue_gallery_items (actor_id) WHERE active;

-- Public URL only while venue lifecycle, uploader, and cover_image allow approval hold.
CREATE FUNCTION venue_gallery_item_url(item_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT '/v1/media/venue-covers/' || g.storage_key
  FROM venue_gallery_items g
  JOIN venues v ON v.id = g.venue_id
  JOIN content_moderation_approvals a ON a.id = g.moderation_approval_id
  JOIN users u ON u.id = g.actor_id
  WHERE g.id = item_id AND g.active
    AND v.lifecycle_state IN ('unverified', 'verified')
    AND u.status = 'active' AND a.decision = 'allow' AND a.surface_key = 'cover_image'
$$;

CREATE FUNCTION queue_venue_gallery_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storage_key IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR OLD.storage_key IS DISTINCT FROM NEW.storage_key OR (TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active AND NEW.active = false) THEN
      INSERT INTO avatar_media_gc(storage_key) VALUES (OLD.storage_key) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER venue_gallery_cleanup
  AFTER UPDATE OF storage_key, active OR DELETE ON venue_gallery_items
  FOR EACH ROW EXECUTE FUNCTION queue_venue_gallery_cleanup();

-- Account retirement cannot leave gallery media that reappears on reactivation.
CREATE OR REPLACE FUNCTION retire_inactive_venue_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE venues SET cover_key = NULL, cover_moderation_approval_id = NULL, cover_actor_id = NULL,
      cover_credit_kind = NULL, cover_credit_text = NULL, cover_credit_url = NULL,
      version = version + 1, updated_at = now()
      WHERE cover_actor_id = NEW.id AND cover_key IS NOT NULL;
    UPDATE venue_gallery_items SET active = false, is_main = false, updated_at = now()
      WHERE actor_id = NEW.id AND active;
  END IF;
  RETURN NULL;
END;
$$;

-- Keep public_profile_updated_at honest for description edits.
CREATE OR REPLACE FUNCTION record_venue_public_profile_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.public_profile_updated_at := clock_timestamp();
  ELSIF ROW(NEW.name, NEW.address, NEW.timezone, ST_AsEWKB(NEW.location::geometry),
      NEW.identity_discriminator, NEW.public_contacts,
      NEW.court_count, NEW.amenity_parking, NEW.amenity_showers, NEW.public_description,
      NEW.cover_key, NEW.cover_moderation_approval_id, NEW.cover_actor_id,
      NEW.cover_credit_kind, NEW.cover_credit_text, NEW.cover_credit_url)
    IS DISTINCT FROM
    ROW(OLD.name, OLD.address, OLD.timezone, ST_AsEWKB(OLD.location::geometry),
      OLD.identity_discriminator, OLD.public_contacts,
      OLD.court_count, OLD.amenity_parking, OLD.amenity_showers, OLD.public_description,
      OLD.cover_key, OLD.cover_moderation_approval_id, OLD.cover_actor_id,
      OLD.cover_credit_kind, OLD.cover_credit_text, OLD.cover_credit_url) THEN
    NEW.public_profile_updated_at := clock_timestamp();
  ELSE
    NEW.public_profile_updated_at := OLD.public_profile_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill: every existing cover becomes gallery position 0 / main, including logo/illustration.
-- Permission/source recovered from retained cover-import audit when present; else legacy_preserved_unknown.
INSERT INTO venue_gallery_items (
  id, venue_id, position, is_main, storage_key, moderation_approval_id, actor_id,
  credit_kind, credit_text, credit_url, source_url, source_author, permission_basis, source_fingerprint
)
SELECT gen_random_uuid(), v.id, 0, true, v.cover_key, v.cover_moderation_approval_id, v.cover_actor_id,
  CASE
    WHEN v.cover_credit_kind = 'photo' AND v.cover_credit_text LIKE 'Фото: %' AND v.cover_credit_url IS NOT NULL THEN 'photo'
    WHEN v.cover_credit_kind = 'logo' AND v.cover_credit_text LIKE 'Логотип: %' AND v.cover_credit_url IS NOT NULL THEN 'logo'
    WHEN v.cover_credit_kind = 'illustration' AND v.cover_credit_text = 'Иллюстрация' AND v.cover_credit_url IS NULL THEN 'illustration'
    ELSE 'illustration'
  END,
  CASE
    WHEN v.cover_credit_kind = 'photo' AND v.cover_credit_text LIKE 'Фото: %' AND v.cover_credit_url IS NOT NULL THEN v.cover_credit_text
    WHEN v.cover_credit_kind = 'logo' AND v.cover_credit_text LIKE 'Логотип: %' AND v.cover_credit_url IS NOT NULL THEN v.cover_credit_text
    WHEN v.cover_credit_kind = 'illustration' AND v.cover_credit_text = 'Иллюстрация' AND v.cover_credit_url IS NULL THEN 'Иллюстрация'
    ELSE 'Иллюстрация'
  END,
  CASE
    WHEN v.cover_credit_kind = 'photo' AND v.cover_credit_text LIKE 'Фото: %' AND v.cover_credit_url IS NOT NULL THEN v.cover_credit_url
    WHEN v.cover_credit_kind = 'logo' AND v.cover_credit_text LIKE 'Логотип: %' AND v.cover_credit_url IS NOT NULL THEN v.cover_credit_url
    ELSE NULL
  END,
  CASE
    WHEN v.cover_credit_kind = 'photo' AND v.cover_credit_text LIKE 'Фото: %' AND v.cover_credit_url IS NOT NULL THEN v.cover_credit_url
    ELSE NULL
  END,
  NULL,
  COALESCE(
    (SELECT CASE
       WHEN NULLIF(BTRIM(a.after_diff->>'basis_note'), '') IS NOT NULL
         THEN LEFT(BTRIM(a.after_diff->>'basis_note'), 600)
       ELSE NULL
     END
     FROM privileged_audit_events a
     WHERE a.target_type = 'venue' AND a.target_id = v.id::text
       AND a.action_key = 'venue.cover_changed'
       AND a.reason_code = 'venue_cover_batch_import'
       AND a.after_diff ? 'basis_note'
     ORDER BY a.created_at DESC LIMIT 1),
    'legacy_preserved_unknown'
  ),
  (SELECT LOWER(a.after_diff->>'sha256')
   FROM privileged_audit_events a
   WHERE a.target_type = 'venue' AND a.target_id = v.id::text
     AND a.action_key = 'venue.cover_changed'
     AND a.reason_code = 'venue_cover_batch_import'
     AND COALESCE(a.after_diff->>'sha256', '') ~ '^[a-fA-F0-9]{64}$'
   ORDER BY a.created_at DESC LIMIT 1)
FROM venues v
WHERE v.cover_key IS NOT NULL
  AND v.cover_moderation_approval_id IS NOT NULL
  AND v.cover_actor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM venue_gallery_items g WHERE g.venue_id = v.id AND g.active);
