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
  const match = path.match(/\/v1\/games\/([^/]+)/);
  return match?.[1] ?? null;
}

function pathAttendanceContextId(path: string): string | null {
  const match = path.match(/\/attendance\/([^/]+)/);
  return match?.[1] ?? null;
}

/** Authoritative 2xx must match frozen operation/target; malformed/cross-context keeps UNKNOWN. */
export function validateGameResultsSuccess(
  data: GameResultsMutationData,
  pending?: SocialMutationPending,
): boolean {
  if (!pending || data == null || typeof data !== "object") return false;
  const expectedGameId = pathGameId(pending.path);
  if (!expectedGameId) return false;

  if (pending.path.includes("/bulk-present")) {
    const body = data as { items?: AttendanceRecord[] };
    if (!Array.isArray(body.items)) return false;
    return body.items.every(
      (item) =>
        item &&
        typeof item.contextId === "string" &&
        typeof item.version === "number" &&
        item.version >= 1,
    );
  }

  if (pending.path.includes("/disputes") && !pending.path.includes("/attendance-disputes")) {
    const dispute = data as AttendanceDispute;
    return (
      typeof dispute.id === "string" &&
      dispute.gameId === expectedGameId &&
      (dispute.status === "open" || dispute.status === "withdrawn")
    );
  }

  if (pending.path.includes("/acknowledgements") || /\/attendance\/[^/]+$/.test(pending.path)) {
    const record = data as AttendanceRecord;
    const contextId = pathAttendanceContextId(pending.path);
    return (
      !!contextId &&
      record.contextId === contextId &&
      typeof record.version === "number" &&
      record.version >= 0 &&
      (record.value === "present" || record.value === "absent" || record.value === "unknown")
    );
  }

  if (pending.path.endsWith("/outcome") || pending.path.includes("/outcome")) {
    const results = data as GameResults;
    return results.gameId === expectedGameId && !!results.outcome && typeof results.outcome.version === "number";
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
    { validateSuccess: validateGameResultsSuccess },
  );
}
