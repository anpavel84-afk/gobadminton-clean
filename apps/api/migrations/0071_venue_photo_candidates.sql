-- #507 I3a: additive purpose-specific candidate lifecycle; 0069/0070 stay immutable.
ALTER TABLE venue_photo_submissions
  DROP CONSTRAINT venue_photo_submissions_purpose_check,
  DROP CONSTRAINT venue_photo_submissions_preset_check,
  DROP CONSTRAINT venue_photo_submissions_rights_version_check,
  DROP CONSTRAINT venue_photo_submissions_status_check,
  DROP CONSTRAINT venue_photo_submissions_check,
  DROP CONSTRAINT venue_photo_submissions_check2,
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN evidence jsonb,
  ADD COLUMN decision_audit_id uuid REFERENCES privileged_audit_events(id),
  ADD COLUMN gallery_item_id uuid REFERENCES venue_gallery_items(id),
  ADD CONSTRAINT venue_photo_submissions_purpose_state CHECK ((
    (purpose='comment_attachment' AND preset='community_photo' AND rights_version='community-photo-rights-v1'
      AND evidence IS NULL AND decision_audit_id IS NULL AND gallery_item_id IS NULL
      AND expires_at IS NOT NULL AND expires_at>created_at AND expires_at<=created_at+interval '1 hour'
      AND ((status='ready' AND withdrawn_at IS NULL AND version=1)
        OR (status='withdrawn' AND withdrawn_at IS NOT NULL AND version=2)))
    OR
    (purpose='official_candidate' AND preset='cover' AND rights_version='venue-candidate-rights-v1'
      AND width=1200 AND height=400 AND expires_at IS NULL
      AND evidence IS NOT NULL AND jsonb_typeof(evidence)='object'
      AND evidence->>'creditKind'='photo'
      AND length(evidence->>'creditText') BETWEEN 7 AND 120 AND evidence->>'creditText' LIKE 'Фото: %'
      AND evidence->>'creditUrl' LIKE 'https://%' AND evidence->>'sourceUrl' LIKE 'https://%'
      AND length(evidence->>'permissionBasis') BETWEEN 1 AND 600
      AND ((status='awaiting_review' AND version=1 AND withdrawn_at IS NULL AND decision_audit_id IS NULL AND gallery_item_id IS NULL)
        OR (status='withdrawn' AND version=2 AND withdrawn_at IS NOT NULL AND decision_audit_id IS NULL AND gallery_item_id IS NULL)
        OR (status='rejected' AND version=2 AND withdrawn_at IS NULL AND decision_audit_id IS NOT NULL AND gallery_item_id IS NULL)
        OR (status='accepted' AND version=2 AND withdrawn_at IS NULL AND decision_audit_id IS NOT NULL AND gallery_item_id IS NOT NULL)))
  ) IS TRUE);
CREATE UNIQUE INDEX venue_photo_candidates_one_pending ON venue_photo_submissions(venue_id)
  WHERE purpose='official_candidate' AND status='awaiting_review';

CREATE OR REPLACE FUNCTION venue_photo_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approval_surface text; approval_policy text;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.purpose='official_candidate' THEN
      RAISE EXCEPTION 'candidate provenance is immutable' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['status','version','withdrawn_at','decision_audit_id','gallery_item_id']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','version','withdrawn_at','decision_audit_id','gallery_item_id'])
       OR NEW.version<>OLD.version+1
       OR NOT ((OLD.purpose='comment_attachment' AND OLD.status='ready' AND NEW.status='withdrawn')
         OR (OLD.purpose='official_candidate' AND OLD.status='awaiting_review' AND NEW.status IN ('withdrawn','rejected','accepted'))) THEN
      RAISE EXCEPTION 'immutable private photo submission' USING ERRCODE='23514';
    END IF;
    -- Existing immutable audit binds the reviewed version, exact bytes, owner and rights/evidence.
    IF NEW.purpose='official_candidate' AND NEW.status IN ('accepted','rejected') AND NOT EXISTS (
      SELECT 1 FROM privileged_audit_events a WHERE a.id=NEW.decision_audit_id
        AND a.permission_key='venue.manage' AND a.action_key='venue.candidate_' || NEW.status
        AND a.target_type='venue_photo_candidate' AND a.target_id=NEW.id::text
        AND a.before_diff @> jsonb_build_object('version',OLD.version,'venueId',OLD.venue_id,
          'ownerUserId',OLD.owner_user_id,'imageSha256',OLD.image_sha256,'imageApprovalId',OLD.image_approval_id,
          'rightsVersion',OLD.rights_version,'evidence',OLD.evidence)
    ) THEN RAISE EXCEPTION 'candidate decision audit required' USING ERRCODE='23514'; END IF;
    IF NEW.status='accepted' AND NOT EXISTS (
      SELECT 1 FROM venues v JOIN users u ON u.id=NEW.owner_user_id
      JOIN content_moderation_approvals a ON a.id=NEW.image_approval_id
      WHERE v.id=NEW.venue_id AND v.created_by_user_id=NEW.owner_user_id AND u.status='active'
        AND v.lifecycle_state IN ('unverified','verified') AND v.canonical_venue_id IS NULL
        AND a.content_type='image' AND a.surface_key='cover_image' AND a.decision='allow'
        AND a.policy_version='avatar-image-v1' AND a.local_policy_version='none' AND a.fingerprint_version=1
        AND a.provider_model='omni-moderation-2024-09-26'
    ) THEN RAISE EXCEPTION 'candidate current owner/approval required' USING ERRCODE='23514'; END IF;
    IF NEW.status='accepted' AND NOT EXISTS (
      SELECT 1 FROM venue_gallery_items g WHERE g.id=NEW.gallery_item_id AND g.venue_id=NEW.venue_id
        AND g.active AND g.storage_key=NEW.storage_key AND g.moderation_approval_id=NEW.image_approval_id
        AND g.actor_id=NEW.owner_user_id AND g.credit_kind=NEW.evidence->>'creditKind'
        AND g.credit_text=NEW.evidence->>'creditText' AND g.credit_url=NEW.evidence->>'creditUrl'
        AND g.source_url=NEW.evidence->>'sourceUrl' AND g.permission_basis=NEW.evidence->>'permissionBasis'
        AND g.source_author IS NOT DISTINCT FROM NEW.evidence->>'sourceAuthor'
        AND g.source_fingerprint IS NOT DISTINCT FROM NEW.evidence->>'sourceFingerprint'
    ) THEN RAISE EXCEPTION 'candidate gallery provenance required' USING ERRCODE='23514'; END IF;
  ELSE
    approval_surface := CASE NEW.purpose WHEN 'comment_attachment' THEN 'community_photo_image' WHEN 'official_candidate' THEN 'cover_image' END;
    approval_policy := CASE NEW.purpose WHEN 'comment_attachment' THEN 'community-photo-image-v1:inside1600-ladder-v1' WHEN 'official_candidate' THEN 'avatar-image-v1' END;
    IF NEW.version<>1 OR NOT ((NEW.purpose='comment_attachment' AND NEW.status='ready')
      OR (NEW.purpose='official_candidate' AND NEW.status='awaiting_review')) OR NOT EXISTS (
      SELECT 1 FROM content_moderation_approvals a WHERE a.id=NEW.image_approval_id
        AND a.content_type='image' AND a.surface_key=approval_surface AND a.decision='allow'
        AND a.policy_version=approval_policy AND a.local_policy_version='none' AND a.fingerprint_version=1
        AND a.provider_model='omni-moderation-2024-09-26'
    ) THEN RAISE EXCEPTION 'invalid private photo approval' USING ERRCODE='23514'; END IF;
    IF NEW.purpose='official_candidate' AND NOT EXISTS (
      SELECT 1 FROM venues v JOIN users u ON u.id=NEW.owner_user_id
      WHERE v.id=NEW.venue_id AND v.created_by_user_id=NEW.owner_user_id AND u.status='active'
        AND v.lifecycle_state IN ('unverified','verified') AND v.canonical_venue_id IS NULL
    ) THEN RAISE EXCEPTION 'candidate requires real live venue creator' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- Preserve official candidate history even after bytes become collectible.
DROP TRIGGER venue_photo_submission_guard ON venue_photo_submissions;
CREATE TRIGGER venue_photo_submission_guard BEFORE INSERT OR UPDATE OR DELETE ON venue_photo_submissions
FOR EACH ROW EXECUTE FUNCTION venue_photo_submission_guard();
