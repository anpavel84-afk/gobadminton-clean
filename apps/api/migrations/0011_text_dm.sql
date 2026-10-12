-- LS-03: lean 1:1 text DM (conversations / members / messages).
-- Additive only. Preserves 0001–0010. No GameInvitation / GameChat / attachments.
-- Ordinary plaintext body_text (Owner storage decision). Polling-first; no WS.

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  pair_id uuid NOT NULL REFERENCES social_pairs (id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'direct'
    CHECK (kind = 'direct'),
  request_state text NOT NULL
    CHECK (
      request_state IN (
        'pending',
        'accepted',
        'declined',
        'expired',
        'closed'
      )
    ),
  initiator_user_id uuid NOT NULL REFERENCES users (id),
  recipient_user_id uuid NOT NULL REFERENCES users (id),
  request_expires_at timestamptz NULL,
  next_message_seq bigint NOT NULL DEFAULT 1
    CHECK (next_message_seq >= 1),
  last_message_at timestamptz NULL,
  last_message_seq bigint NOT NULL DEFAULT 0
    CHECK (last_message_seq >= 0),
  version integer NOT NULL DEFAULT 1
    CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_pair_direct_uidx UNIQUE (pair_id),
  CONSTRAINT conversations_distinct_users_chk CHECK (
    initiator_user_id <> recipient_user_id
  ),
  CONSTRAINT conversations_pending_expiry_chk CHECK (
    request_state <> 'pending'
    OR request_expires_at IS NOT NULL
  )
);

CREATE INDEX conversations_initiator_activity_idx
  ON conversations (initiator_user_id, last_message_at DESC NULLS LAST, id);

CREATE INDEX conversations_recipient_activity_idx
  ON conversations (recipient_user_id, last_message_at DESC NULLS LAST, id);

CREATE INDEX conversations_pending_expiry_idx
  ON conversations (request_expires_at)
  WHERE request_state = 'pending';

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  read_through_seq bigint NOT NULL DEFAULT 0
    CHECK (read_through_seq >= 0),
  hidden_through_seq bigint NOT NULL DEFAULT 0
    CHECK (hidden_through_seq >= 0),
  archived boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  preferences_version integer NOT NULL DEFAULT 1
    CHECK (preferences_version >= 1),
  state_version integer NOT NULL DEFAULT 1
    CHECK (state_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_members_pk PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX conversation_members_user_activity_idx
  ON conversation_members (user_id, archived, conversation_id);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  seq bigint NOT NULL
    CHECK (seq >= 1),
  author_user_id uuid NOT NULL REFERENCES users (id),
  client_message_id text NOT NULL
    CHECK (char_length(client_message_id) BETWEEN 1 AND 128),
  kind text NOT NULL DEFAULT 'text'
    CHECK (kind = 'text'),
  body_text text NULL
    CHECK (
      body_text IS NULL
      OR char_length(body_text) BETWEEN 1 AND 2000
    ),
  content_state text NOT NULL DEFAULT 'live'
    CHECK (content_state IN ('live', 'tombstoned', 'purged')),
  purge_eligible_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_conversation_seq_uidx UNIQUE (conversation_id, seq),
  CONSTRAINT messages_author_client_uidx UNIQUE (author_user_id, client_message_id),
  CONSTRAINT messages_live_body_chk CHECK (
    (content_state = 'live' AND body_text IS NOT NULL)
    OR (content_state <> 'live' AND body_text IS NULL)
  )
);

CREATE INDEX messages_conversation_seq_desc_idx
  ON messages (conversation_id, seq DESC);

CREATE INDEX messages_purge_eligible_idx
  ON messages (purge_eligible_at)
  WHERE content_state = 'live' AND purge_eligible_at IS NOT NULL;

CREATE TABLE message_hidden_for (
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  hidden_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_hidden_for_pk PRIMARY KEY (message_id, user_id)
);

CREATE INDEX message_hidden_for_user_idx
  ON message_hidden_for (user_id, message_id);
