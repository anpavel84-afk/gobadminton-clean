-- New P4 migration; 0001..0026 remain immutable.
ALTER TABLE venues ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
-- A canonical venue may own several historical identity reservations after merge.
DROP INDEX venue_identity_keys_venue_version_uidx;
CREATE INDEX venue_identity_keys_venue_version_idx ON venue_identity_keys(venue_id, normalization_version);
ALTER TABLE venue_duplicate_candidates ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE venue_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id),
  venue_version integer NOT NULL,
  action text NOT NULL,
  actor_id uuid NOT NULL REFERENCES admin_principals(id),
  audit_id uuid NOT NULL REFERENCES privileged_audit_events(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(venue_id, venue_version)
);
CREATE TRIGGER venue_admin_actions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON venue_admin_actions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_privileged_audit_mutation();
