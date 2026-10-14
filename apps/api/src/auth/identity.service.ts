import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../tokens";
import { lockAuthActor, usableAuthMethodCount } from "./auth-method.service";
import { conflict } from "./problem";
import type { VerifiedIdentity } from "./providers/types";

export type UserRecord = {
  id: string;
  status: string;
  locale: string;
  displayName: string;
};

@Injectable()
export class IdentityService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async resolveOrCreateUser(identity: VerifiedIdentity): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{
        id: string;
        status: string;
        locale: string;
        display_name: string;
        user_id: string;
      }>(
        `SELECT u.id, u.status, u.locale, u.display_name, ei.user_id
         FROM external_identities ei
         JOIN users u ON u.id = ei.user_id
         WHERE ei.issuer_namespace = $1 AND ei.subject = $2
         FOR UPDATE OF ei, u`,
        [identity.issuerNamespace, identity.subject],
      );

      if (existing.rowCount && existing.rows[0]) {
        const row = existing.rows[0];
        await client.query(
          `UPDATE external_identities
           SET email = $1, display_name = $2, avatar_url = $3, updated_at = now()
           WHERE issuer_namespace = $4 AND subject = $5`,
          [
            identity.email ?? null,
            identity.displayName ?? null,
            identity.avatarUrl ?? null,
            identity.issuerNamespace,
            identity.subject,
          ],
        );
        if (!row.display_name && identity.displayName) {
          await client.query(
            `UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2`,
            [identity.displayName, row.id],
          );
          row.display_name = identity.displayName;
        }
        await client.query("COMMIT");
        return {
          id: row.id,
          status: row.status,
          locale: row.locale,
          displayName: row.display_name,
        };
      }

      const createdUser = await client.query<{
        id: string;
        status: string;
        locale: string;
        display_name: string;
      }>(
        `INSERT INTO users (display_name, locale)
         VALUES ($1, 'ru')
         RETURNING id, status, locale, display_name`,
        [identity.displayName?.trim() || "Игрок"],
      );
      const user = createdUser.rows[0]!;

      try {
        await client.query(
          `INSERT INTO external_identities
             (user_id, provider_key, issuer_namespace, subject, email, display_name, avatar_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            user.id,
            identity.provider,
            identity.issuerNamespace,
            identity.subject,
            identity.email ?? null,
            identity.displayName ?? null,
            identity.avatarUrl ?? null,
          ],
        );
      } catch (_error) {
        // Unique race: identity claimed by another concurrent login.
        await client.query("ROLLBACK");
        const raced = await this.findByExternalIdentity(
          identity.issuerNamespace,
          identity.subject,
        );
        if (raced) return raced;
        throw conflict(
          "IDENTITY_COLLISION",
          "Эта внешняя учётная запись уже связана с другим аккаунтом",
        );
      }

      await client.query("COMMIT");
      return {
        id: user.id,
        status: user.status,
        locale: user.locale,
        displayName: user.display_name,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findByExternalIdentity(
    issuerNamespace: string,
    subject: string,
  ): Promise<UserRecord | null> {
    const result = await this.pool.query<{
      id: string;
      status: string;
      locale: string;
      display_name: string;
    }>(
      `SELECT u.id, u.status, u.locale, u.display_name
       FROM external_identities ei
       JOIN users u ON u.id = ei.user_id
       WHERE ei.issuer_namespace = $1 AND ei.subject = $2`,
      [issuerNamespace, subject],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      locale: row.locale,
      displayName: row.display_name,
    };
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const result = await this.pool.query<{
      id: string;
      status: string;
      locale: string;
      display_name: string;
    }>(
      `SELECT id, status, locale, display_name FROM users WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      locale: row.locale,
      displayName: row.display_name,
    };
  }

  async listLinkedProviders(userId: string): Promise<string[]> {
    const result = await this.pool.query<{ provider_key: string }>(
      `SELECT DISTINCT provider_key
       FROM external_identities
       WHERE user_id = $1
       ORDER BY provider_key`,
      [userId],
    );
    return result.rows.map((row) => row.provider_key);
  }

  async listLinkedProviderDetails(
    userId: string,
    client?: PoolClient,
  ): Promise<Array<{ providerKey: string; linkedAt: Date }>> {
    const result = await (client ?? this.pool).query<{
      provider_key: string;
      linked_at: Date;
    }>(
      `SELECT provider_key, MIN(created_at) AS linked_at
       FROM external_identities
       WHERE user_id = $1
       GROUP BY provider_key
       ORDER BY provider_key`,
      [userId],
    );
    return result.rows.map((row) => ({
      providerKey: row.provider_key,
      linkedAt: row.linked_at,
    }));
  }

  async countDistinctProviders(userId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT provider_key)::text AS count
       FROM external_identities
       WHERE user_id = $1`,
      [userId],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  /**
   * Attach a verified identity to an already authenticated user.
   * Never auto-links by email. Refuses silent merge on collision.
   */
  async linkIdentityToUser(
    userId: string,
    identity: VerifiedIdentity,
    sessionId?: string,
  ): Promise<"linked" | "already_linked"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockAuthActor(client, userId, sessionId, true);

      const existing = await client.query<{ user_id: string }>(
        `SELECT user_id FROM external_identities
         WHERE issuer_namespace = $1 AND subject = $2
         FOR UPDATE`,
        [identity.issuerNamespace, identity.subject],
      );
      const owner = existing.rows[0]?.user_id;
      if (owner) {
        if (owner === userId) {
          await client.query(
            `UPDATE external_identities
             SET email = $1, display_name = $2, avatar_url = $3, updated_at = now()
             WHERE issuer_namespace = $4 AND subject = $5`,
            [
              identity.email ?? null,
              identity.displayName ?? null,
              identity.avatarUrl ?? null,
              identity.issuerNamespace,
              identity.subject,
            ],
          );
          await client.query("COMMIT");
          return "already_linked";
        }
        await client.query("ROLLBACK");
        throw conflict(
          "IDENTITY_COLLISION",
          "Эта внешняя учётная запись уже связана с другим аккаунтом",
        );
      }

      const sameProvider = await client.query<{ id: string }>(
        `SELECT id FROM external_identities
         WHERE user_id = $1 AND provider_key = $2
         LIMIT 1
         FOR UPDATE`,
        [userId, identity.provider],
      );
      if (sameProvider.rowCount && sameProvider.rows[0]) {
        await client.query("ROLLBACK");
        throw conflict(
          "PROVIDER_ALREADY_LINKED",
          "Этот способ входа уже подключён к аккаунту",
        );
      }

      try {
        await client.query(
          `INSERT INTO external_identities
             (user_id, provider_key, issuer_namespace, subject, email, display_name, avatar_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            identity.provider,
            identity.issuerNamespace,
            identity.subject,
            identity.email ?? null,
            identity.displayName ?? null,
            identity.avatarUrl ?? null,
          ],
        );
      } catch (_error) {
        await client.query("ROLLBACK");
        const raced = await this.findByExternalIdentity(
          identity.issuerNamespace,
          identity.subject,
        );
        if (raced && raced.id === userId) return "already_linked";
        throw conflict(
          "IDENTITY_COLLISION",
          "Эта внешняя учётная запись уже связана с другим аккаунтом",
        );
      }

      await client.query("COMMIT");
      return "linked";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async unlinkProvider(userId: string, providerKey: string, sessionId?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.unlinkProviderInTransaction(client, userId, providerKey, sessionId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Caller owns the transaction; retains the existing actor/recent-auth and method locks. */
  async unlinkProviderInTransaction(
    client: PoolClient, userId: string, providerKey: string, sessionId?: string,
  ): Promise<void> {
    await lockAuthActor(client, userId, sessionId, true);
    const locked = await client.query<{ id: string; provider_key: string }>(
      `SELECT id, provider_key
       FROM external_identities
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    const providers = new Set(locked.rows.map((row) => row.provider_key));
    if (!providers.has(providerKey)) {
      throw conflict("PROVIDER_NOT_LINKED", "Этот способ входа не подключён");
    }
    if (await usableAuthMethodCount(client, userId) <= 1) {
      throw conflict("LAST_AUTH_METHOD", "Нельзя отключить последний способ входа");
    }
    await client.query(
      `DELETE FROM external_identities WHERE user_id = $1 AND provider_key = $2`,
      [userId, providerKey],
    );
  }

  /** Test helper: attempt to attach an identity that already belongs to another user. */
  async assertIdentityNotOwnedByOther(
    client: PoolClient,
    issuerNamespace: string,
    subject: string,
    expectedUserId: string,
  ): Promise<void> {
    const result = await client.query<{ user_id: string }>(
      `SELECT user_id FROM external_identities
       WHERE issuer_namespace = $1 AND subject = $2`,
      [issuerNamespace, subject],
    );
    const owner = result.rows[0]?.user_id;
    if (owner && owner !== expectedUserId) {
      throw conflict(
        "IDENTITY_COLLISION",
        "Эта внешняя учётная запись уже связана с другим аккаунтом",
      );
    }
  }
}
