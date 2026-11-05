import { createHash, randomBytes } from "node:crypto";
import { badRequest, notFound, serviceUnavailable, unprocessable } from "../auth/problem";
import { postGameWritesEnabled, uuid } from "../games/game-outcomes.policy";

export { postGameWritesEnabled, uuid };

export const VENUE_REVIEW_TEXT_MAX = 500;
export const VENUE_REVIEW_TOPICS_MAX = 3;
export const VENUE_REVIEW_PAGE_DEFAULT = 20;
export const VENUE_REVIEW_PAGE_MAX = 50;
export const VENUE_SUBMIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const VENUE_APPEAL_MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const VENUE_PUBLICATION_DELAY_MS = 48 * 60 * 60 * 1000;

export const VENUE_TOPICS = ["surface", "lighting", "amenities"] as const;
export type VenueTopic = (typeof VENUE_TOPICS)[number];
export type VenueAudience = "self_draft" | "public_venue";

export const PUBLIC_AUTHOR_LABEL = "Участник игры" as const;

export function opaqueHandle(): string {
  return randomBytes(16).toString("hex");
}

export function projectionHash(parts: {
  canonicalVenueId: string;
  audience: "public_venue";
  text: string;
  topics: string[];
}): string {
  const payload = JSON.stringify({
    canonicalVenueId: parts.canonicalVenueId.toLowerCase(),
    audience: parts.audience,
    text: parts.text,
    topics: [...parts.topics].sort(),
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function topicsAllowed(topics: string[]): boolean {
  if (topics.length > VENUE_REVIEW_TOPICS_MAX) return false;
  const set = new Set<string>(VENUE_TOPICS);
  return topics.every((t) => set.has(t));
}

/** notBefore = max(approvedAt, lastMaterialEditAt + 48h). */
export function computeNotBefore(approvedAt: Date, lastMaterialEditAt: Date): Date {
  const delayed = new Date(lastMaterialEditAt.getTime() + VENUE_PUBLICATION_DELAY_MS);
  return approvedAt.getTime() >= delayed.getTime() ? approvedAt : delayed;
}

/**
 * Public visibility for an already-approved revision.
 * Reports / basis_under_review alone must not hide published criticism;
 * independent remove or author withdraw changes status instead.
 */
export function isPubliclyVisible(args: {
  slotStatus: string;
  approvedRevisionId: string | null;
  notBefore: Date | null;
  now: Date;
  basisUnderReview: boolean;
}): boolean {
  void args.basisUnderReview;
  if (!args.approvedRevisionId || !args.notBefore) return false;
  if (args.slotStatus !== "published" && args.slotStatus !== "revision_waiting") return false;
  return args.notBefore.getTime() <= args.now.getTime();
}

/**
 * Earliest moment all eligibility gates were first jointly true.
 * Ordinary attendance toggles / probes must not supply `now`.
 */
export function deriveFirstEligibleAt(parts: {
  endsAt: Date;
  outcomeHeldRecordedAt: Date | null;
  presentPermittedRecordedAt: Date | null;
}): Date | null {
  if (!parts.outcomeHeldRecordedAt || !parts.presentPermittedRecordedAt) return null;
  return new Date(
    Math.max(
      parts.endsAt.getTime(),
      parts.outcomeHeldRecordedAt.getTime(),
      parts.presentPermittedRecordedAt.getTime(),
    ),
  );
}

export type SubmitWindowState = {
  firstEligibleAt: Date;
  now: Date;
  /** Appeal opened and not yet favorably resumed. */
  appealOpen?: boolean;
  remainingMsAtAppeal?: number | null;
  /** After favorable independent resolution: now_at_resolve + max(remaining, 7d). */
  windowDeadlineAt?: Date | null;
};

/** 14-day window from first eligible; appeal pauses remaining; resume grants max(remaining,7d). */
export function withinSubmitWindow(args: SubmitWindowState): boolean {
  if (args.windowDeadlineAt) {
    return args.now.getTime() <= args.windowDeadlineAt.getTime();
  }
  if (args.appealOpen && args.remainingMsAtAppeal != null) {
    return args.remainingMsAtAppeal > 0;
  }
  const baseEnd = args.firstEligibleAt.getTime() + VENUE_SUBMIT_WINDOW_MS;
  return args.now.getTime() <= baseEnd;
}

/** Remaining ms in the active window at `now` (0 if already closed). */
export function remainingSubmitWindowMs(args: {
  firstEligibleAt: Date;
  now: Date;
  windowDeadlineAt?: Date | null;
}): number {
  const end = args.windowDeadlineAt
    ? args.windowDeadlineAt.getTime()
    : args.firstEligibleAt.getTime() + VENUE_SUBMIT_WINDOW_MS;
  return Math.max(0, end - args.now.getTime());
}

/** After favorable appeal resolution: deadline = resolvedAt + max(remaining, 7d). */
export function computeAppealResumeDeadline(args: {
  remainingMsAtAppeal: number;
  resolvedAt: Date;
}): Date {
  const grant = Math.max(args.remainingMsAtAppeal, VENUE_APPEAL_MIN_WINDOW_MS);
  return new Date(args.resolvedAt.getTime() + grant);
}

export function redactPublicCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePublicCursor(raw: string | undefined): { u: string; h: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      u?: unknown;
      h?: unknown;
    };
    if (typeof parsed.u !== "string" || typeof parsed.h !== "string") return null;
    if (!/^[0-9a-f]{32}$/i.test(parsed.h)) return null;
    return { u: parsed.u, h: parsed.h.toLowerCase() };
  } catch {
    return null;
  }
}

export function parseOrThrow<T>(
  schema: { parse: (v: unknown) => T },
  input: unknown,
  code = "VENUE_REVIEW_INPUT_INVALID",
): T {
  try {
    return schema.parse(input);
  } catch {
    throw unprocessable(code, "Некорректные данные");
  }
}

export function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}

export function writesUnavailable(): never {
  throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись недоступна");
}

export function badVenue(): never {
  throw badRequest("VENUE_ID_INVALID", "Некорректный идентификатор площадки");
}
