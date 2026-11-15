import type { Game, Participation } from '@gobadminton/contracts/game-types';
import type { ManagedGame } from './participation.ts';
import type { OwnResult, Reminder } from './postgame.ts';
import type { Filter } from './postgame-coordinator.ts';
export type HubRow = { gameId: string; managed?: ManagedGame; parts: Participation[]; own: OwnResult[]; reminders: Reminder[] };
/** Preserve every independent relation/context while deduplicating the game surface. */
export function hubRows(managed: ManagedGame[], parts: Participation[], own: OwnResult[], reminders: Reminder[]): HubRow[] {
  const map=new Map<string,HubRow>();
  const row=(id: string) => { let r=map.get(id); if(!r) {r={gameId:id,parts:[],own:[],reminders:[]};map.set(id,r);} return r; };
  managed.forEach(g=>{row(g.id).managed=g;}); parts.forEach(p=>row(p.gameId).parts.push(p));
  own.forEach(p=>row(p.gameId).own.push(p)); reminders.forEach(p=>row(p.gameId).reminders.push(p)); return [...map.values()];
}
export function matchesFilter(row: HubRow, filter: Filter) { return filter === 'all' || (filter === 'manage' ? !!row.managed || row.reminders.length > 0 : row.parts.length > 0 || row.own.length > 0); }
export function hubBucket(row: HubRow, game: Game | undefined, now = Date.now()): 'upcoming' | 'draft' | 'past' | 'terminal' | 'unknown' {
  if(row.managed && game?.status === 'draft') return 'draft';
  const end=game?.endsAt ?? row.own.find(r=>r.endsAt)?.endsAt ?? row.reminders[0]?.endsAt;
  const ends=end ? Date.parse(end) : NaN;
  if(game?.status === 'completed' || Number.isFinite(ends) && ends <= now) return 'past';
  if(!Number.isFinite(ends)) return 'unknown';
  const active=!!row.managed || row.parts.some(p=>['pending','confirmed'].includes(p.status));
  return game?.status === 'cancelled' || !active ? 'terminal' : 'upcoming';
}
