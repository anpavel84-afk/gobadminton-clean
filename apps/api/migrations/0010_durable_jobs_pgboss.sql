-- LS-02: durable jobs / pg-boss support indexes + outbox backlog classification.
-- Additive only. Does not edit 0001–0009.
-- pg-boss schema/tables are created/migrated by the pinned library on process start
-- (same database; not a separately versioned microservice).
--
-- outbox_events backlog classification: KEEP_AS_EVIDENCE.
-- Existing rows remain business audit/evidence. Do not replay historical outbox
-- into pg-boss or user notifications. New required async work uses same-TX
-- pg-boss enqueue. LS-03 DM request-expiry is a follow-on job seam.

-- Speeds bounded expiry sweeps for looking intents (on-read expiry remains authoritative).
CREATE INDEX IF NOT EXISTS player_looking_intents_expired_active_idx
  ON player_looking_intents (expires_at)
  WHERE active = true AND expires_at IS NOT NULL;

-- Speeds bounded RadarPresence cleanup (reads/commands still enforce expiry without worker).
CREATE INDEX IF NOT EXISTS radar_presences_cleanup_idx
  ON radar_presences (expires_at, foreground_until, location_valid_until);
