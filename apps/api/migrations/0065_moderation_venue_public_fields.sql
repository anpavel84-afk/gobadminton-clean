-- MOD-V2-B2a (#506): venue_name / venue_address / venue_description surfaces + venue entity kind.
-- Additive only. Do not edit 0061–0064. No forged legacy approvals. Image/M1 unchanged.
-- Ordinary public-text approveTexts/bindTexts for consumer create/propose/confirm-distinct
-- and privileged Admin create/edit/restore. Gallery credits / public-data import remain B2b.

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
    'role_reply_body',
    'venue_review_body',
    'venue_name',
    'venue_address',
    'venue_description'
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
    'role_reply_revision',
    'venue_review_revision',
    'venue'
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
    'role_reply_body',
    'venue_review_body',
    'venue_name',
    'venue_address',
    'venue_description'
  ));

COMMENT ON CONSTRAINT content_moderation_bindings_entity_kind_check ON content_moderation_bindings IS
  '#506 B2a adds venue entity kind for ordinary public name/address/description publication bindings; review revision kinds unchanged.';
