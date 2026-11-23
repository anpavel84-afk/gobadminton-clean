import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { GameInvitation } from './messages.ts';
import { MessagesError } from './messages.ts';
import { PostgameError, postgameId, wire, validateReceipt, mayAcknowledge, mayAcknowledgeCurrent, needsAttention, noteText } from './postgame.ts';
import type { Intent, Packet, Results, OwnResults, Reminders, ResultsQuery, OwnResult, AttendanceDispute, AttendanceHistoryPage, PersonalNote } from './postgame.ts';
import { mergeReviewPages, type MeReviewsPage, type PeerRating, type PeerTag, type PrivateReview, type ReviewReportReason } from './postgame-feedback.ts';
export type Source<T> = { status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'; data?: T };
export type Filter = 'all' | 'manage' | 'participate' | 'invites';
export type InvitationPage = { items: GameInvitation[]; nextCursor: string | null };
export type DisputeSelection = { gameId: string; contextId: string; disputeId: string };
export type DisputeDraft = {
  createExplanation?: string;
  respondExplanation?: string;
  correctionEnabled?: boolean;
  correctionValue?: 'present' | 'absent' | 'unknown';
  correctionLate?: boolean;
  correctionReason?: string;
  helpExplanation?: string;
  withdrawReason?: string;
};
/** Actor-bound private note form drafts — wiped on logout / different actor. */
export type NoteDraft = {
  selectedContextId?: string;
  createText?: string;
  editText?: string;
  /** Explicit create-form mutation (incl. deliberate empty); distinct from pristine empty prefill. */
  createDirty?: boolean;
};
export type OwnNoteRef = { gameId: string; contextId: string };
/** Actor-bound peer feedback drafts — wiped on logout / different actor. */
export type FeedbackDraft = {
  mode?: 'peer' | 'received' | 'sent';
  subjectContextId?: string;
  peerRating?: PeerRating;
  comment?: string;
  tags?: PeerTag[];
  replyText?: Record<string, string>;
  reportReviewId?: string;
  reportReason?: ReviewReportReason;
  reportDetail?: string;
  /** Explicit consent for exact frozen review.version — reset when revision changes. */
  reportConsent?: boolean;
  reportConsentVersion?: number;
};
export type ReviewDirection = 'sent' | 'received';
type Command = { packet: Packet; status: 'sending' | 'unknown' };
type OwnAck = { gameId: string; contextId: string; version: number };
function applyOwnAck(row: OwnResult, ack: OwnAck): OwnResult {
  if (row.gameId !== ack.gameId || row.contextId !== ack.contextId || row.attendance.version !== ack.version) return row;
  // The validated receipt proves ACK, but carries neither a notice timestamp nor
  // current hub rights. Retain those rights and remove only its pending notice.
  return {...row,attendance:{...row.attendance,acknowledgedVersion:ack.version},
    notice:row.notice?.attendanceVersion === ack.version && !row.notice.acknowledgedAt ? null : row.notice};
}
function noteKey(gameId: string, contextId: string) { return `${gameId}:${contextId}`; }
type Snapshot = {
  actor: Actor | null; filter: Filter; own: Source<OwnResults>; reminders: Source<Reminders>; invitations: Source<InvitationPage>;
  games: Record<string,Source<Results>>; disputes: Record<string,Source<AttendanceDispute>>; histories: Record<string,Source<AttendanceHistoryPage>>;
  /** Direct own-note GET projections — independent of denied results/roster. */
  notes: Record<string,Source<PersonalNote>>;
  /** Exact actor-bound owned contexts remembered this session (no cold discovery). */
  knownNoteRefs: Record<string,OwnNoteRef>;
  /** Own directional private review history — independent of denied results/roster. */
  reviewHistory: Record<ReviewDirection, Source<MeReviewsPage>>;
  /** Latest typed review by id from history/results/receipts — monotonic merge authority. */
  reviewsById: Record<string, PrivateReview>;
  selection: DisputeSelection | null; drafts: Record<string,DisputeDraft>; noteDrafts: Record<string,NoteDraft>;
  feedbackDrafts: Record<string, FeedbackDraft>;
  review: Intent | null; command: Command | null; notice: string | null;
};
type Port = {
  own: (actor: Actor, cursor?: string) => Promise<OwnResults>;
  reminders: (actor: Actor) => Promise<Reminders>;
  invitations: (actor: Actor, cursor?: string) => Promise<InvitationPage>;
  results: (actor: Actor, game: string, query?: ResultsQuery) => Promise<Results>;
  /** Closed dispute detail/history ports; absent neighbors keep prior PG-1 surfaces compiling. */
  dispute?: (actor: Actor, disputeId: string) => Promise<AttendanceDispute>;
  history?: (actor: Actor, gameId: string, contextId: string, limit?: number) => Promise<AttendanceHistoryPage>;
  /** Direct own personal note GET — exists independently of results access. */
  note?: (actor: Actor, gameId: string, contextId: string) => Promise<PersonalNote>;
  /** Own directional private reviews — exists independently of results access. */
  reviews?: (actor: Actor, direction: ReviewDirection, cursor?: string) => Promise<MeReviewsPage>;
  send: (packet: Packet, authority: Actor) => Promise<unknown>;
};
const empty = (actor: Actor | null): Snapshot => ({
  actor, filter: 'all', own: {status:'idle'}, reminders: {status:'idle'}, invitations: {status:'idle'},
  games: {}, disputes: {}, histories: {}, notes: {}, knownNoteRefs: {},
  reviewHistory: { received: { status: 'idle' }, sent: { status: 'idle' } },
  reviewsById: {},
  selection: null, drafts: {}, noteDrafts: {}, feedbackDrafts: {},
  review:null, command:null, notice:null,
});
const unknownNotice = 'Результат действия пока неизвестен. Проверьте исходное действие перед новым изменением.';
function draftKey(gameId: string, contextId: string, disputeId?: string | null) {
  return `${gameId}:${contextId}:${disputeId ?? 'create'}`;
}
function freezeIntent(intent: Intent): Intent {
  // Clone before freezing: caller editing a form cannot change the pending wire body.
  let copy: Intent;
  switch (intent.kind) {
    case 'bulk': copy={...intent,body:{...intent.body,items:intent.body.items.map(item=>({...item}))}}; break;
    case 'outcome': copy={...intent,body:{...intent.body}}; break;
    case 'attendance': copy={...intent,body:{...intent.body}}; break;
    case 'ack': copy={...intent,body:{...intent.body}}; break;
    case 'dispute': copy={...intent,body:{...intent.body}}; break;
    case 'withdraw': copy={...intent,body:{...intent.body}}; break;
    case 'respond': copy={...intent,body:{...intent.body,...(intent.body.correction ? {correction:{...intent.body.correction}} : {})}}; break;
    case 'help': copy={...intent,body:{...intent.body}}; break;
    case 'later': copy={...intent,body:{...intent.body}}; break;
    case 'note-upsert': copy={...intent,body:{...intent.body}}; break;
    case 'note-delete': copy={...intent,body:{...intent.body}}; break;
    case 'peer-create': copy={...intent,body:{...intent.body,...(intent.body.tags ? {tags:[...intent.body.tags]} : {})}}; break;
    case 'peer-reply': copy={...intent,body:{...intent.body}}; break;
    case 'peer-report': copy={...intent,body:{...intent.body}}; break;
  }
  if (copy.kind === 'bulk') { copy.body.items.forEach(Object.freeze); Object.freeze(copy.body.items); }
  if (copy.kind === 'respond' && copy.body.correction) Object.freeze(copy.body.correction);
  if (copy.kind === 'peer-create' && copy.body.tags) Object.freeze(copy.body.tags);
  Object.freeze(copy.body); return Object.freeze(copy);
}
export class PostgameCoordinator {
  private snapshot = empty(null);
  private listeners = new Set<() => void>();
  private quarantine: { actorId: string; snapshot: Snapshot } | null = null;
  private serial = 0;
  private reads = new Map<string,number>();
  private seenOwn = new Set<string>();
  private seenInvites = new Set<string>();
  // Evidence belongs only to the currently pending own GET. Later GETs establish
  // current truth themselves; a historical receipt must not override them.
  private ownReadAcks: OwnAck[] = [];
  private resultCursors = new Map<string,Set<string>>();
  private inFlight: Packet | null = null;
  /** Coalesce one fresh root invitations GET after ACK while an initial/load-more is in flight. */
  private invitationsBusy = false;
  private invitationsFollowup = false;
  /** Generation that owns busy/followup; stale finally must not clear a newer actor/read. */
  private invitationsBusyGen = 0;
  /** Confirmed delete / definitive known-note 404 watermarks — block late GET/results resurrection. */
  private noteTombs = new Map<string, number>();
  /** Last applied read generation per note key — fences late results vs newer direct GET. */
  private noteAppliedGen = new Map<string, number>();
  /** Monotonic version floor per note key — survives loading/error so transient Source cannot forget newer. */
  private noteVersionFloor = new Map<string, number>();
  /** After confirmed upsert: only typed direct GET may reestablish ready rights (not historical myNotes). */
  private noteAwaitingTyped = new Set<string>();
  /** Seen nextCursor values per review direction — reject ABA/replay cursors. */
  private reviewCursors = new Map<ReviewDirection, Set<string>>();
  /** Version floor per review id — stale receipts cannot regress. */
  private reviewVersionFloor = new Map<string, number>();
  /** Reply version floor per review id. */
  private replyVersionFloor = new Map<string, number>();
  /** Last applied read generation per review id — fences deferred results vs history. */
  private reviewAppliedGen = new Map<string, number>();
  /** After reply/create ACK: only typed history GET may reestablish write rights. */
  private reviewAwaitingTyped = new Set<string>();
  /** Ids whose current floor was established by typed history — results cannot same-version regress. */
  private reviewHistoryOwned = new Set<string>();
  /** Hard-denied own-history directions — results/receipts must not resurrect private projection. */
  private reviewDirectionDenied = new Set<ReviewDirection>();
  private port: Required<Port>;
  private random: () => string;
  constructor(port: Port, random: () => string) {
    // Keep the caller's port object identity so tests can replace lanes in place.
    if (!port.dispute) port.dispute = async () => { throw new PostgameError('private', 404); };
    if (!port.history) port.history = async () => ({ items: [] });
    if (!port.note) port.note = async () => { throw new PostgameError('private', 404); };
    if (!port.reviews) port.reviews = async () => ({ items: [], nextCursor: null });
    this.port = port as Required<Port>;
    this.random = random;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => {this.listeners.delete(fn);}; };
  private show(patch: Partial<Snapshot>) { this.snapshot={...this.snapshot,...patch}; this.listeners.forEach(fn=>fn()); }
  setActor(actor: Actor | null) {
    if (sameActor(actor,this.snapshot.actor) || !actor && !this.snapshot.actor) return;
    if (this.snapshot.actor) this.quarantine={actorId:this.snapshot.actor.actorId,snapshot:this.snapshot};
    const saved=actor && this.quarantine?.actorId === actor.actorId ? this.quarantine.snapshot : null;
    if (actor && this.quarantine?.actorId !== actor.actorId) this.inFlight=null;
    if (actor) this.quarantine=null;
    this.reads.clear(); this.seenOwn.clear(); this.seenInvites.clear(); this.ownReadAcks=[]; this.resultCursors.clear(); this.serial++;
    this.invitationsBusy=false; this.invitationsFollowup=false; this.invitationsBusyGen++;
    this.noteTombs.clear(); this.noteAppliedGen.clear(); this.noteVersionFloor.clear(); this.noteAwaitingTyped.clear();
    this.reviewCursors.clear(); this.reviewVersionFloor.clear(); this.replyVersionFloor.clear();
    this.reviewAppliedGen.clear(); this.reviewAwaitingTyped.clear(); this.reviewHistoryOwned.clear();
    this.reviewDirectionDenied.clear();
    this.snapshot=empty(actor ? Object.freeze({...actor}) : null);
    // Reads must reestablish authority. Only the original packet is restored, never sent on login.
    // Same-account reauth restores explicit review/UNKNOWN and compatible drafts, without autowrite.
    // Known own-note refs restore for in-session recovery only — never auto-write / cold discovery.
    // Feedback drafts restore without auto-send; history must recheck authority via fresh GET.
    if (saved) this.show({
      filter:saved.filter,
      command:saved.command ? {packet:saved.command.packet,status:'unknown'} : null,
      notice:saved.command ? unknownNotice : null,
      review:saved.review,
      drafts:saved.drafts,
      noteDrafts:saved.noteDrafts,
      feedbackDrafts:saved.feedbackDrafts,
      knownNoteRefs:saved.knownNoteRefs,
      selection:saved.selection,
    });
    else this.show({});
  }
  forget = () => { this.quarantine=null; this.inFlight=null; this.reads.clear(); this.seenOwn.clear(); this.seenInvites.clear(); this.ownReadAcks=[]; this.resultCursors.clear(); this.serial++; this.invitationsBusy=false; this.invitationsFollowup=false; this.invitationsBusyGen++; this.noteTombs.clear(); this.noteAppliedGen.clear(); this.noteVersionFloor.clear(); this.noteAwaitingTyped.clear(); this.reviewCursors.clear(); this.reviewVersionFloor.clear(); this.replyVersionFloor.clear(); this.reviewAppliedGen.clear(); this.reviewAwaitingTyped.clear(); this.reviewHistoryOwned.clear(); this.reviewDirectionDenied.clear(); this.snapshot=empty(null); this.show({}); };
  filter = (filter: Filter) => { if (this.snapshot.actor && ['all','manage','participate','invites'].includes(filter)) this.show({filter}); };
  private start(key: string) { const n=++this.serial; this.reads.set(key,n); const actor=this.snapshot.actor; return {actor,valid:()=>!!actor && sameActor(actor,this.snapshot.actor) && this.reads.get(key)===n}; }
  private failure<T>(error: unknown, prior: Source<T>): Source<T> {
    const denied=error instanceof PostgameError && error.kind === 'private';
    return {status:denied ? 'unavailable' : 'error',...(denied ? {} : {data:prior.data})};
  }
  private clearIncompatibleDrafts(gameId: string, results?: Results) {
    const attendance = results?.attendance;
    const rows = [...(attendance?.roster ?? []),...(attendance?.myAttendance ? [attendance.myAttendance] : [])];
    const drafts = {...this.snapshot.drafts};
    let changed = false;
    for (const key of Object.keys(drafts)) {
      if (!key.startsWith(`${gameId}:`)) continue;
      const parts = key.split(':');
      const contextId = parts[1];
      const disputePart = parts.slice(2).join(':');
      const row = rows.find(r => r.contextId === contextId);
      // Roster pagination absence is not definitive removal — keep compatible later-page drafts.
      if (!row) continue;
      if (disputePart !== 'create' && row.dispute?.id !== disputePart && !this.snapshot.disputes[disputePart]?.data) {
        delete drafts[key]; changed = true;
      }
    }
    if (changed) this.show({drafts});
  }
  /**
   * Prefill/refresh only pristine selection — createDirty tracks explicit mutations
   * (incl. deliberate empty) independently of createText truthiness. Used for every
   * accepted current projection (direct GET and results.myNotes), never discarded/stale.
   */
  private refreshPristineSelectedPrefill(gameId: string, contextId: string, text: string, noteDrafts: Record<string, NoteDraft>) {
    const createDraft = noteDrafts[gameId];
    if (createDraft?.selectedContextId === contextId && !createDraft.createDirty) {
      return { ...noteDrafts, [gameId]: { ...createDraft, createText: text } };
    }
    return noteDrafts;
  }
  /** Monotonic note projection: never regress version; same-version rights may refresh under newer gens; tombs block resurrection. */
  private rememberOwnedNotes(notes: PersonalNote[], gen: number, fromDirect = false) {
    const known = {...this.snapshot.knownNoteRefs};
    const sources = {...this.snapshot.notes};
    let noteDrafts = this.snapshot.noteDrafts;
    let changed = false;
    let draftsChanged = false;
    for (const note of notes) {
      const key = noteKey(note.gameId, note.contextId);
      if (this.noteTombs.has(key)) continue;
      // Post-upsert: results/myNotes must not regrant ready rights before typed GET.
      if (!fromDirect && this.noteAwaitingTyped.has(key)) continue;
      const floor = this.noteVersionFloor.get(key) ?? 0;
      const applied = this.noteAppliedGen.get(key) ?? 0;
      // Floor survives loading/error — do not rely on ready Source.data alone.
      if (note.version < floor) continue;
      if (note.version === floor && gen < applied) continue;
      this.noteVersionFloor.set(key, note.version);
      this.noteAppliedGen.set(key, gen);
      if (fromDirect) this.noteAwaitingTyped.delete(key);
      known[key] = { gameId: note.gameId, contextId: note.contextId };
      sources[key] = { status: 'ready', data: note };
      changed = true;
      // After version/gen/tomb/current authority — results and direct GET share this path.
      const nextDrafts = this.refreshPristineSelectedPrefill(note.gameId, note.contextId, note.text, noteDrafts);
      if (nextDrafts !== noteDrafts) { noteDrafts = nextDrafts; draftsChanged = true; }
    }
    if (changed) this.show({ knownNoteRefs: known, notes: sources, ...(draftsChanged ? { noteDrafts } : {}) });
  }
  /** Clear scoped create/edit drafts for a confirmed-absent owned context; unrelated selections stay. */
  private clearAbsentContextDrafts(gameId: string, contextId: string) {
    const key = noteKey(gameId, contextId);
    const noteDrafts = {...this.snapshot.noteDrafts}; delete noteDrafts[key];
    const createDraft = noteDrafts[gameId];
    if (createDraft?.selectedContextId === contextId) {
      // Confirmed absence of the selected context must clear its create-form text (prefill from loadNote),
      // not retain private content in the reachable NotesSection TextInput. Unrelated contexts stay intact.
      noteDrafts[gameId] = { selectedContextId: undefined, createText: '', editText: createDraft.editText };
    }
    return noteDrafts;
  }
  private tombstoneOwnedNote(gameId: string, contextId: string, version: number) {
    const key = noteKey(gameId, contextId);
    const prior = this.noteTombs.get(key) ?? 0;
    this.noteTombs.set(key, Math.max(prior, version));
    // Invalidate in-flight direct GETs so late replies cannot reinstall private text.
    this.reads.set(`note:${key}`, ++this.serial);
    this.noteAppliedGen.delete(key);
    this.noteVersionFloor.delete(key);
    this.noteAwaitingTyped.delete(key);
    const known = {...this.snapshot.knownNoteRefs}; delete known[key];
    // Keep definitive unavailable so stale feedback.myNotes cannot render/resurrect the row.
    const notes = {...this.snapshot.notes, [key]: { status: 'unavailable' as const }};
    this.show({ knownNoteRefs: known, notes, noteDrafts: this.clearAbsentContextDrafts(gameId, contextId) });
  }
  private shadowKnownNoteAbsence(gameId: string, contextId: string) {
    const key = noteKey(gameId, contextId);
    const priorVersion = Math.max(
      this.noteVersionFloor.get(key) ?? 0,
      this.snapshot.notes[key]?.data?.version ?? 0,
      this.noteTombs.get(key) ?? 0,
    );
    this.noteTombs.set(key, Math.max(this.noteTombs.get(key) ?? 0, priorVersion));
    this.noteAppliedGen.delete(key);
    this.noteVersionFloor.delete(key);
    this.noteAwaitingTyped.delete(key);
    const known = {...this.snapshot.knownNoteRefs}; delete known[key];
    // Same selected-context draft privacy cleanup as DELETE ACK — current known GET404 must not leave
    // private prefill in NotesSection TextInput; unrelated selected context B drafts stay intact.
    this.show({ knownNoteRefs: known, noteDrafts: this.clearAbsentContextDrafts(gameId, contextId) });
  }
  loadOwn = async (more = false) => {
    if (this.snapshot.own.status === 'loading') return;
    const old=this.snapshot.own, cursor=more ? old.data?.nextCursor : undefined;
    if (more && !cursor) return;
    const {actor,valid}=this.start('own'); if (!actor) return;
    this.ownReadAcks=[];
    this.show({own:{...old,status:'loading'}});
    try {
      const page=await this.port.own(actor,cursor ?? undefined); if (!valid()) return;
      if (page.nextCursor && (page.nextCursor === cursor || more && this.seenOwn.has(page.nextCursor))) throw new PostgameError('invalid');
      if (!more) this.seenOwn.clear(); if (page.nextCursor) this.seenOwn.add(page.nextCursor);
      const rows=new Map<string,OwnResult>();
      for (const item of [...(more ? this.snapshot.own.data?.items ?? [] : []),...page.items]) {
        const fresh=this.ownReadAcks.reduce(applyOwnAck,item);
        const key=`${fresh.gameId}:${fresh.contextId}`, prior=rows.get(key);
        // Historical notice rows carry CURRENT attendance. Keep only a matching pending
        // notice; fresh ACK/version/rights always win, including across page boundaries.
        if (prior?.notice && needsAttention(prior) && fresh.attendance.acknowledgedVersion !== fresh.attendance.version &&
            prior.notice.attendanceVersion === fresh.attendance.version &&
            (fresh.notice === null || needsAttention(fresh) && Date.parse(prior.notice.createdAt) >= Date.parse(fresh.notice.createdAt))) {
          rows.set(key,{...fresh,notice:prior.notice});
        } else rows.set(key,fresh);
      }
      const items=[...rows.values()];
      this.show({own:{status:'ready',data:{items,nextCursor:page.nextCursor}}});
    } catch(error) { if (valid()) this.show({own:this.failure(error,this.snapshot.own)}); }
    finally { if (valid()) this.ownReadAcks=[]; }
  };
  loadReminders = async () => {
    const {actor,valid}=this.start('reminders'); if (!actor) return; const old=this.snapshot.reminders;
    this.show({reminders:{...old,status:'loading'}});
    try { const data=await this.port.reminders(actor); if(valid()) this.show({reminders:{status:'ready',data}}); }
    catch(error) { if(valid()) this.show({reminders:this.failure(error,old)}); }
  };
  /** Own invitations list — independent lane; never settles Messages invitation writes. */
  loadInvitations = async (more = false) => {
    // ACK/callback refresh during in-flight initial or load-more: invalidate the stale
    // page and coalesce exactly one fresh authoritative root GET. Never apply list
    // reads to unknown Messages packets; cursor/retry/dedupe stay on the fresh read.
    // Busy (not status) gates re-entry so a queued followup can start after invalidation
    // while UI status is still loading.
    if (this.invitationsBusy) {
      if (!more) {
        this.invitationsFollowup = true;
        this.reads.set('invitations', ++this.serial);
      }
      return;
    }
    const old=this.snapshot.invitations, cursor=more ? old.data?.nextCursor : undefined;
    if (more && !cursor) return;
    const {actor,valid}=this.start('invitations'); if (!actor) return;
    const busyGen=++this.invitationsBusyGen;
    this.invitationsBusy=true;
    this.show({invitations:{...old,status:'loading'}});
    try {
      const page=await this.port.invitations(actor,cursor ?? undefined); if (!valid()) return;
      if (page.nextCursor && (page.nextCursor === cursor || more && this.seenInvites.has(page.nextCursor))) throw new PostgameError('invalid');
      if (!more) this.seenInvites.clear(); if (page.nextCursor) this.seenInvites.add(page.nextCursor);
      const rows=new Map<string,GameInvitation>();
      for (const item of [...(more ? this.snapshot.invitations.data?.items ?? [] : []),...page.items]) rows.set(item.id,item);
      this.show({invitations:{status:'ready',data:{items:[...rows.values()],nextCursor:page.nextCursor}}});
    } catch(error) {
      if (!valid()) return;
      const mapped = error instanceof MessagesError
        ? new PostgameError(error.kind === 'private' ? 'private' : error.kind === 'invalid' ? 'invalid' : 'network', error.status, error.code)
        : error;
      this.show({invitations:this.failure(mapped,this.snapshot.invitations)});
    } finally {
      // Only the generation that set busy may clear it or consume a queued refresh.
      if (this.invitationsBusyGen === busyGen) {
        this.invitationsBusy=false;
        if (this.invitationsFollowup) {
          this.invitationsFollowup=false;
          if (actor && sameActor(actor,this.snapshot.actor)) void this.loadInvitations(false);
        }
      }
    }
  };
  loadResults = async (gameId: string, query: ResultsQuery = {}, append?: 'roster' | 'revisions') => {
    try { postgameId(gameId); } catch { return; }
    const old: Source<Results>=this.snapshot.games[gameId] ?? {status:'idle'};
    if (!append && (query.rosterCursor || query.revisionsCursor) || append === 'roster' && query.revisionsCursor || append === 'revisions' && query.rosterCursor) return;
    // Pagination is only from a cursor already received for this actor/game.
    if (append === 'roster' && (!old.data?.attendance?.rosterNextCursor || query.rosterCursor !== old.data.attendance.rosterNextCursor) ||
        append === 'revisions' && (!old.data?.revisionsNextCursor || query.revisionsCursor !== old.data.revisionsNextCursor)) return;
    const {actor,valid}=this.start(`game:${gameId}`); if (!actor) return;
    const resultsGen = this.reads.get(`game:${gameId}`) ?? 0;
    const selection=this.snapshot.selection?.gameId === gameId ? this.snapshot.selection : this.snapshot.selection;
    const put=(source: Source<Results>)=>this.show({games:{...this.snapshot.games,[gameId]:source}});
    put({...old,status:'loading'});
    try {
      const data=await this.port.results(actor,gameId,query); if(!valid()) return;
      if(data.gameId !== gameId) throw new PostgameError('invalid');
      for (const kind of ['roster','revisions'] as const) {
        const key=`${gameId}:${kind}`;
        const exposed=kind === 'roster' ? data.attendance?.roster : data.revisions;
        if (!exposed) { this.resultCursors.delete(key); continue; }
        if (append && append !== kind) continue;
        const seen=append ? this.resultCursors.get(key) ?? new Set<string>() : new Set<string>();
        const next=kind === 'roster' ? data.attendance?.rosterNextCursor : data.revisionsNextCursor;
        if(next && seen.has(next)) throw new PostgameError('invalid');
        if(next) seen.add(next); this.resultCursors.set(key,seen);
      }
      if(append === 'roster' && data.attendance?.roster && old.data?.attendance) {
        if(data.attendance.rosterNextCursor && data.attendance.rosterNextCursor === query.rosterCursor) throw new PostgameError('invalid');
        data.attendance.roster=[...new Map([...(old.data.attendance.roster ?? []),...(data.attendance.roster ?? [])].map(r=>[r.contextId,r])).values()];
      }
      if(append === 'revisions' && data.revisions) {
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
      // A GET never acknowledges or settles a pending command. Roster pagination keeps selection.
      put({status:'ready',data});
      this.clearIncompatibleDrafts(gameId, data);
      if (data.feedback?.installed && data.feedback.myNotes.length) this.rememberOwnedNotes(data.feedback.myNotes, resultsGen);
      if (data.feedback?.gameReviews?.length) this.rememberReviews(data.feedback.gameReviews, resultsGen, 'results');
      if (selection?.gameId === gameId) {
        const rows=[...(data.attendance?.roster ?? []),...(data.attendance?.myAttendance ? [data.attendance.myAttendance] : [])];
        const still=rows.some(r=>r.contextId === selection.contextId && r.dispute?.id === selection.disputeId);
        if (!still && !this.snapshot.disputes[selection.disputeId]?.data) this.show({selection:null});
      }
    } catch(error) {
      // Denied results must not wipe actor-bound known own-note refs or direct note sources.
      if(valid()) put(this.failure(error,old));
    }
  };
  /** Direct own-note GET for a known/selected context — independent of results/roster denial. */
  loadNote = async (gameId: string, contextId: string) => {
    try { postgameId(gameId); postgameId(contextId); } catch { return; }
    const key = noteKey(gameId, contextId);
    const old = this.snapshot.notes[key] ?? { status: 'idle' };
    const { actor, valid } = this.start(`note:${key}`); if (!actor) return;
    const noteGen = this.reads.get(`note:${key}`) ?? 0;
    const put = (source: Source<PersonalNote>) => this.show({ notes: { ...this.snapshot.notes, [key]: source } });
    // Only confirmed delete / known-owned definitive 404 (noteTombs) fence through select/refresh.
    // Fresh never-owned GET404 is provisional create authority — next direct GET must go loading
    // (block create0) until the read confirms absence again, errors, or finds the note.
    const tombFenced = this.noteTombs.has(key);
    if (!tombFenced) put({ ...old, status: 'loading' });
    try {
      const data = await this.port.note(actor, gameId, contextId); if (!valid()) return;
      if (data.gameId !== gameId || data.contextId !== contextId) throw new PostgameError('invalid');
      if (this.noteTombs.has(key)) {
        put({ status: 'unavailable' });
        return;
      }
      // Monotonic apply first — never put ready before floor/gen comparison (reverse race).
      // Pristine selected prefill runs inside rememberOwnedNotes for accepted current only.
      this.rememberOwnedNotes([data], noteGen, true);
      const cur = this.snapshot.notes[key];
      if (cur?.status === 'ready' && this.noteAppliedGen.get(key) === noteGen) {
        return;
      }
      // Stale/rejected reply: reinstate retained newer ready projection if still loading.
      if (cur?.status === 'loading') {
        const retained = cur.data ?? old.data;
        if (retained) put({ status: 'ready', data: retained });
      }
    } catch (error) {
      if (!valid()) return;
      // Stale negative fence: newer results/direct already accepted after this GET started.
      // Late older private404 must not tombstone that projection; late network must not downgrade ready rights.
      const applied = this.noteAppliedGen.get(key) ?? 0;
      if (noteGen < applied) return;
      const denied = error instanceof PostgameError && error.kind === 'private';
      const current = this.snapshot.notes[key] ?? old;
      const known = !!this.snapshot.knownNoteRefs[key] || this.noteTombs.has(key) || !!current.data || !!old.data;
      if (denied && known) {
        // Definitive private 404 of a known/tombstoned own note: shadow stale myNotes; never turn into create.
        this.shadowKnownNoteAbsence(gameId, contextId);
        put({ status: 'unavailable' });
        return;
      }
      // Tombstone display fence persists through read error — no stale myNotes resurrection.
      if (this.noteTombs.has(key)) {
        put({ status: 'unavailable' });
        return;
      }
      // Transient errors keep retained text via current/prior data but do not grant write authority (see currentNote).
      // Fresh never-owned private 404 → unavailable (create eligible); network → error (create blocked).
      put(this.failure(error, current.data || old.data ? current : old));
    }
  };
  setNoteDraft = (gameId: string, contextId: string | null, patch: NoteDraft) => {
    if (!this.snapshot.actor) return;
    try { postgameId(gameId); if (contextId) postgameId(contextId); } catch { return; }
    // Create-form drafts key by gameId; per-note edit drafts by gameId:contextId.
    const key = contextId ? noteKey(gameId, contextId) : gameId;
    const prior = this.snapshot.noteDrafts[key] ?? {};
    // Switching selected participant must not carry create text into another context.
    // Bounded myNotes absence is not authority — always direct-GET the chosen context before create/edit.
    if (patch.selectedContextId !== undefined && patch.selectedContextId !== prior.selectedContextId) {
      const hasText = patch.createText !== undefined;
      this.show({
        noteDrafts: {
          ...this.snapshot.noteDrafts,
          [key]: {
            selectedContextId: patch.selectedContextId,
            createText: hasText ? patch.createText : '',
            editText: prior.editText,
            ...(hasText ? { createDirty: true } : {}),
          },
        },
      });
      if (patch.selectedContextId) void this.loadNote(gameId, patch.selectedContextId);
      return;
    }
    const next: NoteDraft = { ...prior, ...patch };
    // Explicit createText patch (including '') marks dirty; selection-only init stays pristine.
    if (patch.createText !== undefined) next.createDirty = true;
    this.show({ noteDrafts: { ...this.snapshot.noteDrafts, [key]: next } });
  };
  loadDispute = async (disputeId: string) => {
    try { postgameId(disputeId); } catch { return; }
    const old = this.snapshot.disputes[disputeId] ?? {status:'idle'};
    const {actor,valid}=this.start(`dispute:${disputeId}`); if (!actor) return;
    const put=(source: Source<AttendanceDispute>)=>this.show({disputes:{...this.snapshot.disputes,[disputeId]:source}});
    put({...old,status:'loading'});
    try {
      const data=await this.port.dispute(actor,disputeId); if(!valid()) return;
      if (data.id !== disputeId) throw new PostgameError('invalid');
      put({status:'ready',data});
      const selection=this.snapshot.selection;
      if (selection?.disputeId === disputeId && (selection.gameId !== data.gameId || selection.contextId !== data.contextId)) {
        this.show({selection:{gameId:data.gameId,contextId:data.contextId,disputeId}});
      }
    } catch(error) { if(valid()) put(this.failure(error,old)); }
  };
  loadHistory = async (gameId: string, contextId: string, limit?: number) => {
    try { postgameId(gameId); postgameId(contextId); } catch { return; }
    const key=`${gameId}:${contextId}`;
    const old=this.snapshot.histories[key] ?? {status:'idle'};
    const {actor,valid}=this.start(`history:${key}`); if (!actor) return;
    const put=(source: Source<AttendanceHistoryPage>)=>this.show({histories:{...this.snapshot.histories,[key]:source}});
    put({...old,status:'loading'});
    try {
      const data=await this.port.history(actor,gameId,contextId,limit); if(!valid()) return;
      put({status:'ready',data});
    } catch(error) { if(valid()) put(this.failure(error,old)); }
  };
  selectDispute = (selection: DisputeSelection | null) => {
    if (!this.snapshot.actor) return;
    if (!selection) { this.show({selection:null}); return; }
    try { postgameId(selection.gameId); postgameId(selection.contextId); postgameId(selection.disputeId); } catch { return; }
    const prior=this.snapshot.selection;
    // Wrong row retires private form contents that belong to another participant.
    if (prior && (prior.gameId !== selection.gameId || prior.contextId !== selection.contextId || prior.disputeId !== selection.disputeId)) {
      const stale=draftKey(prior.gameId, prior.contextId, prior.disputeId);
      const drafts={...this.snapshot.drafts}; delete drafts[stale];
      this.show({selection,drafts});
    } else this.show({selection});
    void this.loadDispute(selection.disputeId);
  };
  setDraft = (gameId: string, contextId: string, disputeId: string | null | undefined, patch: DisputeDraft) => {
    if (!this.snapshot.actor) return;
    try { postgameId(gameId); postgameId(contextId); if (disputeId) postgameId(disputeId); } catch { return; }
    const key=draftKey(gameId,contextId,disputeId);
    const prior=this.snapshot.drafts[key] ?? {};
    this.show({drafts:{...this.snapshot.drafts,[key]:{...prior,...patch}}});
  };
  setFeedbackDraft = (gameId: string, patch: FeedbackDraft) => {
    if (!this.snapshot.actor) return;
    try { postgameId(gameId); } catch { return; }
    const prior = this.snapshot.feedbackDrafts[gameId] ?? {};
    const next: FeedbackDraft = { ...prior, ...patch };
    if (patch.replyText) next.replyText = { ...(prior.replyText ?? {}), ...patch.replyText };
    // Opening/changing report target resets consent; keep known version from the open patch.
    if (patch.reportReviewId !== undefined && patch.reportReviewId !== prior.reportReviewId) {
      next.reportConsent = false;
      if (patch.reportConsentVersion === undefined) next.reportConsentVersion = undefined;
    }
    // Revision change without an explicit consent field resets true consent (preserve detail).
    // Explicit current-version grant in the same patch must take one press.
    if (patch.reportConsentVersion !== undefined && prior.reportConsentVersion !== undefined
      && patch.reportConsentVersion !== prior.reportConsentVersion
      && patch.reportConsent === undefined) {
      next.reportConsent = false;
    }
    this.show({ feedbackDrafts: { ...this.snapshot.feedbackDrafts, [gameId]: next } });
  };
  /** Reset report consent when typed revision advances; preserve detail draft. */
  private resetReportConsentForRevision(row: PrivateReview) {
    const drafts = { ...this.snapshot.feedbackDrafts };
    let changed = false;
    for (const [gameId, draft] of Object.entries(drafts)) {
      if (draft.reportReviewId !== row.id) continue;
      if (!draft.reportConsent && draft.reportConsentVersion === row.version) continue;
      if (draft.reportConsentVersion === row.version && draft.reportConsent) continue;
      drafts[gameId] = { ...draft, reportConsent: false };
      changed = true;
    }
    if (changed) this.show({ feedbackDrafts: drafts });
  }
  /**
   * Monotonic typed review store — version + read-gen authority.
   * Only typed history restores private projection after hard deny; results/receipts cannot
   * resurrect while denied or (results) while awaiting typed GET. Receipt ACK is display-only
   * until typed history refresh. Reply revision is independently monotonic across review edits.
   */
  private rememberReviews(rows: PrivateReview[], gen: number, source: 'results' | 'history' | 'receipt') {
    const byId = { ...this.snapshot.reviewsById };
    let changed = false;
    const revisionAdvances: PrivateReview[] = [];
    for (const row of rows) {
      // Hard-denied direction: settle packet elsewhere; only successful typed history may restore.
      if (source !== 'history' && this.reviewDirectionDenied.has(row.direction)) continue;
      if (source === 'results' && this.reviewAwaitingTyped.has(row.id)) continue;
      const floor = this.reviewVersionFloor.get(row.id) ?? 0;
      if (row.version < floor) continue;
      // Typed history owns the current floor — later results cannot same-version regress rights/text.
      if (source === 'results' && this.reviewHistoryOwned.has(row.id) && row.version <= floor) continue;
      const applied = this.reviewAppliedGen.get(row.id) ?? 0;
      if (row.version === floor && gen < applied) continue;
      const prior = byId[row.id];
      const replyFloor = this.replyVersionFloor.get(row.id) ?? 0;
      const replyVer = row.reply?.version ?? 0;
      let next: PrivateReview = row;
      // Reply revisions are independent of parent review version — keep highest accepted reply.
      if (prior && replyVer < replyFloor) {
        next = { ...row, reply: prior.reply };
      }
      if (source === 'receipt') {
        // Historical ACK settles the packet only — strip write grants until typed history.
        next = {
          ...next,
          allowedActions: {
            canEdit: false,
            canReply: false,
            canReport: next.allowedActions.canReport,
          },
        };
        this.reviewAwaitingTyped.add(row.id);
        this.reviewHistoryOwned.delete(row.id);
      }
      if (source === 'history') {
        this.reviewAwaitingTyped.delete(row.id);
        this.reviewHistoryOwned.add(row.id);
      }
      if (source === 'results' && row.version > floor) this.reviewHistoryOwned.delete(row.id);
      byId[row.id] = next;
      this.reviewVersionFloor.set(row.id, Math.max(floor, row.version));
      this.replyVersionFloor.set(row.id, Math.max(replyFloor, next.reply?.version ?? 0));
      this.reviewAppliedGen.set(row.id, gen);
      if (prior && prior.version !== next.version) revisionAdvances.push(next);
      changed = true;
    }
    if (changed) this.show({ reviewsById: byId });
    for (const row of revisionAdvances) this.resetReportConsentForRevision(row);
  }
  /** Hard-denied own-history: retire private projection/permissions for that direction. */
  private retireReviewDirection(direction: ReviewDirection) {
    this.reviewDirectionDenied.add(direction);
    const byId = { ...this.snapshot.reviewsById };
    const retired = new Set<string>();
    let changed = false;
    for (const [id, row] of Object.entries(byId)) {
      if (row.direction !== direction) continue;
      delete byId[id];
      retired.add(id);
      this.reviewVersionFloor.delete(id);
      this.replyVersionFloor.delete(id);
      this.reviewAppliedGen.delete(id);
      this.reviewAwaitingTyped.delete(id);
      this.reviewHistoryOwned.delete(id);
      changed = true;
    }
    const drafts = { ...this.snapshot.feedbackDrafts };
    let draftsChanged = false;
    for (const [gameId, draft] of Object.entries(drafts)) {
      if (!draft.reportReviewId || !retired.has(draft.reportReviewId)) continue;
      drafts[gameId] = {
        ...draft,
        reportReviewId: undefined,
        reportConsent: false,
        reportConsentVersion: undefined,
      };
      draftsChanged = true;
    }
    if (changed || draftsChanged) {
      this.show({
        reviewsById: byId,
        ...(draftsChanged ? { feedbackDrafts: drafts } : {}),
      });
    }
  }
  /**
   * Write authority: actor/session-bound typed ready history (or idle+ready results bootstrap).
   * Pending/error/unavailable and post-ACK awaiting typed never grant new reply/report.
   */
  private currentReviewForWrite(reviewId: string): PrivateReview | null {
    if (this.reviewAwaitingTyped.has(reviewId)) return null;
    const review = this.snapshot.reviewsById[reviewId] ?? null;
    if (!review) return null;
    if (this.reviewDirectionDenied.has(review.direction)) return null;
    const history = this.snapshot.reviewHistory[review.direction];
    if (history.status === 'loading' || history.status === 'error' || history.status === 'unavailable') {
      return null;
    }
    if (history.status === 'ready') return review;
    // Idle: only a ready results projection may bootstrap before the first history GET settles.
    const results = this.snapshot.games[review.gameId];
    if (results?.status === 'ready' && results.data?.feedback?.gameReviews?.some(r => r.id === reviewId)) {
      return review;
    }
    return null;
  }
  /** Own directional history — independent of denied results; honest cursor/empty/error. */
  loadReviews = async (direction: ReviewDirection, more = false) => {
    if (direction !== 'sent' && direction !== 'received') return;
    const old = this.snapshot.reviewHistory[direction];
    if (old.status === 'loading') return;
    const cursor = more ? old.data?.nextCursor : undefined;
    if (more && !cursor) return;
    const { actor, valid } = this.start(`reviews:${direction}`);
    if (!actor) return;
    const historyGen = this.reads.get(`reviews:${direction}`) ?? 0;
    const put = (source: Source<MeReviewsPage>) => this.show({
      reviewHistory: { ...this.snapshot.reviewHistory, [direction]: source },
    });
    put({ ...old, status: 'loading' });
    try {
      const page = await this.port.reviews(actor, direction, cursor ?? undefined);
      if (!valid()) return;
      const seen = more ? this.reviewCursors.get(direction) ?? new Set<string>() : new Set<string>();
      if (page.nextCursor && (page.nextCursor === cursor || seen.has(page.nextCursor))) throw new PostgameError('invalid');
      if (page.nextCursor) seen.add(page.nextCursor);
      this.reviewCursors.set(direction, seen);
      const priorItems = more ? old.data?.items ?? [] : [];
      // Retain nextCursor honestly even when page has non-peer rows.
      const merged = mergeReviewPages(priorItems, page.items, direction);
      this.reviewDirectionDenied.delete(direction);
      this.rememberReviews(page.items, historyGen, 'history');
      // Prefer store projection so UI/history page stay coherent with monotonic rights.
      const projected = merged.map(row => this.snapshot.reviewsById[row.id] ?? row);
      put({ status: 'ready', data: { items: projected, nextCursor: page.nextCursor } });
    } catch (error) {
      if (!valid()) return;
      const denied = error instanceof PostgameError && error.kind === 'private';
      put(this.failure(error, old));
      if (denied) this.retireReviewDirection(direction);
    }
  };
  private currentNote(gameId: string, contextId: string): PersonalNote | null {
    const key = noteKey(gameId, contextId);
    if (this.noteTombs.has(key)) return null;
    const direct = this.snapshot.notes[key];
    // Definitive unavailable shadows stale feedback.myNotes — never resurrect create/edit from the list.
    if (direct?.status === 'unavailable') return null;
    // Only ready typed authority grants review/confirm — retained loading/error data is display-only.
    if (direct?.status === 'ready' && direct.data && direct.data.gameId === gameId && direct.data.contextId === contextId) {
      return direct.data;
    }
    // Transient loading/error: no write authority (blocks historical myNotes fallback after PUT+GET failure too).
    if (direct?.status === 'loading' || direct?.status === 'error') {
      return null;
    }
    const feedback = this.snapshot.games[gameId]?.data?.feedback;
    return feedback?.myNotes.find(n => n.contextId === contextId && n.gameId === gameId) ?? null;
  }
  private allowed(intent: Intent) {
    if (intent.kind === 'peer-create') {
      const results = this.snapshot.games[intent.gameId];
      const feedback = results?.status === 'ready' ? results.data?.feedback : undefined;
      if (!feedback?.installed || !feedback.writesEnabled || !feedback.capabilities.canCreatePeer) return false;
      if (intent.body.kind !== 'peer' || intent.body.experienceAssertion !== 'i_experienced_this_game') return false;
      return feedback.capabilities.peerSubjects.some(s => s.contextId === intent.body.subjectContextId);
    }
    if (intent.kind === 'peer-reply') {
      const review = this.currentReviewForWrite(intent.reviewId);
      if (!review || review.id !== intent.reviewId || review.gameId !== intent.gameId) return false;
      if (review.direction !== 'received' || !review.allowedActions.canReply) return false;
      const results = this.snapshot.games[intent.gameId];
      // When results are ready, fresh writesEnabled gates ordinary reply; history canReply alone is not enough against known writes-off.
      if (results?.status === 'ready') {
        const feedback = results.data?.feedback;
        if (!feedback?.installed || !feedback.writesEnabled) return false;
      }
      const replyVer = review.reply?.version ?? 0;
      return replyVer === intent.body.expectedVersion;
    }
    if (intent.kind === 'peer-report') {
      const review = this.currentReviewForWrite(intent.reviewId);
      if (!review || review.id !== intent.reviewId || review.gameId !== intent.gameId) return false;
      if (review.direction !== 'received' || !review.allowedActions.canReport) return false;
      // Report is independent of writesEnabled / create experience.
      if (review.version !== intent.body.expectedVersion) return false;
      if (intent.body.gameId !== intent.gameId || intent.body.shareReviewWithSupport !== true) return false;
      const draft = this.snapshot.feedbackDrafts[intent.gameId];
      if (!draft?.reportConsent || draft.reportReviewId !== intent.reviewId) return false;
      // Exact frozen revision consent — undefined version is not an escape.
      if (draft.reportConsentVersion !== review.version) return false;
      return true;
    }
    if (intent.kind === 'note-upsert' || intent.kind === 'note-delete') {
      if (intent.kind === 'note-upsert') {
        try { noteText(intent.body.text); } catch { return false; }
      }
      const key = noteKey(intent.gameId, intent.contextId);
      const note = this.currentNote(intent.gameId, intent.contextId);
      const results = this.snapshot.games[intent.gameId];
      const feedback = results?.status === 'ready' ? results.data?.feedback : undefined;
      if (intent.kind === 'note-delete') {
        return !!note && note.version === intent.body.expectedVersion && note.allowedActions.canDelete
          && (feedback ? feedback.installed && feedback.writesEnabled : true);
      }
      // First create: requires definitive selected direct GET absence — bounded list gap is not authority.
      if (intent.body.expectedVersion === 0) {
        if (!feedback?.installed || !feedback.writesEnabled || !feedback.capabilities.canCreateNote) return false;
        if (this.noteTombs.has(key) || this.snapshot.knownNoteRefs[key]) return false;
        const selected = this.snapshot.notes[key];
        if (selected?.status !== 'unavailable') return false;
        if (note) return false;
        const subjects = feedback.capabilities.peerSubjects;
        const roster = results?.data?.attendance?.roster ?? [];
        const allowedContext = subjects.some(s => s.contextId === intent.contextId)
          || roster.some(r => r.contextId === intent.contextId);
        return allowedContext;
      }
      // Edit: own note rights from authoritative current projection — independent of create form / roster after revoke.
      return !!note && note.version === intent.body.expectedVersion && note.allowedActions.canEdit
        && (feedback ? feedback.installed && feedback.writesEnabled : true);
    }
    if(intent.kind === 'later') { const source=this.snapshot.reminders.data, item=source?.items.find(r=>r.id === intent.reminderId); return this.snapshot.reminders.status === 'ready' && !!source?.writesEnabled && !!item && item.gameId === intent.gameId && item.version === intent.body.expectedVersion && item.allowedActions.canLater; }
    if (intent.kind === 'withdraw' || intent.kind === 'respond' || intent.kind === 'help') {
      const detail=this.snapshot.disputes[intent.disputeId];
      if (detail?.status !== 'ready' || !detail.data || detail.data.id !== intent.disputeId || detail.data.version !== intent.body.expectedVersion) return false;
      const results=this.snapshot.games[detail.data.gameId];
      if (results?.status !== 'ready' || !results.data?.attendance?.installed || !results.data.attendance.writesEnabled) return false;
      if (intent.kind === 'withdraw') return detail.data.allowedActions.canWithdraw;
      if (intent.kind === 'respond') return detail.data.allowedActions.canRespond;
      return detail.data.allowedActions.canRequestHelp;
    }
    const result=this.snapshot.games[intent.gameId]; if(result?.status !== 'ready' || !result.data) return false;
    const r=result.data;
    if(intent.kind === 'outcome') return r.allowedActions.canRecordOutcome && r.outcome.version === intent.body.expectedVersion;
    const attendance=r.attendance; if(!attendance?.installed || !attendance.writesEnabled) return false;
    const rows=[...(attendance.roster ?? []),...(attendance.myAttendance ? [attendance.myAttendance] : [])];
    if(intent.kind === 'bulk') return attendance.allowedActions.canBulkPresent && intent.body.items.every(item=>rows.some(row=>row.contextId === item.contextId && row.version === item.expectedVersion && row.allowedActions.canSetAttendance && row.value === 'unknown' && row.dispute?.status !== 'open'));
    if (intent.kind === 'dispute') {
      const row=rows.find(row=>row.contextId === intent.contextId);
      return !!row && row.allowedActions.canDispute && row.version === intent.body.attendanceVersion && row.dispute?.status !== 'open';
    }
    const row=rows.find(row=>row.contextId === intent.contextId); if(!row) return false;
    if (intent.kind === 'ack') {
      const resolving = intent.body.resolvingDisputeId !== undefined && intent.body.expectedDisputeVersion !== undefined;
      if (resolving) {
        const detail=this.snapshot.disputes[intent.body.resolvingDisputeId!];
        return !!detail && detail.status === 'ready' && !!detail.data && detail.data.id === intent.body.resolvingDisputeId
          && detail.data.contextId === intent.contextId && detail.data.gameId === intent.gameId
          && detail.data.version === intent.body.expectedDisputeVersion
          && detail.data.currentAssertion.version === intent.body.attendanceVersion
          && mayAcknowledgeCurrent(detail.data)
          && row.contextId === attendance.myAttendance?.contextId;
      }
      // Ordinary ACK remains blocked while an open dispute is on the row.
      return mayAcknowledge(row) && row.contextId === attendance.myAttendance?.contextId && row.version === intent.body.attendanceVersion;
    }
    // Open dispute blocks ordinary attendance edits; respond/ack rights come from selected dispute detail.
    if (row.dispute?.status === 'open') return false;
    return row.allowedActions.canSetAttendance && row.version === intent.body.expectedVersion;
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
    // Actor object identity also fences a switch away and back to identical
    // credentials. Explicit reconcile captures the new authority separately.
    const valid=()=>authority === this.snapshot.actor && this.snapshot.command?.packet === packet;
    try {
      const receipt=validateReceipt(await this.port.send(packet,authority),packet);
      if(!valid()) return;
      let own=this.snapshot.own;
      if (packet.kind === 'ack' && 'acknowledgedVersion' in receipt) {
        const ack: OwnAck={gameId:packet.gameId,contextId:receipt.contextId,version:receipt.version};
        if (own.status === 'loading') this.ownReadAcks.push(ack);
        if (own.data) own={...own,data:{...own.data,items:own.data.items.map(row=>applyOwnAck(row,ack))}};
      }
      const disputes={...this.snapshot.disputes};
      if ((packet.kind === 'dispute' || packet.kind === 'withdraw' || packet.kind === 'respond' || packet.kind === 'help') && 'id' in receipt && 'history' in receipt) {
        disputes[receipt.id]={status:'ready',data:receipt};
      }
      if (packet.kind === 'note-upsert' && 'text' in receipt && 'allowedActions' in receipt) {
        // Historical ACK settles the original packet only — do not repaint receipt as current or unlock writes.
        const noteKeyId = noteKey(packet.gameId, packet.contextId);
        this.reads.set(`note:${noteKeyId}`, ++this.serial);
        // Per-context tombstone (e.g. owned GET404 after UNKNOWN PUT + external delete): settle without
        // replacing unavailable with loading, restoring known refs/private text/version/rights, or create.
        // Historical ACK is never current projection; follow-up loadNote stays tomb-fenced.
        if (!this.noteTombs.has(noteKeyId)) {
          this.noteAwaitingTyped.add(noteKeyId);
          // Raise floor from receipt version so older myNotes cannot win before typed GET; receipt stays non-current.
          if (typeof receipt.version === 'number') {
            this.noteVersionFloor.set(noteKeyId, Math.max(this.noteVersionFloor.get(noteKeyId) ?? 0, receipt.version));
          }
          const known = { ...this.snapshot.knownNoteRefs, [noteKeyId]: { gameId: packet.gameId, contextId: packet.contextId } };
          // Retain accepted newer projection as display-only under loading — do not drop data and fall
          // back to stale bounded myNotes while follow-up GET is pending/error. Writes stay typed-ready only.
          const priorNote = this.snapshot.notes[noteKeyId];
          const notes = {
            ...this.snapshot.notes,
            [noteKeyId]: {
              status: 'loading' as const,
              ...(priorNote?.data ? { data: priorNote.data } : {}),
            },
          };
          const createKey = packet.gameId;
          const editKey = noteKeyId;
          const noteDrafts = { ...this.snapshot.noteDrafts };
          if (noteDrafts[createKey]?.selectedContextId === packet.contextId) {
            noteDrafts[createKey] = { selectedContextId: '', createText: '' };
          }
          if (noteDrafts[editKey]) delete noteDrafts[editKey];
          this.show({ knownNoteRefs: known, notes, noteDrafts });
        }
      }
      if (packet.kind === 'note-delete' && 'deleted' in receipt && receipt.deleted) {
        this.tombstoneOwnedNote(packet.gameId, packet.contextId, receipt.version);
      }
      if (packet.kind === 'peer-create' && 'peerRating' in receipt && 'direction' in receipt) {
        // ACK display-only until typed sent history refresh reestablishes rights.
        this.rememberReviews([receipt], ++this.serial, 'receipt');
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        drafts[packet.gameId] = {
          ...prior,
          peerRating: undefined,
          comment: '',
          tags: [],
          subjectContextId: prior.subjectContextId,
        };
        this.show({ feedbackDrafts: drafts });
      }
      if (packet.kind === 'peer-reply' && 'reply' in receipt && 'direction' in receipt) {
        // ACK display-only until typed received history refresh; do not grant another reply from receipt.
        this.rememberReviews([receipt], ++this.serial, 'receipt');
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        const replyText = { ...(prior.replyText ?? {}) };
        delete replyText[packet.reviewId];
        drafts[packet.gameId] = { ...prior, replyText };
        this.show({ feedbackDrafts: drafts });
      }
      if (packet.kind === 'peer-report' && 'reportId' in receipt && receipt.status === 'submitted') {
        // Receipt already bound to original packet by validateReceipt — clear consent, keep detail draft.
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        drafts[packet.gameId] = {
          ...prior,
          reportReviewId: undefined,
          reportConsent: false,
          reportConsentVersion: undefined,
          reportDetail: prior.reportDetail,
        };
        this.show({ feedbackDrafts: drafts });
      }
      // Resolving ACK: verified resolvedDispute stays on the ACK receipt only.
      // Never fabricate dispute timestamps/rights or regress the projection from historical receipt fields.
      // Authoritative DTO comes from loadDispute below; follow-up GET failure stays a distinct retryable read error.
      // Historical note ACK settles the original action only — refresh current projection before next op.
      this.show({own,disputes,command:null,notice:reconciling ? 'Исходное действие подтверждено. Обновляем текущие данные.' : 'Изменения сохранены.'});
      // Receipt replay is history; always read current rights/version separately.
      const gameId = packet.gameId;
      void this.loadResults(gameId); void this.loadReminders();
      const disputeWrite = packet.kind === 'dispute' || packet.kind === 'withdraw' || packet.kind === 'respond' || packet.kind === 'help';
      const resolvingAck = packet.kind === 'ack' && packet.body.resolvingDisputeId !== undefined;
      const noteWrite = packet.kind === 'note-upsert' || packet.kind === 'note-delete';
      // Dispute lifecycle and resolving ACK refresh own hub; ordinary ACK keeps local notice settlement.
      if (disputeWrite || resolvingAck) void this.loadOwn();
      if (disputeWrite) {
        const id = 'disputeId' in packet ? packet.disputeId : 'id' in receipt && 'history' in receipt ? receipt.id : null;
        if (id) void this.loadDispute(id);
      }
      if (resolvingAck && packet.kind === 'ack') void this.loadDispute(packet.body.resolvingDisputeId!);
      if (this.snapshot.selection?.disputeId) void this.loadDispute(this.snapshot.selection.disputeId);
      // After upsert ACK: typed GET reestablishes rights/version; GET failure is retryable READ, not write success.
      if (noteWrite && packet.kind === 'note-upsert') void this.loadNote(packet.gameId, packet.contextId);
      if (packet.kind === 'peer-create') void this.loadReviews('sent');
      if (packet.kind === 'peer-reply' || packet.kind === 'peer-report') void this.loadReviews('received');
    } catch(error) {
      if(!valid()) return;
      const definite=!reconciling && error instanceof PostgameError && error.status < 500 && error.kind === 'business' && !['COMMAND_IN_PROGRESS','KEY_REUSED','IDEMPOTENCY_KEY_REUSED'].includes(error.code);
      const noteConflict = definite && packet.kind.startsWith('note-') && error instanceof PostgameError && error.code === 'VERSION_CONFLICT';
      const peerConflict = definite && (packet.kind === 'peer-reply' || packet.kind === 'peer-report')
        && error instanceof PostgameError && error.code === 'VERSION_CONFLICT';
      const noteUnknown = !definite && (packet.kind === 'note-upsert' || packet.kind === 'note-delete');
      const peerUnknown = !definite && (packet.kind === 'peer-create' || packet.kind === 'peer-reply' || packet.kind === 'peer-report');
      if (peerConflict && packet.kind === 'peer-report') {
        // Preserve detail draft; reset consent after revision change.
        const drafts = { ...this.snapshot.feedbackDrafts };
        const prior = drafts[packet.gameId] ?? {};
        drafts[packet.gameId] = { ...prior, reportConsent: false, reportConsentVersion: undefined };
        this.show({ feedbackDrafts: drafts });
        void this.loadReviews('received');
      }
      if (peerConflict && packet.kind === 'peer-reply') {
        void this.loadReviews('received');
        void this.loadResults(packet.gameId);
      }
      const notice = definite
        ? (noteConflict
          ? 'Версия заметки изменилась. Обновите заметку и сохраните снова.'
          : peerConflict
            ? (packet.kind === 'peer-report'
              ? 'Версия отзыва изменилась. Проверьте новую редакцию и снова подтвердите согласие.'
              : 'Версия ответа изменилась. Обновите отзыв и сохраните снова.')
            : 'Изменение отклонено. Обновите данные и проверьте условия.')
        : (noteUnknown
          ? (packet.kind === 'note-delete'
            ? 'Пока не удалось подтвердить удаление. Проверьте исходное действие.'
            : 'Пока не удалось подтвердить сохранение. Проверьте исходное действие.')
          : peerUnknown
            ? 'Результат отправки пока неизвестен. Проверьте исходное действие.'
            : unknownNotice);
      // Dirty note/feedback drafts retained on conflict/UNKNOWN; competing writes stay blocked while UNKNOWN.
      this.show({command:definite ? null : {packet,status:'unknown'},notice});
    } finally { if(this.inFlight === packet) this.inFlight=null; }
  }
}
