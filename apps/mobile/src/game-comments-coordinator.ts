import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import {
  CommunityError, freezeGameCommentPacket, gameCommentNotice, id, invalid,
  parseGameCommentPage, parseGameCommentReceipt,
} from './game-comments.ts';
import type {
  GameComment, GameCommentAction, GameCommentPacket, GameCommentPage, GameCommentQuery, GameCommentScope,
} from './game-comments.ts';

type Phase = 'idle' | 'loading' | 'ready' | 'error';
export type GameCommentThread = { phase: Phase; pages: { query: GameCommentQuery; page: GameCommentPage }[]; error: string | null };
export type GameCommentActionContext = Readonly<{
  game: string; action: string; target: string; text?: string; consequence?: string;
}>;
export type GameCommentOperation = {
  packet: GameCommentPacket; context: GameCommentActionContext;
  status: 'review' | 'pending' | 'unknown' | 'confirmed' | 'refused'; notice: string | null;
};
export type GameCommentsSnapshot = {
  actor: Actor | null; gameId: string | null; scope: GameCommentScope | null; order: 'asc' | 'desc';
  roots: GameCommentThread; replies: Record<string, GameCommentThread>;
  drafts: Record<string, string>; editNotice: string | null; operations: GameCommentOperation[];
  /** Live route focus — Expo Stack keeps prior screens mounted. */
  focused: boolean;
  /** App foreground — background does not unmount. */
  foreground: boolean;
};
export type GameCommentPorts = {
  guestComments: (q: GameCommentQuery) => Promise<unknown>;
  comments: (q: GameCommentQuery, actor: Actor) => Promise<unknown>;
  send: (p: GameCommentPacket, permit: () => boolean) => Promise<unknown>;
  random: () => string;
};

const thread = (): GameCommentThread => ({ phase: 'idle', pages: [], error: null });

/** Stable root owner: no credentials, automatic mutation retries, or UI-lifetime packets. */
export class GameCommentsCoordinator {
  private state: GameCommentsSnapshot = {
    actor: null, gameId: null, scope: null, order: 'asc',
    roots: thread(), replies: {}, drafts: {}, editNotice: null, operations: [],
    focused: false, foreground: true,
  };
  private listeners = new Set<() => void>();
  private history = new Map<string, GameCommentOperation>();
  private edits = new Map<string, { actor: Actor; scope: GameCommentScope; revision: string }>();
  private epoch = 0;
  private reads = new Map<string, number>();
  private serial = 0;
  /** Bumps on every focus/blur so release only retires its own lease. */
  private viewGen = 0;
  /** Bumps on every foreground transition — invalidates captured dispatch permits. */
  private foregroundGen = 0;
  /**
   * Source-authority revision — independent of read epoch (dispatch bumps epoch only).
   * Irreversibly advanced by safety/disarm/full source refresh/authority retirement.
   */
  private authorityGen = 0;
  private ports: GameCommentPorts;
  constructor(ports: GameCommentPorts) { this.ports = ports; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<GameCommentsSnapshot> = {}) {
    const { actor, gameId } = { ...this.state, ...patch };
    const operations = [...this.history.values()].filter(o =>
      o.packet.scope.gameId === gameId && sameActor(o.packet.actor, actor));
    this.state = { ...this.state, ...patch, operations };
    this.listeners.forEach(fn => fn());
  }
  private retireAuthority(actor: Actor | null) {
    for (const [key, operation] of this.history) {
      if (!sameActor(operation.packet.actor, actor)) this.history.delete(key);
    }
  }
  private reset(actor: Actor | null, gameId: string | null) {
    this.epoch++; this.reads.clear(); this.edits.clear();
    this.authorityGen++;
    this.retireAuthority(actor);
    this.show({
      editNotice: null, actor, gameId,
      scope: gameId ? Object.freeze({ gameId }) : null,
      roots: thread(), replies: {}, drafts: {},
    });
  }
  /** Strip cached canCreate so stale ready pages cannot authorize during refresh. */
  private disarmAuthority(phase: Phase = 'loading') {
    const disarm = (t: GameCommentThread): GameCommentThread => ({
      phase: t.pages.length || phase === 'loading' ? phase : t.phase,
      error: null,
      pages: t.pages.map(p => ({ query: p.query, page: { ...p.page, canCreate: false } })),
    });
    const replies = Object.fromEntries(
      Object.entries(this.state.replies).map(([k, v]) => [k, disarm(v)]),
    );
    this.epoch++; this.reads.clear(); this.edits.clear();
    this.authorityGen++;
    this.show({ roots: disarm(this.state.roots), replies, editNotice: null });
  }
  private liveView() {
    return this.state.focused && this.state.foreground;
  }
  setActor = (actor: Actor | null) => {
    if ((!actor && !this.state.actor) || sameActor(this.state.actor, actor)) return;
    this.reset(actor ? Object.freeze({ ...actor }) : null, this.state.gameId);
    if (this.state.gameId && actor && this.liveView()) void this.refresh();
  };
  /**
   * Bind current game discussion view. Returns release that retires only this viewGen.
   * UNKNOWN packets stay; reviews and in-flight read tickets are cancelled.
   */
  attach = (gameId: string): (() => void) => {
    id(gameId);
    if (this.state.gameId !== gameId) this.reset(this.state.actor, gameId);
    const lease = ++this.viewGen;
    this.show({ focused: true, scope: Object.freeze({ gameId }) });
    this.disarmAuthority('loading');
    void this.refresh();
    return () => {
      if (this.viewGen !== lease) return;
      this.blur();
    };
  };
  /** Take the current-game view lease (same as attach without retaining the release). */
  open = (gameId: string) => { this.attach(gameId); };
  blur = () => {
    this.viewGen++;
    this.cancelReviews();
    const phase = this.state.roots.phase === 'ready' ? 'loading' : this.state.roots.phase;
    this.disarmAuthority(phase);
    this.show({ focused: false });
  };
  detach = () => { this.blur(); };
  /**
   * App foreground fence. Background invalidates dispatch permits and review callbacks;
   * return requires a fresh current-authority read before any new command/reconcile.
   */
  setForeground = (active: boolean) => {
    if (active === this.state.foreground) return;
    this.foregroundGen++;
    this.cancelReviews();
    if (!active) {
      const phase = this.state.roots.phase === 'ready' ? 'loading' : this.state.roots.phase;
      this.disarmAuthority(phase);
      this.show({ foreground: false });
      return;
    }
    this.show({ foreground: true });
    if (this.state.focused && this.state.gameId) {
      this.disarmAuthority('loading');
      void this.refresh();
    }
  };
  viewLifecycle = () => this.viewGen;
  foregroundLifecycle = () => this.foregroundGen;
  authorityLifecycle = () => this.authorityGen;
  /**
   * After a verified same-actor block/unblock acknowledgement: clear cached publication and
   * permissions immediately (even if the game view is inactive), then refresh only while
   * focused+foreground. Does not touch UNKNOWN packets or owned drafts.
   * Safety-specific clearing — ordinary blur/foreground disarm may keep honest cached rows.
   */
  invalidateAfterSafety = () => {
    if (!this.state.actor || !this.state.gameId) return;
    this.cancelReviews();
    this.epoch++; this.reads.clear(); this.edits.clear();
    this.authorityGen++;
    this.show({
      roots: { phase: 'loading', pages: [], error: null },
      replies: {},
      editNotice: null,
    });
    if (this.liveView()) void this.refresh();
  };
  private ticket(key: string) {
    const serial = ++this.serial, epoch = this.epoch;
    this.reads.set(key, serial);
    return () => epoch === this.epoch && this.reads.get(key) === serial && this.liveView();
  }
  private clearPermissions() {
    this.epoch++; this.reads.clear(); this.edits.clear();
    this.authorityGen++;
    this.show({
      scope: null,
      editNotice: 'Редактирование недоступно. Несовместимые черновики удалены.',
      roots: { phase: 'error', pages: [], error: 'Публикация или игра недоступна.' },
      replies: {}, drafts: {},
    });
  }
  refresh = async () => {
    const gameId = this.state.gameId; if (!gameId || !this.liveView()) return;
    // Full source refresh retires captured dispatch permits before new authority is read.
    this.authorityGen++;
    const scope = Object.freeze({ gameId });
    this.show({ scope });
    await this.reloadThreads();
  };
  private async reloadThreads() {
    const replies = Object.keys(this.state.replies);
    await Promise.all([this.loadThread(null, false, true), ...replies.map(p => this.loadThread(p, false, true))]);
  }
  private getThread(parent: string | null) {
    return parent ? this.state.replies[parent] ?? thread() : this.state.roots;
  }
  private setThread(parent: string | null, value: GameCommentThread) {
    this.show(parent ? { replies: { ...this.state.replies, [parent]: value } } : { roots: value });
  }
  /** Accepted web: root order is user-selected; reply pages ALWAYS request/validate asc. */
  private threadOrder(parent: string | null): 'asc' | 'desc' {
    return parent ? 'asc' : this.state.order;
  }
  loadThread = async (parent: string | null, more = false, reload = false) => {
    const { gameId, actor, scope } = this.state; if (!gameId || !scope || !this.liveView()) return;
    if (parent && !this.rows().some(c => c.id === parent && c.parentCommentId === null)) return;
    const current = this.getThread(parent);
    if (more && (current.phase === 'loading' || !current.pages.at(-1)?.page.nextCursor)) return;
    const matches = this.ticket(`thread:${parent ?? 'root'}`);
    const next = more ? current.pages.at(-1)!.page.nextCursor : null;
    const order = this.threadOrder(parent);
    const queries: GameCommentQuery[] = reload && current.pages.length
      ? current.pages.map(p => ({ ...p.query, order }))
      : [{ gameId, parentCommentId: parent, order, cursor: next }];
    this.setThread(parent, { ...current, phase: 'loading', error: null });
    try {
      const loaded: GameCommentThread['pages'] = [];
      for (const query of queries) {
        const raw = actor ? await this.ports.comments(query, actor) : await this.ports.guestComments(query);
        if (!matches()) return;
        const page = parseGameCommentPage(raw, scope, query);
        if (!actor && (page.canCreate || page.items.some(c => c.mine))) return invalid();
        if (reload) {
          const seen = new Set(loaded.flatMap(p => p.page.items.map(c => c.id)));
          page.items = page.items.filter(c => !seen.has(c.id));
        }
        loaded.push({ query, page });
      }
      if (!matches()) return;
      const pages = more ? [...current.pages, ...loaded] : loaded;
      const items = pages.flatMap(p => p.page.items);
      if (new Set(items.map(c => c.id)).size !== items.length) return invalid();
      this.setThread(parent, { phase: 'ready', pages, error: null });
      if (!parent) {
        this.retireEdits();
        if (!pages[0]?.page.canCreate) this.show({ drafts: {} });
      }
    } catch (error) {
      if (!matches()) return;
      if (error instanceof CommunityError && error.kind === 'private') { this.clearPermissions(); return; }
      this.setThread(parent, { ...current, phase: 'error', error: 'Не удалось загрузить комментарии' });
    }
  };
  setOrder = (order: 'asc' | 'desc') => {
    if (!['asc', 'desc'].includes(order) || order === this.state.order || this.busy() || !this.liveView()) return;
    this.epoch++; this.show({ order, roots: thread(), replies: {} }); void this.loadThread(null);
  };
  rows = (): GameComment[] => [
    ...this.state.roots.pages.flatMap(p => p.page.items),
    ...Object.values(this.state.replies).flatMap(t => t.pages.flatMap(p => p.page.items)),
  ];
  private editRevision(c: GameComment) {
    return JSON.stringify([c.entityId, c.version, c.updatedAt, c.body, c.mine, c.deleted, c.parentCommentId]);
  }
  private editable(commentId: string) {
    return this.state.actor && this.state.scope && this.liveView()
      && this.state.roots.phase === 'ready' && this.state.roots.pages[0]?.page.canCreate
      ? this.rows().find(c => c.id === commentId && c.mine && !c.deleted && c.parentCommentId === null && c.body !== null)
      : undefined;
  }
  private compatibleEdit(commentId: string) {
    const saved = this.edits.get(commentId), c = this.editable(commentId);
    return !!(saved && c && sameActor(saved.actor, this.state.actor) && saved.scope.gameId === this.state.gameId
      && saved.scope.gameId === this.state.scope?.gameId && saved.revision === this.editRevision(c));
  }
  private retireEdits() {
    if (this.state.roots.phase !== 'ready') return;
    const drafts = { ...this.state.drafts }; let retired = false;
    for (const [commentId, saved] of this.edits) {
      const current = this.rows().find(c => c.id === commentId);
      const revoked = !sameActor(saved.actor, this.state.actor) || saved.scope.gameId !== this.state.gameId
        || saved.scope.gameId !== this.state.scope?.gameId || !this.state.roots.pages[0]?.page.canCreate
        || current && !this.compatibleEdit(commentId);
      if (revoked) { this.edits.delete(commentId); delete drafts[`edit:${commentId}`]; retired = true; }
    }
    if (retired) {
      this.show({
        drafts,
        editNotice: 'Комментарий или права изменились. Несовместимый черновик удалён; проверьте текущую публикацию.',
      });
    }
  }
  beginEdit = (commentId: string): boolean => {
    if (this.busy() || !this.editable(commentId)) return false;
    this.retireEdits();
    const c = this.editable(commentId), { actor, scope } = this.state;
    if (!c || !actor || !scope) return false;
    if (!this.compatibleEdit(commentId)) {
      this.edits.set(commentId, { actor, scope, revision: this.editRevision(c) });
      this.show({ drafts: { ...this.state.drafts, [`edit:${commentId}`]: c.body! } });
    }
    return true;
  };
  setDraft = (key: string, value: string) => {
    if (!this.state.actor || this.busy() || !this.liveView()) return;
    if (key.startsWith('edit:') && !this.compatibleEdit(key.slice(5))) { this.retireEdits(); return; }
    this.show({ drafts: { ...this.state.drafts, [key]: value } });
  };
  busy = () => this.state.operations.some(o => ['review', 'pending', 'unknown'].includes(o.status));
  private authorized(action: GameCommentAction, reviewing = false): boolean {
    const s = this.state;
    if (!this.liveView() || !s.actor || !s.scope || !reviewing && this.busy()) return false;
    const scope = s.scope;
    if (action.kind === 'create') {
      return !!((!action.parentCommentId
        || this.getThread(action.parentCommentId).phase === 'ready'
          && this.getThread(action.parentCommentId).pages[0]?.page.canCreate)
        && s.roots.phase === 'ready' && s.roots.pages[0]?.page.canCreate
        && (action.parentCommentId === null
          || this.rows().some(c => c.id === action.parentCommentId && !c.parentCommentId && !c.deleted
            && c.entityId === scope.gameId)));
    }
    return !!(s.roots.phase === 'ready' && s.roots.pages[0]?.page.canCreate
      && this.rows().some(c => c.id === action.comment.id && c.version === action.comment.version
        && c.mine && !c.deleted && !c.parentCommentId && JSON.stringify(c) === JSON.stringify(action.comment)));
  }
  private context(p: GameCommentPacket): GameCommentActionContext {
    const a = p.action;
    const c = a.kind === 'edit' || a.kind === 'delete' ? a.comment
      : a.kind === 'create' && a.parentCommentId ? this.rows().find(row => row.id === a.parentCommentId) : null;
    const target = c ? `Комментарий · ${c.author?.profilePublic ? c.author.displayName : 'Игрок'}` : 'Игра';
    const base = { game: 'Игра', target };
    if (a.kind === 'edit' || a.kind === 'create') {
      return Object.freeze({
        ...base,
        action: a.kind === 'edit' ? 'Изменение комментария' : a.parentCommentId ? 'Ответ на комментарий' : 'Новый комментарий',
        text: String(p.body.text),
      });
    }
    return Object.freeze({
      ...base, action: 'Удаление комментария',
      consequence: 'Текст комментария будет скрыт. Ответы в ветке сохранятся.',
    });
  }
  unresolved = (): GameCommentOperation[] => this.state.operations.filter(o => o.status === 'unknown' || o.status === 'pending');
  private permitted(p: GameCommentPacket) {
    const s = this.state;
    return this.liveView() && sameActor(s.actor, p.actor) && s.gameId === p.scope.gameId && s.scope?.gameId === p.scope.gameId
      && s.roots.phase === 'ready' && !!s.roots.pages[0]?.page.canCreate;
  }
  canReconcile = (key: string) => {
    const o = this.history.get(key);
    return !!(o?.status === 'unknown' && this.permitted(o.packet));
  };
  review = (action: GameCommentAction): GameCommentPacket | null => {
    if (!this.authorized(action) || !this.state.actor || !this.state.scope) return null;
    try {
      const packet = freezeGameCommentPacket(this.state.actor, this.state.scope, action, this.ports.random());
      this.history.set(packet.key, { packet, context: this.context(packet), status: 'review', notice: null });
      this.show();
      return packet;
    } catch { return null; }
  };
  cancelReviews = () => {
    for (const [key, operation] of this.history) if (operation.status === 'review') this.history.delete(key);
    this.show();
  };
  cancelReview = (key: string) => {
    if (this.history.get(key)?.status === 'review') { this.history.delete(key); this.show(); }
  };
  commit = async (key: string) => {
    const operation = this.history.get(key); if (!operation || operation.status !== 'review') return;
    if (!this.authorized(operation.packet.action as GameCommentAction, true)) { this.cancelReview(key); return; }
    await this.dispatch(operation);
  };
  reconcile = async (key: string) => {
    const operation = this.history.get(key); if (!operation || operation.status !== 'unknown') return;
    await this.dispatch(operation);
  };
  private async dispatch(operation: GameCommentOperation) {
    const p = operation.packet;
    const capturedView = this.viewGen;
    const capturedForeground = this.foregroundGen;
    const capturedAuthority = this.authorityGen;
    const permit = () => this.permitted(p)
      && this.viewGen === capturedView
      && this.foregroundGen === capturedForeground
      && this.authorityGen === capturedAuthority;
    if (!permit()) return;
    // Epoch only — must not advance authorityGen or this dispatch's own permit dies.
    this.epoch++; this.reads.clear();
    const pending: GameCommentOperation = { ...operation, status: 'pending', notice: 'Отправляем…' };
    this.history.set(p.key, pending); this.show();
    try {
      const raw = await this.ports.send(p, permit);
      if (this.history.get(p.key)?.packet !== p || !sameActor(this.state.actor, p.actor)) return;
      parseGameCommentReceipt(raw, p);
      if (this.history.get(p.key)?.packet !== p || !sameActor(this.state.actor, p.actor)) return;
      this.history.set(p.key, { ...operation, status: 'confirmed', notice: 'Действие подтверждено.' });
      // Late ACK may keep original history for the same actor; never paint/clear/refresh a detached view.
      if (!permit()) return;
      const drafts = { ...this.state.drafts };
      const draftKey = p.action.kind === 'create' ? p.action.parentCommentId ?? 'root'
        : p.action.kind === 'edit' ? `edit:${p.action.comment.id}` : null;
      if (draftKey) delete drafts[draftKey];
      if (p.action.kind === 'edit') this.edits.delete(p.action.comment.id);
      this.show({ drafts }); await this.refresh();
    } catch (error) {
      if (this.history.get(p.key)?.packet !== p || !sameActor(this.state.actor, p.actor)) return;
      const refused = error instanceof CommunityError && ['refused', 'private'].includes(error.kind);
      this.history.set(p.key, {
        ...operation,
        status: refused ? 'refused' : 'unknown',
        notice: refused ? gameCommentNotice(error)
          : 'Результат неизвестен. Сохранено исходное действие; автоматического повтора нет.',
      });
      // Always surface UNKNOWN/refused into the snapshot; permit only gates live side effects.
      this.show();
      if (permit() && error instanceof CommunityError && error.kind === 'private') this.clearPermissions();
    } finally {
      if (permit() && sameActor(this.state.actor, p.actor) && this.state.gameId === p.scope.gameId && this.history.has(p.key)) {
        this.show();
      }
    }
  }
}
