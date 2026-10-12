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

/** Safe structured log fields — never dump full job data blobs. */
export function sanitizeJobLogFields(input: {
  queue: string;
  jobId?: string;
  kind?: string;
  userId?: string;
  conversationId?: string;
  invitationId?: string;
}): Record<string, string | undefined> {
  return {
    event: "job",
    queue: input.queue,
    jobId: input.jobId,
    kind: input.kind,
    // Opaque id only; never lat/lon/cell/message/PII.
    userId: input.userId,
    conversationId: input.conversationId,
    invitationId: input.invitationId,
  };
}
