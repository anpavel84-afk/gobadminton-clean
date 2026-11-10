-- Application rollback retains additive candidate/provenance/audit data and paid evidence.
-- Destructive schema rollback requires a separately reviewed data migration.
DO $$ BEGIN RAISE EXCEPTION '0071 candidate history cannot be destructively rolled back'; END $$;
