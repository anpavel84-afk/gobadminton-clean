import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import {
  assertLifecycle,
  canRecordHint,
  outcomeProvenance,
  pageRevisionsDesc,
  parse,
  parseGameId,
  parseRevisionsQuery,
  postGameWritesEnabled,
  putOutcomeRequest,
  unavailable,
  unknownOutcome,
  writesUnavailable,
  type GameResultsView,
  type LockedGameRow,
  type OutcomeRevisionView,
  type OutcomeRow,
  type RevisionsPage,
  type RevisionsQuery,
} from "./game-outcomes.policy";
import { GameAttendanceService } from "./game-attendance.service";

type AccessRole = "manager" | "participant" | "none";

@Injectable()
export class GameOutcomesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
    private readonly attendance: GameAttendanceService,
  ) {}

  private async installed(client: PoolClient | Pool): Promise<boolean> {
    return Boolean((await client.query("SELECT to_regclass('game_outcomes') AS name")).rows[0]?.name);
  }

  private async lockGame(client: PoolClient, gameId: string): Promise<LockedGameRow> {
    const row = (
      await client.query<LockedGameRow>(
        `SELECT id, status, version, ends_at
         FROM games
         WHERE id = $1
         FOR UPDATE`,
        [gameId],
      )
    ).rows[0];
    if (!row) unavailable();
    return row;
  }

  /**
   * Current active owner/manager only. Missing, revoked, or non-manager roles
   * stay private 404 (no GAME_MANAGER_REVOKED disclosure on this surface).
   * Caller must already hold the Game row lock (Actor → Game → manager).
   */
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

  private async accessRole(client: PoolClient | Pool, gameId: string, userId: string): Promise<AccessRole> {
    // Delegate so removed-after-start own marked participants retain results access
    // via frozen eligibility / durable attendance proof (no foreign roster grant).
    return this.attendance.resolveAccessRole(client, gameId, userId);
  }

  private async readOutcome(client: PoolClient | Pool, gameId: string): Promise<OutcomeRow | null> {
    if (!(await this.installed(client))) return null;
    return (
      await client.query<OutcomeRow>(`SELECT * FROM game_outcomes WHERE game_id = $1`, [gameId])
    ).rows[0] ?? null;
  }

  private async readRevisionsPage(
    client: PoolClient | Pool,
    gameId: string,
    query: RevisionsQuery,
  ): Promise<RevisionsPage> {
    const rows = await client.query<{
      resource_version: number;
      before_value: "held" | "not_held" | null;
      after_value: "held" | "not_held";
      before_reason: string | null;
      after_reason: string | null;
      reason: string | null;
      source: "manager_explicit";
      recorded_at: Date;
    }>(
      `SELECT resource_version, before_value, after_value, before_reason, after_reason, reason, source, recorded_at
       FROM game_outcome_revisions
       WHERE game_id = $1
         AND ($2::int IS NULL OR resource_version < $2)
       ORDER BY resource_version DESC
       LIMIT $3`,
      [gameId, query.beforeVersion, query.limit + 1],
    );
    const mapped: OutcomeRevisionView[] = rows.rows.map((row) => ({
      version: row.resource_version,
      before: row.before_value
        ? { value: row.before_value, reason: row.before_reason }
        : null,
      after: { value: row.after_value, reason: row.after_reason },
      reason: row.reason,
      source: row.source,
      recordedAt: row.recorded_at.toISOString(),
    }));
    return pageRevisionsDesc(mapped, query.limit);
  }

  private project(
    gameId: string,
    row: OutcomeRow | null,
    role: AccessRole,
    canRecordOutcome: boolean,
    revisionsPage: RevisionsPage | undefined,
  ): GameResultsView {
    if (!row) {
      const base = unknownOutcome(gameId, canRecordOutcome);
      if (role === "manager" && revisionsPage) {
        return {
          ...base,
          revisions: revisionsPage.revisions,
          revisionsNextCursor: revisionsPage.nextCursor,
        };
      }
      return base;
    }
    const view: GameResultsView = {
      gameId,
      outcome: {
        value: row.value,
        version: row.version,
        reason: row.reason,
        provenance: outcomeProvenance(row),
      },
      allowedActions: { canRecordOutcome },
    };
    if (role === "manager" && revisionsPage) {
      view.revisions = revisionsPage.revisions;
      view.revisionsNextCursor = revisionsPage.nextCursor;
    }
    return view;
  }

  async getResults(
    gameIdRaw: string,
    userId: string,
    revisionsRaw: {
      revisionsLimit?: string;
      revisionsCursor?: string;
      rosterLimit?: string;
      rosterCursor?: string;
    } = {},
  ): Promise<GameResultsView> {
    const gameId = parseGameId(gameIdRaw);
    const revisionsQuery = parseRevisionsQuery(revisionsRaw);
    const client = await this.pool.connect();
    try {
      const game = (
        await client.query<LockedGameRow>(
          `SELECT id, status, version, ends_at FROM games WHERE id = $1`,
          [gameId],
        )
      ).rows[0];
      if (!game) unavailable();
      const role = await this.accessRole(client, gameId, userId);
      if (role === "none") unavailable();
      const installed = await this.installed(client);
      const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
      const canRecord = canRecordHint(this.env, role, game, now, installed);
      const attendance = await this.attendance.enrichResults(
        client,
        gameId,
        userId,
        role,
        game,
        now,
        { rosterLimit: revisionsRaw.rosterLimit, rosterCursor: revisionsRaw.rosterCursor },
      );
      if (!installed) {
        return {
          ...unknownOutcome(gameId, false),
          attendance,
          allowedActions: {
            canRecordOutcome: false,
            canRecordAttendance: attendance.allowedActions.canRecordAttendance,
            canBulkPresent: attendance.allowedActions.canBulkPresent,
          },
        };
      }
      const row = await this.readOutcome(client, gameId);
      const revisionsPage =
        role === "manager" ? await this.readRevisionsPage(client, gameId, revisionsQuery) : undefined;
      const base = this.project(gameId, row, role, canRecord, revisionsPage);
      return {
        ...base,
        attendance,
        allowedActions: {
          ...base.allowedActions,
          canRecordAttendance: attendance.allowedActions.canRecordAttendance,
          canBulkPresent: attendance.allowedActions.canBulkPresent,
        },
      };
    } finally {
      client.release();
    }
  }

  async putOutcome(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: GameResultsView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const body = parse(putOutcomeRequest, input);
    const requestHash = this.idempotency.requestHash({
      gameId,
      expectedVersion: body.expectedVersion,
      outcome: body.outcome,
      reason: body.reason ?? null,
    });
    return this.mutations.runIdempotent<GameResultsView>({
      actorId: userId,
      sessionId,
      operation: "games.outcome.put",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const locked = await this.lockGame(client, gameId);
        await this.assertCurrentManager(client, locked.id, userId);
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        // Lock order: Actor (MutationRunner) → Game → manager → outcome → revision.
        const locked = await this.lockGame(client, gameId);
        await this.assertCurrentManager(client, locked.id, userId);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        assertLifecycle(locked, body.outcome, now);
        const existing = (
          await client.query<OutcomeRow>(
            `SELECT * FROM game_outcomes WHERE game_id = $1 FOR UPDATE`,
            [gameId],
          )
        ).rows[0] ?? null;
        const currentVersion = existing?.version ?? 0;
        if (currentVersion !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия итога устарела");
        }
        const nextVersion = currentVersion + 1;
        const reason = body.reason ?? null;
        // One clock value for outcome.updated_at and revision.recorded_at so
        // provenance.recordedAt equals the current revision (separate DEFAULTs can drift 1ms).
        if (!existing) {
          await client.query(
            `INSERT INTO game_outcomes
               (game_id, value, version, reason, source, actor_user_id, recorded_at, updated_at)
             VALUES ($1, $2, 1, $3, 'manager_explicit', $4, $5, $5)`,
            [gameId, body.outcome, reason, userId, now],
          );
        } else {
          await client.query(
            `UPDATE game_outcomes
             SET value = $2,
                 version = $3,
                 reason = $4,
                 actor_user_id = $5,
                 updated_at = $6
             WHERE game_id = $1`,
            [gameId, body.outcome, nextVersion, reason, userId, now],
          );
        }
        await client.query(
          `INSERT INTO game_outcome_revisions
             (game_id, resource_version, actor_user_id, source,
              before_value, after_value, before_reason, after_reason, reason, recorded_at)
           VALUES ($1, $2, $3, 'manager_explicit', $4, $5, $6, $7, $8, $9)`,
          [
            gameId,
            nextVersion,
            userId,
            existing?.value ?? null,
            body.outcome,
            existing?.reason ?? null,
            reason,
            nextVersion === 1 && body.outcome === "held" ? null : reason,
            now,
          ],
        );
        if (locked.status === "published") {
          await client.query(
            `UPDATE games
             SET status = 'completed',
                 version = version + 1,
                 updated_at = now()
             WHERE id = $1 AND status = 'published'`,
            [gameId],
          );
        }
        const row = (await this.readOutcome(client, gameId))!;
        const revisionsPage = await this.readRevisionsPage(client, gameId, {
          limit: parseRevisionsQuery({}).limit,
          beforeVersion: null,
        });
        const refreshed = (
          await client.query<LockedGameRow>(
            `SELECT id, status, version, ends_at FROM games WHERE id = $1`,
            [gameId],
          )
        ).rows[0]!;
        const canRecord = canRecordHint(this.env, "manager", refreshed, now, true);
        const base = this.project(gameId, row, "manager", canRecord, revisionsPage);
        const attendance = await this.attendance.enrichResults(
          client,
          gameId,
          userId,
          "manager",
          refreshed,
          now,
        );
        return {
          statusCode: 200,
          body: {
            ...base,
            attendance,
            allowedActions: {
              ...base.allowedActions,
              canRecordAttendance: attendance.allowedActions.canRecordAttendance,
              canBulkPresent: attendance.allowedActions.canBulkPresent,
            },
          },
        };
      },
    });
  }
}
