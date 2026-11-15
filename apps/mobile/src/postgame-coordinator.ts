import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import { PostgameError, postgameId, wire, validateReceipt, mayAcknowledge } from './postgame.ts';
import type { Intent, Packet, Results, OwnResults, Reminders, ResultsQuery } from './postgame.ts';
export type Source<T> = { status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'; data?: T };
export type Filter = 'all' | 'manage' | 'participate';
type Command = { packet: Packet; status: 'sending' | 'unknown' };
type Snapshot = { actor: Actor | null; filter: Filter; own: Source<OwnResults>; reminders: Source<Reminders>; games: Record<string,Source<Results>>; review: Intent | null; command: Command | null; notice: string | null };
type Port = {
  own: (actor: Actor, cursor?: string) => Promise<OwnResults>;
  reminders: (actor: Actor) => Promise<Reminders>;
  results: (actor: Actor, game: string, query?: ResultsQuery) => Promise<Results>;
  send: (packet: Packet, authority: Actor) => Promise<unknown>;
};
const empty = (actor: Actor | null): Snapshot => ({ actor, filter: 'all', own: {status:'idle'}, reminders: {status:'idle'}, games: {}, review:null, command:null, notice:null });
const unknownNotice = 'Результат действия пока неизвестен. Проверьте исходное действие перед новым изменением.';
function freezeIntent(intent: Intent): Intent {
  // Clone before freezing: caller editing a form cannot change the pending wire body.
  let copy: Intent;
  switch (intent.kind) {
    case 'bulk': copy={...intent,body:{...intent.body,items:intent.body.items.map(item=>({...item}))}}; break;
    case 'outcome': copy={...intent,body:{...intent.body}}; break;
    case 'attendance': copy={...intent,body:{...intent.body}}; break;
    case 'ack': copy={...intent,body:{...intent.body}}; break;
    case 'later': copy={...intent,body:{...intent.body}}; break;
  }
  if (copy.kind === 'bulk') { copy.body.items.forEach(Object.freeze); Object.freeze(copy.body.items); }
  Object.freeze(copy.body); return Object.freeze(copy);
}
export class PostgameCoordinator {
  private snapshot = empty(null);
  private listeners = new Set<() => void>();
  private quarantine: { actorId: string; snapshot: Snapshot } | null = null;
  private serial = 0;
  private reads = new Map<string,number>();
  private seenOwn = new Set<string>();
  private resultCursors = new Map<string,Set<string>>();
  private inFlight: Packet | null = null;
  private port: Port;
  private random: () => string;
  constructor(port: Port, random: () => string) { this.port=port; this.random=random; }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => {this.listeners.delete(fn);}; };
  private show(patch: Partial<Snapshot>) { this.snapshot={...this.snapshot,...patch}; this.listeners.forEach(fn=>fn()); }
  setActor(actor: Actor | null) {
    if (sameActor(actor,this.snapshot.actor) || !actor && !this.snapshot.actor) return;
    if (this.snapshot.actor) this.quarantine={actorId:this.snapshot.actor.actorId,snapshot:this.snapshot};
    const saved=actor && this.quarantine?.actorId === actor.actorId ? this.quarantine.snapshot : null;
    if (actor && this.quarantine?.actorId !== actor.actorId) this.inFlight=null;
    if (actor) this.quarantine=null;
    this.reads.clear(); this.seenOwn.clear(); this.resultCursors.clear(); this.serial++;
    this.snapshot=empty(actor ? Object.freeze({...actor}) : null);
    // Reads must reestablish authority. Only the original packet is restored, never sent on login.
    if (saved) this.show({filter:saved.filter,command:saved.command ? {packet:saved.command.packet,status:'unknown'} : null,notice:saved.command ? unknownNotice : null});
    else this.show({});
  }
  forget = () => { this.quarantine=null; this.inFlight=null; this.reads.clear(); this.seenOwn.clear(); this.resultCursors.clear(); this.serial++; this.snapshot=empty(null); this.show({}); };
  filter = (filter: Filter) => { if (this.snapshot.actor && ['all','manage','participate'].includes(filter)) this.show({filter}); };
  private start(key: string) { const n=++this.serial; this.reads.set(key,n); const actor=this.snapshot.actor; return {actor,valid:()=>!!actor && sameActor(actor,this.snapshot.actor) && this.reads.get(key)===n}; }
  private failure<T>(error: unknown, prior: Source<T>): Source<T> {
    const denied=error instanceof PostgameError && error.kind === 'private';
    return {status:denied ? 'unavailable' : 'error',...(denied ? {} : {data:prior.data})};
  }
  loadOwn = async (more = false) => {
    if (this.snapshot.own.status === 'loading') return;
    const old=this.snapshot.own, cursor=more ? old.data?.nextCursor : undefined;
    if (more && !cursor) return;
    const {actor,valid}=this.start('own'); if (!actor) return;
    this.show({own:{...old,status:'loading'}});
    try {
      const page=await this.port.own(actor,cursor ?? undefined); if (!valid()) return;
      if (page.nextCursor && (page.nextCursor === cursor || more && this.seenOwn.has(page.nextCursor))) throw new PostgameError('invalid');
      if (!more) this.seenOwn.clear(); if (page.nextCursor) this.seenOwn.add(page.nextCursor);
      const items=[...new Map([...(more ? old.data?.items ?? [] : []),...page.items].map(r=>[`${r.gameId}:${r.contextId}`,r])).values()];
      this.show({own:{status:'ready',data:{items,nextCursor:page.nextCursor}}});
    } catch(error) { if (valid()) this.show({own:this.failure(error,old)}); }
  };
  loadReminders = async () => {
    const {actor,valid}=this.start('reminders'); if (!actor) return; const old=this.snapshot.reminders;
    this.show({reminders:{...old,status:'loading'}});
    try { const data=await this.port.reminders(actor); if(valid()) this.show({reminders:{status:'ready',data}}); }
    catch(error) { if(valid()) this.show({reminders:this.failure(error,old)}); }
  };
  loadResults = async (gameId: string, query: ResultsQuery = {}, append?: 'roster' | 'revisions') => {
    try { postgameId(gameId); } catch { return; }
    const old: Source<Results>=this.snapshot.games[gameId] ?? {status:'idle'};
    if (!append && (query.rosterCursor || query.revisionsCursor) || append === 'roster' && query.revisionsCursor || append === 'revisions' && query.rosterCursor) return;
    // Pagination is only from a cursor already received for this actor/game.
    if (append === 'roster' && (!old.data?.attendance?.rosterNextCursor || query.rosterCursor !== old.data.attendance.rosterNextCursor) ||
        append === 'revisions' && (!old.data?.revisionsNextCursor || query.revisionsCursor !== old.data.revisionsNextCursor)) return;
    const {actor,valid}=this.start(`game:${gameId}`); if (!actor) return;
    const put=(source: Source<Results>)=>this.show({games:{...this.snapshot.games,[gameId]:source}});
    put({...old,status:'loading'});
    try {
      const data=await this.port.results(actor,gameId,query); if(!valid()) return;
      if(data.gameId !== gameId) throw new PostgameError('invalid');
      for (const kind of ['roster','revisions'] as const) {
        if (append && append !== kind) continue;
        const key=`${gameId}:${kind}`, seen=append ? this.resultCursors.get(key) ?? new Set<string>() : new Set<string>();
        const next=kind === 'roster' ? data.attendance?.rosterNextCursor : data.revisionsNextCursor;
        if(next && seen.has(next)) throw new PostgameError('invalid');
        if(next) seen.add(next); this.resultCursors.set(key,seen);
      }
      if(append === 'roster' && data.attendance && old.data?.attendance) {
        if(data.attendance.rosterNextCursor && data.attendance.rosterNextCursor === query.rosterCursor) throw new PostgameError('invalid');
        data.attendance.roster=[...new Map([...(old.data.attendance.roster ?? []),...(data.attendance.roster ?? [])].map(r=>[r.contextId,r])).values()];
      }
      if(append === 'revisions') {
        if(data.revisionsNextCursor && data.revisionsNextCursor === query.revisionsCursor) throw new PostgameError('invalid');
        data.revisions=[...new Map([...(old.data?.revisions ?? []),...(data.revisions ?? [])].map(r=>[r.version,r])).values()];
      }
      if (append === 'roster' && old.data?.revisions && data.revisions) {
        data.revisions=[...new Map([...old.data.revisions,...data.revisions].map(r=>[r.version,r])).values()];
        data.revisionsNextCursor=old.data.revisionsNextCursor;
      }
      if (append === 'revisions' && old.data?.attendance?.roster && data.attendance?.roster) {
        data.attendance.roster=[...new Map([...old.data.attendance.roster,...data.attendance.roster].map(r=>[r.contextId,r])).values()];
        data.attendance.rosterNextCursor=old.data.attendance.rosterNextCursor;
      }
      // A GET never acknowledges or settles a pending command.
      put({status:'ready',data});
    } catch(error) { if(valid()) put(this.failure(error,old)); }
  };
  private allowed(intent: Intent) {
    if(intent.kind === 'later') { const source=this.snapshot.reminders.data, item=source?.items.find(r=>r.id === intent.reminderId); return this.snapshot.reminders.status === 'ready' && !!source?.writesEnabled && !!item && item.gameId === intent.gameId && item.version === intent.body.expectedVersion && item.allowedActions.canLater; }
    const result=this.snapshot.games[intent.gameId]; if(result?.status !== 'ready' || !result.data) return false;
    const r=result.data;
    if(intent.kind === 'outcome') return r.allowedActions.canRecordOutcome && r.outcome.version === intent.body.expectedVersion;
    const attendance=r.attendance; if(!attendance?.installed || !attendance.writesEnabled) return false;
    const rows=[...(attendance.roster ?? []),...(attendance.myAttendance ? [attendance.myAttendance] : [])];
    if(intent.kind === 'bulk') return attendance.allowedActions.canBulkPresent && intent.body.items.every(item=>rows.some(row=>row.contextId === item.contextId && row.version === item.expectedVersion && row.allowedActions.canSetAttendance && row.value === 'unknown' && row.dispute?.status !== 'open'));
    const row=rows.find(row=>row.contextId === intent.contextId); if(!row || row.dispute?.status === 'open') return false;
    return intent.kind === 'ack' ? mayAcknowledge(row) && row.contextId === attendance.myAttendance?.contextId && row.version === intent.body.attendanceVersion
      : row.allowedActions.canSetAttendance && row.version === intent.body.expectedVersion;
  }
  review = (intent: Intent) => {
    if(!this.snapshot.actor || this.snapshot.command || this.inFlight) return;
    try { wire(intent); if(!this.allowed(intent)) throw new PostgameError('invalid'); this.show({review:freezeIntent(intent),notice:null}); }
    catch { this.show({notice:'Проверьте выбранные данные и обновите итоги игры.'}); }
  };
  cancelReview = () => this.show({review:null});
  confirm = async () => {
    const {actor,review}=this.snapshot; if(!actor || !review || this.snapshot.command || this.inFlight) return;
    if (!this.allowed(review)) { this.show({review:null,notice:'Данные изменились. Обновите итоги и проверьте выбранное действие.'}); return; }
    const transport=wire(review);
    const packet: Packet=Object.freeze({...review,method:transport.method,path:transport.path,actor:Object.freeze({...actor}),key:this.random()});
    await this.dispatch(packet,actor,false);
  };
  reconcile = async (gameId: string) => {
    const {actor,command}=this.snapshot; if(!actor || !command || command.status !== 'unknown' || this.inFlight || command.packet.gameId !== gameId || command.packet.actor.actorId !== actor.actorId) return;
    await this.dispatch(command.packet,actor,true);
  };
  private async dispatch(packet: Packet, authority: Actor, reconciling: boolean) {
    this.inFlight=packet; this.show({command:{packet,status:'sending'},review:null,notice:null});
    const valid=()=>sameActor(authority,this.snapshot.actor) && this.snapshot.command?.packet === packet;
    try {
      validateReceipt(await this.port.send(packet,authority),packet);
      if(!valid()) return;
      this.show({command:null,notice:reconciling ? 'Исходное действие подтверждено. Обновляем текущие данные.' : 'Изменения сохранены.'});
      // Receipt replay is history; always read current rights/version separately.
      void this.loadResults(packet.gameId); void this.loadReminders();
    } catch(error) {
      if(!valid()) return;
      const definite=!reconciling && error instanceof PostgameError && error.status < 500 && error.kind === 'business' && !['COMMAND_IN_PROGRESS','KEY_REUSED','IDEMPOTENCY_KEY_REUSED'].includes(error.code);
      this.show({command:definite ? null : {packet,status:'unknown'},notice:definite ? 'Изменение отклонено. Обновите данные и проверьте условия.' : unknownNotice});
    } finally { if(this.inFlight === packet) this.inFlight=null; }
  }
}
