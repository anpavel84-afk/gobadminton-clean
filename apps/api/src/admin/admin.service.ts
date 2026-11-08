import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import {
  hashSecret,
  openSecret,
  pkceChallengeS256,
  randomToken,
  sealSecret,
  secretsEqual,
} from "../auth/crypto";
import {
  badRequest,
  commandInProgress,
  conflict,
  forbidden,
  notFound,
  unauthorized,
  problem,
} from "../auth/problem";
import { AdminProviders } from "./admin-providers";
import { adminTransaction, appendAudit, type AuditActor } from "./admin-db";
import {
  ADMIN_AUDIENCE,
  ADMIN_BINDING_COOKIE,
  ADMIN_COOKIE,
  ADMIN_TICKET_COOKIE,
  hasPermission,
  type AdminPermission,
  type AdminRole,
} from "./rbac";
import type { AdminCommand } from "./dto";

import { devQaKeyAllowed, DEV_QA_AUDIENCE, DEV_QA_LABEL, qaSessionRouteAllowed } from "./dev-qa-policy";

/** Soft marker for in-flight admin external claims — never reclaim / re-prepare after TTL. */
const ADMIN_EXTERNAL_PREPARE_RESERVATION_TTL_MS = 120_000;
/** Unknown sealed outcomes keep attempt history; never TTL-reclaim for a second prepare. */
const ADMIN_EXTERNAL_UNKNOWN_TTL_MS = 24 * 60 * 60 * 1000;

type Principal = {
  id: string;
  user_id: string;
  status: string;
  version: number;
};
type Session = {
  id: string;
  principal_id: string;
  credential_id: string | null;
  auth_method: "webauthn" | "dev_qa_key";
  qa_credential_id: string | null;
  audience: string;
  csrf_ciphertext: string;
  expires_at: Date;
  last_seen_at: Date;
  step_up_at: Date;
  revoked_at: Date | null;
};
export type AdminActor = AuditActor & {
  sessionId: string;
  roles: AdminRole[];
  principal: Principal;
  session: Session;
};
type Ticket = {
  token_hash: string;
  principal_id: string;
  csrf_ciphertext: string;
  expires_at: Date;
  consumed_at: Date | null;
};
type Challenge = {
  id: string;
  principal_id: string;
  ticket_hash: string | null;
  session_id: string | null;
  purpose: "enroll" | "login" | "step_up";
  challenge: string;
};
type Credential = {
  credential_id: string;
  principal_id: string;
  public_key: Buffer;
  sign_count: string;
  transports: AuthenticatorTransport[];
  status: string;
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly providers: AdminProviders,
  ) {}
  enabled() {
    if (!this.env.ADMIN_INTERNAL_ENABLED)
      throw notFound("ADMIN_DISABLED", "Admin internal surface disabled");
  }
  private get pepper() {
    this.enabled();
    return this.env.ADMIN_AUTH_PEPPER!;
  }
  private hash(secret: string) {
    return hashSecret(this.pepper, secret);
  }
  private origin(request: FastifyRequest) {
    this.enabled();
    if (request.headers.origin === this.env.ADMIN_ORIGIN) return;
    // Same-origin browser GETs omit Origin. This one read-only access bootstrap
    // accepts browser-controlled Fetch Metadata plus exact Referer origin;
    // mutations and every other admin route retain the strict Origin requirement.
    if (request.headers.origin === undefined && request.method === "GET"
      && /^\/v1\/admin\/venues\/[0-9a-f-]{36}\/cover\/access$/.test(request.url)
      && request.headers["sec-fetch-site"] === "same-origin") {
      try { if (new URL(String(request.headers.referer ?? "")).origin === this.env.ADMIN_ORIGIN) return; } catch { /* fail closed */ }
    }
    throw forbidden("ADMIN_ORIGIN_REJECTED", "Admin origin required");
  }
  private cookie(
    reply: FastifyReply,
    name: string,
    value: string,
    maxAge: number,
    sameSite: "strict" | "lax" = "strict",
  ) {
    reply.setCookie(name, value, {
      httpOnly: true,
      secure: true,
      sameSite,
      path: "/",
      maxAge,
    });
  }
  private clear(reply: FastifyReply, name: string) {
    this.cookie(reply, name, "", 0);
  }
  private async rate(client: PoolClient, key: string, limit = 60) {
    const result = await client.query<{ attempts: number }>(
      `INSERT INTO admin_rate_windows(key_hash,window_start,attempts) VALUES($1,date_trunc('minute',clock_timestamp()),1)
      ON CONFLICT(key_hash,window_start) DO UPDATE SET attempts=admin_rate_windows.attempts+1 RETURNING attempts`,
      [this.hash(key)],
    );
    return result.rows[0]!.attempts <= limit;
  }
  // Rate consumption is durable even when a following auth/command fails.
  private async limited(request: FastifyRequest) {
    this.enabled();
    const token = request.cookies[ADMIN_COOKIE];
    if (token && token.length >= 32 && token.length <= 256) {
      const method = (await this.pool.query<{auth_method:string}>("SELECT auth_method FROM admin_sessions WHERE token_hash=$1",[this.hash(token)])).rows[0]?.auth_method;
      if (method === "dev_qa_key" && !qaSessionRouteAllowed(request.method,request.url) && request.url !== "/v1/admin/auth/dev-qa-key")
        throw forbidden("ADMIN_PERMISSION_DENIED", "QA session is read-only PilotMetrics");
    }
    const ok = await adminTransaction(this.pool, (c) =>
      this.rate(c, "ip:" + request.ip, 120),
    );
    if (!ok)
      throw problem(429, "ADMIN_RATE_LIMIT", "Admin rate limit", undefined, 60);
  }
  private async roles(client: PoolClient, id: string) {
    return (
      await client.query<{ role: AdminRole }>(
        "SELECT role FROM admin_role_grants WHERE principal_id=$1 AND active=true ORDER BY role",
        [id],
      )
    ).rows.map((r) => r.role);
  }
  private async principal(client: PoolClient, id: string): Promise<Principal> {
    const p = (
      await client.query<Principal>(
        "SELECT * FROM admin_principals WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!p)
      throw unauthorized(
        "ADMIN_UNAUTHENTICATED",
        "Admin authentication required",
      );
    return p;
  }
  private async actor(
    client: PoolClient,
    request: FastifyRequest,
    mutation = false,
    permission?: AdminPermission,
    stepup = false,
  ): Promise<AdminActor> {
    this.origin(request);
    const token = request.cookies[ADMIN_COOKIE];
    if (!token || token.length < 32 || token.length > 256)
      throw unauthorized("ADMIN_UNAUTHENTICATED", "Admin session required");
    const s = (
      await client.query<Session>(
        "SELECT * FROM admin_sessions WHERE token_hash=$1 FOR UPDATE",
        [this.hash(token)],
      )
    ).rows[0];
    if (!s)
      throw unauthorized("ADMIN_UNAUTHENTICATED", "Admin session required");
    const p = await this.principal(client, s.principal_id);
    const roles = await this.roles(client, p.id);
    const now = Date.now();
    if (p.status !== "active" || s.revoked_at || s.expires_at.getTime() <= now || s.last_seen_at.getTime() <= now - 30 * 60_000)
      throw unauthorized("ADMIN_UNAUTHENTICATED", "Admin session inactive");
    if (s.auth_method === "dev_qa_key") {
      if (!devQaKeyAllowed(this.env)) throw unauthorized("ADMIN_UNAUTHENTICATED", "Admin session inactive");
      const qa = (await client.query<{principal_id:string;expires_at:Date;revoked_at:Date|null}>(
        "SELECT principal_id,expires_at,revoked_at FROM admin_dev_qa_credentials WHERE id=$1 FOR UPDATE", [s.qa_credential_id])).rows[0];
      const user = (await client.query<{status:string}>("SELECT status FROM users WHERE id=$1", [p.user_id])).rows[0];
      if (s.audience !== DEV_QA_AUDIENCE || !qa || qa.revoked_at || qa.expires_at.getTime() <= now || qa.principal_id !== p.id || user?.status !== "disabled")
        throw unauthorized("ADMIN_UNAUTHENTICATED", "Admin session inactive");
      if (roles.length !== 1 || roles[0] !== "pilot_viewer" || stepup || !qaSessionRouteAllowed(request.method, request.url))
        throw forbidden("ADMIN_PERMISSION_DENIED", "QA session is read-only PilotMetrics");
    } else {
      const credential = (await client.query<Credential>("SELECT * FROM admin_webauthn_credentials WHERE credential_id=$1 FOR UPDATE", [s.credential_id])).rows[0];
      if (s.auth_method !== "webauthn" || s.audience !== ADMIN_AUDIENCE || credential?.status !== "active" || credential.principal_id !== p.id)
        throw unauthorized("ADMIN_UNAUTHENTICATED", "Admin session inactive");
    }
    if (
      mutation &&
      !secretsEqual(
        openSecret(this.pepper, s.csrf_ciphertext),
        String(request.headers["x-csrf-token"] ?? ""),
      )
    )
      throw forbidden("ADMIN_CSRF_REJECTED", "Admin CSRF required");
    if (permission && !hasPermission(roles, permission))
      throw forbidden("ADMIN_PERMISSION_DENIED", "Admin permission denied");
    if (
      stepup &&
      (s.step_up_at.getTime() > now ||
        s.step_up_at.getTime() <= now - 10 * 60_000)
    )
      throw forbidden(
        "ADMIN_STEP_UP_REQUIRED",
        "Recent Admin step-up required",
      );
    await client.query(
      "UPDATE admin_sessions SET last_seen_at=clock_timestamp() WHERE id=$1",
      [s.id],
    );
    return {
      principalId: p.id,
      sessionId: s.id,
      roles,
      principal: p,
      session: s,
    };
  }
  /** Reuse the A0a current-authority fence for separately admitted domains. */
  async privilegedRead<T>(request: FastifyRequest, permission: AdminPermission,
    read: (client: PoolClient, actor: AdminActor) => Promise<T>, stepup = false): Promise<T> {
    await this.limited(request);
    return adminTransaction(this.pool, async client => {
      const actor = await this.actor(client, request, false, permission, stepup);
      return read(client, actor);
    });
  }
  /** Validate cookie mutation authority before bounded external media preflight. */
  async privilegedMutationPreflight<T>(request: FastifyRequest, permission: AdminPermission,
    read: (client: PoolClient, actor: AdminActor) => Promise<T>): Promise<T> {
    await this.limited(request);
    return adminTransaction(this.pool, async client => {
      const actor = await this.actor(client, request, true, permission, true);
      return read(client, actor);
    });
  }
  async privilegedReplay<T>(request: FastifyRequest, key: string | undefined, permission: AdminPermission,
    operation: string, input: object, scope: (client: PoolClient, actor: AdminActor) => Promise<void>): Promise<T | null> {
    await this.limited(request);
    if (!key || key.length < 16 || key.length > 128) throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    const fingerprint = this.hash(JSON.stringify({operation,input}));
    return adminTransaction(this.pool, async client => {
      const actor = await this.actor(client,request,true,permission,true);
      await scope(client,actor);
      const row = (
        await client.query<{
          fingerprint: string;
          response_ciphertext: string | null;
          reservation_state?: string | null;
        }>(
          "SELECT * FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2",
          [actor.principalId, this.hash(key)],
        )
      ).rows[0];
      if (!row) return null;
      if (row.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key changed");
      const reservationState = adminReceiptReservationState(row);
      if (reservationState === "processing") throw commandInProgress();
      if (reservationState === "unknown") {
        this.throwSealedAdminUnknown(row.response_ciphertext);
      }
      if (reservationState === "error") {
        this.throwSealedAdminKnownReject(row.response_ciphertext);
      }
      if (!row.response_ciphertext) throw commandInProgress();
      return JSON.parse(openSecret(this.pepper,row.response_ciphertext)) as T;
    });
  }
  /**
   * Same-key fence before admin external preparation (classifier / media).
   * authorizeReplayScope always runs (session/RBAC/assignment/independence) before
   * disclosing a receipt. Matching completed/error receipts replay with zero
   * provider I/O and without requiring expectedCaseVersion still current.
   * authorizeNewPublication (version/pending/consent/eligibility) runs only on miss.
   * Known moderation REJECT seals reservation_state=error (real 422; does not imply
   * payment — provider budget via beforeAttempt only). processing/unknown/error
   * never TTL-reclaim into a second prepare.
   * Keeps Admin session/step-up/origin/CSRF/RBAC — does not use consumer ActorFence.
   */
  async privilegedRunWithExternalPrepare<TPrep, T>(
    request: FastifyRequest,
    key: string | undefined,
    permission: AdminPermission,
    stepup: boolean,
    operation: string,
    input: object,
    authorizeReplayScope: (client: PoolClient, actor: AdminActor) => Promise<void>,
    authorizeNewPublication: (client: PoolClient, actor: AdminActor) => Promise<void>,
    prepare: () => Promise<TPrep>,
    execute: (
      client: PoolClient,
      actor: AdminActor,
      keyHash: string,
      prepared: TPrep,
    ) => Promise<T>,
  ): Promise<T> {
    await this.limited(request);
    if (!key || key.length < 16 || key.length > 128) {
      throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    }
    const keyHash = this.hash(key);
    const fingerprint = this.hash(JSON.stringify({ operation, input }));
    const claim = await adminTransaction(this.pool, async (client) => {
      const actor = await this.actor(client, request, true, permission, stepup);
      await authorizeReplayScope(client, actor);
      const previous = (
        await client.query<{
          fingerprint: string;
          response_ciphertext: string | null;
          reservation_state: string;
        }>(
          `SELECT fingerprint, response_ciphertext,
                  COALESCE(reservation_state, 'completed') AS reservation_state
           FROM admin_command_receipts
           WHERE actor_id=$1 AND key_hash=$2`,
          [actor.principalId, keyHash],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key changed");
        }
        if (previous.reservation_state === "processing") throw commandInProgress();
        if (previous.reservation_state === "unknown") {
          this.throwSealedAdminUnknown(previous.response_ciphertext);
        }
        if (previous.reservation_state === "error") {
          this.throwSealedAdminKnownReject(previous.response_ciphertext);
        }
        if (!previous.response_ciphertext) throw commandInProgress();
        return {
          kind: "replay" as const,
          body: JSON.parse(openSecret(this.pepper, previous.response_ciphertext)) as T,
        };
      }
      await authorizeNewPublication(client, actor);
      const claimNonce = randomUUID();
      const expiresAt = new Date(Date.now() + ADMIN_EXTERNAL_PREPARE_RESERVATION_TTL_MS);
      const inserted = await client.query<{ actor_id: string }>(
        `INSERT INTO admin_command_receipts
           (actor_id, key_hash, fingerprint, response_ciphertext,
            reservation_state, claim_nonce, expires_at)
         VALUES ($1,$2,$3,NULL,'processing',$4,$5)
         ON CONFLICT (actor_id, key_hash) DO NOTHING
         RETURNING actor_id`,
        [actor.principalId, keyHash, fingerprint, claimNonce, expiresAt],
      );
      if (!inserted.rows[0]) throw commandInProgress();
      return {
        kind: "prepare" as const,
        claimNonce,
        principalId: actor.principalId,
      };
    });
    if (claim.kind === "replay") return claim.body;

    let prepared: TPrep;
    try {
      prepared = await prepare();
    } catch (error) {
      await this.afterAdminExternalPrepareFailure(
        claim.principalId,
        keyHash,
        fingerprint,
        claim.claimNonce,
        error,
      );
      throw error;
    }

    try {
      return await adminTransaction(this.pool, async (client) => {
        const actor = await this.actor(client, request, true, permission, stepup);
        const locked = (
          await client.query<{ actor_id: string }>(
            `SELECT actor_id FROM admin_command_receipts
             WHERE actor_id=$1 AND key_hash=$2 AND fingerprint=$3
               AND claim_nonce=$4 AND reservation_state='processing'
             FOR UPDATE`,
            [actor.principalId, keyHash, fingerprint, claim.claimNonce],
          )
        ).rows[0];
        if (!locked) throw commandInProgress();
        const result = await execute(client, actor, keyHash, prepared);
        const updated = await client.query(
          `UPDATE admin_command_receipts
           SET reservation_state='completed',
               response_ciphertext=$4,
               expires_at=NULL
           WHERE actor_id=$1 AND key_hash=$2 AND claim_nonce=$3
             AND reservation_state='processing'`,
          [
            actor.principalId,
            keyHash,
            claim.claimNonce,
            sealSecret(this.pepper, JSON.stringify(result)),
          ],
        );
        if (updated.rowCount !== 1) {
          throw new Error("admin external prepare complete failed: missing processing reservation");
        }
        return result;
      });
    } catch (error) {
      await this.afterAdminExternalPrepareFailure(
        claim.principalId,
        keyHash,
        fingerprint,
        claim.claimNonce,
        error,
      );
      throw error;
    }
  }
  private throwSealedAdminUnknown(responseCiphertext: string | null): never {
    if (!responseCiphertext) throw commandInProgress();
    const body = JSON.parse(openSecret(this.pepper, responseCiphertext)) as {
      status?: number;
    };
    const status =
      typeof body.status === "number" ? body.status : HttpStatus.SERVICE_UNAVAILABLE;
    throw new HttpException(body, status);
  }
  private throwSealedAdminKnownReject(responseCiphertext: string | null): never {
    if (!responseCiphertext) throw commandInProgress();
    const body = JSON.parse(openSecret(this.pepper, responseCiphertext)) as {
      status?: number;
      code?: string;
    };
    const status =
      typeof body.status === "number" ? body.status : HttpStatus.UNPROCESSABLE_ENTITY;
    // Known moderation reject — never return Problem JSON as typed success.
    throw new HttpException(body, status);
  }
  private async afterAdminExternalPrepareFailure(
    principalId: string,
    keyHash: string,
    fingerprint: string,
    claimNonce: string,
    error: unknown,
  ): Promise<void> {
    if (isAdminKnownModerationReject(error)) {
      await this.sealAdminExternalKnownReject(
        principalId,
        keyHash,
        fingerprint,
        claimNonce,
        error,
      ).catch(() => undefined);
      return;
    }
    if (shouldReleaseAdminExternalPrepareClaim(error)) {
      await this.pool
        .query(
          `DELETE FROM admin_command_receipts
           WHERE actor_id=$1 AND key_hash=$2 AND fingerprint=$3
             AND claim_nonce=$4 AND reservation_state='processing'`,
          [principalId, keyHash, fingerprint, claimNonce],
        )
        .catch(() => undefined);
      return;
    }
    if (isAdminServiceUnavailable(error)) {
      await this.sealAdminExternalUnknown(
        principalId,
        keyHash,
        fingerprint,
        claimNonce,
        error,
      ).catch(() => undefined);
    }
    // Ambiguous non-HTTP / CIP: leave processing; never reclaim after soft TTL.
  }
  private async sealAdminExternalKnownReject(
    principalId: string,
    keyHash: string,
    fingerprint: string,
    claimNonce: string,
    error: unknown,
  ): Promise<void> {
    const httpStatus =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.UNPROCESSABLE_ENTITY;
    const response =
      error instanceof HttpException
        ? error.getResponse()
        : {
            type: "about:blank",
            title: "Измените текст и попробуйте снова",
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            code: "PUBLIC_TEXT_CONTENT_REJECTED",
          };
    const body =
      typeof response === "object" && response !== null
        ? { ...(response as Record<string, unknown>), status: httpStatus }
        : { status: httpStatus, detail: response };
    await this.pool.query(
      `UPDATE admin_command_receipts
       SET reservation_state='error',
           response_ciphertext=$5,
           expires_at=NULL
       WHERE actor_id=$1 AND key_hash=$2 AND fingerprint=$3
         AND claim_nonce=$4 AND reservation_state='processing'`,
      [
        principalId,
        keyHash,
        fingerprint,
        claimNonce,
        sealSecret(this.pepper, JSON.stringify(body)),
      ],
    );
  }
  private async sealAdminExternalUnknown(
    principalId: string,
    keyHash: string,
    fingerprint: string,
    claimNonce: string,
    error: unknown,
  ): Promise<void> {
    const httpStatus =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.SERVICE_UNAVAILABLE;
    const response =
      error instanceof HttpException
        ? error.getResponse()
        : {
            type: "about:blank",
            title: "Временно недоступно",
            status: HttpStatus.SERVICE_UNAVAILABLE,
            code: "MODERATION_TEMPORARILY_UNAVAILABLE",
          };
    const body =
      typeof response === "object" && response !== null
        ? { ...(response as Record<string, unknown>), status: httpStatus }
        : { status: httpStatus, detail: response };
    const expiresAt = new Date(Date.now() + ADMIN_EXTERNAL_UNKNOWN_TTL_MS);
    await this.pool.query(
      `UPDATE admin_command_receipts
       SET reservation_state='unknown',
           response_ciphertext=$5,
           expires_at=$6
       WHERE actor_id=$1 AND key_hash=$2 AND fingerprint=$3
         AND claim_nonce=$4 AND reservation_state='processing'`,
      [
        principalId,
        keyHash,
        fingerprint,
        claimNonce,
        sealSecret(this.pepper, JSON.stringify(body)),
        expiresAt,
      ],
    );
  }
  async privilegedCommand<T>(request: FastifyRequest, key: string | undefined,
    permission: AdminPermission, stepup: boolean, operation: string, input: object,
    execute: (client: PoolClient, actor: AdminActor, keyHash: string) => Promise<T>,
    authorizeScope?: (client: PoolClient, actor: AdminActor) => Promise<void>): Promise<T> {
    await this.limited(request);
    if (!key || key.length < 16 || key.length > 128)
      throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    const keyHash = this.hash(key), fingerprint = this.hash(JSON.stringify({ operation, input }));
    return adminTransaction(this.pool, async client => {
      const actor = await this.actor(client, request, true, permission, stepup);
      await authorizeScope?.(client, actor);
      const previous = (
        await client.query<{
          fingerprint: string;
          response_ciphertext: string | null;
          reservation_state?: string | null;
        }>(
          "SELECT * FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2",
          [actor.principalId, keyHash],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key changed");
        const reservationState = adminReceiptReservationState(previous);
        if (reservationState === "processing") throw commandInProgress();
        if (reservationState === "unknown") {
          this.throwSealedAdminUnknown(previous.response_ciphertext);
        }
        if (reservationState === "error") {
          this.throwSealedAdminKnownReject(previous.response_ciphertext);
        }
        if (!previous.response_ciphertext) throw commandInProgress();
        return JSON.parse(openSecret(this.pepper, previous.response_ciphertext)) as T;
      }
      const result = await execute(client, actor, keyHash);
      // Ordinary completed receipt: omit 0063 columns (DEFAULT completed on 63; N-1 compatible).
      await client.query(
        `INSERT INTO admin_command_receipts
           (actor_id,key_hash,fingerprint,response_ciphertext)
         VALUES($1,$2,$3,$4)`,
        [actor.principalId,keyHash,fingerprint,sealSecret(this.pepper,JSON.stringify(result))]);
      return result;
    });
  }
  private async ticket(
    client: PoolClient,
    request: FastifyRequest,
  ): Promise<{ ticket: Ticket; principal: Principal }> {
    this.origin(request);
    const token = request.cookies[ADMIN_TICKET_COOKIE];
    if (!token || token.length < 32 || token.length > 256)
      throw unauthorized("ADMIN_MFA_REQUIRED", "Admin MFA ticket required");
    const t = (
      await client.query<Ticket>(
        "SELECT * FROM admin_mfa_tickets WHERE token_hash=$1 FOR UPDATE",
        [this.hash(token)],
      )
    ).rows[0];
    if (!t || t.consumed_at || t.expires_at.getTime() <= Date.now())
      throw unauthorized("ADMIN_MFA_REQUIRED", "Admin MFA ticket expired");
    if (
      !secretsEqual(
        openSecret(this.pepper, t.csrf_ciphertext),
        String(request.headers["x-csrf-token"] ?? ""),
      )
    )
      throw forbidden("ADMIN_CSRF_REJECTED", "Admin CSRF required");
    const p = await this.principal(client, t.principal_id);
    if (!["active", "pending_mfa"].includes(p.status))
      throw unauthorized(
        "ADMIN_PRINCIPAL_INACTIVE",
        "Admin principal inactive",
      );
    return { ticket: t, principal: p };
  }
  private async activation(
    client: PoolClient,
    principalId: string,
    token?: string,
  ) {
    if (!token)
      throw forbidden("ADMIN_ACTIVATION_REQUIRED", "Activation required");
    const row = (
      await client.query(
        "SELECT 1 FROM admin_activation_tokens WHERE principal_id=$1 AND token_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",
        [principalId, this.hash(token)],
      )
    ).rows[0];
    if (!row)
      throw forbidden(
        "ADMIN_ACTIVATION_REQUIRED",
        "Activation expired or invalid",
      );
  }
  async start(provider: string, request: FastifyRequest, reply: FastifyReply) {
    this.origin(request);
    await this.limited(request);
    const { adapter, redirectUri } = this.providers.get(provider);
    const state = randomToken(32),
      binding = randomToken(32),
      verifier = randomToken(48);
    const { authorizationUrl } = await adapter.startAuthorization({
      state,
      codeChallenge: pkceChallengeS256(verifier),
      redirectUri,
    });
    await this.pool.query(
      "INSERT INTO admin_auth_transactions(state_hash,provider_key,binding_hash,verifier_ciphertext,redirect_uri) VALUES($1,$2,$3,$4,$5)",
      [
        this.hash(state),
        provider,
        this.hash(binding),
        sealSecret(this.pepper, verifier),
        redirectUri,
      ],
    );
    this.cookie(reply, ADMIN_BINDING_COOKIE, binding, 600, "lax");
    return { authorizationUrl };
  }
  async callback(
    provider: string,
    query: Record<string, string | undefined>,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    this.enabled();
    await this.limited(request);
    const { adapter, redirectUri } = this.providers.get(provider);
    if (
      !query.state ||
      !query.code ||
      query.state.length > 256 ||
      query.code.length > 4096
    )
      throw badRequest("ADMIN_AUTH_INVALID", "Invalid Admin callback");
    const binding = request.cookies[ADMIN_BINDING_COOKIE];
    // Consume before provider exchange; retry/replay never obtains a new ticket.
    const tx = await adminTransaction(this.pool, async (c) => {
      const row = (
        await c.query<{
          verifier_ciphertext: string;
          redirect_uri: string;
          binding_hash: string;
        }>(
          "UPDATE admin_auth_transactions SET consumed_at=clock_timestamp() WHERE state_hash=$1 AND provider_key=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING *",
          [this.hash(query.state!), provider],
        )
      ).rows[0];
      return row;
    });
    this.clear(reply, ADMIN_BINDING_COOKIE);
    if (
      !tx ||
      !binding ||
      !secretsEqual(tx.binding_hash, this.hash(binding)) ||
      tx.redirect_uri !== redirectUri
    )
      throw unauthorized("ADMIN_AUTH_INVALID", "Admin auth binding invalid");
    const tokens = await adapter.exchangeCode({
      code: query.code,
      codeVerifier: openSecret(this.pepper, tx.verifier_ciphertext),
      redirectUri,
      state: query.state,
      deviceId: query.device_id,
    });
    const identity = await adapter.fetchVerifiedIdentity(tokens);
    if (identity.provider !== provider)
      throw unauthorized("ADMIN_AUTH_INVALID", "Admin identity invalid");
    const token = randomToken(32),
      csrf = randomToken(32);
    const summary = await adminTransaction(this.pool, async (c) => {
      // Resolve existing identity only, never trust email, consumer cookie or supplied user ID.
      const p = (
        await c.query<Principal>(
          `SELECT p.* FROM admin_principals p JOIN external_identities e ON e.user_id=p.user_id JOIN users u ON u.id=p.user_id
        WHERE e.provider_key=$1 AND e.issuer_namespace=$2 AND e.subject=$3 AND u.status='active' FOR UPDATE OF p`,
          [provider, identity.issuerNamespace, identity.subject],
        )
      ).rows[0];
      if (!p || !["active", "pending_mfa"].includes(p.status))
        throw unauthorized(
          "ADMIN_PRINCIPAL_REQUIRED",
          "Preexisting Admin principal required",
        );
      await c.query(
        "INSERT INTO admin_mfa_tickets(token_hash,principal_id,csrf_ciphertext) VALUES($1,$2,$3)",
        [this.hash(token), p.id, sealSecret(this.pepper, csrf)],
      );
      await appendAudit(c, {
        actor: { principalId: p.id, roles: await this.roles(c, p.id) },
        action: "admin.identity_verified",
        targetType: "admin_principal",
        targetId: p.id,
        permission: "session.self",
        reason: "provider_login",
      });
      return { principalId: p.id, status: p.status, csrfToken: csrf };
    });
    this.cookie(reply, ADMIN_TICKET_COOKIE, token, 600);
    return summary;
  }
  async options(
    input: {
      purpose: "enroll" | "login" | "step_up";
      activationToken?: string;
    },
    request: FastifyRequest,
  ) {
    this.origin(request);
    await this.limited(request);
    return adminTransaction(this.pool, async (c) => {
      let principal: Principal,
        ticketHash: string | null = null,
        sessionId: string | null = null;
      if (input.purpose === "step_up") {
        const a = await this.actor(c, request, true);
        principal = a.principal;
        sessionId = a.sessionId;
      } else {
        const t = await this.ticket(c, request);
        principal = t.principal;
        ticketHash = t.ticket.token_hash;
      }
      const credentials = (
        await c.query<Credential>(
          "SELECT * FROM admin_webauthn_credentials WHERE principal_id=$1 AND status='active'",
          [principal.id],
        )
      ).rows;
      if (input.purpose === "enroll") {
        if (principal.status !== "pending_mfa" || credentials.length)
          throw conflict(
            "ADMIN_ENROLLMENT_NOT_PENDING",
            "Enrollment is not pending",
          );
        await this.activation(c, principal.id, input.activationToken);
      } else if (principal.status !== "active" || !credentials.length)
        throw unauthorized(
          "ADMIN_MFA_REQUIRED",
          "Active WebAuthn credential required",
        );
      const options =
        input.purpose === "enroll"
          ? await generateRegistrationOptions({
              rpName: "GoBadminton Admin",
              rpID: new URL(this.env.ADMIN_ORIGIN).hostname,
              userID: Buffer.from(principal.id),
              userName: principal.id,
              attestationType: "none",
              authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "required",
              },
            })
          : await generateAuthenticationOptions({
              rpID: new URL(this.env.ADMIN_ORIGIN).hostname,
              userVerification: "required",
              allowCredentials: credentials.map((x) => ({
                id: x.credential_id,
                transports: x.transports,
              })),
            });
      const id = (
        await c.query<{ id: string }>(
          "INSERT INTO admin_webauthn_challenges(principal_id,ticket_hash,session_id,purpose,challenge) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            principal.id,
            ticketHash,
            sessionId,
            input.purpose,
            options.challenge,
          ],
        )
      ).rows[0]!.id;
      return { challengeId: id, options };
    });
  }
  async verify(
    input: {
      challengeId: string;
      response: Record<string, unknown>;
      activationToken?: string;
    },
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    this.origin(request);
    await this.limited(request);
    // Challenge consumption has its own committed transaction so a bad cryptographic response burns it.
    const challenge = await adminTransaction(this.pool, async (c) => {
      const row = (
        await c.query<Challenge>(
          "SELECT * FROM admin_webauthn_challenges WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE",
          [input.challengeId],
        )
      ).rows[0];
      if (!row)
        throw unauthorized(
          "ADMIN_CHALLENGE_INVALID",
          "Challenge expired or consumed",
        );
      if (row.purpose === "step_up") {
        const a = await this.actor(c, request, true);
        if (
          a.sessionId !== row.session_id ||
          a.principalId !== row.principal_id
        )
          throw forbidden(
            "ADMIN_CHALLENGE_BINDING",
            "Challenge binding rejected",
          );
      } else {
        const t = await this.ticket(c, request);
        if (
          t.ticket.token_hash !== row.ticket_hash ||
          t.principal.id !== row.principal_id
        )
          throw forbidden(
            "ADMIN_CHALLENGE_BINDING",
            "Challenge binding rejected",
          );
      }
      await c.query(
        "UPDATE admin_webauthn_challenges SET consumed_at=clock_timestamp() WHERE id=$1",
        [row.id],
      );
      return row;
    });
    const result = await adminTransaction(this.pool, async (c) => {
      let principal: Principal, actor: AuditActor;
      if (challenge.purpose === "step_up") {
        const a = await this.actor(c, request, true);
        if (a.sessionId !== challenge.session_id)
          throw forbidden(
            "ADMIN_CHALLENGE_BINDING",
            "Challenge binding rejected",
          );
        principal = a.principal;
        actor = a;
      } else {
        const t = await this.ticket(c, request);
        if (t.ticket.token_hash !== challenge.ticket_hash)
          throw forbidden(
            "ADMIN_CHALLENGE_BINDING",
            "Challenge binding rejected",
          );
        principal = t.principal;
        actor = {
          principalId: principal.id,
          roles: await this.roles(c, principal.id),
        };
      }
      let credentialId: string;
      if (challenge.purpose === "enroll") {
        if (principal.status !== "pending_mfa")
          throw conflict(
            "ADMIN_ENROLLMENT_NOT_PENDING",
            "Enrollment is not pending",
          );
        await this.activation(c, principal.id, input.activationToken);
        let verification;
        try {
          verification = await verifyRegistrationResponse({
            response: input.response as unknown as RegistrationResponseJSON,
            expectedChallenge: challenge.challenge,
            expectedOrigin: this.env.ADMIN_ORIGIN,
            expectedRPID: new URL(this.env.ADMIN_ORIGIN).hostname,
            requireUserVerification: true,
          });
        } catch {
          throw unauthorized(
            "ADMIN_WEBAUTHN_INVALID",
            "WebAuthn verification failed",
          );
        }
        if (!verification.verified || !verification.registrationInfo)
          throw unauthorized(
            "ADMIN_WEBAUTHN_INVALID",
            "WebAuthn verification failed",
          );
        const credential = verification.registrationInfo.credential;
        credentialId = credential.id;
        await c.query(
          "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key,sign_count,transports) VALUES($1,$2,$3,$4,$5)",
          [
            credential.id,
            principal.id,
            Buffer.from(credential.publicKey),
            credential.counter,
            JSON.stringify(credential.transports ?? []),
          ],
        );
        await c.query(
          "UPDATE admin_principals SET status='active',version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [principal.id],
        );
        await c.query(
          "UPDATE admin_activation_tokens SET consumed_at=clock_timestamp() WHERE principal_id=$1",
          [principal.id],
        );
        await appendAudit(c, {
          actor,
          action: "admin.mfa_enrolled",
          targetType: "admin_principal",
          targetId: principal.id,
          permission: "session.self",
          reason: "activation",
          before: { status: "pending_mfa" },
          after: { status: "active" },
        });
        // Registration enables the credential. Only a subsequent signed assertion
        // may mint an active session, even when attestation format is `none`.
        return { mfaEnrolled: true };
      } else {
        const credential = (
          await c.query<Credential>(
            "SELECT * FROM admin_webauthn_credentials WHERE credential_id=$1 AND principal_id=$2 AND status='active' FOR UPDATE",
            [
              typeof input.response.id === "string" ? input.response.id : "",
              principal.id,
            ],
          )
        ).rows[0];
        if (principal.status !== "active" || !credential)
          throw unauthorized(
            "ADMIN_WEBAUTHN_INVALID",
            "WebAuthn verification failed",
          );
        credentialId = credential.credential_id;
        let verification;
        try {
          verification = await verifyAuthenticationResponse({
            response: input.response as unknown as AuthenticationResponseJSON,
            expectedChallenge: challenge.challenge,
            expectedOrigin: this.env.ADMIN_ORIGIN,
            expectedRPID: new URL(this.env.ADMIN_ORIGIN).hostname,
            requireUserVerification: true,
            credential: {
              id: credential.credential_id,
              publicKey: new Uint8Array(credential.public_key),
              counter: Number(credential.sign_count),
              transports: credential.transports,
            },
          });
        } catch {
          throw unauthorized(
            "ADMIN_WEBAUTHN_INVALID",
            "WebAuthn verification failed",
          );
        }
        if (!verification.verified)
          throw unauthorized(
            "ADMIN_WEBAUTHN_INVALID",
            "WebAuthn verification failed",
          );
        await c.query(
          "UPDATE admin_webauthn_credentials SET sign_count=$1 WHERE credential_id=$2",
          [verification.authenticationInfo.newCounter, credentialId],
        );
      }
      if (challenge.purpose === "step_up") {
        await c.query(
          "UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE id=$1",
          [challenge.session_id],
        );
        await appendAudit(c, {
          actor,
          action: "admin.step_up",
          targetType: "admin_session",
          targetId: challenge.session_id!,
          permission: "session.self",
          reason: "webauthn",
        });
        return { stepUp: true };
      }
      const token = randomToken(32),
        csrf = randomToken(32);
      const s = (
        await c.query<{ id: string }>(
          "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
          [
            principal.id,
            credentialId,
            this.hash(token),
            sealSecret(this.pepper, csrf),
          ],
        )
      ).rows[0]!;
      await c.query(
        "UPDATE admin_mfa_tickets SET consumed_at=clock_timestamp() WHERE token_hash=$1",
        [challenge.ticket_hash],
      );
      await appendAudit(c, {
        actor: { ...actor, sessionId: s.id },
        action: "admin.session_created",
        targetType: "admin_session",
        targetId: s.id,
        permission: "session.self",
        reason: "webauthn",
      });
      return {
        sessionToken: token,
        csrfToken: csrf,
        principalId: principal.id,
      };
    });
    if ("sessionToken" in result && result.sessionToken) {
      this.cookie(reply, ADMIN_COOKIE, result.sessionToken, 8 * 3600);
      this.clear(reply, ADMIN_TICKET_COOKIE);
      return { principalId: result.principalId, csrfToken: result.csrfToken };
    }
    return result;
  }
  assertDevQaEnabled() {
    if (!devQaKeyAllowed(this.env)) throw notFound("ADMIN_QA_DISABLED", "QA login unavailable");
  }
  async devQaLogin(request: FastifyRequest, reply: FastifyReply, input: {key:string;requestNonce:string}) {
    this.assertDevQaEnabled();
    this.origin(request);
    if (request.url.includes("?") || !String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"))
      throw badRequest("ADMIN_INVALID_REQUEST", "JSON body required");
    if (!secretsEqual(String(request.headers["x-csrf-token"] ?? ""), input.requestNonce))
      throw forbidden("ADMIN_CSRF_REJECTED", "QA request nonce header required");
    await this.limited(request);
    const allowed = await adminTransaction(this.pool, async c => {
      const ip = await this.rate(c, "dev-qa-ip:" + request.ip, 5);
      const global = await this.rate(c, "dev-qa-global", 60);
      return ip && global;
    });
    if (!allowed) throw problem(429, "ADMIN_RATE_LIMIT", "Admin rate limit", undefined, 60);
    const result = await adminTransaction(this.pool, async c => {
      const qa = (await c.query<{id:string;principal_id:string;key_hash:string;expires_at:Date}>(
        "SELECT * FROM admin_dev_qa_credentials WHERE label=$1 AND revoked_at IS NULL FOR UPDATE", [DEV_QA_LABEL])).rows[0];
      const valid = secretsEqual(this.hash("admin-dev-qa-key:" + input.key), qa?.key_hash ?? this.hash("admin-dev-qa-key:missing"));
      if (!valid || !qa || qa.expires_at.getTime() <= Date.now()) return null;
      const principal = await this.principal(c, qa.principal_id);
      const roles = await this.roles(c, principal.id);
      const user = (await c.query<{status:string}>("SELECT status FROM users WHERE id=$1", [principal.user_id])).rows[0];
      if (principal.status !== "active" || roles.length !== 1 || roles[0] !== "pilot_viewer" || user?.status !== "disabled") return null;
      const nonce = await c.query("INSERT INTO admin_dev_qa_nonces(credential_id,nonce_hash,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce_hash",
        [qa.id, this.hash("admin-dev-qa-nonce:" + input.requestNonce), qa.expires_at]);
      if (!nonce.rowCount) return null;
      const token = randomToken(32), csrf = randomToken(32);
      const session = (await c.query<{id:string;expires_at:Date}>(`WITH stamp AS (SELECT clock_timestamp() AS at)
        INSERT INTO admin_sessions(principal_id,credential_id,auth_method,qa_credential_id,audience,token_hash,csrf_ciphertext,created_at,expires_at)
        SELECT $1,NULL,'dev_qa_key',$2,$3,$4,$5,at,LEAST(at+interval '15 minutes',$6::timestamptz) FROM stamp RETURNING id,expires_at`,
        [principal.id,qa.id,DEV_QA_AUDIENCE,this.hash(token),sealSecret(this.pepper,csrf),qa.expires_at])).rows[0]!;
      await appendAudit(c,{actor:{principalId:principal.id,sessionId:session.id,roles},action:"admin.dev_qa_login",targetType:"admin_dev_qa_credential",targetId:qa.id,permission:"pilot.read",reason:"dev_qa_key"});
      return {token,csrf,principalId:principal.id,maxAge:Math.max(1,Math.floor((session.expires_at.getTime()-Date.now())/1000))};
    });
    if (!result) throw unauthorized("ADMIN_QA_KEY_INVALID", "QA login rejected");
    this.cookie(reply, ADMIN_COOKIE, result.token, result.maxAge);
    return {principalId:result.principalId,csrfToken:result.csrf};
  }
  async me(request: FastifyRequest) {
    await this.limited(request);
    return adminTransaction(this.pool, async (c) => {
      const a = await this.actor(c, request);
      return {
        principalId: a.principalId,
        userId: a.principal.user_id,
        status: a.principal.status,
        version: a.principal.version,
        roles: a.roles,
        sessionId: a.sessionId,
        authMethod: a.session.auth_method,
        expiresAt: a.session.expires_at.toISOString(),
        stepUpAt: a.session.step_up_at.toISOString(),
        csrfToken: openSecret(this.pepper, a.session.csrf_ciphertext),
      };
    });
  }
  async logout(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string | undefined,
  ) {
    await this.limited(request);
    if (!key || key.length < 16 || key.length > 128)
      throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    await adminTransaction(this.pool, async (c) => {
      const a = await this.actor(c, request, true);
      await c.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
        [a.sessionId],
      );
      await appendAudit(c, {
        actor: a,
        action: "admin.logout",
        targetType: "admin_session",
        targetId: a.sessionId,
        permission: "session.self",
        reason: "own_logout",
        keyHash: this.hash(key),
      });
    });
    this.clear(reply, ADMIN_COOKIE);
  }
  async command(
    input: AdminCommand,
    key: string | undefined,
    request: FastifyRequest,
  ) {
    await this.limited(request);
    if (!key || key.length < 16 || key.length > 128)
      throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    const keyHash = this.hash(key),
      fingerprint = this.hash(JSON.stringify(input));
    return adminTransaction(this.pool, async (c) => {
      const a = await this.actor(c, request, true, "identity.manage", true);
      const previous = (
        await c.query<{
          fingerprint: string;
          response_ciphertext: string | null;
          reservation_state?: string | null;
        }>(
          "SELECT * FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2",
          [a.principalId, keyHash],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key changed");
        const reservationState = adminReceiptReservationState(previous);
        if (reservationState === "processing") throw commandInProgress();
        if (reservationState === "unknown") {
          this.throwSealedAdminUnknown(previous.response_ciphertext);
        }
        if (reservationState === "error") {
          this.throwSealedAdminKnownReject(previous.response_ciphertext);
        }
        if (!previous.response_ciphertext) throw commandInProgress();
        return JSON.parse(
          openSecret(this.pepper, previous.response_ciphertext),
        ) as Record<string, unknown>;
      }
      let target: Principal,
        result: Record<string, unknown>,
        before: object = {},
        after: object = {};
      if (input.action === "create_principal") {
        if (
          !(
            await c.query(
              "SELECT 1 FROM users WHERE id=$1 AND status='active'",
              [input.userId],
            )
          ).rowCount
        )
          throw notFound(
            "ADMIN_USER_NOT_FOUND",
            "Existing active user required",
          );
        if (
          (
            await c.query("SELECT 1 FROM admin_principals WHERE user_id=$1", [
              input.userId,
            ])
          ).rowCount
        )
          throw conflict("ADMIN_PRINCIPAL_EXISTS", "Principal already exists");
        target = (
          await c.query<Principal>(
            "INSERT INTO admin_principals(user_id) VALUES($1) RETURNING *",
            [input.userId],
          )
        ).rows[0]!;
        const token = randomToken(32);
        await c.query(
          "INSERT INTO admin_activation_tokens(principal_id,token_hash) VALUES($1,$2)",
          [target.id, this.hash(token)],
        );
        result = {
          principalId: target.id,
          status: target.status,
          version: target.version,
          activationToken: token,
        };
        after = { status: target.status };
      } else {
        target = await this.principal(c, input.principalId);
        if (target.version !== input.expectedVersion)
          throw conflict("ADMIN_VERSION_CONFLICT", "Admin version changed");
        if (target.status === "revoked")
          throw conflict("ADMIN_PRINCIPAL_REVOKED", "Principal revoked");
        // Preserve the last active MFA-capable Superadmin. No silent lockout.
        if (
          (input.action === "role" &&
            input.role === "superadmin" &&
            !input.active) ||
          input.action === "status" ||
          input.action === "recover_mfa" ||
          input.action === "revoke_credential"
        ) {
          const supers = (
            await c.query<{
              id: string;
            }>(`SELECT DISTINCT p.id FROM admin_principals p JOIN admin_role_grants g ON g.principal_id=p.id AND g.role='superadmin' AND g.active
            WHERE p.status='active' AND EXISTS(SELECT 1 FROM admin_webauthn_credentials w WHERE w.principal_id=p.id AND w.status='active')`)
          ).rows;
          if (supers.length === 1 && supers[0]!.id === target.id) {
            const remaining =
              input.action === "revoke_credential"
                ? (
                    await c.query(
                      "SELECT 1 FROM admin_webauthn_credentials WHERE principal_id=$1 AND credential_id<>$2 AND status='active'",
                      [target.id, input.credentialId],
                    )
                  ).rowCount
                : 0;
            if (!remaining)
              throw conflict(
                "ADMIN_LAST_SUPERADMIN",
                "Cannot remove last active Superadmin",
              );
          }
        }
        if (input.action === "role") {
          const current = (
            await c.query<{ active: boolean }>(
              "SELECT active FROM admin_role_grants WHERE principal_id=$1 AND role=$2",
              [target.id, input.role],
            )
          ).rows[0];
          before = { role: input.role, active: current?.active ?? false };
          after = { role: input.role, active: input.active };
          await c.query(
            `INSERT INTO admin_role_grants(principal_id,role,active,actor_id,reason_code) VALUES($1,$2,$3,$4,$5)
            ON CONFLICT(principal_id,role) DO UPDATE SET active=EXCLUDED.active,actor_id=EXCLUDED.actor_id,reason_code=EXCLUDED.reason_code,updated_at=clock_timestamp()`,
            [
              target.id,
              input.role,
              input.active,
              a.principalId,
              input.reasonCode,
            ],
          );
        } else if (input.action === "status") {
          before = { status: target.status };
          after = { status: input.status };
          await c.query("UPDATE admin_principals SET status=$2 WHERE id=$1", [
            target.id,
            input.status,
          ]);
          await c.query(
            "UPDATE admin_webauthn_credentials SET status='revoked' WHERE principal_id=$1",
            [target.id],
          );
        } else if (input.action === "recover_mfa") {
          before = { status: target.status };
          after = { status: "pending_mfa", credentialsRevoked: true };
          const token = randomToken(32);
          await c.query(
            "UPDATE admin_webauthn_credentials SET status='revoked' WHERE principal_id=$1",
            [target.id],
          );
          await c.query(
            "UPDATE admin_principals SET status='pending_mfa' WHERE id=$1",
            [target.id],
          );
          await c.query(
            `INSERT INTO admin_activation_tokens(principal_id,token_hash) VALUES($1,$2)
            ON CONFLICT(principal_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=clock_timestamp()+interval '30 minutes',consumed_at=NULL`,
            [target.id, this.hash(token)],
          );
          result = { activationToken: token };
        } else if (input.action === "revoke_credential") {
          if (
            !(
              await c.query(
                "UPDATE admin_webauthn_credentials SET status='revoked' WHERE principal_id=$1 AND credential_id=$2 RETURNING credential_id",
                [target.id, input.credentialId],
              )
            ).rowCount
          )
            throw notFound(
              "ADMIN_CREDENTIAL_NOT_FOUND",
              "Credential not found",
            );
          after = { credentialRevoked: true };
        } else {
          after = { sessionsRevoked: true };
        }
        // Role change invalidates freshness; principal/credential/session revoke destroys sessions.
        if (input.action === "role")
          await c.query(
            "UPDATE admin_sessions SET step_up_at=created_at-interval '1 day' WHERE principal_id=$1 AND revoked_at IS NULL",
            [target.id],
          );
        else
          await c.query(
            "UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE principal_id=$1",
            [target.id],
          );
        await c.query(
          "UPDATE admin_principals SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [target.id],
        );
        result = {
          ...(input.action === "recover_mfa" ? result! : {}),
          principalId: target.id,
          version: target.version + 1,
        };
      }
      await appendAudit(c, {
        actor: a,
        action: "admin." + input.action,
        targetType: "admin_principal",
        targetId: target.id,
        permission: "identity.manage",
        reason: input.reasonCode,
        before,
        after,
        keyHash,
      });
      await c.query(
        `INSERT INTO admin_command_receipts
           (actor_id,key_hash,fingerprint,response_ciphertext)
         VALUES($1,$2,$3,$4)`,
        [
          a.principalId,
          keyHash,
          fingerprint,
          sealSecret(this.pepper, JSON.stringify(result)),
        ],
      );
      return result;
    });
  }
  async principals(request: FastifyRequest) {
    await this.limited(request);
    return adminTransaction(this.pool, async (c) => {
      await this.actor(c, request, false, "identity.manage");
      return {
        items: (
          await c.query(`SELECT p.id,p.user_id,p.status,p.version,COALESCE(array_agg(g.role ORDER BY g.role) FILTER(WHERE g.active),'{}') AS roles
        FROM admin_principals p LEFT JOIN admin_role_grants g ON g.principal_id=p.id GROUP BY p.id ORDER BY p.created_at DESC,p.id LIMIT 100`)
        ).rows,
      };
    });
  }
  async audit(request: FastifyRequest) {
    await this.limited(request);
    return adminTransaction(this.pool, async (c) => {
      const a = await this.actor(
        c,
        request,
        false,
        "audit.security.read",
        true,
      );
      await appendAudit(c, {
        actor: a,
        action: "admin.audit_read",
        targetType: "privileged_audit",
        targetId: "security_recent",
        permission: "audit.security.read",
        reason: "security_review",
      });
      return {
        items: (
          await c.query(
            "SELECT * FROM privileged_audit_events ORDER BY created_at DESC,id LIMIT 100",
          )
        ).rows,
      };
    });
  }

  /**
   * D2 — bounded metadata-only moderation history (saved allow/review approvals + bindings).
   * Reuses audit.security.read + fresh step-up. Never returns raw text/URL/images/scores/fingerprints.
   * Not append-only attempt history; missing reject/temp/budget rows are not fabricated.
   */
  async moderationAudit(
    request: FastifyRequest,
    query: {
      surface?: string;
      decision?: "allow" | "review";
      policy?: string;
      model?: string;
      checkedFrom?: string;
      checkedTo?: string;
      beforeCheckedAt?: string;
      beforeId?: string;
      limit: number;
    },
  ) {
    return this.privilegedRead(
      request,
      "audit.security.read",
      async (c, a) => {
        await appendAudit(c, {
          actor: a,
          action: "admin.moderation_audit_read",
          targetType: "content_moderation_approvals",
          targetId: "bounded_metadata",
          permission: "audit.security.read",
          reason: "security_review",
          after: {
            surface: query.surface ?? null,
            decision: query.decision ?? null,
            policy: query.policy ?? null,
            model: query.model ?? null,
            limit: query.limit,
          },
        });
        const params: unknown[] = [
          query.surface ?? null,
          query.decision ?? null,
          query.policy ?? null,
          query.model ?? null,
          query.checkedFrom ?? null,
          query.checkedTo ?? null,
          query.beforeCheckedAt ?? null,
          query.beforeId ?? null,
          query.limit + 1,
        ];
        type ApprovalRow = {
          id: string;
          surface_key: string;
          decision: string;
          provider_key: string;
          provider_model: string;
          policy_version: string;
          local_policy_version: string;
          checked_at: Date;
        };
        const approvals = await c.query<ApprovalRow>(
          `SELECT a.id, a.surface_key, a.decision, a.provider_key, a.provider_model,
                  a.policy_version, a.local_policy_version, a.checked_at
             FROM content_moderation_approvals a
            WHERE a.decision IN ('allow','review')
              AND ($1::text IS NULL OR a.surface_key = $1)
              AND ($2::text IS NULL OR a.decision = $2)
              AND ($3::text IS NULL OR a.policy_version = $3 OR a.local_policy_version = $3)
              AND ($4::text IS NULL OR a.provider_model = $4)
              AND ($5::timestamptz IS NULL OR a.checked_at >= $5::timestamptz)
              AND ($6::timestamptz IS NULL OR a.checked_at <= $6::timestamptz)
              AND (
                $7::timestamptz IS NULL OR $8::uuid IS NULL
                OR (a.checked_at, a.id) < ($7::timestamptz, $8::uuid)
              )
            ORDER BY a.checked_at DESC, a.id DESC
            LIMIT $9`,
          params,
        );
        const page = approvals.rows.slice(0, query.limit);
        const next = approvals.rows.length > query.limit ? approvals.rows[query.limit]! : null;
        const ids = page.map((row) => row.id);
        type BindingRow = {
          id: string;
          approval_id: string;
          entity_kind: string;
          entity_id: string;
          surface_key: string;
          resource_version: number;
          binding_kind: string;
          role_reputation_decision_id: string | null;
          venue_review_decision_id: string | null;
          created_at: Date;
        };
        const bindings =
          ids.length === 0
            ? { rows: [] as BindingRow[] }
            : await c.query<BindingRow>(
                `SELECT b.id, b.approval_id, b.entity_kind, b.entity_id, b.surface_key,
                        b.resource_version, b.binding_kind,
                        b.role_reputation_decision_id, b.venue_review_decision_id, b.created_at
                   FROM content_moderation_bindings b
                  WHERE b.approval_id = ANY($1::uuid[])
                  ORDER BY b.approval_id, b.created_at DESC, b.id DESC`,
                [ids],
              );
        const byApproval = new Map<string, BindingRow[]>();
        for (const binding of bindings.rows) {
          const list = byApproval.get(binding.approval_id) ?? [];
          // Bound nested bindings per approval — no unlimited join expansion.
          if (list.length >= 20) continue;
          list.push(binding);
          byApproval.set(binding.approval_id, list);
        }
        return {
          historyScope: "saved_allow_review_only" as const,
          historyNote:
            "Сохранённые allow/review approvals и связанные bindings. Отклонённые/временные попытки и бюджеты не входят в этот журнал.",
          items: page.map((row) => {
            const bound = byApproval.get(row.id) ?? [];
            return {
              approvalId: row.id,
              surface: row.surface_key,
              decision: row.decision,
              providerKey: row.provider_key,
              providerModel: row.provider_model,
              policyVersion: row.policy_version,
              localPolicyVersion: row.local_policy_version,
              checkedAt: row.checked_at.toISOString(),
              bindingStatus: bound.length > 0 ? ("bound" as const) : ("unbound_or_legacy" as const),
              bindings: bound.map((b) => ({
                bindingId: b.id,
                entityKind: b.entity_kind,
                entityId: b.entity_id,
                surface: b.surface_key,
                resourceVersion: b.resource_version,
                bindingKind: b.binding_kind,
                roleReputationDecisionId: b.role_reputation_decision_id,
                venueReviewDecisionId: b.venue_review_decision_id,
                createdAt: b.created_at.toISOString(),
              })),
            };
          }),
          nextBeforeCheckedAt: next ? next.checked_at.toISOString() : null,
          nextBeforeId: next ? next.id : null,
        };
      },
      true,
    );
  }
}

function adminHttpExceptionCode(error: unknown): string {
  if (!(error instanceof HttpException)) return "";
  const response = error.getResponse();
  if (typeof response === "object" && response && "code" in response) {
    return String((response as { code?: unknown }).code ?? "");
  }
  return "";
}

/**
 * Pre-63 admin_command_receipts lack reservation_state (always completed +
 * non-null ciphertext). Absent/null → historical completed only. Present
 * processing/unknown/error keep exact deny/replay — never coalesce to success.
 */
export function adminReceiptReservationState(row: {
  reservation_state?: string | null;
}): string {
  if (row.reservation_state == null) return "completed";
  return row.reservation_state;
}

/**
 * Immutable known moderation REJECT for one exact admin key — durable error receipt.
 * Local or provider origin; sealing stores the real 422 and never implies payment.
 * Provider budget is counted only via beforeAttempt; local-result path = 0.
 */
export function isAdminKnownModerationReject(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    error.getStatus() === HttpStatus.UNPROCESSABLE_ENTITY &&
    adminHttpExceptionCode(error) === "PUBLIC_TEXT_CONTENT_REJECTED"
  );
}

/** Ordinary validation/auth/budget 4xx/429 release; known moderation REJECT does not. */
export function shouldReleaseAdminExternalPrepareClaim(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  if (isAdminKnownModerationReject(error)) return false;
  const status = error.getStatus();
  if (status === HttpStatus.SERVICE_UNAVAILABLE) return false;
  if (status === HttpStatus.CONFLICT) {
    const code = adminHttpExceptionCode(error);
    if (code === "COMMAND_IN_PROGRESS") return false;
    // Domain VERSION_CONFLICT / KEY_REUSED after prepare: release so a new key can proceed.
    return true;
  }
  // Ordinary validation / authz / budget 429 (not a known moderation decision): release.
  return status >= 400 && status < 500;
}

function isAdminServiceUnavailable(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE
  );
}
