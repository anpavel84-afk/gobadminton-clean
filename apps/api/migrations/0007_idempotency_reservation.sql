-- S-00A: insert-first idempotency reservation (ADR-SOCIAL-003).
-- Additive only. Existing completed receipts keep status_code/response_body.
-- Controlled binary switch required before mixed old/new writers in deploy
-- (this slice admits no deploy).

ALTER TABLE idempotency_records
  ADD COLUMN reservation_state text NOT NULL DEFAULT 'completed'
    CHECK (reservation_state IN ('processing', 'completed'));

ALTER TABLE idempotency_records
  ALTER COLUMN status_code DROP NOT NULL,
  ALTER COLUMN response_body DROP NOT NULL;

ALTER TABLE idempotency_records
  DROP CONSTRAINT IF EXISTS idempotency_records_status_code_check;

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_status_code_check
    CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599);

ALTER TABLE idempotency_records
  ADD CONSTRAINT idempotency_records_state_fields_chk CHECK (
    (
      reservation_state = 'processing'
      AND status_code IS NULL
      AND response_body IS NULL
    )
    OR (
      reservation_state = 'completed'
      AND status_code IS NOT NULL
      AND response_body IS NOT NULL
    )
  );

COMMENT ON COLUMN idempotency_records.reservation_state IS
  'processing = in-flight reservation (uncommitted until completed or rolled back); completed = durable receipt';
