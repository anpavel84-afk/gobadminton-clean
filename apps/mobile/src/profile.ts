import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { City } from './public-api.ts';

export class ProfileError extends Error {
  readonly kind: 'network' | 'invalid' | 'authority' | 'business';
  readonly status: number;
  readonly code: string;
  constructor(kind: ProfileError['kind'], status = 0, code = 'UNKNOWN') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
/** Approved uploaded route or null; providerUrl always quarantined for own/public projection. */
export type OwnAvatar = { uploadedUrl: string | null; providerUrl: null };
export type AvatarReceipt = Readonly<{ version: number; avatar: OwnAvatar }>;
export function parseOwnAvatar(value: unknown): OwnAvatar {
  if (value == null) return { uploadedUrl: null, providerUrl: null };
  if (typeof value !== 'object' || Array.isArray(value)) throw new ProfileError('invalid');
  const a = value as Record<string, unknown>;
  if (a.uploadedUrl === null || a.uploadedUrl === undefined) return { uploadedUrl: null, providerUrl: null };
  if (typeof a.uploadedUrl !== 'string') throw new ProfileError('invalid');
  if (!/^\/v1\/media\/avatars\/[a-f0-9]{64}\.png$/.test(a.uploadedUrl) || a.uploadedUrl.includes('..')) {
    throw new ProfileError('invalid');
  }
  return { uploadedUrl: a.uploadedUrl, providerUrl: null };
}
export type Level = { scaleId: string; scaleVersion: number; levelId: string; provenance: 'self_declared' };
type Looking = { version: number; state: 'active' | 'inactive'; cityId: string | null; areaKey: string | null;
  startsAt: string | null; endsAt: string | null; expiresAt: string | null; formatKeys: string[] };
export type OwnProfile = { publicPlayerId: string | null; version: number; displayName: string; cityId: string | null;
  areaKey: string | null; level: Level | null; bio: string | null; directoryVisible: boolean; contactPolicy: 'requests' | 'closed';
  consentPolicyVersion: string | null; optedInAt: string | null; radarConsented: boolean; radarConsentPolicyVersion: string | null;
  radarConsentedAt: string | null; socialEligible: boolean; trainer: boolean; lookingForGame: Looking | null;
  avatar: OwnAvatar };
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
    // Unknown scale identities stay intact until an explicit level change.
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
    radarConsentedAt: r.radarConsentedAt as string | null, socialEligible: r.socialEligible as boolean, trainer: r.trainer as boolean, lookingForGame,
    // Missing avatar defaults to initials; providerUrl is always quarantined to null for own receipts.
    avatar: parseOwnAvatar(r.avatar) };
}

/** Accepted web LevelGuide identities — pure helpers in the existing profile module. */
export const NTRP_SCALE_ID = 'ntrp' as const;
export const NTRP_SCALE_VERSION = 1 as const;
export const PILOT_SCALE_ID = 'gb-social-pilot' as const;
export const PILOT_SCALE_VERSION = 1 as const;
export const LEVEL_GUIDE_DONT_KNOW = '' as const;
export const LEVEL_GUIDE_KEEP_CONTROL = '__gb_level_guide_keep__' as const;
export const PILOT_LEVEL_OPTIONS = [
  { levelId: 'beginner', label: 'Начинающий' },
  { levelId: 'intermediate', label: 'Средний' },
  { levelId: 'advanced', label: 'Продвинутый' },
] as const;
export const LEVEL_GUIDE_DISCLAIMER =
  'Уровень указываете вы сами — это ориентир для выбора игры, а не официальная квалификация и не гарантия совместимости.';
const NTRP_LEVEL_MIN = 1, NTRP_LEVEL_MAX = 7, NTRP_STEP_INV = 2;
const formatNtrpLevelId = (value: number) => (Math.round(value * NTRP_STEP_INV) / NTRP_STEP_INV).toFixed(1);
const formatNtrpLevelDisplay = (value: number) => formatNtrpLevelId(value).replace('.', ',');
const snapClampNtrpLevel = (raw: number) => {
  if (!Number.isFinite(raw)) return 3;
  const snapped = Math.round(raw * NTRP_STEP_INV) / NTRP_STEP_INV;
  return Math.min(NTRP_LEVEL_MAX, Math.max(NTRP_LEVEL_MIN, snapped));
};
export function ntrpHalfstepIds(): string[] {
  const ids: string[] = [];
  for (let step = NTRP_LEVEL_MIN * NTRP_STEP_INV; step <= NTRP_LEVEL_MAX * NTRP_STEP_INV; step += 1) ids.push(formatNtrpLevelId(step / NTRP_STEP_INV));
  return ids;
}
const SKILL_BLURBS: Record<string, string> = {
  '1.0': 'Только начинаю: держу ракетку, учусь попадать по волану.',
  '1.5': 'Знаком с подачей и базовыми ударами, играю очень спокойно.',
  '2.0': 'Могу коротко отбить обмен, ещё много ошибок и пауз.',
  '2.5': 'Играю короткие партии в спокойном темпе, учусь держать площадку.',
  '3.0': 'Регулярно играю: базовые удары стабильнее, темп любительский.',
  '3.5': 'Уверенный любитель: меняю направление и темп, чувствую партнёра.',
  '4.0': 'Сильная любительская игра, тактика и вариативность ударов.',
  '4.5': 'Очень сильный любитель / уверенный клубный уровень.',
  '5.0': 'Соревновательный любительский ориентир, высокая интенсивность.',
  '5.5': 'Высокий соревновательный любительский ориентир.',
  '6.0': 'Ориентир полупрофессиональной игры — без гарантии квалификации.',
  '6.5': 'Ориентир близко к профессиональному — самооценка, не аттестат.',
  '7.0': 'Профессиональный ориентир по самооценке, не сертификат федерации.',
};
export type LevelGuideSkill = { levelId: string; label: string; summary: string };
export type LevelGuideChoice =
  | { kind: 'none' }
  | { kind: 'keep'; level: Level }
  | { kind: 'ntrp'; levelId: string }
  | { kind: 'pilot'; levelId: string };
export function levelGuideSkills(): LevelGuideSkill[] {
  return ntrpHalfstepIds().map(levelId => ({
    levelId, label: formatNtrpLevelDisplay(Number(levelId)),
    summary: SKILL_BLURBS[levelId] ?? `Ориентировочный уровень ${formatNtrpLevelDisplay(Number(levelId))}.`,
  }));
}
export function levelGuideSkillFor(levelId: string): LevelGuideSkill | null {
  const normalized = normalizeNtrpLevelId(levelId);
  if (!normalized) return null;
  return levelGuideSkills().find(row => row.levelId === normalized) ?? null;
}
export function normalizeNtrpLevelId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(',', '.');
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const snapped = snapClampNtrpLevel(n);
  const asId = formatNtrpLevelId(snapped);
  if (Math.abs(n - snapped) > 1e-9) {
    if (n < NTRP_LEVEL_MIN || n > NTRP_LEVEL_MAX) return null;
    return null;
  }
  return asId;
}
export function isNtrpHalfstepId(levelId: string | null | undefined): boolean {
  const normalized = normalizeNtrpLevelId(levelId);
  return !!normalized && ntrpHalfstepIds().includes(normalized);
}
export function isPilotLevelId(levelId: string | null | undefined): boolean {
  return !!levelId && PILOT_LEVEL_OPTIONS.some(o => o.levelId === levelId);
}
export function isExactNtrpV1Level(level: Level | null | undefined): boolean {
  return !!level && level.scaleId === NTRP_SCALE_ID && Number(level.scaleVersion) === NTRP_SCALE_VERSION && isNtrpHalfstepId(level.levelId);
}
export function isExactPilotV1Level(level: Level | null | undefined): boolean {
  return !!level && level.scaleId === PILOT_SCALE_ID && Number(level.scaleVersion) === PILOT_SCALE_VERSION && isPilotLevelId(level.levelId);
}
export function isKnownProfileLevelChoice(level: Level | null | undefined): boolean {
  return isExactNtrpV1Level(level) || isExactPilotV1Level(level);
}
export function shouldOfferPreservedLevel(level: Level | null | undefined): boolean {
  return !!level && !isKnownProfileLevelChoice(level);
}
export function formatPreservedLevelChoiceLabel(level: Level): string {
  const shown = normalizeNtrpLevelId(level.levelId) ?? level.levelId;
  return `Сохранённый: ${shown} · ${level.scaleId} v${level.scaleVersion}`;
}
export function ntrpSelfDeclaredLevel(levelId: string): Level | null {
  const normalized = normalizeNtrpLevelId(levelId);
  if (!normalized) return null;
  return { scaleId: NTRP_SCALE_ID, scaleVersion: NTRP_SCALE_VERSION, levelId: normalized, provenance: 'self_declared' };
}
export function pilotSocialLevel(levelId: string): Level {
  return { scaleId: PILOT_SCALE_ID, scaleVersion: PILOT_SCALE_VERSION, levelId, provenance: 'self_declared' };
}
export function levelGuideChoiceFromProfile(level: Level | null | undefined): LevelGuideChoice {
  if (!level) return { kind: 'none' };
  if (isExactNtrpV1Level(level)) return { kind: 'ntrp', levelId: normalizeNtrpLevelId(level.levelId) ?? level.levelId };
  if (isExactPilotV1Level(level)) return { kind: 'pilot', levelId: level.levelId };
  return { kind: 'keep', level };
}
export function levelGuideControlValue(choice: LevelGuideChoice): string {
  switch (choice.kind) {
    case 'none': return LEVEL_GUIDE_DONT_KNOW;
    case 'keep': return LEVEL_GUIDE_KEEP_CONTROL;
    case 'ntrp':
    case 'pilot': return choice.levelId;
  }
}
export function levelGuideChoiceFromControlValue(value: string, preserved: Level | null | undefined): LevelGuideChoice {
  const id = String(value ?? '');
  if (!id || id === LEVEL_GUIDE_DONT_KNOW) return { kind: 'none' };
  if (id === LEVEL_GUIDE_KEEP_CONTROL) return preserved ? { kind: 'keep', level: preserved } : { kind: 'none' };
  if (isNtrpHalfstepId(id)) return { kind: 'ntrp', levelId: normalizeNtrpLevelId(id) ?? id };
  if (isPilotLevelId(id)) return { kind: 'pilot', levelId: id };
  return { kind: 'none' };
}
function sameFullLevelIdentity(a: Level, b: Level): boolean {
  return a.scaleId === b.scaleId && Number(a.scaleVersion) === Number(b.scaleVersion) && a.levelId === b.levelId;
}
function sameStoredLevel(a: Level | null, b: Level | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return sameFullLevelIdentity(a, b);
}
export function resolveProfileLevelForSave(choice: LevelGuideChoice, existing: Level | null | undefined): Level | null {
  switch (choice.kind) {
    case 'none': return null;
    case 'keep': return existing && sameFullLevelIdentity(existing, choice.level) ? existing : choice.level;
    case 'ntrp': {
      if (existing && existing.scaleId === NTRP_SCALE_ID && Number(existing.scaleVersion) === NTRP_SCALE_VERSION
          && normalizeNtrpLevelId(existing.levelId) === normalizeNtrpLevelId(choice.levelId)) return existing;
      return ntrpSelfDeclaredLevel(choice.levelId);
    }
    case 'pilot': {
      if (existing && existing.scaleId === PILOT_SCALE_ID && Number(existing.scaleVersion) === PILOT_SCALE_VERSION && existing.levelId === choice.levelId) return existing;
      return isPilotLevelId(choice.levelId) ? pilotSocialLevel(choice.levelId) : null;
    }
  }
}
export function levelChoiceLabel(choice: LevelGuideChoice, preserved: Level | null | undefined): string {
  switch (choice.kind) {
    case 'none': return 'Не знаю / не указывать';
    case 'keep': return preserved ? formatPreservedLevelChoiceLabel(preserved) : formatPreservedLevelChoiceLabel(choice.level);
    case 'ntrp': return levelGuideSkillFor(choice.levelId)?.label ?? choice.levelId;
    case 'pilot': return PILOT_LEVEL_OPTIONS.find(o => o.levelId === choice.levelId)?.label ?? choice.levelId;
  }
}

export type ProfilePatchFlags = Readonly<{ areaKey: boolean; bio: boolean; level: boolean }>;
/** Intended post-save values; patch flags mark which optional fields enter the wire JSON. */
export type ProfileBody = Readonly<{
  expectedVersion: number; displayName: string; cityId: string;
  areaKey: string | null; bio: string | null; level: Level | null;
  patch: ProfilePatchFlags;
}>;
export type ProfilePacket = Readonly<{ actor: Readonly<Actor>; key: string; body: ProfileBody; cityName: string }>;
export type ProfilePort = { read: () => Promise<OwnProfile>; cities: () => Promise<City[]>;
  send: (packet: ProfilePacket, authority: Actor) => Promise<OwnProfile> };
export type ProfileDraft = { displayName: string; cityId: string; areaKey: string; bio: string; levelChoice: LevelGuideChoice };
type Snapshot = { actor: Actor | null; profile: OwnProfile | null; cities: City[]; draft: ProfileDraft;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'stale'; command?: { packet: ProfilePacket; status: 'sending' | 'unknown' };
  notice: string | null };
/** Ordinary enumerable draft — displayName/cityId/areaKey/bio/levelChoice copy and spread without dropped fields. */
export function createProfileDraft(displayName: string, cityId: string, areaKey = '', bio = '', levelChoice: LevelGuideChoice = { kind: 'none' }): ProfileDraft {
  return { displayName, cityId, areaKey, bio, levelChoice };
}
/** Domain-level copy+freeze of the four-field Level identity for immutable save packets. */
function copyFrozenLevel(level: Level | null): Level | null {
  if (!level) return null;
  return Object.freeze({
    scaleId: level.scaleId, scaleVersion: level.scaleVersion, levelId: level.levelId, provenance: level.provenance,
  });
}
const initial = (): Snapshot => ({ actor: null, profile: null, cities: [], draft: createProfileDraft('', ''), status: 'idle', notice: null });
const form = (p: OwnProfile): ProfileDraft => createProfileDraft(
  p.displayName, p.cityId ?? '', p.areaKey ?? '', p.bio ?? '', levelGuideChoiceFromProfile(p.level),
);
const draftFromPacket = (body: ProfileBody): ProfileDraft => createProfileDraft(
  body.displayName, body.cityId, body.areaKey ?? '', body.bio ?? '', levelGuideChoiceFromProfile(body.level),
);
export function profileWireBody(body: ProfileBody): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    expectedVersion: body.expectedVersion, displayName: body.displayName, cityId: body.cityId,
  };
  if (body.patch.areaKey) wire.areaKey = body.areaKey;
  if (body.patch.bio) wire.bio = body.bio;
  if (body.patch.level) wire.level = body.level;
  return wire;
}
export const moderationCodes = ['PUBLIC_TEXT_CONTENT_REJECTED','MODERATION_TEMPORARILY_UNAVAILABLE','MODERATION_POLICY_MISMATCH','MODERATION_RATE_LIMITED'];
/** Root lifetime owner. No disk persistence, generic mutation framework or automatic writes. */
export class ProfileCoordinator {
  private state = initial(); private listeners = new Set<() => void>(); private serial = 0;
  private quarantined: ProfilePacket | null = null;
  private readonly port: ProfilePort; private readonly random: () => string;
  private readonly isPeerBusy: () => boolean;
  constructor(port: ProfilePort, random: () => string, isPeerBusy: () => boolean = () => false) {
    this.port = port; this.random = random; this.isPeerBusy = isPeerBusy;
  }
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
      draft: draftFromPacket(packet.body), notice: 'Результат сохранения неизвестен. Можно явно повторить только прежнее сохранение с тем же ключом и данными.' } : {}) });
  }
  forget = () => { this.quarantined = null; this.serial++; this.state = initial(); this.show({}); };
  /** Authoritative avatar/version only — never replaces unsaved name/level/area/bio draft. Delayed older receipts cannot overwrite newer state. */
  applyAvatarReceipt = (receipt: AvatarReceipt) => {
    const profile = this.state.profile;
    if (!profile || this.state.command) return;
    if (receipt.version < profile.version) return;
    this.show({
      profile: { ...profile, version: receipt.version, avatar: { uploadedUrl: receipt.avatar.uploadedUrl, providerUrl: null } },
      status: this.state.status === 'idle' ? 'idle' : this.state.status === 'error' ? 'error' : this.state.status === 'stale' ? 'stale' : this.state.status === 'loading' ? 'loading' : 'ready',
    });
  };
  /**
   * Full authoritative GET rebase: adopt fresh baseline/pristine fields and version/avatar,
   * while preserving each locally dirty name/city/level/area/bio draft field.
   * Older historical receipts cannot dominate the current version authority.
   */
  rebaseFromAuthoritative = (fresh: OwnProfile) => {
    const profile = this.state.profile;
    if (!profile || this.state.command) return;
    if (fresh.version < profile.version) return;
    const draft = this.state.draft;
    const baseline = form(profile);
    const next = form(fresh);
    const sameChoice = (a: LevelGuideChoice, b: LevelGuideChoice) => {
      if (a.kind !== b.kind) return false;
      if (a.kind === 'none' && b.kind === 'none') return true;
      if (a.kind === 'ntrp' && b.kind === 'ntrp') return a.levelId === b.levelId;
      if (a.kind === 'pilot' && b.kind === 'pilot') return a.levelId === b.levelId;
      if (a.kind === 'keep' && b.kind === 'keep') return sameFullLevelIdentity(a.level, b.level);
      return false;
    };
    this.show({
      profile: {
        ...fresh,
        avatar: { uploadedUrl: fresh.avatar.uploadedUrl, providerUrl: null },
      },
      draft: createProfileDraft(
        draft.displayName === baseline.displayName ? next.displayName : draft.displayName,
        draft.cityId === baseline.cityId ? next.cityId : draft.cityId,
        draft.areaKey === baseline.areaKey ? next.areaKey : draft.areaKey,
        draft.bio === baseline.bio ? next.bio : draft.bio,
        sameChoice(draft.levelChoice, baseline.levelChoice) ? next.levelChoice : draft.levelChoice,
      ),
      status: this.state.status === 'idle' ? 'idle' : this.state.status === 'error' ? 'error' : this.state.status === 'stale' ? 'stale' : this.state.status === 'loading' ? 'loading' : 'ready',
    });
  };
  load = async () => {
    const actor = this.state.actor;
    if (!actor || this.state.command || this.state.status === 'loading' || this.isPeerBusy()) return;
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
  update = (patch: Partial<ProfileDraft>) => {
    if (!this.state.actor || this.state.command || this.state.status !== 'ready' || this.isPeerBusy()) return;
    if (patch.cityId !== undefined && !this.state.cities.some(c => c.id === patch.cityId)) return;
    const d = this.state.draft;
    this.show({
      draft: createProfileDraft(
        patch.displayName !== undefined ? patch.displayName : d.displayName,
        patch.cityId !== undefined ? patch.cityId : d.cityId,
        patch.areaKey !== undefined ? patch.areaKey : d.areaKey,
        patch.bio !== undefined ? patch.bio : d.bio,
        patch.levelChoice !== undefined ? patch.levelChoice : d.levelChoice,
      ),
      notice: null,
    });
  };
  cancel = () => {
    if (this.state.command || this.state.status !== 'ready' || !this.state.profile || this.isPeerBusy()) return;
    this.show({ draft: form(this.state.profile), notice: 'Изменения отменены.' });
  };
  save = async () => {
    const { actor, profile, draft, cities, status, command } = this.state;
    if (!actor || !profile || command || status !== 'ready' || this.isPeerBusy()) return;
    const displayName = draft.displayName.trim();
    const city = cities.find(c => c.id === draft.cityId);
    if (!displayName || displayName.length > 80 || !city) {
      this.show({ notice: 'Введите имя от 1 до 80 символов и выберите город из каталога.' }); return;
    }
    const areaKey = draft.areaKey.trim() || null;
    if (areaKey !== null && areaKey.length > 64) {
      this.show({ notice: 'Район / метро — до 64 символов.' }); return;
    }
    const bio = draft.bio.trim() || null;
    if (bio !== null && bio.length > 500) {
      this.show({ notice: 'О себе — до 500 символов.' }); return;
    }
    const level = copyFrozenLevel(resolveProfileLevelForSave(draft.levelChoice, profile.level));
    const packet = Object.freeze({ actor: Object.freeze({ ...actor }), key: this.random(), cityName: city.nameRu,
      body: Object.freeze({
        expectedVersion: profile.version, displayName, cityId: draft.cityId, areaKey, bio, level,
        patch: Object.freeze({
          areaKey: areaKey !== profile.areaKey,
          bio: bio !== profile.bio,
          level: !sameStoredLevel(level, profile.level),
        }),
      }) });
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
      const { body } = packet;
      if (profile.version <= body.expectedVersion || profile.displayName !== body.displayName || profile.cityId !== body.cityId
          || profile.areaKey !== body.areaKey || profile.bio !== body.bio || !sameStoredLevel(profile.level, body.level)) throw new ProfileError('invalid');
      this.show({ profile, draft: form(profile), command: undefined, status: 'ready', notice: 'Профиль сохранён.' });
      // A restored UNKNOWN has no catalog yet. Read only on the next explicit editor load.
      if (!this.state.cities.length) this.show({ status: 'idle' });
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ProfileError && error.kind === 'business' && error.status < 500 && error.code !== 'COMMAND_IN_PROGRESS') {
        const stale = error.status === 409;
        this.show({ command: undefined, status: stale ? 'stale' : 'ready', notice: stale
          ? 'Профиль изменился. Загрузите актуальный профиль и проверьте его перед новым редактированием. Прежние изменения не будут отправлены автоматически.'
          : moderationCodes.includes(error.code) ? 'Изменения не сохранены. Проверьте публичный текст или повторите позже. Введённые данные сохранены в форме.'
          : 'Изменения не сохранены. Проверьте поля и повторите.' });
      } else this.show({ command: { packet, status: 'unknown' }, notice: 'Результат сохранения неизвестен. Проверка повторит только это сохранение с прежними данными и ключом. Новое сохранение пока недоступно.' });
    }
  }
}
