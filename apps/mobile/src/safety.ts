import type { Actor } from './participation.ts';
import type { DirectMessage } from './messages.ts';
import { messageId } from './messages.ts';

export const REPORT_REASONS = [
  { code: 'harassment', label: 'Оскорбления / давление' },
  { code: 'spam', label: 'Спам' },
  { code: 'fake_profile', label: 'Поддельный профиль' },
  { code: 'inappropriate', label: 'Неприемлемый контент' },
  { code: 'other', label: 'Другое' },
] as const;
export type ReportReason = typeof REPORT_REASONS[number]['code'];
export type SafetyContext = Readonly<{ peerId: string; name: string; conversationId?: string }>;
export type ReportBody = Readonly<{ targetKind: 'player'; targetPublicPlayerId: string; reasonCode: ReportReason; detail: string | null }>
  | Readonly<{ targetKind: 'message'; messageId: string; conversationId: string; reasonCode: ReportReason; detail: string | null; shareMessageWithSupport: true }>;
export type SafetyPacket = Readonly<{ actor: Readonly<Actor>; context: SafetyContext; key: string } & (
  { action: 'block' | 'unblock'; method: 'PUT' | 'DELETE'; path: string; body: Readonly<Record<string, never>> }
  | { action: 'report'; method: 'POST'; path: '/reports'; body: ReportBody }
)>;
export type BlockReceipt = { publicPlayerId: string; blocked: boolean };
export type ReportReceipt = { reportId: string; status: 'submitted'; createdAt: string };
export class SafetyError extends Error {
  readonly kind: 'invalid' | 'network' | 'authority' | 'business'; readonly status: number; readonly code: string;
  constructor(kind: SafetyError['kind'], status = 0, code = 'UNKNOWN') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
const invalid = (): never => { throw new SafetyError('invalid'); };
export function reportDetail(value: string): string | null {
  if (value.length > 1000) return invalid();
  return value.trim() || null;
}
export function reportable(message: DirectMessage, context: SafetyContext): boolean {
  return !!context.conversationId && message.conversationId === context.conversationId && message.authorPublicPlayerId === context.peerId &&
    message.contentState === 'live' && typeof message.text === 'string' && !!message.text.trim();
}
/** Closed projection: no caller path, author, excerpt, evidenceRefs, cookies or Origin can reach the wire. */
export function safetyWire(packet: SafetyPacket): { path: string; method: 'PUT' | 'DELETE' | 'POST'; body: object } {
  const peer = messageId(packet.context.peerId);
  if (packet.action !== 'report') return { path: `/me/blocks/${encodeURIComponent(peer)}`, method: packet.action === 'block' ? 'PUT' : 'DELETE', body: {} };
  const b = packet.body;
  if (!REPORT_REASONS.some(r => r.code === b.reasonCode)) return invalid();
  const detail = b.detail === null ? null : reportDetail(b.detail);
  if (b.targetKind === 'player') {
    if (b.targetPublicPlayerId !== peer) return invalid();
    return { path: '/reports', method: 'POST', body: { targetKind: 'player', targetPublicPlayerId: peer, reasonCode: b.reasonCode, detail } };
  }
  if (b.targetKind !== 'message' || b.shareMessageWithSupport !== true || b.conversationId !== packet.context.conversationId) return invalid();
  return { path: '/reports', method: 'POST', body: { targetKind: 'message', messageId: messageId(b.messageId), conversationId: messageId(b.conversationId),
    reasonCode: b.reasonCode, detail, shareMessageWithSupport: true } };
}
export function parseSafetyReceipt(packet: SafetyPacket, value: unknown): BlockReceipt | ReportReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const r = value as Record<string, unknown>;
  if (packet.action !== 'report') {
    if (r.publicPlayerId !== packet.context.peerId || r.blocked !== (packet.action === 'block')) return invalid();
    return { publicPlayerId: packet.context.peerId, blocked: r.blocked as boolean };
  }
  if (typeof r.reportId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.reportId) ||
    r.status !== 'submitted' || typeof r.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(r.createdAt) ||
    !Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString().slice(0,19) !== r.createdAt.slice(0,19)) return invalid();
  return { reportId: r.reportId, status: 'submitted', createdAt: r.createdAt };
}
