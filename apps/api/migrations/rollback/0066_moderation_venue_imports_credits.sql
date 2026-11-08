-- Rollback MOD-V2-B2b venue credit/import surface catalogue admission only.
-- Retains additive venue_credit_text approval rows and venue_gallery_item
-- bindings, plus the expanded CHECKs that admit them.
-- Narrowing CHECKs would reject retained publication / audit history after any
-- B2b gallery credit or public-data description write. Non-destructive.
-- Never rewrites 0061–0065. Never deletes or falsifies approval/binding rows.

DELETE FROM schema_migrations WHERE id = '0066_moderation_venue_imports_credits';
