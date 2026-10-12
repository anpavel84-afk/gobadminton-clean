import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { forbidden, notFound } from "../auth/problem";
import { DATABASE_POOL } from "../tokens";

@Injectable()
export class GameAuthorityService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async assertCanManage(
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
    if (!membership) {
      // Identical 404 for foreign private resources / missing authority.
      throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    }
    if (membership.status !== "active") {
      throw forbidden(
        "GAME_MANAGER_REVOKED",
        "Полномочия управления игрой отозваны",
      );
    }
    if (membership.role !== "owner" && membership.role !== "manager") {
      throw forbidden("GAME_MANAGER_FORBIDDEN", "Недостаточно прав для игры");
    }
  }

  async grantOwner(
    client: PoolClient,
    gameId: string,
    userId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO game_managers (game_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [gameId, userId],
    );
  }

  /** Test helper: Game fence before manager revocation (no public revoke API). */
  async revokeForTests(gameId: string, userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const game = await client.query<{ id: string }>(
        `SELECT id FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      );
      if (!game.rows[0]) {
        await client.query("ROLLBACK");
        return;
      }
      await client.query(
        `UPDATE game_managers
         SET status = 'revoked', revoked_at = now(), updated_at = now()
         WHERE game_id = $1 AND user_id = $2`,
        [gameId, userId],
      );
      // Source-state fence on chat reads/sends is authoritative; membership
      // materialization revoke is best-effort when Game Chat is enabled.
      await client.query(
        `UPDATE conversation_members AS m
         SET membership_state = 'removed',
             send_allowed = false,
             role = NULL,
             state_version = m.state_version + 1,
             updated_at = now()
         FROM conversations c
         WHERE c.id = m.conversation_id
           AND c.kind = 'game'
           AND c.game_id = $1
           AND m.user_id = $2`,
        [gameId, userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
