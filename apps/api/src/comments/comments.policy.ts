import { z } from "zod";
import { notFound, unprocessable } from "../auth/problem";
import { SOCIAL_PROFILE_SAFE_DISPLAY_NAME } from "../profiles/social-profile-defaults";

export const ENTITY_COMMENT_KINDS = ["game", "venue"] as const;
export type EntityCommentKind = (typeof ENTITY_COMMENT_KINDS)[number];

export const COMMENT_TEXT_MAX = 1000;
export const COMMENT_PAGE_DEFAULT = 20;
export const COMMENT_PAGE_MAX = 50;

const uuid = z.string().uuid();

export function unicodeLength(value: string): number {
  return [...value].length;
}

export function normalizeCommentText(raw: unknown): string {
  if (typeof raw !== "string") {
    throw unprocessable("COMMENT_TEXT_INVALID", "Некорректный текст комментария");
  }
  // Preserve intentional content; strip only trailing/leading ASCII+Unicode spaces for emptiness.
  const trimmed = raw.replace(/^\s+|\s+$/gu, "");
  if (!trimmed || !/\S/u.test(trimmed)) {
    throw unprocessable("COMMENT_TEXT_EMPTY", "Пустой комментарий недоступен");
  }
  if (unicodeLength(trimmed) > COMMENT_TEXT_MAX) {
    throw unprocessable("COMMENT_TEXT_TOO_LONG", "Комментарий слишком длинный");
  }
  return trimmed;
}

export const createCommentRequest = z
  .object({
    text: z.string(),
    parentCommentId: uuid.nullable().optional(),
  })
  .strict();

export const updateCommentRequest = z
  .object({
    text: z.string(),
    expectedVersion: z.number().int().min(1).max(2147483647),
  })
  .strict();

// Venue-only shape. Shared game normalization remains strict and text-required.
const photoIds = z.array(uuid.transform(v => v.toLowerCase())).max(4).refine(v => new Set(v).size === v.length);
export const createVenueCommentRequest = z.object({
  text: z.string().nullable().optional(), photoIds: photoIds.optional(), parentCommentId: uuid.nullable().optional(),
}).strict();
export const updateVenueCommentRequest = z.object({
  text: z.string().nullable().optional(), photoIds: photoIds.optional(),
  expectedVersion: z.number().int().min(1).max(2147483647),
}).strict();
export function normalizeVenueCommentText(raw: unknown): string | null {
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return null;
  return normalizeCommentText(raw);
}
export function assertCommentContent(text: string | null, ids: readonly string[]): void {
  if (text === null && ids.length === 0) throw unprocessable("COMMUNITY_ENTRY_EMPTY", "Добавьте текст или фото");
}
export type CommentPhotoView = { id: string; width: number; height: number; url: string };

export const deleteCommentRequest = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
  })
  .strict();

export type CreateCommentRequest = z.infer<typeof createCommentRequest>;
export type UpdateCommentRequest = z.infer<typeof updateCommentRequest>;
export type DeleteCommentRequest = z.infer<typeof deleteCommentRequest>;

export type CommentAuthorView = {
  publicPlayerId: string | null;
  displayName: string;
  avatar: { uploadedUrl: string | null; providerUrl: string | null };
  profilePublic: boolean;
};

export type CommentView = {
  id: string;
  entityKind: EntityCommentKind;
  entityId: string;
  parentCommentId: string | null;
  body: string | null;
  deleted: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  mine: boolean;
  author: CommentAuthorView | null;
  replyCount: number;
  photos?: CommentPhotoView[];
};

export type CommentPage = {
  entityKind: EntityCommentKind;
  entityId: string;
  parentCommentId: string | null;
  items: CommentView[];
  nextCursor: string | null;
  visibleCount: number | null;
  canCreate: boolean;
};

export type CommentCursor = {
  createdAt: string;
  id: string;
  entityKind: EntityCommentKind;
  entityId: string;
  parentCommentId: string | null;
  order: "asc" | "desc";
};

export function parse<T>(schema: z.ZodType<T>, input: unknown, code = "COMMENT_INPUT_INVALID"): T {
  const result = schema.safeParse(input);
  if (!result.success) throw unprocessable(code, "Некорректный запрос комментария");
  return result.data;
}

export function parseEntityId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function parseCommentId(raw: string): string {
  const result = uuid.safeParse(raw);
  if (!result.success) unavailable();
  return result.data;
}

export function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return COMMENT_PAGE_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw unprocessable("COMMENT_LIMIT_INVALID", "Некорректный limit");
  }
  return Math.min(n, COMMENT_PAGE_MAX);
}

export function parseOrder(raw: string | undefined): "asc" | "desc" {
  if (raw === undefined || raw === "" || raw === "asc" || raw === "oldest") return "asc";
  if (raw === "desc" || raw === "newest") return "desc";
  throw unprocessable("COMMENT_ORDER_INVALID", "Некорректный порядок");
}

export function encodeCursor(cursor: CommentCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(
  raw: string,
  expected: {
    entityKind: EntityCommentKind;
    entityId: string;
    parentCommentId: string | null;
    order: "asc" | "desc";
  },
): CommentCursor {
  if (raw.length > 2048) {
    throw unprocessable("COMMENT_CURSOR_INVALID", "Некорректный курсор");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw unprocessable("COMMENT_CURSOR_INVALID", "Некорректный курсор");
  }
  const schema = z
    .object({
      createdAt: z.string().datetime({ offset: true }),
      id: uuid,
      entityKind: z.enum(ENTITY_COMMENT_KINDS),
      entityId: uuid,
      parentCommentId: uuid.nullable(),
      order: z.enum(["asc", "desc"]),
    })
    .strict();
  const result = schema.safeParse(parsed);
  if (!result.success) throw unprocessable("COMMENT_CURSOR_INVALID", "Некорректный курсор");
  const cursor = result.data;
  if (
    cursor.entityKind !== expected.entityKind
    || cursor.entityId !== expected.entityId
    || cursor.parentCommentId !== expected.parentCommentId
    || cursor.order !== expected.order
  ) {
    throw unprocessable("COMMENT_CURSOR_MISMATCH", "Курсор не принадлежит этому списку");
  }
  return cursor;
}

export function genericAuthor(): CommentAuthorView {
  return {
    publicPlayerId: null,
    displayName: SOCIAL_PROFILE_SAFE_DISPLAY_NAME,
    avatar: { uploadedUrl: null, providerUrl: null },
    profilePublic: false,
  };
}

export function projectDeletedBody(): null {
  return null;
}
