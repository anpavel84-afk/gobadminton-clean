import type { PlayInterestView, PlayInterestReceipt } from '@gobadminton/contracts/friendship-types';
import type { Actor } from './participation.ts';
export type { PlayInterestView, PlayInterestReceipt };
export class PlayInterestError extends Error {
  readonly kind: 'invalid' | 'network' | 'refused'; readonly status: number; readonly code: string;
  constructor(kind: PlayInterestError['kind'], status = 0, code = '') { super(kind); this.kind=kind; this.status=status; this.code=code; }
}
const invalid = (): never => { throw new PlayInterestError('invalid'); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : invalid();
export const validVersion = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.exec(v)?.[0] === v;
export const validInterestId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(v)?.[0] === v;
export function publicPlayerId(v: unknown): string {
  if (typeof v !== 'string' || /^[A-Za-z0-9_-]{1,128}$/.exec(v)?.[0] !== v) return invalid();
  return v;
}
export function parsePlayInterestView(value: unknown): PlayInterestView {
  const r = record(value), c = record(r.capabilities);
  if (!['none','outgoing','mutual','unavailable'].includes(String(r.relationship)) ||
    typeof c.canSend !== 'boolean' || typeof c.canWithdraw !== 'boolean') return invalid();
  if (r.relationship === 'none' || r.relationship === 'unavailable') {
    if (r.interestId !== null || r.version !== null || c.canWithdraw || r.relationship === 'unavailable' && c.canSend) return invalid();
  } else if (!validInterestId(r.interestId) || !validVersion(r.version) || c.canSend) return invalid();
  return {relationship:r.relationship as PlayInterestView['relationship'],interestId:r.interestId as string | null,
    version:r.version as string | null,capabilities:{canSend:c.canSend,canWithdraw:c.canWithdraw}};
}
export function statesPath(ids: readonly string[]): string {
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length) return invalid();
  return '/me/play-interest-states?' + ids.map(id => `publicPlayerId=${encodeURIComponent(publicPlayerId(id))}`).join('&');
}
/** Response has no peer IDs. Bind only to the exact frozen, ordered request, never another render's IDs. */
export function parsePlayInterestStates(value: unknown, ids: readonly string[]): Map<string,PlayInterestView> {
  statesPath(ids);
  const r = record(value);
  if (!Array.isArray(r.items) || r.items.length !== ids.length) return invalid();
  return new Map(ids.map((id,i) => [id,parsePlayInterestView((r.items as unknown[])[i])]));
}
export function parsePlayInterestReceipt(value: unknown, kind: 'send' | 'withdraw'): PlayInterestReceipt {
  const r = record(value);
  if (!validInterestId(r.interestId) || !validVersion(r.version) ||
    !(kind === 'send' ? r.outcome === 'outgoing' || r.outcome === 'mutual' : r.outcome === 'withdrawn')) return invalid();
  return {interestId:r.interestId,version:r.version,outcome:r.outcome as PlayInterestReceipt['outcome']};
}
export type PlayInterestPacket = Readonly<{actor: Readonly<Actor>; target: string; key: string} & (
  {kind:'send';path:'/play-interests';body:Readonly<{targetPublicPlayerId:string}>} |
  {kind:'withdraw';path:string;body:Readonly<{expectedVersion:string}>}
)>;
export function interestCommand(view: PlayInterestView, target: string, kind: 'send'|'withdraw') {
  publicPlayerId(target);
  if (kind === 'send') return view.relationship === 'none' && view.capabilities.canSend ?
    {kind,path:'/play-interests' as const,body:{targetPublicPlayerId:target}} : null;
  return view.capabilities.canWithdraw && validInterestId(view.interestId) && validVersion(view.version) ?
    {kind,path:`/play-interests/${view.interestId}/withdraw`,body:{expectedVersion:view.version}} : null;
}
/** Native closed path/body allowlist. Never serialize extra actor, discovery proof or caller body fields. */
export function interestWire(packet: PlayInterestPacket) {
  publicPlayerId(packet.target);
  if (typeof packet.key !== 'string' || /^[A-Za-z0-9_-]{8,128}$/.exec(packet.key)?.[0] !== packet.key) return invalid();
  if (packet.kind === 'send' && packet.path === '/play-interests' && packet.body.targetPublicPlayerId === packet.target && Object.keys(packet.body).length === 1)
    return {path:packet.path,body:{targetPublicPlayerId:packet.target}};
  if (packet.kind === 'withdraw' && packet.path.match(/^\/play-interests\/[0-9a-f-]{36}\/withdraw$/i)?.[0] === packet.path &&
    validInterestId(packet.path.split('/')[2]) && validVersion(packet.body.expectedVersion) && Object.keys(packet.body).length === 1)
    return {path:packet.path,body:{expectedVersion:packet.body.expectedVersion}};
  return invalid();
}
