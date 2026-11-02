-- Rollback for 0051 (#394 entity comments).
-- Prefer app-only rollback retaining additive schema/data.
-- Optional DB rollback refuses when any comment row exists
-- (preserves written facts; never destructive cleaning of populated state).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM entity_comments LIMIT 1) THEN
    RAISE EXCEPTION
      '0051 DB rollback refused: entity_comments has populated rows. Prefer app-only rollback retaining additive schema/data, or restore from the operator pre-migration DB backup. Do not destroy written comment facts to force PASS.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TRIGGER IF EXISTS entity_comment_revisions_deny_truncate ON entity_comment_revisions;
DROP TRIGGER IF EXISTS entity_comment_revisions_immutable ON entity_comment_revisions;
DROP TRIGGER IF EXISTS entity_comments_deny_truncate ON entity_comments;
DROP TRIGGER IF EXISTS entity_comments_deny_delete ON entity_comments;
DROP TRIGGER IF EXISTS entity_comments_guard ON entity_comments;
DROP FUNCTION IF EXISTS deny_entity_comment_history_rewrite();
DROP FUNCTION IF EXISTS entity_comment_guard();
DROP TABLE IF EXISTS entity_comment_revisions;
DROP TABLE IF EXISTS entity_comments;

DELETE FROM schema_migrations WHERE id = '0051_entity_comments';
