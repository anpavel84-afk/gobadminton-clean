import { MessagesError, mergeMessages, mutationPath, parseInvitation, seq } from './messages.ts';
import type { Conversation, DirectMessage, GameChat, GameChatMember, GameInvitation, InboxCounts, InboxFilter, InboxItem, InboxPage, MessageResource, MessageAction, MessageBody, MessagePage } from './messages.ts';
import type { Actor } from './participation.ts';
import { sameActor } from './participation.ts';
export type MessagePacket = Readonly<{ actor: Readonly<Actor>; resource: Readonly<MessageResource>; action: MessageAction;
  method: 'POST'; path: string; body: MessageBody; key: string; clientMessageId?: string }>;
export type MessagesPort = {
  inbox: (filter: InboxFilter, cursor?: string) => Promise<InboxPage>; counts: () => Promise<InboxCounts>; identity: () => Promise<string>;
  direct: (id: string) => Promise<Conversation>; game: (id: string) => Promise<GameChat>; members: (id: string) => Promise<GameChatMember[]>;
  invitation: (id: string) => Promise<GameInvitation>; history: (r: MessageResource, before?: string, after?: string) => Promise<MessagePage<DirectMessage>>;
  send: (packet: MessagePacket) => Promise<unknown>;
};
export type MessagesClock = { now: () => number; schedule: (callback: () => void, delay: number) => () => void };
const clock: MessagesClock = { now: () => Date.now(), schedule: (callback, delay) => {
  const timer = setTimeout(callback,delay); return () => clearTimeout(timer);
} };
type Pending = { packet: MessagePacket; state: 'sending' | 'unknown' };
type Detail = { resource: MessageResource; status: 'loading' | 'ready' | 'error'; header: Conversation | GameChat | GameInvitation | null;
  messages: DirectMessage[]; cursor: string | null; members: GameChatMember[]; ownId: string | null; error: string | null; loadingMore: boolean };
export type MessagesSnapshot = { actor: Actor | null; counts: InboxCounts | null; countsLoading: boolean;
  filter: InboxFilter; inbox: InboxPage | null; inboxStatus: 'idle' | 'loading' | 'ready' | 'error'; inboxError: boolean; loadingMore: boolean;
  detail: Detail | null; drafts: Readonly<Record<string,string>>; pending: Readonly<Record<string,Pending>>; notice: string | null };
export const resourceKey = (r: MessageResource) => `${r.kind}:${r.id}`;
// A direct request becomes a DM without changing its underlying inbox identity.
const inboxKey = (item: InboxItem) => `${item.kind === 'dm_request' ? 'dm' : item.kind}:${item.id}`;
const matchesFilter = (item: InboxItem, filter: InboxFilter) => filter === 'all' || (filter === 'unread' ? item.unreadCount > 0 : item.attention);
const accessLossNotice = 'Доступ к сообщениям утрачен. Проверьте сеанс.';
const initial = (actor: Actor | null): MessagesSnapshot => ({ actor, counts: null, countsLoading: false, filter: 'all', inbox: null,
  inboxStatus: 'idle', inboxError: false, loadingMore: false, detail: null, drafts: {}, pending: {}, notice: null });
/** Root-owned, actor/session/generation fenced. Tab lifetimes never own mutation packets. */
export class MessagesCoordinator {
  private snapshot = initial(null);
  private listeners = new Set<() => void>();
  private revision = 0;
  private listRevision = 0;
  private detailRevision = 0;
  private countsRevision = 0;
  private accessLoss: { revision: number; key: string } | null = null;
  private foreground = true;
  private focused: string | null = null;
  private focusResource: MessageResource | null = null;
  private roots = new Set<symbol>();
  private focusLease = 0;
  private reads = new Set<'counts' | 'inbox' | 'detail'>();
  private cancelTimer: (() => void) | null = null;
  private polling = false;
  private detailDue = 0;
  private listDue = 0;
  private countsDue = 0;
  private readonly clock: MessagesClock;
  private readonly port: MessagesPort;
  private readonly random: () => string;
  constructor(port: MessagesPort, random: () => string, scheduler: MessagesClock = clock) { this.port = port; this.random = random; this.clock = scheduler; }
  /** Root lease: rerenders and overlapping mount cleanup cannot own extra timers. */
  mount = () => {
    const lease = Symbol(), first = this.roots.size === 0;
    this.roots.add(lease); if (first) this.resetDue(); this.schedule();
    return () => {
      if (!this.roots.delete(lease)) return;
      if (!this.roots.size) { ++this.listRevision; ++this.detailRevision; ++this.countsRevision; }
      this.schedule();
    };
  };
  leaseFocus = (resource: MessageResource | 'inbox') => {
    if (resource === 'inbox') { this.focus(null); this.focused = 'inbox'; this.resetDue(); void this.loadInbox(); this.schedule(); }
    else this.focus(resource);
    const lease = this.focusLease;
    return () => { if (lease === this.focusLease) this.focus(null); };
  };
  private blocked() { return Object.keys(this.snapshot.pending).length > 0; }
  private resetDue() {
    const now = this.clock.now();
    this.detailDue = now + (this.focusResource?.kind === 'direct' ? 3000 : 15000);
    this.listDue = this.countsDue = now + 15000;
  }
  private canPoll() { return this.roots.size > 0 && !!this.snapshot.actor && this.foreground && !!this.focused && !this.blocked(); }
  private schedule() {
    this.cancelTimer?.(); this.cancelTimer = null;
    if (!this.canPoll()) { this.resetDue(); return; }
    if (this.polling || this.reads.size) return;
    const due = [this.countsDue];
    if (this.focused === 'inbox') due.push(this.listDue);
    else if (this.focusResource?.kind !== 'invitation') due.push(this.detailDue);
    this.cancelTimer = this.clock.schedule(() => { this.cancelTimer = null; void this.poll(); },Math.max(0,Math.min(...due)-this.clock.now()));
  }
  private async poll() {
    if (!this.canPoll() || this.reads.size || this.polling) { this.schedule(); return; }
    this.polling = true;
    const revision = this.revision, focus = this.focusLease, now = this.clock.now();
    const current = () => this.canPoll() && revision === this.revision && focus === this.focusLease;
    try {
      const detail = this.snapshot.detail, resource = this.focusResource;
      if (resource && resource.kind !== 'invitation' && now >= this.detailDue) {
        this.detailDue = now + (resource.kind === 'direct' ? 3000 : 15000);
        if (detail?.status === 'ready') await this.catchUp(resource); else await this.loadDetail(resource);
      }
      if (current() && this.focused === 'inbox' && now >= this.listDue) {
        this.listDue = now + 15000; await this.loadInbox(this.snapshot.filter,undefined,true);
      }
      if (current() && now >= this.countsDue) { this.countsDue = now + 15000; await this.loadCounts(); }
    } finally {
      // Missed ticks coalesce: never replay a backlog after a slow read.
      const end = this.clock.now();
      if (this.detailDue <= end) this.detailDue = end + (this.focusResource?.kind === 'direct' ? 3000 : 15000);
      if (this.listDue <= end) this.listDue = end + 15000;
      if (this.countsDue <= end) this.countsDue = end + 15000;
      this.polling = false; this.schedule();
    }
  }
  private beginRead(lane: 'counts' | 'inbox' | 'detail') {
    if (!this.snapshot.actor || !this.foreground || this.blocked() || this.reads.has(lane)) return false;
    this.reads.add(lane); this.schedule(); return true;
  }
  private endRead(lane: 'counts' | 'inbox' | 'detail') { this.reads.delete(lane); this.schedule(); }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<MessagesSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); this.schedule(); }
  setActor(actor: Actor | null) {
    if ((!actor && !this.snapshot.actor) || sameActor(actor, this.snapshot.actor)) return;
    ++this.revision; ++this.listRevision; ++this.detailRevision; ++this.countsRevision; this.focused = null; this.focusResource = null; ++this.focusLease; this.resetDue();
    this.accessLoss = null; this.snapshot = initial(actor); this.show({});
  }
  setForeground(active: boolean) {
    if (active === this.foreground) return;
    this.foreground = active; ++this.listRevision; ++this.detailRevision; ++this.countsRevision;
    this.resetDue();
    this.show({ loadingMore: false, countsLoading: false, detail: this.snapshot.detail ? { ...this.snapshot.detail, loadingMore: false } : null });
    if (active && !this.blocked()) {
      const detail = this.snapshot.detail;
      if (this.focused === 'inbox') void this.loadInbox(this.snapshot.filter,undefined,true);
      else if (detail && this.focused === resourceKey(detail.resource)) {
        if (detail.status === 'ready' && detail.resource.kind !== 'invitation') void this.catchUp(detail.resource);
        else void this.loadDetail(detail.resource);
      }
    }
  }
  focus(resource: MessageResource | null) {
    ++this.detailRevision; ++this.listRevision; ++this.focusLease;
    this.focused = resource ? resourceKey(resource) : null; this.focusResource = resource;
    // Pending packets/drafts stay in the root owner on tab unmount.
    this.show({ detail: null }); this.resetDue();
    if (resource && this.foreground) void this.loadDetail(resource);
    this.schedule();
  }
  private valid(revision: number) { return revision === this.revision && !!this.snapshot.actor && this.foreground && !this.blocked(); }
  private failed(error: unknown): boolean {
    if (error instanceof MessagesError && error.kind === 'private') {
      ++this.revision; ++this.listRevision; ++this.detailRevision; ++this.countsRevision;
      // Keep only the mounted route intent/lease so its existing refresh and blur
      // handlers still work. All private DTOs, drafts and packets are discarded.
      const resource = this.focusResource, notice = accessLossNotice;
      this.accessLoss = resource ? { revision: this.revision, key: resourceKey(resource) } : null;
      this.snapshot = initial(this.snapshot.actor);
      this.show({ notice, inboxStatus: this.focused === 'inbox' ? 'error' : 'idle',
        detail: resource ? { resource, status: 'error', header: null, messages: [], cursor: null, members: [], ownId: null, error: notice, loadingMore: false } : null });
      return true;
    }
    return false;
  }
  loadCounts = async () => {
    if (!this.beginRead('counts')) return;
    const revision = this.revision, request = ++this.countsRevision;
    this.show({ countsLoading: true });
    try { const counts = await this.port.counts(); if (this.valid(revision) && request === this.countsRevision) this.show({ counts, countsLoading: false }); }
    catch (error) { if (this.valid(revision) && request === this.countsRevision && !this.failed(error)) this.show({ counts: null, countsLoading: false }); }
    finally { this.endRead('counts'); }
  };
  loadInbox = async (filter = this.snapshot.filter, cursor?: string, quiet = false) => {
    const old = this.snapshot.filter === filter ? this.snapshot.inbox : null;
    if (!this.snapshot.actor || !this.foreground || cursor && (this.snapshot.loadingMore || this.snapshot.filter !== filter || old?.nextCursor !== cursor)) return;
    if (!this.beginRead('inbox')) return;
    const revision = this.revision, request = ++this.listRevision;
    this.show({ filter, loadingMore: !!cursor, inboxStatus: cursor || quiet && old ? 'ready' : 'loading', inbox: cursor || quiet ? old : null, inboxError: false });
    try {
      const page = await this.port.inbox(filter,cursor);
      if (!this.valid(revision) || request !== this.listRevision) return;
      if (cursor && page.nextCursor === cursor) throw new MessagesError('invalid');
      let inbox = page;
      if (old && (cursor || quiet)) {
        const updates = new Map(page.items.map(item => [inboxKey(item),item]));
        const missing = new Set<string>();
        if (quiet && !cursor && filter !== 'all') {
          // Filtered endpoints omit changed rows. Resolve loaded identities via
          // authorized all-filter pages, stopping when found or coverage ends.
          // Only a complete scan proves absence; never infer it from page one.
          old.items.forEach(item => { if (!updates.has(inboxKey(item))) missing.add(inboxKey(item)); });
          let scanCursor: string | undefined;
          const visited = new Set<string>();
          while (missing.size) {
            const authoritative = await this.port.inbox('all',scanCursor);
            if (!this.valid(revision) || request !== this.listRevision) return;
            for (const item of authoritative.items) {
              const key = inboxKey(item);
              if (missing.delete(key)) updates.set(key,item);
            }
            if (!authoritative.nextCursor) break;
            if (visited.has(authoritative.nextCursor)) throw new MessagesError('invalid');
            visited.add(authoritative.nextCursor); scanCursor = authoritative.nextCursor;
          }
        }
        const items = cursor ? [...old.items,...page.items] : [...page.items,...old.items];
        // Keep the loaded pagination boundary. Absence removes a row only after
        // all-filter exhaustion; replacements can update its kind/filter.
        const merged = new Map(items.map(item => [inboxKey(item),updates.get(inboxKey(item)) ?? item]));
        inbox = { ...page, items: [...merged.values()].filter(item => !missing.has(inboxKey(item)) && matchesFilter(item,filter)), nextCursor: cursor ? page.nextCursor : old.nextCursor };
      }
      this.show({ inbox, counts: page.counts, inboxStatus: 'ready', loadingMore: false });
    } catch (error) { if (this.valid(revision) && request === this.listRevision && !this.failed(error)) this.show({ inboxStatus: cursor || quiet && old ? 'ready' : 'error', inboxError: true, loadingMore: false }); }
    finally { this.endRead('inbox'); }
  };
  loadDetail = async (resource: MessageResource, older = false) => {
    const key = resourceKey(resource), previous = this.snapshot.detail;
    if (!this.snapshot.actor || !this.foreground || this.focused !== key || older && (!previous?.cursor || previous.loadingMore || previous.status !== 'ready')) return;
    if (!this.beginRead('detail')) return;
    const revision = this.revision, request = ++this.detailRevision;
    const fresh: Detail = { resource, status: 'loading', header: null, messages: [], cursor: null, members: [], ownId: null, error: null, loadingMore: false };
    this.show({ detail: older && previous ? { ...previous, loadingMore: true, error: null } : fresh });
    try {
      let detail: Detail;
      if (older && previous) {
        const page = await this.port.history(resource,previous.cursor!);
        if (page.nextCursor === previous.cursor) throw new MessagesError('invalid');
        detail = { ...previous, messages: mergeMessages(previous.messages,page.items), cursor: page.nextCursor, loadingMore: false };
      } else {
        const ownId = await this.port.identity();
        if (!this.valid(revision) || request !== this.detailRevision) return;
        if (resource.kind === 'invitation') detail = { ...fresh, ownId, status: 'ready', header: await this.port.invitation(resource.id) };
        else {
          const [header,page,members] = await Promise.all([resource.kind === 'direct' ? this.port.direct(resource.id) : this.port.game(resource.id),
            this.port.history(resource), resource.kind === 'game' ? this.port.members(resource.id) : Promise.resolve([])]);
          detail = { ...fresh, ownId, status: 'ready', header, messages: mergeMessages([],page.items), cursor: page.nextCursor, members };
        }
      }
      if (this.valid(revision) && request === this.detailRevision && this.focused === key) {
        const resolved = this.accessLoss?.revision === revision && this.accessLoss.key === key;
        if (resolved) this.accessLoss = null;
        this.show({ detail, ...(resolved && this.snapshot.notice === accessLossNotice ? { notice: null } : {}) });
      }
    } catch (error) {
      if (this.valid(revision) && request === this.detailRevision && !this.failed(error)) this.show({ detail: older && previous ? { ...previous, loadingMore: false, error: 'Не удалось загрузить историю' } : { ...fresh, status: 'error', error: 'Переписка недоступна. Попробуйте обновить.' } });
    } finally { this.endRead('detail'); }
  };
  /** Catch up with decimal strings. Every page is authorized; generation prevents cursor/A→B→A publication. */
  catchUp = async (resource: MessageResource) => {
    const previous = this.snapshot.detail, key = resourceKey(resource);
    if (!previous || previous.status !== 'ready' || !previous.header || resource.kind === 'invitation' || this.focused !== key || !this.foreground) return;
    if (!this.beginRead('detail')) return;
    const revision = this.revision, request = ++this.detailRevision;
    try {
      const header = resource.kind === 'direct' ? await this.port.direct(resource.id) : await this.port.game(resource.id);
      if (!this.valid(revision) || request !== this.detailRevision) return;
      let messages = previous.messages, watermark = messages.at(-1)?.seq ?? '0';
      // Four pages per visible update; next foreground/update continues from the committed watermark.
      for (let i=0;i<4;i++) {
        const page = await this.port.history(resource,undefined,watermark);
        if (!this.valid(revision) || request !== this.detailRevision) return;
        if (!page.items.length) break;
        const next = mergeMessages([],page.items).at(-1)!.seq;
        if (BigInt(next) <= BigInt(watermark)) throw new MessagesError('invalid');
        messages = mergeMessages(messages,page.items); watermark = next;
        if (!page.nextCursor) break;
      }
      if (this.valid(revision) && request === this.detailRevision && this.focused === key) this.show({ detail: { ...previous, header, messages } });
    } catch (error) { if (this.valid(revision) && request === this.detailRevision && !this.failed(error)) this.show({ notice: 'Не удалось обновить сообщения' }); }
    finally { this.endRead('detail'); }
  };
  draft(resource: MessageResource, text: string) {
    const key = resourceKey(resource); if (this.snapshot.pending[key]) return;
    this.show({ drafts: { ...this.snapshot.drafts, [key]: text } });
  }
  act = async (resource: MessageResource, action: MessageAction, throughSeq?: string) => {
    const actor = this.snapshot.actor, detail = this.snapshot.detail, key = resourceKey(resource);
    if (!actor || !this.foreground || this.focused !== key || !detail || detail.status !== 'ready' || !detail.header || this.snapshot.pending[key]) return;
    const h = detail.header; let body: MessageBody, clientMessageId: string | undefined;
    if (action === 'send') {
      const text = (this.snapshot.drafts[key] ?? '').trim();
      if (!text || resource.kind === 'invitation' || ('requestState' in h ? h.requestState !== 'accepted' : !('lifecycleState' in h) || h.lifecycleState !== 'active')) return;
      clientMessageId = this.random(); body = { kind: 'text', text, clientMessageId };
    } else if (action === 'read') { if (!throughSeq || resource.kind === 'invitation') return; body = { throughSeq: seq(throughSeq) }; }
    else {
      if (resource.kind === 'game') return;
      if ('requestState' in h && (h.requestState !== 'pending' || h.role !== 'recipient')) return;
      if ('status' in h && (h.status !== 'pending' || h.inviteePublicPlayerId !== detail.ownId)) return;
      if (resource.kind === 'invitation' && action === 'accept') {
        if (!('acceptanceContext' in h) || !h.acceptanceContext) return;
        body = { expectedVersion: h.version, expectedGameVersion: h.acceptanceContext.gameVersion };
      } else body = { expectedVersion: h.version };
    }
    const packet: MessagePacket = Object.freeze({ actor: Object.freeze({ ...actor }), resource: Object.freeze({ ...resource }), action, method: 'POST', path: mutationPath(resource,action),
      body: Object.freeze(body), key: this.random(), ...(clientMessageId ? { clientMessageId } : {}) });
    ++this.listRevision; ++this.detailRevision; ++this.countsRevision;
    this.show({ pending: { ...this.snapshot.pending, [key]: { packet, state: 'sending' } }, notice: null, countsLoading: false, loadingMore: false,
      detail: { ...detail, loadingMore: false } });
    await this.dispatch(packet);
  };
  /** Called only from RN viewability; opening a thread/header lastSeq never marks history read. */
  visible = (resource: MessageResource, ids: string[], nearBottom: boolean) => {
    const detail = this.snapshot.detail;
    if (!detail || detail.status !== 'ready' || !detail.ownId || !this.foreground || !nearBottom || this.focused !== resourceKey(resource) || !detail.header || !('readThroughSeq' in detail.header)) return;
    const incoming = detail.messages.filter(m => ids.includes(m.id) && m.authorPublicPlayerId !== null && m.authorPublicPlayerId !== detail.ownId);
    const last = mergeMessages([],incoming).at(-1);
    if (last && BigInt(last.seq) > BigInt(detail.header.readThroughSeq)) void this.act(resource,'read',last.seq);
  };
  retry = async (resource: MessageResource) => {
    const pending = this.snapshot.pending[resourceKey(resource)];
    if (!pending || pending.state !== 'unknown' || !this.foreground || !sameActor(pending.packet.actor,this.snapshot.actor)) return;
    this.show({ pending: { ...this.snapshot.pending, [resourceKey(resource)]: { ...pending, state: 'sending' } } });
    await this.dispatch(pending.packet);
  };
  private async dispatch(packet: MessagePacket) {
    const revision = this.revision, key = resourceKey(packet.resource);
    try {
      const result = await this.port.send(packet);
      if (revision !== this.revision || !sameActor(packet.actor,this.snapshot.actor)) return;
      const pending = { ...this.snapshot.pending }; delete pending[key];
      const drafts = { ...this.snapshot.drafts }; if (packet.action === 'send') delete drafts[key];
      let detail = this.snapshot.detail;
      if (packet.action === 'read' && detail && resourceKey(detail.resource) === key && detail.header && 'readThroughSeq' in detail.header && 'throughSeq' in packet.body) {
        detail = { ...detail, header: { ...detail.header, readThroughSeq: packet.body.throughSeq } };
      }
      if (packet.resource.kind === 'invitation' && detail && resourceKey(detail.resource) === key) {
        // Server mutation result only; accepted game link appears only after authoritative accept.
        try { detail = { ...detail, header: parseInvitation(packet.action === 'accept' ? (result as { invitation: unknown }).invitation : result) }; } catch { detail = null; }
      }
      this.show({ pending, drafts, detail, notice: null });
      if (packet.action !== 'read' && this.focused === key && packet.resource.kind !== 'invitation') void this.catchUp(packet.resource);
      void this.loadCounts();
    } catch (error) {
      if (revision !== this.revision || !sameActor(packet.actor,this.snapshot.actor) || this.failed(error)) return;
      if (error instanceof MessagesError && error.kind === 'business' && !['IDEMPOTENCY_KEY_REUSED','KEY_REUSED','CLIENT_MESSAGE_ID_REUSED','CLIENT_MESSAGE_ID_UNAVAILABLE'].includes(error.code)) {
        const pending = { ...this.snapshot.pending }; delete pending[key];
        this.show({ pending, notice: error.status === 429 ? 'Слишком часто. Черновик сохранён.' : 'Действие отклонено. Черновик сохранён; обновите условия.' });
      } else this.show({ pending: { ...this.snapshot.pending, [key]: { packet, state: 'unknown' } }, notice: 'Результат неизвестен. Проверьте тем же запросом.' });
    }
  }
}
