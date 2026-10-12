/** Fixture policy defaults for synthetic/engineering (not Legal final). */

/** Pending invitation TTL (~7d), also capped by Game.applicationDeadlineAt. */
export const INVITATION_TTL_SECONDS_DEFAULT = 7 * 24 * 60 * 60;

export const INVITATION_PAGE_DEFAULT = 20;
export const INVITATION_PAGE_MAX = 100;

/** Bounded cleanup batch for worker/sweep. */
export const INVITATION_CLEANUP_BATCH_LIMIT = 200;
