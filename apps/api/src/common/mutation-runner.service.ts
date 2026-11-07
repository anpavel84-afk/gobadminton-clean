import { assertCapabilities, operationCapabilities, type UserCapability } from "../restrictions/policy";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { commandInProgress, conflict } from "../auth/problem";
import { DATABASE_POOL } from "../tokens";
import { ActorFenceService } from "./actor-fence.service";
import {
  IDEMPOTENCY_LOCK_TIMEOUT,
  IDEMPOTENCY_MAX_TECHNICAL_RETRIES,
  IDEMPOTENCY_STATEMENT_TIMEOUT,
  IdempotencyService,
  idempotencyRetryBackoffMs,
} from "./idempotency.service";

/** Soft window marker for in-flight external claims (observability only — never reclaim). */
const EXTERNAL_PREPARE_RESERVATION_TTL_MS = 120_000;
/** Completed receipt TTL — matches IdempotencyService complete(). */
const IDEMPOTENCY_COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
/** Sealed unknown outcomes retain history; no automatic same-key provider replay. */
const EXTERNAL_UNKNOWN_TTL_MS = IDEMPOTENCY_COMPLETED_TTL_MS;

export type MutationResult<T> = {
  statusCode: number;
  body: T;
};

type MutationInput<T> = {
  actorId: string;
  sessionId: string;
  operation: string;
  key: string;
  requestHash: string;
  requiredCapabilities?: readonly UserCapability[];
  authorizeReplay: (client: PoolClient, body: T) => Promise<void>;
  execute: (client: PoolClient) => Promise<MutationResult<T>>;
};

type ExternalPrepareInput<TPrep, T> = {
  actorId: string;
  sessionId: string;
  operation: string;
  key: string;
  requestHash: string;
  requiredCapabilities?: readonly UserCapability[];
  authorizeReplay: (client: PoolClient, body: T) => Promise<void>;
  /** Runs only after durable same-key claim; must not hold DB locks across awaits. */
  prepare: () => Promise<TPrep>;
  execute: (client: PoolClient, prepared: TPrep) => Promise<MutationResult<T>>;
};

/**
 * Shared mutation transaction protocol:
 * BEGIN → timeouts → actor/session fence → insert-first idempotency
 * → (authorizeReplay | execute) → complete → COMMIT.
 * Game/Participation locking remains inside execute/authorizeReplay.
 *
 * External-prepare path claims a durable processing row with an opaque
 * claim_nonce, runs prepare outside any transaction, then completes or
 * releases only under that exact owner token. Ambiguous/503 provider
 * outcomes seal reservation_state=unknown (no TTL reclaim / provider replay).
 * Known moderation PUBLIC_TEXT_CONTENT_REJECTED (local or provider) seals a
 * durable completed 422 receipt — stores the real 422, does not imply a paid
 * external attempt; provider budget is measured only by beforeAttempt counters.
 * Same-key replay returns the sealed problem with zero prepare. Ordinary
 * validation/auth/budget 4xx/429 release the claim. Concurrent same-key workers
 * see COMMAND_IN_PROGRESS / KEY_REUSED before provider I/O. Multi-instance
 * authority is the Postgres UNIQUE row.
 */
@Injectable()
export class MutationRunner {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly actorFence: ActorFenceService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /**
   * Short authorized preflight before external preparation. A miss finishes
   * without reserving anything; final execution must still use runIdempotent.
   */
  async findReplay<T>(input: Omit<MutationInput<T>, "execute">): Promise<MutationResult<T> | undefined> {
    return this.withRetries(() => this.runOnce(input, true));
  }

  async runIdempotent<T>(input: MutationInput<T>): Promise<MutationResult<T>> {
    return this.withRetries(() => this.runOnce(input, false));
  }

  /**
   * Same-key fence before external preparation. At most one worker prepares;
   * losers get COMMAND_IN_PROGRESS or KEY_REUSED without provider I/O. Known
   * moderation REJECT seals a durable 422; ordinary validation 4xx/429 release
   * the claim; 503 seals unknown so same-key retries never blindly repeat an
   * ambiguous provider effect.
   */
  async runWithExternalPrepare<TPrep, T>(
    input: ExternalPrepareInput<TPrep, T>,
  ): Promise<MutationResult<T>> {
    const claim = await this.withRetries(() => this.claimExternalOnce(input));
    if (claim.kind === "replay") {
      return claim.result;
    }

    const claimNonce = claim.claimNonce;
    let prepared: TPrep;
    try {
      prepared = await input.prepare();
    } catch (error) {
      await this.afterExternalPrepareFailure(input, claimNonce, error);
      throw error;
    }

    try {
      return await this.withRetries(() =>
        this.completeExternalOnce(input, prepared, claimNonce),
      );
    } catch (error) {
      await this.afterExternalPrepareFailure(input, claimNonce, error);
      throw error;
    }
  }

  private async afterExternalPrepareFailure(
    input: {
      actorId: string;
      operation: string;
      key: string;
      requestHash: string;
    },
    claimNonce: string,
    error: unknown,
  ): Promise<void> {
    if (isKnownModerationReject(error)) {
      await this.sealExternalKnownReject(input, claimNonce, error).catch(() => undefined);
      return;
    }
    if (shouldReleaseExternalPrepareClaim(error)) {
      await this.releaseExternalClaim(input, claimNonce).catch(() => undefined);
      return;
    }
    if (isServiceUnavailable(error)) {
      await this.sealExternalUnknown(input, claimNonce, error).catch(() => undefined);
    }
    // Ambiguous non-HTTP / CIP: leave processing; never reclaim after TTL.
  }

  private async withRetries<T>(run: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 1;
      attempt <= IDEMPOTENCY_MAX_TECHNICAL_RETRIES;
      attempt += 1
    ) {
      try {
        return await run();
      } catch (error) {
        lastError = error;
        if (error instanceof HttpException) {
          throw error;
        }
        if (isLockTimeout(error)) {
          if (attempt < IDEMPOTENCY_MAX_TECHNICAL_RETRIES) {
            await sleep(idempotencyRetryBackoffMs(attempt));
            continue;
          }
          throw commandInProgress();
        }
        if (
          isRetryableDbError(error) &&
          attempt < IDEMPOTENCY_MAX_TECHNICAL_RETRIES
        ) {
          await sleep(idempotencyRetryBackoffMs(attempt));
          continue;
        }
        if (isUniqueViolation(error)) {
          // Should be absorbed by ON CONFLICT; never leak as 500.
          if (attempt < IDEMPOTENCY_MAX_TECHNICAL_RETRIES) {
            await sleep(idempotencyRetryBackoffMs(attempt));
            continue;
          }
          throw commandInProgress();
        }
        throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("mutation retries exhausted");
  }

  private async runOnce<T>(input: Omit<MutationInput<T>, "execute">, preflight: true): Promise<MutationResult<T> | undefined>;
  private async runOnce<T>(input: MutationInput<T>, preflight: false): Promise<MutationResult<T>>;
  private async runOnce<T>(input: Omit<MutationInput<T>, "execute"> & Partial<Pick<MutationInput<T>, "execute">>, preflight: boolean): Promise<MutationResult<T> | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${IDEMPOTENCY_LOCK_TIMEOUT}'`);
      await client.query(
        `SET LOCAL statement_timeout = '${IDEMPOTENCY_STATEMENT_TIMEOUT}'`,
      );
      await this.actorFence.assertActiveConsumerInTransaction(client, {
        actorId: input.actorId,
        sessionId: input.sessionId,
      });
      await assertCapabilities(client, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, input.actorId,
        [...operationCapabilities(input.operation), ...(input.requiredCapabilities ?? [])]);
      const receiptInput = {
        actorId: input.actorId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
      };
      const gate = preflight
        ? await this.idempotency.findCompletedReceipt<T>(client, receiptInput)
        : await this.idempotency.reserveOrReplay<T>(client, receiptInput);
      if (gate?.kind === "replay") {
        // Pass server-stored body so create-style commands can reauthorize
        // against the exact resource without trusting client input.
        await input.authorizeReplay(client, gate.body);
        await client.query("COMMIT");
        return { statusCode: gate.statusCode, body: gate.body };
      }
      if (preflight) {
        await client.query("COMMIT");
        return undefined;
      }
      const result = await input.execute!(client);
      await this.idempotency.complete(client, {
        actorId: input.actorId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        statusCode: result.statusCode,
        body: result.body,
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async claimExternalOnce<TPrep, T>(
    input: ExternalPrepareInput<TPrep, T>,
  ): Promise<
    | { kind: "prepare"; claimNonce: string }
    | { kind: "replay"; result: MutationResult<T> }
  > {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${IDEMPOTENCY_LOCK_TIMEOUT}'`);
      await client.query(
        `SET LOCAL statement_timeout = '${IDEMPOTENCY_STATEMENT_TIMEOUT}'`,
      );
      await this.actorFence.assertActiveConsumerInTransaction(client, {
        actorId: input.actorId,
        sessionId: input.sessionId,
      });
      await assertCapabilities(
        client,
        this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
        input.actorId,
        [...operationCapabilities(input.operation), ...(input.requiredCapabilities ?? [])],
      );

      const keyHash = this.idempotency.keyHash(input.key);
      const claimNonce = randomUUID();
      const expiresAt = new Date(Date.now() + EXTERNAL_PREPARE_RESERVATION_TTL_MS);

      // Reclaim only expired successful COMPLETED receipts — never processing,
      // unknown, or durable known-reject (status_code >= 400) error history.
      await client.query(
        `DELETE FROM idempotency_records
         WHERE actor_id = $1 AND operation = $2 AND key_hash = $3
           AND reservation_state = 'completed'
           AND expires_at <= now()
           AND COALESCE(status_code, 200) < 400`,
        [input.actorId, input.operation, keyHash],
      );

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO idempotency_records
           (actor_id, operation, key_hash, request_hash, reservation_state,
            status_code, response_body, claim_nonce, expires_at)
         VALUES ($1, $2, $3, $4, 'processing', NULL, NULL, $5, $6)
         ON CONFLICT (actor_id, operation, key_hash) DO NOTHING
         RETURNING id`,
        [
          input.actorId,
          input.operation,
          keyHash,
          input.requestHash,
          claimNonce,
          expiresAt,
        ],
      );
      if (inserted.rows[0]) {
        await client.query("COMMIT");
        return { kind: "prepare", claimNonce };
      }

      const existing = await client.query<{
        request_hash: string;
        status_code: number | null;
        response_body: T | null;
        expires_at: Date;
        reservation_state: string;
      }>(
        `SELECT request_hash, status_code, response_body, expires_at, reservation_state
         FROM idempotency_records
         WHERE actor_id = $1 AND operation = $2 AND key_hash = $3`,
        [input.actorId, input.operation, keyHash],
      );
      const row = existing.rows[0];
      if (!row) {
        throw commandInProgress();
      }
      if (row.request_hash !== input.requestHash) {
        throw conflict(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency-Key уже использован с другим телом запроса",
        );
      }
      if (row.reservation_state === "processing") {
        // Expired processing is still authoritative — do not reclaim / re-prepare.
        throw commandInProgress();
      }
      if (row.reservation_state === "unknown") {
        // Sealed ambiguous outcome: conservative non-publishing replay.
        throw replaySealedUnknown(row.status_code, row.response_body);
      }
      if (row.expires_at.getTime() <= Date.now()) {
        // Expired completed — delete and reclaim in a follow-up retry.
        // Known moderation error (4xx) receipts must not TTL-reclaim into a second prepare.
        if (row.status_code != null && row.status_code >= 400) {
          await input.authorizeReplay(client, undefined as unknown as T);
          await client.query("COMMIT");
          throw replaySealedKnownReject(row.status_code, row.response_body);
        }
        await client.query(
          `DELETE FROM idempotency_records
           WHERE actor_id = $1 AND operation = $2 AND key_hash = $3
             AND reservation_state = 'completed'
             AND expires_at <= now()
             AND COALESCE(status_code, 200) < 400`,
          [input.actorId, input.operation, keyHash],
        );
        await client.query("COMMIT");
        throw commandInProgress();
      }
      if (row.status_code === null || row.response_body === null) {
        throw new Error("completed idempotency receipt missing status/body");
      }
      // Known moderation reject receipt: reauthorize by request resource IDs only —
      // never pass Problem JSON as typed success or return 200+Problem.
      if (row.status_code >= 400) {
        await input.authorizeReplay(client, undefined as unknown as T);
        await client.query("COMMIT");
        throw replaySealedKnownReject(row.status_code, row.response_body);
      }
      await input.authorizeReplay(client, row.response_body);
      await client.query("COMMIT");
      return {
        kind: "replay",
        result: { statusCode: row.status_code, body: row.response_body },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async completeExternalOnce<TPrep, T>(
    input: ExternalPrepareInput<TPrep, T>,
    prepared: TPrep,
    claimNonce: string,
  ): Promise<MutationResult<T>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL lock_timeout = '${IDEMPOTENCY_LOCK_TIMEOUT}'`);
      await client.query(
        `SET LOCAL statement_timeout = '${IDEMPOTENCY_STATEMENT_TIMEOUT}'`,
      );
      await this.actorFence.assertActiveConsumerInTransaction(client, {
        actorId: input.actorId,
        sessionId: input.sessionId,
      });
      await assertCapabilities(
        client,
        this.env.USER_RESTRICTIONS_INTERNAL_ENABLED,
        input.actorId,
        [...operationCapabilities(input.operation), ...(input.requiredCapabilities ?? [])],
      );

      const keyHash = this.idempotency.keyHash(input.key);
      // Owner fencing: exact claim_nonce. Late original may complete after the
      // soft TTL marker; wrong-owner / replacement claims cannot finalize.
      const locked = await client.query<{ id: string }>(
        `SELECT id FROM idempotency_records
         WHERE actor_id = $1 AND operation = $2 AND key_hash = $3
           AND request_hash = $4
           AND claim_nonce = $5
           AND reservation_state = 'processing'
         FOR UPDATE`,
        [input.actorId, input.operation, keyHash, input.requestHash, claimNonce],
      );
      if (!locked.rows[0]) {
        throw commandInProgress();
      }

      const result = await input.execute(client, prepared);
      const completedExpires = new Date(Date.now() + IDEMPOTENCY_COMPLETED_TTL_MS);
      const updated = await client.query(
        `UPDATE idempotency_records
         SET reservation_state = 'completed',
             request_hash = $4,
             status_code = $5,
             response_body = $6::jsonb,
             expires_at = $7
         WHERE actor_id = $1
           AND operation = $2
           AND key_hash = $3
           AND claim_nonce = $8
           AND reservation_state = 'processing'`,
        [
          input.actorId,
          input.operation,
          keyHash,
          input.requestHash,
          result.statusCode,
          JSON.stringify(result.body),
          completedExpires,
          claimNonce,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error("idempotency complete failed: missing processing reservation");
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseExternalClaim(
    input: {
      actorId: string;
      operation: string;
      key: string;
      requestHash: string;
    },
    claimNonce: string,
  ): Promise<void> {
    const keyHash = this.idempotency.keyHash(input.key);
    await this.pool.query(
      `DELETE FROM idempotency_records
       WHERE actor_id = $1 AND operation = $2 AND key_hash = $3
         AND request_hash = $4
         AND claim_nonce = $5
         AND reservation_state = 'processing'`,
      [input.actorId, input.operation, keyHash, input.requestHash, claimNonce],
    );
  }

  private async sealExternalKnownReject(
    input: {
      actorId: string;
      operation: string;
      key: string;
      requestHash: string;
    },
    claimNonce: string,
    error: unknown,
  ): Promise<void> {
    const keyHash = this.idempotency.keyHash(input.key);
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.UNPROCESSABLE_ENTITY;
    const body =
      error instanceof HttpException
        ? error.getResponse()
        : {
            type: "about:blank",
            title: "Измените текст и попробуйте снова",
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            code: "PUBLIC_TEXT_CONTENT_REJECTED",
          };
    // Durable completed error receipt — same-key replay returns exact 422, no prepare.
    // Does not imply payment; long TTL; do not reclaim like ordinary success after expiry.
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_COMPLETED_TTL_MS);
    await this.pool.query(
      `UPDATE idempotency_records
       SET reservation_state = 'completed',
           status_code = $5,
           response_body = $6::jsonb,
           expires_at = $7
       WHERE actor_id = $1
         AND operation = $2
         AND key_hash = $3
         AND request_hash = $4
         AND claim_nonce = $8
         AND reservation_state = 'processing'`,
      [
        input.actorId,
        input.operation,
        keyHash,
        input.requestHash,
        status,
        JSON.stringify(body),
        expiresAt,
        claimNonce,
      ],
    );
  }

  private async sealExternalUnknown(
    input: {
      actorId: string;
      operation: string;
      key: string;
      requestHash: string;
    },
    claimNonce: string,
    error: unknown,
  ): Promise<void> {
    const keyHash = this.idempotency.keyHash(input.key);
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.SERVICE_UNAVAILABLE;
    const body =
      error instanceof HttpException
        ? error.getResponse()
        : {
            type: "about:blank",
            title: "Временно недоступно",
            status: HttpStatus.SERVICE_UNAVAILABLE,
            code: "MODERATION_TEMPORARILY_UNAVAILABLE",
          };
    const expiresAt = new Date(Date.now() + EXTERNAL_UNKNOWN_TTL_MS);
    await this.pool.query(
      `UPDATE idempotency_records
       SET reservation_state = 'unknown',
           status_code = $5,
           response_body = $6::jsonb,
           expires_at = $7
       WHERE actor_id = $1
         AND operation = $2
         AND key_hash = $3
         AND request_hash = $4
         AND claim_nonce = $8
         AND reservation_state = 'processing'`,
      [
        input.actorId,
        input.operation,
        keyHash,
        input.requestHash,
        status,
        JSON.stringify(body),
        expiresAt,
        claimNonce,
      ],
    );
  }
}

function httpExceptionCode(error: unknown): string {
  if (!(error instanceof HttpException)) return "";
  const response = error.getResponse();
  if (typeof response === "object" && response && "code" in response) {
    return String((response as { code?: unknown }).code ?? "");
  }
  return "";
}

/**
 * Immutable known moderation REJECT for one exact key — durable 422 receipt.
 * Local or provider origin; sealing never implies external payment/attempt.
 * Provider budget is counted only via beforeAttempt; local-result path = 0.
 */
function isKnownModerationReject(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    error.getStatus() === HttpStatus.UNPROCESSABLE_ENTITY &&
    httpExceptionCode(error) === "PUBLIC_TEXT_CONTENT_REJECTED"
  );
}

function shouldReleaseExternalPrepareClaim(error: unknown): boolean {
  if (!(error instanceof HttpException)) {
    // Ambiguous non-HTTP failure after prepare may follow a provider attempt —
    // keep the durable claim until explicit owner release or unknown seal.
    return false;
  }
  if (isKnownModerationReject(error)) return false;
  const status = error.getStatus();
  if (
    status === HttpStatus.SERVICE_UNAVAILABLE ||
    status === HttpStatus.CONFLICT
  ) {
    // 503: unknown/unavailable provider outcome. CONFLICT includes
    // COMMAND_IN_PROGRESS (keep) and domain conflicts released below via code.
    const code = httpExceptionCode(error);
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return false;
    if (code === "COMMAND_IN_PROGRESS") return false;
    // VERSION_CONFLICT / other domain 409 after prepare: release so a new key can proceed.
    return true;
  }
  // Ordinary validation / authz / budget 429 (not a known moderation decision): release.
  return status >= 400 && status < 500;
}

function isServiceUnavailable(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE
  );
}

function replaySealedUnknown(
  statusCode: number | null,
  responseBody: unknown,
): HttpException {
  if (statusCode != null && responseBody != null) {
    return new HttpException(responseBody, statusCode);
  }
  return commandInProgress();
}

function replaySealedKnownReject(
  statusCode: number,
  responseBody: unknown,
): HttpException {
  if (responseBody != null) {
    return new HttpException(responseBody, statusCode);
  }
  return new HttpException(
    {
      type: "about:blank",
      title: "Измените текст и попробуйте снова",
      status: statusCode,
      code: "PUBLIC_TEXT_CONTENT_REJECTED",
    },
    statusCode,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pgCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function isLockTimeout(error: unknown): boolean {
  return pgCode(error) === "55P03";
}

function isRetryableDbError(error: unknown): boolean {
  const code = pgCode(error);
  return code === "40001" || code === "40P01";
}

function isUniqueViolation(error: unknown): boolean {
  return pgCode(error) === "23505";
}
