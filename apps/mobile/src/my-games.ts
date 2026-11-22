import type { Game, Participation } from '@gobadminton/contracts/game-types';
import type { GameInvitation } from './messages.ts';
import type { ManagedGame } from './participation.ts';
import type { OwnResult, Reminder } from './postgame.ts';
import { needsAttention } from './postgame.ts';
import type { Filter } from './postgame-coordinator.ts';
export type HubRow = { gameId: string; managed?: ManagedGame; parts: Participation[]; own: OwnResult[]; reminders: Reminder[]; invites: GameInvitation[] };
/** Preserve every independent relation/context while deduplicating the game surface by real gameId. */
export function hubRows(managed: ManagedGame[], parts: Participation[], own: OwnResult[], reminders: Reminder[], invites: GameInvitation[] = []): HubRow[] {
  const map=new Map<string,HubRow>();
  const row=(id: string) => { let r=map.get(id); if(!r) {r={gameId:id,parts:[],own:[],reminders:[],invites:[]};map.set(id,r);} return r; };
  managed.forEach(g=>{row(g.id).managed=g;}); parts.forEach(p=>row(p.gameId).parts.push(p));
  own.forEach(p=>row(p.gameId).own.push(p)); reminders.forEach(p=>row(p.gameId).reminders.push(p));
  invites.forEach(i=>row(i.gameId).invites.push(i)); return [...map.values()];
}
/**
 * Native manage/participate keep reminder/own-result eligibility (broader than WEB chips).
 * Invites filter is invitations-only; `all` includes invite rows. Intentionally not silent WEB manage/participate narrowing.
 */
export function matchesFilter(row: HubRow, filter: Filter) {
  if (filter === 'all') return true;
  if (filter === 'manage') return !!row.managed || row.reminders.length > 0;
  if (filter === 'participate') return row.parts.length > 0 || row.own.length > 0;
  return row.invites.length > 0;
}
export function isPendingInvite(invite: GameInvitation, now = Date.now()): boolean {
  return invite.status === 'pending' && (!invite.expiresAt || Date.parse(invite.expiresAt) > now);
}
/** Cached `pending` whose expiresAt is already past local clock — still refreshable, not actionable. */
export function isInviteClockExpired(invite: GameInvitation, now = Date.now()): boolean {
  if (invite.status !== 'pending' || !invite.expiresAt) return false;
  const at = Date.parse(invite.expiresAt);
  return Number.isFinite(at) && at <= now;
}
/** Loaded pending only; caller appends `+` while the invitations cursor is not exhausted. */
export function pendingInviteCount(invites: readonly GameInvitation[], now = Date.now()): number {
  return invites.filter(invite => isPendingInvite(invite, now)).length;
}
export function hubBucket(row: HubRow, game: Game | undefined, now = Date.now()): 'upcoming' | 'draft' | 'past' | 'terminal' | 'unknown' {
  if(row.managed && game?.status === 'draft') return 'draft';
  const end=game?.endsAt ?? row.own.find(r=>r.endsAt)?.endsAt ?? row.reminders[0]?.endsAt;
  const ends=end ? Date.parse(end) : NaN;
  if(game?.status === 'completed' || Number.isFinite(ends) && ends <= now) return 'past';
  if(!Number.isFinite(ends)) return 'unknown';
  const active=!!row.managed || row.parts.some(p=>['pending','confirmed'].includes(p.status)) ||
    row.invites.some(invite => isPendingInvite(invite, now));
  return game?.status === 'cancelled' || !active ? 'terminal' : 'upcoming';
}

/** Attention belongs to the full supported, loaded union, independent of the relation filter. */
export function hubView(all: HubRow[], filter: Filter) {
  const rows=all.filter(row=>matchesFilter(row,filter));
  return { rows, attention:all.filter(row=>row.reminders.length > 0 || row.own.some(needsAttention)),
    empty:all.length === 0 ? 'loaded' as const : rows.length === 0 ? 'filter' as const : null };
}
function endTime(row: HubRow, game?: Game): number {
  const dates=[game?.endsAt,...row.own.map(r=>r.endsAt),...row.reminders.map(r=>r.endsAt)];
  for (const date of dates) { const n=date ? Date.parse(date) : NaN; if(Number.isFinite(n)) return n; }
  return NaN;
}
export function sortHubRows(rows: HubRow[], bucket: ReturnType<typeof hubBucket>, getGame: (row: HubRow)=>Game | undefined): HubRow[] {
  if(bucket !== 'upcoming' && bucket !== 'past') return rows;
  const time=(row:HubRow)=>{const game=getGame(row), start=game ? Date.parse(game.startsAt) : NaN; return bucket === 'upcoming' && Number.isFinite(start) ? start : endTime(row,game);};
  return [...rows].sort((a,b)=>{
    const left=time(a),right=time(b);
    if(!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
    if(!Number.isFinite(right)) return -1;
    return bucket === 'upcoming' ? left-right : right-left;
  });
}
