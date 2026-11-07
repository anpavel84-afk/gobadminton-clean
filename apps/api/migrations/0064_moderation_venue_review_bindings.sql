-- MOD-V2-B1c (#506): venue_review_body surface + venue_review_revision entity kind
-- and nullable human venue_review_decision_id on bindings.
-- Additive only. Do not edit 0061/0062/0063. No forged legacy approvals. Image/M1 unchanged.
-- Classifier evidence binds to exact immutable revision; human approve links via FK on
-- the published twin. Role/venue human FKs are mutually exclusive; publication-only refs.
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
    'role_reply_body',
    'venue_review_body'
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
    'venue_review_revision'
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
    'venue_review_body'
  ));

-- Qualified human publication decision (venue; mutually exclusive with role FK).
ALTER TABLE content_moderation_bindings
  ADD COLUMN IF NOT EXISTS venue_review_decision_id uuid NULL
    REFERENCES venue_review_decisions (id);

ALTER TABLE content_moderation_bindings
  DROP CONSTRAINT IF EXISTS content_moderation_bindings_role_decision_kind_chk;

ALTER TABLE content_moderation_bindings
  DROP CONSTRAINT IF EXISTS content_moderation_bindings_venue_decision_kind_chk;

ALTER TABLE content_moderation_bindings
  DROP CONSTRAINT IF EXISTS content_moderation_bindings_human_decision_xor_chk;

ALTER TABLE content_moderation_bindings
  ADD CONSTRAINT content_moderation_bindings_venue_decision_kind_chk
  CHECK (
    venue_review_decision_id IS NULL
    OR binding_kind = 'publication'
  );

ALTER TABLE content_moderation_bindings
  ADD CONSTRAINT content_moderation_bindings_role_decision_kind_chk
  CHECK (
    role_reputation_decision_id IS NULL
    OR binding_kind = 'publication'
  );

ALTER TABLE content_moderation_bindings
  ADD CONSTRAINT content_moderation_bindings_human_decision_xor_chk
  CHECK (
    NOT (
      role_reputation_decision_id IS NOT NULL
      AND venue_review_decision_id IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS content_moderation_bindings_venue_decision_uidx
  ON content_moderation_bindings (venue_review_decision_id)
  WHERE venue_review_decision_id IS NOT NULL;

COMMENT ON COLUMN content_moderation_bindings.venue_review_decision_id IS
  '#506 B1c nullable FK to exact venue_review_decisions row for human publication allow on published twin; provider classification remains on approval.decision (allow|review). Never forges provider ALLOW. Mutually exclusive with role_reputation_decision_id.';
