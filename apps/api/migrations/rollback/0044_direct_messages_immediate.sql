-- Source-compatible rollback for 0044. Restores contact_policy DB default only.
-- Do NOT demote accepted conversations or new immediate-DM message history.
-- Historical pending→accepted conversion is intentionally irreversible here;
-- approved full recovery uses the existing pre-migration backup, not a blind demote.
-- Old app builds remain compatible with accepted + NULL request_expires_at rows.

ALTER TABLE player_social_profiles
  ALTER COLUMN contact_policy SET DEFAULT 'closed';

DELETE FROM schema_migrations WHERE id = '0044_direct_messages_immediate';
