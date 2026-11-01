import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceRecord, GameResults } from "../src/lib/consumer-types";
import {
  gameResultsMutationScope,
  validateGameResultsSuccess,
  useGameResultsMutation,
} from "../src/components/consumer/games/useGameResultsMutation";
import { readFileSync } from "node:fs";
import path from "node:path";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
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
  useEffect(effect: () => unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = true;
      effect();
    }
  },
}));
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../src/lib/api-client";

const gameId = "10000000-0000-4000-8000-000000000099";
const contextId = "20000000-0000-4000-8000-000000000001";
const actor = "actor-a";

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

describe("PG-1b game results mutation host", () => {
  const success = vi.fn();
  const refresh = vi.fn();
  const storage = new Map<string, string>();
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  function render(scopeActor = actor) {
    hooks.cursor = 0;
    return useGameResultsMutation(scopeActor, gameId, "csrf", success, refresh);
  }

  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    storage.clear();
    vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "results-attempt-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

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

  it("keeps cross-actor pending isolated and does not resend under new actor", async () => {
    storage.set(
      `gb-fr04-pending:${actor}:game-results:${gameId}`,
      JSON.stringify({
        path: `/v1/games/${gameId}/attendance/${contextId}`,
        body: { expectedVersion: 0, value: "absent" },
        key: "old-actor-key",
        method: "PUT",
      }),
    );
    const other = render("actor-b");
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

  it("validateSuccess accepts matching attendance and outcome payloads only", () => {
    const pending = {
      path: `/v1/games/${gameId}/attendance/${contextId}`,
      body: { expectedVersion: 0, value: "present" },
      key: "k",
      method: "PUT",
    };
    expect(validateGameResultsSuccess(record(), pending)).toBe(true);
    expect(
      validateGameResultsSuccess(record({ contextId: "30000000-0000-4000-8000-000000000099" }), pending),
    ).toBe(false);
    const outcomePending = {
      path: `/v1/games/${gameId}/outcome`,
      body: { expectedVersion: 0, outcome: "held" },
      key: "k2",
      method: "PUT",
    };
    const results: GameResults = {
      gameId,
      outcome: { value: "held", version: 1, reason: null, provenance: null },
      allowedActions: { canRecordOutcome: false },
    };
    expect(validateGameResultsSuccess(results, outcomePending)).toBe(true);
    expect(
      validateGameResultsSuccess({ ...results, gameId: "30000000-0000-4000-8000-000000000099" }, outcomePending),
    ).toBe(false);
  });

  it("composition reuses mutation host, blocks invented correction reason, and treats ack as agreement", () => {
    const composition = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameResultsComposition.tsx"),
      "utf8",
    );
    expect(composition).toContain("useGameResultsMutation");
    expect(composition).not.toContain('|| "Исправление"');
    expect(composition).not.toContain("setUnknownOp(false)");
    expect(composition).toContain("Согласен с этой отметкой");
    expect(composition).toContain("epoch.current += 1");
    expect(composition).toContain("gb-session-changed");
    expect(composition).toContain("Проверить ту же отправку");
  });
});
