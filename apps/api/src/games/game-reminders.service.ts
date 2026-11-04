import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { conflict } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { unrestrictedSql } from "../restrictions/policy";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import {
  canShowReminder,
  gameEligibleForReminders,
  isOrdinal,
  parseLaterBody,
  parseListLimit,
  parseReminderId,
  reminderWritesEnabled,
  resultsPathFor,
  snoozeUntil,
  unavailable,
  writesUnavailable,
  type ReminderListView,
  type ReminderView,
} from "./game-reminders.policy";
import { probeRemindersInstalled } from "./game-reminders.command";

type ReminderRow = {
  id: string;
  game_id: string;
  organizer_user_id: string;
  ordinal: number;
  version: number;
  state: "scheduled" | "visible" | "snoozed" | "stopped";
  due_at: Date;
  visible_at: Date | null;
  snoozed_until: Date | null;
  game_title: string | null;
  ends_at: Date;
  game_status: string;
  outcome_value: "held" | "not_held" | null;
  manager_active: boolean;
  user_status: string;
};

@Injectable()
export class GameRemindersService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
  ) {}

  async listMine(
    userId: string,
    limitRaw?: string,
  ): Promise<ReminderListView> {
    const limit = parseListLimit(limitRaw);
    const installed = await probeRemindersInstalled(this.pool);
    const writesEnabled = reminderWritesEnabled(this.env);
    if (!installed) {
      return { items: [], writesEnabled: false, installed: false };
    }

    const client = await this.pool.connect();
    try {
      const now = (
        await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
      ).rows[0]!.now;
      const accessOk = await this.accountAccessOk(client, userId);
      const rows = await client.query<ReminderRow>(
        `SELECT r.id, r.game_id, r.organizer_user_id, r.ordinal, r.version, r.state,
                r.due_at, r.visible_at, r.snoozed_until,
                g.title AS game_title, g.ends_at, g.status AS game_status,
                go.value AS outcome_value,
                EXISTS (
                  SELECT 1 FROM game_managers gm
                  WHERE gm.game_id = r.game_id
                    AND gm.user_id = r.organizer_user_id
                    AND gm.status = 'active'
                    AND gm.role IN ('owner', 'manager')
                ) AS manager_active,
                u.status AS user_status
         FROM game_outcome_reminders r
         INNER JOIN games g ON g.id = r.game_id
         INNER JOIN users u ON u.id = r.organizer_user_id
         LEFT JOIN game_outcomes go ON go.game_id = r.game_id
         WHERE r.organizer_user_id = $1
           AND r.state = 'visible'
         ORDER BY r.visible_at DESC NULLS LAST, r.ordinal DESC, r.id ASC
         LIMIT $2`,
        [userId, limit],
      );

      const items: ReminderView[] = [];
      for (const row of rows.rows) {
        if (!isOrdinal(row.ordinal) || !row.visible_at) continue;
        const show = canShowReminder({
          state: row.state,
          now,
          endsAt: row.ends_at,
          outcomeValue: row.outcome_value,
          gameStatus: row.game_status,
          organizerActive: row.manager_active,
          accountActive: row.user_status === "active",
          accountAccessOk: accessOk,
        });
        if (!show) continue;
        items.push(this.project(row, writesEnabled));
      }
      return { items, writesEnabled, installed: true };
    } finally {
      client.release();
    }
  }

  async later(
    userId: string,
    sessionId: string,
    key: string,
    reminderIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: ReminderListView }> {
    if (!reminderWritesEnabled(this.env)) writesUnavailable();
    const reminderId = parseReminderId(reminderIdRaw);
    const body = parseLaterBody(input);
    const requestHash = this.idempotency.requestHash({
      reminderId,
      command: body.command,
      expectedVersion: body.expectedVersion,
    });
    return this.mutations.runIdempotent<ReminderListView>({
      actorId: userId,
      sessionId,
      operation: "games.outcome_reminders.later",
      key,
      requestHash,
      requiredCapabilities: ["account.access"],
      authorizeReplay: async (client, stored) => {
        if (!reminderWritesEnabled(this.env)) writesUnavailable();
        if (!(await probeRemindersInstalled(client))) writesUnavailable();
        // Lock order: Actor (MutationRunner) → Game → manager → Reminder
        // (matches worker Game→Reminder; identity read is unlocked tip only).
        const tip = await this.readOwnReminderIdentity(client, reminderId, userId);
        await this.lockGame(client, tip.game_id);
        await this.assertCurrentManager(client, tip.game_id, userId);
        await this.lockOwnReminder(client, reminderId, userId, tip.game_id);
        // Current projection: MutationRunner returns stored body unchanged, so
        // refresh in place — stale other-game rows must not leak after revoke.
        const now = (
          await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
        ).rows[0]!.now;
        const current = await this.listMineWithClient(client, userId, now);
        stored.items = current.items;
        stored.writesEnabled = current.writesEnabled;
        stored.installed = current.installed;
      },
      execute: async (client) => {
        if (!reminderWritesEnabled(this.env)) writesUnavailable();
        if (!(await probeRemindersInstalled(client))) writesUnavailable();
        const tip = await this.readOwnReminderIdentity(client, reminderId, userId);
        const game = await this.lockGame(client, tip.game_id);
        await this.assertCurrentManager(client, tip.game_id, userId);
        const locked = await this.lockOwnReminder(client, reminderId, userId, tip.game_id);
        const now = (
          await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
        ).rows[0]!.now;

        if (locked.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия напоминания устарела");
        }
        if (locked.state !== "visible") {
          unavailable();
        }

        const outcome = (
          await client.query<{ value: "held" | "not_held" }>(
            `SELECT value FROM game_outcomes WHERE game_id = $1`,
            [locked.game_id],
          )
        ).rows[0];
        const life = gameEligibleForReminders({
          status: game.status,
          endsAt: game.ends_at,
          now,
          outcomeValue: outcome?.value ?? null,
        });
        if (!life.ok) unavailable();

        const until = snoozeUntil(now);
        await client.query(
          `UPDATE game_outcome_reminders
           SET state = 'snoozed',
               snoozed_until = $2,
               version = version + 1,
               updated_at = $3
           WHERE id = $1
             AND state = 'visible'
             AND version = $4`,
          [locked.id, until, now, locked.version],
        );
        await client.query(
          `INSERT INTO game_outcome_reminder_events
             (reminder_id, game_id, organizer_user_id, ordinal, event_kind, detail, recorded_at)
           VALUES ($1, $2, $3, $4, 'snoozed', 'later', $5)`,
          [locked.id, locked.game_id, userId, locked.ordinal, now],
        );

        // Own list after mutation — private to actor; no cross-account leak.
        // Receipt may retain this snapshot; authorizeReplay reprojects current.
        const list = await this.listMineWithClient(client, userId, now);
        return { statusCode: 200, body: list };
      },
    });
  }

  private async listMineWithClient(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<ReminderListView> {
    const writesEnabled = reminderWritesEnabled(this.env);
    const accessOk = await this.accountAccessOk(client, userId);
    const rows = await client.query<ReminderRow>(
      `SELECT r.id, r.game_id, r.organizer_user_id, r.ordinal, r.version, r.state,
              r.due_at, r.visible_at, r.snoozed_until,
              g.title AS game_title, g.ends_at, g.status AS game_status,
              go.value AS outcome_value,
              EXISTS (
                SELECT 1 FROM game_managers gm
                WHERE gm.game_id = r.game_id
                  AND gm.user_id = r.organizer_user_id
                  AND gm.status = 'active'
                  AND gm.role IN ('owner', 'manager')
              ) AS manager_active,
              u.status AS user_status
       FROM game_outcome_reminders r
       INNER JOIN games g ON g.id = r.game_id
       INNER JOIN users u ON u.id = r.organizer_user_id
       LEFT JOIN game_outcomes go ON go.game_id = r.game_id
       WHERE r.organizer_user_id = $1
         AND r.state = 'visible'
       ORDER BY r.visible_at DESC NULLS LAST, r.ordinal DESC, r.id ASC
       LIMIT 50`,
      [userId],
    );
    const items: ReminderView[] = [];
    for (const row of rows.rows) {
      if (!isOrdinal(row.ordinal) || !row.visible_at) continue;
      if (
        !canShowReminder({
          state: row.state,
          now,
          endsAt: row.ends_at,
          outcomeValue: row.outcome_value,
          gameStatus: row.game_status,
          organizerActive: row.manager_active,
          accountActive: row.user_status === "active",
          accountAccessOk: accessOk,
        })
      ) {
        continue;
      }
      items.push(this.project(row, writesEnabled));
    }
    return { items, writesEnabled, installed: true };
  }

  private project(row: ReminderRow, writesEnabled: boolean): ReminderView {
    return {
      id: row.id,
      gameId: row.game_id,
      gameTitle: row.game_title,
      endsAt: row.ends_at.toISOString(),
      ordinal: row.ordinal as 1 | 2 | 3,
      version: row.version,
      state: "visible",
      dueAt: row.due_at.toISOString(),
      visibleAt: row.visible_at!.toISOString(),
      resultsPath: resultsPathFor(row.game_id),
      allowedActions: {
        canOpenResults: true,
        canLater: writesEnabled,
      },
    };
  }

  /** Unlocked identity tip — find game_id without taking the reminder row lock. */
  private async readOwnReminderIdentity(
    client: PoolClient,
    reminderId: string,
    userId: string,
  ): Promise<{ id: string; game_id: string }> {
    const row = (
      await client.query<{ id: string; game_id: string; organizer_user_id: string }>(
        `SELECT id, game_id, organizer_user_id
         FROM game_outcome_reminders
         WHERE id = $1`,
        [reminderId],
      )
    ).rows[0];
    // Cross-account → private 404 (no existence leak).
    if (!row || row.organizer_user_id !== userId) unavailable();
    return row;
  }

  private async lockOwnReminder(
    client: PoolClient,
    reminderId: string,
    userId: string,
    expectedGameId: string,
  ): Promise<{
    id: string;
    game_id: string;
    organizer_user_id: string;
    ordinal: number;
    version: number;
    state: string;
  }> {
    const row = (
      await client.query<{
        id: string;
        game_id: string;
        organizer_user_id: string;
        ordinal: number;
        version: number;
        state: string;
      }>(
        `SELECT id, game_id, organizer_user_id, ordinal, version, state
         FROM game_outcome_reminders
         WHERE id = $1
         FOR UPDATE`,
        [reminderId],
      )
    ).rows[0];
    // Cross-account / moved → private 404 (no existence leak).
    if (
      !row ||
      row.organizer_user_id !== userId ||
      row.game_id !== expectedGameId
    ) {
      unavailable();
    }
    return row;
  }

  private async lockGame(
    client: PoolClient,
    gameId: string,
  ): Promise<{ id: string; status: string; ends_at: Date; version: number }> {
    const row = (
      await client.query<{
        id: string;
        status: string;
        ends_at: Date;
        version: number;
      }>(
        `SELECT id, status, ends_at, version
         FROM games
         WHERE id = $1
         FOR UPDATE`,
        [gameId],
      )
    ).rows[0];
    if (!row) unavailable();
    return row;
  }

  private async assertCurrentManager(
    client: PoolClient,
    gameId: string,
    userId: string,
  ): Promise<void> {
    const result = await client.query<{ role: string; status: string }>(
      `SELECT role, status
       FROM game_managers
       WHERE game_id = $1
         AND user_id = $2
       FOR UPDATE`,
      [gameId, userId],
    );
    const membership = result.rows[0];
    if (
      !membership ||
      membership.status !== "active" ||
      (membership.role !== "owner" && membership.role !== "manager")
    ) {
      unavailable();
    }
  }

  private async accountAccessOk(
    client: PoolClient | Pool,
    userId: string,
  ): Promise<boolean> {
    if (!this.env.USER_RESTRICTIONS_INTERNAL_ENABLED) return true;
    const denied = await client.query(
      `SELECT 1 WHERE NOT (${unrestrictedSql(true, "$1", ["account.access"])})`,
      [userId],
    );
    return denied.rowCount === 0;
  }
}
