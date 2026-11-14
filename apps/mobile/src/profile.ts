import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { City } from './public-api.ts';

export class ProfileError extends Error {
  readonly kind: 'network' | 'invalid' | 'authority' | 'business';
  readonly status: number;
  readonly code: string;
  constructor(kind: ProfileError['kind'], status = 0, code = 'UNKNOWN') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
type Level = { scaleId: string; scaleVersion: number; levelId: string; provenance: 'self_declared' };
type Looking = { version: number; state: 'active' | 'inactive'; cityId: string | null; areaKey: string | null;
  startsAt: string | null; endsAt: string | null; expiresAt: string | null; formatKeys: string[] };
export type OwnProfile = { publicPlayerId: string | null; version: number; displayName: string; cityId: string | null;
  areaKey: string | null; level: Level | null; bio: string | null; directoryVisible: boolean; contactPolicy: 'requests' | 'closed';
  consentPolicyVersion: string | null; optedInAt: string | null; radarConsented: boolean; radarConsentPolicyVersion: string | null;
  radarConsentedAt: string | null; socialEligible: boolean; trainer: boolean; lookingForGame: Looking | null };
const row = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ProfileError('invalid');
  return v as Record<string, unknown>;
};
const text = (v: unknown): v is string => typeof v === 'string';
const nullable = (v: unknown): v is string | null => v === null || text(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown) => v === null || text(v) && Number.isFinite(Date.parse(v));
/** Full required own-profile contract, independent of the intentionally narrow CreatorProfile. No identity fallback. */
export function parseOwnProfile(value: unknown): OwnProfile {
  const r = row(value);
  if (!version(r.version) || !text(r.displayName) || r.displayName.length > 80 ||
      !(r.publicPlayerId === null || text(r.publicPlayerId) && r.publicPlayerId.length > 0) ||
      !(r.cityId === null || text(r.cityId) && r.cityId.length > 0) ||
      !['areaKey','bio','consentPolicyVersion','radarConsentPolicyVersion'].every(k => nullable(r[k])) ||
      !['directoryVisible','radarConsented','socialEligible','trainer'].every(k => typeof r[k] === 'boolean') ||
      !text(r.contactPolicy) || !['requests','closed'].includes(r.contactPolicy) || !date(r.optedInAt) || !date(r.radarConsentedAt)) throw new ProfileError('invalid');
  let level: Level | null = null, lookingForGame: Looking | null = null;
  if (r.level !== null) {
    const l = row(r.level);
    if (!text(l.scaleId) || !l.scaleId || !version(l.scaleVersion) || l.scaleVersion < 1 || !text(l.levelId) || !l.levelId || l.provenance !== 'self_declared') throw new ProfileError('invalid');
    // Unknown scale identities stay intact; this slice never edits levels.
    level = { scaleId: l.scaleId, scaleVersion: l.scaleVersion, levelId: l.levelId, provenance: 'self_declared' };
  }
  if (r.lookingForGame !== null) {
    const l = row(r.lookingForGame);
    if (!version(l.version) || !text(l.state) || !['active','inactive'].includes(l.state) || !nullable(l.cityId) || !nullable(l.areaKey) ||
        !date(l.startsAt) || !date(l.endsAt) || !date(l.expiresAt) || !Array.isArray(l.formatKeys) || !l.formatKeys.every(text)) throw new ProfileError('invalid');
    lookingForGame = { version: l.version, state: l.state as Looking['state'], cityId: l.cityId, areaKey: l.areaKey,
      startsAt: l.startsAt as string | null, endsAt: l.endsAt as string | null, expiresAt: l.expiresAt as string | null, formatKeys: [...l.formatKeys] };
  }
  return { publicPlayerId: r.publicPlayerId as string | null, version: r.version, displayName: r.displayName, cityId: r.cityId as string | null,
    areaKey: r.areaKey as string | null, level, bio: r.bio as string | null, directoryVisible: r.directoryVisible as boolean,
    contactPolicy: r.contactPolicy as OwnProfile['contactPolicy'], consentPolicyVersion: r.consentPolicyVersion as string | null,
    optedInAt: r.optedInAt as string | null, radarConsented: r.radarConsented as boolean, radarConsentPolicyVersion: r.radarConsentPolicyVersion as string | null,
    radarConsentedAt: r.radarConsentedAt as string | null, socialEligible: r.socialEligible as boolean, trainer: r.trainer as boolean, lookingForGame };
}
export type ProfileBody = Readonly<{ expectedVersion: number; displayName: string; cityId: string }>;
export type ProfilePacket = Readonly<{ actor: Readonly<Actor>; key: string; body: ProfileBody; cityName: string }>;
export type ProfilePort = { read: () => Promise<OwnProfile>; cities: () => Promise<City[]>;
  send: (packet: ProfilePacket, authority: Actor) => Promise<OwnProfile> };
type Draft = { displayName: string; cityId: string };
type Snapshot = { actor: Actor | null; profile: OwnProfile | null; cities: City[]; draft: Draft;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'stale'; command?: { packet: ProfilePacket; status: 'sending' | 'unknown' };
  notice: string | null };
const initial = (): Snapshot => ({ actor: null, profile: null, cities: [], draft: { displayName: '', cityId: '' }, status: 'idle', notice: null });
const form = (p: OwnProfile): Draft => ({ displayName: p.displayName, cityId: p.cityId ?? '' });
export const moderationCodes = ['PUBLIC_TEXT_CONTENT_REJECTED','MODERATION_TEMPORARILY_UNAVAILABLE','MODERATION_POLICY_MISMATCH','MODERATION_RATE_LIMITED'];
/** Root lifetime owner. No disk persistence, generic mutation framework or automatic writes. */
export class ProfileCoordinator {
  private state = initial(); private listeners = new Set<() => void>(); private serial = 0;
  private quarantined: ProfilePacket | null = null;
  private readonly port: ProfilePort; private readonly random: () => string;
  constructor(port: ProfilePort, random: () => string) { this.port = port; this.random = random; }
  getSnapshot = () => this.state;
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private show(p: Partial<Snapshot>) { this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()); }
  private current(actor: Actor) { return sameActor(actor, this.state.actor); }
  setActor(actor: Actor | null) {
    if (sameActor(actor, this.state.actor) || !actor && !this.state.actor) return;
    if (this.state.command) this.quarantined = this.state.command.packet;
    if (actor && this.quarantined?.actor.actorId !== actor.actorId) this.quarantined = null;
    const packet = actor ? this.quarantined : null;
    if (actor) this.quarantined = null;
    this.serial++; this.state = initial();
    this.show({ actor: actor ? Object.freeze({ ...actor }) : null, ...(packet ? { command: { packet, status: 'unknown' as const },
      draft: { displayName: packet.body.displayName, cityId: packet.body.cityId }, notice: 'Результат сохранения неизвестен. Можно явно повторить только прежнее сохранение с тем же ключом и данными.' } : {}) });
  }
  forget = () => { this.quarantined = null; this.serial++; this.state = initial(); this.show({}); };
  load = async () => {
    const actor = this.state.actor;
    if (!actor || this.state.command || this.state.status === 'loading') return;
    const serial = ++this.serial;
    this.show({ status: 'loading', notice: null });
    try {
      const [profile, cities] = await Promise.all([this.port.read(), this.port.cities()]);
      if (!this.current(actor) || serial !== this.serial) return;
      this.show({ profile, cities, draft: form(profile), status: 'ready', notice: profile.displayName.trim() && profile.cityId ? null : 'Укажите публичное имя и выберите город. Имя аккаунта не подставляется.' });
    } catch {
      if (this.current(actor) && serial === this.serial) this.show({ status: 'error', notice: 'Не удалось проверить профиль и каталог городов. Повторите загрузку.' });
    }
  };
  update = (patch: Partial<Draft>) => {
    if (!this.state.actor || this.state.command || this.state.status !== 'ready') return;
    if (patch.cityId !== undefined && !this.state.cities.some(c => c.id === patch.cityId)) return;
    this.show({ draft: { ...this.state.draft, ...patch }, notice: null });
  };
  cancel = () => {
    if (this.state.command || this.state.status !== 'ready' || !this.state.profile) return;
    this.show({ draft: form(this.state.profile), notice: 'Изменения отменены.' });
  };
  save = async () => {
    const { actor, profile, draft, cities, status, command } = this.state;
    if (!actor || !profile || command || status !== 'ready') return;
    const displayName = draft.displayName.trim();
    const city = cities.find(c => c.id === draft.cityId);
    if (!displayName || displayName.length > 80 || !city) {
      this.show({ notice: 'Введите имя от 1 до 80 символов и выберите город из каталога.' }); return;
    }
    const packet = Object.freeze({ actor: Object.freeze({ ...actor }), key: this.random(), cityName: city.nameRu,
      body: Object.freeze({ expectedVersion: profile.version, displayName, cityId: draft.cityId }) });
    await this.dispatch(packet, actor);
  };
  reconcile = async () => {
    const { actor, command } = this.state;
    if (actor && command?.status === 'unknown' && command.packet.actor.actorId === actor.actorId) await this.dispatch(command.packet, actor);
  };
  private async dispatch(packet: ProfilePacket, authority: Actor) {
    // Synchronous guard precedes the first await; each call owns a frozen original packet.
    this.serial++; this.show({ command: { packet, status: 'sending' }, notice: null });
    const valid = () => this.current(authority) && this.state.command?.packet === packet && this.state.command.status === 'sending';
    try {
      const profile = await this.port.send(packet, authority);
      if (!valid()) return;
      if (profile.version <= packet.body.expectedVersion || profile.displayName !== packet.body.displayName || profile.cityId !== packet.body.cityId) throw new ProfileError('invalid');
      this.show({ profile, draft: form(profile), command: undefined, status: 'ready', notice: 'Имя и город сохранены.' });
      // A restored UNKNOWN has no catalog yet. Read only on the next explicit editor load.
      if (!this.state.cities.length) this.show({ status: 'idle' });
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ProfileError && error.kind === 'business' && error.status < 500 && error.code !== 'COMMAND_IN_PROGRESS') {
        const stale = error.status === 409;
        this.show({ command: undefined, status: stale ? 'stale' : 'ready', notice: stale
          ? 'Профиль изменился. Загрузите актуальный профиль и проверьте его перед новым редактированием. Прежние изменения не будут отправлены автоматически.'
          : moderationCodes.includes(error.code) ? 'Имя не сохранено. Проверьте публичный текст или повторите позже. Введённые данные сохранены в форме.'
          : 'Изменения не сохранены. Проверьте имя и выбранный город; затем повторите.' });
      } else this.show({ command: { packet, status: 'unknown' }, notice: 'Результат сохранения неизвестен. Проверка повторит только это сохранение с прежними данными и ключом. Новое сохранение пока недоступно.' });
    }
  }
}
