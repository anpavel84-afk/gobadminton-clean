import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import { NativeAuthError } from './native-auth-protocol.ts';
import {
  FRIENDS_TABS, FriendshipError, friendCommand, friendshipStatesPath, friendshipsListPath,
  ownFriendsPrerequisite, parseFriendshipList, parseFriendshipReceipt, parseFriendshipStates,
  parseSocialCapabilities, publicPlayerId, type FriendAction, type FriendshipList,
  type FriendshipPacket, type FriendshipView, type FriendsTab, type SocialCapabilities,
} from './friendships.ts';
import { ProfileError, type OwnProfile } from './profile.ts';

type ListStatus = 'idle' | 'loading' | 'ready' | 'guest' | 'prerequisite' | 'unavailable' | 'error';
type ProfileStatus = 'idle' | 'loading' | 'ready' | 'guest' | 'unavailable' | 'error';
type Command = { packet: FriendshipPacket; status: 'sending' | 'unknown' };

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
};

export type FriendshipsPort = {
  capabilities: (actor: Actor) => Promise<unknown>;
  list: (tab: FriendsTab, cursor: string | null, actor: Actor) => Promise<unknown>;
  states: (peerId: string, actor: Actor) => Promise<unknown>;
  ownProfile: (actor: Actor) => Promise<OwnProfile>;
  send: (packet: FriendshipPacket, permit: () => boolean) => Promise<unknown>;
  random: () => string;
};

const unknownNotice = 'Результат неизвестен. Сохранён исходный запрос; проверьте результат явно.';
const empty = (actor: Actor | null, episode: number, foreground = true): FriendshipsSnapshot => ({
  actor, foreground, episode, listActive: false, tab: 'accepted', cursor: null, page: null,
  listStatus: 'idle', capabilities: null, profilePeerId: null, profileView: null,
  profileStatus: 'idle', command: null, notice: null,
});

/** Root owner outlives Friends route and profile card. Commands never auto-dispatch. */
export class FriendshipsCoordinator {
  private state: FriendshipsSnapshot = empty(null, 0);
  private listeners = new Set<() => void>();
  private sequence = 0;
  private authority = 0;
  private quarantine: Command[] = [];
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
    if (this.state.command) this.quarantine.push(this.state.command);
    this.authority++;
    this.sequence++;
    this.show({
      ...empty(actor ? { ...actor } : null, this.state.episode + 1, this.state.foreground),
      command: null, notice: null,
    });
  }

  setForeground = (foreground: boolean) => {
    if (foreground === this.state.foreground) return;
    this.sequence++;
    this.show({
      foreground, episode: this.state.episode + 1,
      page: null, listStatus: this.state.listActive ? 'loading' : 'idle',
      capabilities: null, profileView: null,
      profileStatus: this.state.profilePeerId ? 'loading' : 'idle',
      notice: this.state.command ? unknownNotice : null,
      ...(this.state.command ? { command: { ...this.state.command, status: 'unknown' as const } } : {}),
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
      page: null, listStatus: 'loading', capabilities: null, notice: null,
    });
  };

  exitList = () => {
    this.sequence++;
    this.show({
      listActive: false, episode: this.state.episode + 1, page: null, cursor: null,
      listStatus: 'idle', capabilities: null,
      notice: this.state.command ? unknownNotice : null,
      ...(this.state.command ? { command: { ...this.state.command, status: 'unknown' as const } } : {}),
    });
  };

  setTab = (tab: FriendsTab) => {
    if (!this.state.listActive || !FRIENDS_TABS.some(([value]) => value === tab) || tab === this.state.tab) return;
    this.sequence++;
    this.show({
      tab, cursor: null, page: null, listStatus: 'loading', episode: this.state.episode + 1, notice: null,
    });
  };

  nextPage = () => {
    if (!this.state.listActive || this.state.listStatus !== 'ready' || !this.state.page?.nextCursor) return;
    this.sequence++;
    this.show({
      cursor: this.state.page.nextCursor, page: null, listStatus: 'loading',
      episode: this.state.episode + 1, notice: null,
    });
  };

  refreshList = () => {
    if (!this.state.listActive) return;
    this.sequence++;
    this.show({
      cursor: null, page: null, listStatus: 'loading', capabilities: null,
      episode: this.state.episode + 1, notice: null,
    });
  };

  openProfile = (peerId: string) => {
    try { publicPlayerId(peerId); } catch { return; }
    this.sequence++;
    this.show({
      profilePeerId: peerId, profileView: null, profileStatus: 'loading',
      episode: this.state.episode + 1, notice: null,
    });
  };

  closeProfile = () => {
    this.sequence++;
    this.show({
      profilePeerId: null, profileView: null, profileStatus: 'idle',
      episode: this.state.episode + 1,
      notice: this.state.command ? unknownNotice : null,
      ...(this.state.command ? { command: { ...this.state.command, status: 'unknown' as const } } : {}),
    });
  };

  refreshProfile = () => {
    if (!this.state.profilePeerId) return;
    this.sequence++;
    this.show({
      profileView: null, profileStatus: 'loading', episode: this.state.episode + 1, notice: null,
    });
  };

  loadList = async () => {
    const actor = this.state.actor, episode = this.state.episode, sequence = ++this.sequence;
    const tab = this.state.tab, cursor = this.state.cursor;
    if (!this.state.listActive || !this.state.foreground) return;
    if (!actor) { this.show({ listStatus: 'guest', page: null, capabilities: null }); return; }
    this.show({ listStatus: 'loading', page: null, notice: null });
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
        });
        return;
      }
      friendshipsListPath(tab, cursor);
      const page = parseFriendshipList(await this.port.list(tab, cursor, actor));
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
      if (this.state.tab !== tab || this.state.cursor !== cursor) return;
      this.show({ capabilities, page, listStatus: 'ready' });
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
        notice: unavailable || error instanceof ProfileError ? null : 'Не удалось загрузить друзей',
      });
    }
  };

  loadProfile = async () => {
    const actor = this.state.actor, episode = this.state.episode, sequence = ++this.sequence;
    const peerId = this.state.profilePeerId;
    if (!peerId || !this.state.foreground) return;
    if (!actor) { this.show({ profileStatus: 'guest', profileView: null }); return; }
    this.show({ profileStatus: 'loading', profileView: null, notice: null });
    try {
      const capabilities = parseSocialCapabilities(await this.port.capabilities(actor));
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
      if (this.state.profilePeerId !== peerId) return;
      if (!capabilities.friends) {
        this.show({ capabilities, profileStatus: 'unavailable', profileView: null });
        return;
      }
      friendshipStatesPath(peerId);
      const view = parseFriendshipStates(await this.port.states(peerId, actor), peerId);
      if (sequence !== this.sequence || !sameActor(actor, this.state.actor) || episode !== this.state.episode) return;
      if (this.state.profilePeerId !== peerId) return;
      this.show({ capabilities, profileView: view, profileStatus: 'ready' });
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
    if (!s.actor || !s.foreground || s.command || listLease !== s.episode) return;
    if (peerLease !== null && peerLease !== s.profilePeerId) return;
    if (this.quarantine.some(c => c.packet.actor.actorId === s.actor!.actorId)) {
      this.show({ notice: 'Предыдущий запрос сохранён в прежнем сеансе с неизвестным результатом. Новый запрос не отправлен.' });
      return;
    }
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

  /** True when the frozen command still names the relation on the current surface (if loaded). */
  private commandVisible(packet: FriendshipPacket): boolean {
    if (packet.peerLease !== null) {
      if (this.state.profilePeerId !== packet.peerLease) return false;
      if (this.state.profileStatus !== 'ready' || !this.state.profileView) return true;
      const view = this.state.profileView;
      if (packet.action === 'remove') return packet.friendshipId === view.friendshipId;
      if (packet.action === 'request') {
        return packet.target === (packet.peerLease ?? view.peer?.publicPlayerId ?? null);
      }
      return packet.requestId === (view.request?.id ?? null);
    }
    if (!this.state.listActive) return false;
    if (this.state.listStatus !== 'ready' || !this.state.page) return true;
    return this.state.page.items.some(view => {
      if (packet.action === 'remove') return packet.friendshipId === view.friendshipId;
      if (packet.action === 'request') {
        return packet.target === (view.peer?.publicPlayerId ?? null);
      }
      return packet.requestId === (view.request?.id ?? null);
    });
  }

  reconcile = async (renderedLease = this.state.episode) => {
    const c = this.state.command;
    if (!c || c.status !== 'unknown' || !sameActor(c.packet.actor, this.state.actor) || !this.state.foreground) return;
    // Stale UI lease after another remount must not recover.
    if (renderedLease !== this.state.episode) return;
    const packet = c.packet;
    // Same actor + same selected target surface; keep UNKNOWN if relation left the current view.
    if (!this.commandVisible(packet)) return;
    // Fresh recovery lease for permit only — never mutate original key/body/id/version/viewLease.
    await this.dispatch(c, renderedLease);
  };

  private async dispatch(command: Command, recoveryLease?: number) {
    const packet = command.packet;
    const authority = this.authority;
    // Initial send binds packet.viewLease; explicit recovery supplies a separate current lease.
    const activeLease = recoveryLease ?? packet.viewLease;
    this.show({ command: { ...command, status: 'sending' }, notice: null });
    const valid = () => sameActor(packet.actor, this.state.actor) && this.state.command?.packet === packet
      && activeLease === this.state.episode
      && (packet.peerLease === null || packet.peerLease === this.state.profilePeerId)
      && (packet.peerLease !== null || this.state.listActive || recoveryLease === undefined)
      && this.state.foreground;
    try {
      const receipt = parseFriendshipReceipt(
        await this.port.send(packet, () => valid() && authority === this.authority),
        packet.action,
      );
      if (!valid()) {
        this.quarantine = this.quarantine.filter(c => c.packet !== packet);
        return;
      }
      // Receipt identity must match the frozen packet target/request/friendship ids.
      if (packet.action === 'remove' && packet.friendshipId && receipt.friendshipId !== packet.friendshipId
        || packet.requestId && receipt.requestId !== packet.requestId) {
        this.show({ command: { ...command, status: 'unknown' }, notice: unknownNotice });
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
      if (!valid()) return;
      const refusal = error instanceof FriendshipError && error.kind === 'refused'
        && !['KEY_REUSED', 'IDEMPOTENCY_KEY_REUSED'].includes(error.code);
      this.show({
        command: refusal ? null : { ...command, status: 'unknown' },
        page: null,
        profileView: null,
        listStatus: this.state.listActive ? 'loading' : this.state.listStatus,
        profileStatus: this.state.profilePeerId ? 'loading' : this.state.profileStatus,
        notice: refusal
          ? 'Действие недоступно. Проверьте условия снова.'
          : unknownNotice,
      });
    }
  }
}
