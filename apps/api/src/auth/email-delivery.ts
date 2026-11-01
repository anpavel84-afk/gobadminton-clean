import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { AppEnv } from "../config/env";
import { hmacSha256Hex, openSecret } from "./crypto";
import { EMAIL_CLEANUP_QUEUE, EMAIL_DEAD_QUEUE, EMAIL_DELIVERY_QUEUE, emailAuthEnabled } from "./email-security";
import { authMessageId } from "./auth-mail-template";
import { MailDeliveryError, type MailTransport } from "./mail-transport";
export type EmailDeliveryPayload = {
    challengeId: string;
    generation: number;
};
export function isEmailDeliveryPayload(value: unknown): value is EmailDeliveryPayload {
    if (!value || typeof value !== "object")
        return false;
    const row = value as Record<string, unknown>;
    return Object.keys(row).sort().join(",") === "challengeId,generation" &&
        typeof row.challengeId === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.challengeId) &&
        Number.isSafeInteger(row.generation) && Number(row.generation) > 0;
}
export async function ensureEmailQueues(boss: PgBoss) {
    await boss.createQueue(EMAIL_DEAD_QUEUE, { retryLimit: 0, retentionSeconds: 86400, deleteAfterSeconds: 86400 });
    await boss.createQueue(EMAIL_DELIVERY_QUEUE, { retryLimit: 3, retryDelay: 2, retryBackoff: true,
        expireInSeconds: 600, retentionSeconds: 86400, deleteAfterSeconds: 86400, deadLetter: EMAIL_DEAD_QUEUE });
    await boss.createQueue(EMAIL_CLEANUP_QUEUE, { retryLimit: 3, expireInSeconds: 60 });
}
/** No transaction holds a row lock across the transport call. Advisory delivery lease
 * serializes duplicate workers; final updates fence generation/state after resend/consume. */
export async function deliverEmail(input: {
    pool: Pool;
    env: AppEnv;
    transport: MailTransport;
    payload: EmailDeliveryPayload;
}): Promise<void> {
    if (!emailAuthEnabled(input.env))
        throw new Error("EMAIL_AUTH_DISABLED");
    if (!isEmailDeliveryPayload(input.payload))
        throw new Error("INVALID_EMAIL_JOB");
    const { challengeId: id, generation } = input.payload;
    const client = await input.pool.connect();
    const lease = `email-delivery:${id}:${generation}`;
    try {
        await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [lease]);
        const result = await client.query<{
            email_canonical: string;
            code_ciphertext: string | null;
            state: string;
            expires_at: Date;
            generation: number;
        }>("SELECT email_canonical, code_ciphertext, state, expires_at, generation FROM email_auth_challenges WHERE id=$1", [id]);
        const row = result.rows[0];
        if (!row || row.generation !== generation || row.state !== "queued" || !row.code_ciphertext)
            return;
        if (row.expires_at.getTime() <= Date.now()) {
            await client.query("UPDATE email_auth_challenges SET state='expired', code_ciphertext=NULL WHERE id=$1 AND generation=$2 AND state='queued'", [id, generation]);
            return;
        }
        const count = await client.query<{
            count: string;
        }>("SELECT count(*)::text AS count FROM email_auth_delivery_attempts WHERE challenge_id=$1 AND generation=$2", [id, generation]);
        const attempt = Number(count.rows[0]!.count) + 1;
        let state = "sent", errorClass: string | null = null, messageId: string | null = null;
        try {
            const code = openSecret(input.env.EMAIL_AUTH_ENCRYPTION_SECRET!, row.code_ciphertext);
            // Actual transport attempts (including retries) share an independent DB cost cap.
            const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
            const budget = await client.query<{ count: number }>(
                `INSERT INTO email_auth_rate_buckets(key_hash,bucket_kind,window_start,count,expires_at)
                 VALUES($1,'send_hour',$2,1,$3)
                 ON CONFLICT(key_hash,bucket_kind,window_start) DO UPDATE SET count=email_auth_rate_buckets.count+1
                 WHERE email_auth_rate_buckets.count < $4 RETURNING count`,
                [hmacSha256Hex(input.env.EMAIL_AUTH_RATE_SECRET!, "global-send"), new Date(windowStart),
                    new Date(windowStart + 3_600_000), input.env.EMAIL_AUTH_GLOBAL_HOURLY_BUDGET]);
            if (!budget.rows[0]) throw new MailDeliveryError("permanent");
            const sent = await input.transport.sendAuthCode({ to: row.email_canonical, code, expiresAt: row.expires_at, deliveryId: `${id}:${generation}` });
            // Persist only our own opaque deterministic identifiers, never provider responses.
            messageId = [ `fake:${id}:${generation}`, authMessageId(`${id}:${generation}`) ].includes(sent.messageId) ? sent.messageId : null;
        }
        catch (error) {
            errorClass = error instanceof MailDeliveryError ? error.kind : "ciphertext_invalid";
            state = errorClass === "temporary" && attempt < 4 ? "temporary_failure" : "permanent_failure";
        }
        await client.query("BEGIN");
        await client.query("INSERT INTO email_auth_delivery_attempts(challenge_id,generation,attempt_no,state,provider_message_id,error_class) VALUES($1,$2,$3,$4,$5,$6)", [id, generation, attempt, state, messageId, errorClass]);
        if (state !== "temporary_failure") {
            await client.query("UPDATE email_auth_challenges SET state=$3, code_ciphertext=NULL WHERE id=$1 AND generation=$2 AND state='queued'", [id, generation, state === "sent" ? "sent" : "delivery_failed"]);
        }
        await client.query("COMMIT");
        if (state === "temporary_failure")
            throw new Error("EMAIL_DELIVERY_TEMPORARY");
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
    finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lease]).catch(() => undefined);
        client.release();
    }
}
export async function cleanupEmail(pool: Pool): Promise<void> {
    await pool.query("UPDATE email_auth_challenges SET state='expired',code_ciphertext=NULL WHERE expires_at <= now() AND state IN ('queued','sent','delivery_failed')");
    await pool.query("DELETE FROM email_auth_delivery_attempts WHERE created_at < now()-interval '7 days'");
    await pool.query("DELETE FROM email_auth_challenges WHERE expires_at < now()-interval '24 hours'");
    await pool.query("DELETE FROM email_auth_rate_buckets WHERE expires_at < now()");
}
