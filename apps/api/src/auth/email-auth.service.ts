import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { JobEnqueueService } from "../jobs/job-enqueue.service";
import { fromPoolClient } from "../jobs/from-pool-client";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { lockAuthActor, usableAuthMethodCount } from "./auth-method.service";
import { ConsumerAuthService, type AuthenticatedConsumer } from "./consumer-auth.service";
import { readCookie, setSessionCookie } from "./cookies";
import { hmacSha256Hex, randomToken, sealSecret, secretsEqual } from "./crypto";
import { ensureEmailQueues, type EmailDeliveryPayload } from "./email-delivery";
import { EMAIL_BINDING_COOKIE, EMAIL_DELIVERY_QUEUE, emailAuthEnabled, emailCodeHash, newEmailCode, normalizeEmail } from "./email-security";
import { forbidden, notFound, problem, serviceUnavailable, unprocessable } from "./problem";
import { ProviderRegistry } from "./providers/registry";
import { normalizeReturnPath } from "./return-path";
import { SessionService, type IssuedSession } from "./session.service";
import {
  SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
  ensureDefaultSocialProfile,
} from "../profiles/social-profile-defaults";
type Purpose = "login_signup" | "link" | "change_current" | "change";
type Challenge = {
    id: string;
    purpose: Purpose;
    email_canonical: string;
    email_display: string;
    origin: string;
    browser_binding_hash: string | null;
    bound_user_id: string | null;
    bound_session_id: string | null;
    return_path: string;
    original_method_id: string | null;
    change_proof_id: string | null;
    generation: number;
    code_hash: string;
    state: string;
    verify_attempts: number;
    expires_at: Date;
    resend_after: Date;
};
type Context = {
    origin: string;
    ip: string;
    binding?: string;
    actor?: AuthenticatedConsumer;
};
const invalidCode = () => unprocessable("EMAIL_CODE_INVALID_OR_EXPIRED", "Код недействителен или истёк");
const rateError = (seconds: number) => problem(429, "EMAIL_RATE_LIMITED", "Повторите позже", undefined, seconds);
@Injectable()
export class EmailAuthService {
    constructor(
    @Inject(DATABASE_POOL)
    private readonly pool: Pool,
    @Inject(APP_ENV)
    private readonly env: AppEnv, private readonly jobs: JobEnqueueService, private readonly sessions: SessionService, private readonly consumer: ConsumerAuthService, private readonly providers: ProviderRegistry) { }
    methods() {
        return { items: [
                ...(["vk", "yandex"] as const).map(method => ({ method, type: "oauth", available: this.providers.get(method).configured })),
                { method: "email", type: "email_code", available: emailAuthEnabled(this.env) },
            ] };
    }
    private enabled() { if (!emailAuthEnabled(this.env))
        throw serviceUnavailable("EMAIL_AUTH_UNAVAILABLE", "Вход по email недоступен"); }
    private key(value: string) { return hmacSha256Hex(this.env.EMAIL_AUTH_RATE_SECRET!, value); }
    private bindingHash(value: string) { return hmacSha256Hex(this.env.EMAIL_AUTH_HMAC_SECRET!, `email-binding:${value}`); }
    private async context(request: FastifyRequest, purpose: Purpose, mutation: boolean): Promise<Context> {
        this.enabled();
        const origin = request.headers.origin;
        if (typeof origin !== "string" || !this.env.ALLOWED_WEB_ORIGINS.includes(origin))
            throw forbidden("ORIGIN_REJECTED", "Origin не разрешён");
        if (mutation && (request.headers["x-gb-email-auth"] !== "1" || !/^application\/json(?:\s*;|$)/i.test(String(request.headers["content-type"] ?? "")))) {
            throw forbidden("EMAIL_FLOW_REQUIRED", "Требуется JSON email flow");
        }
        return { origin, ip: request.ip, ...(purpose !== "login_signup"
                ? { actor: mutation ? await this.consumer.requireCookieMutation(request) : await this.consumer.requireSession(request) }
                : { binding: readCookie(request, EMAIL_BINDING_COOKIE) }) };
    }
    private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
            const result = await action(client);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
        }
        finally {
            client.release();
        }
    }
    private async emailFence(client: PoolClient, email: string) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`email-owner:${email}`]);
    }
    private async budgets(client: PoolClient, email: string, ip: string) {
        const now = Date.now();
        const buckets = [
            { kind: "email_hour", key: this.key(`email:${email}`), seconds: 3600, limit: 5 },
            { kind: "email_day", key: this.key(`email:${email}`), seconds: 86400, limit: 15 },
            { kind: "ip_hour", key: this.key(`ip:${ip}`), seconds: 3600, limit: 20 },
            { kind: "ip_day", key: this.key(`ip:${ip}`), seconds: 86400, limit: 100 },
            { kind: "global_hour", key: this.key("global"), seconds: 3600, limit: this.env.EMAIL_AUTH_GLOBAL_HOURLY_BUDGET },
        ].sort((a, b) => a.kind.localeCompare(b.kind));
        for (const bucket of buckets) {
            const start = Math.floor(now / (bucket.seconds * 1000)) * bucket.seconds * 1000;
            const result = await client.query<{
                count: number;
            }>(`INSERT INTO email_auth_rate_buckets(key_hash,bucket_kind,window_start,count,expires_at) VALUES($1,$2,$3,1,$4)
         ON CONFLICT(key_hash,bucket_kind,window_start) DO UPDATE SET count=email_auth_rate_buckets.count+1 RETURNING count`, [bucket.key, bucket.kind, new Date(start), new Date(start + bucket.seconds * 1000)]);
            if (result.rows[0]!.count > bucket.limit)
                throw rateError(Math.max(1, Math.ceil((start + bucket.seconds * 1000 - now) / 1000)));
        }
    }
    private publicChallenge(row: Challenge) {
        const expired = row.expires_at.getTime() <= Date.now();
        return { challengeId: row.id, expiresAt: row.expires_at.toISOString(), resendAvailableAt: row.resend_after.toISOString(),
            deliveryState: expired || ["superseded", "locked", "expired"].includes(row.state) ? "expired" : row.state };
    }
    private async enqueue(client: PoolClient, id: string, generation: number) {
        const payload: EmailDeliveryPayload = { challengeId: id, generation };
        const jobId = await this.jobs.getBoss().send(EMAIL_DELIVERY_QUEUE, payload, {
            db: fromPoolClient(client), retryLimit: 3, retryDelay: 2, retryBackoff: true, expireInSeconds: 600,
        });
        if (!jobId)
            throw serviceUnavailable("EMAIL_QUEUE_UNAVAILABLE", "Доставка временно недоступна");
    }
    async issue(request: FastifyRequest, reply: FastifyReply, purpose: Purpose, body: {
        email?: unknown;
        returnPath?: string;
        proofChallengeId?: string;
    }) {
        const ctx = await this.context(request, purpose, true);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !(purpose === "change" ? ["email", "proofChallengeId"] : purpose === "change_current" ? [] : ["email", "returnPath"]).includes(key)))
            throw unprocessable("EMAIL_REQUEST_INVALID", "Некорректный запрос");
        let email = purpose === "change_current" ? undefined : normalizeEmail(body?.email);
        if (purpose === "change_current") {
            const own = await this.pool.query<{email_display: string}>("SELECT email_display FROM email_auth_methods WHERE user_id=$1 AND status='active'", [ctx.actor!.userId]);
            if (!own.rows[0]) throw notFound("EMAIL_METHOD_NOT_FOUND", "Email не подключён");
            email = normalizeEmail(own.rows[0].email_display);
        }
        const target = email!;
        if (body?.returnPath !== undefined && typeof body.returnPath !== "string")
            throw unprocessable("UNSAFE_RETURN_PATH", "Недопустимый returnPath");
        const returnPath = normalizeReturnPath(body?.returnPath ?? (purpose !== "login_signup" ? "/profile/settings/login-methods" : "/"));
        if (!returnPath)
            throw unprocessable("UNSAFE_RETURN_PATH", "Недопустимый returnPath");
        if (purpose === "login_signup" && (!ctx.binding || !/^[A-Za-z0-9_-]{32,64}$/.test(ctx.binding)))
            ctx.binding = randomToken(32);
        const boss = await this.jobs.ensureStarted();
        await ensureEmailQueues(boss);
        const challenge = await this.transaction(async (client) => {
            await this.emailFence(client, target.canonical);
            if (ctx.actor)
                await lockAuthActor(client, ctx.actor.userId, ctx.actor.sessionId, true);
            let originalId: string | null = null;
            if (purpose === "change_current" || purpose === "change") {
                const own = await client.query<{id: string; email_canonical: string}>("SELECT id,email_canonical FROM email_auth_methods WHERE user_id=$1 AND status='active' FOR UPDATE", [ctx.actor!.userId]);
                if (!own.rows[0] || (purpose === "change_current" && own.rows[0].email_canonical !== target.canonical))
                    throw problem(409, "EMAIL_METHOD_CHANGED", "Способ входа изменился. Начните заново");
                originalId = own.rows[0].id;
                if (purpose === "change") {
                    if (target.canonical === own.rows[0].email_canonical) throw unprocessable("EMAIL_UNCHANGED", "Укажите новый email");
                    if (typeof body.proofChallengeId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.proofChallengeId))
                        throw forbidden("EMAIL_CURRENT_PROOF_REQUIRED", "Подтвердите текущий email");
                    await this.currentProof(client, body.proofChallengeId, ctx, originalId);
                    const used = await client.query("SELECT id FROM email_auth_challenges WHERE change_proof_id=$1", [body.proofChallengeId]);
                    if (used.rows.length) throw forbidden("EMAIL_CURRENT_PROOF_REQUIRED", "Подтвердите текущий email заново");
                }
            }
            const binding = ctx.binding ? this.bindingHash(ctx.binding) : null;
            const previous = await client.query<Challenge>(`SELECT * FROM email_auth_challenges WHERE email_canonical=$1 AND purpose=$2 AND origin=$3
         AND (browser_binding_hash=$4 OR bound_session_id=$5) AND state IN ('queued','sent','delivery_failed') FOR UPDATE`, [target.canonical, purpose, ctx.origin, binding, ctx.actor?.sessionId ?? null]);
            if (previous.rows.some(row => row.resend_after.getTime() > Date.now() && row.expires_at.getTime() > Date.now()))
                throw rateError(60);
            await this.budgets(client, target.canonical, ctx.ip);
            await client.query("UPDATE email_auth_challenges SET state='superseded',superseded_at=now(),code_ciphertext=NULL WHERE id=ANY($1::uuid[])", [previous.rows.map(row => row.id)]);
            const id = randomUUID(), code = newEmailCode();
            const result = await client.query<Challenge>(`INSERT INTO email_auth_challenges(id,purpose,email_canonical,email_display,origin,browser_binding_hash,bound_user_id,bound_session_id,
           return_path,code_hash,code_ciphertext,expires_at,resend_after,original_method_id,change_proof_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '60 seconds',$12,$13) RETURNING *`, [id, purpose, target.canonical, target.display, ctx.origin, binding, ctx.actor?.userId ?? null, ctx.actor?.sessionId ?? null, returnPath,
                emailCodeHash(this.env.EMAIL_AUTH_HMAC_SECRET!, id, 1, code), sealSecret(this.env.EMAIL_AUTH_ENCRYPTION_SECRET!, code), originalId, purpose === "change" ? body.proofChallengeId : null]);
            await this.enqueue(client, id, 1);
            return result.rows[0]!;
        });
        if (ctx.binding)
            reply.setCookie(EMAIL_BINDING_COOKIE, ctx.binding, { path: "/", httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: "lax", maxAge: 600 });
        return this.publicChallenge(challenge);
    }
    private assertBinding(row: Challenge, purpose: Purpose, ctx: Context) {
        if (row.purpose !== purpose || row.origin !== ctx.origin || (purpose === "login_signup"
            ? !ctx.binding || !row.browser_binding_hash || !secretsEqual(this.bindingHash(ctx.binding), row.browser_binding_hash)
            : row.bound_user_id !== ctx.actor?.userId || row.bound_session_id !== ctx.actor?.sessionId)) {
            throw forbidden("EMAIL_BINDING_REJECTED", "Неверная привязка запроса");
        }
    }
    private async locked(client: PoolClient, id: string, purpose: Purpose, ctx: Context): Promise<Challenge> {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
            throw notFound("EMAIL_CHALLENGE_NOT_FOUND", "Запрос не найден");
        const peek = await client.query<Challenge>("SELECT * FROM email_auth_challenges WHERE id=$1", [id]);
        const first = peek.rows[0];
        if (!first)
            throw notFound("EMAIL_CHALLENGE_NOT_FOUND", "Запрос не найден");
        this.assertBinding(first, purpose, ctx);
        await this.emailFence(client, first.email_canonical);
        if (ctx.actor)
            await lockAuthActor(client, ctx.actor.userId, ctx.actor.sessionId, true);
        const result = await client.query<Challenge>("SELECT * FROM email_auth_challenges WHERE id=$1 FOR UPDATE", [id]);
        const row = result.rows[0];
        if (!row)
            throw notFound("EMAIL_CHALLENGE_NOT_FOUND", "Запрос не найден");
        this.assertBinding(row, purpose, ctx);
        if (purpose === "change_current" || purpose === "change") {
            const own = await client.query("SELECT id FROM email_auth_methods WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE", [row.original_method_id, ctx.actor!.userId]);
            if (!own.rows.length) throw problem(409, "EMAIL_METHOD_CHANGED", "Способ входа изменился. Начните заново");
            if (purpose === "change") await this.currentProof(client, row.change_proof_id, ctx, row.original_method_id!);
        }
        return row;
    }
    private async currentProof(client: PoolClient, id: string | null, ctx: Context, originalId: string) {
        const proof = await client.query<Challenge>("SELECT * FROM email_auth_challenges WHERE id=$1 FOR UPDATE", [id]);
        const row = proof.rows[0];
        if (!row || row.purpose !== "change_current" || row.state !== "consumed" || row.expires_at.getTime() <= Date.now()
            || row.original_method_id !== originalId || row.bound_user_id !== ctx.actor?.userId || row.bound_session_id !== ctx.actor?.sessionId || row.origin !== ctx.origin)
            throw forbidden("EMAIL_CURRENT_PROOF_REQUIRED", "Подтвердите текущий email заново");
    }
    async unlink(request: FastifyRequest) {
        const ctx = await this.context(request, "link", true);
        await this.transaction(async client => {
            await lockAuthActor(client, ctx.actor!.userId, ctx.actor!.sessionId, true);
            const count = await usableAuthMethodCount(client, ctx.actor!.userId);
            const own = await client.query("SELECT id FROM email_auth_methods WHERE user_id=$1 AND status='active'", [ctx.actor!.userId]);
            if (!own.rows.length) throw notFound("EMAIL_METHOD_NOT_FOUND", "Email не подключён");
            if (count <= 1) throw problem(409, "LAST_AUTH_METHOD", "Нельзя отключить последний способ входа");
            await client.query("UPDATE email_auth_methods SET status='revoked',revoked_at=now(),updated_at=now(),version=version+1 WHERE user_id=$1 AND status='active'", [ctx.actor!.userId]);
        });
        return { unlinked: true };
    }
    async browserStatus(request: FastifyRequest, purpose: Purpose, id: string) {
        const ctx = await this.context(request, purpose, true);
        return this.transaction(async client => this.publicChallenge(await this.locked(client, id, purpose, ctx)));
    }
    async status(request: FastifyRequest, purpose: Purpose, id: string) {
        const ctx = await this.context(request, purpose, false);
        return this.transaction(async (client) => this.publicChallenge(await this.locked(client, id, purpose, ctx)));
    }
    async resend(request: FastifyRequest, purpose: Purpose, id: string) {
        const ctx = await this.context(request, purpose, true);
        await ensureEmailQueues(await this.jobs.ensureStarted());
        return this.transaction(async (client) => {
            const row = await this.locked(client, id, purpose, ctx);
            if (!["queued", "sent", "delivery_failed"].includes(row.state) || row.expires_at.getTime() <= Date.now())
                throw invalidCode();
            if (row.resend_after.getTime() > Date.now())
                throw rateError(Math.ceil((row.resend_after.getTime() - Date.now()) / 1000));
            await this.budgets(client, row.email_canonical, ctx.ip);
            const generation = row.generation + 1;
            let code = newEmailCode();
            while (secretsEqual(emailCodeHash(this.env.EMAIL_AUTH_HMAC_SECRET!, id, row.generation, code), row.code_hash))
                code = newEmailCode();
            const result = await client.query<Challenge>(`UPDATE email_auth_challenges SET generation=$2,code_hash=$3,code_ciphertext=$4,state='queued',send_count=send_count+1,
         expires_at=clock_timestamp()+interval '10 minutes',resend_after=clock_timestamp()+interval '60 seconds' WHERE id=$1 RETURNING *`, [id, generation, emailCodeHash(this.env.EMAIL_AUTH_HMAC_SECRET!, id, generation, code), sealSecret(this.env.EMAIL_AUTH_ENCRYPTION_SECRET!, code)]);
            // Failed attempt count is deliberately cumulative across resends, never resets the attack budget.
            await this.enqueue(client, id, generation);
            return this.publicChallenge(result.rows[0]!);
        });
    }
    async verify(request: FastifyRequest, reply: FastifyReply, purpose: Purpose, id: string, body: {
        code?: unknown;
    }) {
        const ctx = await this.context(request, purpose, true);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "code"))
            throw unprocessable("EMAIL_REQUEST_INVALID", "Некорректный запрос");
        if (typeof body?.code !== "string" || !/^\d{8}$/.test(body.code))
            throw unprocessable("EMAIL_CODE_FORMAT", "Требуется 8 цифр");
        const code = body.code;
        const result = await this.transaction(async (client) => {
            const row = await this.locked(client, id, purpose, ctx);
            if (row.state === "locked")
                return { error: rateError(600) };
            if (!["queued", "sent"].includes(row.state))
                return { error: invalidCode() };
            if (row.expires_at.getTime() <= Date.now()) {
                await client.query("UPDATE email_auth_challenges SET state='expired',code_ciphertext=NULL WHERE id=$1", [id]);
                return { error: invalidCode() };
            }
            if (!secretsEqual(emailCodeHash(this.env.EMAIL_AUTH_HMAC_SECRET!, id, row.generation, code), row.code_hash)) {
                const attempts = row.verify_attempts + 1;
                await client.query("UPDATE email_auth_challenges SET verify_attempts=$2,state=CASE WHEN $2>=5 THEN 'locked' ELSE state END,code_ciphertext=CASE WHEN $2>=5 THEN NULL ELSE code_ciphertext END WHERE id=$1", [id, attempts]);
                return { error: attempts >= 5 ? rateError(600) : invalidCode() };
            }
            const existing = await client.query<{
                user_id: string;
            }>("SELECT user_id FROM email_auth_methods WHERE email_canonical=$1 AND status='active'", [row.email_canonical]);
            let userId = existing.rows[0]?.user_id;
            let issued: IssuedSession | undefined;
            let error: ReturnType<typeof problem> | undefined;
            if (purpose === "link") {
                if (userId && userId !== ctx.actor!.userId)
                    error = problem(409, "EMAIL_ALREADY_LINKED", "Email уже подключён к другому аккаунту");
                else {
                    const own = await client.query<{
                        email_canonical: string;
                    }>("SELECT email_canonical FROM email_auth_methods WHERE user_id=$1 AND status='active' FOR UPDATE", [ctx.actor!.userId]);
                    if (own.rows[0] && own.rows[0].email_canonical !== row.email_canonical)
                        error = problem(409, "EMAIL_METHOD_ALREADY_LINKED", "Email уже подключён");
                    else if (!userId)
                        await client.query("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,$2,$3)", [ctx.actor!.userId, row.email_canonical, row.email_display]);
                }
            }
            else if (purpose === "change") {
                if (userId) error = problem(409, "EMAIL_ALREADY_LINKED", "Email уже подключён к аккаунту");
                else {
                    await client.query("UPDATE email_auth_methods SET status='revoked',revoked_at=now(),updated_at=now(),version=version+1 WHERE id=$1", [row.original_method_id]);
                    await client.query("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,$2,$3)", [ctx.actor!.userId, row.email_canonical, row.email_display]);
                }
            }
            else if (purpose === "login_signup") {
                if (userId) {
                    const user = await client.query<{
                        status: string;
                    }>("SELECT status FROM users WHERE id=$1 FOR UPDATE", [userId]);
                    if (user.rows[0]?.status !== "active")
                        error = problem(403, "ACCOUNT_UNAVAILABLE", "Аккаунт недоступен");
                    // Unlink/change may have waited ahead of login on the User fence.
                    const stillOwned = await client.query("SELECT id FROM email_auth_methods WHERE user_id=$1 AND email_canonical=$2 AND status='active' FOR UPDATE", [userId, row.email_canonical]);
                    if (!stillOwned.rows.length) error = invalidCode();
                }
                else {
                    const user = await client.query<{
                        id: string;
                    }>("INSERT INTO users(display_name,locale) VALUES($1,'ru') RETURNING id", [
                        SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
                    ]);
                    userId = user.rows[0]!.id;
                    await client.query("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,$2,$3)", [userId, row.email_canonical, row.email_display]);
                }
                if (!error) {
                    // Owner #448 defaults for new users; DO NOTHING preserves explicit OFF.
                    // Never use the mailbox as a public display name.
                    const named = await client.query<{ display_name: string }>(
                        "SELECT display_name FROM users WHERE id=$1",
                        [userId!],
                    );
                    await ensureDefaultSocialProfile(client, {
                        userId: userId!,
                        displayName:
                            named.rows[0]?.display_name?.trim() ||
                            SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
                    });
                    issued = await this.sessions.createConsumerSession(userId!, client);
                }
            }
            await client.query("UPDATE email_auth_challenges SET state='consumed',consumed_at=now(),code_ciphertext=NULL WHERE id=$1", [id]);
            return { error, issued, returnPath: row.return_path };
        });
        if (result.error)
            throw result.error;
        if (result.issued)
            setSessionCookie(reply, this.env, result.issued.sessionToken);
        if (purpose === "change_current") return { proved: true, proofChallengeId: id };
        if (purpose === "change") return { changed: true };
        return purpose === "link" ? { linked: true } : { authenticated: true, returnPath: result.returnPath };
    }
}
