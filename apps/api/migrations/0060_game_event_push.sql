-- #496 Game business-event Web Push extension. Additive on 0055/0056.
-- Message FKs stay valid for dm/game_chat; game events use nullable message
-- columns + durable event_key uniqueness. Preference event groups default OFF
-- (including for accounts that already opted into message push). No historical
-- outbox sweep. Cancel recipient snapshot is written in the cancel TX only.

ALTER TABLE web_push_preferences
  ADD COLUMN notify_invites boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_application_decisions boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_new_applications boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_game_changes boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_outcome_reminders boolean NOT NULL DEFAULT false;

ALTER TABLE web_push_delivery_intents
  DROP CONSTRAINT web_push_delivery_intents_kind_check,
  DROP CONSTRAINT web_push_delivery_intents_game_kind_chk,
  DROP CONSTRAINT web_push_delivery_intents_msg_recipient_uidx;

ALTER TABLE web_push_delivery_intents
  ALTER COLUMN message_id DROP NOT NULL,
  ALTER COLUMN conversation_id DROP NOT NULL,
  ALTER COLUMN author_user_id DROP NOT NULL;

ALTER TABLE web_push_delivery_intents
  ADD COLUMN event_key text NULL
    CHECK (event_key IS NULL OR char_length(event_key) BETWEEN 8 AND 220),
  ADD COLUMN invitation_id uuid NULL REFERENCES game_invitations (id),
  ADD COLUMN participation_id uuid NULL REFERENCES participations (id),
  ADD COLUMN reminder_id uuid NULL REFERENCES game_outcome_reminders (id),
  ADD COLUMN reminder_ordinal smallint NULL
    CHECK (reminder_ordinal IS NULL OR reminder_ordinal BETWEEN 1 AND 3),
  ADD COLUMN game_version integer NULL
    CHECK (game_version IS NULL OR game_version BETWEEN 1 AND 2147483647),
  ADD COLUMN actor_user_id uuid NULL REFERENCES users (id),
  -- Manager epoch snapshot for new_pending_application (game_managers.updated_at).
  ADD COLUMN manager_updated_at timestamptz NULL;

ALTER TABLE web_push_delivery_intents
  ADD CONSTRAINT web_push_delivery_intents_kind_check CHECK (
    kind IN (
      'dm_message',
      'game_chat_message',
      'game_invitation',
      'participation_confirmed',
      'participation_rejected',
      'new_pending_application',
      'game_cancelled',
      'game_time_changed',
      'game_venue_changed',
      'outcome_reminder'
    )
  ),
  ADD CONSTRAINT web_push_delivery_intents_shape_chk CHECK (
    (
      kind = 'dm_message'
      AND message_id IS NOT NULL
      AND conversation_id IS NOT NULL
      AND author_user_id IS NOT NULL
      AND game_id IS NULL
      AND event_key IS NULL
      AND invitation_id IS NULL
      AND participation_id IS NULL
      AND reminder_id IS NULL
      AND reminder_ordinal IS NULL
      AND game_version IS NULL
    )
    OR (
      kind = 'game_chat_message'
      AND message_id IS NOT NULL
      AND conversation_id IS NOT NULL
      AND author_user_id IS NOT NULL
      AND game_id IS NOT NULL
      AND event_key IS NULL
      AND invitation_id IS NULL
      AND participation_id IS NULL
      AND reminder_id IS NULL
      AND reminder_ordinal IS NULL
      AND game_version IS NULL
    )
    OR (
      kind = 'game_invitation'
      AND message_id IS NULL
      AND conversation_id IS NULL
      AND author_user_id IS NULL
      AND event_key IS NOT NULL
      AND game_id IS NOT NULL
      AND game_version IS NOT NULL
      AND invitation_id IS NOT NULL
      AND participation_id IS NULL
      AND reminder_id IS NULL
      AND reminder_ordinal IS NULL
    )
    OR (
      kind IN (
        'participation_confirmed',
        'participation_rejected',
        'new_pending_application'
      )
      AND message_id IS NULL
      AND conversation_id IS NULL
      AND author_user_id IS NULL
      AND event_key IS NOT NULL
      AND game_id IS NOT NULL
      AND game_version IS NOT NULL
      AND participation_id IS NOT NULL
      AND invitation_id IS NULL
      AND reminder_id IS NULL
      AND reminder_ordinal IS NULL
    )
    OR (
      kind IN ('game_cancelled', 'game_time_changed', 'game_venue_changed')
      AND message_id IS NULL
      AND conversation_id IS NULL
      AND author_user_id IS NULL
      AND event_key IS NOT NULL
      AND game_id IS NOT NULL
      AND game_version IS NOT NULL
      AND invitation_id IS NULL
      AND participation_id IS NULL
      AND reminder_id IS NULL
      AND reminder_ordinal IS NULL
    )
    OR (
      kind = 'outcome_reminder'
      AND message_id IS NULL
      AND conversation_id IS NULL
      AND author_user_id IS NULL
      AND event_key IS NOT NULL
      AND game_id IS NOT NULL
      AND game_version IS NOT NULL
      AND reminder_id IS NOT NULL
      AND reminder_ordinal IS NOT NULL
      AND invitation_id IS NULL
      AND participation_id IS NULL
    )
  );

CREATE UNIQUE INDEX web_push_delivery_intents_msg_recipient_uidx
  ON web_push_delivery_intents (message_id, recipient_user_id)
  WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX web_push_delivery_intents_event_recipient_uidx
  ON web_push_delivery_intents (event_key, recipient_user_id)
  WHERE event_key IS NOT NULL;

CREATE INDEX web_push_delivery_intents_game_pending_idx
  ON web_push_delivery_intents (created_at ASC)
  WHERE status = 'pending' AND event_key IS NOT NULL;

ALTER TABLE web_push_delivery_claims
  DROP CONSTRAINT web_push_delivery_claims_kind_check,
  DROP CONSTRAINT web_push_delivery_claims_msg_sub_uidx;

ALTER TABLE web_push_delivery_claims
  ALTER COLUMN message_id DROP NOT NULL;

ALTER TABLE web_push_delivery_claims
  ADD COLUMN event_key text NULL
    CHECK (event_key IS NULL OR char_length(event_key) BETWEEN 8 AND 220);

ALTER TABLE web_push_delivery_claims
  ADD CONSTRAINT web_push_delivery_claims_kind_check CHECK (
    kind IN (
      'dm_message',
      'game_chat_message',
      'game_invitation',
      'participation_confirmed',
      'participation_rejected',
      'new_pending_application',
      'game_cancelled',
      'game_time_changed',
      'game_venue_changed',
      'outcome_reminder'
    )
  ),
  ADD CONSTRAINT web_push_delivery_claims_ref_chk CHECK (
    (
      message_id IS NOT NULL
      AND event_key IS NULL
      AND kind IN ('dm_message', 'game_chat_message')
    )
    OR (
      message_id IS NULL
      AND event_key IS NOT NULL
      AND kind NOT IN ('dm_message', 'game_chat_message')
    )
  );

CREATE UNIQUE INDEX web_push_delivery_claims_msg_sub_uidx
  ON web_push_delivery_claims (message_id, subscription_id)
  WHERE message_id IS NOT NULL;

CREATE UNIQUE INDEX web_push_delivery_claims_event_sub_uidx
  ON web_push_delivery_claims (event_key, subscription_id)
  WHERE event_key IS NOT NULL;

-- Durable proof of who was pending/confirmed at the exact cancel TX/version.
CREATE TABLE web_push_game_cancel_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  game_id uuid NOT NULL REFERENCES games (id),
  game_version integer NOT NULL
    CHECK (game_version BETWEEN 1 AND 2147483647),
  user_id uuid NOT NULL REFERENCES users (id),
  membership_status text NOT NULL
    CHECK (membership_status IN ('pending', 'confirmed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT web_push_game_cancel_recipients_uidx
    UNIQUE (game_id, game_version, user_id)
);

CREATE INDEX web_push_game_cancel_recipients_game_idx
  ON web_push_game_cancel_recipients (game_id, game_version);
