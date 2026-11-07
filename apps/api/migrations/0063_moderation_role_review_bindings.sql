-- MOD-V2-B1b (#506): role_review_body / role_reply_body surfaces + typed entity kinds
-- and nullable human role_reputation_decision_id on bindings.
-- Additive only. Do not edit 0061/0062. No forged legacy approvals. Image/M1 unchanged.
-- Classifier evidence binds to exact immutable revision; human approve links via FK.
-- ALLOW classification never auto-publishes; mandatory independent human queue retained.

ALTER TABLE content_moderation_approvals
  DROP CONSTRAINT IF EXISTS content_moderation_approvals_surface_key_check;

ALTER TABLE content_moderation_approvals
  ADD CONSTRAINT content_moderation_approvals_surface_key_check
  CHECK (surface_key IN (
    'avatar_image',
    'cover_image',
    'profile_display_name',
    'profile_bio',
    'trainer_display_name',
    'trainer_bio',
    'organizer_display_name',
    'organizer_public_contact',
    'game_title',
    'game_host_display_name',
    'game_host_public_contact',
    'game_training_description',
    'game_settlement_terms',
    'game_trainer_display_name_snapshot',
    'comment_body',
    'role_review_body',
    'role_reply_body'
  ));

ALTER TABLE content_moderation_bindings
  DROP CONSTRAINT IF EXISTS content_moderation_bindings_entity_kind_check;

ALTER TABLE content_moderation_bindings
  ADD CONSTRAINT content_moderation_bindings_entity_kind_check
  CHECK (entity_kind IN (
    'player_social_profile',
    'trainer_profile',
    'organizer',
    'game',
    'entity_comment',
    'role_review_revision',
    'role_reply_revision'
  ));

ALTER TABLE content_moderation_bindings
  DROP CONSTRAINT IF EXISTS content_moderation_bindings_surface_key_check;

ALTER TABLE content_moderation_bindings
  ADD CONSTRAINT content_moderation_bindings_surface_key_check
  CHECK (surface_key IN (
    'profile_display_name',
    'profile_bio',
    'trainer_display_name',
    'trainer_bio',
    'organizer_display_name',
    'organizer_public_contact',
    'game_title',
    'game_host_display_name',
    'game_host_public_contact',
    'game_training_description',
    'game_settlement_terms',
    'game_trainer_display_name_snapshot',
    'comment_body',
    'role_review_body',
    'role_reply_body'
  ));

-- Qualified human publication decision (at most one typed human ref for B1b).
ALTER TABLE content_moderation_bindings
  ADD COLUMN IF NOT EXISTS role_reputation_decision_id uuid NULL
    REFERENCES role_reputation_decisions (id);

ALTER TABLE content_moderation_bindings
  DROP CONSTRAINT IF EXISTS content_moderation_bindings_role_decision_kind_chk;

ALTER TABLE content_moderation_bindings
  ADD CONSTRAINT content_moderation_bindings_role_decision_kind_chk
  CHECK (
    role_reputation_decision_id IS NULL
    OR binding_kind = 'publication'
  );

CREATE UNIQUE INDEX IF NOT EXISTS content_moderation_bindings_role_decision_uidx
  ON content_moderation_bindings (role_reputation_decision_id)
  WHERE role_reputation_decision_id IS NOT NULL;

COMMENT ON COLUMN content_moderation_bindings.role_reputation_decision_id IS
  '#506 B1b nullable FK to exact role_reputation_decisions row for human publication allow; provider classification remains on approval.decision (allow|review). Never forges provider ALLOW.';

-- Bounded admin external-prepare claim for approve/restore classifier work.
-- Additive only: historical completed receipts stay reservation_state=completed
-- with intact response_ciphertext. Never reclaim processing/unknown after TTL.
ALTER TABLE admin_command_receipts
  ADD COLUMN IF NOT EXISTS reservation_state text NOT NULL DEFAULT 'completed';

ALTER TABLE admin_command_receipts
  DROP CONSTRAINT IF EXISTS admin_command_receipts_reservation_state_chk;

ALTER TABLE admin_command_receipts
  ADD CONSTRAINT admin_command_receipts_reservation_state_chk
  CHECK (reservation_state IN ('completed', 'processing', 'unknown'));

ALTER TABLE admin_command_receipts
  ADD COLUMN IF NOT EXISTS claim_nonce text NULL;

ALTER TABLE admin_command_receipts
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

-- processing rows reserve before paid I/O and may lack a final sealed response.
ALTER TABLE admin_command_receipts
  ALTER COLUMN response_ciphertext DROP NOT NULL;

ALTER TABLE admin_command_receipts
  DROP CONSTRAINT IF EXISTS admin_command_receipts_response_state_chk;

ALTER TABLE admin_command_receipts
  ADD CONSTRAINT admin_command_receipts_response_state_chk
  CHECK (
    (reservation_state = 'completed' AND response_ciphertext IS NOT NULL)
    OR (reservation_state IN ('processing', 'unknown'))
  );

COMMENT ON COLUMN admin_command_receipts.reservation_state IS
  '#506 B1b admin external-prepare: completed|processing|unknown. Unknown/processing are never TTL-reclaimed for a second paid provider attempt. Old rows default completed.';
COMMENT ON COLUMN admin_command_receipts.claim_nonce IS
  '#506 B1b opaque owner token for processing→complete/release/unknown; wrong-owner finalization denied.';
COMMENT ON COLUMN admin_command_receipts.expires_at IS
  '#506 B1b soft marker only for processing/unknown observability; never authorizes paid replay reclaim.';
