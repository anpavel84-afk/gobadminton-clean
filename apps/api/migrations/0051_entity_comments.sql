-- #394 public entity comments (game + venue first slice). Additive only.
-- Fixed kinds game|venue with real UUID parent invariants. One reply depth.
-- Edit/delete audit retained privately; public projection never exposes deleted body.

CREATE TABLE entity_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  entity_kind text NOT NULL
    CHECK (entity_kind IN ('game', 'venue')),
  entity_id uuid NOT NULL,
  parent_comment_id uuid NULL REFERENCES entity_comments (id),
  author_user_id uuid NOT NULL REFERENCES users (id),
  body text NULL
    CHECK (body IS NULL OR (char_length(body) BETWEEN 1 AND 1000 AND body ~ '[^[:space:]]')),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (deleted_at IS NULL AND body IS NOT NULL)
    OR (deleted_at IS NOT NULL AND body IS NULL)
  ),
  CHECK (
    parent_comment_id IS NULL
    OR parent_comment_id <> id
  )
);

CREATE INDEX entity_comments_entity_root_created_idx
  ON entity_comments (entity_kind, entity_id, created_at, id)
  WHERE parent_comment_id IS NULL;

CREATE INDEX entity_comments_entity_reply_created_idx
  ON entity_comments (entity_kind, entity_id, parent_comment_id, created_at, id)
  WHERE parent_comment_id IS NOT NULL;

CREATE INDEX entity_comments_author_created_idx
  ON entity_comments (author_user_id, created_at DESC, id);

CREATE TABLE entity_comment_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  comment_id uuid NOT NULL REFERENCES entity_comments (id),
  entity_kind text NOT NULL
    CHECK (entity_kind IN ('game', 'venue')),
  entity_id uuid NOT NULL,
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  before_body text NULL
    CHECK (before_body IS NULL OR char_length(before_body) BETWEEN 1 AND 1000),
  after_body text NULL
    CHECK (after_body IS NULL OR char_length(after_body) BETWEEN 1 AND 1000),
  tombstone boolean NOT NULL DEFAULT false,
  CONSTRAINT entity_comment_revisions_version_uidx
    UNIQUE (comment_id, resource_version),
  CHECK (
    (
      resource_version = 1
      AND before_body IS NULL
      AND tombstone = false
      AND after_body IS NOT NULL
    )
    OR (
      resource_version > 1
      AND (
        (tombstone = false AND after_body IS NOT NULL AND before_body IS NOT NULL)
        OR (tombstone = true AND after_body IS NULL AND before_body IS NOT NULL)
      )
    )
  )
);

CREATE INDEX entity_comment_revisions_entity_recorded_idx
  ON entity_comment_revisions (entity_kind, entity_id, recorded_at, resource_version);

CREATE FUNCTION entity_comment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent entity_comments%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'initial comment must be live version 1' USING ERRCODE = '23514';
    END IF;
    IF NEW.entity_kind = 'game' THEN
      IF NOT EXISTS (SELECT 1 FROM games g WHERE g.id = NEW.entity_id) THEN
        RAISE EXCEPTION 'comment game parent missing' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.entity_kind = 'venue' THEN
      IF NOT EXISTS (
        SELECT 1 FROM venues v
        WHERE v.id = NEW.entity_id
          AND v.lifecycle_state IN ('unverified', 'verified')
          AND v.canonical_venue_id IS NULL
      ) THEN
        RAISE EXCEPTION 'comment venue parent missing' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.parent_comment_id IS NOT NULL THEN
      SELECT * INTO parent FROM entity_comments WHERE id = NEW.parent_comment_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'reply parent missing' USING ERRCODE = '23514';
      END IF;
      IF parent.parent_comment_id IS NOT NULL THEN
        RAISE EXCEPTION 'reply-to-reply rejected' USING ERRCODE = '23514';
      END IF;
      IF parent.entity_kind IS DISTINCT FROM NEW.entity_kind
         OR parent.entity_id IS DISTINCT FROM NEW.entity_id THEN
        RAISE EXCEPTION 'reply must bind same entity' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.entity_kind, NEW.entity_id, NEW.parent_comment_id, NEW.author_user_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.entity_kind, OLD.entity_id, OLD.parent_comment_id, OLD.author_user_id, OLD.created_at)
      OR NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'invalid comment transition' USING ERRCODE = '23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'tombstoned comment cannot resurrect' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER entity_comments_guard
  BEFORE INSERT OR UPDATE ON entity_comments
  FOR EACH ROW EXECUTE FUNCTION entity_comment_guard();

CREATE FUNCTION deny_entity_comment_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'entity comment history is retained' USING ERRCODE = '23514';
END $$;

DO $$
DECLARE
  comments regclass := 'entity_comments'::regclass;
  revisions regclass := 'entity_comment_revisions'::regclass;
BEGIN
  EXECUTE format('CREATE TRIGGER entity_comments_deny_delete BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_entity_comment_history_rewrite()', comments);
  EXECUTE format('CREATE TRIGGER entity_comments_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_entity_comment_history_rewrite()', comments);
  EXECUTE format('CREATE TRIGGER entity_comment_revisions_immutable BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_entity_comment_history_rewrite()', revisions);
  EXECUTE format('CREATE TRIGGER entity_comment_revisions_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_entity_comment_history_rewrite()', revisions);
END $$;
