"use client";

import type {
  AttendanceDispute,
  AttendanceRecord,
  GamePersonalNote,
  GameResults,
  GameReview,
} from "../../../lib/consumer-types";
import {
  type SocialMutationPending,
  useSocialMutation,
} from "../messages/useSocialMutation";

export type GameResultsMutationData =
  | AttendanceRecord
  | AttendanceDispute
  | GameResults
  | GameReview
  | GamePersonalNote
  | { items: AttendanceRecord[] }
  | { gameId: string; contextId: string; version: number; deleted: true };

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

/**
 * Normalize optional review text the same way create stores omitted/blank as null.
 * Returns false when the wire value is an unexpected type (keep UNKNOWN).
 */
function normalizeOptionalReviewText(value: unknown): string | null | false {
  if (value == null) return null;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const PEER_REVIEW_TAGS = new Set(["communication", "teamwork", "agreements"]);

function normalizeReviewTags(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !PEER_REVIEW_TAGS.has(item)) return null;
    tags.push(item);
  }
  return tags;
}

function sameReviewTags(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
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
  | { kind: "disputeWithdraw"; disputeId: string }
  | { kind: "reviewCreate"; gameId: string }
  | { kind: "reviewPatch"; reviewId: string }
  | { kind: "reviewReply"; reviewId: string }
  | { kind: "notePut"; gameId: string; contextId: string }
  | { kind: "noteDelete"; gameId: string; contextId: string };

function pathDisputeId(path: string): string | null {
  const match = path.match(/^\/v1\/attendance-disputes\/([^/]+)(?:\/(responses|help|withdraw))?$/);
  return match?.[1] ?? null;
}

function pathReviewId(path: string): string | null {
  const match = path.match(/^\/v1\/reviews\/([^/]+)(?:\/reply)?$/);
  return match?.[1] ?? null;
}

function pathNoteContextId(path: string): string | null {
  const match = path.match(/^\/v1\/games\/[^/]+\/notes\/([^/]+)$/);
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
  const reviewId = pathReviewId(path);
  if (reviewId) {
    if (method === "PATCH" && path === `/v1/reviews/${reviewId}`) {
      return { kind: "reviewPatch", reviewId };
    }
    if (method === "PUT" && path === `/v1/reviews/${reviewId}/reply`) {
      return { kind: "reviewReply", reviewId };
    }
  }
  const gameId = pathGameId(path);
  if (!gameId) return null;
  if (method === "POST" && path === `/v1/games/${gameId}/attendance/bulk-present`) {
    return { kind: "bulk", gameId };
  }
  if (method === "POST" && path === `/v1/games/${gameId}/reviews`) {
    return { kind: "reviewCreate", gameId };
  }
  if (method === "PUT" && path === `/v1/games/${gameId}/outcome`) {
    return { kind: "outcome", gameId };
  }
  const noteContextId = pathNoteContextId(path);
  if (noteContextId) {
    if (method === "PUT" && path === `/v1/games/${gameId}/notes/${noteContextId}`) {
      return { kind: "notePut", gameId, contextId: noteContextId };
    }
    if (method === "DELETE" && path === `/v1/games/${gameId}/notes/${noteContextId}`) {
      return { kind: "noteDelete", gameId, contextId: noteContextId };
    }
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
  if (gameId === "__dispute_scope__") {
    // Dispute-scoped host validation bypasses game path equality below.
  } else if ("gameId" in action && action.gameId !== gameId) {
    return false;
  } else if (
    !("gameId" in action) &&
    pathGameId(pending.path) != null &&
    pathGameId(pending.path) !== gameId &&
    action.kind !== "reviewPatch" &&
    action.kind !== "reviewReply"
  ) {
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
    case "reviewCreate": {
      const body = pending.body as { kind?: unknown; experienceAssertion?: unknown };
      return (
        (body.kind === "peer" || body.kind === "organization" || body.kind === "training") &&
        body.experienceAssertion === "i_experienced_this_game"
      );
    }
    case "reviewPatch": {
      return asPositiveInt((pending.body as { expectedVersion?: unknown }).expectedVersion) != null;
    }
    case "reviewReply": {
      const body = pending.body as { expectedVersion?: unknown; text?: unknown };
      return (
        asNonNegInt(body.expectedVersion) != null &&
        typeof body.text === "string" &&
        body.text.trim().length > 0
      );
    }
    case "notePut": {
      const body = pending.body as { expectedVersion?: unknown; text?: unknown };
      return (
        asNonNegInt(body.expectedVersion) != null &&
        typeof body.text === "string" &&
        body.text.trim().length > 0
      );
    }
    case "noteDelete": {
      return asPositiveInt((pending.body as { expectedVersion?: unknown }).expectedVersion) != null;
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
      const expectedDisputeVersion = asPositiveInt(body.expectedDisputeVersion);
      if (typeof body.resolvingDisputeId !== "string" || !body.resolvingDisputeId) return false;
      if (expectedDisputeVersion == null) return false;
      const receipt = record.resolvedDispute;
      // Open-dispute summary absence / unrelated withdrawn is NOT proof of exact closure.
      if (!receipt || typeof receipt !== "object") return false;
      return (
        receipt.id === body.resolvingDisputeId &&
        receipt.status === "resolved" &&
        receipt.resultingVersion === expectedDisputeVersion + 1 &&
        receipt.contextId === action.contextId &&
        receipt.attendanceVersion === attendanceVersion
      );
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

  if (action.kind === "reviewCreate") {
    const review = data as GameReview;
    const body = pending.body as {
      kind?: unknown;
      subjectContextId?: unknown;
      peerRating?: unknown;
      organizationScore?: unknown;
      comment?: unknown;
      tags?: unknown;
      experienceAssertion?: unknown;
      discrepancyExplanation?: unknown;
    };
    // Explicit duplicate 200 returns the prior owned projection without applying a new body.
    // Same-body idempotent replay is valid; mismatched requested fields stay UNKNOWN.
    if (typeof review.id !== "string" || !review.id) return false;
    if (review.gameId !== action.gameId) return false;
    if (review.direction !== "sent") return false;
    if (typeof review.version !== "number" || review.version < 1) return false;
    if (body.kind !== "peer" && body.kind !== "organization" && body.kind !== "training") {
      return false;
    }
    if (review.kind !== body.kind) return false;
    if (review.experienceAssertion !== "i_experienced_this_game") return false;
    if (body.experienceAssertion !== "i_experienced_this_game") return false;
    if (review.experienceAssertion !== body.experienceAssertion) return false;

    const requestedComment = normalizeOptionalReviewText(body.comment);
    const requestedDiscrepancy = normalizeOptionalReviewText(body.discrepancyExplanation);
    if (requestedComment === false || requestedDiscrepancy === false) return false;
    const responseComment = normalizeOptionalReviewText(review.comment);
    const responseDiscrepancy = normalizeOptionalReviewText(review.discrepancyExplanation);
    if (responseComment === false || responseDiscrepancy === false) return false;
    if (responseComment !== requestedComment) return false;
    if (responseDiscrepancy !== requestedDiscrepancy) return false;

    if (body.kind === "peer") {
      if (typeof body.subjectContextId !== "string" || !body.subjectContextId) return false;
      if (review.subjectContextId !== body.subjectContextId) return false;
      if (
        body.peerRating !== "play_again" &&
        body.peerRating !== "neutral" &&
        body.peerRating !== "difficulties"
      ) {
        return false;
      }
      if (review.peerRating !== body.peerRating) return false;
      if (review.organizationScore != null) return false;
      const requestedTags = normalizeReviewTags(body.tags);
      if (requestedTags == null) return false;
      if (!sameReviewTags(review.tags ?? [], requestedTags)) return false;
      return true;
    }

    if (review.subjectContextId != null) return false;
    if (review.peerRating != null) return false;
    if ((review.tags ?? []).length > 0) return false;
    if (body.tags !== undefined) {
      const requestedTags = normalizeReviewTags(body.tags);
      if (requestedTags == null || requestedTags.length > 0) return false;
    }

    if (body.kind === "organization") {
      const requestedScore =
        body.organizationScore === undefined ? null : asPositiveInt(body.organizationScore);
      if (body.organizationScore !== undefined && requestedScore == null) return false;
      if (requestedScore != null && (requestedScore < 1 || requestedScore > 5)) return false;
      if (review.organizationScore !== requestedScore) return false;
      if (requestedScore == null && requestedComment == null) return false;
      return true;
    }

    // training
    if (review.organizationScore != null) return false;
    if (body.organizationScore !== undefined) return false;
    if (requestedComment == null) return false;
    return true;
  }

  if (action.kind === "reviewPatch") {
    const review = data as GameReview;
    const expectedVersion = asPositiveInt(
      (pending.body as { expectedVersion?: unknown }).expectedVersion,
    );
    return (
      expectedVersion != null &&
      review.id === action.reviewId &&
      review.direction === "sent" &&
      review.version === expectedVersion + 1
    );
  }

  if (action.kind === "reviewReply") {
    const review = data as GameReview;
    const expectedVersion = asNonNegInt(
      (pending.body as { expectedVersion?: unknown }).expectedVersion,
    );
    return (
      expectedVersion != null &&
      review.id === action.reviewId &&
      review.direction === "received" &&
      !!review.reply &&
      review.reply.version === expectedVersion + 1
    );
  }

  if (action.kind === "notePut") {
    const note = data as GamePersonalNote;
    const expectedVersion = asNonNegInt(
      (pending.body as { expectedVersion?: unknown }).expectedVersion,
    );
    return (
      expectedVersion != null &&
      note.gameId === action.gameId &&
      note.contextId === action.contextId &&
      note.version === expectedVersion + 1 &&
      typeof note.text === "string"
    );
  }

  if (action.kind === "noteDelete") {
    const receipt = data as { gameId: string; contextId: string; version: number; deleted: true };
    const expectedVersion = asPositiveInt(
      (pending.body as { expectedVersion?: unknown }).expectedVersion,
    );
    return (
      expectedVersion != null &&
      receipt.gameId === action.gameId &&
      receipt.contextId === action.contextId &&
      receipt.deleted === true &&
      receipt.version >= expectedVersion
    );
  }

  return false;
}

export type GameResultsMutationApi = ReturnType<typeof useGameResultsMutation>;

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
