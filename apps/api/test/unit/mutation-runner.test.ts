import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { IdempotencyService } from "../../src/common/idempotency.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { loadEnv } from "../../src/config/env";
import { unauthorized } from "../../src/auth/problem";

const env = loadEnv({
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1/synthetic",
  PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
  PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3001",
  AUTH_PEPPER: "mutation-runner-unit-pepper-only!!!!",
});

const actor = { userId: "10000000-0000-4000-8000-000000000001", sessionId: "10000000-0000-4000-8000-000000000002" };

describe("MutationRunner.runWithExternalPrepare", () => {
  it("claims once, runs prepare outside txn, completes; concurrent same-hash sees processing CIP", async () => {
    const rows = new Map<string, {
      request_hash: string;
      reservation_state: string;
      status_code: number | null;
      response_body: unknown;
      expires_at: Date;
    }>();
    let inTxn = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN") {
        inTxn = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") {
        inTxn = false;
        return { rows: [], rowCount: 0 };
      }
      if (sql === "ROLLBACK") {
        inTxn = false;
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SET LOCAL")) return { rows: [], rowCount: 0 };
      if (sql.includes("DELETE FROM idempotency_records") && sql.includes("expires_at <= now()")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO idempotency_records")) {
        const keyHash = String(params![2]);
        const requestHash = String(params![3]);
        if (rows.has(keyHash)) return { rows: [], rowCount: 0 };
        rows.set(keyHash, {
          request_hash: requestHash,
          reservation_state: "processing",
          status_code: null,
          response_body: null,
          expires_at: new Date(Date.now() + 60_000),
        });
        return { rows: [{ id: "claim-1" }], rowCount: 1 };
      }
      if (sql.includes("FROM idempotency_records") && sql.includes("FOR UPDATE")) {
        const keyHash = String(params![2]);
        const requestHash = String(params![3]);
        const row = rows.get(keyHash);
        if (
          row &&
          row.reservation_state === "processing" &&
          row.request_hash === requestHash &&
          row.expires_at.getTime() > Date.now()
        ) {
          return { rows: [{ id: "claim-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("UPDATE idempotency_records") && sql.includes("completed")) {
        const keyHash = String(params![2]);
        const row = rows.get(keyHash);
        if (!row || row.reservation_state !== "processing") return { rows: [], rowCount: 0 };
        row.reservation_state = "completed";
        row.request_hash = String(params![3]);
        row.status_code = Number(params![4]);
        row.response_body = JSON.parse(String(params![5]));
        row.expires_at = params![6] as Date;
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM idempotency_records")) {
        const keyHash = String(params![2]);
        const row = rows.get(keyHash);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("DELETE FROM idempotency_records") && sql.includes("processing")) {
        const keyHash = String(params![2]);
        rows.delete(keyHash);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: async () => client, query } as unknown as Pool;
    const fence = {
      assertActiveConsumerInTransaction: vi.fn(async () => undefined),
    };
    const runner = new MutationRunner(
      pool,
      new IdempotencyService(pool, env),
      fence as unknown as ActorFenceService,
      env,
    );

    let prepareCalls = 0;
    let releasePrepare!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });

    const input = {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      operation: "comments.create",
      key: "unit-external-prepare-key",
      requestHash: "hash-same",
      authorizeReplay: vi.fn(async () => undefined),
      prepare: async () => {
        prepareCalls += 1;
        await gate;
        return { approval: true };
      },
      execute: async (_client: PoolClient, prepared: { approval: boolean }) => {
        expect(prepared.approval).toBe(true);
        expect(inTxn).toBe(true);
        return { statusCode: 201, body: { id: "comment-1" } };
      },
    };

    const winner = runner.runWithExternalPrepare(input);
    for (let i = 0; i < 50 && prepareCalls === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(prepareCalls).toBe(1);

    await expect(
      runner.runWithExternalPrepare({
        ...input,
        prepare: async () => {
          prepareCalls += 1;
          return { approval: true };
        },
        execute: async () => ({ statusCode: 201, body: { id: "should-not" } }),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(prepareCalls).toBe(1);

    releasePrepare();
    await expect(winner).resolves.toEqual({ statusCode: 201, body: { id: "comment-1" } });
    expect(prepareCalls).toBe(1);

    await expect(runner.runWithExternalPrepare(input)).resolves.toEqual({
      statusCode: 201,
      body: { id: "comment-1" },
    });
    expect(prepareCalls).toBe(1);
  });

  it("different payload same key conflicts before prepare", async () => {
    const rows = new Map<string, {
      request_hash: string;
      reservation_state: string;
      status_code: number | null;
      response_body: unknown;
      expires_at: Date;
    }>();
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("SET LOCAL")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("DELETE FROM idempotency_records") && sql.includes("expires_at")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO idempotency_records")) {
        const keyHash = String(params![2]);
        if (rows.has(keyHash)) return { rows: [], rowCount: 0 };
        rows.set(keyHash, {
          request_hash: String(params![3]),
          reservation_state: "processing",
          status_code: null,
          response_body: null,
          expires_at: new Date(Date.now() + 60_000),
        });
        return { rows: [{ id: "claim-1" }], rowCount: 1 };
      }
      if (sql.includes("FROM idempotency_records")) {
        const keyHash = String(params![2]);
        const row = rows.get(keyHash);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: async () => client, query } as unknown as Pool;
    const fence = { assertActiveConsumerInTransaction: vi.fn(async () => undefined) };
    const runner = new MutationRunner(
      pool,
      new IdempotencyService(pool, env),
      fence as unknown as ActorFenceService,
      env,
    );
    const base = {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      operation: "comments.create",
      key: "unit-external-prepare-key",
      authorizeReplay: vi.fn(async () => undefined),
      prepare: async () => ({ ok: true }),
      execute: async () => ({ statusCode: 201, body: { id: "x" } }),
    };
    // First claim succeeds and stays processing (prepare never finishes for this test).
    let block!: () => void;
    const pending = new Promise<void>((r) => {
      block = r;
    });
    const first = runner.runWithExternalPrepare({
      ...base,
      requestHash: "hash-a",
      prepare: async () => {
        await pending;
        return { ok: true };
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      runner.runWithExternalPrepare({ ...base, requestHash: "hash-b" }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" }) });
    block();
    await first.catch(() => undefined);
  });

  it("findReplay still refuses revoked actors before reading receipts", async () => {
    let active = true;
    const query = vi.fn(async (sql: string) => ({
      rows:
        sql.includes("FROM idempotency_records")
          ? [{
            request_hash: "same-hash",
            reservation_state: "completed",
            status_code: 201,
            response_body: { id: "c" },
            expires_at: new Date(Date.now() + 60_000),
          }]
          : [],
      rowCount: 0,
    }));
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: async () => client } as unknown as Pool;
    const fence = {
      assertActiveConsumerInTransaction: vi.fn(async () => {
        if (!active) throw unauthorized();
      }),
    };
    const runner = new MutationRunner(
      pool,
      new IdempotencyService(pool, env),
      fence as unknown as ActorFenceService,
      env,
    );
    const input = {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      operation: "comments.create",
      key: "unit-find-replay-key",
      requestHash: "same-hash",
      authorizeReplay: vi.fn(async () => undefined),
    };
    expect(await runner.findReplay(input)).toEqual({ statusCode: 201, body: { id: "c" } });
    active = false;
    await expect(runner.findReplay(input)).rejects.toMatchObject({ status: 401 });
  });
});
