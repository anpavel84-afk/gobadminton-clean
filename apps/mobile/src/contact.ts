import { MessagesError, messageId, parseConversation, seq } from './messages.ts';
import type { Conversation } from './messages.ts';
import type { Actor } from './participation.ts';

export type ContactState = { targetPublicPlayerId: string } & (
  { state: 'none'; canRequestContact: boolean } |
  { state: 'accepted' | 'pending_incoming' | 'pending_outgoing'; conversationId: string; version: number } |
  { state: 'terminal' | 'unavailable' }
);
export type RadarContactContext = Readonly<{ kind: 'radar'; actor: Readonly<Actor>; target: string; resultRef: string;
  queryRef: string; activationId: string; generation: number; expiresAt: number; valid: () => boolean }>;
type OrdinaryBody = Readonly<{ targetPublicPlayerId: string; text: string; clientMessageId: string }>;
export type ContactPacket = Readonly<{ actor: Readonly<Actor>; key: string } & (
  { kind?: 'directory'; body: OrdinaryBody } |
  { kind: 'radar'; context: RadarContactContext; body: OrdinaryBody & Readonly<{ discoveryProof: string }> }
)>;
export type ContactResult = { conversation: Conversation; receipt: {
  messageId: string; conversationId: string; seq: string; createdAt: string; outcome: 'created' | 'duplicate';
} };
const invalid = (): never => { throw new MessagesError('invalid'); };
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
export function parseContactState(value: unknown, target: string): ContactState {
  const r = row(value);
  if (messageId(r.targetPublicPlayerId) !== messageId(target)) return invalid();
  if (r.state === 'none') {
    if (typeof r.canRequestContact !== 'boolean' || 'conversationId' in r) return invalid();
    return { targetPublicPlayerId: target, state: 'none', canRequestContact: r.canRequestContact };
  }
  if (r.state === 'accepted' || r.state === 'pending_incoming' || r.state === 'pending_outgoing') {
    if (!Number.isSafeInteger(r.version) || Number(r.version) < 1) return invalid();
    return { targetPublicPlayerId: target, state: r.state, conversationId: messageId(r.conversationId), version: r.version as number };
  }
  if ((r.state === 'terminal' || r.state === 'unavailable') && !('conversationId' in r)) return { targetPublicPlayerId: target, state: r.state };
  return invalid();
}
export function contactConversation(value: unknown, target: string, id?: string): Conversation {
  const conversation = parseConversation(value);
  if (conversation.peer.publicPlayerId !== target || id !== undefined && conversation.id !== id ||
    !['accepted','pending'].includes(conversation.requestState)) return invalid();
  return conversation;
}
export function parseContactResult(value: unknown, target: string): ContactResult {
  const r = row(value), conversation = contactConversation(r.conversation, target), receipt = row(r.receipt);
  const conversationId = messageId(receipt.conversationId), sequence = seq(receipt.seq);
  if (conversationId !== conversation.id || sequence === '0' || BigInt(sequence) > BigInt(conversation.lastMessageSeq) || typeof receipt.createdAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(receipt.createdAt) || !Number.isFinite(Date.parse(receipt.createdAt)) ||
    new Date(receipt.createdAt).toISOString().slice(0, 19) !== receipt.createdAt.slice(0, 19) ||
    (receipt.outcome !== 'created' && receipt.outcome !== 'duplicate')) return invalid();
  return { conversation, receipt: { messageId: messageId(receipt.messageId), conversationId, seq: sequence,
    createdAt: receipt.createdAt, outcome: receipt.outcome as 'created' | 'duplicate' } };
}
