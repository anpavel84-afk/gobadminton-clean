import { z } from "zod";
import type { AppEnv } from "../config/env";
import { badRequest, notFound, serviceUnavailable, unprocessable } from "../auth/problem";

export const OUTCOME_REASON_MAX = 500;
/** Default / hard cap for manager revision history pages (newest window). */
export const OUTCOME_REVISIONS_DEFAULT_LIMIT = 20;
export const OUTCOME_REVISIONS_MAX_LIMIT = 50;
export const uuid = z.string().uuid().transform((value) => value.toLowerCase());

const plainReason = z
  .string()
  .max(OUTCOME_REASON_MAX)
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1 && value.length <= OUTCOME_REASON_MAX, {
    message: "reason bounds",
  })
  .refine((value) => {
    for (const ch of value) {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return false;
    }
    return true;
  }, { message: "plain text" });

export const putOutcomeRequest = z
  .object({
    expectedVersion: z
      .number()
      .int()
      .min(0)
      .max(2147483647),
    outcome: z.enum(["held", "not_held"]),
    reason: plainReason.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const correction = body.expectedVersion > 0;
    const needsReason = body.outcome === "not_held" || correction;
    if (needsReason && !body.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "reason required" });
    }
    if (!needsReason && body.reason !== undefined) {
      // held initial may omit reason; explicit empty rejected by plainReason.
    }
  });

export type PutOutcomeRequest = z.infer<typeof putOutcomeRequest>;

export type OutcomeValue = "held" | "not_held";
export type OutcomeProjectionValue = "unknown" | OutcomeValue;

export type OutcomeProvenance = {
  source: "manager_explicit";
  /** Timestamp of the current outcome revision (matches latest correction). */
  recordedAt: string;
  /** Immutable first recording time; retained across corrections. */
  createdAt: string;
};

export type OutcomeRevisionView = {
  version: number;
  before: { value: OutcomeValue; reason: string | null } | null;
  after: { value: OutcomeValue; reason: string | null };
  reason: string | null;
  source: "manager_explicit";
  recordedAt: string;
};

export type RevisionsQuery = {
  limit: number;
  /** Exclusive upper bound on resource_version; continues into older history. */
  beforeVersion: number | null;
};

export type RevisionsPage = {
  revisions: OutcomeRevisionView[];
  nextCursor: string | null;
};

export type GameResultsView = {
  gameId: string;
  outcome: {
    value: OutcomeProjectionValue;
    version: number;
    reason: string | null;
    provenance: OutcomeProvenance | null;
  };
  revisions?: OutcomeRevisionView[];
  /** Manager-only; null when the returned window is complete (no older page). */
  revisionsNextCursor?: string | null;
  allowedActions: { canRecordOutcome: boolean };
};

export type OutcomeRow = {
  game_id: string;
  value: OutcomeValue;
  version: number;
  reason: string | null;
  source: "manager_explicit";
  actor_user_id: string;
  recorded_at: Date;
  updated_at: Date;
};

export type LockedGameRow = {
  id: string;
  status: "draft" | "published" | "cancelled" | "completed";
  version: number;
  ends_at: Date;
};

export function parse<T>(schema: z.ZodType<T>, input: unknown, code = "OUTCOME_INPUT_INVALID"): T {
  const result = schema.safeParse(input);
  if (!result.success) throw unprocessable(code, "Некорректный запрос итога");
  return result.data;
}

export function parseGameId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function unavailable(): never {
  throw notFound("GAME_NOT_FOUND", "Игра не найдена");
}

export function writesUnavailable(): never {
  throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись итога недоступна");
}

/** Fail-closed: local synthetic or exact bounded DEV only. PROD never admits writes. */
export function postGameWritesEnabled(env: AppEnv): boolean {
  const local = env.NODE_ENV === "test" && env.APP_ENV === "local";
  const dev =
    env.NODE_ENV === "production" &&
    ["mvp", "stage"].includes(env.APP_ENV) &&
    env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru" &&
    env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru";
  return Boolean(env.POST_GAME_INTERNAL_ENABLED && (local || dev));
}

export function assertLifecycle(game: LockedGameRow, outcome: OutcomeValue, now: Date): void {
  if (game.status === "draft") {
    throw unprocessable("OUTCOME_GAME_DRAFT", "Черновик нельзя отметить как состоявшийся");
  }
  if (!(game.ends_at.getTime() <= now.getTime())) {
    throw unprocessable("OUTCOME_BEFORE_END", "Итог доступен только после окончания игры");
  }
  if (game.status === "cancelled" && outcome === "held") {
    throw unprocessable(
      "OUTCOME_CANCELLED_HELD_FORBIDDEN",
      "Held для отменённой игры требует отдельного case-scoped решения",
    );
  }
  if (game.status !== "published" && game.status !== "completed" && game.status !== "cancelled") {
    throw unprocessable("OUTCOME_GAME_STATUS", "Итог недоступен в текущем статусе игры");
  }
}

export function canRecordHint(
  env: AppEnv,
  role: "manager" | "participant" | "none",
  game: Pick<LockedGameRow, "status" | "ends_at"> | null,
  now: Date,
  installed: boolean,
): boolean {
  if (!installed || role !== "manager" || !game || !postGameWritesEnabled(env)) return false;
  if (!(game.ends_at.getTime() <= now.getTime())) return false;
  return game.status === "published" || game.status === "completed" || game.status === "cancelled";
}

export function unknownOutcome(gameId: string, canRecordOutcome: boolean): GameResultsView {
  return {
    gameId,
    outcome: { value: "unknown", version: 0, reason: null, provenance: null },
    allowedActions: { canRecordOutcome },
  };
}

export function outcomeProvenance(row: Pick<OutcomeRow, "source" | "recorded_at" | "updated_at">): OutcomeProvenance {
  return {
    source: row.source,
    recordedAt: row.updated_at.toISOString(),
    createdAt: row.recorded_at.toISOString(),
  };
}

export function parseRevisionsQuery(input: {
  revisionsLimit?: string;
  revisionsCursor?: string;
}): RevisionsQuery {
  const limit = parseRevisionsLimit(input.revisionsLimit);
  const beforeVersion = decodeRevisionsCursor(input.revisionsCursor);
  return { limit, beforeVersion };
}

export function parseRevisionsLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return OUTCOME_REVISIONS_DEFAULT_LIMIT;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw badRequest("LIMIT_INVALID", "Некорректный revisionsLimit");
  }
  const value = Number.parseInt(raw, 10);
  if (value < 1 || value > OUTCOME_REVISIONS_MAX_LIMIT) {
    throw badRequest("LIMIT_INVALID", "revisionsLimit должен быть 1–50");
  }
  return value;
}

export function encodeRevisionsCursor(beforeVersion: number): string {
  return Buffer.from(JSON.stringify({ v: 1, beforeVersion }), "utf8").toString("base64url");
}

export function decodeRevisionsCursor(cursor: string | undefined): number | null {
  if (cursor === undefined || cursor === "") return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { v?: unknown; beforeVersion?: unknown };
    if (
      parsed?.v !== 1 ||
      typeof parsed.beforeVersion !== "number" ||
      !Number.isInteger(parsed.beforeVersion) ||
      parsed.beforeVersion < 1 ||
      parsed.beforeVersion > 2147483647
    ) {
      throw new Error("shape");
    }
    return parsed.beforeVersion;
  } catch {
    throw badRequest("CURSOR_INVALID", "Некорректный revisionsCursor");
  }
}

/**
 * Newest-first SQL window → ascending projection. `rows` must be DESC by version,
 * length may be limit+1; the extra row signals an older continuation page.
 */
export function pageRevisionsDesc(
  rowsDesc: OutcomeRevisionView[],
  limit: number,
): RevisionsPage {
  const hasOlder = rowsDesc.length > limit;
  const window = hasOlder ? rowsDesc.slice(0, limit) : rowsDesc;
  const revisions = [...window].reverse();
  const oldest = revisions[0];
  return {
    revisions,
    nextCursor: hasOlder && oldest ? encodeRevisionsCursor(oldest.version) : null,
  };
}
