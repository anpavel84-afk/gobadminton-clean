-- #404 immediate direct messages (Owner): first message opens accepted chat; default contact_policy allows DMs.
-- requests wire value means allow personal messages (not approval gate). Existing closed rows are preserved.
-- Historical pending→accepted promotion is one-way; expiry jobs fence on version/state and must not touch accepted.
-- Rollback restores DB default only — do NOT demote accepted/new message history; use pre-migration backup for full recovery.

ALTER TABLE player_social_profiles
  ALTER COLUMN contact_policy SET DEFAULT 'requests';

-- Promote currently-valid pending direct conversations only.
-- Eligible: recipient active/public/social_eligible/contact_policy=requests;
-- both accounts active and unrestricted (account.access, profile.public, social.directory, social.dm_send);
-- no bilateral block; request deadline not past. Declined/expired/closed/opt-out/restricted/past-deadline left unchanged.
UPDATE conversations AS c
SET request_state = 'accepted',
    request_expires_at = NULL,
    version = c.version + 1,
    updated_at = clock_timestamp()
FROM users AS ui,
     users AS ur,
     player_social_profiles AS pi,
     player_social_profiles AS pr
WHERE c.kind = 'direct'
  AND c.request_state = 'pending'
  AND c.initiator_user_id = ui.id
  AND c.recipient_user_id = ur.id
  AND pi.user_id = ui.id
  AND pr.user_id = ur.id
  AND (c.request_expires_at IS NULL OR c.request_expires_at > clock_timestamp())
  AND ui.status = 'active'
  AND ur.status = 'active'
  AND pr.directory_visible IS TRUE
  AND pr.social_eligible IS TRUE
  AND pr.contact_policy = 'requests'
  AND pi.social_eligible IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks ub
    WHERE (ub.blocker_user_id = c.initiator_user_id AND ub.blocked_user_id = c.recipient_user_id)
       OR (ub.blocker_user_id = c.recipient_user_id AND ub.blocked_user_id = c.initiator_user_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_restrictions urx
    WHERE urx.user_id IN (c.initiator_user_id, c.recipient_user_id)
      AND urx.capability IN ('account.access', 'profile.public', 'social.directory', 'social.dm_send')
      AND urx.revoked_at IS NULL
      AND urx.starts_at <= clock_timestamp()
      AND urx.expires_at > clock_timestamp()
  );
