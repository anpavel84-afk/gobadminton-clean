import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { hashSecret } from "../auth/crypto";
import { badRequest, commandInProgress, conflict } from "../auth/problem";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** lock_timeout while waiting on UNIQUE reservation conflict (ADR-003). */
export const IDEMPOTENCY_LOCK_TIMEOUT = "3s";
/** statement_timeout bound for mutation transactions. */
export const IDEMPOTENCY_STATEMENT_TIMEOUT = "15s";
/** Max technical DB retries preserving the same key (deadlock / transient). */
export const IDEMPOTENCY_MAX_TECHNICAL_RETRIES = 3;
/** Backoff after technical retry n (1-based): 50ms, 150ms, 350ms. */
export function idempotencyRetryBackoffMs(attempt: number): number {
  if (attempt <= 1) return 50;
  if (attempt === 2) return 150;
  return 350;
}

export type IdempotentResult<T> = {
  replay: boolean;
  statusCode: number;
  body: T;
};

export type ReserveGate<T> =
  | { kind: "execute" }
  | { kind: "replay"; statusCode: number; body: T };

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {
    void this.pool;
  }

  requireKey(raw: string | string[] | undefined): string {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || value.length < 16 || value.length > 128) {
      throw badRequest(
        "IDEMPOTENCY_KEY_INVALID",
        "Idempotency-Key must be 16–128 characters",
      );
    }
    return value;
  }

  keyHash(key: string): string {
    return hashSecret(this.env.AUTH_PEPPER, `idem-key:${key}`);
  }

  requestHash(payload: unknown): string {
    return hashSecret(
      this.env.AUTH_PEPPER,
      `idem-body:${stableStringify(payload)}`,
    );
  }

  /**
   * Insert-first UNIQUE reservation.
   * Winner: INSERT returns a processing row.
   * Concurrent waiter: blocks on UNIQUE until winner commits/rolls back;
   * after commit, ON CONFLICT DO NOTHING then SELECT completed receipt.
   */
  async reserveOrReplay<T>(
    client: PoolClient,
    input: {
      actorId: string;
      operation: string;
      key: string;
      requestHash: string;
    },
  ): Promise<ReserveGate<T>> {
    const keyHash = this.keyHash(input.key);
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO idempotency_records
         (actor_id, operation, key_hash, request_hash, reservation_state,
          status_code, response_body, expires_at)
       VALUES ($1, $2, $3, $4, 'processing', NULL, NULL, $5)
       ON CONFLICT (actor_id, operation, key_hash) DO NOTHING
       RETURNING id`,
      [
        input.actorId,
        input.operation,
        keyHash,
        input.requestHash,
        expiresAt,
      ],
    );
    if (inserted.rows[0]) {
      return { kind: "execute" };
    }

    const receipt = await this.findCompletedReceipt<T>(client, {
      actorId: input.actorId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
    });
    // Never execute without a new reservation if cleanup removed the winner.
    if (!receipt) throw commandInProgress();
    return receipt;
  }

  async complete<T>(
    client: PoolClient,
    input: {
      actorId: string;
      operation: string;
      key: string;
      requestHash: string;
      statusCode: number;
      body: T;
    },
  ): Promise<void> {
    const keyHash = this.keyHash(input.key);
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
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
         AND reservation_state = 'processing'`,
      [
        input.actorId,
        input.operation,
        keyHash,
        input.requestHash,
        input.statusCode,
        JSON.stringify(input.body),
        expiresAt,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new Error(
        "idempotency complete failed: missing processing reservation",
      );
    }
  }

  /**
   * TTL cleanup: delete only expired completed receipts.
   * Never deletes processing rows (active reservations).
   */
  async deleteExpiredCompleted(client: PoolClient): Promise<number> {
    const result = await client.query(
      `DELETE FROM idempotency_records
       WHERE reservation_state = 'completed'
         AND expires_at <= now()`,
    );
    return result.rowCount ?? 0;
  }

  /** Non-reserving preflight; a miss grants no permission to execute. */
  async findCompletedReceipt<T>(
    client: PoolClient,
    input: {
      actorId: string;
      operation: string;
      key: string;
      requestHash: string;
    },
  ): Promise<Extract<ReserveGate<T>, { kind: "replay" }> | undefined> {
    const keyHash = this.keyHash(input.key);
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
      return undefined;
    }
    if (row.reservation_state !== "completed") {
      // Should not be visible after INSERT wait under READ COMMITTED.
      throw commandInProgress();
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query(
        `DELETE FROM idempotency_records
         WHERE actor_id = $1 AND operation = $2 AND key_hash = $3
           AND reservation_state = 'completed'
           AND expires_at <= now()`,
        [input.actorId, input.operation, keyHash],
      );
      throw commandInProgress(
        "Резерв идемпотентности истёк; повторите запрос с тем же ключом",
      );
    }
    if (row.request_hash !== input.requestHash) {
      throw conflict(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key уже использован с другим телом запроса",
      );
    }
    if (row.status_code === null || row.response_body === null) {
      throw new Error("completed idempotency receipt missing status/body");
    }
    return {
      kind: "replay",
      statusCode: row.status_code,
      body: row.response_body,
    };
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      out[key] = sortValue(nested);
    }
    return out;
  }
  return value;
}
