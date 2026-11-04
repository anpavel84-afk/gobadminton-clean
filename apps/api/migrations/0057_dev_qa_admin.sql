-- Owner #480: explicit DEV-only QA authentication, independent from WebAuthn.
ALTER TABLE admin_role_grants DROP CONSTRAINT admin_role_grants_role_check;
ALTER TABLE admin_role_grants ADD CONSTRAINT admin_role_grants_role_check
 CHECK(role IN ('superadmin','content_manager','moderator','support','pilot_viewer'));
CREATE TABLE admin_dev_qa_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES admin_principals(id),
 label text NOT NULL CHECK(label='gobad-qa-dev'),
 key_hash text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days'),
 UNIQUE(id,principal_id)
);
CREATE UNIQUE INDEX admin_dev_qa_one_active ON admin_dev_qa_credentials(label) WHERE revoked_at IS NULL;
CREATE TRIGGER admin_dev_qa_parent_fence BEFORE INSERT OR UPDATE OR DELETE ON admin_dev_qa_credentials
 FOR EACH ROW EXECUTE FUNCTION fence_admin_authority_child();
ALTER TABLE admin_sessions ALTER COLUMN credential_id DROP NOT NULL;
ALTER TABLE admin_sessions DROP CONSTRAINT admin_sessions_audience_check;
ALTER TABLE admin_sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'webauthn';
ALTER TABLE admin_sessions ADD COLUMN qa_credential_id uuid;
ALTER TABLE admin_sessions ADD CONSTRAINT admin_sessions_qa_owner_fk
 FOREIGN KEY(qa_credential_id,principal_id) REFERENCES admin_dev_qa_credentials(id,principal_id);
ALTER TABLE admin_sessions ADD CONSTRAINT admin_sessions_auth_branch CHECK (
 (auth_method='webauthn' AND credential_id IS NOT NULL AND qa_credential_id IS NULL AND audience='gobadminton-admin') OR
 (auth_method='dev_qa_key' AND credential_id IS NULL AND qa_credential_id IS NOT NULL AND audience='gobadminton-admin-dev-qa'
 AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE admin_dev_qa_nonces (
 credential_id uuid NOT NULL REFERENCES admin_dev_qa_credentials(id),
 nonce_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(credential_id,nonce_hash)
);
