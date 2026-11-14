import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import { MessagesError, messageId } from './messages.ts';
import type { Conversation } from './messages.ts';
import { contactConversation, parseContactResult, parseContactState } from './contact.ts';
import type { ContactPacket, ContactResult, ContactState } from './contact.ts';
import type { PublicPlayer } from './players.ts';

type Port = {
  state: (target: string, actor: Actor) => Promise<ContactState>;
  player: (target: string, actor: Actor) => Promise<PublicPlayer>;
  conversation: (id: string, actor: Actor) => Promise<Conversation>;
  send: (packet: ContactPacket, authority: Actor) => Promise<ContactResult>;
};
type Command = { packet: ContactPacket; status: 'sending' | 'unknown' };
type Snapshot = { actor: Actor | null; target: string | null; viewGeneration: number; status: 'idle' | 'loading' | 'ready' | 'existing' | 'unavailable' | 'error';
  contact: ContactState | null; player: PublicPlayer | null; conversation: Conversation | null;
  drafts: Record<string, string>; command?: Command; notice: string | null };
const initial = (actor: Actor | null = null, viewGeneration = 0): Snapshot => ({ actor, target: null, viewGeneration, status: 'idle', contact: null, player: null, conversation: null, drafts: {}, notice: null });
const unknownNotice = 'Результат неизвестен. Проверка повторит только прежнее сообщение с тем же ключом и данными.';
const unavailable = 'Общение сейчас недоступно. Можно вернуться к списку игроков или открыть сообщения.';
/** Bounded root owner for directory first contact. No polling, persistence or automatic sending. */
export class ContactCoordinator {
  private snapshot = initial(); private serial = 0; private listeners = new Set<() => void>();
  private quarantine: { actorId: string; target: string | null; packet?: ContactPacket; drafts: Record<string, string> } | null = null;
  private safetyPeers = new Set<string>();
  private port: Port; private random: () => string;
  constructor(port: Port, random: () => string) { this.port = port; this.random = random; }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  setActor(actor: Actor | null) {
    if (sameActor(actor, this.snapshot.actor) || !actor && !this.snapshot.actor) return;
    // Bind even unsent drafts to the last authoritative principal, never to a login attempt.
    if (this.snapshot.actor) this.quarantine = { actorId: this.snapshot.actor.actorId, target: this.snapshot.target,
      packet: this.snapshot.command?.packet, drafts: this.snapshot.drafts };
    if (actor && this.quarantine?.actorId !== actor.actorId) this.quarantine = null;
    this.safetyPeers.clear();
    const saved = actor ? this.quarantine : null;
    if (actor) this.quarantine = null;
    this.snapshot = initial(actor ? Object.freeze({ ...actor }) : null, ++this.serial);
    this.show(saved ? { target: saved.target, drafts: saved.drafts,
      ...(saved.packet ? { command: { packet: saved.packet, status: 'unknown' }, notice: unknownNotice } : {}) } : {});
  }
  forget = () => { this.safetyPeers.clear(); this.quarantine = null; this.snapshot = initial(null, ++this.serial); this.show({}); };
  safetyPermit = () => this.serial;
  mayDispatchSafety = (peer: string, permit = this.serial) => permit === this.serial && !this.safetyPeers.has(peer);
  /** Verified communication safety only; original packets and unrelated targets survive. */
  setPeerSafety = (peer: string, blocked: boolean) => {
    if (blocked) this.safetyPeers.add(peer); else this.safetyPeers.delete(peer);
    if (this.snapshot.target !== peer) return;
    ++this.serial;
    this.show({ viewGeneration: this.serial, status: 'unavailable', contact: null, player: null, conversation: null,
      ...(this.snapshot.command ? { command: { ...this.snapshot.command, status: 'unknown' } } : {}),
      notice: this.snapshot.command ? unknownNotice : unavailable });
    void this.open(peer);
  };
  private valid(actor: Actor, serial: number, target: string) {
    return serial === this.serial && sameActor(actor, this.snapshot.actor) && target === this.snapshot.target;
  }
  blur = () => {
    ++this.serial;
    this.show({ viewGeneration: this.serial, target: null, status: 'idle', contact: null, player: null, conversation: null,
      ...(this.snapshot.command ? { command: { ...this.snapshot.command, status: 'unknown' }, notice: unknownNotice } : {}) });
  };
  /** Opening/reopening reads only. UNKNOWN is kept even when an existing header becomes visible. */
  open = async (target: string) => {
    const actor = this.snapshot.actor;
    if (!actor) return;
    try { messageId(target); } catch { this.blur(); this.show({ status: 'unavailable', notice: unavailable }); return; }
    const serial = ++this.serial;
    this.show({ viewGeneration: serial, target, status: 'loading', contact: null, player: null, conversation: null,
      ...(this.snapshot.command ? { command: { ...this.snapshot.command, status: 'unknown' }, notice: unknownNotice } : { notice: null }) });
    try { await this.read(target, actor, serial); }
    catch (error) {
      if (this.valid(actor, serial, target)) this.show(error instanceof MessagesError && error.kind === 'private'
        ? { status: 'unavailable', notice: unavailable }
        : { status: 'error', notice: 'Не удалось проверить возможность общения. Повторите проверку.' });
    }
  };
  private async read(target: string, actor: Actor, serial: number) {
    const contact = parseContactState(await this.port.state(target, actor), target);
    if (!this.valid(actor, serial, target)) return null;
    if ('conversationId' in contact) {
      const conversation = contactConversation(await this.port.conversation(contact.conversationId, actor), target, contact.conversationId);
      if (!this.valid(actor, serial, target)) return null;
      this.show({ contact, conversation, player: null, status: 'existing' }); return contact;
    }
    if (this.safetyPeers.has(target) || contact.state !== 'none' || !contact.canRequestContact) {
      this.show({ contact, status: 'unavailable', notice: this.safetyPeers.has(target) && this.snapshot.command ? 'Блокировка приостановила исходное сообщение. Результат неизвестен; исходный пакет сохранён.' : unavailable }); return null;
    }
    const player = await this.port.player(target, actor);
    if (!this.valid(actor, serial, target)) return null;
    if (player.publicPlayerId !== target || player.canRequestContact !== true) {
      this.show({ contact: null, player: null, status: 'unavailable', notice: unavailable }); return null;
    }
    this.show({ contact, player, status: 'ready' }); return contact;
  }
  // Rendered callbacks carry a view generation, stable across typing and dispatch updates.
  // Only open/blur/actor/forget boundaries replace it; request serials still fence async work.
  draft = (target: string, text: string, expectedActor = this.snapshot.actor, expectedView = this.snapshot.viewGeneration) => {
    if (expectedView !== this.snapshot.viewGeneration || !sameActor(expectedActor, this.snapshot.actor) || !this.snapshot.actor || this.snapshot.target !== target || this.snapshot.command || this.snapshot.status !== 'ready' || this.safetyPeers.has(target)) return;
    this.show({ drafts: { ...this.snapshot.drafts, [target]: text } });
  };
  send = async (expectedTarget = this.snapshot.target, expectedActor = this.snapshot.actor, expectedView = this.snapshot.viewGeneration) => {
    const { actor, target, status, command, drafts } = this.snapshot;
    if (expectedView !== this.snapshot.viewGeneration || !sameActor(expectedActor, actor) || expectedTarget !== target || !actor || !target || status !== 'ready' || command || this.safetyPeers.has(target)) return;
    const text = (drafts[target] ?? '').trim();
    if (!text || text.length > 2000) return;
    const packet: ContactPacket = Object.freeze({ actor: Object.freeze({ ...actor }), key: this.random(),
      body: Object.freeze({ targetPublicPlayerId: target, text, clientMessageId: this.random() }) });
    await this.dispatch(packet, actor, false);
  };
  reconcile = async (expectedTarget = this.snapshot.target, expectedActor = this.snapshot.actor, expectedView = this.snapshot.viewGeneration) => {
    const { actor, target, command } = this.snapshot;
    if (expectedView !== this.snapshot.viewGeneration || !sameActor(expectedActor, actor) || expectedTarget !== target || !actor || !command || command.status !== 'unknown' || target !== command.packet.body.targetPublicPlayerId || actor.actorId !== command.packet.actor.actorId || this.safetyPeers.has(command.packet.body.targetPublicPlayerId)) return;
    await this.dispatch(command.packet, actor, true);
  };
  private async dispatch(packet: ContactPacket, authority: Actor, retry: boolean) {
    const target = packet.body.targetPublicPlayerId, serial = ++this.serial;
    this.show({ command: { packet, status: 'sending' }, notice: null, conversation: null });
    const valid = () => !this.safetyPeers.has(target) && this.valid(authority, serial, target) && this.snapshot.command?.packet === packet;
    let sent = false;
    try {
      // Revalidate current policy, target and header before writing. Replay never invents a replacement packet.
      const contact = await this.read(target, authority, serial);
      if (!valid()) return;
      if (!contact) {
        this.show({ command: retry ? { packet, status: 'unknown' } : undefined }); return;
      }
      if ('conversationId' in contact && !retry) { this.show({ command: undefined }); return; }
      sent = true;
      const result = parseContactResult(await this.port.send(packet, authority), target);
      if (!valid()) return;
      const drafts = { ...this.snapshot.drafts }; delete drafts[target];
      this.show({ command: undefined, drafts, conversation: result.conversation, status: 'existing', notice: null });
    } catch (error) {
      if (!valid()) return;
      if (!sent && !retry && error instanceof MessagesError && error.status < 500 && error.code !== 'COMMAND_IN_PROGRESS' &&
        (error.kind === 'private' || error.kind === 'business')) {
        this.show({ command: undefined, conversation: null, status: 'unavailable', notice: unavailable }); return;
      }
      if (sent && error instanceof MessagesError && error.kind === 'business' && error.status === 409 &&
        ['CONVERSATION_ALREADY_OPEN','REQUEST_PENDING','REQUEST_DECISION_REQUIRED'].includes(error.code)) {
        // A known existing-conversation race is reconciled with authoritative target/header reads only.
        try {
          const contact = await this.read(target, authority, serial);
          if (!valid()) return;
          if (contact && 'conversationId' in contact) { this.show({ command: undefined, notice: 'Открыта существующая переписка. Сообщение автоматически не отправлялось.' }); return; }
        } catch { /* Keep the original packet until an explicit reconciliation. */ }
      } else if (sent && error instanceof MessagesError && error.status < 500 && error.code !== 'COMMAND_IN_PROGRESS' &&
        (error.kind === 'private' || error.kind === 'business') &&
        !['IDEMPOTENCY_KEY_REUSED','KEY_REUSED','CLIENT_MESSAGE_ID_REUSED','CLIENT_MESSAGE_ID_UNAVAILABLE'].includes(error.code)) {
        this.show({ command: undefined, conversation: null, status: 'unavailable', notice: error.status === 429
          ? 'Слишком часто. Черновик сохранён; повторите проверку позже.' : 'Сообщение не отправлено. Проверьте условия общения и текст; черновик сохранён.' }); return;
      }
      if (valid()) this.show({ command: { packet, status: 'unknown' }, conversation: null, notice: unknownNotice });
    }
  }
}
