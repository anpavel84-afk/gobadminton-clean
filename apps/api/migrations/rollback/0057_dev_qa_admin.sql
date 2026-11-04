-- Revoke QA and remove only its capability; existing WebAuthn sessions preserved.
-- Audit FK forbids deletion of sessions: keep revoked QA session history; schema rollback
-- therefore requires an explicit archival operation, not destructive silent downgrade.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM admin_sessions WHERE auth_method='dev_qa_key') THEN
  RAISE EXCEPTION 'Retain QA audit/session history; use application rollback with QA flag OFF, not destructive schema rollback';
 END IF;
END $$;
DELETE FROM admin_dev_qa_nonces;
ALTER TABLE admin_sessions DROP CONSTRAINT admin_sessions_auth_branch;
ALTER TABLE admin_sessions DROP CONSTRAINT admin_sessions_qa_owner_fk;
ALTER TABLE admin_sessions DROP COLUMN qa_credential_id;
ALTER TABLE admin_sessions DROP COLUMN auth_method;
ALTER TABLE admin_sessions ALTER COLUMN credential_id SET NOT NULL;
ALTER TABLE admin_sessions ADD CONSTRAINT admin_sessions_audience_check CHECK(audience='gobadminton-admin');
DROP TABLE admin_dev_qa_nonces;
DROP TABLE admin_dev_qa_credentials;
DELETE FROM admin_role_grants WHERE role='pilot_viewer';
ALTER TABLE admin_role_grants DROP CONSTRAINT admin_role_grants_role_check;
ALTER TABLE admin_role_grants ADD CONSTRAINT admin_role_grants_role_check CHECK(role IN ('superadmin','content_manager','moderator','support'));
