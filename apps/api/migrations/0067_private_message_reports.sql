-- #506 MOD-V2-C2: typed exact-message abuse reports + immutable reference bindings.
-- Additive only. Never edit applied 0008/0053. Body stays in messages; binding holds
-- HMAC fingerprint + explicit consent + source identity — not message body.
-- Retention: no new TTL; Cases exact-source read uses original purge_eligible_at as-is.

DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'abuse_reports'::regclass
      AND con.contype = 'c'
      AND att.attname = 'target_kind'
  LOOP
    EXECUTE format('ALTER TABLE abuse_reports DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_target_kind_check
  CHECK (target_kind IN ('player', 'game_review', 'message'));

ALTER TABLE abuse_reports
  DROP CONSTRAINT IF EXISTS abuse_reports_player_public_id_chk;

ALTER TABLE abuse_reports
  ADD CONSTRAINT abuse_reports_player_public_id_chk
  CHECK (
    (target_kind = 'player' AND target_public_player_id IS NOT NULL)
    OR (target_kind IN ('game_review', 'message'))
  );

-- Composite UNIQUE so bindings can FK the exact message identity tuple.
ALTER TABLE messages
  ADD CONSTRAINT messages_report_binding_tuple_uidx
  UNIQUE (id, conversation_id, seq, author_user_id);

CREATE TABLE message_report_bindings (
  report_id uuid PRIMARY KEY REFERENCES abuse_reports (id),
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  conversation_kind text NOT NULL
    CHECK (conversation_kind IN ('direct', 'game')),
  game_id uuid NULL REFERENCES games (id),
  message_seq bigint NOT NULL
    CHECK (message_seq >= 1),
  author_user_id uuid NOT NULL REFERENCES users (id),
  content_fingerprint text NOT NULL
    CHECK (char_length(content_fingerprint) = 64),
  share_consent boolean NOT NULL
    CHECK (share_consent IS TRUE),
  reporter_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_report_bindings_actor_content_uidx
    UNIQUE (reporter_user_id, message_id, content_fingerprint),
  CONSTRAINT message_report_bindings_message_tuple_fkey
    FOREIGN KEY (message_id, conversation_id, message_seq, author_user_id)
    REFERENCES messages (id, conversation_id, seq, author_user_id),
  CONSTRAINT message_report_bindings_context_chk
    CHECK (
      (conversation_kind = 'direct' AND game_id IS NULL)
      OR (conversation_kind = 'game' AND game_id IS NOT NULL)
    )
);

CREATE INDEX message_report_bindings_message_idx
  ON message_report_bindings (message_id, created_at DESC);

CREATE INDEX message_report_bindings_conversation_idx
  ON message_report_bindings (conversation_id, created_at DESC);

CREATE INDEX message_report_bindings_game_idx
  ON message_report_bindings (game_id, created_at DESC)
  WHERE game_id IS NOT NULL;

CREATE TRIGGER message_report_bindings_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON message_report_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION support_immutable();

COMMENT ON TABLE message_report_bindings IS
  'Immutable reference from typed abuse_reports(message) to exact messages row; private body stays in messages only; Cases read while original purge_eligible_at is finite and future.';
