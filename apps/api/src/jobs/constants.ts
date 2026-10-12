/** Pinned pg-boss version for LS-02 (Node 24.21.0 / PostgreSQL). */
export const PG_BOSS_PINNED_VERSION = "12.36.0";

/** First admitted durable job: bounded social expiry/cleanup (no DM). */
export const SOCIAL_EXPIRY_CLEANUP_QUEUE = "social.expiry.cleanup";

/** Dead-letter companion for terminal failures (operable, no private dumps). */
export const SOCIAL_EXPIRY_CLEANUP_DEAD_LETTER_QUEUE =
  "social.expiry.cleanup.failed";

/** Recurring sweep singleton key (one in-flight schedule slot). */
export const SOCIAL_EXPIRY_SWEEP_SINGLETON_KEY = "social-expiry-sweep";

/** Bounded rows touched per sweep/handler invocation. */
export const SOCIAL_EXPIRY_CLEANUP_BATCH_LIMIT = 200;

/**
 * Legacy `outbox_events` backlog classification (LS-02):
 * KEEP_AS_EVIDENCE — business audit/evidence rows remain; do not replay into
 * pg-boss or user notifications. New required async work uses pg-boss same-TX
 * enqueue. LS-04 extends payload kinds with invitation expiry + sweep.
 */
export const OUTBOX_BACKLOG_CLASSIFICATION = "KEEP_AS_EVIDENCE" as const;
