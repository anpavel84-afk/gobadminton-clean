import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import { messageId } from './messages.ts';
import type { DirectMessage } from './messages.ts';
import { parseSafetyReceipt, reportable, reportDetail, REPORT_REASONS, SafetyError, safetyWire } from './safety.ts';
import type { SafetyContext, SafetyPacket, ReportReason, ReportBody } from './safety.ts';

type Dialog = 'block' | 'unblock' | 'player' | 'message' | null;
type Command = { packet: SafetyPacket; status: 'sending' | 'unknown' };
type Snapshot = { actor: Actor | null; context: SafetyContext | null; viewGeneration: number; dialog: Dialog;
  reason: ReportReason; detail: string; selected: string | null; consent: boolean; command?: Command;
  lastBlocks: Readonly<Record<string, boolean>>; lastNames: Readonly<Record<string, string>>; notice: string | null };
const empty = (actor: Actor | null, viewGeneration: number): Snapshot => ({ actor, context: null, viewGeneration, dialog: null,
  reason: 'harassment', detail: '', selected: null, consent: false, lastBlocks: {}, lastNames: {}, notice: null });
const unknown = 'Результат неизвестен. Проверка повторит исходное действие с тем же ключом и данными. Новое действие пока недоступно.';
const sameContext = (a: SafetyContext | null, b: SafetyContext | null) => !!a && !!b && a.peerId === b.peerId && a.conversationId === b.conversationId;
/** One bounded in-memory command owner. Navigation and reauthentication never create a replacement packet. */
export class SafetyCoordinator {
  private snapshot = empty(null, 0); private generation = 0; private listeners = new Set<() => void>();
  private quarantine: { owner: string; snapshot: Snapshot } | null = null;
  private inFlight: SafetyPacket | null = null;
  private port: { send: (packet: SafetyPacket, authority: Actor) => Promise<unknown>; verified: (peer: string, blocked: boolean, context: SafetyContext) => void };
  private random: () => string;
  constructor(port: SafetyCoordinator['port'], random: () => string) { this.port = port; this.random = random; }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  setActor(actor: Actor | null) {
    if (sameActor(actor, this.snapshot.actor) || !actor && !this.snapshot.actor) return;
    if (this.snapshot.actor) this.quarantine = { owner: this.snapshot.actor.actorId, snapshot: this.snapshot };
    const saved = actor && this.quarantine?.owner === actor.actorId ? this.quarantine.snapshot : null;
    if (actor && this.quarantine?.owner !== actor.actorId) this.inFlight = null;
    if (actor) this.quarantine = null;
    this.snapshot = empty(actor ? Object.freeze({ ...actor }) : null, ++this.generation);
    if (saved) this.show({ context: saved.context, dialog: saved.dialog, reason: saved.reason, detail: saved.detail, selected: null, consent: false,
      lastBlocks: saved.lastBlocks, lastNames: saved.lastNames, ...(saved.command ? { command: { packet: saved.command.packet, status: 'unknown' }, notice: unknown } : {}) });
    else this.show({});
    if (actor && saved) for (const [peer, blocked] of Object.entries(saved.lastBlocks)) if (blocked) this.port.verified(peer, true, { peerId: peer, name: '' });
  }
  forget = () => { this.inFlight = null; this.quarantine = null; this.snapshot = empty(null, ++this.generation); this.show({}); };
  open = (context: SafetyContext) => {
    if (!this.snapshot.actor) return;
    messageId(context.peerId); if (context.conversationId) messageId(context.conversationId);
    this.show({ context: Object.freeze({ ...context }), viewGeneration: ++this.generation, dialog: null,
      reason: 'harassment', detail: '', selected: null, consent: false, notice: this.snapshot.command ? unknown : null,
      ...(this.snapshot.command ? { command: { ...this.snapshot.command, status: 'unknown' } } : {}) });
  };
  blur = (view: number) => {
    if (view !== this.snapshot.viewGeneration) return;
    this.show({ context: null, viewGeneration: ++this.generation, dialog: null, detail: '', selected: null, consent: false,
      ...(this.snapshot.command ? { command: { ...this.snapshot.command, status: 'unknown' }, notice: unknown } : { notice: null }) });
  };
  private current(view: number, actor: Actor | null) { return view === this.snapshot.viewGeneration && !!actor && sameActor(actor, this.snapshot.actor) && !!this.snapshot.context; }
  choose = (dialog: Exclude<Dialog, null>, view: number, actor: Actor | null) => {
    if (!this.current(view, actor) || this.snapshot.command || this.inFlight || dialog === 'message' && !this.snapshot.context?.conversationId) return;
    this.show({ dialog, selected: null, consent: false, reason: 'harassment', detail: '', notice: null });
  };
  cancel = (view: number, actor: Actor | null) => {
    if (this.current(view, actor)) this.show({ dialog: null, selected: null, consent: false, detail: '', notice: this.snapshot.command ? unknown : null });
  };
  edit = (reason: ReportReason, detail: string, view: number, actor: Actor | null) => {
    if (!this.current(view, actor) || this.snapshot.command || !REPORT_REASONS.some(r => r.code === reason) || detail.length > 1000) return;
    this.show({ reason, detail });
  };
  select = (id: string | null, messages: DirectMessage[], view: number, actor: Actor | null) => {
    if (!this.current(view, actor) || this.snapshot.command || this.snapshot.dialog !== 'message') return;
    const m = messages.find(m => m.id === id);
    this.show({ selected: m && reportable(m, this.snapshot.context!) ? m.id : null, consent: false });
  };
  consent = (value: boolean, view: number, actor: Actor | null) => {
    if (this.current(view, actor) && !this.snapshot.command && this.snapshot.dialog === 'message' && this.snapshot.selected) this.show({ consent: value === true });
  };
  submit = async (messages: DirectMessage[], view: number, expectedActor: Actor | null) => {
    const { actor, context, dialog, reason, detail, selected, consent } = this.snapshot;
    if (!this.current(view, expectedActor) || !actor || !context || !dialog || this.snapshot.command || this.inFlight) return;
    let packet: SafetyPacket;
    const base = { actor: Object.freeze({ ...actor }), context: Object.freeze({ ...context }), key: this.random() };
    if (dialog === 'block' || dialog === 'unblock') packet = Object.freeze({ ...base, action: dialog, method: dialog === 'block' ? 'PUT' : 'DELETE', path: `/me/blocks/${encodeURIComponent(context.peerId)}`, body: Object.freeze({}) });
    else {
      let body: ReportBody;
      if (dialog === 'message') {
        const m = messages.find(m => m.id === selected);
        if (!consent || !m || !reportable(m, context)) return;
        body = Object.freeze({ targetKind: 'message', messageId: m.id, conversationId: context.conversationId!, reasonCode: reason, detail: reportDetail(detail), shareMessageWithSupport: true });
      } else body = Object.freeze({ targetKind: 'player', targetPublicPlayerId: context.peerId, reasonCode: reason, detail: reportDetail(detail) });
      packet = Object.freeze({ ...base, action: 'report', method: 'POST', path: '/reports', body });
    }
    safetyWire(packet);
    await this.dispatch(packet, actor, view, false);
  };
  reconcile = async (view: number, expectedActor: Actor | null) => {
    const { command, actor, context } = this.snapshot;
    if (!this.current(view, expectedActor) || !actor || !command || command.status !== 'unknown' || this.inFlight ||
      command.packet.actor.actorId !== actor.actorId || !sameContext(context, command.packet.context)) return;
    await this.dispatch(command.packet, actor, view, true);
  };
  private async dispatch(packet: SafetyPacket, actor: Actor, view: number, reconciling: boolean) {
    this.inFlight = packet;
    this.show({ command: { packet, status: 'sending' }, notice: null, consent: false });
    const valid = () => this.current(view, actor) && this.snapshot.command?.packet === packet && sameContext(this.snapshot.context, packet.context);
    try {
      const receipt = parseSafetyReceipt(packet, await this.port.send(packet, actor));
      if (!valid()) return;
      if ('blocked' in receipt) {
        this.show({ lastBlocks: { ...this.snapshot.lastBlocks, [packet.context.peerId]: receipt.blocked },
          lastNames: { ...this.snapshot.lastNames, [packet.context.peerId]: packet.context.name } });
        this.port.verified(packet.context.peerId, receipt.blocked, packet.context);
      }
      this.show({ command: undefined, dialog: null, detail: '', selected: null, consent: false,
        notice: packet.action === 'report' ? 'Жалоба отправлена.' : packet.action === 'block' ? 'Игрок заблокирован.' : 'Блокировка снята. Возможность общения проверяется заново.' });
    } catch (error) {
      if (!valid()) return;
      if (!reconciling && error instanceof SafetyError && error.kind === 'business' && !['KEY_REUSED','IDEMPOTENCY_KEY_REUSED'].includes(error.code))
        this.show({ command: undefined, notice: 'Действие отклонено. Проверьте условия и попробуйте позже.' });
      else this.show({ command: { packet, status: 'unknown' }, notice: unknown });
    } finally { if (this.inFlight === packet) this.inFlight = null; }
  }
}
