import { assertCapabilities, unrestrictedSql } from "../restrictions/policy";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { CONSUMER_AUDIENCE } from "./constants";
import {
  hashSecret,
  openSecret,
  randomToken,
  sealSecret,
  secretsEqual,
} from "./crypto";
import { conflict, notFound } from "./problem";

export type SessionRecord = {
  id: string;
  userId: string;
  audience: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type IssuedSession = {
  session: SessionRecord;
  sessionToken: string;
  csrfToken: string;
};

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async createConsumerSession(userId: string, client?: PoolClient): Promise<IssuedSession> {
    if (!client) {
      const owned = await this.pool.connect();
      try {
        await owned.query("BEGIN");
        const result = await this.createConsumerSession(userId, owned);
        await owned.query("COMMIT");
        return result;
      } catch (error) { await owned.query("ROLLBACK"); throw error; } finally { owned.release(); }
    }
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await assertCapabilities(client, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, userId, ["account.access"]);
    const sessionToken = randomToken(32);
    const csrfToken = randomToken(32);
    const sessionHash = hashSecret(this.env.AUTH_PEPPER, sessionToken);
    const csrfCiphertext = sealSecret(this.env.AUTH_PEPPER, csrfToken);
    const expiresAt = new Date(
      Date.now() + this.env.SESSION_TTL_SECONDS * 1000,
    );

    const result = await (client ?? this.pool).query<{
      id: string;
      user_id: string;
      audience: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `INSERT INTO app_sessions
         (user_id, audience, session_hash, csrf_ciphertext, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, audience, expires_at, revoked_at`,
      [userId, CONSUMER_AUDIENCE, sessionHash, csrfCiphertext, expiresAt],
    );
    const row = result.rows[0]!;
    return {
      session: {
        id: row.id,
        userId: row.user_id,
        audience: row.audience,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      },
      sessionToken,
      csrfToken,
    };
  }

  async lookupActiveSession(
    sessionToken: string,
  ): Promise<SessionRecord | null> {
    if (!sessionToken || sessionToken.length < 16) return null;
    const sessionHash = hashSecret(this.env.AUTH_PEPPER, sessionToken);
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      audience: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, audience, expires_at, revoked_at
       FROM app_sessions
       WHERE session_hash = $1 AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "app_sessions.user_id", ["account.access"])}`,
      [sessionHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at.getTime() <= Date.now()) return null;
    if (row.audience !== CONSUMER_AUDIENCE) return null;

    // Intentionally no last_seen UPDATE on the auth lookup path.
    // Telemetry must not invert locks with in-transaction actor/session fences (S-00A).

    return {
      id: row.id,
      userId: row.user_id,
      audience: row.audience,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async readCsrfToken(sessionId: string): Promise<string | null> {
    const result = await this.pool.query<{ csrf_ciphertext: string }>(
      `SELECT csrf_ciphertext FROM app_sessions
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
    const sealed = result.rows[0]?.csrf_ciphertext;
    if (!sealed) return null;
    try {
      return openSecret(this.env.AUTH_PEPPER, sealed);
    } catch {
      return null;
    }
  }

  async verifyCsrf(sessionId: string, csrfToken: string): Promise<boolean> {
    if (!csrfToken) return false;
    const expected = await this.readCsrfToken(sessionId);
    if (!expected) return false;
    return secretsEqual(expected, csrfToken);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.withRevocationTransaction(async (client) => {
      // Same actor fence as commands, before session/presence. NO KEY UPDATE
      // also permits ordinary FK references by a contact that owns presence SHARE.
      await client.query(
        `SELECT u.id FROM users u JOIN app_sessions s ON s.user_id=u.id WHERE s.id=$1 FOR NO KEY UPDATE OF u`,
        [sessionId],
      );
      await client.query(
        `UPDATE app_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1`,
        [sessionId],
      );
      await client.query(
        `DELETE FROM radar_presences WHERE owner_session_id=$1`,
        [sessionId],
      );
    });
  }

  async listActiveSessionsForUser(userId: string): Promise<
    Array<{
      id: string;
      createdAt: Date;
      lastSeenAt: Date;
      expiresAt: Date;
    }>
  > {
    const result = await this.pool.query<{
      id: string;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
    }>(
      `SELECT id, created_at, last_seen_at, expires_at
       FROM app_sessions
       WHERE user_id = $1
         AND audience = $2
         AND revoked_at IS NULL
         AND expires_at > now()
       ORDER BY created_at DESC`,
      [userId, CONSUMER_AUDIENCE],
    );
    return result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
    }));
  }

  /** Revoke one other session owned by the user. Current session is rejected. */
  async revokeOwnedSession(input: {
    userId: string;
    sessionId: string;
    currentSessionId: string;
  }): Promise<"revoked" | "already_revoked"> {
    if (input.sessionId === input.currentSessionId) {
      throw conflict("CURRENT_SESSION", "Текущую сессию завершите через выход");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [
        input.userId,
      ]);
      const result = await client.query<{
        id: string;
        revoked_at: Date | null;
      }>(
        `SELECT id, revoked_at FROM app_sessions
         WHERE id = $1 AND user_id = $2 AND audience = $3
         FOR UPDATE`,
        [input.sessionId, input.userId, CONSUMER_AUDIENCE],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        throw notFound("SESSION_NOT_FOUND", "Сессия не найдена");
      }
      if (row.revoked_at) {
        await client.query("COMMIT");
        return "already_revoked";
      }
      await client.query(
        `UPDATE app_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1`,
        [row.id],
      );
      await client.query(
        `DELETE FROM radar_presences WHERE owner_session_id = $1`,
        [row.id],
      );
      await client.query("COMMIT");
      return "revoked";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeOtherSessions(input: {
    userId: string;
    currentSessionId: string;
  }): Promise<{ revokedCount: number }> {
    return this.withRevocationTransaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [
        input.userId,
      ]);
      const result = await client.query<{ id: string }>(
        `UPDATE app_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp())
        WHERE user_id=$1 AND audience=$2 AND id<>$3 AND revoked_at IS NULL RETURNING id`,
        [input.userId, CONSUMER_AUDIENCE, input.currentSessionId],
      );
      const ids = result.rows.map((row) => row.id);
      await client.query(
        "DELETE FROM radar_presences WHERE owner_session_id=ANY($1::uuid[])",
        [ids],
      );
      return { revokedCount: ids.length };
    });
  }

  private async withRevocationTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
