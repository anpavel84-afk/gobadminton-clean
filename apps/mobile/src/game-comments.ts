import type { Actor } from './participation.ts';
import {
  CommunityError, commentText, cursor, id, invalid, object, version,
} from './venue-community.ts';

export { CommunityError, commentText, cursor, id, invalid };
export type GameCommentError = CommunityError;

function boolean(raw: unknown): boolean { return typeof raw === 'boolean' ? raw : invalid(); }
function text(raw: unknown, max = 1000): string { return typeof raw === 'string' && [...raw].length <= max ? raw : invalid(); }
function date(raw: unknown): string { const result = text(raw, 64); return Number.isFinite(Date.parse(result)) ? result : invalid(); }

export type GameCommentScope = Readonly<{ gameId: string }>;
export type GameComment = {
  id: string; entityKind: 'game'; entityId: string; parentCommentId: string | null; body: string | null;
  deleted: boolean; version: number; createdAt: string; updatedAt: string; edited: boolean; mine: boolean; replyCount: number;
  author: { publicPlayerId: string | null; displayName: string; profilePublic: boolean; avatar: { uploadedUrl: string | null; providerUrl: null } } | null;
};
export type GameCommentPage = {
  entityKind: 'game'; entityId: string; parentCommentId: string | null; items: GameComment[];
  nextCursor: string | null; visibleCount: number | null; canCreate: boolean;
};
export type GameCommentQuery = Readonly<{
  gameId: string; order: 'asc' | 'desc'; parentCommentId: string | null; cursor: string | null;
}>;

export function gameCommentsPath(q: GameCommentQuery): string {
  if (!['asc', 'desc'].includes(q.order)) return invalid();
  return `/games/${id(q.gameId)}/comments?limit=20&order=${q.order}${q.parentCommentId ? `&parentCommentId=${id(q.parentCommentId)}` : ''}${q.cursor ? `&cursor=${encodeURIComponent(cursor(q.cursor)!)}` : ''}`;
}

export function parseGameComment(raw: unknown): GameComment {
  const r = object(raw), commentId = id(r.id), entityId = id(r.entityId);
  if (r.entityKind !== 'game') return invalid();
  const deleted = boolean(r.deleted), body = r.body === null ? null : text(r.body);
  if (deleted && body !== null) return invalid();
  // Games are text-only: reject any photo projection rather than accepting empty arrays as create payload.
  if (r.photos !== undefined) {
    if (!Array.isArray(r.photos) || r.photos.length !== 0) return invalid();
  }
  let author: GameComment['author'] = null;
  if (r.author !== null) {
    const a = object(r.author), avatar = object(a.avatar), profilePublic = boolean(a.profilePublic);
    const publicPlayerId = a.publicPlayerId === null ? null : id(a.publicPlayerId);
    let uploadedUrl: string | null = null;
    if (profilePublic && typeof avatar.uploadedUrl === 'string' && /^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/.test(avatar.uploadedUrl) && !avatar.uploadedUrl.includes('..')) {
      uploadedUrl = avatar.uploadedUrl;
    }
    if (!profilePublic && publicPlayerId !== null) return invalid();
    author = {
      publicPlayerId, profilePublic,
      displayName: profilePublic ? text(a.displayName, 200) : 'Игрок',
      avatar: { uploadedUrl, providerUrl: null },
    };
  }
  return {
    id: commentId, entityKind: 'game', entityId, parentCommentId: r.parentCommentId === null ? null : id(r.parentCommentId),
    body, deleted, version: version(r.version), createdAt: date(r.createdAt), updatedAt: date(r.updatedAt),
    edited: boolean(r.edited), mine: boolean(r.mine), replyCount: version(r.replyCount, 0), author,
  };
}

export function parseGameCommentPage(raw: unknown, scope: GameCommentScope, query: GameCommentQuery): GameCommentPage {
  const r = object(raw);
  if (r.entityKind !== 'game' || id(r.entityId) !== scope.gameId || r.parentCommentId !== query.parentCommentId
    || !Array.isArray(r.items) || r.items.length > 20) return invalid();
  const items = r.items.map(parseGameComment);
  if (items.some(c => c.parentCommentId !== query.parentCommentId || c.entityId !== scope.gameId)
    || new Set(items.map(c => c.id)).size !== items.length) return invalid();
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!, b = items[i]!;
    const comparison = Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
    if (query.order === 'asc' ? comparison >= 0 : comparison <= 0) return invalid();
  }
  return {
    entityKind: 'game', entityId: scope.gameId, parentCommentId: query.parentCommentId, items,
    nextCursor: cursor(r.nextCursor),
    visibleCount: r.visibleCount === null ? null : version(r.visibleCount, 0),
    canCreate: boolean(r.canCreate),
  };
}

export type GameCommentAction =
  | { kind: 'create'; text: string; parentCommentId: string | null }
  | { kind: 'edit'; comment: GameComment; text: string }
  | { kind: 'delete'; comment: GameComment };

export type GameCommentPacket = Readonly<{
  actor: Readonly<Actor>; scope: GameCommentScope; action: Readonly<GameCommentAction>;
  key: string; method: 'POST' | 'PUT' | 'DELETE'; path: string; body: Readonly<Record<string, unknown>>;
}>;

export function freezeGameCommentPacket(
  actor: Actor, scope: GameCommentScope, action: GameCommentAction, key: string,
): GameCommentPacket {
  id(scope.gameId); id(key);
  let path: string, method: GameCommentPacket['method'], body: Record<string, unknown>;
  if (action.kind === 'create') {
    path = `/games/${scope.gameId}/comments`; method = 'POST';
    // Never emit photoIds — even empty — for game discussion.
    body = {
      text: commentText(action.text),
      ...(action.parentCommentId ? { parentCommentId: id(action.parentCommentId) } : {}),
    };
  } else {
    const c = action.comment;
    if (!c.mine || c.deleted || c.parentCommentId !== null || c.entityKind !== 'game' || c.entityId !== scope.gameId) {
      return invalid();
    }
    path = `/comments/${id(c.id)}`;
    method = action.kind === 'edit' ? 'PUT' : 'DELETE';
    body = { expectedVersion: version(c.version) };
    if (action.kind === 'edit') body.text = commentText(action.text);
  }
  const frozenAction = JSON.parse(JSON.stringify(action)) as GameCommentAction;
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  }
  return deepFreeze({ actor: { ...actor }, scope: { ...scope }, action: frozenAction, key, method, path, body });
}

export function parseGameCommentReceipt(raw: unknown, p: GameCommentPacket): GameComment {
  const a = p.action;
  const c = parseGameComment(raw);
  if (c.body === null && a.kind !== 'delete') return invalid();
  if (!c.mine || c.entityId !== p.scope.gameId
    || c.parentCommentId !== (a.kind === 'create' ? a.parentCommentId : a.comment.parentCommentId)) {
    return invalid();
  }
  if (a.kind === 'create' ? c.version !== 1 || c.deleted
    : c.id !== a.comment.id || c.version !== a.comment.version + 1 || c.deleted !== (a.kind === 'delete')) {
    return invalid();
  }
  return c;
}

export function gameCommentNotice(error: unknown): string {
  if (error instanceof CommunityError) {
    if (error.code === 'PUBLIC_TEXT_CONTENT_REJECTED') return 'Измените текст комментария';
    if (error.code === 'MODERATION_TEMPORARILY_UNAVAILABLE' || error.code === 'MODERATION_POLICY_MISMATCH') {
      return 'Проверка текста временно недоступна. Попробуйте позже — прежний текст не изменён.';
    }
    if (error.status === 429) return 'Слишком много запросов. Попробуйте позже.';
    if (error.kind === 'private') return 'Публикация или игра недоступна.';
    if (error.status === 409) return 'Данные изменились. Обновите их и проверьте действие.';
  }
  return 'Не удалось подтвердить результат. Проверьте соединение и обновите данные.';
}

/** Rebuild the closed wire operation; even a forged runtime packet cannot supply a URL/body. */
export function gameCommentWire(packet: GameCommentPacket) {
  const expected = freezeGameCommentPacket(packet.actor, packet.scope, packet.action as GameCommentAction, packet.key);
  if (packet.path !== expected.path || packet.method !== expected.method
    || JSON.stringify(packet.body) !== JSON.stringify(expected.body)) return invalid();
  return { path: expected.path, method: expected.method, body: expected.body };
}
