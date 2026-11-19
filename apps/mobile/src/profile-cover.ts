import { sameActor, type Actor } from './participation.ts';
import { ownCoverPath } from './media.ts';
import { NATIVE_ORIGIN } from './native-auth-protocol.ts';
import {
  ProfileError,
  type CoverReceipt,
  type OwnCover,
  type OwnProfile,
} from './profile.ts';
import {
  AvatarSourceError,
  cloneDerivativeBytes,
  type AvatarDerivative,
} from './profile-avatar.ts';

export type { CoverReceipt, OwnCover };

export type CoverAction = 'replace' | 'remove';
export type CoverPacket = Readonly<{
  actor: Readonly<Actor>;
  key: string;
  action: CoverAction;
  profileVersion: number;
  derivative: AvatarDerivative | null;
}>;
export type CoverPort = {
  mutate: (packet: CoverPacket, authority: Actor) => Promise<CoverReceipt>;
  reconcile: (authority: Actor) => Promise<CoverReceipt>;
};
export type CoverSnapshot = {
  actor: Actor | null;
  status: 'idle' | 'picking' | 'processing' | 'sending' | 'unknown';
  command?: { packet: CoverPacket; status: 'sending' | 'unknown' };
  notice: string | null;
  error: string | null;
  uncertain: boolean;
};

export function freezeCoverPacket(input: {
  actor: Actor;
  key: string;
  action: CoverAction;
  profileVersion: number;
  derivative: AvatarDerivative | null;
}): CoverPacket {
  const derivative = input.derivative
    ? Object.freeze({
        mime: input.derivative.mime,
        bytes: cloneDerivativeBytes(input.derivative.bytes),
      })
    : null;
  return Object.freeze({
    actor: Object.freeze({ ...input.actor }),
    key: input.key,
    action: input.action,
    profileVersion: input.profileVersion,
    derivative,
  });
}

type CoverGate = {
  isTextBusy: () => boolean;
  currentProfile: () => OwnProfile | null;
  applyReceipt: (receipt: CoverReceipt) => void;
  accessToken: () => string | null;
};

const initial = (): CoverSnapshot => ({
  actor: null, status: 'idle', notice: null, error: null, uncertain: false,
});

const COVER_ERROR_429 = 'Слишком много попыток. Попробуйте позже.';
const COVER_ERROR_422 = 'Обложка не прошла проверку. Выберите другое фото.';
const COVER_ERROR_OTHER = 'Сохранение не подтверждено. Обновите данные перед повтором.';
const COVER_SAVED = 'Обложка сохранена.';
const COVER_REMOVED = 'Обложка удалена. Используется стандартное оформление.';
const coverError = (status: number) =>
  status === 429 ? COVER_ERROR_429 : status === 422 ? COVER_ERROR_422 : COVER_ERROR_OTHER;

/** Root-lifetime cover owner. One packet per dispatch; uncertain → ownCover GET only. */
export class ProfileCoverCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private serial = 0;
  private uncertain = false;
  private quarantined: CoverPacket | null = null;
  private readonly port: CoverPort;
  private readonly random: () => string;
  private readonly gate: CoverGate;
  constructor(port: CoverPort, random: () => string, gate: CoverGate) {
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
  private show(p: Partial<CoverSnapshot>) {
    this.state = { ...this.state, ...p, uncertain: p.uncertain ?? this.uncertain };
    this.listeners.forEach(f => f());
  }
  private current(actor: Actor) {
    return sameActor(actor, this.state.actor);
  }
  busy = () =>
    this.state.status === 'picking' ||
    this.state.status === 'processing' ||
    this.state.command?.status === 'sending';
  blocksEdits = () =>
    this.busy() || this.state.status === 'unknown' || this.state.command?.status === 'unknown';
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
            command: { packet, status: 'unknown' as const },
            status: 'unknown' as const,
            notice: COVER_ERROR_OTHER,
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
  /** Validated own cover path on NATIVE_ORIGIN with bearer headers; token never in URI. */
  coverImageSource = (uploadedUrl: string | null | undefined): { uri: string; headers: { Authorization: string } } | null => {
    const access = this.gate.accessToken();
    const path = ownCoverPath(uploadedUrl);
    if (!access || !this.state.actor || !path) return null;
    return {
      uri: `${NATIVE_ORIGIN}${path}`,
      headers: { Authorization: `Bearer ${access}` },
    };
  };
  change = async (prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled'>) => {
    await this.run('replace', prepare);
  };
  remove = async () => {
    await this.run('remove', async () => null);
  };
  /** Uncertain path: authoritative GET /me/cover only — never invent a new mutation. */
  reconcile = async () => {
    const actor = this.state.actor;
    const profile = this.gate.currentProfile();
    if (!actor || !profile || this.busy() || this.gate.isTextBusy()) return;
    const serial = ++this.serial;
    const retired = () => serial !== this.serial || !this.current(actor);
    this.show({ status: 'processing', notice: null, error: null });
    try {
      const receipt = await this.port.reconcile(actor);
      if (retired()) return;
      this.uncertain = false;
      if (receipt.version >= (this.gate.currentProfile()?.version ?? profile.version)) {
        this.gate.applyReceipt(receipt);
      }
      this.show({ command: undefined, status: 'idle', error: null, notice: null });
    } catch {
      if (retired()) return;
      this.show({
        status: this.state.command ? 'unknown' : 'idle',
        error: COVER_ERROR_OTHER,
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
    action: CoverAction,
    prepare: (retired: () => boolean) => Promise<AvatarDerivative | 'cancelled' | null>,
  ) {
    const actor = this.state.actor;
    const profile = this.gate.currentProfile();
    if (!actor || !profile || this.blocksEdits() || this.gate.isTextBusy()) return;
    if (action === 'remove' && !profile.cover?.uploadedUrl) return;
    const serial = ++this.serial;
    const retired = () => serial !== this.serial || !this.current(actor);
    this.show({
      status: action === 'replace' ? 'picking' : 'processing',
      notice: null,
      error: null,
    });
    let derivative: AvatarDerivative | null = null;
    try {
      if (this.uncertain) {
        this.show({ status: 'processing' });
        const fresh = await this.port.reconcile(actor);
        if (retired()) return;
        this.uncertain = false;
        this.gate.applyReceipt(fresh);
      }
      const prepared = await prepare(retired);
      if (retired()) return;
      if (prepared === 'cancelled') {
        this.show({ status: 'idle', notice: null, error: null });
        return;
      }
      derivative = prepared;
      const packet = freezeCoverPacket({
        actor,
        key: this.random(),
        action,
        profileVersion: this.gate.currentProfile()?.version ?? profile.version,
        derivative,
      });
      await this.dispatch(packet, actor);
    } catch (error) {
      if (retired()) return;
      const message =
        error instanceof AvatarSourceError
          ? error.message
          : 'Не удалось подготовить обложку. Выберите другое фото.';
      this.show({ status: 'idle', command: undefined, error: message, notice: null });
    }
  }
  private async dispatch(packet: CoverPacket, authority: Actor) {
    this.serial++;
    this.show({ command: { packet, status: 'sending' }, status: 'sending', notice: null, error: null });
    const valid = () =>
      this.current(authority) && this.state.command?.packet === packet && this.state.command.status === 'sending';
    try {
      const receipt = await this.port.mutate(packet, authority);
      if (!valid()) return;
      if (receipt.version < packet.profileVersion) throw new ProfileError('invalid');
      this.uncertain = false;
      this.gate.applyReceipt(receipt);
      this.show({
        command: undefined,
        status: 'idle',
        notice: packet.action === 'replace' ? COVER_SAVED : COVER_REMOVED,
        error: null,
      });
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ProfileError && error.kind === 'business' && error.status === 409) {
        this.uncertain = true;
        this.show({
          command: undefined,
          status: 'idle',
          error: coverError(409),
          notice: null,
        });
        return;
      }
      if (
        error instanceof ProfileError &&
        error.kind === 'business' &&
        error.status < 500 &&
        error.code !== 'COMMAND_IN_PROGRESS'
      ) {
        this.uncertain = error.status === 0 || error.status >= 500 || error.status === 409;
        this.show({
          command: undefined,
          status: 'idle',
          error: coverError(error.status),
          notice: null,
        });
        return;
      }
      this.uncertain = true;
      try {
        const fresh = await this.port.reconcile(authority);
        if (!valid()) return;
        this.uncertain = false;
        this.gate.applyReceipt(fresh);
        this.show({
          command: undefined,
          status: 'idle',
          error: coverError(error instanceof ProfileError ? error.status : 0),
          notice: null,
        });
      } catch {
        if (!valid()) return;
        this.show({
          command: { packet, status: 'unknown' },
          status: 'unknown',
          notice: COVER_ERROR_OTHER,
          error: coverError(0),
        });
      }
    }
  }
}
