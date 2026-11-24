import {
  dominantParticipation, ParticipationError, sameActor,
  type Actor, type CursorPage, type ManagedGame,
} from './participation.ts';
import type { Participation } from '@gobadminton/contracts/game-types';

/** Four organizer-declared statuses — same labels as accepted web #386. */
export const COURT_BOOKING_STATUSES = [
  'unspecified',
  'arranging',
  'organizer_confirmed',
  'not_arranged',
] as const;

export type CourtBookingStatus = (typeof COURT_BOOKING_STATUSES)[number];

export const COURT_BOOKING_LABELS: Record<CourtBookingStatus, string> = {
  unspecified: 'Не указано',
  arranging: 'Договариваемся',
  organizer_confirmed: 'Подтверждено организатором',
  not_arranged: 'Не удалось договориться',
};

export const COURT_BOOKING_DISCLAIMER = 'Со слов организатора. Приложение не проверяет бронь.';

export type GameCourtBooking = Readonly<{
  gameId: string;
  status: CourtBookingStatus;
  version: number;
  updatedAt: string | null;
  declarationSource: 'organizer_declared';
  allowedActions: Readonly<{ canUpdate: boolean }>;
}>;

export type CourtBookingPacket = Readonly<{
  actor: Readonly<Actor>;
  key: string;
  gameId: string;
  body: Readonly<{ expectedVersion: number; status: CourtBookingStatus }>;
}>;

export type CourtBookingFocus = Readonly<{
  gameId: string;
  viewGen: number;
  /** Managed summary already proved membership; detail must check confirmed/managed. */
  proof: 'managed' | 'detail';
}>;

/** Immutable actor/game/view/foreground fence captured at render for edit/save/retry/refresh. */
export type CourtBookingRenderedPermit = Readonly<{
  actor: Readonly<Actor>;
  gameId: string;
  viewGen: number;
  foregroundGen: number;
}>;

export type CourtBookingPort = {
  /** Confirmed participation rows for the focused game when already loaded; null = not ready. */
  detailParts: (gameId: string) => Participation[] | null;
  /** Parent managed-summary membership; null = parent not ready. */
  managedMembership: (gameId: string) => boolean | null;
  managed: (cursor: string | undefined, permit: () => boolean) => Promise<CursorPage<ManagedGame>>;
  read: (gameId: string, permit: () => boolean) => Promise<GameCourtBooking>;
  send: (packet: CourtBookingPacket, authority: Actor, permit: () => boolean) => Promise<GameCourtBooking>;
};

export type CourtBookingSnapshot = {
  actor: Actor | null;
  focus: CourtBookingFocus | null;
  foreground: boolean;
  /** Bumps on every app foreground transition — invalidates rendered permits. */
  foregroundGen: number;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied' | 'stale';
  booking: GameCourtBooking | null;
  draft: CourtBookingStatus;
  command?: { packet: CourtBookingPacket; status: 'sending' | 'unknown' };
  notice: string | null;
};

const initial = (actor: Actor | null = null): CourtBookingSnapshot => ({
  actor,
  focus: null,
  foreground: true,
  foregroundGen: 0,
  status: 'idle',
  booking: null,
  draft: 'unspecified',
  notice: null,
});

const unknownNotice =
  'Пока не удалось подтвердить изменение. Проверка повторит только прежнюю команду с тем же ключом и данными. Новые изменения пока недоступны.';

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ParticipationError('invalid');
  return value as Record<string, unknown>;
};

export function isCourtBookingStatus(value: unknown): value is CourtBookingStatus {
  return typeof value === 'string' && (COURT_BOOKING_STATUSES as readonly string[]).includes(value);
}

/** Strict DTO: matching gameId, four-status enum, integer version, nullable timestamp, fixed source, boolean canUpdate. */
export function parseGameCourtBooking(value: unknown, expectedGameId?: string): GameCourtBooking {
  const r = record(value);
  const actions = record(r.allowedActions);
  if (
    typeof r.gameId !== 'string' || !r.gameId
    || !isCourtBookingStatus(r.status)
    || !Number.isInteger(r.version) || Number(r.version) < 0
    || !(r.updatedAt === null || (typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt))))
    || r.declarationSource !== 'organizer_declared'
    || typeof actions.canUpdate !== 'boolean'
  ) throw new ParticipationError('invalid');
  if (expectedGameId !== undefined && r.gameId !== expectedGameId) throw new ParticipationError('invalid');
  return Object.freeze({
    gameId: r.gameId,
    status: r.status,
    version: r.version as number,
    updatedAt: r.updatedAt as string | null,
    declarationSource: 'organizer_declared',
    allowedActions: Object.freeze({ canUpdate: actions.canUpdate }),
  });
}

export function courtBookingWire(body: Readonly<{ expectedVersion: number; status: CourtBookingStatus }>): Record<string, unknown> {
  return { expectedVersion: body.expectedVersion, status: body.status };
}

export function canSaveCourtBooking(draft: CourtBookingStatus, booking: GameCourtBooking | null): boolean {
  return !!booking?.allowedActions.canUpdate && draft !== booking.status;
}

/**
 * Root-owned organizer-declared court arrangement. Explicit load/save only;
 * UNKNOWN packet outlives panel unmount; never auto-writes or clears UNKNOWN on GET.
 */
export class GameCourtBookingCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  /** In-flight private read / eligibility generation. */
  private readSerial = 0;
  /** Focus lease generation — release retires only its own viewGen. */
  private viewSerial = 0;
  private draftDirty = false;
  private quarantine: {
    actorId: string;
    packet?: CourtBookingPacket;
    draft: CourtBookingStatus;
    booking: GameCourtBooking | null;
    draftDirty: boolean;
  } | null = null;
  private port: CourtBookingPort;
  private random: () => string;
  /** Distinct generation per mutation dispatch — old ack/catch cannot settle or freeze a newer attempt. */
  private attemptSerial = 0;

  constructor(port: CourtBookingPort, random: () => string) {
    this.port = port;
    this.random = random;
  }

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<CourtBookingSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  private current(actor: Actor | null) { return sameActor(actor, this.state.actor); }
  private locked() {
    return !!this.state.command || this.state.status === 'stale' || this.state.status === 'loading';
  }
  blocksMutations = () => !!this.state.command || this.state.status === 'stale';

  /** Capture rendered actor/game/view/foreground fence for panel callbacks. */
  renderedPermit = (): CourtBookingRenderedPermit | null => {
    const { actor, focus, foreground, foregroundGen } = this.state;
    if (!actor || !focus || !foreground) return null;
    return Object.freeze({
      actor: Object.freeze({ ...actor }),
      gameId: focus.gameId,
      viewGen: focus.viewGen,
      foregroundGen,
    });
  };

  private permitLive(permit: CourtBookingRenderedPermit) {
    return this.current(permit.actor)
      && this.state.foreground
      && this.state.focus?.gameId === permit.gameId
      && this.state.focus?.viewGen === permit.viewGen
      && this.state.foregroundGen === permit.foregroundGen;
  }

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || !actor && !this.state.actor) return;
    if (this.state.actor) {
      this.quarantine = {
        actorId: this.state.actor.actorId,
        packet: this.state.command?.packet,
        draft: this.state.draft,
        booking: this.state.booking,
        draftDirty: this.draftDirty,
      };
    }
    if (actor && this.quarantine?.actorId !== actor.actorId) this.quarantine = null;
    const saved = actor ? this.quarantine : null;
    if (actor) this.quarantine = null;
    this.readSerial++;
    this.viewSerial++;
    this.draftDirty = false;
    const foreground = this.state.foreground;
    const foregroundGen = this.state.foregroundGen + 1;
    this.state = { ...initial(actor ? Object.freeze({ ...actor }) : null), foreground, foregroundGen };
    if (saved) {
      const restoredPacket = saved.packet
        ? Object.freeze({ ...saved.packet, actor: Object.freeze({ ...actor }) }) as CourtBookingPacket
        : undefined;
      this.draftDirty = saved.draftDirty;
      this.show({
        draft: saved.draft,
        booking: saved.booking,
        ...(restoredPacket ? {
          command: { packet: restoredPacket, status: 'unknown' as const },
          notice: unknownNotice,
        } : {}),
      });
    }
  }

  forget = () => {
    this.quarantine = null;
    this.readSerial++;
    this.viewSerial++;
    this.draftDirty = false;
    this.state = initial();
    this.show({});
  };

  /**
   * App foreground fence. Background retires in-flight sending → UNKNOWN, hides private
   * booking, and clears stuck loading. Safe return triggers a fresh read when focused;
   * never drops UNKNOWN or auto-retries mutations.
   */
  setForeground = (active: boolean) => {
    if (active === this.state.foreground) return;
    this.readSerial++;
    const foregroundGen = this.state.foregroundGen + 1;
    const focus = this.state.focus;

    if (!active) {
      if (this.state.command?.status === 'sending') {
        this.freezeUnknown(this.state.command.packet);
      }
      const unknown = this.state.command?.status === 'unknown' ? this.state.command : undefined;
      const sameGameUnknown = !!unknown && !!focus && unknown.packet.gameId === focus.gameId;
      this.draftDirty = sameGameUnknown ? this.draftDirty : false;
      this.show({
        foreground: false,
        foregroundGen,
        status: 'idle',
        booking: sameGameUnknown ? this.state.booking : null,
        draft: sameGameUnknown && this.state.booking ? this.state.draft : 'unspecified',
        notice: unknown ? unknownNotice : null,
      });
      return;
    }

    const unknown = this.state.command?.status === 'unknown' ? this.state.command : undefined;
    const sameGameUnknown = !!unknown && !!focus && unknown.packet.gameId === focus.gameId;
    this.draftDirty = sameGameUnknown ? this.draftDirty : false;
    this.show({
      foreground: true,
      foregroundGen,
      status: sameGameUnknown && this.state.booking ? 'ready' : 'idle',
      booking: sameGameUnknown ? this.state.booking : null,
      draft: sameGameUnknown && this.state.booking ? this.state.draft : 'unspecified',
      notice: sameGameUnknown ? unknownNotice : null,
    });
    if (this.state.focus && !this.state.command) {
      void this.load();
    }
  };

  /**
   * Bind panel to a game. Returns release that retires only this viewGen.
   * Does not clear UNKNOWN — exact retry remains across route changes.
   */
  focus = (gameId: string, proof: CourtBookingFocus['proof']): (() => void) => {
    const noop = () => {};
    if (!this.state.actor || !gameId) return noop;
    const viewGen = ++this.viewSerial;
    this.readSerial++;
    // New view retires in-flight sending immediately — old await must not leave indefinite sending.
    if (this.state.command?.status === 'sending') {
      this.freezeUnknown(this.state.command.packet);
    }
    const focus: CourtBookingFocus = Object.freeze({ gameId, viewGen, proof });
    const sameGameUnknown = this.state.command?.status === 'unknown'
      && this.state.command.packet.gameId === gameId;
    this.draftDirty = false;
    this.show({
      focus,
      status: 'idle',
      booking: sameGameUnknown ? this.state.booking : null,
      draft: sameGameUnknown && this.state.booking ? this.state.draft : 'unspecified',
      notice: sameGameUnknown ? unknownNotice : null,
    });
    return () => this.releaseFocus(viewGen);
  };

  releaseFocus = (viewGen: number) => {
    if (!this.state.focus || this.state.focus.viewGen !== viewGen) return;
    this.readSerial++;
    if (this.state.command?.status === 'sending') {
      this.freezeUnknown(this.state.command.packet);
    }
    const focusedGame = this.state.focus.gameId;
    this.show({
      focus: null,
      status: 'idle',
      booking: this.state.command?.packet.gameId === focusedGame ? this.state.booking : null,
      notice: this.state.command?.status === 'unknown' ? unknownNotice : null,
    });
  };

  updateDraft = (status: CourtBookingStatus, permit?: CourtBookingRenderedPermit) => {
    if (permit && !this.permitLive(permit)) return;
    if (!this.state.actor || !this.state.focus || this.locked()) return;
    if (permit && (permit.gameId !== this.state.focus.gameId || permit.viewGen !== this.state.focus.viewGen)) return;
    if (!this.state.booking?.allowedActions.canUpdate) return;
    this.draftDirty = true;
    this.show({ draft: status, notice: this.state.command?.status === 'unknown' ? unknownNotice : null });
  };

  /** Eligibility then private GET. Failed/unknown eligibility never triggers speculative GET. */
  load = async (permit?: CourtBookingRenderedPermit) => {
    const actor = this.state.actor;
    const focus = this.state.focus;
    if (!actor || !focus || this.state.command || this.state.status === 'loading') return;
    if (!this.state.foreground) return;
    if (permit && !this.permitLive(permit)) return;
    if (permit && (permit.gameId !== focus.gameId || permit.viewGen !== focus.viewGen)) return;
    const readGen = ++this.readSerial;
    const viewGen = focus.viewGen;
    const gameId = focus.gameId;
    const live = () => this.readLive(actor, readGen, viewGen);
    // load() returns early when command is present — UNKNOWN blocks this path; notices stay null.
    this.show({ status: 'loading', notice: null });
    try {
      const eligible = await this.resolveEligible(focus, live);
      if (!live()) return;
      if (eligible === 'pending') {
        this.show({ status: 'idle', booking: null, draft: 'unspecified', notice: null });
        return;
      }
      if (eligible === 'failed') {
        this.show({ status: 'error', booking: null, draft: 'unspecified', notice: 'Не удалось проверить доступ к договорённости о корте.' });
        return;
      }
      if (!eligible) {
        this.clearPrivate(actor, readGen, viewGen, 'denied');
        return;
      }
      const booking = parseGameCourtBooking(await this.port.read(gameId, live), gameId);
      if (!live()) return;
      if (!this.draftDirty) {
        this.show({ booking, draft: booking.status, status: 'ready', notice: null });
      } else {
        this.show({ booking, status: 'ready', notice: null });
      }
    } catch (error) {
      if (!live()) return;
      if (error instanceof ParticipationError && error.kind === 'business' && (error.status === 404 || error.status === 401)) {
        this.clearPrivate(actor, readGen, viewGen, 'denied');
        return;
      }
      this.show({
        status: 'error',
        booking: null,
        draft: 'unspecified',
        notice: 'Не удалось загрузить статус. Попробуйте ещё раз.',
      });
    }
  };

  /**
   * After 409: recheck eligibility then authoritative GET; keep draft; require fresh version
   * before new save. Denied private clears booking/editing.
   */
  refreshAuthoritative = async (permit?: CourtBookingRenderedPermit) => {
    const actor = this.state.actor;
    const focus = this.state.focus;
    if (!actor || !focus || this.state.command) return;
    if (this.state.status !== 'stale' && this.state.status !== 'ready' && this.state.status !== 'error') return;
    if (!this.state.foreground) return;
    if (permit && !this.permitLive(permit)) return;
    if (permit && (permit.gameId !== focus.gameId || permit.viewGen !== focus.viewGen)) return;
    const readGen = ++this.readSerial;
    const viewGen = focus.viewGen;
    const priorDraft = this.state.draft;
    const live = () => this.readLive(actor, readGen, viewGen);
    this.show({ status: 'loading', notice: null });
    try {
      const eligible = await this.resolveEligible(focus, live);
      if (!live()) return;
      if (eligible === 'pending') {
        this.show({ status: 'idle', booking: null, draft: priorDraft, notice: null });
        return;
      }
      if (eligible === 'failed') {
        this.show({
          status: 'stale',
          draft: priorDraft,
          notice: 'Не удалось обновить данные. Выбранный статус сохранён — повторите обновление.',
        });
        return;
      }
      if (!eligible) {
        this.clearPrivate(actor, readGen, viewGen, 'denied');
        return;
      }
      const booking = parseGameCourtBooking(await this.port.read(focus.gameId, live), focus.gameId);
      if (!live()) return;
      this.show({
        booking,
        draft: priorDraft,
        status: 'ready',
        notice: 'Статус изменился. Проверьте значение перед новым сохранением.',
      });
    } catch (error) {
      if (!live()) return;
      if (error instanceof ParticipationError && error.kind === 'business' && (error.status === 404 || error.status === 401)) {
        this.clearPrivate(actor, readGen, viewGen, 'denied');
        return;
      }
      this.show({
        status: 'stale',
        draft: priorDraft,
        notice: 'Не удалось обновить данные. Выбранный статус сохранён — повторите обновление.',
      });
    }
  };

  save = async (permit?: CourtBookingRenderedPermit) => {
    const { actor, focus, booking, draft, status, command, foreground, foregroundGen } = this.state;
    if (!actor || !focus || !booking || command || status !== 'ready' || !foreground) return;
    if (permit && !this.permitLive(permit)) return;
    if (!booking.allowedActions.canUpdate || draft === booking.status) return;
    if (booking.gameId !== focus.gameId) return;
    if (permit && (permit.gameId !== focus.gameId || permit.viewGen !== focus.viewGen)) return;
    const packet: CourtBookingPacket = Object.freeze({
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      gameId: focus.gameId,
      body: Object.freeze({ expectedVersion: booking.version, status: draft }),
    });
    await this.dispatch(packet, actor, focus.viewGen, foregroundGen);
  };

  reconcile = async (permit?: CourtBookingRenderedPermit) => {
    const { actor, command, focus, foreground, foregroundGen } = this.state;
    if (!actor || !command || command.status !== 'unknown' || !foreground) return;
    if (permit && !this.permitLive(permit)) return;
    if (command.packet.actor.actorId !== actor.actorId) return;
    if (!focus || focus.gameId !== command.packet.gameId) return;
    if (permit && (permit.gameId !== focus.gameId || permit.viewGen !== focus.viewGen)) return;
    await this.dispatch(command.packet, actor, focus.viewGen, foregroundGen);
  };

  private readLive(actor: Actor, readGen: number, viewGen: number) {
    return this.current(actor) && readGen === this.readSerial && this.state.focus?.viewGen === viewGen && this.state.foreground;
  }

  private clearPrivate(actor: Actor, readGen: number, viewGen: number, status: 'denied') {
    if (!this.readLive(actor, readGen, viewGen)) return;
    this.draftDirty = false;
    this.show({
      status,
      booking: null,
      draft: 'unspecified',
      notice: this.state.command?.status === 'unknown' ? unknownNotice : null,
    });
  }

  private async resolveEligible(
    focus: CourtBookingFocus,
    permit: () => boolean,
  ): Promise<boolean | 'failed' | 'pending'> {
    if (focus.proof === 'managed') {
      const membership = this.port.managedMembership(focus.gameId);
      if (membership === null) return 'pending';
      return membership;
    }
    const parts = this.port.detailParts(focus.gameId);
    // Detail still loading — do not speculate private GET or managed walk.
    if (parts === null) return 'pending';
    const own = dominantParticipation(parts);
    if (own?.status === 'confirmed') return true;
    try {
      let cursor: string | undefined;
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      for (;;) {
        const cursorKey = cursor ?? '';
        // Cyclic/corrupt pagination is an invalid read, not proof of absence.
        if (seenCursors.has(cursorKey)) return 'failed';
        seenCursors.add(cursorKey);
        if (!permit()) throw new ParticipationError('stale');
        const page = await this.port.managed(cursor, permit);
        if (!permit()) throw new ParticipationError('stale');
        if (page.items.some(g => g.id === focus.gameId)) return true;
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

  private async dispatch(
    packet: CourtBookingPacket,
    authority: Actor,
    viewGen: number,
    foregroundGen: number,
  ) {
    const attempt = ++this.attemptSerial;
    this.show({ command: { packet, status: 'sending' }, notice: null });
    const valid = () =>
      this.current(authority)
      && this.state.command?.packet === packet
      && this.state.command.status === 'sending'
      && this.state.foreground
      && this.state.focus?.viewGen === viewGen
      && this.state.focus.gameId === packet.gameId
      && this.state.foregroundGen === foregroundGen
      && attempt === this.attemptSerial;
    const permit = () =>
      this.current(authority)
      && this.state.foreground
      && this.state.focus?.viewGen === viewGen
      && this.state.focus.gameId === packet.gameId
      && this.state.command?.packet === packet
      && this.state.foregroundGen === foregroundGen
      && attempt === this.attemptSerial;
    try {
      const ack = parseGameCourtBooking(await this.port.send(packet, authority, permit), packet.gameId);
      if (!valid()) {
        this.freezeUnknown(packet, attempt);
        return;
      }
      if (ack.status !== packet.body.status) throw new ParticipationError('invalid');
      if (ack.version !== packet.body.expectedVersion + 1) throw new ParticipationError('invalid');
      this.draftDirty = false;
      this.show({
        booking: ack,
        draft: ack.status,
        command: undefined,
        status: 'ready',
        notice: 'Статус сохранён со слов организатора.',
      });
    } catch (error) {
      if (!valid()) {
        this.freezeUnknown(packet, attempt);
        return;
      }
      if (error instanceof ParticipationError
        && error.kind === 'business'
        && error.status < 500
        && error.code !== 'COMMAND_IN_PROGRESS') {
        const denied = error.status === 401 || error.status === 403 || error.status === 404;
        if (denied) {
          this.draftDirty = false;
          this.show({
            command: undefined,
            status: 'denied',
            booking: null,
            draft: 'unspecified',
            notice: null,
          });
          return;
        }
        const stale = error.status === 409;
        this.show({
          command: undefined,
          status: stale ? 'stale' : 'ready',
          notice: stale
            ? 'Статус изменился. Обновите данные перед сохранением.'
            : 'Не удалось сохранить статус. Проверьте значение и повторите.',
        });
      } else {
        this.show({ command: { packet, status: 'unknown' }, notice: unknownNotice });
      }
    }
  }

  /**
   * Retire in-flight ownership to UNKNOWN when actor/view/focus/foreground fences fail.
   * Lifecycle callers omit attempt (current active sending). Dispatch callbacks pass their
   * attempt so an old ack/catch cannot freeze a newer manual same-packet retry.
   */
  private freezeUnknown(packet: CourtBookingPacket, attempt?: number) {
    if (this.state.command?.packet !== packet || this.state.command.status !== 'sending') return;
    if (attempt !== undefined && attempt !== this.attemptSerial) return;
    this.show({ command: { packet, status: 'unknown' }, notice: unknownNotice });
  }
}
