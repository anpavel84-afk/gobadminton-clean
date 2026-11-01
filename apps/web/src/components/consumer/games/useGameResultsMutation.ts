"use client";

import type {
  AttendanceDispute,
  AttendanceRecord,
  GameResults,
} from "../../../lib/consumer-types";
import {
  type SocialMutationPending,
  useSocialMutation,
} from "../messages/useSocialMutation";

export type GameResultsMutationData =
  | AttendanceRecord
  | AttendanceDispute
  | GameResults
  | { items: AttendanceRecord[] };

/**
 * Narrow domain host over useSocialMutation: immutable actor+game scope so a
 * prior actor/context pending cannot commit into a new session host. No new
 * mutation framework — persistence/idempotency/UNKNOWN semantics stay shared.
 */
export function gameResultsMutationScope(actorId: string, gameId: string): string {
  return `${actorId}:game-results:${gameId}`;
}

function pathGameId(path: string): string | null {
  const match = path.match(/^\/v1\/games\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function pathAttendanceContextId(path: string): string | null {
  const match = path.match(/^\/v1\/games\/[^/]+\/attendance\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonNegInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** ACK targets a real assertion version — 0/negative/non-integer are not admitable. */
function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

type BulkRequestItem = { contextId: string; expectedVersion: number };

function parseBulkRequestItems(body: object): BulkRequestItem[] | null {
  if (!isObject(body) || !Array.isArray(body.items)) return null;
  const items: BulkRequestItem[] = [];
  for (const raw of body.items) {
    if (!isObject(raw) || typeof raw.contextId !== "string" || !raw.contextId) return null;
    const expectedVersion = asNonNegInt(raw.expectedVersion);
    if (expectedVersion == null) return null;
    items.push({ contextId: raw.contextId, expectedVersion });
  }
  return items;
}

type RecognizedAction =
  | { kind: "bulk"; gameId: string }
  | { kind: "mark"; gameId: string; contextId: string }
  | { kind: "ack"; gameId: string; contextId: string }
  | { kind: "dispute"; gameId: string; contextId: string }
  | { kind: "outcome"; gameId: string }
  | { kind: "disputeRespond"; disputeId: string }
  | { kind: "disputeHelp"; disputeId: string }
  | { kind: "disputeWithdraw"; disputeId: string };

function pathDisputeId(path: string): string | null {
  const match = path.match(/^\/v1\/attendance-disputes\/([^/]+)(?:\/(responses|help|withdraw))?$/);
  return match?.[1] ?? null;
}

/** Anchored path+method only — no broad substring fallback. */
export function recognizeGameResultsAction(
  path: string,
  method: string,
): RecognizedAction | null {
  if (method === "POST") {
    const disputeId = pathDisputeId(path);
    if (disputeId && path === `/v1/attendance-disputes/${disputeId}/responses`) {
      return { kind: "disputeRespond", disputeId };
    }
    if (disputeId && path === `/v1/attendance-disputes/${disputeId}/help`) {
      return { kind: "disputeHelp", disputeId };
    }
    if (disputeId && path === `/v1/attendance-disputes/${disputeId}/withdraw`) {
      return { kind: "disputeWithdraw", disputeId };
    }
  }
  const gameId = pathGameId(path);
  if (!gameId) return null;
  if (method === "POST" && path === `/v1/games/${gameId}/attendance/bulk-present`) {
    return { kind: "bulk", gameId };
  }
  if (method === "PUT" && path === `/v1/games/${gameId}/outcome`) {
    return { kind: "outcome", gameId };
  }
  const contextId = pathAttendanceContextId(path);
  if (!contextId || contextId === "bulk-present") return null;
  if (method === "PUT" && path === `/v1/games/${gameId}/attendance/${contextId}`) {
    return { kind: "mark", gameId, contextId };
  }
  if (method === "POST" && path === `/v1/games/${gameId}/attendance/${contextId}/acknowledgements`) {
    return { kind: "ack", gameId, contextId };
  }
  if (method === "POST" && path === `/v1/games/${gameId}/attendance/${contextId}/disputes`) {
    return { kind: "dispute", gameId, contextId };
  }
  return null;
}

/** Restored marker must target this game host with a known action + usable body. */
export function validateGameResultsPending(
  pending: SocialMutationPending,
  gameId: string,
): boolean {
  if (!pending || !gameId) return false;
  if (typeof pending.path !== "string" || typeof pending.method !== "string") return false;
  if (typeof pending.key !== "string" || !pending.key) return false;
  if (!isObject(pending.body)) return false;
  const action = recognizeGameResultsAction(pending.path, pending.method);
  if (!action) return false;
  if ("gameId" in action && action.gameId !== gameId) return false;
  if (!("gameId" in action) && pathGameId(pending.path) != null && pathGameId(pending.path) !== gameId) {
    return false;
  }

  switch (action.kind) {
    case "bulk": {
      const items = parseBulkRequestItems(pending.body);
      if (!items || items.length === 0) return false;
      const ids = items.map((item) => item.contextId);
      return new Set(ids).size === ids.length;
    }
    case "mark": {
      const body = pending.body;
      const expectedVersion = asNonNegInt(body.expectedVersion);
      const value = body.value;
      if (expectedVersion == null) return false;
      if (value !== "present" && value !== "absent" && value !== "unknown") return false;
      if (value === "unknown" && expectedVersion < 1) return false;
      if (value === "present") {
        if (body.late != null && typeof body.late !== "boolean") return false;
      } else if (body.late === true) {
        return false;
      }
      return true;
    }
    case "ack": {
      const body = pending.body as {
        attendanceVersion?: unknown;
        resolvingDisputeId?: unknown;
        expectedDisputeVersion?: unknown;
      };
      if (asPositiveInt(body.attendanceVersion) == null) return false;
      const hasDispute = body.resolvingDisputeId !== undefined;
      const hasVersion = body.expectedDisputeVersion !== undefined;
      if (hasDispute !== hasVersion) return false;
      if (hasDispute) {
        return (
          typeof body.resolvingDisputeId === "string" &&
          body.resolvingDisputeId.length > 0 &&
          asPositiveInt(body.expectedDisputeVersion) != null
        );
      }
      return true;
    }
    case "dispute": {
      const body = pending.body as { attendanceVersion?: unknown; explanation?: unknown };
      return (
        asNonNegInt(body.attendanceVersion) != null &&
        typeof body.explanation === "string" &&
        body.explanation.trim().length > 0
      );
    }
    case "disputeRespond":
    case "disputeHelp": {
      const body = pending.body as { expectedVersion?: unknown; explanation?: unknown };
      return (
        asPositiveInt(body.expectedVersion) != null &&
        typeof body.explanation === "string" &&
        body.explanation.trim().length > 0
      );
    }
    case "disputeWithdraw": {
      return asPositiveInt((pending.body as { expectedVersion?: unknown }).expectedVersion) != null;
    }
    case "outcome": {
      const body = pending.body as { expectedVersion?: unknown; outcome?: unknown };
      const expectedVersion = asNonNegInt(body.expectedVersion);
      return (
        expectedVersion != null && (body.outcome === "held" || body.outcome === "not_held")
      );
    }
    default:
      return false;
  }
}

/** Authoritative 2xx must match frozen operation/target; malformed/cross-context keeps UNKNOWN. */
export function validateGameResultsSuccess(
  data: GameResultsMutationData,
  pending?: SocialMutationPending,
): boolean {
  if (!pending || data == null || typeof data !== "object") return false;
  const action = recognizeGameResultsAction(pending.path, pending.method);
  if (!action) return false;
  if ("gameId" in action) {
    if (!validateGameResultsPending(pending, action.gameId)) return false;
  } else {
    // Dispute-scoped routes are host-bound by dispute id; shape-check without game path.
    if (!validateGameResultsPending(pending, "__dispute_scope__")) return false;
  }

  if (action.kind === "bulk") {
    const requested = parseBulkRequestItems(pending.body);
    if (!requested || requested.length === 0) return false;
    const body = data as { items?: AttendanceRecord[] };
    if (!Array.isArray(body.items)) return false;
    if (body.items.length !== requested.length) return false;

    const expected = new Map<string, number>();
    for (const item of requested) {
      if (expected.has(item.contextId)) return false;
      expected.set(item.contextId, item.expectedVersion);
    }

    const seen = new Set<string>();
    for (const item of body.items) {
      if (!item || typeof item.contextId !== "string") return false;
      if (seen.has(item.contextId)) return false;
      seen.add(item.contextId);
      const expectedVersion = expected.get(item.contextId);
      if (expectedVersion == null) return false;
      if (item.version !== expectedVersion + 1) return false;
      if (item.value !== "present" || item.late !== false) return false;
    }
    if (seen.size !== expected.size) return false;
    for (const contextId of expected.keys()) {
      if (!seen.has(contextId)) return false;
    }
    return true;
  }

  if (action.kind === "mark") {
    const record = data as AttendanceRecord;
    const body = pending.body as {
      expectedVersion: number;
      value: "present" | "absent" | "unknown";
      late?: boolean;
    };
    const late = body.value === "present" ? Boolean(body.late) : false;
    return (
      record.contextId === action.contextId &&
      record.version === body.expectedVersion + 1 &&
      record.value === body.value &&
      record.late === late
    );
  }

  if (action.kind === "ack") {
    const record = data as AttendanceRecord;
    const body = pending.body as {
      attendanceVersion?: unknown;
      resolvingDisputeId?: unknown;
      expectedDisputeVersion?: unknown;
    };
    const attendanceVersion = asPositiveInt(body.attendanceVersion);
    if (attendanceVersion == null) return false;
    const baseOk =
      record.contextId === action.contextId &&
      record.acknowledgedVersion === attendanceVersion &&
      typeof record.version === "number" &&
      record.version === attendanceVersion &&
      // Only present/absent with exact positive version+ack confirm; unknown/malformed stay UNKNOWN.
      (record.value === "present" || record.value === "absent");
    if (!baseOk) return false;
    if (body.resolvingDisputeId != null) {
      return record.dispute == null || record.dispute.status !== "open";
    }
    return true;
  }

  if (action.kind === "dispute") {
    const dispute = data as AttendanceDispute;
    const attendanceVersion = asNonNegInt(
      (pending.body as { attendanceVersion?: unknown }).attendanceVersion,
    );
    if (attendanceVersion == null) return false;
    return (
      typeof dispute.id === "string" &&
      dispute.id.length > 0 &&
      dispute.gameId === action.gameId &&
      dispute.contextId === action.contextId &&
      dispute.challengedVersion === attendanceVersion &&
      dispute.status === "open" &&
      typeof dispute.version === "number" &&
      dispute.version >= 1
    );
  }

  if (
    action.kind === "disputeRespond" ||
    action.kind === "disputeHelp" ||
    action.kind === "disputeWithdraw"
  ) {
    const dispute = data as AttendanceDispute;
    const expectedVersion = asPositiveInt(
      (pending.body as { expectedVersion?: unknown }).expectedVersion,
    );
    if (expectedVersion == null) return false;
    if (dispute.id !== action.disputeId) return false;
    if (typeof dispute.version !== "number" || dispute.version < 1) return false;
    if (action.kind === "disputeWithdraw") {
      return dispute.status === "withdrawn" && dispute.version >= expectedVersion;
    }
    // Response/help leave dispute open and bump version.
    return dispute.status === "open" && dispute.version === expectedVersion + 1;
  }

  if (action.kind === "outcome") {
    const results = data as GameResults;
    const body = pending.body as { expectedVersion: number; outcome: "held" | "not_held" };
    return (
      results.gameId === action.gameId &&
      !!results.outcome &&
      results.outcome.value === body.outcome &&
      results.outcome.version === body.expectedVersion + 1
    );
  }

  return false;
}

export function useGameResultsMutation(
  actorId: string,
  gameId: string,
  csrf: string,
  onSuccess: (data: GameResultsMutationData) => void,
  onRefresh: () => void,
) {
  const persist = Boolean(actorId) && !actorId.startsWith("anon:");
  return useSocialMutation<GameResultsMutationData>(
    gameResultsMutationScope(actorId, gameId),
    csrf,
    onSuccess,
    onRefresh,
    persist,
    {
      validateSuccess: validateGameResultsSuccess,
      validatePending: (pending) => validateGameResultsPending(pending, gameId),
      // Opt-in: unparseable marker stays in storage as HOLD (no overwrite / silent reset).
      holdCorruptStorage: true,
    },
  );
}
