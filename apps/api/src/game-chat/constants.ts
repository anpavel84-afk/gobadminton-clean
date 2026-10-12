/** Fixture policy defaults for synthetic/engineering (not Legal final). */

/** Bounded body retention fixture: 90d then purge to tombstone meta. */
export const GAME_CHAT_MESSAGE_RETENTION_SECONDS_DEFAULT = 90 * 24 * 60 * 60;

export const GAME_CHAT_TEXT_MAX_CHARS = 2000;
export const GAME_CHAT_CLIENT_MESSAGE_ID_MAX = 128;
export const GAME_CHAT_PAGE_DEFAULT = 30;
export const GAME_CHAT_PAGE_MAX = 100;

/** Bounded cleanup batch for worker/sweep (shared messages table). */
export const GAME_CHAT_CLEANUP_BATCH_LIMIT = 200;
