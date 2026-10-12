-- LS-06: lean composed Inbox read helpers (indexes only).
-- Additive. No materialized inbox_items / rebuild engine.
-- Compose remains read-time UNION over DM, GameInvitation, Game Chat sources.

-- Speed invitee Inbox pages that filter pending attention.
CREATE INDEX IF NOT EXISTS game_invitations_invitee_pending_activity_idx
  ON game_invitations (invitee_user_id, created_at DESC, id DESC)
  WHERE status = 'pending';

-- Speed active Game Chat membership lookup for Inbox compose.
CREATE INDEX IF NOT EXISTS conversation_members_user_active_game_idx
  ON conversation_members (user_id, conversation_id)
  WHERE membership_state = 'active';

-- Speed Game Chat eligibility join on published/open games.
CREATE INDEX IF NOT EXISTS games_published_ends_at_idx
  ON games (ends_at)
  WHERE status = 'published';
