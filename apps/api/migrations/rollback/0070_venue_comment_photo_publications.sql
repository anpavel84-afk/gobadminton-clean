-- Fail closed: an I2b rollback must never discard published UGC, approvals or history.
-- Roll back application traffic with writes disabled; retain this additive schema.
DO $$ BEGIN
  RAISE EXCEPTION '0070 retains published photo evidence; destructive rollback prohibited. Keep additive schema and disable I2b writes.';
END $$;
