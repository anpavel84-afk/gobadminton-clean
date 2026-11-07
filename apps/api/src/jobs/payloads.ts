/**
 * Job payloads must not carry raw coordinates, cell IDs, message bodies,
 * or private PII dumps. Only opaque ids + job kind + optional version fence.
 */
export type SocialExpiryCleanupPayload =
  | {
      kind: "looking_intent";
      userId: string;
      version: number;
    }
  | {
      kind: "dm_request";
      conversationId: string;
      version: number;
    }
  | {
      kind: "invitation";
      invitationId: string;
      version: number;
    }
  | {
      kind: "sweep";
    };

/** #456 message push — message/conversation refs only; no body / endpoint / keys. */
export type WebPushMessageDeliverPayload =
  | {
      kind: "dm_message";
      messageId: string;
      conversationId: string;
      recipientUserId: string;
      authorUserId: string;
    }
  | {
      kind: "game_chat_message";
      messageId: string;
      conversationId: string;
      gameId: string;
      recipientUserId: string;
      authorUserId: string;
    };

/** #496 game business-event push — opaque refs only; no title/body/PII. */
export type WebPushGameEventDeliverPayload = {
  kind:
    | "game_invitation"
    | "participation_confirmed"
    | "participation_rejected"
    | "new_pending_application"
    | "game_cancelled"
    | "outcome_reminder";
  eventKey: string;
  recipientUserId: string;
  actorUserId: string | null;
  gameId: string;
  gameVersion: number;
  invitationId?: string | null;
  participationId?: string | null;
  reminderId?: string | null;
  reminderOrdinal?: number | null;
};

/** #456/#496 push deliver union — recover sweep separate. */
export type WebPushDeliverPayload =
  | WebPushMessageDeliverPayload
  | WebPushGameEventDeliverPayload
  | {
      kind: "recover_intents";
    };

/** #457 internal post-game reminder sweep (no PII / game title in payload). */
export type PostgameRemindersSweepPayload = {
  kind: "sweep";
};

export function isSocialExpiryCleanupPayload(
  value: unknown,
): value is SocialExpiryCleanupPayload {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "sweep") return true;
  if (kind === "looking_intent") {
    const userId = (value as { userId?: unknown }).userId;
    const version = (value as { version?: unknown }).version;
    return typeof userId === "string" && typeof version === "number";
  }
  if (kind === "dm_request") {
    const conversationId = (value as { conversationId?: unknown }).conversationId;
    const version = (value as { version?: unknown }).version;
    return typeof conversationId === "string" && typeof version === "number";
  }
  if (kind === "invitation") {
    const invitationId = (value as { invitationId?: unknown }).invitationId;
    const version = (value as { version?: unknown }).version;
    return typeof invitationId === "string" && typeof version === "number";
  }
  return false;
}

const GAME_EVENT_KINDS = new Set([
  "game_invitation",
  "participation_confirmed",
  "participation_rejected",
  "new_pending_application",
  "game_cancelled",
  "outcome_reminder",
]);

/** Owner-deferred kinds — never accepted as deliverable payloads. */
const DEFERRED_GAME_EVENT_KINDS = new Set([
  "game_time_changed",
  "game_venue_changed",
]);

export function isWebPushGameEventDeliverPayload(
  value: unknown,
): value is WebPushGameEventDeliverPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (DEFERRED_GAME_EVENT_KINDS.has(String(v.kind))) return false;
  if (!GAME_EVENT_KINDS.has(String(v.kind))) return false;
  if (typeof v.eventKey !== "string" || typeof v.recipientUserId !== "string") {
    return false;
  }
  if (typeof v.gameId !== "string" || typeof v.gameVersion !== "number") {
    return false;
  }
  if (v.actorUserId != null && typeof v.actorUserId !== "string") return false;
  return true;
}

export function isWebPushMessageDeliverPayload(
  value: unknown,
): value is WebPushMessageDeliverPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.messageId !== "string" || typeof v.conversationId !== "string") {
    return false;
  }
  if (typeof v.recipientUserId !== "string" || typeof v.authorUserId !== "string") {
    return false;
  }
  if (v.kind === "dm_message") return true;
  if (v.kind === "game_chat_message") return typeof v.gameId === "string";
  return false;
}

export function isWebPushDeliverPayload(
  value: unknown,
): value is WebPushDeliverPayload {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "recover_intents") return true;
  return (
    isWebPushMessageDeliverPayload(value) ||
    isWebPushGameEventDeliverPayload(value)
  );
}

export function isPostgameRemindersSweepPayload(
  value: unknown,
): value is PostgameRemindersSweepPayload {
  if (!value || typeof value !== "object") return false;
  return (value as { kind?: unknown }).kind === "sweep";
}

/** Safe structured log fields — never dump full job data blobs. */
export function sanitizeJobLogFields(input: {
  queue: string;
  jobId?: string;
  kind?: string;
  userId?: string;
  conversationId?: string;
  invitationId?: string;
  messageId?: string;
  recipientUserId?: string;
  eventKey?: string;
  gameId?: string;
}): Record<string, string | undefined> {
  return {
    event: "job",
    queue: input.queue,
    jobId: input.jobId,
    kind: input.kind,
    // Opaque id only; never lat/lon/cell/message/PII/endpoint.
    userId: input.userId,
    conversationId: input.conversationId,
    invitationId: input.invitationId,
    messageId: input.messageId,
    recipientUserId: input.recipientUserId,
    eventKey: input.eventKey,
    gameId: input.gameId,
  };
}
