import type { Game } from '@gobadminton/contracts/game-types';
import { ParticipationError, sameActor, type Actor, type ManagedGame } from './participation.ts';
import { parseInvitation, type GameInvitation } from './messages.ts';

/** Instant fields the invitation chooser shares with server publish/start/deadline gates. */
export type InvitationEligibilityGame = {
  status: string;
  startsAt: string;
  applicationDeadlineAt: string;
};

/**
 * Managed game may be offered for a new invitation only while published, with
 * parseable instants, a strictly future startsAt, and a deadline that has not
 * passed (aligned with invitations.service: now > deadline / now >= start).
 */
export function isGameOpenForInvitation(game: InvitationEligibilityGame, now = Date.now()): boolean {
  return invitationEligibilityBlockReason(game, now) === null;
}

/** Why a game must not be offered or mutated; null means currently open. */
export function invitationEligibilityBlockReason(
  game: InvitationEligibilityGame,
  now = Date.now(),
): 'unpublished' | 'started' | 'deadline' | 'invalid' | null {
  const startsAt = Date.parse(game.startsAt);
  const deadlineAt = Date.parse(game.applicationDeadlineAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(deadlineAt)) return 'invalid';
  if (game.status !== 'published') return 'unpublished';
  if (now >= startsAt) return 'started';
  if (now > deadlineAt) return 'deadline';
  return null;
}

export function invitationEligibilityNotice(
  reason: Exclude<ReturnType<typeof invitationEligibilityBlockReason>, null>,
): string {
  switch (reason) {
    case 'unpublished':
      return 'Игра больше не опубликована. Обновите список.';
    case 'started':
      return 'Игра уже началась. Обновите список.';
    case 'deadline':
      return 'Запись на игру закрыта. Обновите список.';
    case 'invalid':
      return 'У игры некорректные даты. Обновите список.';
  }
}

/** Earliest instant when any currently-open game would stop being invite-eligible. */
export function nextInvitationEligibilityBoundary(
  games: InvitationEligibilityGame[],
  now = Date.now(),
): number | null {
  let next: number | null = null;
  for (const game of games) {
    if (!isGameOpenForInvitation(game, now)) continue;
    const startsAt = Date.parse(game.startsAt);
    const deadlineAt = Date.parse(game.applicationDeadlineAt);
    for (const at of [startsAt, deadlineAt + 1]) {
      if (Number.isFinite(at) && at > now) next = next == null ? at : Math.min(next, at);
    }
  }
  return next;
}

export function inviteWhenLabel(game: Pick<ManagedGame, 'startsAt' | 'timezone'>): string {
  return new Date(game.startsAt).toLocaleString('ru-RU', {
    timeZone: game.timezone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function inviteCalendarParts(game: Pick<ManagedGame, 'startsAt' | 'timezone'>): { day: string; month: string } {
  const at = new Date(game.startsAt);
  return {
    day: at.toLocaleString('ru-RU', { timeZone: game.timezone, day: 'numeric' }),
    month: at.toLocaleString('ru-RU', { timeZone: game.timezone, month: 'short' }),
  };
}

export type InvitationCreateBody = Readonly<{
  inviteePublicPlayerId: string;
  expectedGameVersion: number;
}>;

export type InvitationCreatePacket = Readonly<{
  actor: Readonly<Actor>;
  key: string;
  gameId: string;
  peerId: string;
  conversationId: string;
  surfaceGen: number;
  body: InvitationCreateBody;
}>;

export function invitationCreateWire(body: InvitationCreateBody): Record<string, unknown> {
  return {
    inviteePublicPlayerId: body.inviteePublicPlayerId,
    expectedGameVersion: body.expectedGameVersion,
  };
}

export type InvitationSurface = Readonly<{
  conversationId: string;
  peerId: string;
  surfaceGen: number;
}>;

export type InvitationAuthoringSnapshot = {
  actor: Actor | null;
  surface: InvitationSurface | null;
  listStatus: 'idle' | 'loading' | 'ready' | 'error';
  games: ManagedGame[];
  nextCursor: string | null;
  now: number;
  checking: boolean;
  command?: { packet: InvitationCreatePacket; status: 'sending' | 'unknown' };
  receipt: GameInvitation | null;
  notice: string | null;
};

export type InvitationAuthoringPort = {
  managed: (cursor?: string) => Promise<{ items: ManagedGame[]; nextCursor: string | null }>;
  game: (id: string) => Promise<Game>;
  send: (packet: InvitationCreatePacket, authority: Actor) => Promise<GameInvitation>;
  /** Live safety fence from MessagesCoordinator — blocked peers cannot open/send. */
  isPeerHeld: (peerId: string) => boolean;
};

const unknownNotice =
  'Пока не удалось подтвердить приглашение. Проверка повторит только прежний запрос с тем же ключом и данными. Новые приглашения пока недоступны.';

const initial = (actor: Actor | null = null): InvitationAuthoringSnapshot => ({
  actor,
  surface: null,
  listStatus: 'idle',
  games: [],
  nextCursor: null,
  now: Date.now(),
  checking: false,
  receipt: null,
  notice: null,
});

/**
 * Own DM → choose managed open game → explicit create invitation.
 * Retained under nativeAuth across unmount for UNKNOWN exact retry; never auto-sends.
 */
export class InvitationAuthoringCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private serial = 0;
  private surfaceSerial = 0;
  private quarantine: {
    actorId: string;
    packet?: InvitationCreatePacket;
  } | null = null;
  private port: InvitationAuthoringPort;
  private random: () => string;
  private clock: () => number;

  constructor(port: InvitationAuthoringPort, random: () => string, clock: () => number = Date.now) {
    this.port = port;
    this.random = random;
    this.clock = clock;
  }

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private show(patch: Partial<InvitationAuthoringSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  private current(actor: Actor | null) {
    return sameActor(actor, this.state.actor);
  }
  blocksMutations = () => !!this.state.command || this.state.checking;

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || (!actor && !this.state.actor)) return;
    if (this.state.actor) {
      this.quarantine = {
        actorId: this.state.actor.actorId,
        packet: this.state.command?.packet,
      };
    }
    if (actor && this.quarantine?.actorId !== actor.actorId) this.quarantine = null;
    const saved = actor ? this.quarantine : null;
    if (actor) this.quarantine = null;
    this.serial++;
    this.surfaceSerial++;
    this.state = initial(actor ? Object.freeze({ ...actor }) : null);
    if (saved?.packet && actor) {
      const restored = Object.freeze({
        ...saved.packet,
        actor: Object.freeze({ ...actor }),
      }) as InvitationCreatePacket;
      this.show({
        command: { packet: restored, status: 'unknown' },
        notice: unknownNotice,
      });
    }
  }

  forget = () => {
    this.quarantine = null;
    this.serial++;
    this.surfaceSerial++;
    this.state = initial();
    this.show({});
  };

  /**
   * Bind chooser to the authoritative DM peer/header. Safety-held peers refuse.
   * Does not clear UNKNOWN — exact retry remains until logout or successful settle.
   */
  open = (conversationId: string, peerId: string) => {
    const actor = this.state.actor;
    if (!actor || !conversationId || !peerId) return;
    if (this.port.isPeerHeld(peerId)) {
      this.show({ notice: 'Приглашение сейчас недоступно для этого собеседника.' });
      return;
    }
    const surfaceGen = ++this.surfaceSerial;
    const surface: InvitationSurface = Object.freeze({ conversationId, peerId, surfaceGen });
    this.show({
      surface,
      listStatus: 'idle',
      games: [],
      nextCursor: null,
      checking: false,
      receipt: null,
      notice: this.state.command?.status === 'unknown' ? unknownNotice : null,
      now: this.clock(),
    });
  };

  /** Cancel chooser UI — returns to DM; keeps UNKNOWN packet and never auto-sends. */
  close = () => {
    this.surfaceSerial++;
    this.show({
      surface: null,
      listStatus: 'idle',
      games: [],
      nextCursor: null,
      checking: false,
      receipt: null,
      notice: this.state.command?.status === 'unknown' ? unknownNotice : null,
    });
  };

  /** Manual managed-games load with cursor pagination, dedupe, and surface fence. */
  load = async (more = false, options?: { preserveNotice?: boolean }) => {
    const actor = this.state.actor;
    const surface = this.state.surface;
    if (!actor || !surface || this.state.command || this.state.checking) return;
    if (this.port.isPeerHeld(surface.peerId)) {
      this.show({ notice: 'Приглашение сейчас недоступно для этого собеседника.' });
      return;
    }
    if (more && (this.state.listStatus !== 'ready' || !this.state.nextCursor)) return;
    if (!more && this.state.listStatus === 'loading') return;
    const serial = ++this.serial;
    const surfaceGen = surface.surfaceGen;
    const cursor = more ? this.state.nextCursor ?? undefined : undefined;
    const keepNotice = options?.preserveNotice === true ? this.state.notice : null;
    if (!more) this.show({ listStatus: 'loading', games: [], nextCursor: null, notice: keepNotice, now: this.clock() });
    else this.show({ listStatus: 'loading', notice: keepNotice });
    try {
      const page = await this.port.managed(cursor);
      if (!this.current(actor) || serial !== this.serial) return;
      if (!this.state.surface || this.state.surface.surfaceGen !== surfaceGen) return;
      if (this.port.isPeerHeld(surface.peerId)) {
        this.show({ listStatus: 'error', notice: 'Приглашение сейчас недоступно для этого собеседника.' });
        return;
      }
      const rows = new Map<string, ManagedGame>();
      for (const item of more ? this.state.games : []) rows.set(item.id, item);
      for (const item of page.items) rows.set(item.id, item);
      this.show({
        listStatus: 'ready',
        games: [...rows.values()],
        nextCursor: page.nextCursor,
        now: this.clock(),
        notice: keepNotice,
      });
    } catch {
      if (this.current(actor) && serial === this.serial && this.state.surface?.surfaceGen === surfaceGen) {
        this.show({
          listStatus: 'error',
          notice: keepNotice ?? 'Не удалось загрузить игры',
        });
      }
    }
  };

  /** Explicit invite only — fresh GET + eligibility at action time; never auto after login/refresh. */
  invite = async (gameId: string) => {
    const actor = this.state.actor;
    const surface = this.state.surface;
    if (!actor || !surface || this.state.command || this.state.checking || this.state.listStatus !== 'ready') return;
    if (this.port.isPeerHeld(surface.peerId)) {
      this.show({ notice: 'Приглашение сейчас недоступно для этого собеседника.' });
      return;
    }
    const listed = this.state.games.find(g => g.id === gameId);
    if (!listed || !isGameOpenForInvitation(listed, this.clock())) {
      this.show({ notice: 'Игра сейчас недоступна. Обновите список.' });
      await this.load();
      return;
    }
    const serial = ++this.serial;
    const surfaceGen = surface.surfaceGen;
    this.show({ checking: true, notice: null });
    try {
      const fresh = await this.port.game(gameId);
      if (!this.current(actor) || serial !== this.serial) return;
      if (!this.state.surface || this.state.surface.surfaceGen !== surfaceGen) return;
      if (this.port.isPeerHeld(surface.peerId)) {
        this.show({ checking: false, notice: 'Приглашение сейчас недоступно для этого собеседника.' });
        return;
      }
      const block = invitationEligibilityBlockReason(fresh, this.clock());
      if (block) {
        this.show({ checking: false, notice: invitationEligibilityNotice(block) });
        await this.load();
        return;
      }
      const packet: InvitationCreatePacket = Object.freeze({
        actor: Object.freeze({ ...actor }),
        key: this.random(),
        gameId: fresh.id,
        peerId: surface.peerId,
        conversationId: surface.conversationId,
        surfaceGen,
        body: Object.freeze({
          inviteePublicPlayerId: surface.peerId,
          expectedGameVersion: fresh.version,
        }),
      });
      this.show({ checking: false });
      await this.dispatch(packet, actor);
    } catch (error) {
      if (!this.current(actor) || serial !== this.serial) return;
      if (!this.state.surface || this.state.surface.surfaceGen !== surfaceGen) return;
      this.show({
        checking: false,
        notice: error instanceof ParticipationError && error.status === 404
          ? 'Игра сейчас недоступна. Обновите список.'
          : 'Игра сейчас недоступна. Обновите список.',
      });
      await this.load();
    }
  };

  /** Explicit UNKNOWN retry — same frozen gameId/peer/body/key only. */
  retry = async () => {
    const { actor, command } = this.state;
    if (!actor || !command || command.status !== 'unknown') return;
    if (command.packet.actor.actorId !== actor.actorId) return;
    if (this.port.isPeerHeld(command.packet.peerId)) {
      this.show({ notice: 'Приглашение сейчас недоступно для этого собеседника.' });
      return;
    }
    await this.dispatch(command.packet, actor);
  };

  /** Open detail only when the live surface still matches the receipt destination. */
  takeReceiptForSurface = (conversationId: string, peerId: string): GameInvitation | null => {
    const { receipt, surface } = this.state;
    if (!receipt || !surface) return null;
    if (surface.conversationId !== conversationId || surface.peerId !== peerId) return null;
    if (receipt.inviteePublicPlayerId !== peerId) return null;
    this.show({ receipt: null });
    return receipt;
  };

  private async dispatch(packet: InvitationCreatePacket, authority: Actor) {
    this.serial++;
    this.show({ command: { packet, status: 'sending' }, notice: null, receipt: null });
    const valid = () =>
      this.current(authority)
      && this.state.command?.packet === packet
      && this.state.command.status === 'sending';
    try {
      const ack = parseInvitation(await this.port.send(packet, authority));
      if (!valid()) return;
      if (ack.gameId !== packet.gameId) throw new ParticipationError('invalid');
      if (ack.inviteePublicPlayerId !== packet.peerId) throw new ParticipationError('invalid');
      if (ack.status !== 'pending') throw new ParticipationError('invalid');
      const surfaceAlive =
        this.state.surface
        && this.state.surface.surfaceGen === packet.surfaceGen
        && this.state.surface.conversationId === packet.conversationId
        && this.state.surface.peerId === packet.peerId;
      this.show({
        command: undefined,
        receipt: surfaceAlive ? ack : null,
        notice: surfaceAlive ? null : 'Приглашение отправлено.',
        listStatus: this.state.listStatus === 'loading' ? 'ready' : this.state.listStatus,
      });
    } catch (error) {
      if (!valid()) return;
      if (
        error instanceof ParticipationError
        && error.kind === 'business'
        && error.status < 500
        && error.code !== 'COMMAND_IN_PROGRESS'
      ) {
        const stale = error.status === 409;
        this.show({
          command: undefined,
          notice: stale
            ? 'Игра изменилась. Обновите список перед новым приглашением.'
            : error.status === 404
              ? 'Приглашение недоступно. Проверьте игру и собеседника.'
              : 'Не удалось отправить приглашение. Проверьте данные и повторите.',
        });
        if (stale && this.state.surface) void this.load(false, { preserveNotice: true });
      } else {
        this.show({ command: { packet, status: 'unknown' }, notice: unknownNotice });
      }
    }
  }
}
