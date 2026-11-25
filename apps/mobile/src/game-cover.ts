import { sameActor, type Actor } from './participation.ts';
import { publicCoverPath } from './media.ts';
import { NATIVE_ORIGIN } from './native-auth-protocol.ts';
import { ProfileError } from './profile.ts';
import {
  AvatarSourceError,
  cloneDerivativeBytes,
  type AvatarDerivative,
} from './profile-avatar.ts';

/** Closed game-cover upload budget — enforced by the native mutate port before fetch. */
export const GAME_COVER_UPLOAD_MAX_BYTES = 512 * 1024;
const GAME_COVER_MIMES = new Set<AvatarDerivative['mime']>(['image/jpeg', 'image/png', 'image/webp']);

export type GameCoverReceipt = Readonly<{
  version: number;
  hasCover: boolean;
  cover: Readonly<{ uploadedUrl: string | null }>;
}>;

export type GameCoverAction = 'replace' | 'remove';
export type GameCoverPacket = Readonly<{
  actor: Readonly<Actor>;
  key: string;
  gameId: string;
  action: GameCoverAction;
  gameVersion: number;
  derivative: AvatarDerivative | null;
}>;

export type GameCoverPort = {
  read: (gameId: string, authority: Actor) => Promise<GameCoverReceipt>;
  mutate: (packet: GameCoverPacket, authority: Actor) => Promise<GameCoverReceipt>;
};

export type GameCoverFocus = Readonly<{ gameId: string; viewGen: number }>;

/** Immutable actor/game/view/foreground fence captured at render for editor callbacks. */
export type GameCoverRenderedPermit = Readonly<{
  actor: Readonly<Actor>;
  gameId: string;
  viewGen: number;
  foregroundGen: number;
}>;

/**
 * Admission frozen at mutate port entry (before token await) — rechecked after refresh,
 * immediately before native-api dispatch. Packet identity is referential.
 */
export type GameCoverDispatchAdmission = Readonly<{
  actor: Readonly<Actor>;
  gameId: string;
  key: string;
  viewGen: number | null;
  foregroundGen: number;
  packet: GameCoverPacket;
}>;

/** Narrow expected system-picker handoff — survives Android library backgrounding only. */
export type GameCoverPickerHandoff = Readonly<{
  actor: Readonly<Actor>;
  gameId: string;
  viewGen: number;
  serial: number;
}>;

export type GameCoverSnapshot = {
  actor: Actor | null;
  gameId: string | null;
  focus: GameCoverFocus | null;
  foreground: boolean;
  foregroundGen: number;
  status: 'idle' | 'loading' | 'ready' | 'denied' | 'picking' | 'processing' | 'sending' | 'unknown';
  access: GameCoverReceipt | null;
  command?: { packet: GameCoverPacket; status: 'sending' | 'unknown' };
  /** Other-game unresolved work parked across focus/navigation — not an endless spinner. */
  heldGameId: string | null;
  notice: string | null;
  error: string | null;
  uncertain: boolean;
};

export function freezeGameCoverPacket(input: {
  actor: Actor;
  key: string;
  gameId: string;
  action: GameCoverAction;
  gameVersion: number;
  derivative: AvatarDerivative | null;
}): GameCoverPacket {
  const derivative = input.derivative
    ? Object.freeze({
        mime: input.derivative.mime,
        bytes: cloneDerivativeBytes(input.derivative.bytes),
      })
    : null;
  return Object.freeze({
    actor: Object.freeze({ ...input.actor }),
    key: input.key,
    gameId: input.gameId,
    action: input.action,
    gameVersion: input.gameVersion,
    derivative,
  });
}

/** Accept own game-cover path or venue fallback projection; never foreign hosts. */
export function parseGameCoverUrl(value: unknown): string | null {
  return publicCoverPath(value, 'game') ?? publicCoverPath(value, 'venue');
}

export function parseGameCoverReceipt(value: unknown): GameCoverReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfileError('invalid');
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 1) throw new ProfileError('invalid');
  if (typeof row.hasCover !== 'boolean') throw new ProfileError('invalid');
  if (!row.cover || typeof row.cover !== 'object' || Array.isArray(row.cover)) throw new ProfileError('invalid');
  const cover = row.cover as Record<string, unknown>;
  let uploadedUrl: string | null = null;
  if (cover.uploadedUrl === null || cover.uploadedUrl === undefined) uploadedUrl = null;
  else if (typeof cover.uploadedUrl !== 'string') throw new ProfileError('invalid');
  else uploadedUrl = parseGameCoverUrl(cover.uploadedUrl);
  // hasCover is own-slot presence — CURRENT replay may return a safe venue/null URL with hasCover false.
  return Object.freeze({
    version: row.version as number,
    hasCover: row.hasCover,
    cover: Object.freeze({ uploadedUrl }),
  });
}

/** Exact game-covers path only — bearer never attaches to venue/fallback or foreign URLs. */
export function gameCoverMediaPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\/v1\/media\/game-covers\/[a-f0-9]{64}\.png$/.test(value) ? value : null;
}

/** Closed binary admit before mutate fetch — 0 < bytes ≤ 512KiB and accepted image MIME. */
export function admitGameCoverUpload(derivative: AvatarDerivative | null | undefined): AvatarDerivative {
  if (!derivative || !GAME_COVER_MIMES.has(derivative.mime)) throw new ProfileError('invalid');
  const n = derivative.bytes.byteLength;
  if (!Number.isSafeInteger(n) || n < 1 || n > GAME_COVER_UPLOAD_MAX_BYTES) throw new ProfileError('invalid');
  return derivative;
}

const initial = (actor: Actor | null = null): GameCoverSnapshot => ({
  actor,
  gameId: null,
  focus: null,
  foreground: true,
  foregroundGen: 0,
  status: 'idle',
  access: null,
  heldGameId: null,
  notice: null,
  error: null,
  uncertain: false,
});

const COPY = {
  error429: 'Слишком много попыток. Попробуйте позже.',
  error422: 'Фото не прошло проверку. Выберите другое изображение.',
  errorOther: 'Сохранение не подтверждено. Обновите данные перед повторной попыткой; игра не публикуется автоматически.',
  saved: 'Фото игры проверено и сохранено.',
  removed: 'Своё фото удалено. Используется текущая обложка площадки или стандартная.',
  /** CURRENT replay / authoritative state without own photo — never claim a successful save. */
  currentNoOwn: 'Сейчас своё фото не установлено. Можно выбрать изображение снова.',
  /** CURRENT remove replay while own slot remains — never claim successful removal / venue fallback. */
  currentOwn: 'Сейчас своё фото установлено. Можно оставить его или выбрать другое.',
  refreshed: 'Данные обновлены. Можно повторить сохранение.',
  denied: 'Редактирование фото недоступно. Обновите страницу и проверьте вход.',
  held: 'Есть неподтверждённое сохранение фото другой игры. Вернитесь к ней, чтобы проверить результат.',
} as const;

/** True only for definite successful replace/remove notices — not UNKNOWN/error/CURRENT-empty. */
export function gameCoverMutationSucceeded(snap: Pick<GameCoverSnapshot, 'status' | 'uncertain' | 'command' | 'notice'>): boolean {
  return snap.status === 'ready'
    && !snap.uncertain
    && !snap.command
    && (snap.notice === COPY.saved || snap.notice === COPY.removed);
}

const coverError = (status: number) =>
  status === 429 ? COPY.error429 : status === 422 ? COPY.error422 : COPY.errorOther;

type HeldCover = Readonly<{
  packet: GameCoverPacket | null;
  access: GameCoverReceipt | null;
  uncertain: boolean;
}>;

type GameCoverGate = {
  /** Refresh managed detail after a known receipt so later publish uses the new game version. */
  onReceipt?: (gameId: string, receipt: GameCoverReceipt) => void;
  accessToken: () => string | null;
  /** Same-game unresolved management publish/roster blocks new cover writes. */
  managementBlocksWrites?: (gameId: string) => boolean;
};

/**
 * Root-lifetime managed-game photo owner.
 * One packet per dispatch; uncertain → authoritative GET only; hasCover gates remove (not venue URL).
 * Cross-game journal parks unresolved work; view/foreground permits fence editor mutations.
 */
export class GameCoverCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private serial = 0;
  private viewSerial = 0;
  private pickerSerial = 0;
  private uncertain = false;
  private quarantined: GameCoverPacket | null = null;
  private holds = new Map<string, HeldCover>();
  private pickerHandoff: GameCoverPickerHandoff | null = null;
  private readonly port: GameCoverPort;
  private readonly random: () => string;
  private readonly gate: GameCoverGate;
  constructor(port: GameCoverPort, random: () => string, gate: GameCoverGate) {
    this.port = port;
    this.random = random;
    this.gate = gate;
  }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private show(p: Partial<GameCoverSnapshot>) {
    const heldGameId = this.nextHeldGameId(p.gameId !== undefined ? p.gameId : this.state.gameId);
    this.state = { ...this.state, ...p, heldGameId, uncertain: p.uncertain ?? this.uncertain };
    this.listeners.forEach(f => f());
  }
  private nextHeldGameId(activeGameId: string | null) {
    for (const gameId of this.holds.keys()) {
      if (gameId !== activeGameId) return gameId;
    }
    return null;
  }
  private current(actor: Actor | null) {
    return sameActor(actor, this.state.actor);
  }
  busy = () =>
    this.state.status === 'picking' ||
    this.state.status === 'processing' ||
    this.state.status === 'loading' ||
    this.state.command?.status === 'sending';
  blocksEdits = () =>
    this.busy() || this.state.status === 'unknown' || this.state.command?.status === 'unknown' || this.uncertain;
  /** Unresolved cover work (active or journaled) blocks incompatible managed publish/roster writes for that game. */
  blocksManagedWrites = (gameId: string) => {
    if (!gameId) return false;
    if (this.state.gameId === gameId && this.blocksEdits()) return true;
    return this.holds.has(gameId);
  };
  /** True when the focused game may open the editor to reconcile existing unresolved work. */
  canOpenEditor = (gameId: string) =>
    !!gameId && (this.state.gameId === gameId || this.holds.has(gameId));

  renderedPermit = (): GameCoverRenderedPermit | null => {
    const { actor, focus, foreground, foregroundGen } = this.state;
    if (!actor || !focus || !foreground) return null;
    return Object.freeze({
      actor: Object.freeze({ ...actor }),
      gameId: focus.gameId,
      viewGen: focus.viewGen,
      foregroundGen,
    });
  };

  /** Pure production permit check — usable from editor and tests without lazy authority gaps. */
  permitLive = (permit: GameCoverRenderedPermit) =>
    this.current(permit.actor)
    && this.state.foreground
    && this.state.focus?.gameId === permit.gameId
    && this.state.focus?.viewGen === permit.viewGen
    && this.state.foregroundGen === permit.foregroundGen;

  /**
   * Begin expected OS photo-picker handoff bound to original actor/session/game/view.
   * Ordinary AppState background during the picker does not clear this; mutations still
   * require permitLive (foregroundGen fence). Returns end() for cancel/complete.
   */
  beginExpectedPickerHandoff = (permit: GameCoverRenderedPermit): (() => void) => {
    if (!this.permitLive(permit)) return () => {};
    const serial = ++this.pickerSerial;
    this.pickerHandoff = Object.freeze({
      actor: Object.freeze({ ...permit.actor }),
      gameId: permit.gameId,
      viewGen: permit.viewGen,
      serial,
    });
    return () => {
      if (this.pickerHandoff?.serial === serial) this.pickerHandoff = null;
    };
  };

  /** True while an expected picker handoff is armed for the focused view (may be backgrounded). */
  expectingPickerHandoff = () => {
    const h = this.pickerHandoff;
    return !!h
      && this.current(h.actor)
      && this.state.focus?.gameId === h.gameId
      && this.state.focus?.viewGen === h.viewGen;
  };

  /**
   * In-flight picker identity — stays true while backgrounded so the OS library call is not
   * retired by AppState. Close/account/game ABA still clears the handoff.
   */
  pickerHandoffPending = (permit: GameCoverRenderedPermit) => {
    const h = this.pickerHandoff;
    if (!h) return false;
    return this.current(h.actor)
      && sameActor(h.actor, permit.actor)
      && this.state.focus?.gameId === h.gameId
      && this.state.focus?.viewGen === h.viewGen
      && permit.gameId === h.gameId
      && permit.viewGen === h.viewGen;
  };

  /**
   * Accept picker result after expected library backgrounding: same actor/session/game/view,
   * app active again. Never revives stale mutation permits (foregroundGen still required there).
   */
  pickerHandoffLive = (permit: GameCoverRenderedPermit) => {
    if (!this.pickerHandoff) return this.permitLive(permit);
    return this.state.foreground && this.pickerHandoffPending(permit);
  };

  /**
   * Freeze mutate admission at port entry (before token await). AuthCoordinator rechecks
   * after token, immediately before API — no minting a new permit.
   */
  captureDispatchAdmission = (packet: GameCoverPacket): GameCoverDispatchAdmission =>
    Object.freeze({
      actor: Object.freeze({ ...packet.actor }),
      gameId: packet.gameId,
      key: packet.key,
      viewGen: this.state.focus?.viewGen ?? null,
      foregroundGen: this.state.foregroundGen,
      packet,
    });

  /** Original actor/session/game/view/foreground generation + packet identity still live. */
  dispatchAdmissionLive = (admission: GameCoverDispatchAdmission, packet: GameCoverPacket) =>
    admission.packet === packet
    && admission.key === packet.key
    && this.current(admission.actor)
    && sameActor(admission.actor, packet.actor)
    && this.state.gameId === admission.gameId
    && this.state.command?.packet === packet
    && this.state.command.status === 'sending'
    && this.state.foreground
    && this.state.foregroundGen === admission.foregroundGen
    && (admission.viewGen === null || this.state.focus?.viewGen === admission.viewGen);

  private clearPickerHandoff() {
    this.pickerHandoff = null;
  }

  private managementBlocked(gameId: string) {
    return !!this.gate.managementBlocksWrites?.(gameId);
  }

  private parkActiveIfNeeded(nextGameId: string) {
    const { gameId, command, access } = this.state;
    if (!gameId || gameId === nextGameId) return;
    if (!(command || this.uncertain)) return;
    this.holds.set(gameId, Object.freeze({
      packet: command?.packet ?? null,
      access,
      uncertain: this.uncertain || command?.status === 'unknown',
    }));
  }

  private restoreHold(gameId: string): boolean {
    const held = this.holds.get(gameId);
    if (!held) return false;
    this.holds.delete(gameId);
    this.uncertain = held.uncertain;
    this.serial++;
    this.show({
      gameId,
      status: held.packet ? 'unknown' : (held.uncertain ? 'ready' : 'idle'),
      access: held.access,
      command: held.packet ? { packet: held.packet, status: 'unknown' as const } : undefined,
      notice: held.uncertain ? COPY.errorOther : null,
      error: held.uncertain ? coverError(0) : null,
      uncertain: held.uncertain,
    });
    return true;
  }

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || (!actor && !this.state.actor)) return;
    if (this.state.command) this.quarantined = this.state.command.packet;
    for (const held of this.holds.values()) {
      if (!this.quarantined && held.packet) this.quarantined = held.packet;
    }
    this.holds.clear();
    this.clearPickerHandoff();
    if (actor && this.quarantined?.actor.actorId !== actor.actorId) this.quarantined = null;
    // Preserve original packet/key/version/bytes; do not rebind actor. Retry requires sameActor.
    const packet = actor ? this.quarantined : null;
    if (actor) this.quarantined = null;
    this.serial++;
    this.viewSerial++;
    this.uncertain = false;
    const foreground = this.state.foreground;
    const foregroundGen = this.state.foregroundGen + 1;
    this.state = { ...initial(actor ? Object.freeze({ ...actor }) : null), foreground, foregroundGen };
    if (packet) {
      this.uncertain = true;
      this.show({
        gameId: packet.gameId,
        command: { packet, status: 'unknown' },
        status: 'unknown',
        notice: COPY.errorOther,
        uncertain: true,
      });
    } else {
      this.show({});
    }
  }
  forget = () => {
    this.quarantined = null;
    this.holds.clear();
    this.clearPickerHandoff();
    this.uncertain = false;
    this.serial++;
    this.viewSerial++;
    this.state = initial();
    this.show({});
  };

  /**
   * Bearer headers only for exact /v1/media/game-covers/<64hex>.png on NATIVE_ORIGIN.
   * Venue fallback / public URLs stay credential-omit; never attach bearer to foreign hosts.
   */
  coverImageSource = (uploadedUrl: string | null | undefined): { uri: string; headers?: { Authorization: string } } | null => {
    const access = this.gate.accessToken();
    const gamePath = gameCoverMediaPath(uploadedUrl);
    if (gamePath) {
      if (!access || !this.state.actor) return null;
      return { uri: `${NATIVE_ORIGIN}${gamePath}`, headers: { Authorization: `Bearer ${access}` } };
    }
    const venuePath = publicCoverPath(uploadedUrl, 'venue');
    if (!venuePath) return null;
    return { uri: `${NATIVE_ORIGIN}${venuePath}` };
  };

  /**
   * App foreground fence. Background retires private view/previews and in-flight sending → UNKNOWN;
   * returning refreshes rights when focused without auto-mutation.
   * Expected picker handoff keeps actor/game/view binding; foregroundGen still invalidates mutations.
   */
  setForeground = (active: boolean) => {
    if (active === this.state.foreground) return;
    this.serial++;
    const foregroundGen = this.state.foregroundGen + 1;
    const focus = this.state.focus;
    const picker = this.expectingPickerHandoff();
    if (!active) {
      if (this.state.command?.status === 'sending') {
        this.uncertain = true;
        this.show({
          foreground: false,
          foregroundGen,
          command: { packet: this.state.command.packet, status: 'unknown' },
          status: 'unknown',
          notice: COPY.errorOther,
          error: coverError(0),
          uncertain: true,
        });
        return;
      }
      const unknown = this.state.command?.status === 'unknown' ? this.state.command : undefined;
      // During expected picker, keep access so UI can restore without wiping rights; draft clear is UI-side.
      this.show({
        foreground: false,
        foregroundGen,
        status: unknown ? 'unknown' : (picker ? (this.state.access ? 'ready' : 'idle') : 'idle'),
        access: unknown || picker ? this.state.access : null,
        notice: unknown ? COPY.errorOther : (picker ? this.state.notice : null),
        error: unknown ? coverError(0) : (picker ? this.state.error : null),
      });
      return;
    }
    const unknown = this.state.command?.status === 'unknown' ? this.state.command : undefined;
    this.show({
      foreground: true,
      foregroundGen,
      status: unknown ? 'unknown' : (focus ? (this.state.access ? 'ready' : 'idle') : this.state.status),
      notice: unknown ? COPY.errorOther : this.state.notice,
    });
    if (focus && !this.state.command && !this.uncertain && !picker) {
      void this.load(focus.gameId);
    }
  };

  /**
   * Bind editor view lease to a managed game. Release retires only this viewGen.
   * Parks unresolved work for another game; restores journaled hold on return.
   * Release converts in-flight sending → UNKNOWN; loading/preparation → reloadable idle/ready
   * so reopen does not stay busy forever after late results are ignored.
   */
  openView = (gameId: string): (() => void) => {
    const actor = this.state.actor;
    if (!actor || !gameId) return () => {};
    const viewGen = ++this.viewSerial;
    this.clearPickerHandoff();
    this.parkActiveIfNeeded(gameId);
    if (this.restoreHold(gameId)) {
      this.show({ focus: Object.freeze({ gameId, viewGen }) });
    } else if (this.state.gameId === gameId && (this.state.status === 'loading' || this.blocksEdits())) {
      this.show({ focus: Object.freeze({ gameId, viewGen }) });
    } else {
      this.show({ focus: Object.freeze({ gameId, viewGen }) });
      void this.load(gameId);
    }
    return () => {
      if (this.state.focus?.viewGen !== viewGen) return;
      this.serial++;
      this.clearPickerHandoff();
      if (this.state.command?.status === 'sending') {
        this.uncertain = true;
        this.show({
          focus: null,
          command: { packet: this.state.command.packet, status: 'unknown' },
          status: 'unknown',
          notice: COPY.errorOther,
          error: coverError(0),
          uncertain: true,
        });
        return;
      }
      const unknown = this.state.command?.status === 'unknown' ? this.state.command : undefined;
      const stuckRead = this.state.status === 'loading'
        || this.state.status === 'picking'
        || this.state.status === 'processing';
      this.show({
        focus: null,
        status: unknown ? 'unknown' : (stuckRead ? (this.state.access ? 'ready' : 'idle') : this.state.status),
        notice: unknown ? COPY.errorOther : this.state.notice,
        error: unknown ? coverError(0) : this.state.error,
      });
    };
  };

  /** @deprecated Prefer openView for lease; retained for focused load without sheet lease. */
  focus = (gameId: string) => {
    const actor = this.state.actor;
    if (!actor || !gameId) return;
    if (this.state.gameId === gameId && (this.state.status === 'loading' || this.blocksEdits())) return;
    this.parkActiveIfNeeded(gameId);
    if (this.restoreHold(gameId)) return;
    void this.load(gameId);
  };

  load = async (gameId: string, permit?: GameCoverRenderedPermit) => {
    const actor = this.state.actor;
    if (!actor || !gameId) return;
    if (permit && !this.permitLive(permit)) return;
    if (permit && permit.gameId !== gameId) return;
    // Never wipe another game's unresolved packet/key/version/bytes via a public load.
    this.parkActiveIfNeeded(gameId);
    if (this.restoreHold(gameId)) return;
    if (this.state.gameId === gameId && this.blocksEdits() && this.state.status !== 'loading') return;
    const serial = ++this.serial;
    const retired = () => serial !== this.serial || !this.current(actor) || this.state.gameId !== gameId;
    this.show({
      gameId, status: 'loading', access: null, command: undefined,
      notice: this.holds.size ? COPY.held : null, error: null, uncertain: false,
    });
    this.uncertain = false;
    try {
      const access = await this.port.read(gameId, actor);
      if (retired()) return;
      this.show({ status: 'ready', access, error: null, notice: this.holds.size ? COPY.held : null });
    } catch (error) {
      if (retired()) return;
      const denied = error instanceof ProfileError && [401, 403, 404].includes(error.status);
      this.show({
        status: denied ? 'denied' : 'idle',
        access: null,
        error: denied ? COPY.denied : COPY.errorOther,
        notice: null,
      });
    }
  };

  change = async (
    prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled'>,
    permit?: GameCoverRenderedPermit,
  ) => {
    await this.run('replace', prepare, permit);
  };
  remove = async (permit?: GameCoverRenderedPermit) => {
    await this.run('remove', async () => null, permit);
  };
  /** Uncertain path: authoritative GET only — never invent a mutation or auto-publish. */
  reconcile = async (permit?: GameCoverRenderedPermit) => {
    const actor = this.state.actor;
    const gameId = this.state.gameId;
    if (!actor || !gameId || this.busy()) return;
    if (permit && !this.permitLive(permit)) return;
    if (permit && permit.gameId !== gameId) return;
    const serial = ++this.serial;
    const retired = () => serial !== this.serial || !this.current(actor) || this.state.gameId !== gameId;
    this.show({ status: 'processing', notice: null, error: null });
    try {
      const receipt = await this.port.read(gameId, actor);
      if (retired()) return;
      this.uncertain = false;
      this.gate.onReceipt?.(gameId, receipt);
      this.show({
        command: undefined, status: 'ready', access: receipt,
        error: null, notice: COPY.refreshed, uncertain: false,
      });
    } catch {
      if (retired()) return;
      this.show({
        status: this.state.command ? 'unknown' : (this.state.access ? 'ready' : 'idle'),
        error: COPY.errorOther,
        notice: null,
      });
    }
  };
  retry = async (permit?: GameCoverRenderedPermit) => {
    const { actor, command } = this.state;
    // Exact same-session identity — never dispatch an old-session packet because actorId matches.
    if (!actor || !command || command.status !== 'unknown' || !sameActor(command.packet.actor, actor)) return;
    if (permit && !this.permitLive(permit)) return;
    if (permit && permit.gameId !== command.packet.gameId) return;
    await this.dispatch(command.packet, actor, permit);
  };
  private async run(
    action: GameCoverAction,
    prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled' | null>,
    permit?: GameCoverRenderedPermit,
  ) {
    const actor = this.state.actor;
    const gameId = this.state.gameId;
    const access = this.state.access;
    if (!actor || !gameId || !access || this.blocksEdits()) return;
    if (permit && !this.permitLive(permit)) return;
    if (permit && permit.gameId !== gameId) return;
    if (this.managementBlocked(gameId)) return;
    if (action === 'remove' && !access.hasCover) return;
    const serial = ++this.serial;
    const viewGen = this.state.focus?.viewGen;
    const foregroundGen = this.state.foregroundGen;
    const retired = () =>
      serial !== this.serial
      || !this.current(actor)
      || this.state.gameId !== gameId
      || (viewGen !== undefined && this.state.focus?.viewGen !== viewGen)
      || this.state.foregroundGen !== foregroundGen
      || !this.state.foreground;
    this.show({
      status: action === 'replace' ? 'picking' : 'processing',
      notice: null,
      error: null,
    });
    let derivative: AvatarDerivative | null = null;
    try {
      if (this.uncertain) {
        this.show({ status: 'processing' });
        const fresh = await this.port.read(gameId, actor);
        if (retired()) return;
        this.uncertain = false;
        this.show({ access: fresh, uncertain: false });
        this.gate.onReceipt?.(gameId, fresh);
      }
      const prepared = await prepare(retired);
      if (retired()) return;
      if (prepared === 'cancelled') {
        this.show({ status: 'ready', notice: null, error: null });
        return;
      }
      derivative = prepared;
      const current = this.state.access ?? access;
      if (this.managementBlocked(gameId)) {
        this.show({ status: 'ready', notice: null, error: COPY.errorOther });
        return;
      }
      const packet = freezeGameCoverPacket({
        actor,
        key: this.random(),
        gameId,
        action,
        gameVersion: current.version,
        derivative,
      });
      await this.dispatch(packet, actor, permit);
    } catch (error) {
      if (retired()) return;
      const message =
        error instanceof AvatarSourceError
          ? error.message
          : 'Не удалось подготовить фото. Выберите другое изображение.';
      this.show({ status: 'ready', command: undefined, error: message, notice: null });
    }
  }
  private async dispatch(packet: GameCoverPacket, authority: Actor, permit?: GameCoverRenderedPermit) {
    if (permit && !this.permitLive(permit)) return;
    if (this.managementBlocked(packet.gameId)) return;
    this.serial++;
    this.show({ command: { packet, status: 'sending' }, status: 'sending', notice: null, error: null });
    const viewGen = this.state.focus?.viewGen;
    const foregroundGen = this.state.foregroundGen;
    const valid = () =>
      this.current(authority)
      && this.state.gameId === packet.gameId
      && this.state.command?.packet === packet
      && this.state.command.status === 'sending'
      && this.state.foreground
      && this.state.foregroundGen === foregroundGen
      && (viewGen === undefined || this.state.focus?.viewGen === viewGen);
    try {
      const receipt = await this.port.mutate(packet, authority);
      if (!valid()) return;
      if (receipt.version < packet.gameVersion) throw new ProfileError('invalid');
      this.uncertain = false;
      this.gate.onReceipt?.(packet.gameId, receipt);
      // CURRENT replay: hasCover must gate success copy for both replace and remove.
      const notice = packet.action === 'remove'
        ? (receipt.hasCover ? COPY.currentOwn : COPY.removed)
        : receipt.hasCover
          ? COPY.saved
          : COPY.currentNoOwn;
      this.show({
        command: undefined,
        status: 'ready',
        access: receipt,
        notice,
        error: null,
        uncertain: false,
      });
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ProfileError && error.kind === 'business' && error.status === 409) {
        this.uncertain = true;
        this.show({
          command: undefined,
          status: 'ready',
          error: coverError(409),
          notice: null,
          uncertain: true,
        });
        return;
      }
      if (
        error instanceof ProfileError &&
        error.kind === 'business' &&
        error.status < 500 &&
        error.code !== 'COMMAND_IN_PROGRESS'
      ) {
        if ([401, 403, 404].includes(error.status)) {
          this.uncertain = false;
          this.show({
            command: undefined, status: 'denied', access: null,
            error: COPY.denied, notice: null, uncertain: false,
          });
          return;
        }
        this.uncertain = error.status === 409;
        this.show({
          command: undefined,
          status: 'ready',
          error: coverError(error.status),
          notice: null,
          uncertain: this.uncertain,
        });
        return;
      }
      // Network / invalid / 5xx / COMMAND_IN_PROGRESS: retain original packet until explicit reconcile
      // or exact same-session retry. Successful background GET must not clear uncertainty or authorize a write.
      this.uncertain = true;
      this.show({
        command: { packet, status: 'unknown' },
        status: 'unknown',
        notice: COPY.errorOther,
        error: coverError(error instanceof ProfileError ? error.status : 0),
        uncertain: true,
      });
    }
  }
}

export const GAME_COVER_EDITOR_COPY = {
  title: 'Фото этой игры',
  formats:
    'JPEG, PNG или WebP · до 10 МБ и 50 Мп, без анимации. На сервер отправляется только выбранный фрагмент (до 512 КиБ). Своё фото относится только к этой игре и не меняет площадку или другие игры.',
  fallback:
    'Без своего фото используется текущая одобренная обложка площадки, а если её нет — стандартная.',
  pick: 'Выбрать изображение',
  horizontal: 'По горизонтали',
  vertical: 'По вертикали',
  preparing: 'Готовим фрагмент…',
  previewCaption: 'В карточках будет показан широкий центральный фрагмент. Перед сохранением фото проверяется сервером.',
  confirmPick: 'Подтвердить выбор фото',
  saving: 'Проверяем и сохраняем фото…',
  reconciling: 'Проверяем фото…',
  save: 'Сохранить фото игры',
  remove: 'Удалить своё фото',
  reconcile: 'Обновить данные',
  cancel: 'Отмена',
  open: 'Изменить фото игры',
  loading: 'Проверяем право изменения фото…',
  retryLoad: 'Повторить проверку',
} as const;

/** Accepted-web CreateGamePage / GamePhotoSelection copy for optional creation photo. */
export const GAME_PHOTO_SELECTION_COPY = {
  sectionLabel: 'Фото этой игры',
  title: 'Фото этой игры · необязательно',
  explanation:
    'Без своего фото используется текущая одобренная обложка выбранной площадки, а если её нет — стандартная. Своё фото относится только к этой игре и не меняет площадку или другие игры.',
  confirmStatus: 'Фото выбрано. Оно будет проверено при сохранении игры.',
  omitStatus: 'Используется текущая обложка площадки или стандартная.',
  previewSelected: 'Выбрано своё фото этой игры. Перед публикацией сервер проверит изображение.',
  previewOmitted: 'Будет использована текущая одобренная обложка площадки или стандартная.',
  saveFailed:
    'Фото не сохранено или проверка не пройдена. Черновик сохранён, игра не опубликована. Повторите загрузку или удалите своё фото в сводке, затем опубликуйте черновик.',
  startExpiredAfterCreate: 'Начало уже прошло. Черновик сохранён, игра не опубликована.',
} as const;

/**
 * Create-game photo selection fence captured at render — generation + concrete selection
 * identity (asset/crop/preview). Handlers admit only when live state still matches.
 */
export type GamePhotoSelectionFence = Readonly<{
  generation: number;
  scope: string;
  assetUri: string | null;
  cropX: number;
  cropY: number;
  /** Referential preview-bytes identity from the rendering draft; null when none. */
  previewBytes: Readonly<{ bytes: Uint8Array; mime: string }> | null;
}>;

/** Live create-game photo selection + lifecycle flags rechecked at handler time. */
export type GamePhotoSelectionLiveState = Readonly<{
  mounted: boolean;
  foreground: boolean;
  disabled: boolean;
  generation: number;
  scope: string;
  assetUri: string | null;
  cropX: number;
  cropY: number;
  previewBytes: Readonly<{ bytes: Uint8Array; mime: string }> | null;
}>;

/**
 * Pure production admission for GamePhotoSelection confirm/pick/crop/reset callbacks.
 * Gen alone is insufficient: same-scope new pick/crop/reset must reject stale confirm
 * carrying an older preview/asset/crop identity.
 */
export function gamePhotoSelectionLive(
  fence: GamePhotoSelectionFence,
  live: GamePhotoSelectionLiveState,
): boolean {
  return live.mounted
    && live.foreground
    && !live.disabled
    && live.generation === fence.generation
    && live.scope === fence.scope
    && live.assetUri === fence.assetUri
    && live.cropX === fence.cropX
    && live.cropY === fence.cropY
    && live.previewBytes === fence.previewBytes;
}
