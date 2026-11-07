-- Rollback MOD-V2-B1a comment surface catalogue admission only.
-- Retains additive comment_body approval rows and entity_comment bindings, and
-- keeps the expanded 0062 CHECK allowlists. Narrowing back to the 0061
-- allowlists would reject retained publication/decision/audit history after any
-- B1a comment is published; that is not a safe non-destructive rollback.
-- Original A surfaces remain valid under the retained expanded CHECKs.
-- Empty and populated DBs both succeed. Re-applying 0062 re-asserts the same
-- expanded allowlists (idempotent widen). Never rewrites 0061 migration files.
-- Never deletes or falsifies approval/binding/comment rows to make rollback pass.

DELETE FROM schema_migrations WHERE id = '0062_content_moderation_comments';
