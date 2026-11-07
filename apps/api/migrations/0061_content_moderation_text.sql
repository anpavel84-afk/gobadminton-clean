-- MOD-V2-A: expand text surfaces + typed publication bindings. Image rows/constraints unchanged.
-- Legacy public text remains unbound (legacy_unverified). No bulk approvals.

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
    'game_trainer_display_name_snapshot'
  ));

CREATE TABLE content_moderation_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL CHECK (entity_kind IN (
    'player_social_profile',
    'trainer_profile',
    'organizer',
    'game'
  )),
  entity_id uuid NOT NULL,
  surface_key text NOT NULL CHECK (surface_key IN (
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
    'game_trainer_display_name_snapshot'
  )),
  resource_version integer NOT NULL CHECK (resource_version >= 1),
  approval_id uuid NOT NULL REFERENCES content_moderation_approvals(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  actor_principal_id uuid NULL,
  binding_kind text NOT NULL CHECK (binding_kind IN ('candidate', 'publication')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_kind, entity_id, surface_key, resource_version, binding_kind)
);

CREATE INDEX content_moderation_bindings_approval_idx
  ON content_moderation_bindings (approval_id);
CREATE INDEX content_moderation_bindings_entity_idx
  ON content_moderation_bindings (entity_kind, entity_id);
