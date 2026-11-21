import type { CommunityRatingSummary, CommunityOwnVoteResponse, CreateVenueCommunityReportRequest, VenueCommunityReportReceipt } from '../../../packages/contracts/src/venue-community.ts';
import type { Actor } from './participation.ts';
export type { CommunityRatingSummary, CommunityOwnVoteResponse, CreateVenueCommunityReportRequest, VenueCommunityReportReceipt };
export class CommunityError extends Error {
  readonly kind: 'invalid' | 'network' | 'refused' | 'private';
  readonly status: number; readonly code: string;
  constructor(kind: CommunityError['kind'], status = 0, code = '') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
export const invalid = (): never => { throw new CommunityError('invalid'); };
export function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  return raw as Record<string, unknown>;
}
export function id(raw: unknown): string {
  if (typeof raw !== 'string' || raw.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] !== raw) return invalid();
  return raw;
}
export function version(raw: unknown, minimum = 1): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < minimum || raw > 2147483647) return invalid();
  return raw;
}
function boolean(raw: unknown): boolean { return typeof raw === 'boolean' ? raw : invalid(); }
function text(raw: unknown, max = 1000): string { return typeof raw === 'string' && [...raw].length <= max ? raw : invalid(); }
function date(raw: unknown): string { const result = text(raw, 64); return Number.isFinite(Date.parse(result)) ? result : invalid(); }
export function cursor(raw: unknown): string | null {
  return raw === null ? null : typeof raw === 'string' && raw.length > 0 && raw.length <= 4096 && ![...raw].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ? raw : invalid();
}
export function commentText(raw: string): string { const value = text(raw.trim()); return value ? value : invalid(); }
export function safePhotoURL(raw: unknown, commentId: string, photoId: string, resourceVersion: number): string {
  const value = text(raw, 1024);
  // This exact public content route serves only the current approved revision.
  return value === `/v1/comments/${id(commentId)}/revisions/${version(resourceVersion)}/photos/${id(photoId)}` ? value : invalid();
}
export type Scope = Readonly<{ venueId: string; canonicalVenueId: string }>;
export function parseSummary(raw: unknown, requested: string): CommunityRatingSummary {
  const r = object(raw); if (id(r.venueId) !== id(requested)) return invalid();
  const canonicalVenueId = r.canonicalVenueId === null ? null : id(r.canonicalVenueId);
  const state = r.state;
  if (state === 'unavailable') {
    if (r.average !== null || r.count !== null) return invalid();
  } else if (state === 'empty') {
    if (!canonicalVenueId || r.average !== null || r.count !== 0) return invalid();
  } else if (state === 'available') {
    if (!canonicalVenueId || typeof r.average !== 'number' || !Number.isFinite(r.average) || r.average < 1 || r.average > 5 || version(r.count) < 1) return invalid();
  } else return invalid();
  return { venueId: requested, canonicalVenueId, state, average: r.average as number | null, count: r.count as number | null };
}
export function parseSummaries(raw: unknown, requested: string): CommunityRatingSummary {
  const r = object(raw); if (!Array.isArray(r.items) || r.items.length !== 1) return invalid();
  return parseSummary(r.items[0], requested);
}
export function parseOwn(raw: unknown, requested: string): CommunityOwnVoteResponse {
  const r = object(raw), summary = parseSummary(r.summary, requested);
  if (r.own === null) return { own: null, summary };
  const o = object(r.own), actions = object(o.allowedActions);
  if (id(o.venueId) !== requested || id(o.canonicalVenueId) !== summary.canonicalVenueId || !['clear', 'withheld'].includes(String(o.moderationState))) return invalid();
  const value = o.value === null ? null : version(o.value); if (value !== null && value > 5) return invalid();
  return { summary, own: { venueId: requested, canonicalVenueId: summary.canonicalVenueId!, value, version: version(o.version, 0),
    withdrawn: boolean(o.withdrawn), moderationState: o.moderationState as 'clear' | 'withheld', allowedActions: {
      upsert: boolean(actions.upsert), update: boolean(actions.update), withdraw: boolean(actions.withdraw) } } };
}
export type Photo = { id: string; width: number; height: number; url: string };
export type CommunityPhoto = Photo & {
  source: { commentId: string; parentCommentId: string | null; resourceVersion: number; path: string };
};
export type CommunityPhotoPage = { venueId: string; items: CommunityPhoto[]; nextCursor: string | null };

function photoDim(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 1600 ? raw : null;
}

/** Mirrors web `isCommunityPhotoPage`: ≤24 items, nextCursor only on a full page, unique ids, exact photo URL, dims 1..1600. */
export function isCommunityPhotoPage(value: unknown): value is CommunityPhotoPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  if (typeof page.venueId !== 'string' || page.venueId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] !== page.venueId) {
    return false;
  }
  if (!Array.isArray(page.items) || page.items.length > 24) return false;
  const next = page.nextCursor;
  if (!(next === null || typeof next === 'string' && next.length > 0 && next.length <= 1024)) return false;
  if (next !== null && page.items.length !== 24) return false;
  const ids = new Set<string>();
  for (const raw of page.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const photo = raw as Record<string, unknown>;
    if (typeof photo.id !== 'string' || photo.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] !== photo.id) {
      return false;
    }
    if (ids.has(photo.id)) return false;
    ids.add(photo.id);
    const source = photo.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
    const s = source as Record<string, unknown>;
    if (typeof s.commentId !== 'string' || s.commentId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] !== s.commentId) {
      return false;
    }
    if (!(s.parentCommentId === null || typeof s.parentCommentId === 'string'
      && s.parentCommentId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] === s.parentCommentId)) {
      return false;
    }
    if (s.parentCommentId === s.commentId) return false;
    if (typeof s.resourceVersion !== 'number' || !Number.isInteger(s.resourceVersion) || s.resourceVersion < 1) return false;
    if (s.path !== `/v1/comments/${s.commentId}`) return false;
    if (photo.url !== `/v1/comments/${s.commentId}/revisions/${s.resourceVersion}/photos/${photo.id}`) return false;
    if (photoDim(photo.width) === null || photoDim(photo.height) === null) return false;
  }
  return true;
}
export type Comment = {
  id: string; entityKind: 'venue'; entityId: string; parentCommentId: string | null; body: string | null;
  deleted: boolean; version: number; createdAt: string; updatedAt: string; edited: boolean; mine: boolean; replyCount: number;
  author: { publicPlayerId: string | null; displayName: string; profilePublic: boolean; avatar: { uploadedUrl: string | null; providerUrl: null } } | null;
  photos: Photo[];
};
export type Page = { entityKind: 'venue'; entityId: string; parentCommentId: string | null; items: Comment[]; nextCursor: string | null; visibleCount: number | null; canCreate: boolean };
export type Query = Readonly<{ venueId: string; order: 'asc' | 'desc'; parentCommentId: string | null; cursor: string | null }>;
export function commentsPath(q: Query): string {
  if (!['asc','desc'].includes(q.order)) return invalid();
  return `/venues/${id(q.venueId)}/comments?limit=20&order=${q.order}${q.parentCommentId ? `&parentCommentId=${id(q.parentCommentId)}` : ''}${q.cursor ? `&cursor=${encodeURIComponent(cursor(q.cursor)!)}` : ''}`;
}
export function parseComment(raw: unknown): Comment {
  const r = object(raw), commentId = id(r.id), entityId = id(r.entityId);
  if (r.entityKind !== 'venue') return invalid();
  const deleted = boolean(r.deleted), body = r.body === null ? null : text(r.body);
  if (deleted && body !== null) return invalid();
  const photos = r.photos === undefined ? [] : r.photos;
  if (!Array.isArray(photos) || photos.length > 4 || deleted && photos.length) return invalid();
  const parsedPhotos = photos.map(raw => { const p = object(raw), photoId = id(p.id); return { id: photoId, width: version(p.width), height: version(p.height), url: safePhotoURL(p.url, commentId, photoId, version(r.version)) }; });
  if (new Set(parsedPhotos.map(p => p.id)).size !== parsedPhotos.length) return invalid();
  let author: Comment['author'] = null;
  if (r.author !== null) {
    const a = object(r.author), avatar = object(a.avatar), profilePublic = boolean(a.profilePublic);
    const publicPlayerId = a.publicPlayerId === null ? null : id(a.publicPlayerId);
    let uploadedUrl: string | null = null;
    // Only the already projected first-party avatar route can be painted. Provider URLs are discarded.
    if (profilePublic && typeof avatar.uploadedUrl === 'string' && /^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/.test(avatar.uploadedUrl) && !avatar.uploadedUrl.includes('..')) uploadedUrl = avatar.uploadedUrl;
    if (!profilePublic && publicPlayerId !== null) return invalid();
    author = { publicPlayerId, profilePublic, displayName: profilePublic ? text(a.displayName, 200) : 'Игрок', avatar: { uploadedUrl, providerUrl: null } };
  }
  return { id: commentId, entityKind: 'venue', entityId, parentCommentId: r.parentCommentId === null ? null : id(r.parentCommentId),
    body, deleted, version: version(r.version), createdAt: date(r.createdAt), updatedAt: date(r.updatedAt), edited: boolean(r.edited), mine: boolean(r.mine),
    replyCount: version(r.replyCount, 0), author, photos: parsedPhotos };
}
export function parsePage(raw: unknown, scope: Scope, query: Query): Page {
  const r = object(raw);
  if (r.entityKind !== 'venue' || id(r.entityId) !== scope.canonicalVenueId || r.parentCommentId !== query.parentCommentId || !Array.isArray(r.items) || r.items.length > 20) return invalid();
  // The authoritative list queries the canonical family. Older rows retain their origin
  // entityId; the page, rather than a guessed alias, proves membership in this family.
  const items = r.items.map(parseComment);
  if (items.some(c => c.parentCommentId !== query.parentCommentId) || new Set(items.map(c => c.id)).size !== items.length) return invalid();
  for (let i = 1; i < items.length; i++) {
    const a = items[i-1]!, b = items[i]!;
    const comparison = Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
    if (query.order === 'asc' ? comparison >= 0 : comparison <= 0) return invalid();
  }
  return { entityKind: 'venue', entityId: scope.canonicalVenueId, parentCommentId: query.parentCommentId, items, nextCursor: cursor(r.nextCursor),
    visibleCount: r.visibleCount === null ? null : version(r.visibleCount, 0), canCreate: boolean(r.canCreate) };
}
export type Action =
  | { kind: 'upsert'; value: number; expectedVersion: number }
  | { kind: 'withdraw'; expectedVersion: number }
  | { kind: 'create'; text: string; parentCommentId: string | null; parentEntityId: string }
  | { kind: 'edit'; comment: Comment; text: string }
  | { kind: 'delete'; comment: Comment }
  | { kind: 'report'; report: CreateVenueCommunityReportRequest };
export type Packet = Readonly<{ actor: Readonly<Actor>; scope: Scope; action: Readonly<Action>; key: string; method: 'PUT' | 'POST' | 'DELETE'; path: string; body: Readonly<Record<string, unknown>> }>;
export function freezePacket(actor: Actor, scope: Scope, action: Action, key: string): Packet {
  id(scope.venueId); id(scope.canonicalVenueId); id(key);
  let path: string, method: Packet['method'], body: Record<string, unknown>;
  if (action.kind === 'upsert' || action.kind === 'withdraw') {
    path = `/venues/${scope.venueId}/community-rating`; method = action.kind === 'upsert' ? 'PUT' : 'DELETE';
    body = { expectedVersion: version(action.expectedVersion, action.kind === 'upsert' ? 0 : 1) };
    if (action.kind === 'upsert') { if (version(action.value) > 5) return invalid(); body.value = action.value; }
  } else if (action.kind === 'create') {
    path = `/venues/${scope.venueId}/comments`; method = 'POST'; body = { text: commentText(action.text), ...(action.parentCommentId ? { parentCommentId: id(action.parentCommentId) } : {}) };
    id(action.parentEntityId);
  } else if (action.kind === 'edit' || action.kind === 'delete') {
    const c = action.comment; if (!c.mine || c.deleted || c.parentCommentId !== null) return invalid();
    path = `/comments/${id(c.id)}`; method = action.kind === 'edit' ? 'PUT' : 'DELETE'; body = { expectedVersion: version(c.version) };
    if (action.kind === 'edit') { body.text = commentText(action.text); body.photoIds = Object.freeze(c.photos.map(p => id(p.id))); }
  } else {
    const r = action.report;
    if (r.targetKind !== 'venue_community' || r.venueId !== scope.venueId || !['harassment','spam','fake_profile','inappropriate','other'].includes(r.reasonCode)) return invalid();
    if (!['aggregate','own_vote','venue_comment'].includes(r.subjectKind)) return invalid();
    body = { targetKind: 'venue_community', subjectKind: r.subjectKind, venueId: scope.venueId, reasonCode: r.reasonCode, detail: r.detail == null ? null : text(r.detail.trim()) };
    if (r.subjectKind !== 'aggregate') body.expectedVersion = version(r.expectedVersion);
    if (r.subjectKind === 'venue_comment') body.commentId = id(r.commentId);
    path = '/reports'; method = 'POST';
  }
  // Copy the complete action too: a caller cannot rewrite a pending target/photo revision.
  const frozenAction = JSON.parse(JSON.stringify(action)) as Action;
  function deepFreeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
  return deepFreeze({ actor: {...actor}, scope: {...scope}, action: frozenAction, key, method, path, body });
}
export function parseReceipt(raw: unknown, p: Packet): CommunityOwnVoteResponse | Comment | VenueCommunityReportReceipt {
  const a = p.action;
  if (a.kind === 'upsert' || a.kind === 'withdraw') {
    const result = parseOwn(raw, p.scope.venueId), own = result.own;
    if (!own || own.canonicalVenueId !== p.scope.canonicalVenueId || own.version !== a.expectedVersion + 1 || own.moderationState !== 'clear' && own.moderationState !== 'withheld'
      || (a.kind === 'upsert' ? own.withdrawn || own.value !== a.value : !own.withdrawn)) return invalid();
    return result;
  }
  if (a.kind === 'report') { const r = object(raw); if (r.status !== 'submitted') return invalid(); return { reportId: id(r.reportId), status: 'submitted', createdAt: date(r.createdAt) }; }
  const c = parseComment(raw);
  const entityId = a.kind === 'create' ? a.parentEntityId : a.comment.entityId;
  if ((a.kind !== 'delete' && c.body === null) || !c.mine || c.entityId !== entityId || c.parentCommentId !== (a.kind === 'create' ? a.parentCommentId : a.comment.parentCommentId)) return invalid();
  if (a.kind === 'create' ? c.version !== 1 || c.deleted : c.id !== a.comment.id || c.version !== a.comment.version + 1 || c.deleted !== (a.kind === 'delete')) return invalid();
  if (a.kind === 'edit' && (c.photos.map(p => p.id).join() !== a.comment.photos.map(p => p.id).join())) return invalid();
  // Public body masking is server presentation, not local approval or a raw-text equality check.
  return c;
}
export function notice(error: unknown): string {
  if (error instanceof CommunityError) {
    if (error.code === 'PUBLIC_TEXT_CONTENT_REJECTED') return 'Измените текст комментария';
    if (error.code === 'MODERATION_TEMPORARILY_UNAVAILABLE' || error.code === 'MODERATION_POLICY_MISMATCH') return 'Проверка текста временно недоступна. Попробуйте позже — прежний текст не изменён.';
    if (error.status === 429) return 'Слишком много запросов. Попробуйте позже.';
    if (error.kind === 'private') return 'Публикация или площадка недоступна.';
    if (error.status === 409) return 'Данные изменились. Обновите их и проверьте действие.';
  }
  return 'Не удалось подтвердить результат. Проверьте соединение и обновите данные.';
}

/** Rebuild the closed wire operation; even a forged runtime packet cannot supply a URL/body. */
export function communityWire(packet: Packet) {
  const expected = freezePacket(packet.actor, packet.scope, packet.action as Action, packet.key);
  if (packet.path !== expected.path || packet.method !== expected.method || JSON.stringify(packet.body) !== JSON.stringify(expected.body)) return invalid();
  return {path:expected.path,method:expected.method,body:expected.body};
}
