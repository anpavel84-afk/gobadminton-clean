import type { Pool } from "pg";
import type { AppEnv } from "../config/env";

/**
 * Owner #506 / Refs #488 · temporary DEV-only product quantity pause.
 * Hard expiry bound to Owner decision — not a generic kill switch, not config/env deploy.
 * Automatic return of 10/15min and 50/24h caps at this instant (SQL `now()` / trusted clock).
 */
export const DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL = new Date("2027-01-01T00:00:00.000Z");

export const MODERATION_QUANTITY_WINDOW_LIMIT = 10;
export const MODERATION_QUANTITY_DAY_LIMIT = 50;

export type ModerationQuotaEnv = Pick<
  AppEnv,
  "NODE_ENV" | "APP_ENV" | "PUBLIC_WEB_ORIGIN" | "PUBLIC_API_ORIGIN"
>;

/**
 * Exact trusted DEV runtime discrimination (mvp|stage + production + both public origins).
 * Independent of Admin/QA flags. Request Origin headers never admit pause.
 * APP_ENV=dev is not a valid admission value.
 */
export function isExactTrustedDevModerationEnv(env: ModerationQuotaEnv): boolean {
  return (
    env.NODE_ENV === "production" &&
    (env.APP_ENV === "mvp" || env.APP_ENV === "stage") &&
    env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru" &&
    env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru"
  );
}

/** Source-helper date+environment guard (testable with injected `now`). */
export function isDevModerationQuantityQuotaPauseActive(
  env: ModerationQuotaEnv,
  now: Date = new Date(),
): boolean {
  return (
    isExactTrustedDevModerationEnv(env) &&
    now.getTime() < DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL.getTime()
  );
}

export type ReserveModerationAttemptOptions = {
  /** Trusted server env discrimination only — never derived from request Origin. */
  trustedDevEnv: boolean;
  /** Owner hard deadline; production always binds {@link DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL}. */
  pauseUntil: Date;
};

/**
 * Atomic autocommit reservation. Quantity caps may be bypassed only while
 * `trustedDevEnv && now() < pauseUntil`; `next_allowed_at` is never bypassed.
 * Counts / day_counts still increment on every successful reservation.
 */
export async function reserveModerationAttemptRow(
  pool: Pick<Pool, "query">,
  actorId: string,
  bucket: "image" | "text",
  options: ReserveModerationAttemptOptions,
): Promise<boolean> {
  const result = await pool.query(
    `
      INSERT INTO content_moderation_rate_budgets(user_id,bucket,window_started_at,count,day_started_at,day_count)
      VALUES ($1,$2,now(),1,now(),1)
      ON CONFLICT(user_id,bucket) DO UPDATE SET
        window_started_at=CASE WHEN content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' THEN now() ELSE content_moderation_rate_budgets.window_started_at END,
        count=CASE WHEN content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' THEN 1 ELSE content_moderation_rate_budgets.count+1 END,
        day_started_at=CASE WHEN content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' THEN now() ELSE content_moderation_rate_budgets.day_started_at END,
        day_count=CASE WHEN content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' THEN 1 ELSE content_moderation_rate_budgets.day_count+1 END,
        updated_at=now()
      WHERE (
          ($3::boolean AND now() < $4::timestamptz)
          OR (
            (content_moderation_rate_budgets.window_started_at <= now()-interval '15 minutes' OR content_moderation_rate_budgets.count < 10)
            AND (content_moderation_rate_budgets.day_started_at <= now()-interval '1 day' OR content_moderation_rate_budgets.day_count < 50)
          )
        )
        AND (content_moderation_rate_budgets.next_allowed_at IS NULL OR content_moderation_rate_budgets.next_allowed_at <= now())
      RETURNING user_id`,
    [actorId, bucket, options.trustedDevEnv, options.pauseUntil],
  );
  return (result.rowCount ?? 0) > 0;
}
