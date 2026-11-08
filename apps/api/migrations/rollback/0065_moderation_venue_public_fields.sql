-- Rollback MOD-V2-B2a venue public-field surface catalogue admission only.
-- Retains additive venue_name/address/description approval rows and venue
-- entity bindings, plus the expanded CHECKs that admit them.
-- Narrowing CHECKs would reject retained publication / audit history after any
-- B2a venue create/edit/restore. Non-destructive. Never rewrites 0061–0064.
-- Never deletes or falsifies approval/binding rows. Role/venue review FKs stay intact.

DELETE FROM schema_migrations WHERE id = '0065_moderation_venue_public_fields';
