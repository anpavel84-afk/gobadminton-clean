import { apiFetch, type ApiResult } from "./api-client";
import type {
  CommentEntityKind,
  CreateCommentBody,
  DeleteCommentBody,
  EntityComment,
  EntityCommentPage,
  UpdateCommentBody,
} from "./comments-types";

/**
 * Neutral inline notice for public-comment moderation outcomes.
 * Preserves unsent composer text; never exposes tokens/categories/scores.
 */
export function publicCommentModerationNotice(
  result: Extract<ApiResult<unknown>, { ok: false }> | { code?: string; status?: number },
): string | null {
  const code = "problem" in result
    ? result.problem?.code
    : (result as { code?: string }).code;
  if (code === "PUBLIC_TEXT_CONTENT_REJECTED") {
    const fields = "problem" in result ? result.problem?.fields : undefined;
    if (fields?.text) return fields.text;
    if (fields && Object.keys(fields).length > 0) return Object.values(fields).join(". ");
    return "Измените текст комментария";
  }
  if (code === "MODERATION_TEMPORARILY_UNAVAILABLE" || code === "MODERATION_POLICY_MISMATCH") {
    return "Проверка текста временно недоступна. Попробуйте позже — прежний текст не изменён.";
  }
  if (code === "MODERATION_RATE_LIMITED") {
    return "Слишком много проверок текста. Попробуйте позже.";
  }
  return null;
}

function entityPath(kind: CommentEntityKind, entityId: string): string {
  return kind === "game"
    ? `/v1/games/${encodeURIComponent(entityId)}/comments`
    : `/v1/venues/${encodeURIComponent(entityId)}/comments`;
}

export function listEntityComments(
  kind: CommentEntityKind,
  entityId: string,
  query: {
    cursor?: string | null;
    limit?: number;
    order?: "asc" | "desc";
    parentCommentId?: string | null;
  } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.order) params.set("order", query.order);
  if (query.parentCommentId) params.set("parentCommentId", query.parentCommentId);
  const qs = params.toString();
  return apiFetch<EntityCommentPage>(`${entityPath(kind, entityId)}${qs ? `?${qs}` : ""}`, { signal });
}

export function createEntityCommentPath(kind: CommentEntityKind, entityId: string): string {
  return entityPath(kind, entityId);
}

export function updateEntityCommentPath(commentId: string): string {
  return `/v1/comments/${encodeURIComponent(commentId)}`;
}

export function deleteEntityCommentPath(commentId: string): string {
  return `/v1/comments/${encodeURIComponent(commentId)}`;
}

export function isCommentView(value: unknown): value is EntityComment {
  if (!value || typeof value !== "object") return false;
  const row = value as EntityComment;
  return typeof row.id === "string"
    && (row.entityKind === "game" || row.entityKind === "venue")
    && typeof row.entityId === "string"
    && typeof row.version === "number"
    && typeof row.deleted === "boolean"
    && (row.body === null || typeof row.body === "string");
}

export function isCommentCreateBody(body: object): body is CreateCommentBody {
  return typeof (body as CreateCommentBody).text === "string";
}

export function isCommentUpdateBody(body: object): body is UpdateCommentBody {
  const value = body as UpdateCommentBody;
  return typeof value.text === "string" && typeof value.expectedVersion === "number";
}

export function isCommentDeleteBody(body: object): body is DeleteCommentBody {
  return typeof (body as DeleteCommentBody).expectedVersion === "number";
}
