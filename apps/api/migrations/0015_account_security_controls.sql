-- Account security controls: bind OAuth link transactions to the current
-- authenticated session. Login transactions remain unbound (purpose=login).

ALTER TABLE auth_transactions
  ADD COLUMN purpose text NOT NULL DEFAULT 'login'
    CHECK (purpose IN ('login', 'link')),
  ADD COLUMN bound_user_id uuid NULL REFERENCES users (id),
  ADD COLUMN bound_session_id uuid NULL REFERENCES app_sessions (id);

ALTER TABLE auth_transactions
  ADD CONSTRAINT auth_transactions_link_bound_chk
  CHECK (
    (purpose = 'login' AND bound_user_id IS NULL AND bound_session_id IS NULL)
    OR (
      purpose = 'link'
      AND bound_user_id IS NOT NULL
      AND bound_session_id IS NOT NULL
    )
  );

CREATE INDEX auth_transactions_bound_session_idx
  ON auth_transactions (bound_session_id)
  WHERE purpose = 'link' AND consumed_at IS NULL;
