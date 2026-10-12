import { assertCapabilities } from "../restrictions/policy";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { CONSUMER_AUDIENCE } from "../auth/constants";
import { unauthorized } from "../auth/problem";

/**
 * In-transaction active account + session fence.
 * Lock user FOR NO KEY UPDATE; re-read session under that fence.
 * last_seen telemetry must not invert locks with this fence.
 */
@Injectable()
export class ActorFenceService {
  constructor(@Inject(APP_ENV) private readonly env:AppEnv) {}
  async assertActiveConsumerInTransaction(
    client: PoolClient,
    input: { actorId: string; sessionId: string },
  ): Promise<void> {
    // Serialize actor mutations and disable/deletion through COMMIT. NO KEY
    // UPDATE permits FK KEY SHARE references by an opposed contact; user
    // status updates/deletion still conflict. No primary-key mutation is allowed.
    const account = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE`,
      [input.actorId],
    );
    if (!account.rows[0]) throw unauthorized();

    // A separate statement gets a fresh READ COMMITTED snapshot AFTER any
    // account-lock wait. A joined session read in the locking statement can
    // retain authorization from before a revocation committed during the wait.
    // Do not lock Session: telemetry must not invert User-before-Session order.
    const result = await client.query<{
      user_id: string;
      user_status: string;
      session_id: string;
      revoked_at: Date | null;
      expires_at: Date;
      audience: string;
    }>(
      `SELECT u.id AS user_id,
              u.status AS user_status,
              s.id AS session_id,
              s.revoked_at,
              s.expires_at,
              s.audience
       FROM users u
       INNER JOIN app_sessions s ON s.user_id = u.id
       WHERE u.id = $1
         AND s.id = $2`,
      [input.actorId, input.sessionId],
    );
    const row = result.rows[0];
    if (!row) throw unauthorized();
    if (row.user_status !== "active") {
      throw unauthorized("ACCOUNT_INACTIVE", "Аккаунт недоступен");
    }
    if (row.revoked_at) throw unauthorized();
    if (row.expires_at.getTime() <= Date.now()) throw unauthorized();
    if (row.audience !== CONSUMER_AUDIENCE) throw unauthorized();
    await assertCapabilities(client,this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,input.actorId,["account.access"]);
  }
}
