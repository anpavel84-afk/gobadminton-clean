-- LS-05: text-only Game Chat (one conversation per Game).
-- Additive only. Preserves 0001–0012. No attachments/WS/Kafka/Inbox compose.

-- Allow game-kind conversations alongside direct DM rows.
ALTER TABLE conversations
  ALTER COLUMN pair_id DROP NOT NULL,
  ALTER COLUMN initiator_user_id DROP NOT NULL,
  ALTER COLUMN recipient_user_id DROP NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS game_id uuid NULL REFERENCES games (id),
  ADD COLUMN IF NOT EXISTS lifecycle_state text NULL,
  ADD COLUMN IF NOT EXISTS context_game_id uuid NULL REFERENCES games (id);

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_kind_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_kind_check
  CHECK (kind IN ('direct', 'game'));

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_distinct_users_chk;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_distinct_users_chk
  CHECK (
    kind <> 'direct'
    OR (
      initiator_user_id IS NOT NULL
      AND recipient_user_id IS NOT NULL
      AND initiator_user_id <> recipient_user_id
    )
  );

ALTER TABLE conversations
  ADD CONSTRAINT conversations_direct_shape_chk
  CHECK (
    kind <> 'direct'
    OR (
      pair_id IS NOT NULL
      AND game_id IS NULL
      AND lifecycle_state IS NULL
      AND request_state IS NOT NULL
    )
  );

ALTER TABLE conversations
  ADD CONSTRAINT conversations_game_shape_chk
  CHECK (
    kind <> 'game'
    OR (
      game_id IS NOT NULL
      AND pair_id IS NULL
      AND initiator_user_id IS NULL
      AND recipient_user_id IS NULL
      AND request_state = 'accepted'
      AND request_expires_at IS NULL
      AND lifecycle_state IN ('active', 'closed')
      AND context_game_id IS NULL
    )
  );

CREATE UNIQUE INDEX conversations_game_uidx
  ON conversations (game_id)
  WHERE kind = 'game';

CREATE INDEX conversations_context_game_idx
  ON conversations (context_game_id)
  WHERE context_game_id IS NOT NULL;

ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS role text NULL,
  ADD COLUMN IF NOT EXISTS membership_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS send_allowed boolean NOT NULL DEFAULT true;

ALTER TABLE conversation_members
  DROP CONSTRAINT IF EXISTS conversation_members_role_chk;

ALTER TABLE conversation_members
  ADD CONSTRAINT conversation_members_role_chk
  CHECK (role IS NULL OR role IN ('member', 'manager'));

ALTER TABLE conversation_members
  DROP CONSTRAINT IF EXISTS conversation_members_state_chk;

ALTER TABLE conversation_members
  ADD CONSTRAINT conversation_members_state_chk
  CHECK (membership_state IN ('active', 'removed'));

CREATE INDEX conversation_members_active_idx
  ON conversation_members (conversation_id, user_id)
  WHERE membership_state = 'active';
