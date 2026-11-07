-- Rollback MOD-V2-B1b role-review surface catalogue admission only.
-- Retains additive role_review_body / role_reply_body approval rows and
-- role_review_revision / role_reply_revision bindings, plus the nullable
-- role_reputation_decision_id column and expanded CHECKs. Narrowing CHECKs
-- or dropping the human-decision column would reject retained publication /
-- decision / audit history after any B1b review intake. Non-destructive.
-- Also retains additive admin_command_receipts reservation_state / claim_nonce /
-- expires_at columns and nullable response_ciphertext so completed ciphertext
-- history and in-flight/unknown paid-attempt fences stay intact.
-- Never rewrites 0061/0062. Never deletes or falsifies approval/binding rows.

DELETE FROM schema_migrations WHERE id = '0063_moderation_role_review_bindings';
