/**
 * Deterministic local private-message safety (private-local-safety-v1).
 *
 * Finite coverage — not universal AI moderation:
 * - unsafe URL / scheme syntax
 * - basic identical-text flood / short-window send rate
 * - narrowly defined obvious direct threats
 *
 * Plain profanity, negative opinion, quotations and ordinary sports talk alone
 * are NOT violations in private messages. No automatic sanctions. Never calls
 * approveTexts / OpenAI / any external provider. Never logs or returns raw body.
 */

import type { PoolClient } from "pg";
import { problem, conflict, notFound } from "../auth/problem";

export const PRIVATE_TEXT_POLICY_VERSION = "private-local-safety-v1" as const;

/** Max messages one author may insert into one conversation in the rate window. */
export const PRIVATE_SEND_RATE_LIMIT = 20;
/** Sliding window for per-conversation send rate (seconds). */
export const PRIVATE_SEND_RATE_WINDOW_SECONDS = 60;
/** Max identical live body repeats by the same author in one conversation. */
export const PRIVATE_IDENTICAL_REPEAT_LIMIT = 3;
/** Window for identical-body flood detection (seconds). */
export const PRIVATE_IDENTICAL_REPEAT_WINDOW_SECONDS = 120;
/** Global author send cap used before first-DM conversation exists. */
export const PRIVATE_GLOBAL_SEND_RATE_LIMIT = 30;
export const PRIVATE_GLOBAL_SEND_RATE_WINDOW_SECONDS = 60;

export type PrivateTextRejectReason =
  | "unsafe_url"
  | "basic_spam"
  | "repetition"
  | "obvious_direct_threat";

export type PrivateTextContentDecision =
  | { kind: "allow" }
  | { kind: "reject"; reason: PrivateTextRejectReason };

/** Schemes that must never appear as actionable links in private message text. */
const UNSAFE_SCHEME_RE =
  /(?:^|[\s<(["'])(?:javascript|data|vbscript|file|blob)\s*:/i;

/**
 * Narrow explicit threat phrases (normalized lowercase). Whole-phrase / bounded
 * token runs only — criticism, sports talk and quoted speech are not listed.
 */
const OBVIOUS_THREAT_PHRASES = [
  "я тебя убью",
  "я убью тебя",
  "убить тебя",
  "уберу тебя",
  "взорву тебя",
  "взорву ваш",
  "взорву ваш дом",
  "пристрелю тебя",
  "перережу тебе",
  "i will kill you",
  "i'll kill you",
  "im going to kill you",
  "i am going to kill you",
] as const;

/** Compact whitespace + case fold for phrase matching only (body storage unchanged). */
export function normalizePrivateTextForMatch(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

export function evaluatePrivateTextContent(text: string): PrivateTextContentDecision {
  const trimmed = text.trim();
  if (UNSAFE_SCHEME_RE.test(trimmed)) {
    return { kind: "reject", reason: "unsafe_url" };
  }
  // Extremely repetitive character spam (same char ≥40 times contiguous).
  if (/(.)\1{39,}/u.test(trimmed)) {
    return { kind: "reject", reason: "basic_spam" };
  }
  const normalized = normalizePrivateTextForMatch(trimmed);
  for (const phrase of OBVIOUS_THREAT_PHRASES) {
    if (normalized.includes(phrase)) {
      return { kind: "reject", reason: "obvious_direct_threat" };
    }
  }
  return { kind: "allow" };
}

export function throwPrivateTextRejected(
  reason: PrivateTextRejectReason = "basic_spam",
): never {
  void reason;
  throw problem(
    422,
    "PRIVATE_TEXT_CONTENT_REJECTED",
    "Сообщение не отправлено. Измените текст и попробуйте снова.",
  );
}

export function throwPrivateTextRateLimited(retryAfterSeconds: number): never {
  throw problem(
    429,
    "PRIVATE_TEXT_RATE_LIMITED",
    "Слишком много сообщений. Подождите немного и попробуйте снова.",
    undefined,
    Math.max(1, retryAfterSeconds),
  );
}

/**
 * Local syntactic gate + bounded DB rate/repetition counts.
 * Call after access authorization and before INSERT / sequence / push.
 */
export async function assertPrivateMessageSendable(
  client: PoolClient,
  input: {
    authorUserId: string;
    text: string;
    now: Date;
    /** When set, apply per-conversation rate + identical-body flood. */
    conversationId?: string | null;
  },
): Promise<void> {
  const decision = evaluatePrivateTextContent(input.text);
  if (decision.kind === "reject") {
    throwPrivateTextRejected(decision.reason);
  }

  const nowMs = input.now.getTime();
  if (input.conversationId) {
    const rateSince = new Date(
      nowMs - PRIVATE_SEND_RATE_WINDOW_SECONDS * 1000,
    );
    const rate = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM messages
       WHERE author_user_id = $1
         AND conversation_id = $2
         AND created_at > $3`,
      [input.authorUserId, input.conversationId, rateSince],
    );
    if (Number(rate.rows[0]?.c ?? 0) >= PRIVATE_SEND_RATE_LIMIT) {
      throwPrivateTextRateLimited(PRIVATE_SEND_RATE_WINDOW_SECONDS);
    }

    const repeatSince = new Date(
      nowMs - PRIVATE_IDENTICAL_REPEAT_WINDOW_SECONDS * 1000,
    );
    const repeats = await client.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM messages
       WHERE author_user_id = $1
         AND conversation_id = $2
         AND content_state = 'live'
         AND body_text = $3
         AND created_at > $4`,
      [input.authorUserId, input.conversationId, input.text, repeatSince],
    );
    if (Number(repeats.rows[0]?.c ?? 0) >= PRIVATE_IDENTICAL_REPEAT_LIMIT) {
      throwPrivateTextRejected("repetition");
    }
    return;
  }

  const globalSince = new Date(
    nowMs - PRIVATE_GLOBAL_SEND_RATE_WINDOW_SECONDS * 1000,
  );
  const global = await client.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM messages
     WHERE author_user_id = $1 AND created_at > $2`,
    [input.authorUserId, globalSince],
  );
  if (Number(global.rows[0]?.c ?? 0) >= PRIVATE_GLOBAL_SEND_RATE_LIMIT) {
    throwPrivateTextRateLimited(PRIVATE_GLOBAL_SEND_RATE_WINDOW_SECONDS);
  }
}

export type StoredMessagePayloadRow = {
  id: string;
  conversation_id: string;
  seq: string | number;
  created_at: Date;
  kind: string;
  body_text: string | null;
  content_state: "live" | "tombstoned" | "purged";
};

/**
 * Exact live body/kind match for clientMessageId reuse.
 * Purged/tombstoned/unprovable rows fail closed — no fake match, no body retention.
 */
export function assertExactLivePayloadMatch(
  row: StoredMessagePayloadRow,
  expected: { text: string; kind?: string },
): void {
  if (row.content_state !== "live" || row.body_text == null) {
    throw conflict(
      "CLIENT_MESSAGE_ID_UNAVAILABLE",
      "Повтор этой отправки недоступен",
    );
  }
  const kind = expected.kind ?? "text";
  if (row.kind !== kind || row.body_text !== expected.text) {
    throw conflict(
      "CLIENT_MESSAGE_ID_REUSED",
      "clientMessageId уже использован",
    );
  }
}

export function throwClientMessageIdReused(): never {
  throw conflict(
    "CLIENT_MESSAGE_ID_REUSED",
    "clientMessageId уже использован",
  );
}

export function throwClientMessageUnavailable(): never {
  throw conflict(
    "CLIENT_MESSAGE_ID_UNAVAILABLE",
    "Повтор этой отправки недоступен",
  );
}

/** Soft unavailable when destination no longer matches send scope. */
export function throwSendScopeUnavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}
