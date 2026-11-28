import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import { NativeAuthError } from './native-auth-protocol.ts';
import {
  FRIENDS_TABS, FriendshipError, FRIENDSHIP_UNKNOWN_NOTICE,
  FRIENDSHIP_RETIREMENT_WARNING,
  friendCommand, friendshipStatesPath, friendshipsListPath,
  ownFriendsPrerequisite, parseFriendshipList, parseFriendshipReceipt, parseFriendshipStates,
  parseSocialCapabilities, publicPlayerId, type FriendAction, type FriendshipList,
  type FriendshipPacket, type FriendshipView, type FriendsTab, type SocialCapabilities,
} from './friendships.ts';
import { ProfileError, type OwnProfile } from './profile.ts';

type ListStatus = 'idle' | 'loading' | 'ready' | 'guest' | 'prerequisite' | 'unavailable' | 'error';
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'guest' | 'unavailable' | 'error';
type Command = {
  packet: FriendshipPacket;
  status: 'sending' | 'unknown';
};

export type FriendshipsSnapshot = {
  actor: Actor | null;
  foreground: boolean;
  episode: number;
  listActive: boolean;
  tab: FriendsTab;
  cursor: string | null;
  page: FriendshipList | null;
  listStatus: ListStatus;
  capabilities: SocialCapabilities | null;
  profilePeerId: string | null;
  profileView: FriendshipView | null;
  profileStatus: ProfileStatus;
  command: Command | null;
  notice: string | null;
  /** Unresolved post-unlock warning; blocks new actions until explicit ack. */
  outstandingWarning: string | null;
};

export type FriendshipsPort = {
  capabilities: (actor: Actor) => Promise<unknown>;
  list: (tab: FriendsTab, cursor: string | null, actor: Actor) => Promise<unknown>;
  states: (peerId: string, actor: Actor) => Promise<unknown>;
  ownProfile: (actor: Actor) => Promise<OwnProfile>;
  send: (packet: FriendshipPacket, permit: () => boolean) => Promise<unknown>;
  random: () => string;
};

const empty = (actor: Actor | null, episode: number, foreground = true): FriendshipsSnapshot => ({
  actor, foreground, episode, listActive: false, tab: 'accepted', cursor: null, page: null,
  listStatus: 'idle', capabilities: null, profilePeerId: null, profileView: null,
  profileStatus: 'idle', command: null, notice: null, outstandingWarning: null,
});

/** Root owner outlives Friends route and profile card. Commands never auto-dispatch. */
export class FriendshipsCoordinator {
  private state: FriendshipsSnapshot = empty(null, 0);
  private listeners = new Set<() => void>();
  private sequence = 0;
  private authority = 0;
  /** Same-actor verified reauth may restore; other account / forget wipe. Never auto-dispatch. */
  private quarantine: {
    actorId: string;
    command: Command | null;
    outstandingWarning: string | null;
  } | null = null;
  private port: FriendshipsPort;

  constructor(port: FriendshipsPort) { this.port = port; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(p: Partial<FriendshipsSnapshot>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach(fn => fn());
  }

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || !actor && !this.state.actor) return;
    // Park pending/UNKNOWN + outstanding warning under last verified owner; null gap retains quarantine.
    if (this.state.actor) {
      this.quarantine = (this.state.command || this.state.outstandingWarning)
        ? {
          actorId: this.state.actor.actorId,
          command: this.state.command,
          outstandingWarning: this.state.outstandingWarning,
        }
        : null;
    }
    if (actor && this.quarantine?.actorId !== actor.actorId) this.quarantine = null;
    const saved = actor ? this.quarantine : null;
    if (actor) this.quarantine = null;
    this.authority++;
    this.sequence++;
    const next = empty(actor ? { ...actor } : null, this.state.episode + 1, this.state.foreground);
    if (!actor || (!saved?.command && !saved?.outstandingWarning)) {
      this.show(next);
      return;
    }
    if (!saved.command) {
      // Distinct outstanding unlock warning only — never invents noncommit; no auto-send.
      this.show({
        ...next,
        outstandingWarning: saved.outstandingWarning,
        notice: saved.outstandingWarning,
      });
      return;
    }
    // Rebind session/generation only; preserve original key/body/path/ids. No auto-send / no resend.
    const restored = Object.freeze({
      ...saved.command.packet,
      actor: Object.freeze({ ...actor }),
    }) as FriendshipPacket;
    const command: Command = { packet: restored, status: 'unknown' };
    this.show({
      ...next,
      command,
      outstandingWarning: saved.outstandingWarning,
      notice: FRIENDSHIP_UNKNOWN_NOTICE,
    });
  }

  /** Explicit logout wipes parked UNKNOWN and private command state before fencing auth. */
  forget = () => {
    this.quarantine = null;
    this.authority++;
    this.sequence++;
    this.show(empty(null, this.state.episode + 1, this.state.foreground));
  };

  /**
   * Explicit local unlock of held UNKNOWN — outcome stays unknown;
   * never invents noncommit. Outstanding warning blocks new actions until ack.
   * Never same-key resend.
   */
  unlockUnknown = () => {
    const c = this.state.command;
    if (!c || c.status !== 'unknown') return;
    this.quarantine = null;
    this.authority++;
    this.sequence++;
    this.show({
      command: null,
      episode: this.state.episode + 1,
      page: null,
      profileView: null,
      listStatus: this.state.listActive ? 'loading' : this.state.listStatus,
      profileStatus: this.state.profilePeerId ? 'loading' : this.state.profileStatus,
      outstandingWarning: FRIENDSHIP_RETIREMENT_WARNING,
      notice: FRIENDSHIP_RETIREMENT_WARNING,
    });
  };

  /** Explicit acknowledgement of post-unlock warning — required before any new action. */
  acknowledgeOutstandingWarning = () => {
    const warning = this.state.outstandingWarning;
    if (!warning) return;
    this.show({
      outstandingWarning: null,
      notice: this.state.notice === warning ? null : this.state.notice,
    });
  };

  private surfaceNotice(): string | null {
    if (this.state.command?.status === 'unknown') return FRIENDSHIP_UNKNOWN_NOTICE;
    return this.state.outstandingWarning;
  }

  setForeground = (foreground: boolean) => {
    if (foreground === this.state.foreground) return;
    this.sequence++;
    this.show({
      foreground, episode: this.state.episode + 1,
      page: null, listStatus: this.state.listActive ? 'loading' : 'idle',
      capabilities: null, profileView: null,
      profileStatus: this.state.profilePeerId ? 'loading' : 'idle',
      notice: this.surfaceNotice(),
      ...(this.state.command ? { command: { packet: this.state.command.packet, status: 'unknown' } } : {}),
    });
  };

  invalidate = () => {
    this.authority++;
    this.sequence++;
    this.show({
      episode: this.state.episode + 1, page: null, capabilities: null, profileView: null,
      listStatus: this.state.listActive ? 'loading' : 'idle',
      profileStatus: this.state.profilePeerId ? 'loading' : 'idle',
      notice: 'Доступность изменилась. Проверьте снова.',
    });
  };

  enterList = () => {
    this.sequence++;
    this.show({
      listActive: true, episode: this.state.episode + 1, tab: 'accepted', cursor: null,
      page: null, listStatus: 'loading', capabilities: null,
      notice: this.surfaceNotice(),
      ...(this.state.command ? { command: { packet: this.state.command.packet, status: 'unknown' } } : {}),
    });
  };

  exitList = () => {
    this.sequence++;
    this.show({
      listActive: false, episode: this.state.episode + 1, page: null, cursor: null,
      listStatus: 'idle', capabilities: null,
      notice: this.surfaceNotice(),
      ...(this.state.command ? { command: { packet: this.state.command.packet, status: 'unknown' } } : {}),
    });
  };

  setTab = (tab: FriendsTab) => {
    if (!this.state.listActive || !FRIENDS_TABS.some(([value]) => value === tab) || tab === this.state.tab) return;
    this.sequence++;
    this.show({
      tab, cursor: null, page: null, listStatus: 'loading', episode: this.state.episode + 1,
      notice: this.state.outstandingWarning,
    });
  };

  nextPage = () => {
    if (!this.state.listActive || this.state.listStatus !== 'ready' || !this.state.page?.nextCursor) return;
    this.sequence++;
    this.show({
      cursor: this.state.page.nextCursor, page: null, listStatus: 'loading',
      episode: this.state.episode + 1, notice: this.state.outstandingWarning,
    });
  };

  refreshList = () => {
    if (!this.state.listActive) return;
    this.sequence++;
    this.show({
      cursor: null, page: null, listStatus: 'loading', capabilities: null,
      episode: this.state.episode + 1, notice: this.state.outstandingWarning,
    });
  };

  openProfile = (peerId: string) => {
    try { publicPlayerId(peerId); } catch { return; }
    this.sequence++;
    this.show({
      profilePeerId: peerId, profileView: null, profileStatus: 'loading',
      episode: this.state.episode + 1,
      notice: this.surfaceNotice(),
      ...(this.state.command ? { command: { packet: this.state.command.packet, status: 'unknown' } } : {}),
    });
  };

  closeProfile = () => {
    this.sequence++;
    this.show({
      profilePeerId: null, profileView: null, profileStatus: 'idle',
      episode: this.state.episode + 1,
      notice: this.surfaceNotice(),
      ...(this.state.command ? { command: { packet: this.state.command.packet, status: 'unknown' } } : {}),
    });
  };

  refreshProfile = () => {
    if (!this.state.profilePeerId) return;
    this.sequence++;
    this.show({
      profileView: null, profileStatus: 'loading', episode: this.state.episode + 1,
      notice: this.state.outstandingWarning,
    });
  };

  /**
   * Explicit READ-ONLY refresh of the current relationship while UNKNOWN is held.
   * GET only — never POSTs, never settles UNKNOWN, never invents commit/noncommit.
   */
  refreshUnknownRelationship = () => {
    const c = this.state.command;
    if (!c || c.status !== 'unknown' || !sameActor(c.packet.actor, this.state.actor) || !this.state.foreground) {
      return;
    }
    if (!this.commandSurfaceLive(c.packet)) return;
    const packet = c.packet;
    if (packet.peerLease !== null) {
      if (this.state.profilePeerId !== packet.peerLease) return;
      this.sequence++;
      this.show({
        profileView: null,
        profileStatus: 'loading',
        episode: this.state.episode + 1,
        command: { packet, status: 'unknown' },
        notice: FRIENDSHIP_UNKNOWN_NOTICE,
      });
      return;
    }
    if (!this.state.listActive) return;
    this.sequence++;
    this.show({
      cursor: null,
      page: null,
      listStatus: 'loading',
      capabilities: null,
      episode: this.state.episode + 1,
      command: { packet, status: 'unknown' },
      notice: FRIENDSHIP_UNKNOWN_NOTICE,
    });
  };

  loadList = async () => {
    const actor = this.state.actor, episode = this.state.episode, sequence = ++this.sequence;
    const tab = this.state.tab, cursor = this.state.cursor;
    if (!this.state.listActive || !this.state.foreground) return;
    if (!actor) { this.show({ listStatus: 'guest', page: null, capabilities: null }); return; }
    // Reads never settle UNKNOWN; keep honest hold notice or unresolved unlock warning.
    const retained = this.state.command?.status === 'unknown'
      ? FRIENDSHIP_UNKNOWN_NOTICE
      : (this.state.outstandingWarning ?? null);
    this.show({ listStatus: 'loading', page: null, notice: retained });
    try {
      const capabilities = parseSocialCapabilities(await this.port.capabilities(actor));
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
      if (!capabilities.friends) {
        // Do not fetch private friend lists while capability is denied.
        const profile = await this.port.ownProfile(actor);
        if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
        this.show({
          capabilities, page: null,
          listStatus: ownFriendsPrerequisite(profile) ? 'prerequisite' : 'unavailable',
          ...(retained ? { notice: retained } : {}),
        });
        return;
      }
      friendshipsListPath(tab, cursor);
      const page = parseFriendshipList(await this.port.list(tab, cursor, actor));
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
      if (this.state.tab !== tab || this.state.cursor !== cursor) return;
      this.show({
        capabilities, page, listStatus: 'ready',
        ...(retained ? { notice: retained } : {}),
      });
    } catch (error) {
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor)) return;
      if (error instanceof FriendshipError && error.kind === 'authority'
        || error instanceof NativeAuthError && error.kind === 'authority') {
        this.show({ listStatus: 'guest', page: null, capabilities: null });
        return;
      }
      const unavailable = error instanceof FriendshipError && error.kind === 'refused'
        && [403, 404, 503].includes(error.status);
      this.show({
        listStatus: unavailable ? 'unavailable' : 'error', page: null,
        notice: retained ?? (unavailable || error instanceof ProfileError ? null : 'Не удалось загрузить друзей'),
      });
    }
  };

  loadProfile = async () => {
    const actor = this.state.actor, episode = this.state.episode, sequence = ++this.sequence;
    const peerId = this.state.profilePeerId;
    if (!peerId || !this.state.foreground) return;
    if (!actor) { this.show({ profileStatus: 'guest', profileView: null }); return; }
    const retained = this.state.command?.status === 'unknown'
      ? FRIENDSHIP_UNKNOWN_NOTICE
      : (this.state.outstandingWarning ?? null);
    this.show({ profileStatus: 'loading', profileView: null, notice: retained });
    try {
      const capabilities = parseSocialCapabilities(await this.port.capabilities(actor));
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
      if (this.state.profilePeerId !== peerId) return;
      if (!capabilities.friends) {
        this.show({
          capabilities, profileStatus: 'unavailable', profileView: null,
          ...(retained ? { notice: retained } : {}),
        });
        return;
      }
      friendshipStatesPath(peerId);
      const view = parseFriendshipStates(await this.port.states(peerId, actor), peerId);
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
      if (this.state.profilePeerId !== peerId) return;
      this.show({
        capabilities, profileView: view, profileStatus: 'ready',
        ...(retained ? { notice: retained } : {}),
      });
    } catch (error) {
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor)) return;
      if (error instanceof FriendshipError && error.kind === 'authority'
        || error instanceof NativeAuthError && error.kind === 'authority') {
        this.show({ profileStatus: 'guest', profileView: null });
        return;
      }
      const unavailable = error instanceof FriendshipError && error.kind === 'refused'
        && [403, 404, 503].includes(error.status);
      this.show({
        profileStatus: unavailable ? 'unavailable' : 'error', profileView: null,
        ...(retained ? { notice: retained } : {}),
      });
    }
  };

  act = async (
    action: FriendAction,
    view: FriendshipView,
    peerId: string | undefined,
    listLease: number,
    peerLease: string | null,
  ) => {
    const s = this.state;
    if (!s.actor || !s.foreground || s.command || s.outstandingWarning || listLease !== s.episode) return;
    if (peerLease !== null && peerLease !== s.profilePeerId) return;
    const wire = friendCommand(view, peerId, action);
    if (!wire) return;
    const packet = Object.freeze({
      actor: Object.freeze({ ...s.actor }),
      action,
      target: action === 'request' ? peerId ?? null : peerId ?? view.peer?.publicPlayerId ?? null,
      requestId: action === 'remove' || action === 'request' ? null : view.request?.id ?? null,
      friendshipId: action === 'remove' ? view.friendshipId : null,
      key: this.port.random(),
      path: wire.path,
      body: Object.freeze({ ...wire.body }),
      viewLease: s.episode,
      listLease,
      peerLease,
    }) as FriendshipPacket;
    const command: Command = { packet, status: 'sending' };
    this.show({ command, notice: null });
    await this.dispatch(command);
  };

  /**
   * True when the frozen command still names the relation on the current surface (if loaded).
   * Used by UI to decide in-row vs orphan hold — omission never settles UNKNOWN.
   */
  commandMatchesSurface(packet: FriendshipPacket): boolean {
    if (packet.peerLease !== null) {
      if (this.state.profilePeerId !== packet.peerLease) return false;
      if (this.state.profileStatus !== 'ready' || !this.state.profileView) return false;
      const view = this.state.profileView;
      if (packet.action === 'remove') return packet.friendshipId === view.friendshipId;
      if (packet.action === 'request') {
        return packet.target === (packet.peerLease ?? view.peer?.publicPlayerId ?? null);
      }
      return packet.requestId === (view.request?.id ?? null);
    }
    if (!this.state.listActive || this.state.listStatus !== 'ready' || !this.state.page) return false;
    return this.state.page.items.some(view => {
      if (packet.action === 'remove') return packet.friendshipId === view.friendshipId;
      if (packet.action === 'request') {
        return packet.target === (view.peer?.publicPlayerId ?? null);
      }
      return packet.requestId === (view.request?.id ?? null);
    });
  }

  /** Owning list/profile surface is current — row presence is not required for explicit refresh. */
  private commandSurfaceLive(packet: FriendshipPacket): boolean {
    if (packet.peerLease !== null) return this.state.profilePeerId === packet.peerLease;
    return this.state.listActive;
  }

  private holdUnknown(packet: FriendshipPacket) {
    this.show({
      command: { packet, status: 'unknown' },
      notice: FRIENDSHIP_UNKNOWN_NOTICE,
    });
  }

  private async dispatch(command: Command) {
    const packet = command.packet;
    const authority = this.authority;
    const activeLease = packet.viewLease;
    this.show({ command: { packet, status: 'sending' }, notice: null });
    const surfaceOk = () => sameActor(packet.actor, this.state.actor) && this.state.command?.packet === packet
      && activeLease === this.state.episode
      && (packet.peerLease === null || packet.peerLease === this.state.profilePeerId)
      && (packet.peerLease !== null || this.state.listActive)
      && this.state.foreground;
    const valid = () => surfaceOk() && authority === this.authority;
    const holdIfStillOwner = () => {
      if (!sameActor(packet.actor, this.state.actor) || this.state.command?.packet !== packet) return;
      this.holdUnknown(packet);
    };
    try {
      const receipt = parseFriendshipReceipt(
        await this.port.send(packet, () => valid()),
        packet.action,
      );
      if (!valid()) {
        // Late receipt after authority/surface retire must not settle or invent noncommit.
        holdIfStillOwner();
        return;
      }
      // Receipt identity must match the frozen packet target/request/friendship ids.
      if (packet.action === 'remove' && packet.friendshipId && receipt.friendshipId !== packet.friendshipId
        || packet.requestId && receipt.requestId !== packet.requestId) {
        this.holdUnknown(packet);
        return;
      }
      this.show({
        command: null,
        page: null,
        profileView: null,
        listStatus: this.state.listActive ? 'loading' : this.state.listStatus,
        profileStatus: this.state.profilePeerId ? 'loading' : this.state.profileStatus,
        notice: packet.action === 'request' ? 'Запрос отправлен.'
          : packet.action === 'accept' ? 'Запрос принят.'
            : packet.action === 'decline' ? 'Запрос отклонён.'
              : packet.action === 'cancel' ? 'Запрос отменён.'
                : 'Игрок удалён из друзей.',
      });
      return receipt;
    } catch (error) {
      if (!valid()) {
        holdIfStillOwner();
        return;
      }
      const refusal = error instanceof FriendshipError && error.kind === 'refused'
        && !['KEY_REUSED', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code);
      this.show({
        command: refusal ? null : { packet, status: 'unknown' },
        page: null,
        profileView: null,
        listStatus: this.state.listActive ? 'loading' : this.state.listStatus,
        profileStatus: this.state.profilePeerId ? 'loading' : this.state.profileStatus,
        notice: refusal
          ? 'Действие недоступно. Проверьте условия снова.'
          : FRIENDSHIP_UNKNOWN_NOTICE,
      });
    }
  }
}
