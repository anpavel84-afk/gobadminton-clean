-- E3 additive: current-mailbox proof is exact-session/original-credential bound.
ALTER TABLE email_auth_challenges DROP CONSTRAINT email_auth_challenges_purpose_check;
ALTER TABLE email_auth_challenges DROP CONSTRAINT email_auth_challenges_check;
ALTER TABLE email_auth_challenges ADD COLUMN original_method_id uuid REFERENCES email_auth_methods(id);
ALTER TABLE email_auth_challenges ADD COLUMN change_proof_id uuid REFERENCES email_auth_challenges(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX email_auth_change_proof_once_uidx ON email_auth_challenges(change_proof_id) WHERE change_proof_id IS NOT NULL;
ALTER TABLE email_auth_challenges ADD CONSTRAINT email_auth_challenge_purpose_v2 CHECK (purpose IN ('login_signup','link','change_current','change'));
ALTER TABLE email_auth_challenges ADD CONSTRAINT email_auth_challenge_binding_v2 CHECK (
 (purpose='login_signup' AND browser_binding_hash IS NOT NULL AND bound_user_id IS NULL AND bound_session_id IS NULL)
 OR (purpose IN ('link','change_current','change') AND browser_binding_hash IS NULL AND bound_user_id IS NOT NULL AND bound_session_id IS NOT NULL));
ALTER TABLE email_auth_challenges ADD CONSTRAINT email_auth_challenge_original_method CHECK (
 (purpose IN ('change_current','change') AND original_method_id IS NOT NULL)
 OR (purpose IN ('login_signup','link') AND original_method_id IS NULL AND change_proof_id IS NULL));
