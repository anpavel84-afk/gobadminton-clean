import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { unrestrictedSql } from "../restrictions/policy";
import {
  REMINDER_MAX_ORDINAL,
  REMINDER_SWEEP_BATCH,
  dueAtForOrdinal,
  gameEligibleForReminders,
  isOrdinal,
  isReminderDue,
  isSnoozeExpired,
  reminderWritesEnabled,
  type ReminderOrdinal,
  type ReminderStopReason,
} from "./game-reminders.policy";

export type SqlExecutor = {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
};

export type PostgameRemindersSweepPayload = {
  kind: "sweep";
};

export type PostgameRemindersSweepResult = {
  scanned: number;
  ensured: number;
  activated: number;
  stopped: number;
  skipped: boolean;
  skipReason: string | null;
};

export function sqlExecutorFromPg(db: Pool | PoolClient): SqlExecutor {
  return {
    async query<T = Record<string, unknown>>(text: string, values?: unknown[]) {
      const result = await db.query(text, values);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    },
  };
}

/**
 * Probe relation BEFORE any transactional work. Never catch 42P01 inside a TX
 * and treat it as a successful empty sweep (prior real push bug class).
 */
export async function probeRemindersInstalled(
  db: SqlExecutor | Pool | PoolClient,
): Promise<boolean> {
  const exec =
    "query" in db && typeof db.query === "function" && !("connect" in db)
      ? (db as SqlExecutor)
      : sqlExecutorFromPg(db as Pool | PoolClient);
  const result = await exec.query<{ name: string | null }>(
    `SELECT to_regclass('public.game_outcome_reminders')::text AS name`,
  );
  return Boolean(result.rows[0]?.name);
}

/**
 * Bounded recurring sweep for #457 internal organizer reminders.
 * Lock order per game: Game → managers (no Actor fence; worker path).
 * Does not invert locks with MutationRunner Actor→Game paths.
 */
export class GameRemindersCommand {
  constructor(private readonly env: AppEnv) {}

  async execute(
    db: SqlExecutor | Pool,
    _payload: PostgameRemindersSweepPayload,
    opts: { now?: Date; batchLimit?: number; manageTransactions?: boolean } = {},
  ): Promise<PostgameRemindersSweepResult> {
    const empty = (reason: string): PostgameRemindersSweepResult => ({
      scanned: 0,
      ensured: 0,
      activated: 0,
      stopped: 0,
      skipped: true,
      skipReason: reason,
    });

    // Fail-closed outside admitted post-game writes; preserves unrelated fixtures.
    if (!reminderWritesEnabled(this.env)) {
      return empty("writes_disabled");
    }

    const pool = isPool(db) ? db : null;
    const readExec = pool ? sqlExecutorFromPg(pool) : db;

    // Probe with pool/connection BEFORE domain queries — to_regclass, never catch 42P01.
    if (!(await probeRemindersInstalled(readExec))) {
      return empty("schema_missing");
    }

    const batch = opts.batchLimit ?? REMINDER_SWEEP_BATCH;
    const nowRow = await readExec.query<{ now: Date }>(
      opts.now
        ? `SELECT $1::timestamptz AS now`
        : `SELECT clock_timestamp() AS now`,
      opts.now ? [opts.now.toISOString()] : undefined,
    );
    const now = nowRow.rows[0]!.now;

    const candidates = await readExec.query<{ id: string }>(
      `SELECT g.id
       FROM games g
       WHERE g.ends_at <= $1
         AND g.status IN ('published', 'completed', 'cancelled')
         AND NOT EXISTS (
           SELECT 1 FROM game_outcomes go WHERE go.game_id = g.id
         )
       ORDER BY g.ends_at ASC, g.id ASC
       LIMIT $2`,
      [now, batch],
    );

    // Also re-check games that already have open reminder rows (role/outcome/cancel).
    const openGames = await readExec.query<{ game_id: string }>(
      `SELECT DISTINCT game_id
       FROM game_outcome_reminders
       WHERE state IN ('scheduled', 'visible', 'snoozed')
       ORDER BY game_id ASC
       LIMIT $1`,
      [batch],
    );

    const gameIds = [
      ...new Set([
        ...candidates.rows.map((r) => r.id),
        ...openGames.rows.map((r) => r.game_id),
      ]),
    ].slice(0, batch);

    let ensured = 0;
    let activated = 0;
    let stopped = 0;
    const manageTx = opts.manageTransactions ?? Boolean(pool);

    for (const gameId of gameIds) {
      if (manageTx && pool) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await this.processGame(
            sqlExecutorFromPg(client),
            gameId,
            now,
          );
          await client.query("COMMIT");
          ensured += result.ensured;
          activated += result.activated;
          stopped += result.stopped;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      } else {
        const result = await this.processGame(readExec, gameId, now);
        ensured += result.ensured;
        activated += result.activated;
        stopped += result.stopped;
      }
    }

    return {
      scanned: gameIds.length,
      ensured,
      activated,
      stopped,
      skipped: false,
      skipReason: null,
    };
  }

  private async processGame(
    db: SqlExecutor,
    gameId: string,
    now: Date,
  ): Promise<{ ensured: number; activated: number; stopped: number }> {
    // Game lock first (worker). Never lock users/actors before game here.
    const game = (
      await db.query<{
        id: string;
        status: string;
        ends_at: Date;
        title: string | null;
      }>(
        `SELECT id, status, ends_at, title
         FROM games
         WHERE id = $1
         FOR UPDATE`,
        [gameId],
      )
    ).rows[0];
    if (!game) return { ensured: 0, activated: 0, stopped: 0 };

    const outcome = (
      await db.query<{ value: "held" | "not_held" }>(
        `SELECT value FROM game_outcomes WHERE game_id = $1`,
        [gameId],
      )
    ).rows[0];

    const life = gameEligibleForReminders({
      status: game.status,
      endsAt: game.ends_at,
      now,
      outcomeValue: outcome?.value ?? null,
    });

    const managers = await db.query<{ user_id: string }>(
      `SELECT user_id
       FROM game_managers
       WHERE game_id = $1
         AND status = 'active'
         AND role IN ('owner', 'manager')
       ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC, user_id ASC
       FOR UPDATE`,
      [gameId],
    );

    let ensured = 0;
    let activated = 0;
    let stopped = 0;

    if (!life.ok && life.stop) {
      stopped += await this.stopOpenForGame(db, gameId, life.stop, now);
      return { ensured, activated, stopped };
    }

    // Future / ineligible without stop reason: wait; do not mint or activate.
    if (!life.ok) {
      return { ensured, activated, stopped };
    }

    const activeIds = new Set(managers.rows.map((m) => m.user_id));

    // Stop reminders for organizers who lost the role.
    const openRows = await db.query<{
      id: string;
      organizer_user_id: string;
      state: string;
      version: number;
    }>(
      `SELECT id, organizer_user_id, state, version
       FROM game_outcome_reminders
       WHERE game_id = $1
         AND state IN ('scheduled', 'visible', 'snoozed')
       FOR UPDATE`,
      [gameId],
    );
    for (const row of openRows.rows) {
      if (!activeIds.has(row.organizer_user_id)) {
        await this.stopReminder(db, row.id, "role_lost", now);
        stopped += 1;
        continue;
      }
      const account = await this.accountGate(db, row.organizer_user_id);
      if (!account.ok) {
        await this.stopReminder(db, row.id, account.reason, now);
        stopped += 1;
      }
    }

    for (const manager of managers.rows) {
      const account = await this.accountGate(db, manager.user_id);
      // Restricted/inactive organizers already stopped above; do not mint new ordinals.
      if (!account.ok) continue;

      for (let n = 1; n <= REMINDER_MAX_ORDINAL; n += 1) {
        if (!isOrdinal(n)) continue;
        const dueAt = dueAtForOrdinal(game.ends_at, n);
        const inserted = await db.query<{ id: string }>(
          `INSERT INTO game_outcome_reminders
             (game_id, organizer_user_id, ordinal, version, state, due_at)
           VALUES ($1, $2, $3, 1, 'scheduled', $4)
           ON CONFLICT (game_id, organizer_user_id, ordinal) DO NOTHING
           RETURNING id`,
          [gameId, manager.user_id, n, dueAt],
        );
        if (inserted.rows[0]) {
          ensured += 1;
          await this.appendEvent(db, {
            reminderId: inserted.rows[0].id,
            gameId,
            organizerUserId: manager.user_id,
            ordinal: n,
            eventKind: "created",
            detail: null,
            at: now,
          });
        }
      }

      const slots = await db.query<{
        id: string;
        ordinal: number;
        state: string;
        due_at: Date;
        snoozed_until: Date | null;
        version: number;
      }>(
        `SELECT id, ordinal, state, due_at, snoozed_until, version
         FROM game_outcome_reminders
         WHERE game_id = $1
           AND organizer_user_id = $2
           AND state IN ('scheduled', 'snoozed')
         ORDER BY ordinal ASC
         FOR UPDATE`,
        [gameId, manager.user_id],
      );

      for (const slot of slots.rows) {
        if (!isOrdinal(slot.ordinal)) continue;
        const due =
          slot.state === "scheduled"
            ? isReminderDue({ now, endsAt: game.ends_at, dueAt: slot.due_at })
            : isSnoozeExpired({
                now,
                state: "snoozed",
                snoozedUntil: slot.snoozed_until,
              }) && game.ends_at.getTime() <= now.getTime();
        if (!due) continue;
        await db.query(
          `UPDATE game_outcome_reminders
           SET state = 'visible',
               visible_at = COALESCE(visible_at, $2),
               snoozed_until = NULL,
               version = version + 1,
               updated_at = $2
           WHERE id = $1
             AND state IN ('scheduled', 'snoozed')`,
          [slot.id, now],
        );
        await this.appendEvent(db, {
          reminderId: slot.id,
          gameId,
          organizerUserId: manager.user_id,
          ordinal: slot.ordinal,
          eventKind: "activated",
          detail: slot.state === "snoozed" ? "snooze_expired" : "due",
          at: now,
        });
        activated += 1;
      }
    }

    return { ensured, activated, stopped };
  }

  private async accountGate(
    db: SqlExecutor,
    userId: string,
  ): Promise<{ ok: true } | { ok: false; reason: ReminderStopReason }> {
    const user = (
      await db.query<{ status: string }>(
        `SELECT status FROM users WHERE id = $1`,
        [userId],
      )
    ).rows[0];
    if (!user || user.status !== "active") {
      return { ok: false, reason: "account_inactive" };
    }
    if (this.env.USER_RESTRICTIONS_INTERNAL_ENABLED) {
      const denied = await db.query(
        `SELECT 1 WHERE NOT (${unrestrictedSql(true, "$1", ["account.access"])})`,
        [userId],
      );
      if (denied.rows.length) {
        return { ok: false, reason: "account_restricted" };
      }
    }
    return { ok: true };
  }

  private async stopOpenForGame(
    db: SqlExecutor,
    gameId: string,
    reason: ReminderStopReason,
    now: Date,
  ): Promise<number> {
    const open = await db.query<{ id: string }>(
      `SELECT id
       FROM game_outcome_reminders
       WHERE game_id = $1
         AND state IN ('scheduled', 'visible', 'snoozed')
       FOR UPDATE`,
      [gameId],
    );
    for (const row of open.rows) {
      await this.stopReminder(db, row.id, reason, now);
    }
    return open.rows.length;
  }

  private async stopReminder(
    db: SqlExecutor,
    reminderId: string,
    reason: ReminderStopReason,
    now: Date,
  ): Promise<void> {
    const row = (
      await db.query<{
        id: string;
        game_id: string;
        organizer_user_id: string;
        ordinal: number;
        state: string;
      }>(
        `UPDATE game_outcome_reminders
         SET state = 'stopped',
             stop_reason = $2,
             stopped_at = $3,
             snoozed_until = NULL,
             version = version + 1,
             updated_at = $3
         WHERE id = $1
           AND state IN ('scheduled', 'visible', 'snoozed')
         RETURNING id, game_id, organizer_user_id, ordinal, state`,
        [reminderId, reason, now],
      )
    ).rows[0];
    if (!row || !isOrdinal(row.ordinal)) return;
    await this.appendEvent(db, {
      reminderId: row.id,
      gameId: row.game_id,
      organizerUserId: row.organizer_user_id,
      ordinal: row.ordinal,
      eventKind: "stopped",
      detail: reason,
      at: now,
    });
  }

  private async appendEvent(
    db: SqlExecutor,
    input: {
      reminderId: string;
      gameId: string;
      organizerUserId: string;
      ordinal: ReminderOrdinal;
      eventKind: "created" | "activated" | "snoozed" | "stopped";
      detail: string | null;
      at: Date;
    },
  ): Promise<void> {
    await db.query(
      `INSERT INTO game_outcome_reminder_events
         (reminder_id, game_id, organizer_user_id, ordinal, event_kind, detail, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.reminderId,
        input.gameId,
        input.organizerUserId,
        input.ordinal,
        input.eventKind,
        input.detail,
        input.at,
      ],
    );
  }
}

function isPool(value: SqlExecutor | Pool): value is Pool {
  return typeof (value as Pool).connect === "function";
}
