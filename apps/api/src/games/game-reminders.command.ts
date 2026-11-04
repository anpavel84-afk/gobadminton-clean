import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { unrestrictedSql } from "../restrictions/policy";
import {
  REMINDER_MAX_ORDINAL,
  REMINDER_MIN_ACTIVATION_GAP_MS,
  REMINDER_SWEEP_BATCH,
  canActivateAnother,
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
 * Lock order per game: Game → managers → reminders (no Actor fence; worker path).
 * HTTP Later uses Actor → Game → manager → Reminder (see GameRemindersService).
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

    // Actionable only: due work that can actually activate, ensure gaps, or current
    // stop authorities. Stop work is independent of ends_at so future-rescheduled
    // cancel/held/role-lost/restriction still drains open history. Cooling-down
    // overdue scheduled rows (min gap / cap) do not monopolize LIMIT.
    // Ensure-missing mirrors accountGate (active user + account.access) so
    // ineligible managers with zero rows cannot occupy the bounded batch forever.
    const accountAccessOkSql = unrestrictedSql(
      this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
      "r.organizer_user_id",
      ["account.access"],
    );
    const managerAccountAccessOkSql = unrestrictedSql(
      this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
      "gm.user_id",
      ["account.access"],
    );
    const candidates = await readExec.query<{ id: string }>(
      `SELECT g.id
       FROM games g
       WHERE g.status IN ('published', 'completed', 'cancelled')
         AND (
           (
             g.ends_at <= $1
             AND (
               EXISTS (
                 SELECT 1
                 FROM game_outcome_reminders r
                 WHERE r.game_id = g.id
                   AND (
                     (
                       r.state = 'snoozed'
                       AND r.snoozed_until IS NOT NULL
                       AND r.snoozed_until <= $1
                     )
                     OR (
                       r.state = 'scheduled'
                       AND r.due_at <= $1
                       AND NOT EXISTS (
                         SELECT 1
                         FROM game_outcome_reminders s
                         WHERE s.game_id = r.game_id
                           AND s.organizer_user_id = r.organizer_user_id
                           AND s.state = 'snoozed'
                           AND s.snoozed_until IS NOT NULL
                           AND s.snoozed_until > $1
                       )
                       AND (
                         SELECT count(*)::int
                         FROM game_outcome_reminder_events e
                         WHERE e.game_id = r.game_id
                           AND e.organizer_user_id = r.organizer_user_id
                           AND e.event_kind = 'activated'
                       ) < $2
                       AND (
                         NOT EXISTS (
                           SELECT 1
                           FROM game_outcome_reminder_events e
                           WHERE e.game_id = r.game_id
                             AND e.organizer_user_id = r.organizer_user_id
                             AND e.event_kind = 'activated'
                         )
                         OR (
                           SELECT max(e.recorded_at)
                           FROM game_outcome_reminder_events e
                           WHERE e.game_id = r.game_id
                             AND e.organizer_user_id = r.organizer_user_id
                             AND e.event_kind = 'activated'
                         ) <= $1::timestamptz - (interval '1 millisecond' * $4::bigint)
                       )
                     )
                   )
               )
               OR (
                 g.status IN ('published', 'completed')
                 AND NOT EXISTS (SELECT 1 FROM game_outcomes go WHERE go.game_id = g.id)
                 AND EXISTS (
                   SELECT 1
                   FROM game_managers gm
                   INNER JOIN users u ON u.id = gm.user_id
                   WHERE gm.game_id = g.id
                     AND gm.status = 'active'
                     AND gm.role IN ('owner', 'manager')
                     AND u.status = 'active'
                     AND (${managerAccountAccessOkSql})
                     AND (
                       SELECT count(*)::int
                       FROM game_outcome_reminders r
                       WHERE r.game_id = g.id
                         AND r.organizer_user_id = gm.user_id
                     ) < $2
                 )
               )
             )
           )
           OR (
             EXISTS (
               SELECT 1
               FROM game_outcome_reminders r
               WHERE r.game_id = g.id
                 AND r.state IN ('scheduled', 'visible', 'snoozed')
             )
             AND (
               g.status = 'cancelled'
               OR EXISTS (SELECT 1 FROM game_outcomes go WHERE go.game_id = g.id)
               OR EXISTS (
                 SELECT 1
                 FROM game_outcome_reminders r
                 INNER JOIN users u ON u.id = r.organizer_user_id
                 WHERE r.game_id = g.id
                   AND r.state IN ('scheduled', 'visible', 'snoozed')
                   AND u.status <> 'active'
               )
               OR EXISTS (
                 SELECT 1
                 FROM game_outcome_reminders r
                 WHERE r.game_id = g.id
                   AND r.state IN ('scheduled', 'visible', 'snoozed')
                   AND NOT EXISTS (
                     SELECT 1
                     FROM game_managers gm
                     WHERE gm.game_id = r.game_id
                       AND gm.user_id = r.organizer_user_id
                       AND gm.status = 'active'
                       AND gm.role IN ('owner', 'manager')
                   )
               )
               OR EXISTS (
                 SELECT 1
                 FROM game_outcome_reminders r
                 WHERE r.game_id = g.id
                   AND r.state IN ('scheduled', 'visible', 'snoozed')
                   AND NOT (${accountAccessOkSql})
               )
             )
           )
         )
       ORDER BY g.ends_at ASC, g.id ASC
       LIMIT $3`,
      [now, REMINDER_MAX_ORDINAL, batch, REMINDER_MIN_ACTIVATION_GAP_MS],
    );

    const gameIds = candidates.rows.map((r) => r.id);

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

    const activeIds = new Set(managers.rows.map((m) => m.user_id));

    // Current stop authorities apply even when ends_at is still in the future
    // (rescheduled then cancelled/held/role-lost/restricted) — not gated on due-end.
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

    // Future / ineligible without product stop: authorities above may have stopped
    // rows; do not mint or activate until ends_at is due.
    if (!life.ok) {
      return { ensured, activated, stopped };
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

      const budget = await this.activationBudget(db, gameId, manager.user_id);
      const result = await this.activateAtMostOne(db, {
        gameId,
        organizerUserId: manager.user_id,
        endsAt: game.ends_at,
        now,
        budget,
      });
      activated += result.activated;
      stopped += result.stopped;
    }

    return { ensured, activated, stopped };
  }

  private async activationBudget(
    db: SqlExecutor,
    gameId: string,
    organizerUserId: string,
  ): Promise<{ activationCount: number; lastActivatedAt: Date | null }> {
    const row = (
      await db.query<{ activation_count: number; last_activated_at: Date | null }>(
        `SELECT count(*)::int AS activation_count,
                max(recorded_at) AS last_activated_at
         FROM game_outcome_reminder_events
         WHERE game_id = $1
           AND organizer_user_id = $2
           AND event_kind = 'activated'`,
        [gameId, organizerUserId],
      )
    ).rows[0];
    return {
      activationCount: row?.activation_count ?? 0,
      lastActivatedAt: row?.last_activated_at ?? null,
    };
  }

  /**
   * One visible card per game/organizer; max 3 activation rounds; min gap between rounds.
   * Later expiry advances to the next ordinal (or stops at cap) — never unbounded same-ordinal resurfacing.
   */
  private async activateAtMostOne(
    db: SqlExecutor,
    input: {
      gameId: string;
      organizerUserId: string;
      endsAt: Date;
      now: Date;
      budget: { activationCount: number; lastActivatedAt: Date | null };
    },
  ): Promise<{ activated: number; stopped: number }> {
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
         AND state IN ('scheduled', 'visible', 'snoozed')
       ORDER BY ordinal ASC
       FOR UPDATE`,
      [input.gameId, input.organizerUserId],
    );

    const expiredSnooze = slots.rows.find(
      (slot) =>
        slot.state === "snoozed" &&
        isOrdinal(slot.ordinal) &&
        isSnoozeExpired({
          now: input.now,
          state: "snoozed",
          snoozedUntil: slot.snoozed_until,
        }),
    );

    if (expiredSnooze && isOrdinal(expiredSnooze.ordinal)) {
      const expiredOrdinal = expiredSnooze.ordinal;
      return this.advanceAfterLater(db, {
        gameId: input.gameId,
        organizerUserId: input.organizerUserId,
        now: input.now,
        budget: input.budget,
        expired: {
          id: expiredSnooze.id,
          ordinal: expiredOrdinal,
          state: expiredSnooze.state,
          due_at: expiredSnooze.due_at,
          snoozed_until: expiredSnooze.snoozed_until,
          version: expiredSnooze.version,
        },
        slots: slots.rows,
      });
    }

    // Active Later window postpones any further card until snooze expiry.
    if (
      slots.rows.some(
        (slot) =>
          slot.state === "snoozed" &&
          !isSnoozeExpired({
            now: input.now,
            state: "snoozed",
            snoozedUntil: slot.snoozed_until,
          }),
      )
    ) {
      return { activated: 0, stopped: 0 };
    }

    if (
      !canActivateAnother({
        activationCount: input.budget.activationCount,
        lastActivatedAt: input.budget.lastActivatedAt,
        now: input.now,
      })
    ) {
      return { activated: 0, stopped: 0 };
    }

    const dueScheduled = slots.rows.find(
      (slot) =>
        slot.state === "scheduled" &&
        isOrdinal(slot.ordinal) &&
        isReminderDue({
          now: input.now,
          endsAt: input.endsAt,
          dueAt: slot.due_at,
        }),
    );
    if (!dueScheduled || !isOrdinal(dueScheduled.ordinal)) {
      return { activated: 0, stopped: 0 };
    }

    const visible = slots.rows.find((slot) => slot.state === "visible");
    // Keep the current card until the next ordinal is due (or Later advances).
    if (visible && isOrdinal(visible.ordinal) && dueScheduled.ordinal <= visible.ordinal) {
      return { activated: 0, stopped: 0 };
    }

    // Supersede older visible/snoozed so only one card is shown.
    let stopped = 0;
    for (const slot of slots.rows) {
      if (slot.id === dueScheduled.id) continue;
      if (slot.state === "visible" || slot.state === "snoozed") {
        await this.stopReminder(db, slot.id, "superseded", input.now, "schedule_advance");
        stopped += 1;
      }
    }

    await this.markVisible(db, {
      reminderId: dueScheduled.id,
      gameId: input.gameId,
      organizerUserId: input.organizerUserId,
      ordinal: dueScheduled.ordinal,
      now: input.now,
      detail: "due",
    });
    return { activated: 1, stopped };
  }

  private async advanceAfterLater(
    db: SqlExecutor,
    input: {
      gameId: string;
      organizerUserId: string;
      now: Date;
      budget: { activationCount: number; lastActivatedAt: Date | null };
      expired: {
        id: string;
        ordinal: ReminderOrdinal;
        state: string;
        due_at: Date;
        snoozed_until: Date | null;
        version: number;
      };
      slots: Array<{
        id: string;
        ordinal: number;
        state: string;
        due_at: Date;
        snoozed_until: Date | null;
        version: number;
      }>;
    },
  ): Promise<{ activated: number; stopped: number }> {
    // Never re-show the same ordinal after Later.
    await this.stopReminder(db, input.expired.id, "superseded", input.now, "later_expired");
    let stopped = 1;

    if (
      !canActivateAnother({
        activationCount: input.budget.activationCount,
        lastActivatedAt: input.budget.lastActivatedAt,
        now: input.now,
      })
    ) {
      // Cap exhausted — leave remaining scheduled rows in place but do not activate.
      return { activated: 0, stopped };
    }

    const next = input.slots.find(
      (slot) =>
        slot.id !== input.expired.id &&
        slot.state === "scheduled" &&
        isOrdinal(slot.ordinal) &&
        slot.ordinal > input.expired.ordinal,
    );
    if (!next || !isOrdinal(next.ordinal)) {
      return { activated: 0, stopped };
    }

    // Also clear any other visible/snoozed stragglers before showing next.
    for (const slot of input.slots) {
      if (slot.id === input.expired.id || slot.id === next.id) continue;
      if (slot.state === "visible" || slot.state === "snoozed") {
        await this.stopReminder(db, slot.id, "superseded", input.now, "later_advance");
        stopped += 1;
      }
    }

    await this.markVisible(db, {
      reminderId: next.id,
      gameId: input.gameId,
      organizerUserId: input.organizerUserId,
      ordinal: next.ordinal,
      now: input.now,
      detail: "later_advance",
    });
    return { activated: 1, stopped };
  }

  private async markVisible(
    db: SqlExecutor,
    input: {
      reminderId: string;
      gameId: string;
      organizerUserId: string;
      ordinal: ReminderOrdinal;
      now: Date;
      detail: string;
    },
  ): Promise<void> {
    await db.query(
      `UPDATE game_outcome_reminders
       SET state = 'visible',
           visible_at = COALESCE(visible_at, $2),
           snoozed_until = NULL,
           version = version + 1,
           updated_at = $2
       WHERE id = $1
         AND state IN ('scheduled', 'snoozed')`,
      [input.reminderId, input.now],
    );
    await this.appendEvent(db, {
      reminderId: input.reminderId,
      gameId: input.gameId,
      organizerUserId: input.organizerUserId,
      ordinal: input.ordinal,
      eventKind: "activated",
      detail: input.detail,
      at: input.now,
    });
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
    detail?: string,
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
      detail: detail ?? reason,
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
