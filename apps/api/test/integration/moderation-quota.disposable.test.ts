import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
  reserveModerationAttemptRow,
} from "../../src/moderation/moderation-quota-policy";

const DB_NAME = "gobadminton_moderation_quota_disposable";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

/** Dedicated local DB, or the exact existing ephemeral Actions recipe. No fallback. */
function disposableUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL must explicitly identify the moderation-quota disposable DB");
  const url = new URL(raw);
  const dedicated = decodeURIComponent(url.pathname) === `/${DB_NAME}`;
  const hosted =
    url.pathname === "/gobadminton" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GMAP1_DISPOSABLE_DB === "1" &&
    /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "") &&
    url.port === process.env.CI_DB_PORT;
  if (
    process.env.NODE_ENV !== "test" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !(dedicated || hosted)
  ) {
    throw new Error("Refusing nonlocal/non-test/nonisolated moderation-quota DB before connecting");
  }
  return raw;
}

run("moderation quantity quota reservation — synthetic PostGIS only", () => {
  let pool: Pool;
  let userId: string;
  let providerIo = 0;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: disposableUrl(),
      max: 4,
      connectionTimeoutMillis: 5000,
      application_name: "moderation-quota-synthetic",
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS content_moderation_rate_budgets (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bucket text NOT NULL CHECK (bucket IN ('text','image')),
        window_started_at timestamptz NOT NULL,
        count integer NOT NULL CHECK (count >= 0),
        day_started_at timestamptz NOT NULL,
        day_count integer NOT NULL CHECK (day_count >= 0),
        next_allowed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id,bucket)
      );
    `);
  });

  beforeEach(async () => {
    userId = randomUUID();
    providerIo = 0;
    await pool.query("DELETE FROM content_moderation_rate_budgets");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users(id) VALUES ($1)", [userId]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function seed(opts: {
    count: number;
    dayCount: number;
    nextAllowedAt?: Date | null;
  }) {
    await pool.query(
      `INSERT INTO content_moderation_rate_budgets(user_id,bucket,window_started_at,count,day_started_at,day_count,next_allowed_at)
       VALUES ($1,'image',now(),$2,now(),$3,$4)`,
      [userId, opts.count, opts.dayCount, opts.nextAllowedAt ?? null],
    );
  }

  async function row() {
    return (
      await pool.query<{ count: number; day_count: number }>(
        "SELECT count, day_count FROM content_moderation_rate_budgets WHERE user_id=$1 AND bucket='image'",
        [userId],
      )
    ).rows[0];
  }

  it("local/non-DEV over-quota still 429-equivalent without provider I/O", async () => {
    await seed({ count: 10, dayCount: 10 });
    const ok = await reserveModerationAttemptRow(pool, userId, "image", {
      trustedDevEnv: false,
      pauseUntil: DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
    });
    expect(ok).toBe(false);
    expect(await row()).toEqual({ count: 10, day_count: 10 });
    expect(providerIo).toBe(0);
  });

  it("trusted DEV pause permits over-quota and still increments counts", async () => {
    await seed({ count: 10, dayCount: 50 });
    const ok = await reserveModerationAttemptRow(pool, userId, "image", {
      trustedDevEnv: true,
      pauseUntil: DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
    });
    expect(ok).toBe(true);
    expect(await row()).toEqual({ count: 11, day_count: 51 });
    expect(providerIo).toBe(0);
  });

  it("deadline before/at/after uses SQL now() against bound pauseUntil", async () => {
    await seed({ count: 10, dayCount: 50 });
    const clock = await pool.query<{ now: Date }>("SELECT now() AS now");
    const serverNow = clock.rows[0]!.now.getTime();

    const before = new Date(serverNow + 60_000);
    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: true,
        pauseUntil: before,
      }),
    ).toBe(true);
    expect(await row()).toEqual({ count: 11, day_count: 51 });

    await pool.query(
      "UPDATE content_moderation_rate_budgets SET count=10, day_count=50 WHERE user_id=$1",
      [userId],
    );
    const at = new Date(serverNow);
    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: true,
        pauseUntil: at,
      }),
    ).toBe(false);
    expect(await row()).toEqual({ count: 10, day_count: 50 });

    const after = new Date(serverNow - 1_000);
    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: true,
        pauseUntil: after,
      }),
    ).toBe(false);
    expect(await row()).toEqual({ count: 10, day_count: 50 });
  });

  it("non-DEV fail-closed even with future pauseUntil", async () => {
    await seed({ count: 10, dayCount: 50 });
    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: false,
        pauseUntil: new Date(Date.now() + 86400_000),
      }),
    ).toBe(false);
    expect(await row()).toEqual({ count: 10, day_count: 50 });
  });

  it("next_allowed_at provider backoff is never bypassed by quantity pause", async () => {
    await seed({
      count: 3,
      dayCount: 3,
      nextAllowedAt: new Date(Date.now() + 900_000),
    });
    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: true,
        pauseUntil: DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
      }),
    ).toBe(false);
    expect(await row()).toEqual({ count: 3, day_count: 3 });

    await pool.query(
      "UPDATE content_moderation_rate_budgets SET next_allowed_at=now()-interval '1 second' WHERE user_id=$1",
      [userId],
    );
    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: true,
        pauseUntil: DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
      }),
    ).toBe(true);
    expect(await row()).toEqual({ count: 4, day_count: 4 });
    expect(providerIo).toBe(0);
  });

  it("day cap alone blocks without DEV pause; rolling window bookkeeping retained under pause", async () => {
    await seed({ count: 1, dayCount: 50 });
    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: false,
        pauseUntil: DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
      }),
    ).toBe(false);

    expect(
      await reserveModerationAttemptRow(pool, userId, "image", {
        trustedDevEnv: true,
        pauseUntil: DEV_MODERATION_QUANTITY_QUOTA_PAUSE_UNTIL,
      }),
    ).toBe(true);
    expect(await row()).toEqual({ count: 2, day_count: 51 });
  });
});
