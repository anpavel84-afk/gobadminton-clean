import { createHmac } from "node:crypto";

/** Namespace for exact live message content fingerprints (HMAC hex, not body). */
export const MESSAGE_REPORT_FINGERPRINT_NS = "message-report-fingerprint:v1" as const;

export type MessageReportConversationKind = "direct" | "game";

export type MessageSourceAvailability =
  | { available: true }
  | {
      available: false;
      reason: "purged" | "tombstoned" | "null_expiry" | "expired" | "empty_body" | "fingerprint_mismatch";
    };

/**
 * Exact-content HMAC for a live message body. Fail-closed caller must require secret.
 * Binds message identity + conversation + seq so fingerprint is not body-only.
 */
export function messageReportContentFingerprint(
  secret: string,
  input: {
    messageId: string;
    conversationId: string;
    seq: string | number;
    bodyText: string;
  },
): string {
  return createHmac("sha256", secret)
    .update(
      `${MESSAGE_REPORT_FINGERPRINT_NS}:${input.messageId}:${input.conversationId}:${String(input.seq)}:`,
    )
    .update(input.bodyText, "utf8")
    .digest("hex");
}

/**
 * Exact-source body may be shown only while the original message is live and its
 * existing purge_eligible_at is finite and strictly in the future. NULL expiry is
 * unavailable (Owner legacy question unanswered). Never invents TTL or copies body.
 */
export function evaluateMessageExactSourceAvailability(input: {
  contentState: string;
  bodyText: string | null;
  purgeEligibleAt: Date | string | null;
  now?: Date;
  expectedFingerprint?: string;
  currentFingerprint?: string;
}): MessageSourceAvailability {
  if (input.contentState === "purged") return { available: false, reason: "purged" };
  if (input.contentState === "tombstoned") return { available: false, reason: "tombstoned" };
  if (input.contentState !== "live") return { available: false, reason: "purged" };
  if (input.bodyText == null || input.bodyText.length < 1) {
    return { available: false, reason: "empty_body" };
  }
  if (input.purgeEligibleAt == null) {
    return { available: false, reason: "null_expiry" };
  }
  const expiry =
    input.purgeEligibleAt instanceof Date
      ? input.purgeEligibleAt
      : new Date(input.purgeEligibleAt);
  if (!Number.isFinite(expiry.getTime())) {
    return { available: false, reason: "null_expiry" };
  }
  const now = input.now ?? new Date();
  if (expiry.getTime() <= now.getTime()) {
    return { available: false, reason: "expired" };
  }
  if (
    input.expectedFingerprint != null &&
    input.currentFingerprint != null &&
    input.expectedFingerprint !== input.currentFingerprint
  ) {
    return { available: false, reason: "fingerprint_mismatch" };
  }
  return { available: true };
}
