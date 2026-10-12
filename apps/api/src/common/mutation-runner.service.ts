import { assertCapabilities, operationCapabilities, type UserCapability } from "../restrictions/policy";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { HttpException, Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { commandInProgress } from "../auth/problem";
import { DATABASE_POOL } from "../tokens";
import { ActorFenceService } from "./actor-fence.service";
import {
  IDEMPOTENCY_LOCK_TIMEOUT,
  IDEMPOTENCY_MAX_TECHNICAL_RETRIES,
  IDEMPOTENCY_STATEMENT_TIMEOUT,
  IdempotencyService,
  idempotencyRetryBackoffMs,
} from "./idempotency.service";

export type MutationResult<T> = {
  statusCode: number;
  body: T;
};

/**
 * Shared mutation transaction protocol:
 * BEGIN → timeouts → actor/session fence → insert-first idempotency
 * → (authorizeReplay | execute) → complete → COMMIT.
 * Game/Participation locking remains inside execute/authorizeReplay.
 */
@Injectable()
export class MutationRunner {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly actorFence: ActorFenceService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async runIdempotent<T>(input: {
    actorId: string;
    sessionId: string;
    operation: string;
    key: string;
    requestHash: string;
    requiredCapabilities?: readonly UserCapability[];
    authorizeReplay: (client: PoolClient, body: T) => Promise<void>;
    execute: (client: PoolClient) => Promise<MutationResult<T>>;
  }): Promise<MutationResult<T>> {
    let lastError: unknown;
    for (
      let attempt = 1;
      attempt <= IDEMPOTENCY_MAX_TECHNICAL_RETRIES;
      attempt += 1
    ) {
      try {
        return await this.runOnce(input);
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

  private async runOnce<T>(input: {
    actorId: string;
    sessionId: string;
    operation: string;
    key: string;
    requestHash: string;
    requiredCapabilities?: readonly UserCapability[];
    authorizeReplay: (client: PoolClient, body: T) => Promise<void>;
    execute: (client: PoolClient) => Promise<MutationResult<T>>;
  }): Promise<MutationResult<T>> {
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
      const gate = await this.idempotency.reserveOrReplay<T>(client, {
        actorId: input.actorId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
      });
      if (gate.kind === "replay") {
        // Pass server-stored body so create-style commands can reauthorize
        // against the exact resource without trusting client input.
        await input.authorizeReplay(client, gate.body);
        await client.query("COMMIT");
        return { statusCode: gate.statusCode, body: gate.body };
      }
      const result = await input.execute(client);
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
