import type {
  FriendshipList, FriendshipReceipt, FriendshipView, SocialCapabilities,
} from '@gobadminton/contracts/friendship-types';
import type { Actor } from './participation.ts';

export type FriendsTab = 'accepted' | 'incoming' | 'outgoing';
export type FriendAction = 'request' | 'accept' | 'decline' | 'cancel' | 'remove';
export type { FriendshipList, FriendshipReceipt, FriendshipView, SocialCapabilities };

export class FriendshipError extends Error {
  readonly kind: 'invalid' | 'network' | 'refused' | 'authority';
  readonly status: number;
  readonly code: string;
  constructor(kind: FriendshipError['kind'], status = 0, code = '') {
    super(kind); this.kind = kind; this.status = status; this.code = code;
  }
}

const invalid = (): never => { throw new FriendshipError('invalid'); };
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();

export const validVersion = (v: unknown): v is string =>
  typeof v === 'string' && /^[1-9][0-9]{0,18}$/.exec(v)?.[0] === v;
export const validUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(v)?.[0] === v;
export function publicPlayerId(v: unknown): string {
  if (typeof v !== 'string' || /^[A-Za-z0-9_-]{1,128}$/.exec(v)?.[0] !== v) return invalid();
  return v;
}

export const friendStatus: Record<FriendshipView['relationship'], string> = {
  none: 'Можно отправить запрос',
  outgoing_pending: 'Запрос отправлен',
  incoming_pending: 'Входящий запрос',
  friends: 'В друзьях',
  unavailable: 'Дружба сейчас недоступна',
};

export const FRIEND_ACTION_LABELS: Record<FriendAction, string> = {
  request: 'Добавить в друзья',
  accept: 'Принять',
  decline: 'Отклонить',
  cancel: 'Отменить запрос',
  remove: 'Удалить из друзей',
};

export const FRIENDS_TABS: Array<[FriendsTab, string]> = [
  ['accepted', 'Друзья'],
  ['incoming', 'Входящие'],
  ['outgoing', 'Исходящие'],
];

const RELATIONSHIPS = new Set(['none', 'outgoing_pending', 'incoming_pending', 'friends', 'unavailable']);

function parseAvatar(value: unknown): { uploadedUrl: string | null; providerUrl: string | null } {
  const a = record(value);
  if (!(a.uploadedUrl === null || typeof a.uploadedUrl === 'string')
    || !(a.providerUrl === null || typeof a.providerUrl === 'string')) return invalid();
  return { uploadedUrl: a.uploadedUrl as string | null, providerUrl: a.providerUrl as string | null };
}

function parsePeer(value: unknown): FriendshipView['peer'] {
  if (value === null) return null;
  const p = record(value);
  if (typeof p.displayName !== 'string' || !p.displayName || p.displayName.length > 80) return invalid();
  return {
    publicPlayerId: publicPlayerId(p.publicPlayerId),
    displayName: p.displayName,
    avatar: parseAvatar(p.avatar),
  };
}

function parseRequest(value: unknown): FriendshipView['request'] {
  if (value === null) return null;
  const r = record(value);
  if (!validUuid(r.id) || typeof r.expiresAt !== 'string' || !r.expiresAt) return invalid();
  return { id: r.id, expiresAt: r.expiresAt };
}

export function parseFriendshipView(value: unknown): FriendshipView {
  const r = record(value), c = record(r.capabilities);
  if (!RELATIONSHIPS.has(String(r.relationship))
    || typeof c.canRequest !== 'boolean' || typeof c.canAccept !== 'boolean'
    || typeof c.canDecline !== 'boolean' || typeof c.canCancel !== 'boolean'
    || typeof c.canRemove !== 'boolean') return invalid();
  if (!(r.friendshipId === null || validUuid(r.friendshipId))) return invalid();
  if (!(r.version === null || validVersion(r.version))) return invalid();
  return {
    friendshipId: r.friendshipId as string | null,
    relationship: r.relationship as FriendshipView['relationship'],
    version: r.version as string | null,
    request: parseRequest(r.request),
    peer: parsePeer(r.peer),
    capabilities: {
      canRequest: c.canRequest, canAccept: c.canAccept, canDecline: c.canDecline,
      canCancel: c.canCancel, canRemove: c.canRemove,
    },
  };
}

export function parseSocialCapabilities(value: unknown): SocialCapabilities {
  const r = record(value);
  if (typeof r.friends !== 'boolean' || typeof r.gameRecommendations !== 'boolean'
    || typeof r.gameAttention !== 'boolean' || typeof r.socialPush !== 'boolean') return invalid();
  return {
    friends: r.friends, gameRecommendations: r.gameRecommendations,
    gameAttention: r.gameAttention, socialPush: r.socialPush,
  };
}

export function parseFriendshipList(value: unknown): FriendshipList {
  const r = record(value);
  if (!Array.isArray(r.items) || !(r.nextCursor === null || typeof r.nextCursor === 'string')
    || typeof r.asOf !== 'string' || !r.asOf) return invalid();
  if (typeof r.nextCursor === 'string' && r.nextCursor.length > 2048) return invalid();
  return {
    items: (r.items as unknown[]).map(parseFriendshipView),
    nextCursor: r.nextCursor as string | null,
    asOf: r.asOf,
  };
}

export function parseFriendshipStates(value: unknown, peerId: string): FriendshipView {
  publicPlayerId(peerId);
  const r = record(value);
  if (!Array.isArray(r.items) || r.items.length !== 1) return invalid();
  return parseFriendshipView((r.items as unknown[])[0]);
}

export function parseFriendshipReceipt(value: unknown, action: FriendAction): FriendshipReceipt {
  const r = record(value);
  if (!validUuid(r.friendshipId) || !validUuid(r.requestId) || !validVersion(r.version)) return invalid();
  const expected: Record<FriendAction, FriendshipReceipt['outcome']> = {
    request: 'pending', accept: 'accepted', decline: 'declined', cancel: 'cancelled', remove: 'removed',
  };
  if (r.outcome !== expected[action]) return invalid();
  return {
    friendshipId: r.friendshipId, requestId: r.requestId,
    version: r.version, outcome: r.outcome as FriendshipReceipt['outcome'],
  };
}

/** Own profile must be saved and publicly eligible before Friends lists are admitted. */
export function ownFriendsPrerequisite(profile: {
  version: number; directoryVisible: boolean; socialEligible: boolean;
}): boolean {
  return profile.version < 1 || !profile.directoryVisible || !profile.socialEligible;
}

export function friendshipsListPath(view: FriendsTab, cursor: string | null = null): string {
  if (!['accepted', 'incoming', 'outgoing'].includes(view)) return invalid();
  const query = new URLSearchParams({ view, limit: '20' });
  if (cursor) {
    if (typeof cursor !== 'string' || !cursor || cursor.length > 2048) return invalid();
    query.set('cursor', cursor);
  }
  return `/me/friendships?${query}`;
}

export function friendshipStatesPath(peerId: string): string {
  return `/me/friendship-states?publicPlayerId=${encodeURIComponent(publicPlayerId(peerId))}`;
}

/** Only server capabilities authorize controls. Versions remain decimal strings. */
export function friendCommand(
  view: FriendshipView, peerId: string | undefined, action: FriendAction,
): { path: string; body: Readonly<{ targetPublicPlayerId: string }> | Readonly<{ expectedVersion: string }> } | null {
  if (action === 'request') {
    if (!view.capabilities.canRequest || !peerId) return null;
    publicPlayerId(peerId);
    return { path: '/friend-requests', body: { targetPublicPlayerId: peerId } };
  }
  const permitted = {
    accept: view.capabilities.canAccept, decline: view.capabilities.canDecline,
    cancel: view.capabilities.canCancel, remove: view.capabilities.canRemove,
  };
  const id = action === 'remove' ? view.friendshipId : view.request?.id;
  if (!permitted[action] || !id || !view.version || !validUuid(id) || !validVersion(view.version)) return null;
  return {
    path: action === 'remove'
      ? `/friendships/${encodeURIComponent(id)}/remove`
      : `/friend-requests/${encodeURIComponent(id)}/${action}`,
    body: { expectedVersion: view.version },
  };
}

export type FriendshipPacket = Readonly<{
  actor: Readonly<Actor>;
  action: FriendAction;
  target: string | null;
  requestId: string | null;
  friendshipId: string | null;
  key: string;
  path: string;
  body: Readonly<{ targetPublicPlayerId: string }> | Readonly<{ expectedVersion: string }>;
  viewLease: number;
  listLease: number;
  peerLease: string | null;
}>;

/** Native closed path/body allowlist. Never serialize actor or extra caller fields. */
export function friendshipWire(packet: FriendshipPacket) {
  if (typeof packet.key !== 'string' || /^[A-Za-z0-9_-]{8,128}$/.exec(packet.key)?.[0] !== packet.key) return invalid();
  if (packet.action === 'request') {
    if (packet.path !== '/friend-requests' || !packet.target
      || !('targetPublicPlayerId' in packet.body)
      || packet.body.targetPublicPlayerId !== packet.target
      || Object.keys(packet.body).length !== 1) return invalid();
    publicPlayerId(packet.target);
    return { path: packet.path, body: { targetPublicPlayerId: packet.target } };
  }
  if (!('expectedVersion' in packet.body) || !validVersion(packet.body.expectedVersion)
    || Object.keys(packet.body).length !== 1) return invalid();
  if (packet.action === 'remove') {
    if (!packet.friendshipId || !validUuid(packet.friendshipId)
      || packet.path !== `/friendships/${encodeURIComponent(packet.friendshipId)}/remove`) return invalid();
    return { path: packet.path, body: { expectedVersion: packet.body.expectedVersion } };
  }
  if (!packet.requestId || !validUuid(packet.requestId)
    || packet.path !== `/friend-requests/${encodeURIComponent(packet.requestId)}/${packet.action}`) return invalid();
  return { path: packet.path, body: { expectedVersion: packet.body.expectedVersion } };
}
