import {
  dominantParticipation, ParticipationError, sameActor,
  type Actor, type CursorPage, type ManagedGame,
} from './participation.ts';
import { MessagesError, type GameChat } from './messages.ts';
import type { Participation } from '@gobadminton/contracts/game-types';

/** Accepted-web GameDetailPage: confirmed only — pending/terminal are not private-surface membership. */
export function isConfirmedChatMember(own: Participation | null | undefined): boolean {
  return own?.status === 'confirmed';
}

/** Accepted-web chat window: published and not yet ended. */
export function isChatWindowOpen(
  game: Readonly<{ status: string; endsAt: string }>,
  now = Date.now(),
): boolean {
  if (game.status !== 'published') return false;
  const ends = Date.parse(game.endsAt);
  return Number.isFinite(ends) && ends > now;
}

export type GameChatWindow = Readonly<{ status: string; endsAt: string }>;

export type GameChatEntryFocus = Readonly<{
  gameId: string;
  viewGen: number;
  window: GameChatWindow;
}>;

/** Immutable actor/game/view/foreground fence captured at render for navigate/retry. */
export type GameChatEntryRenderedPermit = Readonly<{
  actor: Readonly<Actor>;
  gameId: string;
  viewGen: number;
  foregroundGen: number;
}>;

export type GameChatEntryPort = {
  /** Participation rows when detail settled; null = not ready (no speculative GET). */
  detailParts: (gameId: string) => Participation[] | null;
  managed: (cursor: string | undefined, permit: () => boolean) => Promise<CursorPage<ManagedGame>>;
  /** Probe chat header only — never messages, members, or receipts. */
  readChat: (gameId: string, permit: () => boolean) => Promise<GameChat>;
};

export type GameChatEntrySnapshot = {
  actor: Actor | null;
  focus: GameChatEntryFocus | null;
  foreground: boolean;
  foregroundGen: number;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied' | 'closed';
  /** True only when header lifecycleState === active for the focused game. */
  available: boolean;
  notice: string | null;
};

const initial = (actor: Actor | null = null): GameChatEntrySnapshot => ({
  actor,
  focus: null,
  foreground: true,
  foregroundGen: 0,
  status: 'idle',
  available: false,
  notice: null,
});

/**
 * Root-owned game-detail chat entry. Eligibility before private chat GET;
 * availability is actor/session/view/foreground scoped; never focuses Messages.
 */
export class GameChatEntryCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private readSerial = 0;
  private viewSerial = 0;
  private port: GameChatEntryPort;

  constructor(port: GameChatEntryPort) {
    this.port = port;
  }

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private show(patch: Partial<GameChatEntrySnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  private current(actor: Actor | null) {
    return sameActor(actor, this.state.actor);
  }

  private permitLive(permit: GameChatEntryRenderedPermit) {
    return this.current(permit.actor)
      && this.state.foreground
      && this.state.focus?.gameId === permit.gameId
      && this.state.focus?.viewGen === permit.viewGen
      && this.state.foregroundGen === permit.foregroundGen;
  }

  /** Capture rendered fence for navigate / retry — retired callback cannot navigate. */
  renderedPermit = (): GameChatEntryRenderedPermit | null => {
    const { actor, focus, foreground, foregroundGen } = this.state;
    if (!actor || !focus || !foreground) return null;
    return Object.freeze({
      actor: Object.freeze({ ...actor }),
      gameId: focus.gameId,
      viewGen: focus.viewGen,
      foregroundGen,
    });
  };

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || !actor && !this.state.actor) return;
    this.readSerial++;
    this.viewSerial++;
    const foreground = this.state.foreground;
    const foregroundGen = this.state.foregroundGen + 1;
    this.state = {
      ...initial(actor ? Object.freeze({ ...actor }) : null),
      foreground,
      foregroundGen,
    };
    this.show({});
  }

  forget = () => {
    this.readSerial++;
    this.viewSerial++;
    this.state = initial();
    this.show({});
  };

  /**
   * App foreground fence. Background clears private availability; return reloads when focused.
   */
  setForeground = (active: boolean) => {
    if (active === this.state.foreground) return;
    this.readSerial++;
    const foregroundGen = this.state.foregroundGen + 1;
    if (!active) {
      this.show({
        foreground: false,
        foregroundGen,
        status: 'idle',
        available: false,
        notice: null,
      });
      return;
    }
    this.show({
      foreground: true,
      foregroundGen,
      status: 'idle',
      available: false,
      notice: null,
    });
    if (this.state.focus) void this.load();
  };

  /**
   * Bind panel to a game + displayed window. Release retires only this viewGen.
   */
  focus = (gameId: string, window: GameChatWindow): (() => void) => {
    const noop = () => {};
    if (!this.state.actor || !gameId) return noop;
    const viewGen = ++this.viewSerial;
    this.readSerial++;
    const focus: GameChatEntryFocus = Object.freeze({
      gameId,
      viewGen,
      window: Object.freeze({ status: window.status, endsAt: window.endsAt }),
    });
    this.show({
      focus,
      status: 'idle',
      available: false,
      notice: null,
    });
    return () => this.releaseFocus(viewGen);
  };

  /** Keep endsAt/status current without bumping viewGen when the same game stays focused. */
  updateWindow = (gameId: string, window: GameChatWindow) => {
    const focus = this.state.focus;
    if (!focus || focus.gameId !== gameId) return;
    if (focus.window.status === window.status && focus.window.endsAt === window.endsAt) return;
    this.show({
      focus: Object.freeze({
        ...focus,
        window: Object.freeze({ status: window.status, endsAt: window.endsAt }),
      }),
    });
  };

  releaseFocus = (viewGen: number) => {
    if (!this.state.focus || this.state.focus.viewGen !== viewGen) return;
    this.readSerial++;
    this.show({
      focus: null,
      status: 'idle',
      available: false,
      notice: null,
    });
  };

  /**
   * Eligibility then private chat-header GET. Failed/unknown eligibility never triggers speculative GET.
   * Guest/denied/closed leave available=false with no stale positive.
   */
  load = async (permit?: GameChatEntryRenderedPermit) => {
    const actor = this.state.actor;
    const focus = this.state.focus;
    if (!actor || !focus || this.state.status === 'loading') return;
    if (!this.state.foreground) return;
    if (permit && !this.permitLive(permit)) return;
    if (permit && (permit.gameId !== focus.gameId || permit.viewGen !== focus.viewGen)) return;
    const readGen = ++this.readSerial;
    const viewGen = focus.viewGen;
    const gameId = focus.gameId;
    const live = () =>
      this.current(actor)
      && this.state.foreground
      && this.state.focus?.viewGen === viewGen
      && readGen === this.readSerial;
    this.show({ status: 'loading', available: false, notice: null });
    try {
      const eligible = await this.resolveEligible(gameId, live);
      if (!live()) return;
      if (eligible === 'pending') {
        this.show({ status: 'idle', available: false, notice: null });
        return;
      }
      if (eligible === 'failed') {
        this.show({
          status: 'error',
          available: false,
          notice: 'Не удалось проверить доступ к чату игры.',
        });
        return;
      }
      if (!eligible) {
        this.show({ status: 'denied', available: false, notice: null });
        return;
      }
      const window = this.state.focus?.window;
      if (!window || !isChatWindowOpen(window)) {
        this.show({ status: 'closed', available: false, notice: null });
        return;
      }
      const chat = await this.port.readChat(gameId, live);
      if (!live()) return;
      if (chat.gameId !== gameId) {
        this.show({ status: 'denied', available: false, notice: null });
        return;
      }
      if (chat.lifecycleState !== 'active') {
        this.show({ status: 'closed', available: false, notice: null });
        return;
      }
      this.show({ status: 'ready', available: true, notice: null });
    } catch (error) {
      if (!live()) return;
      if (
        (error instanceof ParticipationError && error.kind === 'business' && (error.status === 404 || error.status === 401))
        || (error instanceof MessagesError && (error.kind === 'private' || error.status === 404 || error.status === 401))
      ) {
        this.show({ status: 'denied', available: false, notice: null });
        return;
      }
      if (error instanceof ParticipationError && error.kind === 'stale') return;
      if (error instanceof MessagesError && error.kind === 'stale') return;
      this.show({
        status: 'error',
        available: false,
        notice: 'Не удалось проверить чат игры. Попробуйте ещё раз.',
      });
    }
  };

  /**
   * Press-time fence: live permit + still-available + chat window open now.
   * Destination refetch remains authoritative for membership/ended races.
   */
  mayNavigate = (permit: GameChatEntryRenderedPermit, now = Date.now()): boolean => {
    if (!this.permitLive(permit)) return false;
    if (!this.state.available || this.state.status !== 'ready') return false;
    const focus = this.state.focus;
    if (!focus || focus.gameId !== permit.gameId) return false;
    return isChatWindowOpen(focus.window, now);
  };

  private async resolveEligible(
    gameId: string,
    permit: () => boolean,
  ): Promise<boolean | 'failed' | 'pending'> {
    const parts = this.port.detailParts(gameId);
    if (parts === null) return 'pending';
    const own = dominantParticipation(parts);
    if (isConfirmedChatMember(own)) return true;
    try {
      let cursor: string | undefined;
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      for (;;) {
        const cursorKey = cursor ?? '';
        if (seenCursors.has(cursorKey)) return 'failed';
        seenCursors.add(cursorKey);
        if (!permit()) throw new ParticipationError('stale');
        const page = await this.port.managed(cursor, permit);
        if (!permit()) throw new ParticipationError('stale');
        if (page.items.some(g => g.id === gameId)) return true;
        for (const item of page.items) {
          if (seenIds.has(item.id)) return 'failed';
          seenIds.add(item.id);
        }
        if (!page.nextCursor) return false;
        cursor = page.nextCursor;
      }
    } catch (error) {
      if (error instanceof ParticipationError && error.kind === 'stale') throw error;
      return 'failed';
    }
  }
}
