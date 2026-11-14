import type { Conversation, DirectMessage, GameChat, GameChatMember, GameInvitation, InboxCounts, InboxItem, InboxPage, InvitationContext, MessagePage, MessagePeer } from '@gobadminton/contracts/messages';
export type { Conversation, DirectMessage, GameChat, GameChatMember, GameInvitation, InboxCounts, InboxItem, InboxPage, InboxFilter, InvitationContext, MessagePage, MessagePeer } from '@gobadminton/contracts/messages';
export class MessagesError extends Error {
  readonly kind: 'invalid' | 'network' | 'private' | 'business' | 'stale';
  readonly status: number; readonly code: string;
  constructor(kind: MessagesError['kind'], status = 0, code = 'UNKNOWN') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
const invalid = (): never => { throw new MessagesError('invalid'); };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const text = (v: unknown): string => typeof v === 'string' ? v : invalid();
const nullable = (v: unknown) => v === null ? null : text(v);
const count = (v: unknown): number => Number.isSafeInteger(v) && Number(v) >= 0 ? v as number : invalid();
const version = (v: unknown) => count(v) > 0 ? count(v) : invalid();
const flag = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const one = <T extends string>(v: unknown, values: readonly T[]): T => values.includes(v as T) ? v as T : invalid();
export const messageId = (v: unknown): string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : invalid();
export const seq = (v: unknown): string => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) ? v : invalid();
export function parsePeer(v: unknown): MessagePeer {
  const r = obj(v), peer: MessagePeer = { publicPlayerId: messageId(r.publicPlayerId), displayName: text(r.displayName) };
  if (r.avatar != null) { const a = obj(r.avatar); peer.avatar = { uploadedUrl: nullable(a.uploadedUrl), providerUrl: nullable(a.providerUrl) }; }
  return peer;
}
export function parseCounts(v: unknown): InboxCounts { const r = obj(v); return { pendingRequestCount: count(r.pendingRequestCount), pendingInvitationCount: count(r.pendingInvitationCount), dmUnread: count(r.dmUnread), gameChatUnread: count(r.gameChatUnread) }; }
export function parseInbox(v: unknown): InboxPage {
  const r = obj(v); return { ...parseMessagePage(r, (v): InboxItem => {
    const i = obj(v), kind = one(i.kind, ['dm','dm_request','game_invitation','game_chat'] as const);
    const row: InboxItem = { kind, id: messageId(i.id), title: text(i.title), subtitle: text(i.subtitle), lastActivityAt: text(i.lastActivityAt),
      unreadCount: count(i.unreadCount), attention: flag(i.attention), conversationId: i.conversationId === null ? null : messageId(i.conversationId),
      gameId: i.gameId === null ? null : messageId(i.gameId), invitationId: i.invitationId === null ? null : messageId(i.invitationId), peer: i.peer === null ? null : parsePeer(i.peer) };
    if ((kind === 'dm' || kind === 'dm_request') && !row.conversationId || kind === 'game_chat' && !row.gameId || kind === 'game_invitation' && !row.invitationId) invalid();
    return row;
  }), counts: parseCounts(r.counts) };
}
export function inboxDestination(i: InboxItem): string {
  return i.kind === 'game_invitation' ? `/messages/invitations/${messageId(i.invitationId)}`
    : i.kind === 'game_chat' ? `/messages/game/${messageId(i.gameId)}` : `/messages/direct/${messageId(i.conversationId)}`;
}
export function parseConversation(v: unknown): Conversation {
  const r = obj(v); return { id: messageId(r.id), kind: one(r.kind, ['direct']), requestState: one(r.requestState, ['pending','accepted','declined','expired','closed']),
    version: version(r.version), peer: parsePeer(r.peer), role: one(r.role, ['initiator','recipient']), lastMessageSeq: seq(r.lastMessageSeq), readThroughSeq: seq(r.readThroughSeq), unreadCount: count(r.unreadCount) };
}
export function parseChat(v: unknown): GameChat {
  const r = obj(v); return { id: messageId(r.id), gameId: messageId(r.gameId), kind: one(r.kind,['game']), lifecycleState: one(r.lifecycleState,['active','closed']),
    version: version(r.version), lastMessageSeq: seq(r.lastMessageSeq), readThroughSeq: seq(r.readThroughSeq), unreadCount: count(r.unreadCount), memberRole: one(r.memberRole,['manager','member']) };
}
export function parseMembers(v: unknown): GameChatMember[] {
  const items = obj(v).items; if (!Array.isArray(items)) return invalid();
  return items.map(v => { const r = obj(v); return { publicPlayerId: messageId(r.publicPlayerId), displayName: text(r.displayName), role: one(r.role,['manager','member']) }; });
}
export function parseMessage(v: unknown): DirectMessage {
  const r = obj(v); return { id: messageId(r.id), conversationId: messageId(r.conversationId), seq: seq(r.seq), kind: one(r.kind,['text']),
    authorPublicPlayerId: r.authorPublicPlayerId === null ? null : messageId(r.authorPublicPlayerId), createdAt: text(r.createdAt), contentState: one(r.contentState,['live','tombstoned','purged']), text: nullable(r.text) };
}
export function parseMessagePage<T>(v: unknown, parse: (v: unknown) => T): MessagePage<T> {
  const r = obj(v); if (!Array.isArray(r.items)) return invalid(); return { items: r.items.map(parse), nextCursor: r.nextCursor === null ? null : text(r.nextCursor) };
}
function parseContext(v: unknown): InvitationContext {
  const r = obj(v); if (!Array.isArray(r.allowedLevelIds)) return invalid();
  return { gameVersion: version(r.gameVersion), title: text(r.title), startsAt: text(r.startsAt), endsAt: text(r.endsAt), timezone: text(r.timezone),
    applicationDeadlineAt: text(r.applicationDeadlineAt), venueName: text(r.venueName), venueAddress: text(r.venueAddress), formatKey: text(r.formatKey), activityKind: text(r.activityKind),
    trainingDescription: nullable(r.trainingDescription), trainerDisplayName: nullable(r.trainerDisplayName), levelScaleId: text(r.levelScaleId), levelScaleVersion: version(r.levelScaleVersion), allowedLevelIds: r.allowedLevelIds.map(text), availablePlaces: count(r.availablePlaces),
    settlementPurpose: nullable(r.settlementPurpose), priceStatus: nullable(r.priceStatus), priceMinor: nullable(r.priceMinor), currency: nullable(r.currency), settlementTerms: text(r.settlementTerms) };
}
export function parseInvitation(v: unknown): GameInvitation {
  const r = obj(v); return { id: messageId(r.id), gameId: messageId(r.gameId), status: one(r.status,['pending','accepted','declined','expired','revoked','cancelled_by_game']), version: version(r.version),
    inviterPublicPlayerId: nullable(r.inviterPublicPlayerId), inviteePublicPlayerId: nullable(r.inviteePublicPlayerId), expiresAt: nullable(r.expiresAt), participationId: nullable(r.participationId),
    ...(r.acceptanceContext === undefined ? {} : { acceptanceContext: r.acceptanceContext === null ? null : parseContext(r.acceptanceContext) }) };
}
/** Own social profile is identity only: never keep contact, profile extras or NativeMe's internal user id as public identity. */
export const parseOwnMessageIdentity = (v: unknown): string => messageId(obj(v).publicPlayerId);
export function mergeMessages(old: DirectMessage[], page: DirectMessage[]): DirectMessage[] {
  const bySeq = new Map(old.map(m => [m.seq,m])); page.forEach(m => bySeq.set(m.seq,m));
  return [...bySeq.values()].sort((a,b) => BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0);
}
export type MessageResource = { kind: 'direct' | 'game' | 'invitation'; id: string };
export function resourcePath(r: MessageResource): `/conversations/${string}` | `/games/${string}/chat` | `/invitations/${string}` {
  const id = messageId(r.id); return r.kind === 'direct' ? `/conversations/${id}` : r.kind === 'game' ? `/games/${id}/chat` : `/invitations/${id}`;
}
export type MessageAction = 'send' | 'read' | 'accept' | 'decline';
export type MessageBody = Readonly<{ kind: 'text'; text: string; clientMessageId: string }> | Readonly<{ throughSeq: string }> | Readonly<{ expectedVersion: number; expectedGameVersion?: number }>;
export function mutationPath(r: MessageResource, action: MessageAction): string {
  if (r.kind === 'invitation' ? !['accept','decline'].includes(action) : r.kind === 'game' && ['accept','decline'].includes(action)) invalid();
  return `${resourcePath(r)}/${action === 'send' ? 'messages' : action}`;
}

/** Validate authoritative command receipts before the owner may settle an UNKNOWN packet. */
export function parseMessageMutation(r: MessageResource, action: MessageAction, value: unknown): unknown {
  if (r.kind === 'invitation') {
    if (action === 'decline') return parseInvitation(value);
    const row = obj(value), invitation = parseInvitation(row.invitation);
    if (action !== 'accept' || invitation.status !== 'accepted' || !invitation.participationId) return invalid();
    const participation = obj(row.participation);
    if (messageId(participation.id) !== invitation.participationId || messageId(participation.gameId) !== invitation.gameId || participation.status !== 'confirmed') return invalid();
    return { invitation };
  }
  if (action === 'accept' || action === 'decline') return parseConversation(value);
  const row = obj(value);
  if (action === 'read') return { readThroughSeq: seq(row.readThroughSeq) };
  return { messageId: messageId(row.messageId), conversationId: messageId(row.conversationId), seq: seq(row.seq), createdAt: text(row.createdAt), outcome: one(row.outcome,['created','duplicate']) };
}
