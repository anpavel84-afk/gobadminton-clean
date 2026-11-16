import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import { CommunityError, id, freezePacket, parseSummaries, parseOwn, parsePage, parseReceipt, notice, invalid } from './venue-community.ts';
import type { Action, Comment, CommunityOwnVoteResponse, CommunityRatingSummary, Packet, Page, Query, Scope } from './venue-community.ts';
type Phase = 'idle' | 'loading' | 'ready' | 'error';
export type Thread = { phase: Phase; pages: { query: Query; page: Page }[]; error: string | null };
export type ActionContext = Readonly<{ venue: string; action: string; target: string; text?: string; consequence?: string; rating?: number; reason?: string; detail?: string }>;
export type Operation = { packet: Packet; context: ActionContext; status: 'review' | 'pending' | 'unknown' | 'confirmed' | 'refused'; notice: string | null };
export type CommunitySnapshot = {
  actor: Actor | null; venueId: string | null; scope: Scope | null; summary: CommunityRatingSummary | null; summaryPhase: Phase;
  own: CommunityOwnVoteResponse | null; ownPhase: Phase; order: 'asc' | 'desc'; roots: Thread; replies: Record<string, Thread>;
  drafts: Record<string, string>; editNotice: string | null; selected: number | null; operations: Operation[];
};
export type CommunityPorts = {
  summary: (venueId: string) => Promise<unknown>;
  guestComments: (q: Query) => Promise<unknown>;
  own: (venueId: string, actor: Actor) => Promise<unknown>;
  comments: (q: Query, actor: Actor) => Promise<unknown>;
  send: (p: Packet, permit: () => boolean) => Promise<unknown>;
  random: () => string;
};
const thread = (): Thread => ({ phase: 'idle', pages: [], error: null });
/** Stable root owner: no credentials, automatic mutation retries, or UI-lifetime packets. */
export class VenueCommunityCoordinator {
  private state: CommunitySnapshot = { actor: null, venueId: null, scope: null, summary: null, summaryPhase: 'idle', own: null, ownPhase: 'idle',
    order: 'asc', roots: thread(), replies: {}, drafts: {}, editNotice: null, selected: null, operations: [] };
  private listeners = new Set<() => void>();
  private history = new Map<string, Operation>();
  private edits = new Map<string, { actor: Actor; scope: Scope; revision: string }>();
  private epoch = 0;
  private reads = new Map<string, number>();
  private serial = 0;
  private ports: CommunityPorts;
  constructor(ports: CommunityPorts) { this.ports = ports; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<CommunitySnapshot> = {}) {
    const { actor, venueId } = { ...this.state, ...patch };
    const operations = [...this.history.values()].filter(o => o.packet.scope.venueId === venueId && sameActor(o.packet.actor, actor));
    this.state = { ...this.state, ...patch, operations }; this.listeners.forEach(fn => fn());
  }
  /** Logout / actor / session / generation change retires private frozen text permanently. Venue navigation keeps same-actor history. */
  private retireAuthority(actor: Actor | null) {
    for (const [key, operation] of this.history) {
      if (!sameActor(operation.packet.actor, actor)) this.history.delete(key);
    }
  }
  private reset(actor: Actor | null, venueId: string | null) {
    this.epoch++; this.reads.clear(); this.edits.clear();
    this.retireAuthority(actor);
    this.show({ editNotice: null, actor, venueId, scope: null, summary: null, summaryPhase: 'idle', own: null, ownPhase: 'idle', roots: thread(), replies: {}, drafts: {}, selected: null });
  }
  setActor = (actor: Actor | null) => {
    if ((!actor && !this.state.actor) || sameActor(this.state.actor, actor)) return;
    this.reset(actor ? Object.freeze({...actor}) : null, this.state.venueId);
    if (this.state.venueId && actor) void this.refresh();
  };
  open = (venueId: string) => {
    id(venueId);
    if (this.state.venueId !== venueId) this.reset(this.state.actor, venueId);
    void this.refresh();
  };
  /** Collapse unmounts all private UI; drafts/immutable history stay with this root. */
  detach = () => { this.epoch++; this.reads.clear(); };
  private ticket(key: string) {
    const serial = ++this.serial, epoch = this.epoch; this.reads.set(key, serial);
    return () => epoch === this.epoch && this.reads.get(key) === serial;
  }
  private clearPermissions() {
    this.epoch++; this.reads.clear(); this.edits.clear();
    this.show({ scope: null, editNotice: 'Редактирование недоступно. Несовместимые черновики удалены.', own: null, ownPhase: 'error', roots: {phase:'error',pages:[],error:'Публикация или площадка недоступна.'}, replies: {}, drafts: {}, selected: null });
  }
  refresh = async () => {
    const venueId = this.state.venueId; if (!venueId) return;
    const matches = this.ticket('summary'); this.show({ summaryPhase: 'loading' });
    try {
      const summary = parseSummaries(await this.ports.summary(venueId), venueId); if (!matches()) return;
      const oldScope = this.state.scope;
      const scope = summary.canonicalVenueId ? Object.freeze({ venueId, canonicalVenueId: summary.canonicalVenueId }) : null;
      if (oldScope && scope?.canonicalVenueId !== oldScope.canonicalVenueId) this.clearPermissions();
      this.show({ summary, summaryPhase: 'ready', scope });
      if (!scope || summary.state === 'unavailable') { this.clearPermissions(); return; }
      await Promise.all([this.loadOwn(), this.reloadThreads()]);
    } catch { if (matches()) { this.show({ summaryPhase: 'error' }); } }
  };
  loadOwn = async () => {
    const { venueId, actor, scope } = this.state; if (!venueId || !actor || !scope) return;
    const matches = this.ticket('own'); this.show({ ownPhase: 'loading' });
    try {
      const own = parseOwn(await this.ports.own(venueId, actor), venueId);
      if (own.summary.canonicalVenueId !== scope.canonicalVenueId) return invalid();
      if (matches()) this.show({ own, ownPhase: 'ready', selected: this.state.selected ?? (own.own?.withdrawn ? null : own.own?.value ?? null) });
    } catch { if (matches()) this.show({ own: null, ownPhase: 'error', selected: null }); }
  };
  private async reloadThreads() {
    const replies = Object.keys(this.state.replies);
    await Promise.all([this.loadThread(null, false, true), ...replies.map(p => this.loadThread(p, false, true))]);
  }
  private getThread(parent: string | null) { return parent ? this.state.replies[parent] ?? thread() : this.state.roots; }
  private setThread(parent: string | null, value: Thread) {
    this.show(parent ? { replies: { ...this.state.replies, [parent]: value } } : { roots: value });
  }
  loadThread = async (parent: string | null, more = false, reload = false) => {
    const { venueId, actor, scope, order } = this.state; if (!venueId || !scope) return;
    if (parent && !this.rows().some(c => c.id === parent && c.parentCommentId === null)) return;
    const current = this.getThread(parent);
    if (more && (current.phase === 'loading' || !current.pages.at(-1)?.page.nextCursor)) return;
    const matches = this.ticket(`thread:${parent ?? 'root'}`);
    const next = more ? current.pages.at(-1)!.page.nextCursor : null;
    const queries: Query[] = reload && current.pages.length ? current.pages.map(p => p.query) : [{ venueId, parentCommentId: parent, order, cursor: next }];
    this.setThread(parent, { ...current, phase: 'loading', error: null });
    try {
      const loaded: Thread['pages'] = [];
      for (const query of queries) {
        const raw = actor ? await this.ports.comments(query, actor) : await this.ports.guestComments(query);
        if (!matches()) return;
        const page = parsePage(raw, scope, query);
        if (!actor && (page.canCreate || page.items.some(c => c.mine))) return invalid();
        if (reload) {
          const seen = new Set(loaded.flatMap(p => p.page.items.map(c => c.id)));
          page.items = page.items.filter(c => !seen.has(c.id));
        }
        loaded.push({query, page});
      }
      if (!matches()) return;
      const pages = more ? [...current.pages, ...loaded] : loaded;
      const items = pages.flatMap(p => p.page.items);
      if (new Set(items.map(c => c.id)).size !== items.length) return invalid();
      this.setThread(parent, { phase: 'ready', pages, error: null });
      if (!parent) {
        this.retireEdits();
        if (!pages[0]?.page.canCreate) this.show({ drafts: {}, selected: this.state.selected });
      }
    } catch (error) {
      if (!matches()) return;
      if (error instanceof CommunityError && error.kind === 'private') { this.clearPermissions(); return; }
      this.setThread(parent, { ...current, phase: 'error', error: 'Не удалось загрузить комментарии' });
    }
  };
  setOrder = (order: 'asc' | 'desc') => {
    if (!['asc','desc'].includes(order) || order === this.state.order || this.busy()) return;
    this.epoch++; this.show({order, roots: thread(), replies: {}}); void this.loadThread(null);
  };
  rows = (): Comment[] => [...this.state.roots.pages.flatMap(p => p.page.items), ...Object.values(this.state.replies).flatMap(t => t.pages.flatMap(p => p.page.items))];
  private editRevision(c: Comment) {
    return JSON.stringify([c.entityId, c.version, c.updatedAt, c.body, c.photos, c.mine, c.deleted, c.parentCommentId]);
  }
  private editable(commentId: string) {
    return this.state.actor && this.state.scope && this.state.roots.phase === 'ready' && this.state.roots.pages[0]?.page.canCreate
      ? this.rows().find(c => c.id === commentId && c.mine && !c.deleted && c.parentCommentId === null && c.body !== null) : undefined;
  }
  private compatibleEdit(commentId: string) {
    const saved = this.edits.get(commentId), c = this.editable(commentId);
    return !!(saved && c && sameActor(saved.actor, this.state.actor) && saved.scope.venueId === this.state.venueId
      && saved.scope.canonicalVenueId === this.state.scope?.canonicalVenueId && saved.revision === this.editRevision(c));
  }
  private retireEdits() {
    if (this.state.roots.phase !== 'ready') return;
    const drafts = {...this.state.drafts}; let retired = false;
    for (const [commentId, saved] of this.edits) {
      const current = this.rows().find(c => c.id === commentId);
      // An omitted page is not a new revision or proof that a publication became private.
      // Retain the draft, but compatibleEdit still requires a currently authorized row to resume it.
      const revoked = !sameActor(saved.actor, this.state.actor) || saved.scope.venueId !== this.state.venueId
        || saved.scope.canonicalVenueId !== this.state.scope?.canonicalVenueId || !this.state.roots.pages[0]?.page.canCreate
        || current && !this.compatibleEdit(commentId);
      if (revoked) { this.edits.delete(commentId); delete drafts[`edit:${commentId}`]; retired = true; }
    }
    if (retired) this.show({drafts, editNotice:'Комментарий или права изменились. Несовместимый черновик удалён; проверьте текущую публикацию.'});
  }
  beginEdit = (commentId: string): boolean => {
    if (this.busy() || !this.editable(commentId)) return false;
    this.retireEdits();
    const c = this.editable(commentId), {actor, scope} = this.state;
    if (!c || !actor || !scope) return false;
    if (!this.compatibleEdit(commentId)) {
      this.edits.set(commentId, {actor, scope, revision:this.editRevision(c)});
      this.show({drafts:{...this.state.drafts,[`edit:${commentId}`]:c.body!}});
    }
    return true;
  };
  setDraft = (key: string, value: string) => {
    if (!this.state.actor || this.busy()) return;
    if (key.startsWith('edit:') && !this.compatibleEdit(key.slice(5))) { this.retireEdits(); return; }
    this.show({drafts:{...this.state.drafts,[key]:value}});
  };
  select = (value: number) => { if (this.canRate() && !this.busy() && Number.isInteger(value) && value >= 1 && value <= 5) this.show({selected:value}); };
  busy = () => this.state.operations.some(o => ['review','pending','unknown'].includes(o.status));
  canRate = () => {
    const s = this.state, own = s.own?.own;
    return !!(s.actor && s.ownPhase === 'ready' && s.own && s.summary?.state !== 'unavailable'
      && (own && (own.withdrawn || own.version === 0 ? own.allowedActions.upsert : own.allowedActions.update)));
  };
  private authorized(action: Action, reviewing = false): boolean {
    const s = this.state, own = s.own?.own;
    if (!s.actor || !s.scope || !reviewing && this.busy()) return false;
    if (action.kind === 'upsert') return this.canRate() && action.expectedVersion === (own?.version ?? 0) && (!!own?.withdrawn || action.value !== own?.value);
    if (action.kind === 'withdraw') return !!(s.ownPhase === 'ready' && own?.allowedActions.withdraw && !own.withdrawn && own.version === action.expectedVersion);
    if (action.kind === 'create') return !!((!action.parentCommentId || this.getThread(action.parentCommentId).phase === 'ready' && this.getThread(action.parentCommentId).pages[0]?.page.canCreate) && s.roots.phase === 'ready' && s.roots.pages[0]?.page.canCreate && (action.parentCommentId === null
      ? action.parentEntityId === s.scope.canonicalVenueId
      : this.rows().some(c => c.id === action.parentCommentId && !c.parentCommentId && !c.deleted && c.entityId === action.parentEntityId)));
    if (action.kind === 'edit' || action.kind === 'delete') return !!(s.roots.phase === 'ready' && s.roots.pages[0]?.page.canCreate && this.rows().some(c => c.id === action.comment.id && c.version === action.comment.version && c.mine && !c.deleted && !c.parentCommentId && JSON.stringify(c) === JSON.stringify(action.comment)));
    const r = action.report;
    return r.venueId === s.venueId && (r.subjectKind === 'aggregate' ? s.summaryPhase === 'ready' && s.summary?.state !== 'unavailable'
      : r.subjectKind === 'own_vote' ? s.ownPhase === 'ready' && !!own && own.version === r.expectedVersion && !own.withdrawn
      : this.rows().some(c => c.id === r.commentId && !c.deleted && c.version === r.expectedVersion));
  }
  private context(p: Packet): ActionContext {
    const a = p.action;
    const c = a.kind === 'edit' || a.kind === 'delete' ? a.comment
      : a.kind === 'create' && a.parentCommentId ? this.rows().find(c => c.id === a.parentCommentId)
      : a.kind === 'report' && a.report.subjectKind === 'venue_comment' ? this.rows().find(c => c.id === a.report.commentId) : null;
    const target = c ? `Комментарий · ${c.author?.profilePublic ? c.author.displayName : 'Игрок'}` : 'Площадка';
    const base = {venue:'Площадка', target};
    if (a.kind === 'edit' || a.kind === 'create') return Object.freeze({...base, action:a.kind === 'edit' ? 'Изменение комментария' : a.parentCommentId ? 'Ответ на комментарий' : 'Новый комментарий', text:String(p.body.text)});
    if (a.kind === 'delete') return Object.freeze({...base, action:'Удаление комментария', consequence:'Текст комментария будет скрыт. Ответы в ветке сохранятся.'});
    if (a.kind === 'upsert') return Object.freeze({...base, action:'Оценка площадки', rating:a.value});
    if (a.kind === 'withdraw') return Object.freeze({...base, action:'Отмена оценки', consequence:'Ваша оценка больше не будет учитываться в сводке.'});
    const labels = {harassment:'Оскорбления / давление', spam:'Спам', fake_profile:'Поддельный профиль', inappropriate:'Неприемлемый контент', other:'Другое'};
    return Object.freeze({...base, action:'Жалоба', target:a.report.subjectKind === 'aggregate' ? 'Сводка оценок' : a.report.subjectKind === 'own_vote' ? 'Моя оценка' : target,
      reason:labels[a.report.reasonCode], detail:typeof p.body.detail === 'string' ? p.body.detail : undefined});
  }
  unresolved = (): Operation[] => this.state.operations.filter(o => o.status === 'unknown' || o.status === 'pending');
  private permitted(p: Packet) {
    const s = this.state;
    return sameActor(s.actor, p.actor) && s.venueId === p.scope.venueId && s.scope?.canonicalVenueId === p.scope.canonicalVenueId
      && s.summaryPhase === 'ready' && s.summary?.state !== 'unavailable'
      && (!['create','edit','delete'].includes(p.action.kind) || s.roots.phase === 'ready' && !!s.roots.pages[0]?.page.canCreate);
  }
  canReconcile = (key: string) => { const o = this.history.get(key); return !!(o?.status === 'unknown' && this.permitted(o.packet)); };
  review = (action: Action): Packet | null => {
    if (!this.authorized(action) || !this.state.actor || !this.state.scope) return null;
    try {
      const packet = freezePacket(this.state.actor, this.state.scope, action, this.ports.random());
      this.history.set(packet.key, {packet, context:this.context(packet), status:'review', notice:null}); this.show(); return packet;
    } catch { return null; }
  };
  cancelReviews = () => {
    for (const [key, operation] of this.history) if (operation.status === 'review') this.history.delete(key);
    this.show();
  };
  cancelReview = (key: string) => { if (this.history.get(key)?.status === 'review') { this.history.delete(key); this.show(); } };
  commit = async (key: string) => {
    const operation = this.history.get(key); if (!operation || operation.status !== 'review') return;
    if (!this.authorized(operation.packet.action as Action, true)) { this.cancelReview(key); return; }
    await this.dispatch(operation);
  };
  reconcile = async (key: string) => {
    const operation = this.history.get(key); if (!operation || operation.status !== 'unknown') return;
    await this.dispatch(operation);
  };
  private async dispatch(operation: Operation) {
    const p = operation.packet;
    const permit = () => this.permitted(p);
    if (!permit()) return;
    this.epoch++; this.reads.clear();
    const pending: Operation = {...operation, status:'pending', notice:'Отправляем…'};
    this.history.set(p.key, pending); this.show();
    try {
      const raw = await this.ports.send(p, permit);
      // Authority retirement deletes the history entry; late ACK must not reinsert private context or refresh.
      if (this.history.get(p.key)?.packet !== p || !sameActor(this.state.actor, p.actor)) return;
      parseReceipt(raw, p);
      if (this.history.get(p.key)?.packet !== p || !sameActor(this.state.actor, p.actor)) return;
      this.history.set(p.key, {...operation, status:'confirmed', notice:p.action.kind === 'report'
        ? 'Жалоба принята к рассмотрению. Оценка и публикация не меняются автоматически.' : 'Действие подтверждено.'});
      if (!permit()) return;
      const drafts = {...this.state.drafts};
      const draftKey = p.action.kind === 'create' ? p.action.parentCommentId ?? 'root' : p.action.kind === 'edit' ? `edit:${p.action.comment.id}` : null;
      if (draftKey) delete drafts[draftKey];
      if (p.action.kind === 'edit') this.edits.delete(p.action.comment.id);
      // Receipt is historical. Fresh reads establish current permissions and moderation.
      this.show({drafts, selected:null, own:null, ownPhase:'idle'}); await this.refresh();
    } catch (error) {
      if (this.history.get(p.key)?.packet !== p || !sameActor(this.state.actor, p.actor)) return;
      const refused = error instanceof CommunityError && ['refused','private'].includes(error.kind);
      this.history.set(p.key, {...operation, status:refused ? 'refused' : 'unknown', notice:refused ? notice(error) : 'Результат неизвестен. Сохранено исходное действие; автоматического повтора нет.'});
      if (permit()) { if (error instanceof CommunityError && error.kind === 'private') this.clearPermissions(); this.show(); }
    } finally { if (sameActor(this.state.actor, p.actor) && this.state.venueId === p.scope.venueId && this.history.has(p.key)) this.show(); }
  }
}
