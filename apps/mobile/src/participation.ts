import type { Game, Participation } from '@gobadminton/contracts/game-types';
import { PublicApiError, publicApi } from './public-api.ts';

export type ManagedGame = Game & { management: { role: 'owner' | 'manager'; createdByMe: boolean } };
export type CursorPage<T> = { items: T[]; nextCursor: string | null };
export class ParticipationError extends Error {
  readonly kind: 'network' | 'invalid' | 'authority' | 'business' | 'stale';
  readonly status: number;
  readonly code: string;
  constructor(kind: ParticipationError['kind'], status = 0, code = 'UNKNOWN') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ParticipationError('invalid');
  return value as Record<string, unknown>;
};
const string = (value: unknown): value is string => typeof value === 'string';
const integer = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1;
const date = (value: unknown) => string(value) && Number.isFinite(Date.parse(value));
export const participationLabels: Record<Participation['status'], string> = {
  pending: 'Заявка ожидает решения', confirmed: 'Участие подтверждено', rejected: 'Заявка отклонена',
  withdrawn: 'Заявка отозвана / отказ от участия', removed: 'Участие прекращено организатором',
  cancelled_by_game: 'Участие отменено вместе с игрой', expired: 'Срок заявки истёк',
};
export function parseParticipation(value: unknown): Participation {
  const r = record(value);
  if (!['id', 'gameId', 'userId'].every(k => string(r[k]) && r[k]) ||
      !Object.hasOwn(participationLabels, String(r.status)) || !integer(r.version) || !integer(r.attemptNumber) ||
      !date(r.requestedAt) || !(r.confirmedAt === undefined || r.confirmedAt === null || date(r.confirmedAt)) ||
      !(r.isCreatorOrganizer === undefined || typeof r.isCreatorOrganizer === 'boolean')) throw new ParticipationError('invalid');
  // Keep only the actual DTO; no untrusted server text or extra private fields enter state.
  return { id: r.id as string, gameId: r.gameId as string, userId: r.userId as string, status: r.status as Participation['status'],
    version: r.version as number, attemptNumber: r.attemptNumber as number, requestedAt: r.requestedAt as string,
    confirmedAt: r.confirmedAt as string | null | undefined, ...(typeof r.isCreatorOrganizer === 'boolean' ? { isCreatorOrganizer: r.isCreatorOrganizer } : {}) };
}
export function parseCursorPage<T>(value: unknown, parse: (item: unknown) => T): CursorPage<T> {
  const r = record(value);
  if (!Array.isArray(r.items) || !(r.nextCursor === null || (string(r.nextCursor) && r.nextCursor.length > 0))) throw new ParticipationError('invalid');
  return { items: r.items.map(parse), nextCursor: r.nextCursor as string | null };
}
export function gameVersion(game: unknown): number {
  const version = record(game).version;
  if (!integer(version)) throw new ParticipationError('invalid');
  return version;
}
export function parseAuthenticatedGame(value: unknown): Game {
  const r = record(value), v = record(r.venue), o = record(r.organizer);
  const l = record(r.levelRule), s = record(r.settlement);
  if (!['id', 'title', 'formatKey', 'timezone'].every(k => string(r[k])) || !r.id || !integer(r.version) ||
      !['draft', 'published', 'cancelled', 'completed'].includes(String(r.status)) || !['public', 'unlisted'].includes(String(r.visibility)) ||
      !['id', 'name', 'address', 'cityId', 'timezone'].every(k => string(v[k])) ||
      !string(o.displayName) || !string(o.publicContact) || !(o.id === null || string(o.id)) ||
      !['startsAt', 'endsAt', 'applicationDeadlineAt'].every(k => date(r[k])) ||
      !['capacity', 'confirmedCount', 'externalReservedCount', 'availablePlaces'].every(k => Number.isInteger(r[k]) && Number(r[k]) >= 0) ||
      !string(l.scaleId) || !integer(l.scaleVersion) || !Array.isArray(l.allowedLevelIds) || !l.allowedLevelIds.every(string) ||
      s.mode !== 'external' || !string(s.terms) || !['no_trainer_fee', 'trainer_fee'].includes(String(s.purpose)) ||
      !['regular', 'trainer_led'].includes(String(r.activityKind)) || !(r.trainingDescription === null || string(r.trainingDescription))) throw new ParticipationError('invalid');
  if (s.purpose === 'trainer_fee' && !(s.priceStatus === 'by_agreement' ||
      (s.priceStatus === 'fixed' && string(s.priceMinor) && /^\d+$/.test(s.priceMinor) && string(s.currency) && s.priceUnit === 'per_player_per_session'))) throw new ParticipationError('invalid');
  if (r.trainer !== null) {
    const t = record(r.trainer);
    if (!string(t.profileId) || !string(t.displayName) || t.declarationSource !== 'self_declared') throw new ParticipationError('invalid');
  }
  try { new Intl.DateTimeFormat('ru', { timeZone: r.timezone as string }); } catch { throw new ParticipationError('invalid'); }
  const cover = (value: unknown): { uploadedUrl: string | null } | undefined => {
    if (value === undefined) return undefined;
    const c = record(value);
    if (!(c.uploadedUrl === null || string(c.uploadedUrl))) throw new ParticipationError('invalid');
    return { uploadedUrl: c.uploadedUrl };
  };
  const settlement: Game['settlement'] = s.purpose === 'trainer_fee' && s.priceStatus === 'fixed'
    ? { mode: 'external', purpose: 'trainer_fee', priceStatus: 'fixed', priceUnit: 'per_player_per_session',
      priceMinor: s.priceMinor as string, currency: s.currency as string, terms: s.terms as string }
    : s.purpose === 'trainer_fee'
      ? { mode: 'external', purpose: 'trainer_fee', priceStatus: 'by_agreement', priceMinor: null, currency: null, terms: s.terms as string }
      : { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: s.terms as string };
  if (!(s.purpose === 'trainer_fee' && s.priceStatus === 'fixed') && (s.priceMinor !== null || s.currency !== null)) throw new ParticipationError('invalid');
  const trainer = r.trainer === null ? null : record(r.trainer);
  // Copy only validated contract fields; an authenticated read confers no invented management role.
  return {
    id: r.id as string, version: r.version as number, title: r.title as string,
    status: r.status as Game['status'], visibility: r.visibility as Game['visibility'],
    organizer: { id: o.id as string | null, displayName: o.displayName as string, publicContact: o.publicContact as string },
    venue: { id: v.id as string, name: v.name as string, address: v.address as string, cityId: v.cityId as string,
      timezone: v.timezone as string, ...(v.cover === undefined ? {} : { cover: cover(v.cover) }) },
    startsAt: r.startsAt as string, endsAt: r.endsAt as string, applicationDeadlineAt: r.applicationDeadlineAt as string,
    timezone: r.timezone as string, capacity: r.capacity as number, confirmedCount: r.confirmedCount as number,
    externalReservedCount: r.externalReservedCount as number, availablePlaces: r.availablePlaces as number,
    formatKey: r.formatKey as string,
    levelRule: { scaleId: l.scaleId as string, scaleVersion: l.scaleVersion as number, allowedLevelIds: [...l.allowedLevelIds] as string[] },
    settlement, activityKind: r.activityKind as Game['activityKind'], trainingDescription: r.trainingDescription as string | null,
    trainer: trainer ? { profileId: trainer.profileId as string, displayName: trainer.displayName as string, declarationSource: 'self_declared' } : null,
    ...(r.cover === undefined ? {} : { cover: cover(r.cover) }),
  };
}
export function parseManagedGame(value: unknown): ManagedGame {
  const r = record(value), m = record(r.management);
  const game = parseAuthenticatedGame(value);
  if (!['owner', 'manager'].includes(String(m.role)) || typeof m.createdByMe !== 'boolean') throw new ParticipationError('invalid');
  return { ...game, management: { role: m.role as 'owner' | 'manager', createdByMe: m.createdByMe } };
}
export type Actor = Readonly<{ actorId: string; sessionId: string; generation: number }>;
export type Command = Readonly<{ actor: Actor; gameId: string; key: string } & (
  { kind: 'request'; body: Readonly<{ expectedGameVersion: number }> } |
  { kind: 'withdraw'; participationId: string; body: Readonly<{ expectedVersion: number }> })>;
export type CommandState = { packet: Command; state: 'sending' | 'unknown' | 'settled' | 'rejected'; result?: Participation; code?: string };
export type ReadState<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; items: T[] };
export type Detail = { status: 'loading' | 'ready' | 'error'; game?: Game; parts: Participation[]; review?: 'request' | 'withdraw'; command?: CommandState };
export type GameRead = { status: 'loading' | 'ready' | 'error'; game?: Game; error?: unknown };
export type ParticipationSnapshot = { actor: Actor | null; own: ReadState<Participation>; managed: ReadState<ManagedGame>; details: Record<string, Detail>; games: Record<string, GameRead> };
export type ParticipationPort = {
  own: (cursor?: string) => Promise<CursorPage<Participation>>;
  managed: (cursor?: string) => Promise<CursorPage<ManagedGame>>;
  send: (packet: Command) => Promise<Participation>;
};
const initial = <T,>(): ReadState<T> => ({ status: 'idle', items: [] });
export function sameActor(a: Actor | null, b: Actor | null) {
  return !!a && !!b && a.actorId === b.actorId && a.sessionId === b.sessionId && a.generation === b.generation;
}
/** Root-owned state survives route unmounts. Reads never dispatch commands or retry UNKNOWN. */
export class ParticipationCoordinator {
  private snapshot: ParticipationSnapshot = { actor: null, own: initial(), managed: initial(), details: {}, games: {} };
  private listeners = new Set<() => void>();
  private reads = { own: 0, managed: 0 };
  private detailReads = new Map<string, number>();
  private gameReads = new Map<string, Promise<Game>>();
  private deniedGames = new Set<string>();
  private readPrivateGame?: (id: string) => Promise<unknown>;
  private port: ParticipationPort;
  private random: () => string;
  private readGame: (id: string) => Promise<unknown>;
  constructor(port: ParticipationPort, random: () => string, readGame: (id: string) => Promise<unknown> = id => publicApi.game(id), readPrivateGame?: (id: string) => Promise<unknown>) {
    this.port = port; this.random = random; this.readGame = readGame; this.readPrivateGame = readPrivateGame;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(patch: Partial<ParticipationSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  setActor(actor: Actor | null) {
    if ((!actor && !this.snapshot.actor) || sameActor(actor, this.snapshot.actor)) return;
    this.reads.own++; this.reads.managed++; this.detailReads.clear(); this.gameReads.clear(); this.deniedGames.clear();
    this.show({ actor: actor ? Object.freeze({ ...actor }) : null, own: initial(), managed: initial(), details: {}, games: {} });
  }
  private current(actor: Actor | null) { return sameActor(actor, this.snapshot.actor); }
  private detail(id: string, patch: Partial<Detail>) {
    this.show({ details: { ...this.snapshot.details, [id]: { status: 'loading', parts: [], ...this.snapshot.details[id], ...patch } } });
  }
  private async pages<T>(load: (cursor?: string) => Promise<CursorPage<T>>, valid: () => boolean, partial?: (items: T[]) => void): Promise<T[]> {
    const items: T[] = [], seen = new Set<string>(); let cursor: string | undefined;
    do {
      const page = await load(cursor);
      if (!valid()) throw new ParticipationError('stale');
      items.push(...page.items); partial?.([...items]);
      if (page.nextCursor && seen.has(page.nextCursor)) throw new ParticipationError('invalid');
      if (page.nextCursor) seen.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  }
  loadOwn = async () => {
    const actor = this.snapshot.actor, serial = ++this.reads.own;
    if (!actor) return;
    const valid = () => this.current(actor) && serial === this.reads.own;
    this.show({ own: { status: 'loading', items: [] } });
    try {
      const items = await this.pages(this.port.own, valid, items => {
        if (items.some(p => p.userId !== actor.actorId)) throw new ParticipationError('invalid');
        this.show({ own: { status: 'loading', items } });
      });
      if (valid()) this.show({ own: { status: 'ready', items } });
    } catch { if (valid()) this.show({ own: { ...this.snapshot.own, status: 'error' } }); }
  };
  loadManaged = async () => {
    const actor = this.snapshot.actor, serial = ++this.reads.managed;
    if (!actor) return;
    const valid = () => this.current(actor) && serial === this.reads.managed;
    this.show({ managed: { status: 'loading', items: [] } });
    try {
      const visible = (items: ManagedGame[]) => items.filter(game => !this.deniedGames.has(game.id));
      const items = await this.pages(this.port.managed, valid, items => this.show({ managed: { status: 'loading', items: visible(items) } }));
      if (valid()) this.show({ managed: { status: 'ready', items: visible(items) } });
    } catch { if (valid()) this.show({ managed: { ...this.snapshot.managed, status: 'error' } }); }
  };
  /** Actor-scoped game resource shared by own rows and details, never the public catalog cache. */
  private gameRead(id: string): Promise<Game> {
    const actor = this.snapshot.actor;
    if (!actor) return Promise.reject(new ParticipationError('stale'));
    const running = this.gameReads.get(id);
    if (running) return running;
    const valid = () => this.current(actor) && this.gameReads.get(id) === work;
    const work: Promise<Game> = Promise.resolve().then(async () => {
      try {
        let raw: unknown;
        try { raw = await this.readGame(id); }
        catch (error) {
          // Only a real public 404 permits the closed authenticated read. Network/parse failures stay failures.
          if (!(error instanceof PublicApiError) || error.status !== 404 || !this.readPrivateGame) throw error;
          if (!valid()) throw new ParticipationError('stale');
          raw = await this.readPrivateGame(id);
        }
        if (!valid()) throw new ParticipationError('stale');
        const game = parseAuthenticatedGame(raw);
        if (game.id !== id) throw new ParticipationError('invalid');
        this.deniedGames.delete(id);
        this.show({ games: { ...this.snapshot.games, [id]: { status: 'ready', game } } });
        return game;
      } catch (error) {
        if (valid()) {
          const denied = error instanceof ParticipationError && [401, 403, 404].includes(error.status) ||
            error instanceof PublicApiError && error.status === 404;
          if (denied) this.deniedGames.add(id);
          // A rejected resource cannot leave a private detail or managed DTO available to another view.
          const detail = this.snapshot.details[id];
          const displayError = error instanceof ParticipationError
            ? new PublicApiError([403, 404].includes(error.status) ? 'unavailable' : error.kind === 'invalid' ? 'invalid' : 'network', error.status || undefined)
            : error;
          this.show({ games: { ...this.snapshot.games, [id]: { status: 'error', error: displayError } },
            ...(detail ? { details: { ...this.snapshot.details, [id]: { ...detail, status: 'error', game: undefined, parts: [], review: undefined } } } : {}),
            ...(denied ? { managed: { ...this.snapshot.managed, items: this.snapshot.managed.items.filter(game => game.id !== id) } } : {}) });
        }
        throw error;
      } finally { if (this.gameReads.get(id) === work) this.gameReads.delete(id); }
    });
    this.gameReads.set(id, work);
    this.show({ games: { ...this.snapshot.games, [id]: { status: 'loading' } } });
    return work;
  }
  loadGame = async (id: string) => { try { await this.gameRead(id); } catch { /* Resource carries safe failure state. */ } };
  loadDetail = async (id: string) => {
    const actor = this.snapshot.actor, serial = (this.detailReads.get(id) ?? 0) + 1; this.detailReads.set(id, serial);
    if (!actor) return;
    const valid = () => this.current(actor) && this.detailReads.get(id) === serial;
    this.detail(id, { status: 'loading', game: undefined, parts: [] });
    try {
      const [game, all] = await Promise.all([this.gameRead(id), this.pages(this.port.own, valid)]);
      if (!valid()) return;
      if (all.some(p => p.userId !== actor.actorId)) throw new ParticipationError('invalid');
      if (this.snapshot.games[id]?.status !== 'ready' || this.snapshot.games[id]?.game !== game) throw new ParticipationError('stale');
      const parts = all.filter(p => p.gameId === id);
      let command = this.snapshot.details[id]?.command;
      if (command?.state === 'unknown') {
        const packet = command.packet;
        const settled = parts.find(p => packet.kind === 'request' ? ['pending', 'confirmed'].includes(p.status)
          : p.id === packet.participationId && p.status === 'withdrawn' && p.version > packet.body.expectedVersion);
        if (settled) command = { ...command, state: 'settled', result: settled };
      }
      this.detail(id, { status: 'ready', game, parts, command });
    } catch { if (valid()) this.detail(id, { status: 'error', game: undefined, parts: [] }); }
  };
  review = (id: string, kind?: 'request' | 'withdraw') => {
    const d = this.snapshot.details[id];
    if (!d || d.status !== 'ready' || d.command?.state === 'sending' || d.command?.state === 'unknown') return;
    this.detail(id, { review: kind });
  };
  confirm = async (id: string) => {
    const actor = this.snapshot.actor, d = this.snapshot.details[id];
    if (!actor || !d || d.status !== 'ready' || !d.game || !d.review || ['sending', 'unknown'].includes(d.command?.state ?? '')) return;
    const own = dominantParticipation(d.parts);
    if (d.review === 'request' && (!canApply(d.game) || own?.status === 'pending' || own?.status === 'confirmed')) return;
    if (d.review === 'withdraw' && (!own || !['pending', 'confirmed'].includes(own.status))) return;
    const packet: Command = Object.freeze(d.review === 'request'
      ? { actor, kind: 'request', gameId: id, body: Object.freeze({ expectedGameVersion: d.game.version }), key: this.random() }
      : { actor, kind: 'withdraw', gameId: id, participationId: own!.id, body: Object.freeze({ expectedVersion: own!.version }), key: this.random() });
    // Synchronous lock before any await: double taps and remounts cannot create a second packet.
    this.detail(id, { review: undefined, command: { packet, state: 'sending' } });
    try {
      const result = await this.port.send(packet);
      if (!this.current(actor)) return;
      if (result.userId !== actor.actorId || result.gameId !== id ||
          (packet.kind === 'request' && !['pending', 'confirmed'].includes(result.status)) ||
          (packet.kind === 'withdraw' && (result.id !== packet.participationId || result.status !== 'withdrawn' || result.version <= packet.body.expectedVersion))) throw new ParticipationError('invalid');
      this.detail(id, { command: { packet, state: 'settled', result } });
    } catch (error) {
      if (!this.current(actor)) return;
      const definite = error instanceof ParticipationError && (error.kind === 'business' || error.kind === 'authority') && error.code !== 'COMMAND_IN_PROGRESS';
      this.detail(id, { command: { packet, state: definite ? 'rejected' : 'unknown', code: definite ? error.code : undefined } });
    }
    if (this.current(actor)) { await this.loadDetail(id); void this.loadOwn(); }
  };
}
export function dominantParticipation(parts: Participation[]): Participation | undefined {
  return [...parts].sort((a, b) => Number(['pending', 'confirmed'].includes(b.status)) - Number(['pending', 'confirmed'].includes(a.status)) || b.attemptNumber - a.attemptNumber || b.version - a.version)[0];
}
export function canApply(game: Game, now = Date.now()) {
  return game.status === 'published' && game.availablePlaces > 0 && Date.parse(game.startsAt) > now && Date.parse(game.applicationDeadlineAt) > now;
}
export type MyGameRow = { gameId: string; managed?: ManagedGame; parts: Participation[] };
export function myGameRows(managed: ManagedGame[], parts: Participation[]): MyGameRow[] {
  const rows = new Map<string, MyGameRow>();
  for (const game of managed) rows.set(game.id, { gameId: game.id, managed: game, parts: [] });
  for (const part of parts) { const row: MyGameRow = rows.get(part.gameId) ?? { gameId: part.gameId, parts: [] }; row.parts.push(part); rows.set(part.gameId, row); }
  return [...rows.values()];
}
