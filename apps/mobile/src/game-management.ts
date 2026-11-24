import type { CreateGame, Game, GamePreferences, Participation } from '@gobadminton/contracts/game-types';
import { ParticipationError, sameActor } from './participation.ts';
import type { Actor, CursorPage, ManagedGame } from './participation.ts';
import { gameSchedule, gameStartIsFuture } from './game-form.ts';
import { GAME_PHOTO_SELECTION_COPY } from './game-cover.ts';
import { cloneDerivativeBytes, type AvatarDerivative } from './profile-avatar.ts';

export type CreatorProfile = { cityId: string | null; trainer: boolean; displayName: string };
export type OwnTrainer = { id: string; status: 'active' | 'inactive'; displayName: string };
export type Venue = { id: string; name: string; address: string; cityId: string; timezone: string };
export type CreationForm = { title: string; venueId: string; date: string; time: string; duration: string; capacity: string;
  visibility: 'public' | 'unlisted'; format: 'doubles' | 'singles' | 'mixed'; lower: number; upper: number;
  contact: string; saveContact: boolean; activity: 'regular' | 'trainer_led'; terms: string; training: string; trainerTerms: string };
export const emptyCreationForm = (): CreationForm => ({ title: '', venueId: '', date: '', time: '', duration: '120', capacity: '4',
  visibility: 'public', format: 'doubles', lower: 3, upper: 3.5, contact: '', saveContact: false, activity: 'regular',
  terms: 'Площадка и условия вне платформы', training: '', trainerTerms: 'Оплата тренеру по договорённости вне платформы' });
export function parseCreatorProfile(value: unknown): CreatorProfile {
  const r = row(value);
  if (!(r.cityId === null || typeof r.cityId === 'string' && r.cityId.length > 0) || typeof r.trainer !== 'boolean' || typeof r.displayName !== 'string') throw new ParticipationError('invalid');
  return { cityId: r.cityId as string | null, trainer: r.trainer, displayName: r.displayName };
}
const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ParticipationError('invalid');
  return v as Record<string, unknown>;
};
export function parsePreferences(value: unknown): GamePreferences {
  const r = row(value);
  if (!Number.isInteger(r.version) || Number(r.version) < 0 || !(r.defaultPublicGameContact === null || typeof r.defaultPublicGameContact === 'string')) throw new ParticipationError('invalid');
  return { version: r.version as number, defaultPublicGameContact: r.defaultPublicGameContact as string | null };
}
export function parseOwnTrainer(value: unknown): OwnTrainer {
  const r = row(value);
  if (typeof r.id !== 'string' || !r.id || typeof r.displayName !== 'string' || !['active','inactive'].includes(String(r.status))) throw new ParticipationError('invalid');
  return { id: r.id, displayName: r.displayName, status: r.status as OwnTrainer['status'] };
}
export function creationInput(form: CreationForm, profile: CreatorProfile, preferences: GamePreferences | null, trainer: OwnTrainer | null, venues: Venue[], cityId: string, now = Date.now()): CreateGame {
  profile = parseCreatorProfile(profile);
  const venue = venues.find(v => v.id === form.venueId && v.cityId === cityId);
  const schedule = venue && gameSchedule(`${form.date}T${form.time}`, form.duration, venue.timezone);
  const capacity = /^\d+$/.test(form.capacity) ? Number(form.capacity) : 0;
  if (!profile.cityId || !profile.displayName.trim() || !venue || !schedule || !gameStartIsFuture(schedule.startsAt, now) || !Number.isInteger(capacity) || capacity < 1 || capacity > 1000 || !form.contact.trim() || form.contact.trim().length > 320 || form.title.length > 160 ||
      !['public','unlisted'].includes(form.visibility) || !['doubles','singles','mixed'].includes(form.format) ||
      ![form.lower,form.upper].every(n => Number.isFinite(n) && n >= 1 && n <= 7 && Number.isInteger(n * 2)) || form.lower > form.upper ||
      (form.activity !== 'regular' && form.activity !== 'trainer_led') ||
      (form.activity === 'trainer_led' && (!profile.trainer || trainer?.status !== 'active')) ||
      (form.saveContact && !preferences) || form.training.length > 2000) throw new ParticipationError('business',422,'FORM_INVALID');
  const terms = (form.activity === 'regular' ? form.terms : form.trainerTerms).trim();
  if (!terms) throw new ParticipationError('business',422,'FORM_INVALID');
  const allowedLevelIds = Array.from({ length: (form.upper - form.lower) * 2 + 1 }, (_, i) => (form.lower + i / 2).toFixed(1));
  return { hostDisplayName: profile.displayName, hostPublicContact: form.contact.trim(), venueId: venue.id,
    ...(form.title.trim() ? { title: form.title.trim() } : {}), ...schedule, timezone: venue.timezone, capacity, externalReservedCount: 0,
    visibility: form.visibility, formatKey: form.format, activityKind: form.activity,
    levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds },
    settlement: form.activity === 'regular' ? { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms }
      : { mode: 'external', purpose: 'trainer_fee', priceStatus: 'by_agreement', priceMinor: null, currency: null, terms },
    trainingDescription: form.activity === 'trainer_led' ? form.training.trim() || null : null,
    ...(form.saveContact && preferences ? { savePublicContactDefault: { expectedVersion: preferences.version } } : {}) };
}
export type ManagementPacket = Readonly<{ actor: Actor; key: string } & (
  { kind: 'create'; body: Readonly<CreateGame> } |
  { kind: 'publish'; gameId: string; body: Readonly<{ expectedVersion: number }> } |
  { kind: 'confirm' | 'reject' | 'remove'; gameId: string; participationId: string; body: Readonly<{ expectedVersion: number; reason?: string }> })>;
type CommandState = { packet: ManagementPacket; status: 'sending' | 'unknown' | 'settled' | 'rejected'; code?: string };
type Detail = { status: 'loading' | 'ready' | 'error' | 'denied'; game?: Game; management?: ManagedGame['management']; participants: Participation[]; cursor: string | null; roster: 'loading' | 'ready' | 'error'; notice?: string };
export type ManagementSnapshot = { actor: Actor | null; form: CreationForm; context: 'idle' | 'loading' | 'ready' | 'setup' | 'error';
  profile: CreatorProfile | null; preferences: GamePreferences | null; trainer: OwnTrainer | null; venues: Venue[]; cityId: string | null;
  preview: CreateGame | null; created: Game | null; creationReference: { id: string; version: number } | null; command?: CommandState; details: Record<string, Detail>; notice?: string };
export type ManagementPort = { profile: () => Promise<CreatorProfile>; preferences: () => Promise<GamePreferences>; trainer: () => Promise<OwnTrainer>;
  venues: (cityId: string, cursor?: string) => Promise<CursorPage<Venue>>; managed: (cursor?: string) => Promise<CursorPage<ManagedGame>>;
  game: (id: string) => Promise<Game>; participants: (id: string, cursor?: string) => Promise<CursorPage<Participation>>;
  send: (packet: ManagementPacket) => Promise<Game | Participation> };
function initial(): ManagementSnapshot { return { actor: null, form: emptyCreationForm(), context: 'idle', profile: null, preferences: null, trainer: null, venues: [], cityId: null, preview: null, created: null, creationReference: null, details: {} }; }
function freeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
/** Persistent root domain: route changes do not reset packets. No disk/auth-envelope migration. */
export type ManagementGate = {
  /** Unresolved managed-game photo blocks publish/roster writes for that game (not create / other games). */
  coverBlocksWrites?: (gameId: string) => boolean;
  /**
   * Optional create→cover stage — existing game-cover owner only.
   * Returns fresh version on definite save; null on reject/UNKNOWN/stale (never auto-publish).
   */
  saveCreationCover?: (input: {
    gameId: string;
    gameVersion: number;
    derivative: Readonly<AvatarDerivative>;
    actor: Actor;
    live: () => boolean;
  }) => Promise<{ version: number } | null>;
};

/**
 * Auth/port cover-lock no-send — distinct from unrelated ParticipationError('stale').
 * Thrown before/after token when managed-game photo blocks publish/roster; never a network result.
 */
export class CoverLockNoSendError extends Error {
  readonly kind = 'cover_lock_no_send' as const;
  constructor() {
    super('cover_lock_no_send');
    this.name = 'CoverLockNoSendError';
  }
}

export class GameManagementCoordinator {
  private state = initial(); private listeners = new Set<() => void>(); private contextRead = 0; private publishRead = 0; private contactEdited = false; private resumeKnown: { actorId: string; id: string; version: number } | null = null; private detailReads = new Map<string, number>();
  // Quarantined while identity is unavailable; never part of the guest snapshot.
  private resumePending: ManagementPacket | null = null;
  // A domain-local continuation, fenced by identity, context generation and observed search city.
  private ordinaryResume: { actor: Actor; serial: number; cityId: string | null } | null = null;
  /** Confirmed local creation photo — immutable bytes until create succeeds or actor/form reset. */
  private creationPhoto: Readonly<AvatarDerivative> | null = null;
  private port: ManagementPort; private random: () => string; private now: () => number;
  private gate: ManagementGate;
  constructor(port: ManagementPort, random: () => string, now: () => number = Date.now, gate: ManagementGate = {}) {
    this.port = port; this.random = random; this.now = now; this.gate = gate;
  }
  private coverBlocked(gameId: string) {
    return !!gameId && !!this.gate.coverBlocksWrites?.(gameId);
  }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private show(p: Partial<ManagementSnapshot>) { this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()); }
  /** Optional confirmed game photo for create→cover→publish. Omission clears. */
  setCreationPhoto = (derivative: AvatarDerivative | null) => {
    if (!this.state.actor || this.locked() || this.state.creationReference) return;
    this.creationPhoto = derivative
      ? Object.freeze({ mime: derivative.mime, bytes: cloneDerivativeBytes(derivative.bytes) })
      : null;
  };
  /** Test/read helper — confirmed creation photo presence only (never raw bytes). */
  hasCreationPhoto = () => this.creationPhoto !== null;
  setActor(actor: Actor | null) {
    if (sameActor(actor,this.state.actor) || !actor && !this.state.actor) return;
    if (this.state.actor) {
      if (this.state.creationReference) this.resumeKnown = { actorId: this.state.actor.actorId, ...this.state.creationReference };
      // Losing an in-flight response is also UNKNOWN, even if it later succeeds.
      if (this.locked()) this.resumePending = this.state.command!.packet;
    }
    if (actor && this.resumeKnown?.actorId !== actor.actorId) this.resumeKnown = null;
    if (actor && this.resumePending?.actor.actorId !== actor.actorId) this.resumePending = null;
    const pending = actor && this.resumePending ? freeze({ ...this.resumePending, actor: { ...actor } }) : null;
    if (actor) this.resumePending = null;
    this.creationPhoto = null;
    this.ordinaryResume = null; this.contextRead++; this.contactEdited = false; this.detailReads.clear(); this.state = initial(); this.show({ actor: actor ? Object.freeze({ ...actor }) : null,
      creationReference: actor && this.resumeKnown ? { id: this.resumeKnown.id, version: this.resumeKnown.version } : null,
      ...(pending ? { command: { packet: pending, status: 'unknown' as const }, notice: 'Результат прежнего действия неизвестен. Проверка повторит только его с прежними условиями и ключом; публикация после создания потребует отдельного подтверждения.' } : {}) });
  }
  /** Explicit logout wipes quarantined packets and active private data before fencing auth. */
  forgetCreation = () => {
    this.resumeKnown = null; this.resumePending = null; this.ordinaryResume = null; this.creationPhoto = null;
    this.contextRead++; this.detailReads.clear(); this.contactEdited = false;
    this.state = initial(); this.show({});
  };
  private current(actor: Actor | null) { return sameActor(actor,this.state.actor); }
  private locked() { return ['sending','unknown'].includes(this.state.command?.status ?? ''); }
  update = (patch: Partial<CreationForm>) => {
    if (!this.state.actor || this.locked() || this.state.creationReference) return;
    if (Object.hasOwn(patch,'contact')) this.contactEdited = true;
    this.show({ form: { ...this.state.form,...patch }, preview: null, notice: undefined });
  };
  continueOrdinaryForm = (cityId: string | null) => {
    const actor = this.state.actor, serial = ++this.contextRead;
    this.ordinaryResume = actor && this.state.context === 'ready' ? { actor, serial, cityId } : null;
  };
  mountOrdinaryForm = (cityId: string | null) => {
    const resume = this.ordinaryResume;
    if (resume && this.current(resume.actor) && resume.serial === this.contextRead && resume.cityId === cityId && this.state.context === 'ready') return Promise.resolve();
    return this.loadContext(cityId);
  };
  /** Read locally: a contextual route must not clear the mounted ordinary form while awaiting I/O. */
  private async readContext(cityId: string | null, valid: () => boolean, catalogRead: () => void = () => {}) {
    const setup = { context: 'setup' as const, cityId, profile: null as CreatorProfile | null,
      preferences: null, trainer: null, venues: [] as Venue[] };
    let profile: CreatorProfile;
    try { profile = parseCreatorProfile(await this.port.profile()); }
    catch (e) { if (e instanceof ParticipationError && e.status === 404) return valid() ? setup : null; throw e; }
    if (!valid()) return null;
    if (!profile.cityId || !profile.displayName.trim() || !cityId) return { ...setup, profile };
    const preferences = parsePreferences(await this.port.preferences()); if (!valid()) return null;
    let trainer: OwnTrainer | null = null;
    if (profile.trainer) {
      try { trainer = await this.port.trainer(); } catch (e) { if (!(e instanceof ParticipationError && e.status === 404)) throw e; }
      if (!valid()) return null;
      if (trainer?.status !== 'active') trainer = null;
    }
    catalogRead();
    const venues: Venue[] = [], seen = new Set<string>(); let cursor: string | undefined;
    do { const page = await this.port.venues(cityId,cursor); if (!valid()) return null;
      if (page.items.some(v => v.cityId !== cityId)) throw new ParticipationError('invalid');
      venues.push(...page.items); if (page.nextCursor && seen.has(page.nextCursor)) throw new ParticipationError('invalid');
      if (page.nextCursor) seen.add(page.nextCursor); cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { context: 'ready' as const, cityId, profile, preferences, trainer, venues };
  }
  /**
   * After an acknowledged trainer create/edit/deactivate: refetch creator profile + ownTrainer
   * without inventing eligibility. Preserves in-progress create form when possible.
   */
  refreshOwnTrainerContext = async () => {
    const actor = this.state.actor;
    if (!actor || this.state.context === 'idle' || this.state.context === 'loading') return;
    await this.loadContext(this.state.cityId, { preserveForm: true });
  };
  loadContext = async (cityId: string | null, options?: { preserveForm?: boolean; current?: () => boolean }) => {
    const actor = this.state.actor, serial = ++this.contextRead;
    if (!actor) return;
    const valid = () => this.current(actor) && serial === this.contextRead && (options?.current?.() ?? true);
    const changed = cityId !== this.state.cityId;
    this.show({ context: 'loading', profile: null, trainer: null, preferences: null, venues: [], cityId,
      ...(changed && !options?.preserveForm && !this.locked() && !this.state.creationReference ? { form: { ...this.state.form, venueId: '' }, preview: null } : {}) });
    try {
      const context = await this.readContext(cityId, valid);
      if (!context || !valid()) return;
      if (context.context === 'setup') { this.show({ ...context, ...(!options?.preserveForm ? { preview: null } : {}) }); return; }
      this.show({ ...context,
        form: { ...this.state.form,
          ...(!options?.preserveForm && !this.contactEdited && !this.locked() && !this.state.creationReference ? { contact: context.preferences.defaultPublicGameContact ?? '' } : {}),
          ...(!options?.preserveForm && !context.trainer && !this.locked() && !this.state.creationReference ? { activity: 'regular' as const } : {}) },
        ...(!options?.preserveForm && !this.locked() && !this.state.creationReference ? { preview: null } : {}) });
    } catch { if (valid()) this.show({ context: 'error', venues: [], profile: null, preferences: null, trainer: null }); }
  };
  /** Only an explicit press may switch local creation city/venue. Catalog remains authoritative. */
  selectVenue = async (venue: Venue, current: () => boolean = () => true) => {
    const actor = this.state.actor, form = this.state.form, preview = this.state.preview;
    if (!actor || this.locked() || this.state.creationReference || !current()) return false;
    const serial = ++this.contextRead;
    const valid = () => serial === this.contextRead && this.current(actor) && current() && !this.locked() &&
      !this.state.creationReference && this.state.form === form && this.state.preview === preview;
    const priorReady = this.state.context === 'ready';
    let catalogRead = false;
    try {
      const context = await this.readContext(venue.cityId, valid, () => { catalogRead = true; });
      if (!context || !valid()) return false;
      if (context.context === 'setup') { this.show(context); return false; }
      const actual = context.venues.find(v => v.id === venue.id && v.cityId === venue.cityId && v.timezone === venue.timezone);
      if (!actual) { this.show({ ...(priorReady ? {} : { context: 'error' as const }), notice: 'Площадка или её часовой пояс не подтверждены текущим каталогом. Выбор не изменён.' }); return false; }
      this.show({ ...context, form: { ...form, venueId: actual.id }, preview: null,
        notice: `Выбрана площадка: ${actual.name} · ${actual.timezone}. Проверьте дату, время и условия заново.` });
      return true;
    } catch (e) {
      // Catalog/read failure does not revoke an already usable context. An authoritative
      // malformed profile/settings response still blocks new writes until refreshed.
      if (valid()) this.show({ ...(!priorReady || !catalogRead && e instanceof ParticipationError && e.kind === 'invalid'
        ? { context: 'error' as const, profile: null, preferences: null, trainer: null } : {}),
        notice: 'Не удалось проверить профиль, настройки или каталог площадок. Выбор не изменён; повторите проверку.' });
      return false;
    }
  };
  preview = () => {
    if (this.locked() || this.state.creationReference || this.state.context !== 'ready' || !this.state.profile || !this.state.cityId) return;
    try { this.show({ preview: freeze(creationInput(this.state.form,this.state.profile,this.state.preferences,this.state.trainer,this.state.venues,this.state.cityId,this.now())), notice: undefined }); }
    catch { this.show({ notice: 'Проверьте площадку, дату, время, длительность, места, уровни и публичный контакт.' }); }
  };
  newCreation = async (cityId: string | null) => {
    if (this.state.created?.status !== 'published' || this.locked()) return;
    this.resumeKnown = null; this.contactEdited = false; this.creationPhoto = null;
    this.show({ form: emptyCreationForm(), preview: null, created: null, creationReference: null, command: undefined, notice: undefined });
    await this.loadContext(cityId);
  };
  edit = () => { if (!this.locked() && !this.state.created) this.show({ preview: null }); };
  /**
   * Explicit preview confirmation: omit → create→publish; confirmed photo → create→cover→publish.
   * Failed/UNKNOWN create never uploads. Failed/UNKNOWN cover leaves draft and never publishes.
   * Reconciliation never chains publication.
   */
  publishPreview = async () => {
    const actor = this.state.actor, input = this.state.preview;
    if (!actor || !input || this.state.context !== 'ready' || this.locked() || this.state.creationReference) return;
    if (!gameStartIsFuture(input.startsAt,this.now())) {
      this.show({ preview: null, notice: 'Время начала уже прошло. Укажите будущие дату и время.' }); return;
    }
    const photo = this.creationPhoto;
    const packet: ManagementPacket = freeze({ actor, kind: 'create', key: this.random(), body: input });
    const result = await this.dispatch(packet);
    if (!result || !this.current(actor) || this.state.created?.status !== 'draft') return;
    const created = this.state.created;
    if (!gameStartIsFuture(created.startsAt, this.now())) {
      this.show({ notice: GAME_PHOTO_SELECTION_COPY.startExpiredAfterCreate });
      return;
    }
    if (photo) {
      const live = () => this.current(actor) && this.state.created?.id === created.id
        && this.state.creationReference?.id === created.id;
      const cover = this.gate.saveCreationCover
        ? await this.gate.saveCreationCover({
          gameId: created.id,
          gameVersion: created.version,
          derivative: photo,
          actor,
          live,
        })
        : null;
      if (!live()) return;
      if (!cover) {
        this.show({ notice: GAME_PHOTO_SELECTION_COPY.saveFailed });
        return;
      }
      const current = this.state.created;
      if (current?.id === created.id && current.version < cover.version) {
        this.show({
          created: { ...current, version: cover.version },
          creationReference: { id: created.id, version: cover.version },
        });
      }
      const forPublish = this.state.created ?? created;
      if (!gameStartIsFuture(forPublish.startsAt, this.now())) {
        this.show({ notice: GAME_PHOTO_SELECTION_COPY.startExpiredAfterCreate });
        return;
      }
    }
    if (this.current(actor) && this.state.created?.status === 'draft' && !this.coverBlocked(this.state.created.id)) {
      await this.publishDraft(this.state.created.id);
    }
  };
  publishDraft = async (id: string) => {
    const actor = this.state.actor, d = this.state.details[id], game = this.state.created?.id === id ? this.state.created : d?.game;
    if (!actor || !game || game.status !== 'draft' || this.locked() || (this.state.created?.id !== id && (d?.status !== 'ready' || !d.management))) return;
    // A new publish intent needs an authoritative profile, including direct managed-draft entry.
    // UNKNOWN reconciliation bypasses this read and retains its immutable command packet.
    const serial = ++this.publishRead, contextRead = this.contextRead, detailRead = this.detailReads.get(id);
    const valid = () => this.current(actor) && serial === this.publishRead && contextRead === this.contextRead && detailRead === this.detailReads.get(id);
    try {
      const profile = parseCreatorProfile(await this.port.profile());
      if (!valid()) return;
      if (!profile.cityId || !profile.displayName.trim()) {
        this.show({ profile, context: 'setup', preview: null,
          notice: 'Для публикации заполните имя и город в профиле в веб-приложении, затем повторите публикацию. Черновик сохранён.' }); return;
      }
      const detail = this.state.details[id], currentGame = this.state.created?.id === id ? this.state.created : detail?.game;
      if (this.locked() || currentGame !== game || (this.state.created?.id !== id && (detail?.status !== 'ready' || !detail.management))) return;
      this.show({ profile, ...(this.state.context === 'setup' ? { context: 'idle' as const } : {}) });
    } catch (e) {
      if (valid()) this.show({ profile: null, ...(e instanceof ParticipationError && e.status === 404 ? { context: 'setup' as const, preview: null } : {}),
        notice: e instanceof ParticipationError && e.status === 404
          ? 'Для публикации заполните имя и город в профиле в веб-приложении, затем повторите публикацию. Черновик сохранён.'
          : 'Не удалось проверить профиль. Повторите публикацию после проверки соединения. Черновик сохранён.' });
      return;
    }
    if (valid() && !this.locked()) await this.dispatch(freeze({ actor, kind: 'publish', gameId: id, key: this.random(), body: { expectedVersion: game.version } }));
  };
  reconcile = async () => { const command = this.state.command; if (command?.status === 'unknown' && this.current(command.packet.actor)) await this.dispatch(command.packet); };
  private async dispatch(packet: ManagementPacket): Promise<boolean> {
    if (!this.current(packet.actor) || this.state.command?.status === 'sending') return false;
    // Actual gate (not UI-only): delayed token / saved publish/roster callbacks cannot dispatch while cover unresolved.
    if (packet.kind !== 'create' && this.coverBlocked(packet.gameId)) {
      this.show({ notice: 'Сначала завершите или проверьте сохранение фото этой игры.' });
      return false;
    }
    // Preserve prior UNKNOWN identity across a prevented no-send retry (cover-lock stale after token).
    const priorUnknown = this.state.command?.status === 'unknown' && this.state.command.packet === packet
      ? this.state.command.packet
      : null;
    this.show({ command: { packet, status: 'sending' }, notice: undefined });
    try {
      const result = await this.port.send(packet); if (!this.current(packet.actor)) return false;
      if (packet.kind === 'create' || packet.kind === 'publish') {
        const game = result as Game;
        if (!game.id || !Number.isInteger(game.version) || (packet.kind === 'create' ? game.status !== 'draft' : game.id !== packet.gameId || game.status !== 'published' || game.version <= packet.body.expectedVersion)) throw new ParticipationError('invalid');
        // Drop local selection once create is acknowledged — cover stage uses the captured local copy only.
        // Reconcile settle never chains cover/publish.
        if (packet.kind === 'create') this.creationPhoto = null;
        this.show({ created: game, creationReference: { id: game.id, version: game.version }, command: { packet, status: 'settled' } });
        if (packet.kind === 'publish') await this.loadDetail(game.id);
      } else {
        const p = result as Participation;
        if (p.id !== packet.participationId || p.gameId !== packet.gameId || p.version <= packet.body.expectedVersion ||
          p.status !== ({ confirm: 'confirmed', reject: 'rejected', remove: 'removed' } as const)[packet.kind]) throw new ParticipationError('invalid');
        this.show({ command: { packet, status: 'settled' } }); await this.loadDetail(packet.gameId);
      }
      return true;
    } catch (e) {
      if (!this.current(packet.actor)) return false;
      // Only the dedicated cover-lock no-send class — unrelated stale follows accepted50 UNKNOWN below.
      if (e instanceof CoverLockNoSendError) {
        if (priorUnknown) {
          // Prevented delayed retry: keep exact prior UNKNOWN regardless of later cover-lock state.
          this.show({
            command: { packet: priorUnknown, status: 'unknown' },
            notice: 'Сначала завершите или проверьте сохранение фото этой игры.',
          });
          return false;
        }
        // First definitely prevented send — clear safely (no network mutation occurred).
        this.show({
          command: undefined,
          notice: 'Сначала завершите или проверьте сохранение фото этой игры.',
        });
        return false;
      }
      const definite = e instanceof ParticipationError && (e.kind === 'business' || e.kind === 'authority') && e.code !== 'COMMAND_IN_PROGRESS';
      this.show({ command: { packet, status: definite ? 'rejected' : 'unknown', code: e instanceof ParticipationError ? e.code : undefined },
        notice: definite ? 'Действие отклонено. Обновите данные перед новой попыткой.' : 'Результат неизвестен. Проверка повторит только эту же команду с тем же ключом.' });
      if (definite && packet.kind !== 'create') await this.loadDetail(packet.gameId);
      return false;
    }
  }
  private denyCreated(id: string) { if (this.state.creationReference?.id === id) this.show({ created: null }); }
  loadDetail = async (id: string) => {
    const actor = this.state.actor, serial = (this.detailReads.get(id) ?? 0) + 1; this.detailReads.set(id,serial);
    if (!actor) return;
    const valid = () => this.current(actor) && this.detailReads.get(id) === serial;
    const put = (detail: Detail) => { if (detail.status === 'denied') this.denyCreated(id); this.show({ details: { ...this.state.details,[id]: detail } }); };
    // Soft refresh when already ready: keep game shell mounted so an open cover editor
    // is not unmounted by a receipt-driven reload (loading flash would drop its view lease).
    const prior = this.state.details[id];
    if (!(prior?.status === 'ready' && prior.game)) {
      put({ status: 'loading', participants: [], cursor: null, roster: 'loading' });
    }
    try {
      let managed: ManagedGame | undefined, cursor: string | undefined; const seen = new Set<string>();
      do { const page = await this.port.managed(cursor); if (!valid()) return; managed = page.items.find(g => g.id === id);
        if (page.nextCursor && seen.has(page.nextCursor)) throw new ParticipationError('invalid');
        if (page.nextCursor) seen.add(page.nextCursor); cursor = page.nextCursor ?? undefined;
      } while (!managed && cursor);
      if (!managed) { if (this.state.creationReference?.id === id) this.show({ created: null }); put({ status: 'denied', participants: [], cursor: null, roster: 'error' }); return; }
      const game = await this.port.game(id); if (!valid()) return;
      if (game.id !== id) throw new ParticipationError('invalid');
      if (this.state.creationReference?.id === id) this.show({ created: game, creationReference: { id: game.id, version: game.version } });
      put({ status: 'ready', game, management: managed.management, participants: [], cursor: null, roster: 'loading' });
      try {
        const page = await this.port.participants(id); if (!valid()) return;
        if (page.items.some(p => p.gameId !== id)) throw new ParticipationError('invalid');
        put({ status: 'ready', game, management: managed.management, participants: page.items, cursor: page.nextCursor, roster: 'ready' });
      } catch (e) { if (valid()) put(e instanceof ParticipationError && [401,403,404].includes(e.status)
        ? { status: 'denied', participants: [], cursor: null, roster: 'error' }
        : { status: 'ready', game, management: managed.management, participants: [], cursor: null, roster: 'error' }); }
    } catch (e) { if (valid()) put({ status: e instanceof ParticipationError && [401,403,404].includes(e.status) ? 'denied' : 'error', participants: [], cursor: null, roster: 'error' }); }
  };
  moreParticipants = async (id: string) => {
    const actor = this.state.actor, detail = this.state.details[id], serial = this.detailReads.get(id);
    if (!actor || detail?.status !== 'ready' || detail.roster !== 'ready' || !detail.cursor) return;
    this.show({ details: { ...this.state.details,[id]: { ...detail, roster: 'loading' } } });
    try {
      const page = await this.port.participants(id,detail.cursor);
      if (!this.current(actor) || serial !== this.detailReads.get(id)) return;
      if (page.nextCursor === detail.cursor || page.items.some(p => p.gameId !== id)) throw new ParticipationError('invalid');
      this.show({ details: { ...this.state.details,[id]: { ...detail, participants: [...detail.participants,...page.items.filter(p => !detail.participants.some(old => old.id === p.id))], cursor: page.nextCursor, roster: 'ready' } } });
    } catch (e) {
      if (this.current(actor) && serial === this.detailReads.get(id)) {
        const denied = e instanceof ParticipationError && [401,403,404].includes(e.status);
        if (denied) this.denyCreated(id);
        this.show({ details: { ...this.state.details,[id]: denied ? { status: 'denied', participants: [], cursor: null, roster: 'error' } : { ...detail, roster: 'error' } } });
      }
    }
  };
  decide = async (id: string, participationId: string, kind: 'confirm' | 'reject' | 'remove', reason: string) => {
    const actor = this.state.actor, d = this.state.details[id], p = d?.participants.find(p => p.id === participationId);
    if (!actor || this.locked() || d?.status !== 'ready' || d.roster !== 'ready' || !d.management || !d.game || !p ||
      d.game.status !== 'published' || !gameStartIsFuture(d.game.startsAt,this.now()) ||
      (kind === 'remove' ? p.status !== 'confirmed' : p.status !== 'pending') || (kind === 'confirm' && d.game.availablePlaces < 1)) return;
    await this.dispatch(freeze({ actor, kind, gameId: id, participationId, key: this.random(),
      body: { expectedVersion: p.version, ...(kind === 'confirm' ? {} : { reason: reason.trim() || (kind === 'reject' ? 'Организатор отклонил заявку' : 'Организатор снял участие') }) } }));
  };
}
