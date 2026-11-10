-- #507 I2a: private owned stages only. No public bindings or text-only relaxation.
ALTER TABLE content_moderation_approvals
  DROP CONSTRAINT IF EXISTS content_moderation_approvals_surface_key_check;

ALTER TABLE content_moderation_approvals
  ADD CONSTRAINT content_moderation_approvals_surface_key_check
  CHECK (surface_key IN (
    'community_photo_image',
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

CREATE TABLE venue_photo_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  venue_id uuid NOT NULL REFERENCES venues(id),
  purpose text NOT NULL DEFAULT 'comment_attachment' CHECK (purpose = 'comment_attachment'),
  storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^[a-f0-9]{64}\.png$'),
  image_approval_id uuid NOT NULL REFERENCES content_moderation_approvals(id),
  image_sha256 text NOT NULL CHECK (image_sha256 ~ '^[a-f0-9]{64}$'),
  preset text NOT NULL CHECK (preset = 'community_photo'),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1600),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1600),
  rights_version text NOT NULL CHECK (rights_version = 'community-photo-rights-v1'),
  rights_declared_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  withdrawn_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour'),
  CHECK (rights_declared_at = created_at),
  CHECK ((status = 'ready' AND withdrawn_at IS NULL AND version = 1)
      OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL AND version = 2))
);
CREATE INDEX venue_photo_submissions_owner_ready ON venue_photo_submissions(owner_user_id, expires_at) WHERE status='ready';
-- Immutable admission facts. Future publication requires its own additive migration.
CREATE FUNCTION venue_photo_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['status','version','withdrawn_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','version','withdrawn_at'])
       OR OLD.status <> 'ready' OR NEW.status <> 'withdrawn' OR NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'immutable private photo submission' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.status <> 'ready' OR NEW.version <> 1 OR NOT EXISTS (
      SELECT 1 FROM content_moderation_approvals a WHERE a.id=NEW.image_approval_id
        AND a.content_type='image' AND a.surface_key='community_photo_image' AND a.decision='allow'
        AND a.policy_version='community-photo-image-v1:inside1600-ladder-v1'
        AND a.provider_model='omni-moderation-2024-09-26'
    ) THEN RAISE EXCEPTION 'invalid private photo approval' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER venue_photo_submission_guard BEFORE INSERT OR UPDATE ON venue_photo_submissions
FOR EACH ROW EXECUTE FUNCTION venue_photo_submission_guard();
