-- Rollback MOD-V2-B1c venue-review surface catalogue admission only.
-- Retains additive venue_review_body approval rows and venue_review_revision
-- bindings, plus the nullable venue_review_decision_id column and expanded CHECKs.
-- Narrowing CHECKs or dropping the human-decision column would reject retained
-- publication / decision / audit history after any B1c review intake.
-- Non-destructive. Never rewrites 0061/0062/0063. Never deletes or falsifies
-- approval/binding rows. Role decision index/FK from 0063 stay intact.

DELETE FROM schema_migrations WHERE id = '0064_moderation_venue_review_bindings';
