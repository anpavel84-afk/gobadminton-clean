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

export function isPubliclyVisible(args: {
  slotStatus: string;
  approvedRevisionId: string | null;
  notBefore: Date | null;
  now: Date;
  basisUnderReview: boolean;
}): boolean {
  if (args.basisUnderReview) return false;
  if (!args.approvedRevisionId || !args.notBefore) return false;
  if (args.slotStatus !== "published" && args.slotStatus !== "revision_waiting") return false;
  return args.notBefore.getTime() <= args.now.getTime();
}

export function withinSubmitWindow(args: {
  firstEligibleAt: Date;
  now: Date;
  appealBonusMs?: number;
}): boolean {
  const baseEnd = args.firstEligibleAt.getTime() + VENUE_SUBMIT_WINDOW_MS;
  const end = Math.max(baseEnd, args.firstEligibleAt.getTime() + (args.appealBonusMs ?? 0));
  return args.now.getTime() <= end;
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
