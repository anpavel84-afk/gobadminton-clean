-- #507 I1: community numeric votes + open public venue discussion support.
-- Additive only. Do not rewrite 0051/0061–0067. Photo attachments remain I2.

-- Current vote row: one live (incl. withdrawn/withheld) per user×canonical venue.
CREATE TABLE venue_community_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  canonical_venue_id uuid NOT NULL REFERENCES venues (id),
  user_id uuid NOT NULL REFERENCES users (id),
  value smallint NULL
    CHECK (value IS NULL OR value BETWEEN 1 AND 5),
  version integer NOT NULL
    CHECK (version BETWEEN 1 AND 2147483647),
  moderation_state text NOT NULL DEFAULT 'clear'
    CHECK (moderation_state IN ('clear', 'withheld')),
  withdrawn_at timestamptz NULL,
  user_action_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  merged_into_vote_id uuid NULL REFERENCES venue_community_votes (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (withdrawn_at IS NULL AND value BETWEEN 1 AND 5)
    OR (withdrawn_at IS NOT NULL AND value IS NULL)
  ),
  CHECK (
    merged_into_vote_id IS NULL OR merged_into_vote_id <> id
  )
);

CREATE UNIQUE INDEX venue_community_votes_current_uidx
  ON venue_community_votes (canonical_venue_id, user_id)
  WHERE merged_into_vote_id IS NULL;

CREATE INDEX venue_community_votes_venue_eligible_idx
  ON venue_community_votes (canonical_venue_id, user_action_at DESC, id)
  WHERE merged_into_vote_id IS NULL
    AND withdrawn_at IS NULL
    AND moderation_state = 'clear'
    AND value IS NOT NULL;

-- Immutable action history for votes (user + merge + moderator).
CREATE TABLE venue_community_vote_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  vote_id uuid NOT NULL REFERENCES venue_community_votes (id),
  resource_version integer NOT NULL
    CHECK (resource_version BETWEEN 1 AND 2147483647),
  actor_user_id uuid NULL REFERENCES users (id),
  actor_principal_id uuid NULL,
  action text NOT NULL
    CHECK (action IN (
      'upsert',
      'update',
      'withdraw',
      'merge_survive',
      'merge_supersede',
      'moderation_withhold',
      'moderation_restore'
    )),
  before_value smallint NULL
    CHECK (before_value IS NULL OR before_value BETWEEN 1 AND 5),
  after_value smallint NULL
    CHECK (after_value IS NULL OR after_value BETWEEN 1 AND 5),
  before_moderation_state text NULL
    CHECK (before_moderation_state IS NULL OR before_moderation_state IN ('clear', 'withheld')),
  after_moderation_state text NULL
    CHECK (after_moderation_state IS NULL OR after_moderation_state IN ('clear', 'withheld')),
  before_withdrawn boolean NULL,
  after_withdrawn boolean NULL,
  case_id uuid NULL,
  decision_id uuid NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT venue_community_vote_revisions_version_uidx
    UNIQUE (vote_id, resource_version)
);

CREATE INDEX venue_community_vote_revisions_vote_recorded_idx
  ON venue_community_vote_revisions (vote_id, recorded_at, resource_version);

CREATE TRIGGER venue_community_vote_revisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_community_vote_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

COMMENT ON TABLE venue_community_votes IS
  '#507 I1 current community star vote per authorized user × canonical physical venue.';
COMMENT ON TABLE venue_community_vote_revisions IS
  '#507 I1 immutable vote action history including merge and moderation.';

-- Server-controlled comment withholding (author edits never clear it).
ALTER TABLE entity_comments
  ADD COLUMN IF NOT EXISTS moderation_state text NOT NULL DEFAULT 'clear';

ALTER TABLE entity_comments
  DROP CONSTRAINT IF EXISTS entity_comments_moderation_state_check;

ALTER TABLE entity_comments
  ADD CONSTRAINT entity_comments_moderation_state_check
    CHECK (moderation_state IN ('clear', 'withheld'));

-- Venue reply may bind a pre-merge origin when the root belongs to the same
-- canonical family as the requested terminal. New roots still require terminal.
CREATE OR REPLACE FUNCTION entity_comment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent entity_comments%ROWTYPE;
  terminal_id uuid;
  parent_terminal uuid;
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
      IF NEW.parent_comment_id IS NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM venues v
          WHERE v.id = NEW.entity_id
            AND v.lifecycle_state IN ('unverified', 'verified')
            AND v.canonical_venue_id IS NULL
        ) THEN
          RAISE EXCEPTION 'comment venue parent missing' USING ERRCODE = '23514';
        END IF;
      ELSE
        IF NOT EXISTS (SELECT 1 FROM venues v WHERE v.id = NEW.entity_id) THEN
          RAISE EXCEPTION 'comment venue parent missing' USING ERRCODE = '23514';
        END IF;
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
      IF parent.entity_kind IS DISTINCT FROM NEW.entity_kind THEN
        RAISE EXCEPTION 'reply must bind same entity' USING ERRCODE = '23514';
      END IF;
      IF NEW.entity_kind = 'game' THEN
        IF parent.entity_id IS DISTINCT FROM NEW.entity_id THEN
          RAISE EXCEPTION 'reply must bind same entity' USING ERRCODE = '23514';
        END IF;
      ELSIF NEW.entity_kind = 'venue' THEN
        -- Resolve terminals for requested entity_id and the immutable root origin.
        WITH RECURSIVE
          walk_req AS (
            SELECT v.id, v.lifecycle_state, v.canonical_venue_id, ARRAY[v.id] AS path, 0 AS depth
            FROM venues v WHERE v.id = NEW.entity_id
            UNION ALL
            SELECT n.id, n.lifecycle_state, n.canonical_venue_id, w.path || n.id, w.depth + 1
            FROM walk_req w JOIN venues n ON n.id = w.canonical_venue_id
            WHERE w.lifecycle_state = 'merged' AND w.depth < 8 AND NOT n.id = ANY(w.path)
          ),
          walk_parent AS (
            SELECT v.id, v.lifecycle_state, v.canonical_venue_id, ARRAY[v.id] AS path, 0 AS depth
            FROM venues v WHERE v.id = parent.entity_id
            UNION ALL
            SELECT n.id, n.lifecycle_state, n.canonical_venue_id, w.path || n.id, w.depth + 1
            FROM walk_parent w JOIN venues n ON n.id = w.canonical_venue_id
            WHERE w.lifecycle_state = 'merged' AND w.depth < 8 AND NOT n.id = ANY(w.path)
          )
        SELECT
          (SELECT id FROM walk_req ORDER BY depth DESC LIMIT 1),
          (SELECT id FROM walk_parent ORDER BY depth DESC LIMIT 1)
        INTO terminal_id, parent_terminal;
        IF terminal_id IS NULL OR parent_terminal IS NULL OR terminal_id IS DISTINCT FROM parent_terminal THEN
          RAISE EXCEPTION 'reply must bind same entity' USING ERRCODE = '23514';
        END IF;
        -- Reply stores the root's immutable origin entity_id (pre-merge family).
        NEW.entity_id := parent.entity_id;
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
END;
$$;

COMMENT ON COLUMN entity_comments.moderation_state IS
  '#507 I1 server-controlled clear|withheld; author edit cannot clear withheld.';

-- #507 I1 F3: typed venue_community abuse reports + immutable reference bindings.
-- Additive only. Preserve player/game_review/message kinds. No live 0061–0067 edits.
-- Complaint detail stays on abuse_reports only — never copied into bindings/queue/audit.

DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'abuse_reports'::regclass
      AND con.contype = 'c'
      AND att.attname = 'target_kind'
  LOOP
    EXECUTE format('ALTER TABLE abuse_reports DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_target_kind_check
  CHECK (target_kind IN ('player', 'game_review', 'message', 'venue_community'));

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_player_public_id_chk;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_player_public_id_chk
  CHECK (
    (target_kind = 'player' AND target_public_player_id IS NOT NULL)
    OR (target_kind IN ('game_review', 'message', 'venue_community'))
  );

-- Own vote / own withheld comment / venue-level aggregate may set target_user_id = reporter.
ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_no_self_chk;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_no_self_chk
  CHECK (
    target_kind = 'venue_community'
    OR reporter_user_id <> target_user_id
  );

-- entity_comment_revisions UNIQUE (comment_id, resource_version) and
-- venue_community_vote_revisions UNIQUE (vote_id, resource_version) already exist.

CREATE TABLE venue_community_report_bindings (
  report_id uuid PRIMARY KEY REFERENCES abuse_reports (id),
  reporter_user_id uuid NOT NULL REFERENCES users (id),
  canonical_venue_id uuid NOT NULL REFERENCES venues (id),
  subject_kind text NOT NULL
    CHECK (subject_kind IN ('aggregate', 'own_vote', 'venue_comment')),
  vote_id uuid NULL REFERENCES venue_community_votes (id),
  comment_id uuid NULL REFERENCES entity_comments (id),
  reported_resource_version integer NULL
    CHECK (
      reported_resource_version IS NULL
      OR reported_resource_version BETWEEN 1 AND 2147483647
    ),
  content_fingerprint text NULL
    CHECK (
      content_fingerprint IS NULL
      OR char_length(content_fingerprint) = 64
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_community_report_bindings_subject_chk
    CHECK (
      (
        subject_kind = 'aggregate'
        AND vote_id IS NULL
        AND comment_id IS NULL
        AND reported_resource_version IS NULL
        AND content_fingerprint IS NULL
      )
      OR (
        subject_kind = 'own_vote'
        AND vote_id IS NOT NULL
        AND comment_id IS NULL
        AND reported_resource_version IS NOT NULL
        AND content_fingerprint IS NOT NULL
      )
      OR (
        subject_kind = 'venue_comment'
        AND comment_id IS NOT NULL
        AND vote_id IS NULL
        AND reported_resource_version IS NOT NULL
        AND content_fingerprint IS NOT NULL
      )
    ),
  CONSTRAINT venue_community_report_bindings_vote_revision_fkey
    FOREIGN KEY (vote_id, reported_resource_version)
    REFERENCES venue_community_vote_revisions (vote_id, resource_version),
  CONSTRAINT venue_community_report_bindings_comment_revision_fkey
    FOREIGN KEY (comment_id, reported_resource_version)
    REFERENCES entity_comment_revisions (comment_id, resource_version)
);

-- Lookup aids only — not permanent one-per-source suppression.
-- New signal with a different idempotency key + reason/detail must insert a new
-- binding even when reporter×venue/vote/comment identity matches a prior row.
CREATE INDEX venue_community_report_bindings_aggregate_reporter_idx
  ON venue_community_report_bindings (reporter_user_id, canonical_venue_id)
  WHERE subject_kind = 'aggregate';

CREATE INDEX venue_community_report_bindings_own_vote_reporter_idx
  ON venue_community_report_bindings (
    reporter_user_id, vote_id, reported_resource_version
  )
  WHERE subject_kind = 'own_vote';

CREATE INDEX venue_community_report_bindings_comment_reporter_idx
  ON venue_community_report_bindings (
    reporter_user_id, comment_id, reported_resource_version, content_fingerprint
  )
  WHERE subject_kind = 'venue_comment';

CREATE INDEX venue_community_report_bindings_venue_idx
  ON venue_community_report_bindings (canonical_venue_id, created_at DESC);

CREATE INDEX venue_community_report_bindings_vote_idx
  ON venue_community_report_bindings (vote_id, created_at DESC)
  WHERE vote_id IS NOT NULL;

CREATE INDEX venue_community_report_bindings_comment_idx
  ON venue_community_report_bindings (comment_id, created_at DESC)
  WHERE comment_id IS NOT NULL;

CREATE TRIGGER venue_community_report_bindings_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_community_report_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

COMMENT ON TABLE venue_community_report_bindings IS
  '#507 I1 F3 immutable typed binding for abuse_reports(venue_community); fingerprint/reference only — no complaint detail, no raw comment/vote text copy.';

-- Report intake rate only (not content-moderation AI quota).
CREATE TABLE venue_community_report_rate_budgets (
  user_id uuid NOT NULL REFERENCES users (id),
  bucket text NOT NULL
    CHECK (bucket = 'report'),
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
    CHECK (count >= 0),
  day_started_at timestamptz NOT NULL,
  day_count integer NOT NULL DEFAULT 0
    CHECK (day_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, bucket)
);

COMMENT ON TABLE venue_community_report_rate_budgets IS
  '#507 I1 F3 consumer venue-community report intake rate; idempotent replay does not charge.';

-- #507 I1 F3 assigned human retain/withhold/restore decisions (durable IDs/action/versions only).
-- Unpublished 0068 amendment — never rewrite 0061–0067. vote_revisions.decision_id targets this table.
CREATE TABLE venue_community_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  case_id uuid NOT NULL REFERENCES support_cases (id),
  report_id uuid NOT NULL REFERENCES abuse_reports (id),
  decision text NOT NULL
    CHECK (decision IN ('retain', 'withhold', 'restore')),
  resource_kind text NOT NULL
    CHECK (resource_kind IN ('vote', 'comment')),
  vote_id uuid NULL REFERENCES venue_community_votes (id),
  comment_id uuid NULL REFERENCES entity_comments (id),
  expected_case_version integer NOT NULL
    CHECK (expected_case_version BETWEEN 1 AND 2147483647),
  expected_resource_version integer NOT NULL
    CHECK (expected_resource_version BETWEEN 1 AND 2147483647),
  resulting_resource_version integer NOT NULL
    CHECK (resulting_resource_version BETWEEN 1 AND 2147483647),
  rationale text NOT NULL
    CHECK (char_length(rationale) BETWEEN 1 AND 500),
  actor_principal_id uuid NOT NULL REFERENCES admin_principals (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT venue_community_decisions_resource_chk
    CHECK (
      (
        resource_kind = 'vote'
        AND vote_id IS NOT NULL
        AND comment_id IS NULL
      )
      OR (
        resource_kind = 'comment'
        AND comment_id IS NOT NULL
        AND vote_id IS NULL
      )
    )
);

CREATE INDEX venue_community_decisions_case_recorded_idx
  ON venue_community_decisions (case_id, recorded_at DESC, id);

CREATE INDEX venue_community_decisions_vote_idx
  ON venue_community_decisions (vote_id, recorded_at DESC)
  WHERE vote_id IS NOT NULL;

CREATE INDEX venue_community_decisions_comment_idx
  ON venue_community_decisions (comment_id, recorded_at DESC)
  WHERE comment_id IS NOT NULL;

CREATE TRIGGER venue_community_decisions_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_community_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

ALTER TABLE venue_community_vote_revisions
  DROP CONSTRAINT IF EXISTS venue_community_vote_revisions_decision_fkey;

ALTER TABLE venue_community_vote_revisions
  ADD CONSTRAINT venue_community_vote_revisions_decision_fkey
  FOREIGN KEY (decision_id) REFERENCES venue_community_decisions (id);

COMMENT ON TABLE venue_community_decisions IS
  '#507 I1 F3 immutable assigned human venue-community retain/withhold/restore; IDs/action/versions/rationale only — no raw comment/complaint/fingerprint/voter contacts.';
