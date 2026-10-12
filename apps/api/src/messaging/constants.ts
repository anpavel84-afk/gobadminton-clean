/** Fixture policy defaults for synthetic/engineering (not Legal final). */

/** P-06 recommendation: ~7d pending request expiry. */
export const DM_REQUEST_TTL_SECONDS_DEFAULT = 7 * 24 * 60 * 60;

/** Bounded body retention fixture: 90d then purge to tombstone meta. */
export const DM_MESSAGE_RETENTION_SECONDS_DEFAULT = 90 * 24 * 60 * 60;

export const DM_TEXT_MAX_CHARS = 2000;
export const DM_CLIENT_MESSAGE_ID_MAX = 128;
export const DM_PAGE_DEFAULT = 30;
export const DM_PAGE_MAX = 100;

/** Bounded cleanup batch for worker/sweep. */
export const DM_CLEANUP_BATCH_LIMIT = 200;
