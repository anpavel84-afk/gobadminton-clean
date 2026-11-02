import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { conflict } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { DATABASE_POOL } from "../tokens";
import { GameAuthorityService } from "./game-authority.service";
import {
  parse,
  parseGameId,
  projectCourtBooking,
  putCourtBookingRequest,
  unavailable,
  type CourtBookingRow,
  type CourtBookingView,
} from "./game-court-booking.policy";

type AccessRole = "manager" | "participant" | "none";

@Injectable()
export class GameCourtBookingService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
    private readonly authority: GameAuthorityService,
  ) {}

  private async installed(client: PoolClient | Pool): Promise<boolean> {
    return Boolean((await client.query("SELECT to_regclass('game_court_booking') AS name")).rows[0]?.name);
  }

  private async lockGame(client: PoolClient, gameId: string): Promise<{ id: string }> {
    const row = (
      await client.query<{ id: string }>(`SELECT id FROM games WHERE id = $1 FOR UPDATE`, [gameId])
    ).rows[0];
    if (!row) unavailable();
    return row;
  }

  private async accessRole(client: PoolClient | Pool, gameId: string, userId: string): Promise<AccessRole> {
    const manager = await client.query(
      `SELECT 1 FROM game_managers
       WHERE game_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner', 'manager')
       LIMIT 1`,
      [gameId, userId],
    );
    if (manager.rows[0]) return "manager";
    const participant = await client.query(
      `SELECT 1 FROM participations
       WHERE game_id = $1 AND user_id = $2 AND status = 'confirmed'
       LIMIT 1`,
      [gameId, userId],
    );
    return participant.rows[0] ? "participant" : "none";
  }

  private async readRow(client: PoolClient | Pool, gameId: string): Promise<CourtBookingRow | null> {
    if (!(await this.installed(client))) return null;
    return (
      await client.query<CourtBookingRow>(`SELECT * FROM game_court_booking WHERE game_id = $1`, [gameId])
    ).rows[0] ?? null;
  }

  async get(gameIdRaw: string, userId: string): Promise<CourtBookingView> {
    const gameId = parseGameId(gameIdRaw);
    const client = await this.pool.connect();
    try {
      // Same Game fence as revoke/participation transitions: auth + private row
      // share one READ COMMITTED snapshot while FOR SHARE is held.
      await client.query("BEGIN");
      try {
        const game = (
          await client.query<{ id: string }>(
            `SELECT id FROM games WHERE id = $1 FOR SHARE`,
            [gameId],
          )
        ).rows[0];
        if (!game) unavailable();
        const role = await this.accessRole(client, gameId, userId);
        if (role === "none") unavailable();
        const row = await this.readRow(client, gameId);
        await client.query("COMMIT");
        return projectCourtBooking(row, gameId, role === "manager");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async put(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: CourtBookingView }> {
    const gameId = parseGameId(gameIdRaw);
    const body = parse(putCourtBookingRequest, input);
    const requestHash = this.idempotency.requestHash({
      gameId,
      expectedVersion: body.expectedVersion,
      status: body.status,
    });
    return this.mutations.runIdempotent<CourtBookingView>({
      actorId: userId,
      sessionId,
      operation: "game.court_booking.put",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        // Lock order: Actor (MutationRunner) → Game → manager (GameAuthority).
        await this.lockGame(client, gameId);
        await this.authority.assertCanManage(client, gameId, userId);
      },
      execute: async (client) => {
        if (!(await this.installed(client))) unavailable();
        await this.lockGame(client, gameId);
        await this.authority.assertCanManage(client, gameId, userId);
        const existing = (
          await client.query<CourtBookingRow>(
            `SELECT * FROM game_court_booking WHERE game_id = $1 FOR UPDATE`,
            [gameId],
          )
        ).rows[0] ?? null;
        const currentVersion = existing?.version ?? 0;
        if (currentVersion !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия договорённости о корте устарела");
        }
        const nextVersion = currentVersion + 1;
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        if (!existing) {
          await client.query(
            `INSERT INTO game_court_booking
               (game_id, status, version, declaration_source, actor_user_id, updated_at, created_at)
             VALUES ($1, $2, $3, 'organizer_declared', $4, $5, $5)`,
            [gameId, body.status, nextVersion, userId, now],
          );
        } else {
          await client.query(
            `UPDATE game_court_booking
             SET status = $2,
                 version = $3,
                 actor_user_id = $4,
                 updated_at = $5
             WHERE game_id = $1`,
            [gameId, body.status, nextVersion, userId, now],
          );
        }
        const row = (await this.readRow(client, gameId))!;
        return { statusCode: 200, body: projectCourtBooking(row, gameId, true) };
      },
    });
  }
}
