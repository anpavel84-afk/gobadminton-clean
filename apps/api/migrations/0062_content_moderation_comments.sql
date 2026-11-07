-- MOD-V2-B1a (#506): add public comment_body surface + entity_comment bindings.
-- Additive only. Do not edit 0061. No forged legacy approvals. Image surfaces unchanged.

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
