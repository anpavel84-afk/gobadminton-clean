import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../tokens";
import { forbidden, unauthorized } from "./problem";
import { maskEmail } from "./email-security";
/** Same User -> Session lock order as auth method writers; revoke serializes on Session. */
export async function lockAuthActor(client: PoolClient, userId: string, sessionId?: string, recent = false): Promise<void> {
    const user = await client.query<{
        status: string;
    }>("SELECT status FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (user.rows[0]?.status !== "active")
        throw unauthorized("ACCOUNT_UNAVAILABLE", "Аккаунт недоступен");
    if (!sessionId)
        return;
    const session = await client.query<{
        fresh: boolean;
    }>(`SELECT authenticated_at > clock_timestamp() - interval '15 minutes' AS fresh
     FROM app_sessions WHERE id=$1 AND user_id=$2 AND audience='consumer_browser'
     AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE`, [sessionId, userId]);
    if (!session.rows[0])
        throw unauthorized();
    if (recent && !session.rows[0].fresh)
        throw forbidden("RECENT_AUTH_REQUIRED", "Требуется недавний вход");
}
/** User fence must already be held. Counts linked supported credentials, never metadata email. */
export async function usableAuthMethodCount(client: PoolClient, userId: string): Promise<number> {
    const oauth = await client.query<{
        provider_key: string;
    }>("SELECT provider_key FROM external_identities WHERE user_id=$1 FOR UPDATE", [userId]);
    const email = await client.query("SELECT id FROM email_auth_methods WHERE user_id=$1 AND status='active' FOR UPDATE", [userId]);
    return new Set(oauth.rows.map(row => row.provider_key)).size + email.rows.length;
}
@Injectable()
export class AuthMethodService {
    constructor(
    @Inject(DATABASE_POOL)
    private readonly pool: Pool) { }
    async inventory(userId: string) {
        const oauth = await this.pool.query<{
            provider_key: string;
            linked_at: Date;
        }>("SELECT provider_key, min(created_at) AS linked_at FROM external_identities WHERE user_id=$1 GROUP BY provider_key ORDER BY provider_key", [userId]);
        const email = await this.pool.query<{
            email_display: string;
            verified_at: Date;
        }>("SELECT email_display, verified_at FROM email_auth_methods WHERE user_id=$1 AND status='active'", [userId]);
        return { items: [
                ...oauth.rows.map(row => ({ method: row.provider_key, type: "oauth", status: "connected", linkedAt: row.linked_at.toISOString() })),
                ...email.rows.map(row => ({ method: "email", type: "email_code", status: "connected", maskedEmail: maskEmail(row.email_display), linkedAt: row.verified_at.toISOString() })),
            ] };
    }
}
