-- Rollback 0060: refuse when game-event push history or cancel snapshots exist,
-- or when any event-group preference was enabled.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM web_push_game_cancel_recipients)
     OR EXISTS (
       SELECT 1 FROM web_push_delivery_intents
       WHERE event_key IS NOT NULL
          OR kind NOT IN ('dm_message', 'game_chat_message')
     )
     OR EXISTS (
       SELECT 1 FROM web_push_delivery_claims
       WHERE event_key IS NOT NULL
          OR kind NOT IN ('dm_message', 'game_chat_message')
     )
     OR EXISTS (
       SELECT 1 FROM web_push_preferences
       WHERE notify_invites
          OR notify_application_decisions
          OR notify_new_applications
          OR notify_game_changes
          OR notify_outcome_reminders
     )
  THEN
    RAISE EXCEPTION
      'rollback 0060 blocked: game-event push history or enabled event preference exists'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TABLE IF EXISTS web_push_game_cancel_recipients;

DROP INDEX IF EXISTS web_push_delivery_claims_event_sub_uidx;
DROP INDEX IF EXISTS web_push_delivery_claims_msg_sub_uidx;

ALTER TABLE web_push_delivery_claims
  DROP CONSTRAINT IF EXISTS web_push_delivery_claims_ref_chk,
  DROP CONSTRAINT IF EXISTS web_push_delivery_claims_kind_check;

ALTER TABLE web_push_delivery_claims
  DROP COLUMN IF EXISTS event_key;

ALTER TABLE web_push_delivery_claims
  ALTER COLUMN message_id SET NOT NULL;

ALTER TABLE web_push_delivery_claims
  ADD CONSTRAINT web_push_delivery_claims_kind_check
    CHECK (kind IN ('dm_message', 'game_chat_message')),
  ADD CONSTRAINT web_push_delivery_claims_msg_sub_uidx
    UNIQUE (message_id, subscription_id);

DROP INDEX IF EXISTS web_push_delivery_intents_game_pending_idx;
DROP INDEX IF EXISTS web_push_delivery_intents_event_recipient_uidx;
DROP INDEX IF EXISTS web_push_delivery_intents_msg_recipient_uidx;

ALTER TABLE web_push_delivery_intents
  DROP CONSTRAINT IF EXISTS web_push_delivery_intents_shape_chk,
  DROP CONSTRAINT IF EXISTS web_push_delivery_intents_kind_check;

ALTER TABLE web_push_delivery_intents
  DROP COLUMN IF EXISTS actor_user_id,
  DROP COLUMN IF EXISTS game_version,
  DROP COLUMN IF EXISTS reminder_ordinal,
  DROP COLUMN IF EXISTS reminder_id,
  DROP COLUMN IF EXISTS participation_id,
  DROP COLUMN IF EXISTS invitation_id,
  DROP COLUMN IF EXISTS event_key;

-- Restore NOT NULL only when no null rows remain (message path only after gate above).
ALTER TABLE web_push_delivery_intents
  ALTER COLUMN message_id SET NOT NULL,
  ALTER COLUMN conversation_id SET NOT NULL,
  ALTER COLUMN author_user_id SET NOT NULL;

ALTER TABLE web_push_delivery_intents
  ADD CONSTRAINT web_push_delivery_intents_kind_check
    CHECK (kind IN ('dm_message', 'game_chat_message')),
  ADD CONSTRAINT web_push_delivery_intents_game_kind_chk CHECK (
    (kind = 'dm_message' AND game_id IS NULL)
    OR (kind = 'game_chat_message' AND game_id IS NOT NULL)
  ),
  ADD CONSTRAINT web_push_delivery_intents_msg_recipient_uidx
    UNIQUE (message_id, recipient_user_id);

ALTER TABLE web_push_preferences
  DROP COLUMN IF EXISTS notify_outcome_reminders,
  DROP COLUMN IF EXISTS notify_game_changes,
  DROP COLUMN IF EXISTS notify_new_applications,
  DROP COLUMN IF EXISTS notify_application_decisions,
  DROP COLUMN IF EXISTS notify_invites;
