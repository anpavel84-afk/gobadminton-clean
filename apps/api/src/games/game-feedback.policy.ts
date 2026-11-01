import { z } from "zod";
import { badRequest, notFound, serviceUnavailable, unprocessable } from "../auth/problem";
import {
  postGameWritesEnabled,
  uuid,
  type LockedGameRow,
} from "./game-outcomes.policy";

export { postGameWritesEnabled, uuid };
export type { LockedGameRow };

/** Plain text bounds — frozen with OpenAPI 0.23; no invented time windows. */
export const FEEDBACK_COMMENT_MAX = 500;
export const FEEDBACK_REPLY_MAX = 500;
export const FEEDBACK_NOTE_MAX = 500;
export const FEEDBACK_DISCREPANCY_MAX = 500;
export const FEEDBACK_TAGS_MAX = 3;
export const FEEDBACK_ME_REVIEWS_DEFAULT_LIMIT = 20;
export const FEEDBACK_ME_REVIEWS_MAX_LIMIT = 50;
/**
 * Per-actor per-game mutation budget (creates/edits/replies/notes revision inserts).
 * Count cap only — no sliding time window.
 */
export const FEEDBACK_ACTOR_MUTATIONS_PER_GAME_MAX = 80;

export const PEER_TAGS = ["communication", "teamwork", "agreements"] as const;
export type PeerTag = (typeof PEER_TAGS)[number];
export type PeerRating = "play_again" | "neutral" | "difficulties";
export type ReviewKind = "peer" | "organization" | "training";
export type ExperienceAssertion = "i_experienced_this_game";
export type AttendanceContext =
  | "present"
  | "absent"
  | "unknown"
  | "contested"
  | "not_participant_manager"
  | "outcome_not_held";

const plainBounded = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .refine((value) => value.length >= 1 && value.length <= max, { message: "bounds" })
    .refine((value) => {
      for (const ch of value) {
        const code = ch.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f) return false;
      }
      return true;
    }, { message: "plain text" });

const optionalPlain = (max: number) => plainBounded(max).optional();

export const createReviewRequest = z
  .object({
    kind: z.enum(["peer", "organization", "training"]),
    subjectContextId: uuid.optional(),
    peerRating: z.enum(["play_again", "neutral", "difficulties"]).optional(),
    organizationScore: z.number().int().min(1).max(5).optional(),
    comment: optionalPlain(FEEDBACK_COMMENT_MAX),
    tags: z.array(z.enum(PEER_TAGS)).max(FEEDBACK_TAGS_MAX).optional(),
    experienceAssertion: z.literal("i_experienced_this_game"),
    discrepancyExplanation: optionalPlain(FEEDBACK_DISCREPANCY_MAX),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.kind === "peer") {
      if (!body.subjectContextId) {
        ctx.addIssue({ code: "custom", path: ["subjectContextId"], message: "peer subject required" });
      }
      if (!body.peerRating) {
        ctx.addIssue({ code: "custom", path: ["peerRating"], message: "peerRating required" });
      }
      if (body.organizationScore !== undefined) {
        ctx.addIssue({ code: "custom", path: ["organizationScore"], message: "not for peer" });
      }
    } else if (body.kind === "organization") {
      if (body.subjectContextId !== undefined) {
        ctx.addIssue({ code: "custom", path: ["subjectContextId"], message: "not for organization" });
      }
      if (body.peerRating !== undefined) {
        ctx.addIssue({ code: "custom", path: ["peerRating"], message: "not for organization" });
      }
      if (body.tags !== undefined && body.tags.length > 0) {
        ctx.addIssue({ code: "custom", path: ["tags"], message: "not for organization" });
      }
      if (body.organizationScore === undefined && body.comment === undefined) {
        ctx.addIssue({ code: "custom", path: ["organizationScore"], message: "score or comment required" });
      }
    } else {
      if (body.subjectContextId !== undefined) {
        ctx.addIssue({ code: "custom", path: ["subjectContextId"], message: "not for training" });
      }
      if (body.peerRating !== undefined) {
        ctx.addIssue({ code: "custom", path: ["peerRating"], message: "not for training" });
      }
      if (body.organizationScore !== undefined) {
        ctx.addIssue({ code: "custom", path: ["organizationScore"], message: "not for training" });
      }
      if (body.tags !== undefined && body.tags.length > 0) {
        ctx.addIssue({ code: "custom", path: ["tags"], message: "not for training" });
      }
      if (body.comment === undefined) {
        ctx.addIssue({ code: "custom", path: ["comment"], message: "training comment required" });
      }
    }
  });

export type CreateReviewRequest = z.infer<typeof createReviewRequest>;

export const patchReviewRequest = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
    peerRating: z.enum(["play_again", "neutral", "difficulties"]).optional(),
    organizationScore: z.number().int().min(1).max(5).nullable().optional(),
    comment: plainBounded(FEEDBACK_COMMENT_MAX).nullable().optional(),
    tags: z.array(z.enum(PEER_TAGS)).max(FEEDBACK_TAGS_MAX).optional(),
    discrepancyExplanation: plainBounded(FEEDBACK_DISCREPANCY_MAX).nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const editable =
      body.peerRating !== undefined ||
      body.organizationScore !== undefined ||
      body.comment !== undefined ||
      body.tags !== undefined ||
      body.discrepancyExplanation !== undefined;
    if (!editable) {
      ctx.addIssue({ code: "custom", path: ["expectedVersion"], message: "no editable fields" });
    }
  });

export type PatchReviewRequest = z.infer<typeof patchReviewRequest>;

export const putReplyRequest = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483647),
    text: plainBounded(FEEDBACK_REPLY_MAX),
  })
  .strict();

export type PutReplyRequest = z.infer<typeof putReplyRequest>;

export const putNoteRequest = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483647),
    text: plainBounded(FEEDBACK_NOTE_MAX),
  })
  .strict();

export type PutNoteRequest = z.infer<typeof putNoteRequest>;

export const deleteNoteRequest = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
  })
  .strict();

export type DeleteNoteRequest = z.infer<typeof deleteNoteRequest>;

export type ReviewReplyView = {
  text: string;
  version: number;
  editedAt: string | null;
  updatedAt: string;
};

export type ReviewAllowedActions = {
  canEdit: boolean;
  canReply: boolean;
};

export type ReviewView = {
  id: string;
  gameId: string;
  kind: ReviewKind;
  subjectContextId: string | null;
  recipientDisplay: string;
  peerRating: PeerRating | null;
  organizationScore: number | null;
  comment: string | null;
  tags: PeerTag[];
  experienceAssertion: ExperienceAssertion;
  discrepancyExplanation: string | null;
  attendanceContext: AttendanceContext;
  outcomeContext: "unknown" | "held" | "not_held";
  version: number;
  editedAt: string | null;
  createdAt: string;
  direction: "sent" | "received";
  reply: ReviewReplyView | null;
  allowedActions: ReviewAllowedActions;
};

export type PersonalNoteView = {
  gameId: string;
  contextId: string;
  subjectDisplay: string;
  text: string;
  version: number;
  updatedAt: string;
  allowedActions: { canEdit: boolean; canDelete: boolean };
};

export type MeReviewsPage = {
  items: ReviewView[];
  nextCursor: string | null;
};

export type FeedbackCapabilities = {
  installed: boolean;
  writesEnabled: boolean;
  canCreatePeer: boolean;
  canCreateOrganization: boolean;
  canCreateTraining: boolean;
  canCreateNote: boolean;
  peerSubjects: Array<{ contextId: string; displayName: string }>;
  organizationRecipientDisplay: string | null;
  complaintReuse: "existing_player_report";
  remaining: Array<"typed_review_safety_extension">;
};

export type GameFeedbackSlice = {
  installed: boolean;
  writesEnabled: boolean;
  capabilities: FeedbackCapabilities;
  myNotes: PersonalNoteView[];
  gameReviews: ReviewView[];
};

export function parse<T>(schema: z.ZodType<T>, input: unknown, code = "FEEDBACK_INPUT_INVALID"): T {
  const result = schema.safeParse(input);
  if (!result.success) throw unprocessable(code, "Некорректный запрос обратной связи");
  return result.data;
}

export function parseReviewId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function parseContextId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function unavailable(): never {
  throw notFound("GAME_NOT_FOUND", "Игра не найдена");
}

export function privateMissing(): never {
  throw notFound("FEEDBACK_NOT_FOUND", "Запись не найдена");
}

export function writesUnavailable(): never {
  throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись обратной связи недоступна");
}

export function parseMeReviewsLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return FEEDBACK_ME_REVIEWS_DEFAULT_LIMIT;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw badRequest("LIMIT_INVALID", "Некорректный limit");
  }
  const value = Number.parseInt(raw, 10);
  if (value < 1 || value > FEEDBACK_ME_REVIEWS_MAX_LIMIT) {
    throw badRequest("LIMIT_INVALID", "limit должен быть 1–50");
  }
  return value;
}

export function encodeMeReviewsCursor(createdAt: string, id: string, direction: "sent" | "received"): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt, id, direction }), "utf8").toString("base64url");
}

export function decodeMeReviewsCursor(
  cursor: string | undefined,
): { createdAt: string; id: string; direction: "sent" | "received" } | null {
  if (cursor === undefined || cursor === "") return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      createdAt?: unknown;
      id?: unknown;
      direction?: unknown;
    };
    if (
      parsed?.v !== 1 ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      (parsed.direction !== "sent" && parsed.direction !== "received") ||
      !uuid.safeParse(parsed.id).success
    ) {
      throw new Error("shape");
    }
    return { createdAt: parsed.createdAt, id: parsed.id, direction: parsed.direction };
  } catch {
    throw badRequest("CURSOR_INVALID", "Некорректный cursor");
  }
}

export function emptyFeedbackSlice(writesEnabled: boolean): GameFeedbackSlice {
  return {
    installed: false,
    writesEnabled,
    capabilities: {
      installed: false,
      writesEnabled,
      canCreatePeer: false,
      canCreateOrganization: false,
      canCreateTraining: false,
      canCreateNote: false,
      peerSubjects: [],
      organizationRecipientDisplay: null,
      complaintReuse: "existing_player_report",
      remaining: ["typed_review_safety_extension"],
    },
    myNotes: [],
    gameReviews: [],
  };
}

export function needsDiscrepancy(attendanceContext: AttendanceContext): boolean {
  return attendanceContext !== "present" && attendanceContext !== "not_participant_manager";
}

export function assertLifecycleForFeedback(game: LockedGameRow, now: Date): void {
  if (game.status === "draft") {
    throw unprocessable("FEEDBACK_GAME_DRAFT", "Черновик недоступен для обратной связи");
  }
  if (!(game.ends_at.getTime() <= now.getTime())) {
    throw unprocessable("FEEDBACK_BEFORE_END", "Обратная связь доступна только после окончания игры");
  }
  if (game.status !== "published" && game.status !== "completed" && game.status !== "cancelled") {
    throw unprocessable("FEEDBACK_GAME_STATUS", "Обратная связь недоступна в текущем статусе игры");
  }
}
