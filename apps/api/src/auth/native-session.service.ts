import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { ActorFenceService } from "../common/actor-fence.service";
import { PushService } from "../push/push.service";
import { NATIVE_AUDIENCE, NATIVE_POLICY } from "./constants";
import { hashSecret, randomToken } from "./crypto";
import { notFound, unauthorized } from "./problem";
import { assertCapabilities, unrestrictedSql } from "../restrictions/policy";

@Injectable()
export class NativeSessionService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv, private readonly fence: ActorFenceService) {}

  enabled() { if (!this.env.NATIVE_AUTH_ENABLED) throw notFound("NOT_FOUND", "Не найдено"); }
  hash(value: string) { return hashSecret(this.env.AUTH_PEPPER, value); }
  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async cleanupExpired() {
    // Never delete an unexpired access token, even on an expired/revoked family.
    await this.pool.query(`DELETE FROM native_access_tokens WHERE token_hash IN (
      SELECT token_hash FROM native_access_tokens WHERE expires_at<=now()
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    await this.transaction(async client => {
      // Lock families before their children, as refresh does. No User/Session locks
      // or audit-row deletion here; SKIP LOCKED avoids blocking active refreshes.
      const expired = await client.query<{session_id:string}>(`SELECT session_id FROM native_refresh_families
        WHERE absolute_expires_at<=now() ORDER BY absolute_expires_at LIMIT 20 FOR UPDATE SKIP LOCKED`);
      const ids = expired.rows.map(row=>row.session_id);
      if (!ids.length) return;
      // Idle expiry and revocation MUST NOT truncate consumed-token replay history.
      // Bound child deletion too: a family may contain many rotated credentials.
      await client.query(`DELETE FROM native_refresh_tokens WHERE token_hash IN (
        SELECT token_hash FROM native_refresh_tokens WHERE session_id=ANY($1::uuid[])
        LIMIT 100 FOR UPDATE SKIP LOCKED)`,[ids]);
      await client.query(`DELETE FROM native_refresh_families f WHERE f.session_id=ANY($1::uuid[])
        AND f.absolute_expires_at<=now()
        AND NOT EXISTS (SELECT 1 FROM native_refresh_tokens t WHERE t.session_id=f.session_id)
        AND NOT EXISTS (SELECT 1 FROM native_access_tokens a WHERE a.session_id=f.session_id)`,[ids]);
    });
  }
  async issue(client: PoolClient, userId: string, clientId: string) {
    // Caller has fenced the authorizing browser grant under User-before-Session.
    await assertCapabilities(client, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, userId, ["account.access"]);
    const absolute = new Date(Date.now() + NATIVE_POLICY.absolute * 1000);
    const idle = new Date(Date.now() + NATIVE_POLICY.idle * 1000);
    const session = await client.query<{id:string}>(`INSERT INTO app_sessions(user_id,audience,expires_at)
      VALUES($1,$2,$3) RETURNING id`, [userId,NATIVE_AUDIENCE,idle]);
    const sessionId = session.rows[0]!.id;
    await client.query(`INSERT INTO native_refresh_families(session_id,client_id,absolute_expires_at,idle_expires_at)
      VALUES($1,$2,$3,$4)`, [sessionId,clientId,absolute,idle]);
    return this.credentials(client, sessionId, idle, absolute);
  }
  private async credentials(client: PoolClient, sessionId: string, idle: Date, absolute: Date) {
    const accessToken = randomToken(32), refreshToken = randomToken(32);
    await client.query(`INSERT INTO native_access_tokens(token_hash,session_id,expires_at) VALUES($1,$2,$3)`,
      [this.hash(accessToken),sessionId,new Date(Date.now()+NATIVE_POLICY.access*1000)]);
    await client.query(`INSERT INTO native_refresh_tokens(token_hash,session_id) VALUES($1,$2)`, [this.hash(refreshToken),sessionId]);
    return { accessToken, refreshToken, expiresIn: NATIVE_POLICY.access, refreshExpiresAt: idle.toISOString(),
      refreshAbsoluteExpiresAt: absolute.toISOString(), sessionId, tokenType: "Bearer" as const };
  }
  async lookup(token: string) {
    this.enabled();
    const result = await this.pool.query<{id:string;user_id:string;expires_at:Date}>(`SELECT s.id,s.user_id,s.expires_at
      FROM native_access_tokens a JOIN app_sessions s ON s.id=a.session_id
      JOIN native_refresh_families f ON f.session_id=s.id JOIN users u ON u.id=s.user_id
      WHERE a.token_hash=$1 AND a.expires_at>now() AND s.audience=$2 AND s.revoked_at IS NULL AND s.expires_at>now()
      AND f.revoked_at IS NULL AND f.idle_expires_at>now() AND f.absolute_expires_at>now() AND u.status='active'
      AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,"s.user_id",["account.access"])}`,[this.hash(token),NATIVE_AUDIENCE]);
    const row = result.rows[0]; if (!row) throw unauthorized();
    return { userId:row.user_id, sessionId:row.id, audience:NATIVE_AUDIENCE, transport:"bearer" as const };
  }
  async refresh(token: string, clientId: string) {
    this.enabled();
    const result = await this.transaction(async client => {
      const found = await client.query<{user_id:string;session_id:string}>(`SELECT s.user_id,s.id AS session_id
        FROM native_refresh_tokens t JOIN app_sessions s ON s.id=t.session_id WHERE t.token_hash=$1`,[this.hash(token)]);
      const identity = found.rows[0]; if (!identity) throw unauthorized();
      await client.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE",[identity.user_id]);
      const selected = await client.query<{consumed_at:Date|null;revoked_at:Date|null;client_id:string;idle_expires_at:Date;absolute_expires_at:Date}>(
        `SELECT t.consumed_at,f.revoked_at,f.client_id,f.idle_expires_at,f.absolute_expires_at
         FROM native_refresh_tokens t JOIN native_refresh_families f ON f.session_id=t.session_id
         WHERE t.token_hash=$1 FOR UPDATE OF f,t`,[this.hash(token)]);
      const row = selected.rows[0];
      if (!row || row.client_id!==clientId) throw unauthorized();
      if (row.consumed_at) { await this.revoke(client,identity.session_id); return null; }
      if (row.revoked_at || row.idle_expires_at.getTime()<=Date.now() || row.absolute_expires_at.getTime()<=Date.now()) throw unauthorized();
      await this.fence.assertActiveConsumerInTransaction(client,{actorId:identity.user_id,sessionId:identity.session_id});
      await client.query("UPDATE native_refresh_tokens SET consumed_at=clock_timestamp() WHERE token_hash=$1",[this.hash(token)]);
      const idle = new Date(Math.min(Date.now()+NATIVE_POLICY.idle*1000,row.absolute_expires_at.getTime()));
      await client.query("UPDATE native_refresh_families SET idle_expires_at=$2 WHERE session_id=$1",[identity.session_id,idle]);
      await client.query("UPDATE app_sessions SET expires_at=$2 WHERE id=$1",[identity.session_id,idle]);
      return this.credentials(client,identity.session_id,idle,row.absolute_expires_at);
    });
    // Replay revocation must commit before the HTTP rejection is raised.
    if (!result) throw unauthorized("REFRESH_REPLAY", "Повтор refresh: войдите снова");
    return result;
  }
  private async revoke(client: PoolClient, sessionId: string) {
    await client.query("UPDATE native_refresh_families SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE session_id=$1",[sessionId]);
    await client.query("UPDATE app_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1",[sessionId]);
    await client.query("DELETE FROM radar_presences WHERE owner_session_id=$1",[sessionId]);
    await PushService.unbindSessions(client,[sessionId]);
  }
  async logout(input: {accessToken?:string;refreshToken?:string;clientId:string}) {
    this.enabled();
    await this.transaction(async client => {
      // Recognizable refresh is sufficient even when access expired; neither can affect browser sessions.
      const token = input.refreshToken ?? input.accessToken;
      if (!token) throw unauthorized();
      const table = input.refreshToken ? "native_refresh_tokens" : "native_access_tokens";
      const result = await client.query<{id:string;user_id:string}>(`SELECT s.id,s.user_id FROM ${table} t
        JOIN app_sessions s ON s.id=t.session_id JOIN native_refresh_families f ON f.session_id=s.id
        WHERE t.token_hash=$1 AND f.client_id=$2 AND s.audience=$3 ${input.refreshToken ? "" : "AND t.expires_at>now()"}`,
        [this.hash(token),input.clientId,NATIVE_AUDIENCE]);
      const row = result.rows[0]; if (!row) throw unauthorized();
      await client.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE",[row.user_id]);
      await this.revoke(client,row.id);
    });
    return {ok:true};
  }
}
