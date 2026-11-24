import { sameActor, type Actor } from './participation.ts';
import { publicCoverPath } from './media.ts';
import { NATIVE_ORIGIN } from './native-auth-protocol.ts';
import { ProfileError } from './profile.ts';
import {
  AvatarSourceError,
  cloneDerivativeBytes,
  type AvatarDerivative,
} from './profile-avatar.ts';

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

export type GameCoverSnapshot = {
  actor: Actor | null;
  gameId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'denied' | 'picking' | 'processing' | 'sending' | 'unknown';
  access: GameCoverReceipt | null;
  command?: { packet: GameCoverPacket; status: 'sending' | 'unknown' };
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
  return Object.freeze({
    version: row.version as number,
    hasCover: row.hasCover,
    cover: Object.freeze({ uploadedUrl }),
  });
}

/** Exact game-covers path only — bearer never attaches to venue/fallback or foreign URLs. */
export function gameCoverMediaPath(value: unknown): string | null {
  return publicCoverPath(value, 'game');
}

const initial = (): GameCoverSnapshot => ({
  actor: null, gameId: null, status: 'idle', access: null,
  notice: null, error: null, uncertain: false,
});

const COPY = {
  error429: 'Слишком много попыток. Попробуйте позже.',
  error422: 'Фото не прошло проверку. Выберите другое изображение.',
  errorOther: 'Сохранение не подтверждено. Обновите данные перед повторной попыткой; игра не публикуется автоматически.',
  saved: 'Фото игры проверено и сохранено.',
  removed: 'Своё фото удалено. Используется текущая обложка площадки или стандартная.',
  refreshed: 'Данные обновлены. Можно повторить сохранение.',
  denied: 'Редактирование фото недоступно. Обновите страницу и проверьте вход.',
} as const;

const coverError = (status: number) =>
  status === 429 ? COPY.error429 : status === 422 ? COPY.error422 : COPY.errorOther;

type GameCoverGate = {
  /** Refresh managed detail after a known receipt so later publish uses the new game version. */
  onReceipt?: (gameId: string, receipt: GameCoverReceipt) => void;
  accessToken: () => string | null;
};

/**
 * Root-lifetime managed-game photo owner.
 * One packet per dispatch; uncertain → authoritative GET only; hasCover gates remove (not venue URL).
 */
export class GameCoverCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private serial = 0;
  private uncertain = false;
  private quarantined: GameCoverPacket | null = null;
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
    this.state = { ...this.state, ...p, uncertain: p.uncertain ?? this.uncertain };
    this.listeners.forEach(f => f());
  }
  private current(actor: Actor) {
    return sameActor(actor, this.state.actor);
  }
  busy = () =>
    this.state.status === 'picking' ||
    this.state.status === 'processing' ||
    this.state.status === 'loading' ||
    this.state.command?.status === 'sending';
  blocksEdits = () =>
    this.busy() || this.state.status === 'unknown' || this.state.command?.status === 'unknown' || this.uncertain;
  /** Unresolved cover work blocks incompatible managed publish/roster writes for this game. */
  blocksManagedWrites = (gameId: string) =>
    !!gameId && this.state.gameId === gameId && this.blocksEdits();
  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || (!actor && !this.state.actor)) return;
    if (this.state.command) this.quarantined = this.state.command.packet;
    if (actor && this.quarantined?.actor.actorId !== actor.actorId) this.quarantined = null;
    const packet = actor ? this.quarantined : null;
    if (actor) this.quarantined = null;
    this.serial++;
    this.uncertain = false;
    this.state = initial();
    this.show({
      actor: actor ? Object.freeze({ ...actor }) : null,
      ...(packet
        ? {
            gameId: packet.gameId,
            command: { packet, status: 'unknown' as const },
            status: 'unknown' as const,
            notice: COPY.errorOther,
          }
        : {}),
    });
  }
  forget = () => {
    this.quarantined = null;
    this.uncertain = false;
    this.serial++;
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
  focus = (gameId: string) => {
    const actor = this.state.actor;
    if (!actor || !gameId) return;
    // Keep unresolved UNKNOWN / in-flight work; otherwise (re)load access for this managed game.
    if (this.state.gameId === gameId && (this.state.status === 'loading' || this.blocksEdits())) return;
    void this.load(gameId);
  };
  load = async (gameId: string) => {
    const actor = this.state.actor;
    if (!actor || !gameId) return;
    const serial = ++this.serial;
    const retired = () => serial !== this.serial || !this.current(actor) || this.state.gameId !== gameId;
    this.uncertain = false;
    this.show({
      gameId, status: 'loading', access: null, command: undefined,
      notice: null, error: null, uncertain: false,
    });
    try {
      const access = await this.port.read(gameId, actor);
      if (retired()) return;
      this.show({ status: 'ready', access, error: null, notice: null });
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
  change = async (prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled'>) => {
    await this.run('replace', prepare);
  };
  remove = async () => {
    await this.run('remove', async () => null);
  };
  /** Uncertain path: authoritative GET only — never invent a mutation or auto-publish. */
  reconcile = async () => {
    const actor = this.state.actor;
    const gameId = this.state.gameId;
    if (!actor || !gameId || this.busy()) return;
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
  retry = async () => {
    const { actor, command } = this.state;
    if (actor && command?.status === 'unknown' && command.packet.actor.actorId === actor.actorId) {
      await this.dispatch(command.packet, actor);
    }
  };
  private async run(
    action: GameCoverAction,
    prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled' | null>,
  ) {
    const actor = this.state.actor;
    const gameId = this.state.gameId;
    const access = this.state.access;
    if (!actor || !gameId || !access || this.blocksEdits()) return;
    if (action === 'remove' && !access.hasCover) return;
    const serial = ++this.serial;
    const retired = () => serial !== this.serial || !this.current(actor) || this.state.gameId !== gameId;
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
      const packet = freezeGameCoverPacket({
        actor,
        key: this.random(),
        gameId,
        action,
        gameVersion: current.version,
        derivative,
      });
      await this.dispatch(packet, actor);
    } catch (error) {
      if (retired()) return;
      const message =
        error instanceof AvatarSourceError
          ? error.message
          : 'Не удалось подготовить фото. Выберите другое изображение.';
      this.show({ status: 'ready', command: undefined, error: message, notice: null });
    }
  }
  private async dispatch(packet: GameCoverPacket, authority: Actor) {
    this.serial++;
    this.show({ command: { packet, status: 'sending' }, status: 'sending', notice: null, error: null });
    const valid = () =>
      this.current(authority) &&
      this.state.gameId === packet.gameId &&
      this.state.command?.packet === packet &&
      this.state.command.status === 'sending';
    try {
      const receipt = await this.port.mutate(packet, authority);
      if (!valid()) return;
      if (receipt.version < packet.gameVersion) throw new ProfileError('invalid');
      this.uncertain = false;
      this.gate.onReceipt?.(packet.gameId, receipt);
      this.show({
        command: undefined,
        status: 'ready',
        access: receipt,
        notice: packet.action === 'replace' ? COPY.saved : COPY.removed,
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
        this.uncertain = error.status === 0 || error.status >= 500 || error.status === 409;
        this.show({
          command: undefined,
          status: 'ready',
          error: coverError(error.status),
          notice: null,
        });
        return;
      }
      this.uncertain = true;
      try {
        const fresh = await this.port.read(packet.gameId, authority);
        if (!valid()) return;
        this.uncertain = false;
        this.gate.onReceipt?.(packet.gameId, fresh);
        this.show({
          command: undefined,
          status: 'ready',
          access: fresh,
          error: coverError(error instanceof ProfileError ? error.status : 0),
          notice: null,
          uncertain: false,
        });
      } catch {
        if (!valid()) return;
        this.show({
          command: { packet, status: 'unknown' },
          status: 'unknown',
          notice: COPY.errorOther,
          error: coverError(0),
          uncertain: true,
        });
      }
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
} as const;
