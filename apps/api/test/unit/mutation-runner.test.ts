import { describe, expect, it, vi } from "vitest";
import { HttpException, HttpStatus } from "@nestjs/common";
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

type Row = {
  request_hash: string;
  reservation_state: string;
  status_code: number | null;
  response_body: unknown;
  claim_nonce: string | null;
  expires_at: Date;
};

function makeStore() {
  const rows = new Map<string, Row>();
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

    if (
      sql.includes("DELETE FROM idempotency_records") &&
      sql.includes("reservation_state = 'completed'") &&
      sql.includes("expires_at <= now()")
    ) {
      const keyHash = String(params![2]);
      const row = rows.get(keyHash);
      if (
        row &&
        row.reservation_state === "completed" &&
        row.expires_at.getTime() <= Date.now()
      ) {
        rows.delete(keyHash);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("INSERT INTO idempotency_records")) {
      const keyHash = String(params![2]);
      const requestHash = String(params![3]);
      const claimNonce = String(params![4]);
      const expiresAt = params![5] as Date;
      if (rows.has(keyHash)) return { rows: [], rowCount: 0 };
      rows.set(keyHash, {
        request_hash: requestHash,
        reservation_state: "processing",
        status_code: null,
        response_body: null,
        claim_nonce: claimNonce,
        expires_at: expiresAt,
      });
      return { rows: [{ id: "claim-1" }], rowCount: 1 };
    }

    if (sql.includes("FROM idempotency_records") && sql.includes("FOR UPDATE")) {
      const keyHash = String(params![2]);
      const requestHash = String(params![3]);
      const claimNonce = String(params![4]);
      const row = rows.get(keyHash);
      if (
        row &&
        row.reservation_state === "processing" &&
        row.request_hash === requestHash &&
        row.claim_nonce === claimNonce
      ) {
        return { rows: [{ id: "claim-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      sql.includes("UPDATE idempotency_records") &&
      sql.includes("completed") &&
      sql.includes("claim_nonce")
    ) {
      const keyHash = String(params![2]);
      const claimNonce = String(params![7]);
      const row = rows.get(keyHash);
      if (
        !row ||
        row.reservation_state !== "processing" ||
        row.claim_nonce !== claimNonce
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.reservation_state = "completed";
      row.request_hash = String(params![3]);
      row.status_code = Number(params![4]);
      row.response_body = JSON.parse(String(params![5]));
      row.expires_at = params![6] as Date;
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes("UPDATE idempotency_records") &&
      sql.includes("'unknown'") &&
      sql.includes("claim_nonce")
    ) {
      const keyHash = String(params![2]);
      const requestHash = String(params![3]);
      const claimNonce = String(params![7]);
      const row = rows.get(keyHash);
      if (
        !row ||
        row.reservation_state !== "processing" ||
        row.request_hash !== requestHash ||
        row.claim_nonce !== claimNonce
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.reservation_state = "unknown";
      row.status_code = Number(params![4]);
      row.response_body = JSON.parse(String(params![5]));
      row.expires_at = params![6] as Date;
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes("DELETE FROM idempotency_records") &&
      sql.includes("processing") &&
      sql.includes("claim_nonce")
    ) {
      const keyHash = String(params![2]);
      const requestHash = String(params![3]);
      const claimNonce = String(params![4]);
      const row = rows.get(keyHash);
      if (
        row &&
        row.reservation_state === "processing" &&
        row.request_hash === requestHash &&
        row.claim_nonce === claimNonce
      ) {
        rows.delete(keyHash);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("FROM idempotency_records")) {
      const keyHash = String(params![2]);
      const row = rows.get(keyHash);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  });

  return { rows, query, get inTxn() { return inTxn; } };
}

function makeRunner(query: Pool["query"] | ReturnType<typeof makeStore>["query"]) {
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: async () => client, query } as unknown as Pool;
  const fence = {
    assertActiveConsumerInTransaction: vi.fn(async () => undefined),
  };
  return {
    runner: new MutationRunner(
      pool,
      new IdempotencyService(pool, env),
      fence as unknown as ActorFenceService,
      env,
    ),
    fence,
    pool,
    client,
  };
}

describe("MutationRunner.runWithExternalPrepare", () => {
  it("claims once, runs prepare outside txn, completes; concurrent same-hash sees processing CIP", async () => {
    const store = makeStore();
    const { runner } = makeRunner(store.query);

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
        expect(store.inTxn).toBe(true);
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
    const store = makeStore();
    const { runner } = makeRunner(store.query);
    const base = {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      operation: "comments.create",
      key: "unit-external-prepare-key",
      authorizeReplay: vi.fn(async () => undefined),
      prepare: async () => ({ ok: true }),
      execute: async () => ({ statusCode: 201, body: { id: "x" } }),
    };
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

  it("after provider 503/unknown, clock past TTL does not start a second paid prepare", async () => {
    const store = makeStore();
    const { runner } = makeRunner(store.query);
    let prepareCalls = 0;
    const input = {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      operation: "comments.create",
      key: "unit-unknown-no-replay",
      requestHash: "hash-unknown",
      authorizeReplay: vi.fn(async () => undefined),
      prepare: async () => {
        prepareCalls += 1;
        throw new HttpException(
          {
            type: "about:blank",
            title: "Проверка текста временно недоступна",
            status: 503,
            code: "MODERATION_TEMPORARILY_UNAVAILABLE",
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      },
      execute: async () => ({ statusCode: 201, body: { id: "should-not" } }),
    };

    await expect(runner.runWithExternalPrepare(input)).rejects.toMatchObject({ status: 503 });
    expect(prepareCalls).toBe(1);

    const only = [...store.rows.values()][0]!;
    expect(only.reservation_state).toBe("unknown");
    expect(only.status_code).toBe(503);
    // Simulate clock advance past the soft external TTL and sealed expires marker.
    only.expires_at = new Date(Date.now() - 1_000);

    await expect(runner.runWithExternalPrepare(input)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: "MODERATION_TEMPORARILY_UNAVAILABLE" }),
    });
    expect(prepareCalls).toBe(1);
    expect([...store.rows.values()][0]!.reservation_state).toBe("unknown");
  });

  it("wrong-owner late complete/release cannot mutate the correct claim", async () => {
    const store = makeStore();
    const { runner } = makeRunner(store.query);
    const wrongNonce = "20000000-0000-4000-8000-000000000099";

    // Release fencing: known 4xx after a swapped nonce must not delete the live claim.
    let releasePrepareCalls = 0;
    await expect(
      runner.runWithExternalPrepare({
        actorId: actor.userId,
        sessionId: actor.sessionId,
        operation: "comments.create",
        key: "unit-owner-release-fence",
        requestHash: "hash-release",
        authorizeReplay: vi.fn(async () => undefined),
        prepare: async () => {
          releasePrepareCalls += 1;
          const row = [...store.rows.values()][0]!;
          expect(row.claim_nonce).toBeTruthy();
          expect(row.claim_nonce).not.toBe(wrongNonce);
          row.claim_nonce = wrongNonce; // distinct worker / replacement token
          throw new HttpException(
            {
              type: "about:blank",
              title: "Отклонено",
              status: 422,
              code: "PUBLIC_TEXT_CONTENT_REJECTED",
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        },
        execute: async () => ({ statusCode: 201, body: { id: "should-not" } }),
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(releasePrepareCalls).toBe(1);
    expect(store.rows.size).toBe(1);
    expect([...store.rows.values()][0]!.reservation_state).toBe("processing");
    expect([...store.rows.values()][0]!.claim_nonce).toBe(wrongNonce);

    // Complete fencing: late original with its nonce cannot finalize a replaced claim.
    store.rows.clear();
    let releaseComplete!: () => void;
    const completeGate = new Promise<void>((resolve) => {
      releaseComplete = resolve;
    });
    let completePrepareCalls = 0;
    let ownerNonce = "";
    const completeInput = {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      operation: "comments.create",
      key: "unit-owner-complete-fence",
      requestHash: "hash-complete",
      authorizeReplay: vi.fn(async () => undefined),
      prepare: async () => {
        completePrepareCalls += 1;
        ownerNonce = [...store.rows.values()][0]!.claim_nonce!;
        await completeGate;
        return { approval: true };
      },
      execute: async () => ({ statusCode: 201, body: { id: "should-not-complete" } }),
    };
    const late = runner.runWithExternalPrepare(completeInput);
    for (let i = 0; i < 50 && completePrepareCalls === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(completePrepareCalls).toBe(1);
    expect(ownerNonce).toBeTruthy();
    // Replacement claim under same key with a different owner token.
    const row = [...store.rows.values()][0]!;
    row.claim_nonce = wrongNonce;
    row.expires_at = new Date(Date.now() - 1_000);
    releaseComplete();
    await expect(late).rejects.toMatchObject({ status: 409 });
    expect([...store.rows.values()][0]!.reservation_state).toBe("processing");
    expect([...store.rows.values()][0]!.claim_nonce).toBe(wrongNonce);
    expect([...store.rows.values()][0]!.status_code).toBeNull();

    // Clock-advanced processing still blocks a new paid prepare.
    await expect(
      runner.runWithExternalPrepare({
        ...completeInput,
        prepare: async () => {
          completePrepareCalls += 1;
          return { approval: true };
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(completePrepareCalls).toBe(1);
  });

  it("known 4xx releases claim so a corrected same-key attempt can prepare once", async () => {
    const store = makeStore();
    const { runner } = makeRunner(store.query);
    let prepareCalls = 0;
    const input = {
      actorId: actor.userId,
      sessionId: actor.sessionId,
      operation: "comments.create",
      key: "unit-4xx-release",
      requestHash: "hash-4xx",
      authorizeReplay: vi.fn(async () => undefined),
      prepare: async () => {
        prepareCalls += 1;
        if (prepareCalls === 1) {
          throw new HttpException(
            {
              type: "about:blank",
              title: "Отклонено",
              status: 422,
              code: "PUBLIC_TEXT_CONTENT_REJECTED",
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        return { approval: true };
      },
      execute: async () => ({ statusCode: 201, body: { id: "after-correct" } }),
    };

    await expect(runner.runWithExternalPrepare(input)).rejects.toMatchObject({ status: 422 });
    expect(prepareCalls).toBe(1);
    expect(store.rows.size).toBe(0);

    await expect(runner.runWithExternalPrepare(input)).resolves.toEqual({
      statusCode: 201,
      body: { id: "after-correct" },
    });
    expect(prepareCalls).toBe(2);
  });
});
