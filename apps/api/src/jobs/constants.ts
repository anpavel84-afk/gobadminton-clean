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

/** #456 Web Push delivery queue (references only; no message body / secrets). */
export const WEB_PUSH_DELIVER_QUEUE = "web.push.deliver";

/** Dead-letter companion for terminal push delivery failures. */
export const WEB_PUSH_DELIVER_DEAD_LETTER_QUEUE = "web.push.deliver.failed";

/** Bounded recover of durable intents left pending when PgBoss enqueue failed. */
export const WEB_PUSH_INTENT_RECOVER_SINGLETON_KEY = "web-push-intent-recover";

/** Max pending intents claimed per recover tick (existing worker schedule). */
export const WEB_PUSH_INTENT_RECOVER_BATCH_LIMIT = 50;

/** #457 bounded internal post-game organizer reminder sweep queue. */
export const POSTGAME_REMINDERS_SWEEP_QUEUE = "postgame.reminders.sweep";

/** Dead-letter companion for terminal reminder sweep failures. */
export const POSTGAME_REMINDERS_SWEEP_DEAD_LETTER_QUEUE =
  "postgame.reminders.sweep.failed";

/** Recurring reminder sweep singleton key (one in-flight schedule slot). */
export const POSTGAME_REMINDERS_SWEEP_SINGLETON_KEY = "postgame-reminders-sweep";

/**
 * Legacy `outbox_events` backlog classification (LS-02):
 * KEEP_AS_EVIDENCE — business audit/evidence rows remain; do not replay into
 * pg-boss or user notifications. New required async work uses pg-boss same-TX
 * enqueue. LS-04 extends payload kinds with invitation expiry + sweep.
 * #456 does not deliver historical outbox KEEP_AS_EVIDENCE rows.
 * #457 does not replay historical outbox; only new durable reminder rows.
 */
export const OUTBOX_BACKLOG_CLASSIFICATION = "KEEP_AS_EVIDENCE" as const;
