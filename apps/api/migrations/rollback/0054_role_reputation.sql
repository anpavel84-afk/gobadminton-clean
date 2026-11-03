-- Rollback 0054: refuse when any role-reputation history exists. No history deletion.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM role_reputation_decisions)
     OR EXISTS (SELECT 1 FROM role_reputation_case_links)
     OR EXISTS (SELECT 1 FROM role_reputation_reports)
     OR EXISTS (SELECT 1 FROM role_reputation_pending_intakes)
     OR EXISTS (SELECT 1 FROM role_review_reply_revisions)
     OR EXISTS (SELECT 1 FROM role_review_replies)
     OR EXISTS (SELECT 1 FROM role_review_revisions)
     OR EXISTS (SELECT 1 FROM role_review_event_fences)
     OR EXISTS (SELECT 1 FROM role_review_slots)
     OR EXISTS (SELECT 1 FROM game_role_proofs)
     OR EXISTS (SELECT 1 FROM game_role_proof_revisions)
     OR EXISTS (SELECT 1 FROM role_reputation_subjects)
  THEN
    RAISE EXCEPTION
      'rollback 0054 blocked: role reputation history exists'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DROP TRIGGER IF EXISTS role_reputation_decisions_immutable ON role_reputation_decisions;
DROP TRIGGER IF EXISTS role_reputation_case_links_immutable ON role_reputation_case_links;
DROP TRIGGER IF EXISTS role_reputation_reports_immutable ON role_reputation_reports;
DROP TRIGGER IF EXISTS role_review_reply_revisions_immutable ON role_review_reply_revisions;
DROP TRIGGER IF EXISTS role_review_revisions_immutable ON role_review_revisions;
DROP TRIGGER IF EXISTS role_review_event_fences_immutable ON role_review_event_fences;
DROP TRIGGER IF EXISTS game_role_proof_revisions_immutable ON game_role_proof_revisions;

DROP TABLE IF EXISTS role_reputation_decisions;
DROP TABLE IF EXISTS role_reputation_case_links;
DROP TABLE IF EXISTS role_reputation_reports;
DROP TABLE IF EXISTS role_reputation_pending_intakes;
DROP TABLE IF EXISTS role_review_reply_revisions;
DROP TABLE IF EXISTS role_review_replies;
DROP TABLE IF EXISTS role_review_revisions;
DROP TABLE IF EXISTS role_review_event_fences;
DROP TABLE IF EXISTS role_review_slots;
DROP TABLE IF EXISTS game_role_proofs;
DROP TABLE IF EXISTS game_role_proof_revisions;
DROP TABLE IF EXISTS role_reputation_subjects;

DELETE FROM schema_migrations WHERE id = '0054_role_reputation';
