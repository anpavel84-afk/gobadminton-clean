import { apiFetch } from "./api-client";
import type {
  CommentEntityKind,
  CreateCommentBody,
  DeleteCommentBody,
  EntityComment,
  EntityCommentPage,
  UpdateCommentBody,
} from "./comments-types";

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
