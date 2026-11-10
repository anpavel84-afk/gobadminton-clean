-- Keep bytes journaled for the existing collector; never remove approvals used by another surface.
INSERT INTO avatar_media_gc(storage_key,not_before)
SELECT storage_key,now() FROM venue_photo_submissions
ON CONFLICT(storage_key) DO UPDATE SET not_before=now();
DROP TABLE venue_photo_submissions;
DROP FUNCTION venue_photo_submission_guard();
DELETE FROM content_moderation_approvals WHERE surface_key='community_photo_image';
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
    'venue_description',
    'venue_credit_text'
  ));

DELETE FROM schema_migrations WHERE id='0069_venue_comment_photo_submissions';
