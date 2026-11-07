-- MOD-V2-B1a (#506): add public comment_body surface + entity_comment bindings.
-- Additive only. Do not edit 0061. No forged legacy approvals. Image surfaces unchanged.
-- Also: external-prepare claim_nonce + explicit unknown reservation (no TTL paid replay).

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
    'comment_body'
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
    'entity_comment'
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
    'comment_body'
  ));

-- Exact claim-owner fencing for MutationRunner external prepare.
-- unknown = sealed ambiguous/paid provider outcome; never auto-reclaimed for a
-- second same-key paid attempt after clock advance.
ALTER TABLE idempotency_records
  ADD COLUMN IF NOT EXISTS claim_nonce uuid;

ALTER TABLE idempotency_records
  DROP CONSTRAINT IF EXISTS idempotency_records_reservation_state_check;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_reservation_state_check
  CHECK (reservation_state IN ('processing', 'completed', 'unknown'));

ALTER TABLE idempotency_records
  DROP CONSTRAINT IF EXISTS idempotency_records_state_fields_chk;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_state_fields_chk CHECK (
    (
      reservation_state = 'processing'
      AND status_code IS NULL
      AND response_body IS NULL
    )
    OR (
      reservation_state = 'completed'
      AND status_code IS NOT NULL
      AND response_body IS NOT NULL
    )
    OR (
      reservation_state = 'unknown'
      AND status_code IS NOT NULL
      AND response_body IS NOT NULL
    )
  );

COMMENT ON COLUMN idempotency_records.claim_nonce IS
  'Opaque owner token for external-prepare processing claims; complete/release require exact match.';
COMMENT ON COLUMN idempotency_records.reservation_state IS
  'processing = in-flight reservation; completed = durable receipt; unknown = sealed ambiguous/paid provider outcome (no automatic same-key paid replay)';
