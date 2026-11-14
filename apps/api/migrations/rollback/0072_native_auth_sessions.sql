-- SAFE ROLLBACK: set NATIVE_AUTH_ENABLED=0 in trusted configuration.
-- Retain additive schema, credential hashes and consumed/revoked history.
-- Destructive schema rollback is deliberately unsupported.
SELECT 1;
