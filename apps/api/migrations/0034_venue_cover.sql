-- Additive venue-owned slot in the existing sanitized media store.
ALTER TABLE venues ADD COLUMN cover_key text UNIQUE
  CHECK (cover_key IS NULL OR cover_key ~ '^[a-f0-9]{64}\.png$');
ALTER TABLE venues ADD COLUMN cover_moderation_approval_id uuid REFERENCES content_moderation_approvals(id);
ALTER TABLE venues ADD COLUMN cover_actor_id uuid REFERENCES users(id);
ALTER TABLE venues ADD CONSTRAINT venue_cover_binding CHECK
  ((cover_key IS NULL AND cover_moderation_approval_id IS NULL AND cover_actor_id IS NULL)
   OR (cover_key IS NOT NULL AND cover_moderation_approval_id IS NOT NULL AND cover_actor_id IS NOT NULL));
CREATE FUNCTION venue_cover_url(venue_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT '/v1/media/venue-covers/' || v.cover_key FROM venues v
  JOIN content_moderation_approvals a ON a.id=v.cover_moderation_approval_id
  JOIN users u ON u.id=v.cover_actor_id
  WHERE v.id=venue_id AND v.lifecycle_state IN ('unverified','verified')
    AND u.status='active' AND a.decision='allow' AND a.surface_key='cover_image'
$$;
CREATE TRIGGER venue_cover_cleanup AFTER UPDATE OF cover_key OR DELETE ON venues
  FOR EACH ROW EXECUTE FUNCTION queue_owned_cover_cleanup();
-- Account retirement cannot leave media that reappears on a later status transition.
CREATE FUNCTION retire_inactive_venue_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE venues SET cover_key=NULL,cover_moderation_approval_id=NULL,cover_actor_id=NULL,
      version=version+1,updated_at=now() WHERE cover_actor_id=NEW.id AND cover_key IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER inactive_venue_cover AFTER UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION retire_inactive_venue_cover();
