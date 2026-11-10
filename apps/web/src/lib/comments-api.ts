import { apiFetch, type ApiResult } from "./api-client";
import type {
  CommentEntityKind,
  CommentPhoto,
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
    && Number.isInteger(row.version) && row.version >= 1
    && typeof row.deleted === "boolean"
    && (row.body === null || typeof row.body === "string")
    && validCommentPhotos(row);
}

/** Only current, same-comment, version-bound relative URLs are accepted. */
export function validCommentPhotos(row: Pick<EntityComment, "id" | "version" | "entityKind" | "deleted" | "photos">): boolean {
  if (row.photos === undefined) return true; // legacy text DTO
  if (!Array.isArray(row.photos) || row.photos.length > 4) return false;
  if ((row.entityKind === "game" || row.deleted) && row.photos.length) return false;
  if (row.photos.length && !isPhotoId(row.id)) return false;
  const ids = new Set<string>();
  return row.photos.every((photo: CommentPhoto) => {
    if (!photo || !isPhotoId(photo.id) || ids.has(photo.id)) return false;
    ids.add(photo.id);
    return Number.isInteger(photo.width) && photo.width > 0 && photo.width <= 1600
      && Number.isInteger(photo.height) && photo.height > 0 && photo.height <= 1600
      && photo.url === `/v1/comments/${row.id}/revisions/${row.version}/photos/${photo.id}`;
  });
}

export function isPhotoId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function validPhotoIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 4 && value.every(isPhotoId) && new Set(value).size === value.length;
}

/** Presentation only: each original grapheme is unchanged or fully replaced by
 * one ASCII '*' per original codepoint. NFKC is used solely to check whether that
 * grapheme represents letters/marks/numbers or @/$; it never rewrites the output.
 * Whitespace, punctuation, unrelated text and changed lengths fail closed.
 * No dictionary, classification or content approval is performed here.
 */
export function commentPresentationMatches(actual: string | null, submitted: string | null | undefined): boolean {
  const text = submitted?.trim() || null;
  if (actual === text) return true;
  if (actual === null || text === null) return false;
  const output = [...actual];
  if ([...text].length !== output.length) return false;
  let offset = 0;
  for (const { segment } of new Intl.Segmenter("ru", { granularity: "grapheme" }).segment(text)) {
    const width = [...segment].length;
    const presented = output.slice(offset, offset + width).join("");
    if (presented !== segment && (presented !== "*".repeat(width)
      || !/^[\p{L}\p{M}\p{N}@$]+$/u.test(segment.normalize("NFKC")))) return false;
    offset += width;
  }
  return offset === output.length;
}

export function isCommentCreateBody(body: object): body is CreateCommentBody {
  const value = body as CreateCommentBody;
  return (value.text == null || typeof value.text === "string")
    && (value.photoIds === undefined || validPhotoIds(value.photoIds))
    && Boolean(value.text?.trim() || value.photoIds?.length)
    && (value.parentCommentId == null || typeof value.parentCommentId === "string");
}

export function isCommentUpdateBody(body: object): body is UpdateCommentBody {
  const value = body as UpdateCommentBody;
  return (value.text == null || typeof value.text === "string")
    && (value.photoIds === undefined || validPhotoIds(value.photoIds))
    && Number.isInteger(value.expectedVersion) && value.expectedVersion >= 1;
}

export function isCommentDeleteBody(body: object): body is DeleteCommentBody {
  const value = body as DeleteCommentBody;
  return Number.isInteger(value.expectedVersion) && value.expectedVersion >= 1;
}


/** One current authorized source read; never scans list pages or follows source paths. */
export function getCommentDetail(commentId: string, signal: AbortSignal) {
  return apiFetch<unknown>(`/v1/comments/${encodeURIComponent(commentId)}`, { signal, cache: "no-store" });
}
export function isCurrentPhotoSource(value: unknown, photo: import("./comments-types").VenueCommunityPhoto): value is EntityComment {
  if (!isCommentView(value)) return false;
  const row = value;
  const author = row.author;
  return row.id === photo.source.commentId && row.entityKind === "venue" && isPhotoId(row.entityId)
    && row.version === photo.source.resourceVersion && !row.deleted
    && row.parentCommentId === photo.source.parentCommentId
    && typeof row.mine === "boolean" && typeof row.edited === "boolean"
    && Number.isInteger(row.replyCount) && row.replyCount >= 0
    && typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt))
    && typeof row.updatedAt === "string" && Number.isFinite(Date.parse(row.updatedAt))
    && (author === null || (typeof author === "object" && typeof author.displayName === "string"
      && (author.publicPlayerId === null || typeof author.publicPlayerId === "string")
      && typeof author.profilePublic === "boolean" && !!author.avatar
      && (author.avatar.uploadedUrl === null || typeof author.avatar.uploadedUrl === "string")
      && (author.avatar.providerUrl === null || typeof author.avatar.providerUrl === "string")))
    && Boolean(row.photos?.some((item) => item.id === photo.id && item.url === photo.url
      && item.width === photo.width && item.height === photo.height));
}
