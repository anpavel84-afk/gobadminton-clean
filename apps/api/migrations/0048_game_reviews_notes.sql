-- PG-3 / #372. Additive private reviews + personal notes.
-- Does not edit 0042/0046/0047. Writes remain gated by POST_GAME_INTERNAL_ENABLED.
-- Catalog lookups bind to search_path-resolved table OID so dual-schema apply
-- cannot skip the wrong schema's constraints/triggers by relname alone.

CREATE TABLE game_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  kind text NOT NULL
    CHECK (kind IN ('peer', 'organization', 'training')),
  author_user_id uuid NOT NULL REFERENCES users (id),
  author_participation_id uuid NULL REFERENCES participations (id),
  subject_participation_id uuid NULL REFERENCES participations (id),
  recipient_user_id uuid NOT NULL REFERENCES users (id),
  peer_rating text NULL
    CHECK (peer_rating IS NULL OR peer_rating IN ('play_again', 'neutral', 'difficulties')),
  organization_score smallint NULL
    CHECK (organization_score IS NULL OR organization_score BETWEEN 1 AND 5),
  comment text NULL
    CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 500),
  tags text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (
      cardinality(tags) <= 3
      AND tags <@ ARRAY['communication', 'teamwork', 'agreements']::text[]
    ),
  experience_assertion text NOT NULL
    CHECK (experience_assertion IN ('i_experienced_this_game')),
  discrepancy_explanation text NULL
    CHECK (
      discrepancy_explanation IS NULL
      OR char_length(discrepancy_explanation) BETWEEN 1 AND 500
    ),
  attendance_context text NOT NULL
    CHECK (attendance_context IN (
      'present',
      'absent',
      'unknown',
      'contested',
      'not_participant_manager',
      'outcome_not_held'
    )),
  outcome_context text NOT NULL
    CHECK (outcome_context IN ('unknown', 'held', 'not_held')),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  edited_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (kind = 'peer'
      AND subject_participation_id IS NOT NULL
      AND peer_rating IS NOT NULL
      AND organization_score IS NULL)
    OR (kind = 'organization'
      AND subject_participation_id IS NULL
      AND peer_rating IS NULL
      AND (organization_score IS NOT NULL OR comment IS NOT NULL)
      AND cardinality(tags) = 0)
    OR (kind = 'training'
      AND subject_participation_id IS NULL
      AND peer_rating IS NULL
      AND organization_score IS NULL
      AND comment IS NOT NULL
      AND cardinality(tags) = 0)
  ),
  CHECK (author_user_id <> recipient_user_id),
  CHECK (
    attendance_context IN ('present', 'not_participant_manager')
    OR discrepancy_explanation IS NOT NULL
  )
);

CREATE UNIQUE INDEX game_reviews_peer_unique_uidx
  ON game_reviews (game_id, author_user_id, subject_participation_id)
  WHERE kind = 'peer';

CREATE UNIQUE INDEX game_reviews_organization_unique_uidx
  ON game_reviews (game_id, author_user_id)
  WHERE kind = 'organization';

CREATE UNIQUE INDEX game_reviews_training_unique_uidx
  ON game_reviews (game_id, author_user_id)
  WHERE kind = 'training';

CREATE INDEX game_reviews_author_created_idx
  ON game_reviews (author_user_id, created_at DESC, id);

CREATE INDEX game_reviews_recipient_created_idx
  ON game_reviews (recipient_user_id, created_at DESC, id);

CREATE INDEX game_reviews_game_kind_idx
  ON game_reviews (game_id, kind, created_at DESC);

CREATE TABLE game_review_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  review_id uuid NOT NULL REFERENCES game_reviews (id),
  game_id uuid NOT NULL REFERENCES games (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  before_peer_rating text NULL
    CHECK (before_peer_rating IS NULL OR before_peer_rating IN ('play_again', 'neutral', 'difficulties')),
  after_peer_rating text NULL
    CHECK (after_peer_rating IS NULL OR after_peer_rating IN ('play_again', 'neutral', 'difficulties')),
  before_organization_score smallint NULL
    CHECK (before_organization_score IS NULL OR before_organization_score BETWEEN 1 AND 5),
  after_organization_score smallint NULL
    CHECK (after_organization_score IS NULL OR after_organization_score BETWEEN 1 AND 5),
  before_comment text NULL
    CHECK (before_comment IS NULL OR char_length(before_comment) BETWEEN 1 AND 500),
  after_comment text NULL
    CHECK (after_comment IS NULL OR char_length(after_comment) BETWEEN 1 AND 500),
  before_tags text[] NULL,
  after_tags text[] NOT NULL DEFAULT '{}'::text[],
  before_discrepancy_explanation text NULL
    CHECK (
      before_discrepancy_explanation IS NULL
      OR char_length(before_discrepancy_explanation) BETWEEN 1 AND 500
    ),
  after_discrepancy_explanation text NULL
    CHECK (
      after_discrepancy_explanation IS NULL
      OR char_length(after_discrepancy_explanation) BETWEEN 1 AND 500
    ),
  CONSTRAINT game_review_revisions_version_uidx
    UNIQUE (review_id, resource_version),
  CHECK (
    (
      resource_version = 1
      AND before_peer_rating IS NULL
      AND before_organization_score IS NULL
      AND before_comment IS NULL
      AND before_tags IS NULL
      AND before_discrepancy_explanation IS NULL
    )
    OR (
      resource_version > 1
      AND before_tags IS NOT NULL
    )
  )
);

CREATE INDEX game_review_revisions_game_recorded_idx
  ON game_review_revisions (game_id, recorded_at, resource_version);

CREATE TABLE game_review_replies (
  review_id uuid PRIMARY KEY REFERENCES game_reviews (id),
  game_id uuid NOT NULL REFERENCES games (id),
  author_user_id uuid NOT NULL REFERENCES users (id),
  text text NOT NULL
    CHECK (char_length(text) BETWEEN 1 AND 500),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  edited_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE game_review_reply_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  review_id uuid NOT NULL REFERENCES game_review_replies (review_id),
  game_id uuid NOT NULL REFERENCES games (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  before_text text NULL
    CHECK (before_text IS NULL OR char_length(before_text) BETWEEN 1 AND 500),
  after_text text NOT NULL
    CHECK (char_length(after_text) BETWEEN 1 AND 500),
  CONSTRAINT game_review_reply_revisions_version_uidx
    UNIQUE (review_id, resource_version),
  CHECK (
    (resource_version = 1 AND before_text IS NULL)
    OR (resource_version > 1 AND before_text IS NOT NULL)
  )
);

CREATE INDEX game_review_reply_revisions_game_recorded_idx
  ON game_review_reply_revisions (game_id, recorded_at, resource_version);

CREATE TABLE game_personal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  context_id uuid NOT NULL REFERENCES participations (id),
  author_user_id uuid NOT NULL REFERENCES users (id),
  subject_user_id uuid NOT NULL REFERENCES users (id),
  text text NULL
    CHECK (text IS NULL OR char_length(text) BETWEEN 1 AND 500),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (deleted_at IS NULL AND text IS NOT NULL)
    OR (deleted_at IS NOT NULL AND text IS NULL)
  ),
  CONSTRAINT game_personal_notes_author_context_uidx
    UNIQUE (game_id, context_id, author_user_id)
);

CREATE INDEX game_personal_notes_author_updated_idx
  ON game_personal_notes (author_user_id, updated_at DESC, id);

CREATE TABLE game_personal_note_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  note_id uuid NOT NULL REFERENCES game_personal_notes (id),
  game_id uuid NOT NULL REFERENCES games (id),
  context_id uuid NOT NULL REFERENCES participations (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  before_text text NULL
    CHECK (before_text IS NULL OR char_length(before_text) BETWEEN 1 AND 500),
  after_text text NULL
    CHECK (after_text IS NULL OR char_length(after_text) BETWEEN 1 AND 500),
  tombstone boolean NOT NULL DEFAULT false,
  CONSTRAINT game_personal_note_revisions_version_uidx
    UNIQUE (note_id, resource_version),
  CHECK (
    (
      resource_version = 1
      AND before_text IS NULL
      AND tombstone = false
      AND after_text IS NOT NULL
    )
    OR (
      resource_version > 1
      AND (
        (tombstone = false AND after_text IS NOT NULL)
        OR (tombstone = true AND after_text IS NULL)
      )
    )
  )
);

CREATE INDEX game_personal_note_revisions_game_recorded_idx
  ON game_personal_note_revisions (game_id, recorded_at, resource_version);

CREATE FUNCTION game_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'initial review version must be 1' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.game_id, NEW.kind, NEW.author_user_id, NEW.recipient_user_id,
           NEW.subject_participation_id, NEW.experience_assertion, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.game_id, OLD.kind, OLD.author_user_id, OLD.recipient_user_id,
           OLD.subject_participation_id, OLD.experience_assertion, OLD.created_at)
      OR NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'invalid review transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER game_reviews_guard
  BEFORE INSERT OR UPDATE ON game_reviews
  FOR EACH ROW EXECUTE FUNCTION game_review_guard();

CREATE FUNCTION game_review_reply_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'initial reply version must be 1' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.review_id, NEW.game_id, NEW.author_user_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.review_id, OLD.game_id, OLD.author_user_id, OLD.created_at)
      OR NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'invalid reply transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER game_review_replies_guard
  BEFORE INSERT OR UPDATE ON game_review_replies
  FOR EACH ROW EXECUTE FUNCTION game_review_reply_guard();

CREATE FUNCTION game_personal_note_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'initial note must be live version 1' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.game_id, NEW.context_id, NEW.author_user_id, NEW.subject_user_id, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.game_id, OLD.context_id, OLD.author_user_id, OLD.subject_user_id, OLD.created_at)
      OR NEW.version::bigint <> OLD.version::bigint + 1 THEN
      RAISE EXCEPTION 'invalid note transition' USING ERRCODE = '23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'tombstoned note cannot resurrect' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER game_personal_notes_guard
  BEFORE INSERT OR UPDATE ON game_personal_notes
  FOR EACH ROW EXECUTE FUNCTION game_personal_note_guard();

CREATE FUNCTION deny_game_feedback_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'game feedback history is retained' USING ERRCODE = '23514';
END $$;

DO $$
DECLARE
  reviews regclass := 'game_reviews'::regclass;
  review_revisions regclass := 'game_review_revisions'::regclass;
  replies regclass := 'game_review_replies'::regclass;
  reply_revisions regclass := 'game_review_reply_revisions'::regclass;
  notes regclass := 'game_personal_notes'::regclass;
  note_revisions regclass := 'game_personal_note_revisions'::regclass;
BEGIN
  EXECUTE format('CREATE TRIGGER game_reviews_deny_delete BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_game_feedback_history_rewrite()', reviews);
  EXECUTE format('CREATE TRIGGER game_reviews_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_game_feedback_history_rewrite()', reviews);
  EXECUTE format('CREATE TRIGGER game_review_revisions_immutable BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_game_feedback_history_rewrite()', review_revisions);
  EXECUTE format('CREATE TRIGGER game_review_revisions_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_game_feedback_history_rewrite()', review_revisions);
  EXECUTE format('CREATE TRIGGER game_review_replies_deny_delete BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_game_feedback_history_rewrite()', replies);
  EXECUTE format('CREATE TRIGGER game_review_replies_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_game_feedback_history_rewrite()', replies);
  EXECUTE format('CREATE TRIGGER game_review_reply_revisions_immutable BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_game_feedback_history_rewrite()', reply_revisions);
  EXECUTE format('CREATE TRIGGER game_review_reply_revisions_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_game_feedback_history_rewrite()', reply_revisions);
  EXECUTE format('CREATE TRIGGER game_personal_notes_deny_delete BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_game_feedback_history_rewrite()', notes);
  EXECUTE format('CREATE TRIGGER game_personal_notes_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_game_feedback_history_rewrite()', notes);
  EXECUTE format('CREATE TRIGGER game_personal_note_revisions_immutable BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION deny_game_feedback_history_rewrite()', note_revisions);
  EXECUTE format('CREATE TRIGGER game_personal_note_revisions_deny_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION deny_game_feedback_history_rewrite()', note_revisions);
END $$;
