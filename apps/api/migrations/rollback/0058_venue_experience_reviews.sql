-- Rollback 0058: refuse when any venue-experience history exists. No history deletion.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM venue_review_decisions)
     OR EXISTS (SELECT 1 FROM venue_review_case_links)
     OR EXISTS (SELECT 1 FROM venue_review_reports)
     OR EXISTS (SELECT 1 FROM venue_review_pending_intakes)
     OR EXISTS (SELECT 1 FROM venue_review_revisions)
     OR EXISTS (SELECT 1 FROM venue_review_event_fences)
     OR EXISTS (SELECT 1 FROM venue_review_slots)
  THEN
    RAISE EXCEPTION
      'rollback 0058 blocked: venue experience review history exists'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TRIGGER IF EXISTS venue_review_decisions_immutable ON venue_review_decisions;
DROP TRIGGER IF EXISTS venue_review_case_links_immutable ON venue_review_case_links;
DROP TRIGGER IF EXISTS venue_review_reports_immutable ON venue_review_reports;
DROP TRIGGER IF EXISTS venue_review_revisions_immutable ON venue_review_revisions;
DROP TRIGGER IF EXISTS venue_review_event_fences_immutable ON venue_review_event_fences;

ALTER TABLE venue_review_pending_intakes
  DROP CONSTRAINT IF EXISTS venue_review_pending_intakes_prior_decision_fkey;
ALTER TABLE venue_review_slots
  DROP CONSTRAINT IF EXISTS venue_review_slots_approved_revision_fkey,
  DROP CONSTRAINT IF EXISTS venue_review_slots_pending_revision_fkey;

DROP TABLE IF EXISTS venue_review_decisions;
DROP TABLE IF EXISTS venue_review_case_links;
DROP TABLE IF EXISTS venue_review_reports;
DROP TABLE IF EXISTS venue_review_pending_intakes;
DROP TABLE IF EXISTS venue_review_revisions;
DROP TABLE IF EXISTS venue_review_event_fences;
DROP TABLE IF EXISTS venue_review_slots;
