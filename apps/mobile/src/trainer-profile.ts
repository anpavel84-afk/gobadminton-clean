import { sameActor, type Actor } from './participation.ts';
import { ProfileError, type OwnProfile } from './profile.ts';

/** Native input caps — service name≤80; contract bio≤1000 (service allows more; do not rewrite server). */
export const TRAINER_NAME_MAX = 80 as const;
export const TRAINER_BIO_MAX = 1000 as const;

export type TrainerProfile = Readonly<{
  id: string;
  version: number;
  displayName: string;
  bio: string | null;
  declarationSource: 'self_declared';
  declaredAt: string;
  status: 'active' | 'inactive';
}>;

export type TrainerDraft = Readonly<{ displayName: string; bio: string }>;

export type TrainerUpsertBody = Readonly<{
  selfDeclared: true;
  displayName: string;
  bio: string | null;
  expectedVersion?: number;
}>;

export type TrainerPacket = Readonly<{ actor: Readonly<Actor>; key: string } & (
  | { kind: 'upsert'; body: TrainerUpsertBody }
  | { kind: 'deactivate'; body: Readonly<{ expectedVersion: number }> }
)>;

export type TrainerPort = {
  read: () => Promise<TrainerProfile | null>;
  send: (packet: TrainerPacket, authority: Actor) => Promise<TrainerProfile>;
  refreshSocial: (authority: Actor) => Promise<OwnProfile>;
};

export type TrainerPeers = {
  isPeerBusy?: () => boolean;
  accountDisplayName?: () => string;
  applySocial?: (fresh: OwnProfile) => void;
  invalidateGameTrainer?: () => void;
};

export type TrainerSnapshot = {
  actor: Actor | null;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'stale';
  trainer: TrainerProfile | null;
  draft: TrainerDraft;
  command?: { packet: TrainerPacket; status: 'sending' | 'unknown' };
  notice: string | null;
};

const emptyDraft = (): TrainerDraft => Object.freeze({ displayName: '', bio: '' });
const initial = (actor: Actor | null = null): TrainerSnapshot => ({
  actor, status: 'idle', trainer: null, draft: emptyDraft(), notice: null,
});
const unknownNotice = (packet: TrainerPacket) => packet.kind === 'deactivate'
  ? 'Пока не удалось подтвердить изменение. Проверка повторит только прежнее отключение с тем же ключом. Новые изменения пока недоступны.'
  : 'Пока не удалось подтвердить изменение. Проверка повторит только прежнее сохранение с теми же данными и ключом. Новые изменения пока недоступны.';

const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ProfileError('invalid');
  return v as Record<string, unknown>;
};

export function parseTrainerProfile(value: unknown): TrainerProfile {
  const r = row(value);
  if (typeof r.id !== 'string' || !r.id) throw new ProfileError('invalid');
  if (!Number.isInteger(r.version) || Number(r.version) < 1) throw new ProfileError('invalid');
  if (typeof r.displayName !== 'string' || !r.displayName) throw new ProfileError('invalid');
  if (!(r.bio === null || typeof r.bio === 'string')) throw new ProfileError('invalid');
  if (r.declarationSource !== 'self_declared') throw new ProfileError('invalid');
  if (typeof r.declaredAt !== 'string' || !r.declaredAt) throw new ProfileError('invalid');
  if (r.status !== 'active' && r.status !== 'inactive') throw new ProfileError('invalid');
  return Object.freeze({
    id: r.id,
    version: r.version as number,
    displayName: r.displayName,
    bio: r.bio as string | null,
    declarationSource: 'self_declared',
    declaredAt: r.declaredAt,
    status: r.status,
  });
}

export function trainerUpsertWire(body: TrainerUpsertBody): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    selfDeclared: true,
    displayName: body.displayName,
    bio: body.bio,
  };
  if (body.expectedVersion !== undefined) wire.expectedVersion = body.expectedVersion;
  return wire;
}

export function trainerDeactivateWire(expectedVersion: number): Record<string, unknown> {
  return { expectedVersion };
}

export function trainerDraftFrom(trainer: TrainerProfile | null, accountDisplayName: string): TrainerDraft {
  if (trainer) {
    return Object.freeze({ displayName: trainer.displayName, bio: trainer.bio ?? '' });
  }
  return Object.freeze({ displayName: accountDisplayName.trim(), bio: '' });
}

export function trainerActive(trainer: TrainerProfile | null | undefined): boolean {
  return trainer?.status === 'active';
}

/** Root-shared own trainer editor: pending command survives unmount; never auto-writes. */
export class TrainerProfileCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private serial = 0;
  /** True after a successful seed or user edit — empty draft from a failed first read is not preserved. */
  private draftInitialized = false;
  private quarantine: { actorId: string; packet?: TrainerPacket; draft: TrainerDraft; trainer: TrainerProfile | null } | null = null;
  private port: TrainerPort;
  private random: () => string;
  private peers: Required<Pick<TrainerPeers, 'isPeerBusy' | 'accountDisplayName'>> & TrainerPeers;

  constructor(port: TrainerPort, random: () => string, peers: TrainerPeers = {}) {
    this.port = port;
    this.random = random;
    this.peers = {
      isPeerBusy: peers.isPeerBusy ?? (() => false),
      accountDisplayName: peers.accountDisplayName ?? (() => ''),
      applySocial: peers.applySocial,
      invalidateGameTrainer: peers.invalidateGameTrainer,
    };
  }

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<TrainerSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  private current(actor: Actor | null) { return sameActor(actor, this.state.actor); }
  private locked() {
    return !!this.state.command || this.state.status === 'stale' || this.peers.isPeerBusy();
  }
  blocksMutations = () => !!this.state.command || this.state.status === 'stale';

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || !actor && !this.state.actor) return;
    if (this.state.actor) {
      this.quarantine = {
        actorId: this.state.actor.actorId,
        packet: this.state.command?.packet,
        draft: this.state.draft,
        trainer: this.state.trainer,
      };
    }
    if (actor && this.quarantine?.actorId !== actor.actorId) this.quarantine = null;
    const saved = actor ? this.quarantine : null;
    if (actor) this.quarantine = null;
    this.serial++;
    this.draftInitialized = false;
    this.state = initial(actor ? Object.freeze({ ...actor }) : null);
    if (saved) {
      const restoredPacket = saved.packet
        ? Object.freeze({ ...saved.packet, actor: Object.freeze({ ...actor }) }) as TrainerPacket
        : undefined;
      this.draftInitialized = true;
      this.show({
        draft: saved.draft,
        trainer: saved.trainer,
        ...(restoredPacket ? {
          command: { packet: restoredPacket, status: 'unknown' as const },
          notice: unknownNotice(restoredPacket),
        } : {}),
      });
    }
  }

  forget = () => {
    this.quarantine = null;
    this.serial++;
    this.draftInitialized = false;
    this.state = initial();
    this.show({});
  };

  updateDraft = (patch: Partial<TrainerDraft>) => {
    if (!this.state.actor || this.locked()) return;
    this.draftInitialized = true;
    this.show({
      draft: Object.freeze({
        displayName: patch.displayName ?? this.state.draft.displayName,
        bio: patch.bio ?? this.state.draft.bio,
      }),
      notice: null,
    });
  };

  /** Explicit read only — never writes; preserves unsaved draft text across in-place refresh. */
  load = async (options?: { preserveDraft?: boolean }) => {
    const actor = this.state.actor;
    if (!actor || this.state.command || this.state.status === 'loading' || this.peers.isPeerBusy()) return;
    const serial = ++this.serial;
    const preserveDraft = options?.preserveDraft === true
      || this.state.status === 'ready'
      || this.state.status === 'stale'
      || (this.state.status === 'error' && this.draftInitialized);
    const priorDraft = this.state.draft;
    this.show({ status: 'loading', notice: null });
    try {
      const trainer = await this.port.read();
      if (!this.current(actor) || serial !== this.serial) return;
      this.draftInitialized = true;
      this.show({
        trainer,
        draft: preserveDraft ? priorDraft : trainerDraftFrom(trainer, this.peers.accountDisplayName()),
        status: 'ready',
        notice: null,
      });
    } catch {
      if (this.current(actor) && serial === this.serial) {
        this.show({
          status: 'error',
          draft: priorDraft,
          notice: 'Не удалось загрузить профиль тренера',
        });
      }
    }
  };

  /** After 409: authoritative GET; keep user text; require fresh version before new command. */
  refreshAuthoritative = async () => {
    const actor = this.state.actor;
    if (!actor || this.state.command || this.peers.isPeerBusy()) return;
    if (this.state.status !== 'stale' && this.state.status !== 'ready' && this.state.status !== 'error') return;
    const serial = ++this.serial;
    const priorDraft = this.state.draft;
    this.show({ status: 'loading', notice: null });
    try {
      const trainer = await this.port.read();
      if (!this.current(actor) || serial !== this.serial) return;
      this.draftInitialized = true;
      this.show({
        trainer,
        draft: priorDraft,
        status: 'ready',
        notice: 'Данные обновлены. Проверьте текст перед новым сохранением.',
      });
    } catch {
      if (this.current(actor) && serial === this.serial) {
        this.show({
          status: 'stale',
          draft: priorDraft,
          notice: 'Не удалось обновить данные. Введённый текст сохранён — повторите обновление.',
        });
      }
    }
  };

  save = async () => {
    const { actor, trainer, draft, status, command } = this.state;
    if (!actor || command || status !== 'ready' || this.peers.isPeerBusy()) return;
    const displayName = draft.displayName.trim();
    if (!displayName || displayName.length > TRAINER_NAME_MAX) {
      this.show({ notice: `Имя тренера — от 1 до ${TRAINER_NAME_MAX} символов.` });
      return;
    }
    const bioRaw = draft.bio.trim();
    if (bioRaw.length > TRAINER_BIO_MAX) {
      this.show({ notice: `Коротко о себе — до ${TRAINER_BIO_MAX} символов.` });
      return;
    }
    const body: TrainerUpsertBody = Object.freeze({
      selfDeclared: true as const,
      displayName,
      bio: bioRaw.length ? bioRaw : null,
      ...(trainer ? { expectedVersion: trainer.version } : {}),
    });
    const packet: TrainerPacket = Object.freeze({
      kind: 'upsert' as const,
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      body,
    });
    await this.dispatch(packet, actor);
  };

  deactivate = async () => {
    const { actor, trainer, status, command } = this.state;
    if (!actor || !trainer || trainer.status !== 'active' || command || status !== 'ready' || this.peers.isPeerBusy()) return;
    const packet: TrainerPacket = Object.freeze({
      kind: 'deactivate' as const,
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      body: Object.freeze({ expectedVersion: trainer.version }),
    });
    await this.dispatch(packet, actor);
  };

  reconcile = async () => {
    const { actor, command } = this.state;
    if (!actor || !command || command.status !== 'unknown') return;
    if (command.packet.actor.actorId !== actor.actorId) return;
    await this.dispatch(command.packet, actor);
  };

  private async dispatch(packet: TrainerPacket, authority: Actor) {
    this.serial++;
    this.show({ command: { packet, status: 'sending' }, notice: null });
    const valid = () => this.current(authority) && this.state.command?.packet === packet && this.state.command.status === 'sending';
    // Write ACK validated → recovery reads are not mutation rejection (Looking-style lock until current wins).
    let writeAcked = false;
    try {
      const ack = await this.port.send(packet, authority);
      if (!valid()) return;
      if (packet.kind === 'upsert') {
        if (ack.status !== 'active') throw new ProfileError('invalid');
        if (ack.displayName !== packet.body.displayName) throw new ProfileError('invalid');
        if ((ack.bio ?? null) !== (packet.body.bio ?? null)) throw new ProfileError('invalid');
        if (packet.body.expectedVersion !== undefined && ack.version <= packet.body.expectedVersion) throw new ProfileError('invalid');
        if (packet.body.expectedVersion === undefined && ack.version < 1) throw new ProfileError('invalid');
      } else if (ack.status !== 'inactive') {
        // Deactivate must yield inactive; otherwise force explicit refresh.
        this.show({
          trainer: ack,
          draft: this.state.draft,
          command: undefined,
          status: 'stale',
          notice: 'Проверьте статус профиля тренера после обновления.',
        });
        return;
      } else if (ack.version <= packet.body.expectedVersion) {
        throw new ProfileError('invalid');
      }
      writeAcked = true;
      // Original packet ACK is historical only — current trainer GET wins before unlock (Looking recovery).
      const current = await this.port.read();
      if (!valid()) return;
      const social = await this.port.refreshSocial(authority);
      if (!valid()) return;
      this.peers.applySocial?.(social);
      this.draftInitialized = true;
      this.show({
        trainer: current,
        draft: trainerDraftFrom(current, this.peers.accountDisplayName()),
        command: undefined,
        status: 'ready',
        notice: packet.kind === 'deactivate'
          ? 'Профиль тренера отключён.'
          : 'Профиль тренера сохранён.',
      });
      this.peers.invalidateGameTrainer?.();
    } catch (error) {
      if (!valid()) return;
      // Rejected write only — post-ACK current/social failures (incl. business 429/403) stay locked UNKNOWN.
      if (!writeAcked
        && error instanceof ProfileError
        && error.kind === 'business'
        && error.status < 500
        && error.code !== 'COMMAND_IN_PROGRESS') {
        const stale = error.status === 409;
        this.show({
          command: undefined,
          status: stale ? 'stale' : 'ready',
          notice: stale
            ? 'Профиль тренера изменился. Обновите данные — введённый текст сохранится.'
            : packet.kind === 'deactivate'
              ? 'Не удалось отключить профиль тренера. Проверьте статус и повторите.'
              : error.code === 'PUBLIC_TEXT_CONTENT_REJECTED'
                ? 'Изменения не сохранены. Проверьте публичный текст или повторите позже. Введённые данные сохранены.'
                : 'Не удалось сохранить профиль тренера. Проверьте поля и повторите.',
        });
      } else {
        this.show({ command: { packet, status: 'unknown' }, notice: unknownNotice(packet) });
      }
    }
  }
}
