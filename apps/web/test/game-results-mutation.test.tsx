import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceDispute, AttendanceRecord, GameResults } from "../src/lib/consumer-types";
import {
  gameResultsMutationScope,
  validateGameResultsPending,
  validateGameResultsSuccess,
  useGameResultsMutation,
} from "../src/components/consumer/games/useGameResultsMutation";
import { readFileSync } from "node:fs";
import path from "node:path";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  cleanups: [] as Array<(() => void) | undefined>,
}));

vi.mock("react", () => ({
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (value: T | ((previous: T) => T)) => {
        hooks.slots[index] =
          typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
      },
    ];
  },
  useRef<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect(effect: () => void | (() => void), deps?: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    const nextDeps = deps ?? [];
    if (!previous || nextDeps.some((value, i) => !Object.is(value, previous[i]))) {
      hooks.slots[index] = nextDeps;
      hooks.effects.push(() => {
        hooks.cleanups[index]?.();
        const cleanup = effect();
        hooks.cleanups[index] = typeof cleanup === "function" ? cleanup : undefined;
      });
    }
  },
}));
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../src/lib/api-client";

const gameId = "10000000-0000-4000-8000-000000000099";
const otherGameId = "10000000-0000-4000-8000-000000000088";
const contextId = "20000000-0000-4000-8000-000000000001";
const contextIdB = "20000000-0000-4000-8000-000000000002";
const actor = "actor-a";
const actorB = "actor-b";

const record = (over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  contextId,
  value: "present",
  version: 1,
  late: false,
  assertion: { actorDisplay: "Ольга", source: "manager_explicit", at: "2026-10-24T18:00:00.000Z" },
  acknowledgedVersion: null,
  dispute: null,
  displayName: "Анна",
  allowedActions: {
    canSetAttendance: false,
    canAcknowledge: true,
    canDispute: true,
    canWithdrawDispute: false,
  },
  ...over,
});

function flushEffects() {
  const queued = hooks.effects.splice(0);
  for (const effect of queued) effect();
}

describe("PG-1b game results mutation host", () => {
  const success = vi.fn();
  const refresh = vi.fn();
  const storage = new Map<string, string>();
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  function render(scopeActor = actor, scopeGame = gameId, csrf = "csrf") {
    hooks.cursor = 0;
    useGameResultsMutation(scopeActor, scopeGame, csrf, success, refresh);
    flushEffects();
    hooks.cursor = 0;
    return useGameResultsMutation(scopeActor, scopeGame, csrf, success, refresh);
  }

  /** Same hook slots / instance: scope change must re-run storage effect (A→B). */
  function renderSameInstance(scopeActor: string, scopeGame = gameId, csrf = "csrf") {
    hooks.cursor = 0;
    useGameResultsMutation(scopeActor, scopeGame, csrf, success, refresh);
    flushEffects();
    hooks.cursor = 0;
    return useGameResultsMutation(scopeActor, scopeGame, csrf, success, refresh);
  }

  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.cleanups = [];
    storage.clear();
    vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "results-attempt-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => {
    hooks.cleanups.forEach((fn) => fn?.());
    vi.unstubAllGlobals();
  });

  it("scopes pending by immutable actor+game and blocks double-click while pending", async () => {
    expect(gameResultsMutationScope(actor, gameId)).toBe(`${actor}:game-results:${gameId}`);
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    const mutation = render();
    expect(mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT")).toBe(
      true,
    );
    expect(mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT")).toBe(
      false,
    );
    await settle();
    const restored = render();
    expect(restored.pending).toBe(true);
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toContain("results-attempt-key");
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const headers = vi.mocked(apiFetch).mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.["Idempotency-Key"]).toBe("results-attempt-key");
  });

  it("restores same pending on reload host remount without auto POST", async () => {
    storage.set(
      `gb-fr04-pending:${actor}:game-results:${gameId}`,
      JSON.stringify({
        path: `/v1/games/${gameId}/attendance/${contextId}`,
        body: { expectedVersion: 0, value: "absent" },
        key: "frozen-key",
        method: "PUT",
      }),
    );
    render();
    const mutation = render();
    expect(mutation.pending).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("same-instance A pending→B (no B marker)→retry must not POST A under B", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    let mutation = renderSameInstance(actor, gameId, "csrf-a");
    expect(
      mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT"),
    ).toBe(true);
    await settle();
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toContain("results-attempt-key");

    mutation = renderSameInstance(actorB, gameId, "csrf-b");
    expect(mutation.pending).toBe(false);
    mutation.retry();
    await settle();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[1]?.csrfToken).toBe("csrf-a");
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toContain("results-attempt-key");
    expect(storage.get(`gb-fr04-pending:${actorB}:game-results:${gameId}`)).toBeUndefined();
  });

  it("late A response after B new pending cannot clear B marker/state", async () => {
    let resolveA: (value: unknown) => void = () => {};
    const deferredA = new Promise((resolve) => {
      resolveA = resolve;
    });
    vi.mocked(apiFetch)
      .mockImplementationOnce(() => deferredA as Promise<never>)
      .mockResolvedValueOnce({ ok: false, status: 0, error: "unknown-b" });

    let mutation = renderSameInstance(actor, gameId, "csrf-a");
    expect(
      mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT"),
    ).toBe(true);

    mutation = renderSameInstance(actorB, gameId, "csrf-b");
    expect(mutation.pending).toBe(false);
    expect(
      mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "absent" }, "PUT"),
    ).toBe(true);
    await settle();
    mutation = renderSameInstance(actorB, gameId, "csrf-b");
    expect(mutation.pending).toBe(true);
    expect(storage.get(`gb-fr04-pending:${actorB}:game-results:${gameId}`)).toBeTruthy();

    resolveA({
      ok: true,
      status: 200,
      data: record({ version: 1, value: "present", late: false }),
    });
    await settle();
    mutation = renderSameInstance(actorB, gameId, "csrf-b");
    expect(mutation.pending).toBe(true);
    expect(storage.get(`gb-fr04-pending:${actorB}:game-results:${gameId}`)).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
  });

  it("game change same-instance drops in-memory pending and does not resend prior game", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    let mutation = renderSameInstance(actor, gameId, "csrf-a");
    mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT");
    await settle();
    mutation = renderSameInstance(actor, otherGameId, "csrf-a");
    expect(mutation.pending).toBe(false);
    mutation.retry();
    await settle();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toBeTruthy();
  });

  it("malformed stored marker retained HOLD — no retry delete", async () => {
    storage.set(
      `gb-fr04-pending:${actor}:game-results:${gameId}`,
      JSON.stringify({
        path: `/v1/games/${otherGameId}/attendance/${contextId}`,
        body: { expectedVersion: 0, value: "absent" },
        key: "cross-game-key",
        method: "PUT",
      }),
    );
    const mutation = render();
    expect(mutation.pending).toBe(true);
    expect(mutation.code).toBe("hold");
    mutation.retry();
    await settle();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toContain("cross-game-key");
    expect(mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT")).toBe(
      false,
    );
  });

  it("keeps cross-actor pending isolated on fresh mount and does not resend under new actor", async () => {
    storage.set(
      `gb-fr04-pending:${actor}:game-results:${gameId}`,
      JSON.stringify({
        path: `/v1/games/${gameId}/attendance/${contextId}`,
        body: { expectedVersion: 0, value: "absent" },
        key: "old-actor-key",
        method: "PUT",
      }),
    );
    const other = render(actorB);
    expect(other.pending).toBe(false);
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toContain("old-actor-key");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects malformed 2xx / cross-context body and keeps UNKNOWN", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: record({ contextId: "30000000-0000-4000-8000-000000000099" }),
    });
    const mutation = render();
    mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT");
    await settle();
    const again = render();
    expect(again.pending).toBe(true);
    expect(success).not.toHaveBeenCalled();
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toBeTruthy();
  });

  it("receipt binding rejects empty bulk and stale unknown outcome; matching responses pass", () => {
    const bulkPending = {
      path: `/v1/games/${gameId}/attendance/bulk-present`,
      body: {
        items: [
          { contextId, expectedVersion: 0 },
          { contextId: contextIdB, expectedVersion: 1 },
        ],
        confirmedExactSelection: true,
      },
      key: "bulk-k",
      method: "POST",
    };
    expect(validateGameResultsSuccess({ items: [] }, bulkPending)).toBe(false);
    expect(
      validateGameResultsSuccess(
        {
          items: [
            record({ contextId, version: 1, value: "present", late: false }),
            record({ contextId: contextIdB, version: 2, value: "present", late: false }),
          ],
        },
        bulkPending,
      ),
    ).toBe(true);
    expect(
      validateGameResultsSuccess(
        { items: [record({ contextId, version: 1, value: "present", late: false })] },
        bulkPending,
      ),
    ).toBe(false);

    const outcomePending = {
      path: `/v1/games/${gameId}/outcome`,
      body: { expectedVersion: 1, outcome: "held", reason: "уточнение" },
      key: "out-k",
      method: "PUT",
    };
    const staleUnknown: GameResults = {
      gameId,
      outcome: { value: "unknown", version: 0, reason: null, provenance: null },
      allowedActions: { canRecordOutcome: false },
    };
    expect(validateGameResultsSuccess(staleUnknown, outcomePending)).toBe(false);
    const matched: GameResults = {
      gameId,
      outcome: { value: "held", version: 2, reason: "уточнение", provenance: null },
      allowedActions: { canRecordOutcome: false },
    };
    expect(validateGameResultsSuccess(matched, outcomePending)).toBe(true);

    const markPending = {
      path: `/v1/games/${gameId}/attendance/${contextId}`,
      body: { expectedVersion: 0, value: "present" as const, late: false },
      key: "k",
      method: "PUT",
    };
    expect(validateGameResultsSuccess(record(), markPending)).toBe(true);
    expect(
      validateGameResultsSuccess(record({ contextId: "30000000-0000-4000-8000-000000000099" }), markPending),
    ).toBe(false);

    const ackPending = {
      path: `/v1/games/${gameId}/attendance/${contextId}/acknowledgements`,
      body: { attendanceVersion: 2 },
      key: "ack",
      method: "POST",
    };
    expect(
      validateGameResultsSuccess(record({ version: 2, acknowledgedVersion: 2, value: "present" }), ackPending),
    ).toBe(true);
    expect(
      validateGameResultsSuccess(record({ version: 2, acknowledgedVersion: 1, value: "present" }), ackPending),
    ).toBe(false);

    const disputePending = {
      path: `/v1/games/${gameId}/attendance/${contextId}/disputes`,
      body: { attendanceVersion: 1, explanation: "Я была" },
      key: "d",
      method: "POST",
    };
    const dispute: AttendanceDispute = {
      id: "disp-1",
      gameId,
      contextId,
      status: "open",
      challengedVersion: 1,
      explanation: "Я была",
      version: 1,
      createdAt: "2026-10-24T18:00:00.000Z",
      updatedAt: "2026-10-24T18:00:00.000Z",
      withdrawnAt: null,
      withdrawReason: null,
      history: [],
      allowedActions: { canWithdraw: true },
    };
    expect(validateGameResultsSuccess(dispute, disputePending)).toBe(true);
    expect(validateGameResultsSuccess({ ...dispute, status: "withdrawn" }, disputePending)).toBe(false);
    expect(
      validateGameResultsPending(
        { path: "/v1/other", body: {}, key: "x", method: "POST" },
        gameId,
      ),
    ).toBe(false);
  });

  it("composition keys immutable actor+game host, blocks invented correction reason, ack copy", () => {
    const composition = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameResultsComposition.tsx"),
      "utf8",
    );
    expect(composition).toContain("GameResultsMutationHost");
    expect(composition).toContain("key={`${me.id}:${gameId}`}");
    expect(composition).toContain("useGameResultsMutation");
    expect(composition).not.toContain('|| "Исправление"');
    expect(composition).not.toContain("setUnknownOp(false)");
    expect(composition).toContain("Согласен с этой отметкой");
    expect(composition).toContain("epoch.current += 1");
    expect(composition).toContain("actorRef.current = null");
    expect(composition).toContain("gb-session-changed");
    expect(composition).toContain("Проверить ту же отправку");
  });
});
