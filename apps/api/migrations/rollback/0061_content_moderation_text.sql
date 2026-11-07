-- Retain additive approval rows. Drop bindings; restore prior surface allowlist.
DROP TABLE IF EXISTS content_moderation_bindings;

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
    'game_title',
    'game_host_display_name',
    'game_training_description',
    'game_settlement_terms'
  ));

DELETE FROM schema_migrations WHERE id = '0061_content_moderation_text';
