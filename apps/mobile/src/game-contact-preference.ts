import type { GamePreferences } from '@gobadminton/contracts/game-types';
import { ParticipationError, sameActor, type Actor } from './participation.ts';
import { parsePreferences } from './game-management.ts';

/** Server/web contact cap — trim then length 1…320; empty draft is never save(null). */
export const GAME_CONTACT_MAX = 320 as const;

export type GameContactPacket = Readonly<{
  actor: Readonly<Actor>;
  key: string;
  body: Readonly<{ expectedVersion: number; defaultPublicGameContact: string | null }>;
}>;

export type GameContactPort = {
  read: () => Promise<GamePreferences>;
  send: (packet: GameContactPacket, authority: Actor) => Promise<GamePreferences>;
};

export type GameContactSnapshot = {
  actor: Actor | null;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'stale';
  preference: GamePreferences | null;
  draft: string;
  command?: { packet: GameContactPacket; status: 'sending' | 'unknown' };
  notice: string | null;
};

const initial = (actor: Actor | null = null): GameContactSnapshot => ({
  actor, status: 'idle', preference: null, draft: '', notice: null,
});

const unknownNotice = 'Пока не удалось подтвердить изменение. Проверка повторит только прежнюю команду с тем же ключом и данными. Новые изменения пока недоступны.';

export function gameContactPreferenceWire(
  body: Readonly<{ expectedVersion: number; defaultPublicGameContact: string | null }>,
): Record<string, unknown> {
  return {
    expectedVersion: body.expectedVersion,
    defaultPublicGameContact: body.defaultPublicGameContact,
  };
}

export function canSaveGameContact(draft: string, preference: GamePreferences | null): boolean {
  const trimmed = draft.trim();
  if (!preference || !trimmed || trimmed.length > GAME_CONTACT_MAX) return false;
  return trimmed !== (preference.defaultPublicGameContact ?? '');
}

export function canRemoveGameContact(preference: GamePreferences | null): boolean {
  return preference?.defaultPublicGameContact != null;
}

/** Own saved public game-contact template. Explicit load/save/remove only; never auto-writes. */
export class GameContactPreferenceCoordinator {
  private state = initial();
  private listeners = new Set<() => void>();
  private serial = 0;
  private draftInitialized = false;
  private quarantine: {
    actorId: string;
    packet?: GameContactPacket;
    draft: string;
    preference: GamePreferences | null;
  } | null = null;
  private port: GameContactPort;
  private random: () => string;

  constructor(port: GameContactPort, random: () => string) {
    this.port = port;
    this.random = random;
  }

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<GameContactSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }
  private current(actor: Actor | null) { return sameActor(actor, this.state.actor); }
  private locked() {
    return !!this.state.command || this.state.status === 'stale' || this.state.status === 'loading';
  }
  blocksMutations = () => !!this.state.command || this.state.status === 'stale';

  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || !actor && !this.state.actor) return;
    if (this.state.actor) {
      this.quarantine = {
        actorId: this.state.actor.actorId,
        packet: this.state.command?.packet,
        draft: this.state.draft,
        preference: this.state.preference,
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
        ? Object.freeze({ ...saved.packet, actor: Object.freeze({ ...actor }) }) as GameContactPacket
        : undefined;
      this.draftInitialized = true;
      this.show({
        draft: saved.draft,
        preference: saved.preference,
        ...(restoredPacket ? {
          command: { packet: restoredPacket, status: 'unknown' as const },
          notice: unknownNotice,
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

  updateDraft = (value: string) => {
    if (!this.state.actor || this.locked()) return;
    this.draftInitialized = true;
    this.show({ draft: value.slice(0, GAME_CONTACT_MAX), notice: null });
  };

  /** Explicit read only — never writes; preserves unsaved draft across in-place refresh. */
  load = async (options?: { preserveDraft?: boolean }) => {
    const actor = this.state.actor;
    if (!actor || this.state.command || this.state.status === 'loading') return;
    const serial = ++this.serial;
    const preserveDraft = options?.preserveDraft === true
      || this.state.status === 'ready'
      || this.state.status === 'stale'
      || (this.state.status === 'error' && this.draftInitialized);
    const priorDraft = this.state.draft;
    this.show({ status: 'loading', notice: null });
    try {
      const preference = parsePreferences(await this.port.read());
      if (!this.current(actor) || serial !== this.serial) return;
      this.draftInitialized = true;
      this.show({
        preference,
        draft: preserveDraft ? priorDraft : (preference.defaultPublicGameContact ?? ''),
        status: 'ready',
        notice: null,
      });
    } catch {
      if (this.current(actor) && serial === this.serial) {
        this.show({
          status: 'error',
          draft: priorDraft,
          notice: 'Не удалось загрузить контакт. Можно указать его при создании игры.',
        });
      }
    }
  };

  /** After 409: authoritative GET; keep user text; require fresh version before new command. */
  refreshAuthoritative = async () => {
    const actor = this.state.actor;
    if (!actor || this.state.command) return;
    if (this.state.status !== 'stale' && this.state.status !== 'ready' && this.state.status !== 'error') return;
    const serial = ++this.serial;
    const priorDraft = this.state.draft;
    this.show({ status: 'loading', notice: null });
    try {
      const preference = parsePreferences(await this.port.read());
      if (!this.current(actor) || serial !== this.serial) return;
      this.draftInitialized = true;
      this.show({
        preference,
        draft: priorDraft,
        status: 'ready',
        notice: 'Контакт изменился. Проверьте текст перед новым сохранением.',
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
    const { actor, preference, draft, status, command } = this.state;
    if (!actor || !preference || command || status !== 'ready') return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed.length > GAME_CONTACT_MAX || trimmed === (preference.defaultPublicGameContact ?? '')) return;
    const packet: GameContactPacket = Object.freeze({
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      body: Object.freeze({
        expectedVersion: preference.version,
        defaultPublicGameContact: trimmed,
      }),
    });
    await this.dispatch(packet, actor);
  };

  /** Explicit remove only — empty draft never becomes save(null). */
  remove = async () => {
    const { actor, preference, status, command } = this.state;
    if (!actor || !preference || preference.defaultPublicGameContact == null || command || status !== 'ready') return;
    const packet: GameContactPacket = Object.freeze({
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      body: Object.freeze({
        expectedVersion: preference.version,
        defaultPublicGameContact: null,
      }),
    });
    await this.dispatch(packet, actor);
  };

  reconcile = async () => {
    const { actor, command } = this.state;
    if (!actor || !command || command.status !== 'unknown') return;
    if (command.packet.actor.actorId !== actor.actorId) return;
    await this.dispatch(command.packet, actor);
  };

  private async dispatch(packet: GameContactPacket, authority: Actor) {
    this.serial++;
    this.show({ command: { packet, status: 'sending' }, notice: null });
    const valid = () => this.current(authority) && this.state.command?.packet === packet && this.state.command.status === 'sending';
    try {
      const ack = parsePreferences(await this.port.send(packet, authority));
      if (!valid()) return;
      if (packet.body.defaultPublicGameContact === null) {
        if (ack.defaultPublicGameContact !== null) throw new ParticipationError('invalid');
      } else if (ack.defaultPublicGameContact !== packet.body.defaultPublicGameContact) {
        throw new ParticipationError('invalid');
      }
      if (ack.version <= packet.body.expectedVersion) throw new ParticipationError('invalid');
      this.draftInitialized = true;
      this.show({
        preference: ack,
        draft: ack.defaultPublicGameContact ?? '',
        command: undefined,
        status: 'ready',
        notice: ack.defaultPublicGameContact === null
          ? 'Сохранённый контакт удалён. Контакты в существующих играх не изменились.'
          : 'Контакт сохранён для следующих игр.',
      });
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ParticipationError
        && error.kind === 'business'
        && error.status < 500
        && error.code !== 'COMMAND_IN_PROGRESS') {
        const stale = error.status === 409;
        this.show({
          command: undefined,
          status: stale ? 'stale' : 'ready',
          notice: stale
            ? 'Контакт изменился. Обновите данные перед сохранением.'
            : packet.body.defaultPublicGameContact === null
              ? 'Не удалось удалить сохранённый контакт. Проверьте данные и повторите.'
              : error.code === 'HOST_PUBLIC_CONTACT_INVALID'
                ? 'Проверьте контакт: после обрезки пробелов нужно от 1 до 320 символов.'
                : 'Не удалось сохранить контакт. Проверьте поле и повторите.',
        });
      } else {
        this.show({ command: { packet, status: 'unknown' }, notice: unknownNotice });
      }
    }
  }
}
