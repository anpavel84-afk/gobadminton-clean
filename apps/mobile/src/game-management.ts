import type { CreateGame, Game, GamePreferences, Participation } from '@gobadminton/contracts/game-types';
import { ParticipationError, sameActor } from './participation.ts';
import type { Actor, CursorPage, ManagedGame } from './participation.ts';
import { gameSchedule, gameStartIsFuture } from './game-form.ts';

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
export class GameManagementCoordinator {
  private state = initial(); private listeners = new Set<() => void>(); private contextRead = 0; private contactEdited = false; private resumeKnown: { actorId: string; id: string; version: number } | null = null; private detailReads = new Map<string, number>();
  // Quarantined while identity is unavailable; never part of the guest snapshot.
  private resumePending: ManagementPacket | null = null;
  private port: ManagementPort; private random: () => string; private now: () => number;
  constructor(port: ManagementPort, random: () => string, now: () => number = Date.now) { this.port = port; this.random = random; this.now = now; }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private show(p: Partial<ManagementSnapshot>) { this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()); }
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
    this.contextRead++; this.contactEdited = false; this.detailReads.clear(); this.state = initial(); this.show({ actor: actor ? Object.freeze({ ...actor }) : null,
      creationReference: actor && this.resumeKnown ? { id: this.resumeKnown.id, version: this.resumeKnown.version } : null,
      ...(pending ? { command: { packet: pending, status: 'unknown' as const }, notice: 'Результат прежнего действия неизвестен. Проверка повторит только его с прежними условиями и ключом; публикация после создания потребует отдельного подтверждения.' } : {}) });
  }
  /** Explicit logout wipes quarantined packets and active private data before fencing auth. */
  forgetCreation = () => {
    this.resumeKnown = null; this.resumePending = null; this.contextRead++; this.detailReads.clear(); this.contactEdited = false;
    this.state = initial(); this.show({});
  };
  private current(actor: Actor | null) { return sameActor(actor,this.state.actor); }
  private locked() { return ['sending','unknown'].includes(this.state.command?.status ?? ''); }
  update = (patch: Partial<CreationForm>) => {
    if (!this.state.actor || this.locked() || this.state.creationReference) return;
    if (Object.hasOwn(patch,'contact')) this.contactEdited = true;
    this.show({ form: { ...this.state.form,...patch }, preview: null, notice: undefined });
  };
  loadContext = async (cityId: string | null) => {
    const actor = this.state.actor, serial = ++this.contextRead;
    if (!actor) return;
    const valid = () => this.current(actor) && serial === this.contextRead;
    const changed = cityId !== this.state.cityId;
    this.show({ context: 'loading', profile: null, trainer: null, preferences: null, venues: [], cityId,
      ...(changed && !this.locked() && !this.state.creationReference ? { form: { ...this.state.form, venueId: '' }, preview: null } : {}) });
    try {
      let profile: CreatorProfile;
      try { profile = await this.port.profile(); }
      catch (e) { if (e instanceof ParticipationError && e.status === 404) { if (valid()) this.show({ context: 'setup' }); return; } throw e; }
      if (!valid()) return;
      if (!profile.cityId || !profile.displayName.trim() || !cityId) { this.show({ profile, context: 'setup', preview: null }); return; }
      const preferences = await this.port.preferences(); if (!valid()) return;
      let trainer: OwnTrainer | null = null;
      if (profile.trainer) {
        try { trainer = await this.port.trainer(); } catch (e) { if (!(e instanceof ParticipationError && e.status === 404)) throw e; }
        if (!valid()) return;
        if (trainer?.status !== 'active') trainer = null;
      }
      const venues: Venue[] = [], seen = new Set<string>(); let cursor: string | undefined;
      do { const page = await this.port.venues(cityId,cursor); if (!valid()) return;
        if (page.items.some(v => v.cityId !== cityId)) throw new ParticipationError('invalid');
        venues.push(...page.items); if (page.nextCursor && seen.has(page.nextCursor)) throw new ParticipationError('invalid');
        if (page.nextCursor) seen.add(page.nextCursor); cursor = page.nextCursor ?? undefined;
      } while (cursor);
      this.show({ context: 'ready', profile, preferences, trainer, venues,
        form: { ...this.state.form,
          ...(!this.contactEdited ? { contact: preferences.defaultPublicGameContact ?? '' } : {}),
          ...(!trainer && !this.locked() && !this.state.creationReference ? { activity: 'regular' as const } : {}) },
        ...(!this.locked() && !this.state.creationReference ? { preview: null } : {}) });
    } catch { if (valid()) this.show({ context: 'error', venues: [], profile: null, preferences: null, trainer: null }); }
  };
  preview = () => {
    if (this.locked() || this.state.creationReference || this.state.context !== 'ready' || !this.state.profile || !this.state.cityId) return;
    try { this.show({ preview: freeze(creationInput(this.state.form,this.state.profile,this.state.preferences,this.state.trainer,this.state.venues,this.state.cityId,this.now())), notice: undefined }); }
    catch { this.show({ notice: 'Проверьте площадку, дату, время, длительность, места, уровни и публичный контакт.' }); }
  };
  newCreation = async (cityId: string | null) => {
    if (this.state.created?.status !== 'published' || this.locked()) return;
    this.resumeKnown = null; this.contactEdited = false;
    this.show({ form: emptyCreationForm(), preview: null, created: null, creationReference: null, command: undefined, notice: undefined });
    await this.loadContext(cityId);
  };
  edit = () => { if (!this.locked() && !this.state.created) this.show({ preview: null }); };
  /** Explicit preview confirmation owns normal draft→publish. Reconciliation never chains. */
  publishPreview = async () => {
    const actor = this.state.actor, input = this.state.preview;
    if (!actor || !input || this.state.context !== 'ready' || this.locked() || this.state.creationReference) return;
    if (!gameStartIsFuture(input.startsAt,this.now())) {
      this.show({ preview: null, notice: 'Время начала уже прошло. Укажите будущие дату и время.' }); return;
    }
    const packet: ManagementPacket = freeze({ actor, kind: 'create', key: this.random(), body: input });
    const result = await this.dispatch(packet);
    if (result && this.current(actor) && this.state.created?.status === 'draft') await this.publishDraft(this.state.created.id);
  };
  publishDraft = async (id: string) => {
    const actor = this.state.actor, d = this.state.details[id], game = this.state.created?.id === id ? this.state.created : d?.game;
    if (!actor || !game || game.status !== 'draft' || this.locked() || (this.state.created?.id !== id && (d?.status !== 'ready' || !d.management))) return;
    await this.dispatch(freeze({ actor, kind: 'publish', gameId: id, key: this.random(), body: { expectedVersion: game.version } }));
  };
  reconcile = async () => { const command = this.state.command; if (command?.status === 'unknown' && this.current(command.packet.actor)) await this.dispatch(command.packet); };
  private async dispatch(packet: ManagementPacket): Promise<boolean> {
    if (!this.current(packet.actor) || this.state.command?.status === 'sending') return false;
    this.show({ command: { packet, status: 'sending' }, notice: undefined });
    try {
      const result = await this.port.send(packet); if (!this.current(packet.actor)) return false;
      if (packet.kind === 'create' || packet.kind === 'publish') {
        const game = result as Game;
        if (!game.id || !Number.isInteger(game.version) || (packet.kind === 'create' ? game.status !== 'draft' : game.id !== packet.gameId || game.status !== 'published' || game.version <= packet.body.expectedVersion)) throw new ParticipationError('invalid');
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
    put({ status: 'loading', participants: [], cursor: null, roster: 'loading' });
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
