-- #507 I2b. Immutable exact-revision attachments; no approval/history rewrite.
ALTER TABLE entity_comments DROP CONSTRAINT entity_comments_check;
ALTER TABLE entity_comments ADD CONSTRAINT entity_comments_live_body CHECK (
  (deleted_at IS NOT NULL AND body IS NULL) OR
  (deleted_at IS NULL AND (body IS NOT NULL OR entity_kind='venue'))
);
ALTER TABLE entity_comment_revisions DROP CONSTRAINT entity_comment_revisions_check;
ALTER TABLE entity_comment_revisions ADD CONSTRAINT entity_comment_revision_body CHECK (
  (NOT tombstone AND (after_body IS NOT NULL OR entity_kind='venue')) OR
  (tombstone AND after_body IS NULL AND resource_version>1)
);
CREATE TABLE entity_comment_photo_origins (
  photo_id uuid PRIMARY KEY REFERENCES venue_photo_submissions(id),
  comment_id uuid NOT NULL REFERENCES entity_comments(id),
  first_published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(photo_id,comment_id)
);
CREATE TABLE entity_comment_photos (
  comment_id uuid NOT NULL,
  resource_version integer NOT NULL,
  photo_id uuid NOT NULL,
  position integer NOT NULL CHECK(position BETWEEN 0 AND 3),
  PRIMARY KEY(comment_id,resource_version,position),
  UNIQUE(comment_id,resource_version,photo_id),
  FOREIGN KEY(comment_id,resource_version) REFERENCES entity_comment_revisions(comment_id,resource_version),
  FOREIGN KEY(photo_id,comment_id) REFERENCES entity_comment_photo_origins(photo_id,comment_id)
);
CREATE INDEX entity_comment_photos_photo ON entity_comment_photos(photo_id);
CREATE FUNCTION entity_comment_photo_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c entity_comments%ROWTYPE; s venue_photo_submissions%ROWTYPE; origin uuid;
BEGIN
  SELECT * INTO c FROM entity_comments WHERE id=NEW.comment_id FOR UPDATE;
  SELECT * INTO s FROM venue_photo_submissions WHERE id=NEW.photo_id FOR UPDATE;
  SELECT comment_id INTO origin FROM entity_comment_photo_origins WHERE photo_id=NEW.photo_id;
  IF c.entity_kind<>'venue' OR c.deleted_at IS NOT NULL OR c.version<>NEW.resource_version
    OR s.owner_user_id<>c.author_user_id OR s.status<>'ready' OR s.version<>1
    OR (origin IS NOT NULL AND origin<>c.id)
    OR (NOT EXISTS(SELECT 1 FROM entity_comment_photos p WHERE p.comment_id=c.id
          AND p.resource_version=c.version-1 AND p.photo_id=s.id)
        AND (origin IS NOT NULL OR s.expires_at<=clock_timestamp()))
    OR NOT EXISTS(SELECT 1 FROM content_moderation_approvals a WHERE a.id=s.image_approval_id
       AND a.content_type='image' AND a.surface_key='community_photo_image' AND a.decision='allow'
       AND a.policy_version='community-photo-image-v1:inside1600-ladder-v1'
       AND a.local_policy_version='none' AND a.fingerprint_version=1
       AND a.provider_model='omni-moderation-2024-09-26') THEN
    RAISE EXCEPTION 'invalid current comment photo' USING ERRCODE='23514';
  END IF;
  -- New stages must still belong to the current canonical publication venue.
  IF origin IS NULL AND NOT EXISTS(
    WITH RECURSIVE family AS (
      SELECT id FROM venues WHERE id=s.venue_id AND canonical_venue_id IS NULL
        AND lifecycle_state IN ('unverified','verified')
      UNION SELECT v.id FROM venues v JOIN family f ON v.canonical_venue_id=f.id WHERE v.lifecycle_state='merged'
    ) SELECT 1 FROM family WHERE id=c.entity_id
  ) THEN RAISE EXCEPTION 'photo venue changed' USING ERRCODE='23514'; END IF;
  INSERT INTO entity_comment_photo_origins(photo_id,comment_id) VALUES(s.id,c.id) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM entity_comment_photo_origins WHERE photo_id=s.id AND comment_id=c.id) THEN
    RAISE EXCEPTION 'photo origin conflict' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entity_comment_photo_guard BEFORE INSERT ON entity_comment_photos
FOR EACH ROW EXECUTE FUNCTION entity_comment_photo_guard();
CREATE FUNCTION entity_comment_photo_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid; c entity_comments%ROWTYPE; r entity_comment_revisions%ROWTYPE; n integer; top integer;
BEGIN
  IF TG_TABLE_NAME='entity_comments' THEN cid=NEW.id; ELSE cid=NEW.comment_id; END IF;
  SELECT * INTO c FROM entity_comments WHERE id=cid;
  SELECT * INTO r FROM entity_comment_revisions WHERE comment_id=cid AND resource_version=c.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'current comment revision missing' USING ERRCODE='23514'; END IF;
  SELECT count(*),max(position) INTO n,top FROM entity_comment_photos WHERE comment_id=cid AND resource_version=c.version;
  IF n>4 OR (n>0 AND top<>n-1) OR (c.entity_kind='game' AND (n<>0 OR (c.deleted_at IS NULL AND c.body IS NULL)))
    OR (c.body IS NOT NULL AND btrim(c.body, E' \t\n\r\013\f' ||
      U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='')
    OR (c.deleted_at IS NULL AND c.body IS NULL AND n=0)
    OR (c.deleted_at IS NOT NULL AND (c.body IS NOT NULL OR n<>0))
    OR r.after_body IS DISTINCT FROM c.body OR r.tombstone IS DISTINCT FROM (c.deleted_at IS NOT NULL)
    OR r.entity_kind<>c.entity_kind OR r.entity_id<>c.entity_id THEN
    RAISE EXCEPTION 'comment text/photo revision inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entity_comment_photo_consistency AFTER INSERT OR UPDATE ON entity_comments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entity_comment_photo_consistency();
CREATE CONSTRAINT TRIGGER entity_comment_revision_photo_consistency AFTER INSERT ON entity_comment_revisions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entity_comment_photo_consistency();
CREATE CONSTRAINT TRIGGER entity_comment_binding_consistency AFTER INSERT ON entity_comment_photos
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION entity_comment_photo_consistency();
CREATE TRIGGER entity_comment_photos_immutable BEFORE UPDATE OR DELETE ON entity_comment_photos
FOR EACH ROW EXECUTE FUNCTION deny_entity_comment_history_rewrite();
CREATE TRIGGER entity_comment_photos_no_truncate BEFORE TRUNCATE ON entity_comment_photos
FOR EACH STATEMENT EXECUTE FUNCTION deny_entity_comment_history_rewrite();
CREATE TRIGGER entity_comment_photo_origins_immutable BEFORE UPDATE OR DELETE ON entity_comment_photo_origins
FOR EACH ROW EXECUTE FUNCTION deny_entity_comment_history_rewrite();
CREATE TRIGGER entity_comment_photo_origins_no_truncate BEFORE TRUNCATE ON entity_comment_photo_origins
FOR EACH STATEMENT EXECUTE FUNCTION deny_entity_comment_history_rewrite();

CREATE FUNCTION entity_comment_revision_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c entity_comments%ROWTYPE; prior entity_comment_revisions%ROWTYPE;
BEGIN
  SELECT * INTO c FROM entity_comments WHERE id=NEW.comment_id FOR SHARE;
  IF NOT FOUND OR NEW.resource_version<>c.version OR NEW.entity_kind<>c.entity_kind
    OR NEW.entity_id<>c.entity_id OR NEW.after_body IS DISTINCT FROM c.body
    OR NEW.tombstone IS DISTINCT FROM (c.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'revision must bind current comment' USING ERRCODE='23514';
  END IF;
  IF NEW.resource_version=1 THEN
    IF NEW.before_body IS NOT NULL OR NEW.tombstone THEN RAISE EXCEPTION 'invalid first revision' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO prior FROM entity_comment_revisions WHERE comment_id=NEW.comment_id AND resource_version=NEW.resource_version-1;
    IF NOT FOUND OR prior.tombstone OR NEW.before_body IS DISTINCT FROM prior.after_body THEN
      RAISE EXCEPTION 'revision must retain previous body' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entity_comment_revision_insert_guard BEFORE INSERT ON entity_comment_revisions
FOR EACH ROW EXECUTE FUNCTION entity_comment_revision_insert_guard();
CREATE FUNCTION published_photo_withdraw_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM entity_comment_photo_origins WHERE photo_id=NEW.id) THEN
    RAISE EXCEPTION 'published photo withdrawal requires source comment edit/delete' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER published_photo_withdraw_guard BEFORE UPDATE ON venue_photo_submissions
FOR EACH ROW EXECUTE FUNCTION published_photo_withdraw_guard();
