-- Rollback #507 I1 venue community votes / comment moderation_state / report bindings.
-- Restores 0067 abuse_reports kinds and 0051 entity_comment_guard venue branch.
-- Destructive for I1 tables.

ALTER TABLE venue_community_vote_revisions
  DROP CONSTRAINT IF EXISTS venue_community_vote_revisions_decision_fkey;

DROP TRIGGER IF EXISTS venue_community_decisions_immutable ON venue_community_decisions;
DROP TABLE IF EXISTS venue_community_decisions;

DROP TRIGGER IF EXISTS venue_community_report_bindings_immutable ON venue_community_report_bindings;
DROP TABLE IF EXISTS venue_community_report_bindings;
DROP TABLE IF EXISTS venue_community_report_rate_budgets;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_player_public_id_chk;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_target_kind_check;

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_no_self_chk;

-- Fail closed if venue_community rows remain (cannot restore prior kinds safely).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM abuse_reports WHERE target_kind = 'venue_community') THEN
    RAISE EXCEPTION 'cannot rollback 0068 while venue_community abuse_reports exist';
  END IF;
END $$;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_target_kind_check
  CHECK (target_kind IN ('player', 'game_review', 'message'));

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_player_public_id_chk
  CHECK (
    (target_kind = 'player' AND target_public_player_id IS NOT NULL)
    OR (target_kind IN ('game_review', 'message'))
  );

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_no_self_chk
  CHECK (reporter_user_id <> target_user_id);

DROP TRIGGER IF EXISTS venue_community_vote_revisions_immutable ON venue_community_vote_revisions;
DROP TABLE IF EXISTS venue_community_vote_revisions;
DROP TABLE IF EXISTS venue_community_votes;

ALTER TABLE entity_comments
  DROP CONSTRAINT IF EXISTS entity_comments_moderation_state_check;

ALTER TABLE entity_comments
  DROP COLUMN IF EXISTS moderation_state;

CREATE OR REPLACE FUNCTION entity_comment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
