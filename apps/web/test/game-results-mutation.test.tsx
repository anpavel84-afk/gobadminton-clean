import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as React from "react";
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
  /** When set, useState serves dual-role render fixtures (QA probe) instead of hook slots. */
  render: null as null | { index: number; manager: boolean },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState<T>(initial: T) {
      if (hooks.render) {
        const i = hooks.render.index++;
        const rec = {
          contextId: "ctx",
          value: "absent",
          version: 1,
          late: false,
          displayName: "Own manager",
          assertion: {
            actorDisplay: "Other manager",
            source: "manager_explicit",
            at: "2026-11-01T00:00:00Z",
          },
          acknowledgedVersion: null,
          dispute: null,
          allowedActions: {
            canSetAttendance: true,
            canAcknowledge: true,
            canDispute: true,
            canWithdrawDispute: false,
          },
        };
        const results = {
          gameId: "g",
          outcome: { value: "unknown", version: 0 },
          allowedActions: { canRecordOutcome: true },
          attendance: {
            installed: true,
            writesEnabled: true,
            myAttendance: rec,
            roster: hooks.render.manager ? [rec] : null,
            summary: { rosterCount: 1, marked: 1, unknown: 0, underClarification: 0, agreed: 0 },
            allowedActions: { canRecordAttendance: true, canBulkPresent: true },
          },
        };
        return actual.useState(
          i === 0 ? ({ id: "actor", csrfToken: "csrf" } as T) : i === 2 ? (results as T) : i === 3 ? ("ready" as T) : initial,
        );
      }
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
      if (hooks.render) return actual.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      if (hooks.render) return actual.useEffect(effect, deps);
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
    useMemo<T>(factory: () => T, deps?: readonly unknown[]) {
      if (hooks.render) return actual.useMemo(factory, (deps ?? []) as React.DependencyList);
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { deps: readonly unknown[]; value: T } | undefined;
      const nextDeps = deps ?? [];
      if (!previous || nextDeps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const value = factory();
        hooks.slots[index] = { deps: nextDeps, value };
        return value;
      }
      return previous.value;
    },
  };
});
vi.mock("../src/lib/api-client", () => ({
  apiFetch: vi.fn(),
  getMe: vi.fn(),
  getGame: vi.fn(),
  getGameResults: vi.fn(),
  getAttendanceHistory: vi.fn(),
  getAttendanceDispute: vi.fn(),
}));
import { apiFetch, getMe, getGame, getGameResults, getAttendanceDispute } from "../src/lib/api-client";
import {
  Children,
  cloneElement,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameResultsComposition } from "../src/components/consumer/games/GameResultsComposition";
import type { GameFeedbackSlice, GamePersonalNote } from "../src/lib/consumer-types";

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
    hooks.render = null;
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
    hooks.render = null;
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

  it("forwards frozen pending on confirmed success; single-arg success callers stay compatible", async () => {
    const body = { expectedVersion: 0, value: "present" as const, late: false };
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: record({ version: 1, value: "present", late: false }),
    });
    const mutation = render();
    expect(mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, body, "PUT")).toBe(true);
    await settle();
    expect(success).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledWith(
      record({ version: 1, value: "present", late: false }),
      expect.objectContaining({
        path: `/v1/games/${gameId}/attendance/${contextId}`,
        method: "PUT",
        key: "results-attempt-key",
        body,
      }),
    );
    // Single-arg callback shape still receives data as first argument.
    expect(success.mock.calls[0]?.[0]).toEqual(record({ version: 1, value: "present", late: false }));
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
      validateGameResultsSuccess(record({ version: 2, acknowledgedVersion: 2, value: "absent" }), ackPending),
    ).toBe(true);
    expect(
      validateGameResultsSuccess(record({ version: 2, acknowledgedVersion: 1, value: "present" }), ackPending),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(record({ version: 2, acknowledgedVersion: 2, value: "unknown" }), ackPending),
    ).toBe(false);

    const resolvingAckPending = {
      path: `/v1/games/${gameId}/attendance/${contextId}/acknowledgements`,
      body: {
        attendanceVersion: 2,
        resolvingDisputeId: "disp-1",
        expectedDisputeVersion: 3,
      },
      key: "ack-resolve",
      method: "POST",
    };
    // Missing / unrelated dispute summary must NOT clear resolving UNKNOWN.
    expect(
      validateGameResultsSuccess(record({ version: 2, acknowledgedVersion: 2, value: "present" }), resolvingAckPending),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(
        record({
          version: 2,
          acknowledgedVersion: 2,
          value: "present",
          dispute: { id: "other", status: "withdrawn", challengedVersion: 1, version: 1 },
        }),
        resolvingAckPending,
      ),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(
        record({
          version: 2,
          acknowledgedVersion: 2,
          value: "present",
          resolvedDispute: {
            id: "disp-1",
            resultingVersion: 4,
            status: "resolved",
            contextId,
            attendanceVersion: 2,
          },
        }),
        resolvingAckPending,
      ),
    ).toBe(true);
    expect(
      validateGameResultsSuccess(
        record({
          version: 2,
          acknowledgedVersion: 2,
          value: "present",
          resolvedDispute: {
            id: "disp-1",
            resultingVersion: 3,
            status: "resolved",
            contextId,
            attendanceVersion: 2,
          },
        }),
        resolvingAckPending,
      ),
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
    // Dual-role: own section is independent of manager roster branch.
    expect(composition).toContain("my || !isManager");
    // Postgame ProfileDialog skin opt-in + body scroll lock on all five forms.
    expect(composition).toContain('className="profile-dialog--postgame"');
    expect((composition.match(/profile-dialog--postgame/g) ?? []).length).toBe(5);
    expect((composition.match(/lockBodyScroll/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("QA: unknown is never a valid acknowledged fact receipt", () => {
    expect(
      validateGameResultsSuccess(record({ value: "unknown", version: 2, acknowledgedVersion: 2 }), {
        path: `/v1/games/${gameId}/attendance/${contextId}/acknowledgements`,
        method: "POST",
        body: { attendanceVersion: 2 },
        key: "qa-ack",
      }),
    ).toBe(false);
  });

  it("QA: ACK pending/success require positive integer attendanceVersion", () => {
    const ackPath = `/v1/games/${gameId}/attendance/${contextId}/acknowledgements`;
    const pendingOf = (attendanceVersion: unknown) => ({
      path: ackPath,
      method: "POST" as const,
      body: { attendanceVersion },
      key: "qa-ack-version",
    });

    expect(validateGameResultsPending(pendingOf(0), gameId)).toBe(false);
    expect(validateGameResultsPending(pendingOf(-1), gameId)).toBe(false);
    expect(validateGameResultsPending(pendingOf(1.5), gameId)).toBe(false);
    expect(validateGameResultsPending(pendingOf("2"), gameId)).toBe(false);
    expect(validateGameResultsPending(pendingOf(2), gameId)).toBe(true);

    // Zero-version probe: present/absent receipt with version=ack=0 must not clear UNKNOWN.
    expect(
      validateGameResultsSuccess(record({ value: "present", version: 0, acknowledgedVersion: 0 }), pendingOf(0)),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(record({ value: "absent", version: 0, acknowledgedVersion: 0 }), pendingOf(0)),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(record({ value: "present", version: -1, acknowledgedVersion: -1 }), pendingOf(-1)),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(record({ value: "present", version: 2, acknowledgedVersion: 2 }), pendingOf(1.5)),
    ).toBe(false);
    expect(
      validateGameResultsSuccess(record({ value: "present", version: 2, acknowledgedVersion: 2 }), pendingOf(2)),
    ).toBe(true);
  });

  it("QA: unparseable persisted operation stays HOLD and blocks new intent", () => {
    storage.set(`gb-fr04-pending:${actor}:game-results:${gameId}`, "{broken-json");
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    const mutation = render();
    expect(mutation.code).toBe("hold");
    expect(mutation.pending).toBe(true);
    expect(
      mutation.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT"),
    ).toBe(false);
    mutation.retry();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(storage.get(`gb-fr04-pending:${actor}:game-results:${gameId}`)).toBe("{broken-json");
  });

  it("QA: corrupt HOLD on scope A does not block independent scope B", () => {
    storage.set(`gb-fr04-pending:${actor}:game-results:${gameId}`, "{broken-json");
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    const held = render(actor, gameId);
    expect(held.code).toBe("hold");
    expect(held.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT")).toBe(
      false,
    );
    const other = render(actorB, gameId);
    expect(other.code).not.toBe("hold");
    expect(other.pending).toBe(false);
    expect(
      other.run(`/v1/games/${gameId}/attendance/${contextId}`, { expectedVersion: 0, value: "present" }, "PUT"),
    ).toBe(true);
  });

  it("postgame dialog family uses sole body scroll; lists drop nested overflow", () => {
    const postgameCss = readFileSync(path.resolve(__dirname, "../src/styles/postgame.css"), "utf8");
    const playersCss = readFileSync(path.resolve(__dirname, "../src/styles/players.css"), "utf8");
    const overlaysCss = readFileSync(path.resolve(__dirname, "../src/styles/desktop-overlays.css"), "utf8");
    expect(postgameCss).toContain("gb-postgame__bulk-list");
    expect(postgameCss).toContain("sole scroll owner");
    expect(postgameCss).not.toMatch(/\.gb-postgame__bulk-list[^{]*\{[^}]*overflow:\s*auto/);
    expect(postgameCss).not.toMatch(/\.gb-postgame__history[^{]*\{[^}]*max-height:/);
    expect(playersCss).toContain(".profile-dialog--postgame");
    expect(overlaysCss).toContain(".profile-dialog--postgame");
  });

  it("QA rendered own recourse: ordinary participant sees acknowledgement and objection", () => {
    hooks.render = { index: 0, manager: false };
    const html = renderToStaticMarkup(createElement(GameResultsComposition, { gameId: "g" }));
    expect(html).toContain("Согласен с этой отметкой");
    expect(html).toContain("Запросить исправление");
    expect(html).toContain("Other manager");
    expect(html).not.toContain('aria-label="Состав"');
  });

  it("QA rendered own recourse: manager who participates also retains own acknowledgement and objection", () => {
    hooks.render = { index: 0, manager: true };
    const html = renderToStaticMarkup(createElement(GameResultsComposition, { gameId: "g" }));
    expect(html).toContain("Согласен с этой отметкой");
    expect(html).toContain("Запросить исправление");
    expect(html).toContain("История изменений");
    expect(html).toContain("Other manager");
    expect(html).toContain('aria-label="Состав"');
    expect(html).toContain("Фактическое посещение");
  });
});

/**
 * Expand function components in one hook-cursor pass so Composition → MutationHost →
 * GameFeedbackPanel share the mocked fiber (avoids remount-by-walk).
 */
function expandHost(node: ReactNode): ReactNode {
  if (node == null || typeof node === "boolean") return node;
  if (Array.isArray(node)) return node.map(expandHost);
  if (!isValidElement(node)) return node;
  if (typeof node.type === "function") {
    return expandHost((node.type as (props: Record<string, unknown>) => ReactNode)(
      node.props as Record<string, unknown>,
    ));
  }
  const children = (node.props as { children?: ReactNode }).children;
  if (children == null) return node;
  const expanded = Children.map(children, (child) => expandHost(child));
  return cloneElement(node, undefined, expanded);
}

function walkHost(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...Children.toArray(node.props.children as ReactNode).flatMap(walkHost)];
}

function feedbackSlice(notes: GamePersonalNote[] = [], canCreateNote = true): GameFeedbackSlice {
  return {
    installed: true,
    writesEnabled: true,
    capabilities: {
      installed: true,
      writesEnabled: true,
      canCreatePeer: false,
      canCreateOrganization: false,
      canCreateTraining: false,
      canCreateNote,
      peerSubjects: [],
      organizationRecipientDisplay: null,
      complaintReuse: "existing_player_report",
      remaining: ["typed_review_safety_extension"],
    },
    myNotes: notes,
    gameReviews: [],
  };
}

function resultsWithFeedback(feedback: GameFeedbackSlice): GameResults {
  return {
    gameId,
    outcome: { value: "held", version: 1, reason: null, provenance: null },
    attendance: {
      installed: true,
      writesEnabled: false,
      myAttendance: null,
      roster: [
        {
          contextId,
          value: "present",
          version: 1,
          late: false,
          assertion: {
            actorDisplay: "Mgr",
            source: "manager_explicit",
            at: "2026-11-01T00:00:00.000Z",
          },
          acknowledgedVersion: null,
          dispute: null,
          displayName: "Кирилл",
          allowedActions: {
            canSetAttendance: false,
            canAcknowledge: false,
            canDispute: false,
            canWithdrawDispute: false,
            canRespondDispute: false,
          },
        },
      ],
      rosterNextCursor: null,
      summary: { rosterCount: 1, marked: 1, unknown: 0, underClarification: 0, agreed: 0 },
      allowedActions: { canRecordAttendance: false, canBulkPresent: false },
    },
    feedback,
    allowedActions: { canRecordOutcome: false },
  };
}

describe("PG-3 host+panel same-context draft lifecycle", () => {
  const storage = new Map<string, string>();
  const noteText = "Черновик с хоста";
  const ownNote = (): GamePersonalNote => ({
    gameId,
    contextId,
    subjectDisplay: "Кирилл",
    text: "Старая заметка",
    version: 2,
    updatedAt: "2026-11-01T00:00:00.000Z",
    allowedActions: { canEdit: true, canDelete: true },
  });

  function flushEffects() {
    const queued = hooks.effects.splice(0);
    for (const effect of queued) effect();
  }

  function renderHost() {
    hooks.cursor = 0;
    const tree = expandHost(createElement(GameResultsComposition, { gameId }));
    flushEffects();
    return tree;
  }

  async function settle() {
    for (let i = 0; i < 12; i += 1) {
      renderHost();
      await Promise.resolve();
    }
    return renderHost();
  }

  function nodesOf(tree: ReactNode) {
    return walkHost(tree);
  }

  function openNotesTab(tree: ReactNode) {
    const nodes = nodesOf(tree);
    const tab = nodes.find(
      (n) => n.type === "button" && n.props.role === "tab" && String(n.props.children) === "Обратная связь",
    );
    expect(tab).toBeTruthy();
    (tab!.props.onClick as () => void)();
    const after = renderHost();
    const notes = nodesOf(after).find(
      (n) => n.type === "button" && n.props.role === "tab" && String(n.props.children) === "Заметки",
    );
    expect(notes).toBeTruthy();
    (notes!.props.onClick as () => void)();
    return renderHost();
  }

  beforeEach(() => {
    hooks.slots = [];
    hooks.cursor = 0;
    hooks.effects = [];
    hooks.cleanups = [];
    hooks.render = null;
    storage.clear();
    vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "host-lifecycle-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        addEventListener: EventTarget.prototype.addEventListener,
        removeEventListener: EventTarget.prototype.removeEventListener,
      }),
    );
    vi.mocked(getMe).mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: actor, csrfToken: "csrf", displayName: "Actor", locale: "ru", linkedProviders: [] },
    });
    vi.mocked(getGame).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: gameId,
        title: "Игра",
        startsAt: "2026-11-01T12:00:00.000Z",
        timezone: "Europe/Moscow",
        venue: { id: "v", name: "Зал", address: "А", cityId: "c", timezone: "Europe/Moscow" },
      } as never,
    });
    vi.mocked(getGameResults).mockResolvedValue({
      ok: true,
      status: 200,
      data: resultsWithFeedback(feedbackSlice()),
    });
    vi.mocked(getAttendanceDispute).mockResolvedValue({ ok: false, status: 404, error: "missing" });
  });

  afterEach(() => {
    hooks.cleanups.forEach((fn) => fn?.());
    hooks.render = null;
    vi.unstubAllGlobals();
  });

  it("soft-reload source keeps panel across ordinary refresh (QA8 P2)", () => {
    const composition = readFileSync(
      path.resolve(__dirname, "../src/components/consumer/games/GameResultsComposition.tsx"),
      "utf8",
    );
    expect(composition).toContain("if (me == null || results == null)");
    expect(composition).toContain('results && (state === "ready" || state === "loading")');
    expect(composition).toContain('state === "loading" && !results');
    // Must not unconditionally blank the ready surface at the top of reload.
    expect(composition).not.toMatch(
      /async function reload\(\) \{\s*const request = \+\+epoch\.current;\s*setState\("loading"\);/,
    );
  });

  it("confirmed note PUT then same-context reload clears matching create draft only", async () => {
    await settle();
    let tree = openNotesTab(renderHost());
    let nodes = nodesOf(tree);
    const select = nodes.find((n) => n.type === "select");
    expect(select).toBeTruthy();
    (select!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: contextId } });
    tree = renderHost();
    nodes = nodesOf(tree);
    const area = nodes.find((n) => n.type === "textarea" && n.props.rows === 3);
    expect(area).toBeTruthy();
    (area!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: noteText } });
    tree = renderHost();
    nodes = nodesOf(tree);
    expect(nodes.some((n) => n.type === "textarea" && n.props.value === noteText)).toBe(true);

    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        gameId,
        contextId,
        subjectDisplay: "Кирилл",
        text: noteText.trim(),
        version: 1,
        updatedAt: "2026-11-01T01:00:00.000Z",
        allowedActions: { canEdit: true, canDelete: true },
      },
    });
    // Keep GET stable during post-success soft reload.
    vi.mocked(getGameResults).mockResolvedValue({
      ok: true,
      status: 200,
      data: resultsWithFeedback(
        feedbackSlice([
          {
            gameId,
            contextId,
            subjectDisplay: "Кирилл",
            text: noteText.trim(),
            version: 1,
            updatedAt: "2026-11-01T01:00:00.000Z",
            allowedActions: { canEdit: true, canDelete: true },
          },
        ], false),
      ),
    });

    const save = nodes.find((n) => String(n.props.children) === "Сохранить заметку");
    expect(save).toBeTruthy();
    (save!.props.onClick as () => void)();
    tree = await settle();
    nodes = nodesOf(tree);
    // Matching confirmedOperation cleared the create draft; panel stayed mounted through reload.
    expect(nodes.some((n) => n.type === "textarea" && n.props.value === noteText)).toBe(false);
    expect(apiFetch).toHaveBeenCalled();
    expect(vi.mocked(getGameResults).mock.calls.length).toBeGreaterThan(1);
  });

  it("4xx conflict onRefresh soft-reloads without dropping current create draft", async () => {
    await settle();
    let tree = openNotesTab(renderHost());
    let nodes = nodesOf(tree);
    const select = nodes.find((n) => n.type === "select");
    (select!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: contextId } });
    tree = renderHost();
    nodes = nodesOf(tree);
    const area = nodes.find((n) => n.type === "textarea" && n.props.rows === 3);
    (area!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: noteText } });
    tree = renderHost();
    nodes = nodesOf(tree);
    const save = nodes.find((n) => String(n.props.children) === "Сохранить заметку");
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 409,
      error: "conflict",
    });
    (save!.props.onClick as () => void)();
    tree = await settle();
    nodes = nodesOf(tree);
    expect(nodes.some((n) => n.type === "textarea" && n.props.value === noteText)).toBe(true);
    expect(nodes.some((n) => n.type === "select" && n.props.value === contextId)).toBe(true);
  });

  it("changed create draft after submit survives matching confirm through host reload", async () => {
    await settle();
    let tree = openNotesTab(renderHost());
    let nodes = nodesOf(tree);
    const select = nodes.find((n) => n.type === "select");
    (select!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: contextId } });
    tree = renderHost();
    nodes = nodesOf(tree);
    const area = nodes.find((n) => n.type === "textarea" && n.props.rows === 3);
    (area!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: noteText } });
    tree = renderHost();
    nodes = nodesOf(tree);

    let resolvePut: (value: unknown) => void = () => {};
    const deferredPut = new Promise((resolve) => {
      resolvePut = resolve;
    });
    vi.mocked(apiFetch).mockImplementationOnce(() => deferredPut as Promise<never>);

    const save = nodes.find((n) => String(n.props.children) === "Сохранить заметку");
    (save!.props.onClick as () => void)();
    tree = renderHost();
    nodes = nodesOf(tree);
    const inflight = nodes.find((n) => n.type === "textarea" && n.props.value === noteText);
    expect(inflight).toBeTruthy();
    (inflight!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "Уже другой черновик" },
    });

    resolvePut({
      ok: true,
      status: 200,
      data: {
        gameId,
        contextId,
        subjectDisplay: "Кирилл",
        text: noteText.trim(),
        version: 1,
        updatedAt: "2026-11-01T01:00:00.000Z",
        allowedActions: { canEdit: true, canDelete: true },
      },
    });
    tree = await settle();
    nodes = nodesOf(tree);
    expect(nodes.some((n) => n.type === "textarea" && n.props.value === "Уже другой черновик")).toBe(true);
  });

  it("session boundary clears private feedback surface (no retained draft)", async () => {
    await settle();
    let tree = openNotesTab(renderHost());
    let nodes = nodesOf(tree);
    const select = nodes.find((n) => n.type === "select");
    (select!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: contextId } });
    tree = renderHost();
    nodes = nodesOf(tree);
    const area = nodes.find((n) => n.type === "textarea" && n.props.rows === 3);
    (area!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: noteText } });
    expect(nodesOf(renderHost()).some((n) => n.type === "textarea" && n.props.value === noteText)).toBe(true);

    window.dispatchEvent(new Event("gb-session-changed"));
    tree = renderHost();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Войдите, чтобы открыть итоги игры");
    expect(nodesOf(tree).some((n) => n.type === "textarea" && n.props.value === noteText)).toBe(false);
  });

  it("confirmed DELETE through host reload closes matching editor only", async () => {
    vi.mocked(getGameResults).mockResolvedValue({
      ok: true,
      status: 200,
      data: resultsWithFeedback(feedbackSlice([ownNote()], false)),
    });
    await settle();
    let tree = openNotesTab(renderHost());
    let nodes = nodesOf(tree);
    const changeBtn = nodes.find((n) => String(n.props.children) === "Изменить");
    expect(changeBtn).toBeTruthy();
    (changeBtn!.props.onClick as () => void)();
    tree = renderHost();
    nodes = nodesOf(tree);
    const editArea = nodes.find((n) => n.type === "textarea" && n.props.value === "Старая заметка");
    (editArea!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "Текст перед удалением" },
    });
    tree = renderHost();
    nodes = nodesOf(tree);

    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      status: 200,
      data: { gameId, contextId, version: 2, deleted: true },
    });
    vi.mocked(getGameResults).mockResolvedValue({
      ok: true,
      status: 200,
      data: resultsWithFeedback(feedbackSlice([], false)),
    });
    const del = nodes.find((n) => String(n.props.children) === "Удалить");
    expect(del).toBeTruthy();
    (del!.props.onClick as () => void)();
    tree = await settle();
    nodes = nodesOf(tree);
    expect(nodes.some((n) => n.type === "textarea" && n.props.value === "Текст перед удалением")).toBe(
      false,
    );
  });
});
