import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
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

type Principal = {
  id: string;
  user_id: string;
  status: string;
  version: number;
};
type Session = {
  id: string;
  principal_id: string;
  credential_id: string;
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
    const credential = (
      await client.query<Credential>(
        "SELECT * FROM admin_webauthn_credentials WHERE credential_id=$1 FOR UPDATE",
        [s.credential_id],
      )
    ).rows[0];
    const now = Date.now();
    if (
      p.status !== "active" ||
      s.audience !== ADMIN_AUDIENCE ||
      s.revoked_at ||
      s.expires_at.getTime() <= now ||
      s.last_seen_at.getTime() <= now - 30 * 60_000 ||
      credential?.status !== "active" ||
      credential.principal_id !== p.id
    )
      throw unauthorized("ADMIN_UNAUTHENTICATED", "Admin session inactive");
    if (
      mutation &&
      !secretsEqual(
        openSecret(this.pepper, s.csrf_ciphertext),
        String(request.headers["x-csrf-token"] ?? ""),
      )
    )
      throw forbidden("ADMIN_CSRF_REJECTED", "Admin CSRF required");
    const roles = await this.roles(client, p.id);
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
    return adminTransaction(this.pool, async client => {
      const actor = await this.actor(client,request,true,permission,true);
      await scope(client,actor);
      const row = (await client.query<{fingerprint:string;response_ciphertext:string}>(
        "SELECT * FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2",[actor.principalId,this.hash(key)])).rows[0];
      if (!row) return null;
      if (row.fingerprint !== this.hash(JSON.stringify({operation,input}))) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key changed");
      return JSON.parse(openSecret(this.pepper,row.response_ciphertext)) as T;
    });
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
      const previous = (await client.query<{fingerprint: string; response_ciphertext: string}>(
        "SELECT * FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2", [actor.principalId,keyHash])).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key changed");
        return JSON.parse(openSecret(this.pepper, previous.response_ciphertext)) as T;
      }
      const result = await execute(client, actor, keyHash);
      await client.query("INSERT INTO admin_command_receipts(actor_id,key_hash,fingerprint,response_ciphertext) VALUES($1,$2,$3,$4)",
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
        await c.query<{ fingerprint: string; response_ciphertext: string }>(
          "SELECT * FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2",
          [a.principalId, keyHash],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key changed");
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
        "INSERT INTO admin_command_receipts(actor_id,key_hash,fingerprint,response_ciphertext) VALUES($1,$2,$3,$4)",
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
}
