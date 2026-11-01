-- Caller owns transaction. Authorized recovery of UNUSED installation only.
-- Populated new history: keep schema and roll application writes back with flag OFF.
LOCK TABLE
  game_personal_note_revisions,
  game_personal_notes,
  game_review_reply_revisions,
  game_review_replies,
  game_review_revisions,
  game_reviews
IN ACCESS EXCLUSIVE MODE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM game_reviews)
     OR EXISTS (SELECT 1 FROM game_review_revisions)
     OR EXISTS (SELECT 1 FROM game_review_replies)
     OR EXISTS (SELECT 1 FROM game_review_reply_revisions)
     OR EXISTS (SELECT 1 FROM game_personal_notes)
     OR EXISTS (SELECT 1 FROM game_personal_note_revisions) THEN
    RAISE EXCEPTION '0048 rollback refuses populated PG-3 history' USING ERRCODE = '23514';
  END IF;
END $$;

DROP TRIGGER IF EXISTS game_personal_note_revisions_deny_truncate ON game_personal_note_revisions;
DROP TRIGGER IF EXISTS game_personal_note_revisions_immutable ON game_personal_note_revisions;
DROP TRIGGER IF EXISTS game_personal_notes_deny_truncate ON game_personal_notes;
DROP TRIGGER IF EXISTS game_personal_notes_deny_delete ON game_personal_notes;
DROP TRIGGER IF EXISTS game_personal_notes_guard ON game_personal_notes;
DROP TRIGGER IF EXISTS game_review_reply_revisions_deny_truncate ON game_review_reply_revisions;
DROP TRIGGER IF EXISTS game_review_reply_revisions_immutable ON game_review_reply_revisions;
DROP TRIGGER IF EXISTS game_review_replies_deny_truncate ON game_review_replies;
DROP TRIGGER IF EXISTS game_review_replies_deny_delete ON game_review_replies;
DROP TRIGGER IF EXISTS game_review_replies_guard ON game_review_replies;
DROP TRIGGER IF EXISTS game_review_revisions_deny_truncate ON game_review_revisions;
DROP TRIGGER IF EXISTS game_review_revisions_immutable ON game_review_revisions;
DROP TRIGGER IF EXISTS game_reviews_deny_truncate ON game_reviews;
DROP TRIGGER IF EXISTS game_reviews_deny_delete ON game_reviews;
DROP TRIGGER IF EXISTS game_reviews_guard ON game_reviews;

DROP TABLE IF EXISTS game_personal_note_revisions;
DROP TABLE IF EXISTS game_personal_notes;
DROP TABLE IF EXISTS game_review_reply_revisions;
DROP TABLE IF EXISTS game_review_replies;
DROP TABLE IF EXISTS game_review_revisions;
DROP TABLE IF EXISTS game_reviews;

DROP FUNCTION IF EXISTS game_personal_note_guard();
DROP FUNCTION IF EXISTS game_review_reply_guard();
DROP FUNCTION IF EXISTS game_review_guard();
DROP FUNCTION IF EXISTS deny_game_feedback_history_rewrite();

DELETE FROM schema_migrations WHERE id = '0048_game_reviews_notes';
