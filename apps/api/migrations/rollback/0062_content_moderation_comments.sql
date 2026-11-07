-- Rollback MOD-V2-B1a comment surface catalogue admission only.
-- Retains additive comment_body approval rows and entity_comment bindings, and
-- keeps the expanded 0062 CHECK allowlists. Narrowing back to the 0061
-- allowlists would reject retained publication/decision/audit history after any
-- B1a comment is published; that is not a safe non-destructive rollback.
-- Original A surfaces remain valid under the retained expanded CHECKs.
-- Also retains idempotency_records.claim_nonce and reservation_state 'unknown'
-- (plus widened state_fields_chk): dropping them would erase paid-attempt /
-- UNKNOWN fencing history required by #506 B1a. Re-applying 0062 re-asserts the
-- same additive widen (idempotent). Empty and populated DBs both succeed.
-- Never rewrites 0061 migration files. Never deletes or falsifies
-- approval/binding/comment/idempotency rows to make rollback pass.

DELETE FROM schema_migrations WHERE id = '0062_content_moderation_comments';
