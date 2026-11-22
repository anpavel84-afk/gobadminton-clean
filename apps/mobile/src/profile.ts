import { sameActor } from './participation.ts';
import type { Actor } from './participation.ts';
import type { City } from './public-api.ts';
import type { LookingPutBody, LookingTtlMinutes } from './looking-for-game.ts';
import { isLookingTtlMinutes, lookingIntentExpired } from './looking-for-game.ts';

export class ProfileError extends Error {
  readonly kind: 'network' | 'invalid' | 'authority' | 'business';
  readonly status: number;
  readonly code: string;
  constructor(kind: ProfileError['kind'], status = 0, code = 'UNKNOWN') { super(kind); this.kind = kind; this.status = status; this.code = code; }
}
/** Approved uploaded route or null; providerUrl always quarantined for own/public projection. */
export type OwnAvatar = { uploadedUrl: string | null; providerUrl: null };
export type AvatarReceipt = Readonly<{ version: number; avatar: OwnAvatar }>;
export type OwnCover = { uploadedUrl: string | null };
export type CoverReceipt = Readonly<{ version: number; cover: OwnCover }>;
export function parseOwnCover(value: unknown): OwnCover {
  if (value == null) return { uploadedUrl: null };
  if (typeof value !== 'object' || Array.isArray(value)) throw new ProfileError('invalid');
  const c = value as Record<string, unknown>;
  if (c.uploadedUrl === null || c.uploadedUrl === undefined) return { uploadedUrl: null };
  if (typeof c.uploadedUrl !== 'string') throw new ProfileError('invalid');
  if (!/^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/.test(c.uploadedUrl) || c.uploadedUrl.includes('..')) {
    return { uploadedUrl: null };
  }
  return { uploadedUrl: c.uploadedUrl };
}
export function parseCoverReceipt(value: unknown): CoverReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfileError('invalid');
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.version) || Number(row.version) < 0) throw new ProfileError('invalid');
  return { version: row.version as number, cover: parseOwnCover(row.cover) };
}
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
export type Looking = { version: number; state: 'active' | 'inactive'; cityId: string | null; areaKey: string | null;
  startsAt: string | null; endsAt: string | null; expiresAt: string | null; formatKeys: string[] };
export function parseLookingIntent(value: unknown): Looking {
  const l = row(value);
  if (!version(l.version) || !text(l.state) || !['active', 'inactive'].includes(l.state) || !nullable(l.cityId) || !nullable(l.areaKey) ||
      !date(l.startsAt) || !date(l.endsAt) || !date(l.expiresAt) || !Array.isArray(l.formatKeys) || !l.formatKeys.every(text)) {
    throw new ProfileError('invalid');
  }
  return {
    version: l.version as number, state: l.state as Looking['state'], cityId: l.cityId as string | null, areaKey: l.areaKey as string | null,
    startsAt: l.startsAt as string | null, endsAt: l.endsAt as string | null, expiresAt: l.expiresAt as string | null,
    formatKeys: [...l.formatKeys as string[]],
  };
}
export type OwnProfile = { publicPlayerId: string | null; version: number; displayName: string; cityId: string | null;
  areaKey: string | null; level: Level | null; bio: string | null; directoryVisible: boolean; contactPolicy: 'requests' | 'closed';
  consentPolicyVersion: string | null; optedInAt: string | null; radarConsented: boolean; radarConsentPolicyVersion: string | null;
  radarConsentedAt: string | null; socialEligible: boolean; trainer: boolean; lookingForGame: Looking | null;
  avatar: OwnAvatar; cover?: { uploadedUrl: string | null } };
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
  if (r.lookingForGame !== null) lookingForGame = parseLookingIntent(r.lookingForGame);
  const profile: OwnProfile = { publicPlayerId: r.publicPlayerId as string | null, version: r.version, displayName: r.displayName, cityId: r.cityId as string | null,
    areaKey: r.areaKey as string | null, level, bio: r.bio as string | null, directoryVisible: r.directoryVisible as boolean,
    contactPolicy: r.contactPolicy as OwnProfile['contactPolicy'], consentPolicyVersion: r.consentPolicyVersion as string | null,
    optedInAt: r.optedInAt as string | null, radarConsented: r.radarConsented as boolean, radarConsentPolicyVersion: r.radarConsentPolicyVersion as string | null,
    radarConsentedAt: r.radarConsentedAt as string | null, socialEligible: r.socialEligible as boolean, trainer: r.trainer as boolean, lookingForGame,
    // Missing avatar defaults to initials; providerUrl is always quarantined to null for own receipts.
    avatar: parseOwnAvatar(r.avatar) };
  // Optional cover: set only when wire has cover; invalid path → null; non-object → invalid (same rule as playerMediaUrl cover).
  if (r.cover != null) {
    if (typeof r.cover !== 'object' || Array.isArray(r.cover)) throw new ProfileError('invalid');
    const c = r.cover as Record<string, unknown>;
    if (!(c.uploadedUrl === null || typeof c.uploadedUrl === 'string')) throw new ProfileError('invalid');
    const uploadedUrl = typeof c.uploadedUrl === 'string'
      && /^\/v1\/media\/covers\/[a-f0-9]{64}\.png$/.test(c.uploadedUrl) && !c.uploadedUrl.includes('..')
      ? c.uploadedUrl : null;
    profile.cover = { uploadedUrl };
  }
  return profile;
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
/** Policy-only command — wire is exactly {expectedVersion,contactPolicy}; never carries name/city/bio. */
export type ContactPolicyBody = Readonly<{ expectedVersion: number; contactPolicy: 'requests' | 'closed' }>;
/** Catalog visibility — PUT body only; consentPolicyVersion only when ON and already stored. */
export type VisibilityBody = Readonly<{
  directoryVisible: boolean;
  expectedVersion: number;
  consentPolicyVersion?: string;
}>;
export type LookingPacket =
  | Readonly<{ kind: 'lookingPut'; actor: Readonly<Actor>; key: string; body: LookingPutBody }>
  | Readonly<{ kind: 'lookingDelete'; actor: Readonly<Actor>; key: string }>;
export type VisibilityPacket =
  Readonly<{ kind: 'visibility'; actor: Readonly<Actor>; key: string; body: VisibilityBody }>;
export type ProfileMutationPacket =
  | Readonly<{ kind: 'profile'; actor: Readonly<Actor>; key: string; body: ProfileBody; cityName: string }>
  | Readonly<{ kind: 'contactPolicy'; actor: Readonly<Actor>; key: string; body: ContactPolicyBody }>;
export type ProfilePacket = ProfileMutationPacket | LookingPacket | VisibilityPacket;
export type ProfilePort = { read: () => Promise<OwnProfile>; cities: () => Promise<City[]>;
  send: (packet: ProfileMutationPacket, authority: Actor) => Promise<OwnProfile>;
  /** Optional until a looking mutation is admitted; missing port refuses looking writes. */
  looking?: (packet: LookingPacket, authority: Actor) => Promise<Looking>;
  /** Optional until visibility PUT is admitted; missing port refuses catalog visibility writes. */
  visibility?: (packet: VisibilityPacket, authority: Actor) => Promise<OwnProfile> };
export type ProfileDraft = { displayName: string; cityId: string; areaKey: string; bio: string; levelChoice: LevelGuideChoice };
/** Typed read routing — never inferred from localized notice text. */
export type ProfileReadIntent = null | 'rebase';
export type ProfileNoticeOwner = null | 'profile' | 'contactPolicy' | 'looking' | 'visibility';
type Snapshot = { actor: Actor | null; profile: OwnProfile | null; cities: City[]; draft: ProfileDraft;
  status: 'idle' | 'loading' | 'ready' | 'error' | 'stale'; command?: { packet: ProfilePacket; status: 'sending' | 'unknown' };
  notice: string | null; noticeOwner: ProfileNoticeOwner; readIntent: ProfileReadIntent };
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
const initial = (): Snapshot => ({
  actor: null, profile: null, cities: [], draft: createProfileDraft('', ''), status: 'idle', notice: null, noticeOwner: null, readIntent: null,
});
function noticeOwnerOf(packet: ProfilePacket): ProfileNoticeOwner {
  if (packet.kind === 'contactPolicy') return 'contactPolicy';
  if (packet.kind === 'lookingPut' || packet.kind === 'lookingDelete') return 'looking';
  if (packet.kind === 'visibility') return 'visibility';
  return 'profile';
}
/** Exact visibility PUT wire — never invents consent; omits consentPolicyVersion unless ON+present. */
export function visibilityWireBody(body: VisibilityBody): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    directoryVisible: body.directoryVisible,
    expectedVersion: body.expectedVersion,
  };
  if (body.directoryVisible && body.consentPolicyVersion !== undefined) {
    wire.consentPolicyVersion = body.consentPolicyVersion;
  }
  return wire;
}
const form = (p: OwnProfile): ProfileDraft => createProfileDraft(
  p.displayName, p.cityId ?? '', p.areaKey ?? '', p.bio ?? '', levelGuideChoiceFromProfile(p.level),
);
const draftFromPacket = (body: ProfileBody): ProfileDraft => createProfileDraft(
  body.displayName, body.cityId, body.areaKey ?? '', body.bio ?? '', levelGuideChoiceFromProfile(body.level),
);
export function profileWireBody(body: ProfileBody | ContactPolicyBody): Record<string, unknown> {
  if ('contactPolicy' in body) {
    return { expectedVersion: body.expectedVersion, contactPolicy: body.contactPolicy };
  }
  const wire: Record<string, unknown> = {
    expectedVersion: body.expectedVersion, displayName: body.displayName, cityId: body.cityId,
  };
  if (body.patch.areaKey) wire.areaKey = body.areaKey;
  if (body.patch.bio) wire.bio = body.bio;
  if (body.patch.level) wire.level = body.level;
  return wire;
}
export const moderationCodes = ['PUBLIC_TEXT_CONTENT_REJECTED','MODERATION_TEMPORARILY_UNAVAILABLE','MODERATION_POLICY_MISMATCH','MODERATION_RATE_LIMITED'];
type DraftQuarantine = {
  actorId: string;
  packet: ProfilePacket | null;
  draft: ProfileDraft;
  /** Visibility pending only — dirty-field baseline after same-account restore. */
  baseline: OwnProfile | null;
};
const sameLevelChoice = (a: LevelGuideChoice, b: LevelGuideChoice) => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none' && b.kind === 'none') return true;
  if (a.kind === 'ntrp' && b.kind === 'ntrp') return a.levelId === b.levelId;
  if (a.kind === 'pilot' && b.kind === 'pilot') return a.levelId === b.levelId;
  if (a.kind === 'keep' && b.kind === 'keep') return sameFullLevelIdentity(a.level, b.level);
  return false;
};
/** Merge locally dirty draft fields over a fresh authoritative form using a known baseline. */
function mergeDirtyDraft(draft: ProfileDraft, baseline: OwnProfile, fresh: OwnProfile): ProfileDraft {
  const baseForm = form(baseline);
  const next = form(fresh);
  return createProfileDraft(
    draft.displayName === baseForm.displayName ? next.displayName : draft.displayName,
    draft.cityId === baseForm.cityId ? next.cityId : draft.cityId,
    draft.areaKey === baseForm.areaKey ? next.areaKey : draft.areaKey,
    draft.bio === baseForm.bio ? next.bio : draft.bio,
    sameLevelChoice(draft.levelChoice, baseForm.levelChoice) ? next.levelChoice : draft.levelChoice,
  );
}
/** Root lifetime owner. No disk persistence, generic mutation framework or automatic writes. */
export class ProfileCoordinator {
  private state = initial(); private listeners = new Set<() => void>(); private serial = 0;
  private quarantined: DraftQuarantine | null = null;
  /** Baseline kept after same-account restore until the next authoritative adopt/load. */
  private restoredBaseline: OwnProfile | null = null;
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
    if (this.state.actor) {
      const packet = this.state.command?.packet ?? null;
      if (packet) {
        const d = this.state.draft;
        const retainDraft = packet.kind === 'visibility';
        this.quarantined = {
          actorId: this.state.actor.actorId,
          packet,
          // Visibility pending only: keep dirty draft + baseline across same-account gaps.
          draft: retainDraft
            ? createProfileDraft(d.displayName, d.cityId, d.areaKey, d.bio, d.levelChoice)
            : createProfileDraft('', ''),
          baseline: retainDraft ? (this.state.profile ?? this.restoredBaseline) : null,
        };
      } else {
        // No pending command — do not capture unrelated private form state.
        this.quarantined = null;
      }
    }
    if (actor && this.quarantined?.actorId !== actor.actorId) this.quarantined = null;
    const saved = actor ? this.quarantined : null;
    if (actor) this.quarantined = null;
    this.serial++; this.state = initial();
    this.restoredBaseline = null;
    if (!actor) {
      this.show({ actor: null });
      return;
    }
    if (!saved) {
      this.show({ actor: Object.freeze({ ...actor }) });
      return;
    }
    this.restoredBaseline = saved.baseline;
    const packet = saved.packet;
    this.show({
      actor: Object.freeze({ ...actor }),
      // Profile UNKNOWN: immutable packet-form. Visibility pending: retained dirty draft.
      // contactPolicy/Looking UNKNOWN: original packet/recovery only with blank form.
      draft: packet?.kind === 'profile'
        ? draftFromPacket(packet.body)
        : packet?.kind === 'visibility'
        ? saved.draft
        : createProfileDraft('', ''),
      ...(packet ? {
        command: { packet, status: 'unknown' as const },
        noticeOwner: noticeOwnerOf(packet),
        notice: packet.kind === 'contactPolicy'
          ? 'Результат настройки личных сообщений неизвестен. Можно явно повторить только прежнюю отправку с тем же ключом и значением.'
          : packet.kind === 'lookingPut' || packet.kind === 'lookingDelete'
          ? 'Результат статуса «Ищу игру» неизвестен. Можно явно повторить только прежнюю отправку с тем же ключом и данными.'
          : packet.kind === 'visibility'
          ? 'Пока не удалось подтвердить изменение видимости. Можно явно повторить только прежнюю отправку с тем же ключом и значением.'
          : 'Результат сохранения неизвестен. Можно явно повторить только прежнее сохранение с тем же ключом и данными.',
      } : {}),
    });
  }
  forget = () => {
    this.quarantined = null; this.restoredBaseline = null;
    this.serial++; this.state = initial(); this.show({});
  };
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
  /** Authoritative cover/version only — never replaces unsaved name/level/area/bio draft. Delayed older receipts ignored. */
  applyCoverReceipt = (receipt: CoverReceipt) => {
    const profile = this.state.profile;
    if (!profile || this.state.command) return;
    if (receipt.version < profile.version) return;
    this.show({
      profile: { ...profile, version: receipt.version, cover: { uploadedUrl: receipt.cover.uploadedUrl } },
      status: this.state.status === 'idle' ? 'idle' : this.state.status === 'error' ? 'error' : this.state.status === 'stale' ? 'stale' : this.state.status === 'loading' ? 'loading' : 'ready',
    });
  };
  /**
   * Full authoritative GET rebase: adopt fresh baseline/pristine fields and version/avatar,
   * while preserving each locally dirty name/city/level/area/bio draft field.
   * Older historical receipts cannot dominate the current version authority.
   * @returns false when ignored (no profile, command in flight, or lower historical version).
   */
  rebaseFromAuthoritative = (fresh: OwnProfile): boolean => {
    const profile = this.state.profile;
    if (!profile || this.state.command) return false;
    if (fresh.version < profile.version) return false;
    this.show({
      profile: {
        ...fresh,
        avatar: { uploadedUrl: fresh.avatar.uploadedUrl, providerUrl: null },
      },
      draft: mergeDirtyDraft(this.state.draft, profile, fresh),
      status: this.state.status === 'idle' ? 'idle' : this.state.status === 'error' ? 'error' : this.state.status === 'stale' ? 'stale' : this.state.status === 'loading' ? 'loading' : 'ready',
    });
    return true;
  };
  load = async () => {
    const actor = this.state.actor;
    if (!actor || this.state.command || this.state.status === 'loading' || this.isPeerBusy()) return;
    const serial = ++this.serial;
    this.show({ status: 'loading', notice: null, noticeOwner: null });
    try {
      const [profile, cities] = await Promise.all([this.port.read(), this.port.cities()]);
      if (!this.current(actor) || serial !== this.serial) return;
      // Visibility/same-actor recovery may retain restoredBaseline so a later idle load
      // preserves dirty fields and adopts only pristine ones from the fresh GET.
      const baseline = this.restoredBaseline;
      this.restoredBaseline = null;
      const draft = baseline
        ? mergeDirtyDraft(this.state.draft, baseline, profile)
        : form(profile);
      this.show({
        profile, cities, draft, status: 'ready', readIntent: null,
        notice: profile.displayName.trim() && profile.cityId ? null : 'Укажите публичное имя и выберите город. Имя аккаунта не подставляется.',
        noticeOwner: profile.displayName.trim() && profile.cityId ? null : 'profile',
      });
    } catch {
      // Keep restoredBaseline + draft; retry stays reachable. Never invent UNKNOWN clearance.
      if (this.current(actor) && serial === this.serial) this.show({ status: 'error', notice: 'Не удалось проверить профиль и каталог городов. Повторите загрузку.', noticeOwner: 'profile' });
    }
  };
  /**
   * Authoritative GET + dirty-preserving adopt while readIntent==='rebase'.
   * Allowed from status stale, or error after a failed rebase GET (intent retained).
   * Works with a loaded profile OR null-profile same-actor visibility recovery that still
   * holds restoredBaseline (409 / consent-invalid / explicit refresh after rejection).
   * Preserves dirty name/city/area/bio/level; adopts fresh version/policy/pristine fields.
   * No auto write / policy resend. Does not infer cause from notice text.
   * Lower historical GET must not claim ready/fresh.
   */
  refreshAuthoritative = async () => {
    const actor = this.state.actor;
    const canRebase = this.state.status === 'stale'
      || (this.state.status === 'error' && this.state.readIntent === 'rebase');
    const existing = this.state.profile;
    const baseline = existing ?? this.restoredBaseline;
    // Null-profile recovery needs the retained baseline; never require a loaded profile alone.
    if (!actor || this.state.command || !canRebase || this.isPeerBusy() || !baseline) return;
    const serial = ++this.serial;
    this.show({ status: 'loading', notice: null, noticeOwner: null });
    try {
      const [profile, cities] = await Promise.all([this.port.read(), this.port.cities()]);
      if (!this.current(actor) || serial !== this.serial) return;
      this.show({ cities });
      if (existing) {
        const applied = this.rebaseFromAuthoritative(profile);
        if (!this.current(actor) || serial !== this.serial) return;
        if (!applied) {
          this.show({
            status: 'stale',
            notice: 'Профиль изменился. Загрузите актуальный профиль и проверьте его перед новым редактированием. Прежние изменения не будут отправлены автоматически.',
            noticeOwner: 'profile',
          });
          return;
        }
        // Adopted profile is the new dirty baseline for any later idle load.
        this.restoredBaseline = this.state.profile;
        const adopted = this.state.profile!;
        this.show({
          status: 'ready',
          readIntent: null,
          notice: adopted.displayName.trim() && adopted.cityId
            ? null
            : 'Укажите публичное имя и выберите город. Имя аккаунта не подставляется.',
          noticeOwner: adopted.displayName.trim() && adopted.cityId ? null : 'profile',
        });
        return;
      }
      // profile=null same-actor path: merge against restored baseline, then keep adopted for load().
      const draft = mergeDirtyDraft(this.state.draft, baseline, profile);
      this.restoredBaseline = profile;
      this.show({
        profile,
        draft,
        status: 'ready',
        readIntent: null,
        notice: profile.displayName.trim() && profile.cityId
          ? null
          : 'Укажите публичное имя и выберите город. Имя аккаунта не подставляется.',
        noticeOwner: profile.displayName.trim() && profile.cityId ? null : 'profile',
      });
    } catch {
      // Retain rebase intent + restoredBaseline; never clear original UNKNOWN by assumption.
      if (this.current(actor) && serial === this.serial) {
        this.show({ status: 'error', notice: 'Не удалось проверить профиль и каталог городов. Повторите загрузку.', noticeOwner: 'profile' });
      }
    }
  };
  /**
   * Exact idle/error retry wired by OwnProfileCard and ProfileEditor.
   * Routes by typed readIntent (rebase vs ordinary load); never notice-text matching.
   */
  retryRead = async () => {
    if (this.state.readIntent === 'rebase') return this.refreshAuthoritative();
    return this.load();
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
      notice: null, noticeOwner: null,
    });
  };
  cancel = () => {
    if (this.state.command || this.state.status !== 'ready' || !this.state.profile || this.isPeerBusy()) return;
    this.restoredBaseline = null;
    this.show({ draft: form(this.state.profile), notice: 'Изменения отменены.', noticeOwner: 'profile' });
  };
  save = async () => {
    const { actor, profile, draft, cities, status, command } = this.state;
    if (!actor || !profile || command || status !== 'ready' || this.isPeerBusy()) return;
    const displayName = draft.displayName.trim();
    const city = cities.find(c => c.id === draft.cityId);
    if (!displayName || displayName.length > 80 || !city) {
      this.show({ notice: 'Введите имя от 1 до 80 символов и выберите город из каталога.', noticeOwner: 'profile' }); return;
    }
    const areaKey = draft.areaKey.trim() || null;
    if (areaKey !== null && areaKey.length > 64) {
      this.show({ notice: 'Район / метро — до 64 символов.', noticeOwner: 'profile' }); return;
    }
    const bio = draft.bio.trim() || null;
    if (bio !== null && bio.length > 500) {
      this.show({ notice: 'О себе — до 500 символов.', noticeOwner: 'profile' }); return;
    }
    const level = copyFrozenLevel(resolveProfileLevelForSave(draft.levelChoice, profile.level));
    const packet = Object.freeze({ kind: 'profile' as const, actor: Object.freeze({ ...actor }), key: this.random(), cityName: city.nameRu,
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
  /**
   * Explicit personal-message permission only. Requires authoritative version≥1.
   * Never auto-runs on mount/login; preserves dirty name/level/area/bio draft on receipt.
   */
  setContactPolicy = async (desired: 'requests' | 'closed') => {
    const { actor, profile, status, command } = this.state;
    if (!actor || !profile || command || status !== 'ready' || this.isPeerBusy()) return;
    if (profile.version < 1) {
      this.show({ notice: 'Сначала сохраните игровой профиль.', noticeOwner: 'contactPolicy' });
      return;
    }
    if (profile.contactPolicy === desired) return;
    const packet = Object.freeze({
      kind: 'contactPolicy' as const,
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      body: Object.freeze({ expectedVersion: profile.version, contactPolicy: desired }),
    });
    await this.dispatch(packet, actor);
  };
  /**
   * Explicit «Ищу игру» enable/update. Own profile city required; TTL must be 60 or 180.
   * Never auto-runs on mount/login/foreground/expiry; preserves dirty profile draft.
   */
  enableLooking = async (areaKeyRaw: string, ttlMinutes: LookingTtlMinutes) => {
    const { actor, profile, status, command } = this.state;
    if (!actor || !profile || command || status !== 'ready' || this.isPeerBusy()) return;
    if (!profile.cityId) {
      this.show({ notice: 'Сначала укажите город в игровом профиле.', noticeOwner: 'looking' });
      return;
    }
    if (!isLookingTtlMinutes(ttlMinutes)) {
      this.show({ notice: 'Выберите 1 час или 3 часа.', noticeOwner: 'looking' });
      return;
    }
    const areaKey = areaKeyRaw.trim() || null;
    if (areaKey !== null && areaKey.length > 64) {
      this.show({ notice: 'Район / метро — до 64 символов.', noticeOwner: 'looking' });
      return;
    }
    const body: LookingPutBody = Object.freeze({
      cityId: profile.cityId,
      areaKey,
      ttlMinutes,
      ...(profile.lookingForGame ? { expectedVersion: profile.lookingForGame.version } : {}),
    });
    const packet = Object.freeze({
      kind: 'lookingPut' as const,
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      body,
    });
    await this.dispatch(packet, actor);
  };
  /** Explicit stop — empty DELETE body, no invented CAS; inactive version 0 is valid. */
  stopLooking = async () => {
    const { actor, profile, status, command } = this.state;
    if (!actor || !profile || command || status !== 'ready' || this.isPeerBusy()) return;
    const packet = Object.freeze({
      kind: 'lookingDelete' as const,
      actor: Object.freeze({ ...actor }),
      key: this.random(),
    });
    await this.dispatch(packet, actor);
  };
  /**
   * Explicit catalog visibility only. Requires authoritative version≥1.
   * Never auto-runs on mount/login/reauth/foreground/refresh; city is not a gate;
   * consent is forwarded only when ON and already stored — never fabricated.
   */
  setDirectoryVisible = async (desired: boolean) => {
    const { actor, profile, status, command } = this.state;
    if (!actor || !profile || command || status !== 'ready' || this.isPeerBusy()) return;
    if (profile.version < 1) {
      this.show({ notice: 'Сначала сохраните игровой профиль.', noticeOwner: 'visibility' });
      return;
    }
    if (profile.directoryVisible === desired) return;
    const body: VisibilityBody = Object.freeze({
      directoryVisible: desired,
      expectedVersion: profile.version,
      ...(desired && profile.consentPolicyVersion
        ? { consentPolicyVersion: profile.consentPolicyVersion }
        : {}),
    });
    const packet = Object.freeze({
      kind: 'visibility' as const,
      actor: Object.freeze({ ...actor }),
      key: this.random(),
      body,
    });
    await this.dispatch(packet, actor);
  };
  reconcile = async () => {
    const { actor, command } = this.state;
    if (actor && command?.status === 'unknown' && command.packet.actor.actorId === actor.actorId) await this.dispatch(command.packet, actor);
  };
  private lookingNotice(packet: LookingPacket, phase: 'unknown' | 'fail' | 'ok', looking?: Looking | null): string {
    if (phase === 'ok') {
      // Success copy follows the fresh adopted Looking only — never the historical packet.kind.
      // A verified DELETE ACK may still yield to a newer active GET (external enable); claim that state.
      if (!looking || looking.state === 'inactive') {
        return '«Ищу игру» выключено.';
      }
      // Historical PUT replay may return the original active ACK after TTL end — never claim «включено».
      if (lookingIntentExpired(looking)) return 'Срок «Ищу игру» истёк.';
      return '«Ищу игру» включено.';
    }
    if (phase === 'fail') {
      return 'Статус «Ищу игру» не сохранён. Проверьте соединение или повторите.';
    }
    return packet.kind === 'lookingDelete'
      ? 'Результат выключения «Ищу игру» неизвестен. Проверка повторит только эту отправку с прежним ключом. Новые изменения пока недоступны.'
      : 'Результат статуса «Ищу игру» неизвестен. Проверка повторит только эту отправку с прежними данными и ключом. Новые изменения пока недоступны.';
  }
  /** Validate Looking ACK against the original packet only — never against a later nested read. */
  private assertLookingAck(looking: Looking, packet: LookingPacket): void {
    if (packet.kind === 'lookingPut') {
      if (looking.state !== 'active') throw new ProfileError('invalid');
      if (looking.cityId !== packet.body.cityId) throw new ProfileError('invalid');
      if ((looking.areaKey ?? null) !== (packet.body.areaKey ?? null)) throw new ProfileError('invalid');
      if (packet.body.expectedVersion !== undefined && looking.version <= packet.body.expectedVersion) throw new ProfileError('invalid');
      if (packet.body.expectedVersion === undefined && looking.version < 1) throw new ProfileError('invalid');
      return;
    }
    if (looking.state !== 'inactive') throw new ProfileError('invalid');
  }
  /** Validate visibility ACK against the original packet only — never against a later nested read. */
  private assertVisibilityAck(profile: OwnProfile, packet: VisibilityPacket): void {
    const { body } = packet;
    if (profile.version <= body.expectedVersion || profile.directoryVisible !== body.directoryVisible) {
      throw new ProfileError('invalid');
    }
  }
  /**
   * After a verified original visibility ACK, prefer the fresh own-profile state.
   * Nested must not regress below ACK or the known current own-profile version.
   * Older historical ACK alone must not deadlock when fresh current read validates.
   */
  private resolveVisibilityAfterAck(ack: OwnProfile, nested: OwnProfile, existing: OwnProfile | null): OwnProfile {
    if (nested.version < ack.version) throw new ProfileError('invalid');
    if (existing && nested.version < existing.version) throw new ProfileError('invalid');
    return nested;
  }
  private visibilityNotice(adopted: OwnProfile): string {
    return adopted.directoryVisible
      ? 'Профиль видим в каталоге.'
      : 'Профиль скрыт из каталога.';
  }
  /** Canonical Looking fields excluding version/state — city/area/dates/formats/expiresAt. */
  private lookingCanonicalFieldsEqual(a: Looking, b: Looking): boolean {
    return a.cityId === b.cityId
      && a.areaKey === b.areaKey
      && a.startsAt === b.startsAt
      && a.endsAt === b.endsAt
      && a.expiresAt === b.expiresAt
      && a.formatKeys.length === b.formatKeys.length
      && a.formatKeys.every((key, index) => key === b.formatKeys[index]);
  }
  /** Full canonical Looking equality — version excluded; state included. */
  private lookingCanonicalEqual(a: Looking, b: Looking): boolean {
    return a.state === b.state && this.lookingCanonicalFieldsEqual(a, b);
  }
  /**
   * Real server expires-on-read may flip active→inactive at the same version without a bump
   * (identical other canonical fields + valid expiresAt). Never inactive→active or field
   * mutations at equal version. Fresh GET is authoritative: do not require the device clock
   * to agree that expiresAt is already past (skew can leave a still-future local projection).
   * Never invent a write/TTL or new protocol to paper over skew.
   */
  private lookingServerExpiryProjection(prior: Looking, nested: Looking): boolean {
    if (prior.state !== 'active' || nested.state !== 'inactive') return false;
    if (!this.lookingCanonicalFieldsEqual(prior, nested)) return false;
    if (!nested.expiresAt) return false;
    const expires = Date.parse(nested.expiresAt);
    return !Number.isNaN(expires);
  }
  private lookingEqualVersionAllowed(prior: Looking, nested: Looking): boolean {
    return this.lookingCanonicalEqual(nested, prior)
      || this.lookingServerExpiryProjection(prior, nested);
  }
  /**
   * After a verified original ACK, prefer the fresh own-profile Looking state.
   * Nested must not regress below ACK or the known current Looking version.
   * Same-version active→inactive is legitimate only as server expiry projection;
   * other equal-version divergences still require a version bump.
   * Canonical no-record STOP: inactive version 0 ACK + nested null → confirmed off.
   */
  private resolveLookingAfterAck(ack: Looking, nested: Looking | null, packet: LookingPacket): Looking | null {
    if (nested === null) {
      if (packet.kind === 'lookingDelete' && ack.state === 'inactive' && ack.version === 0) return null;
      throw new ProfileError('invalid');
    }
    if (nested.version < ack.version) throw new ProfileError('invalid');
    if (nested.version === ack.version && !this.lookingEqualVersionAllowed(ack, nested)) {
      throw new ProfileError('invalid');
    }
    const current = this.state.profile?.lookingForGame ?? null;
    if (current) {
      if (nested.version < current.version) throw new ProfileError('invalid');
      if (nested.version === current.version && !this.lookingEqualVersionAllowed(current, nested)) {
        throw new ProfileError('invalid');
      }
    }
    return nested;
  }
  private async dispatch(packet: ProfilePacket, authority: Actor) {
    // Synchronous guard precedes the first await; each call owns a frozen original packet.
    this.serial++; this.show({ command: { packet, status: 'sending' }, notice: null, noticeOwner: null });
    const valid = () => this.current(authority) && this.state.command?.packet === packet && this.state.command.status === 'sending';
    // Visibility write ACK validated → recovery reads are not mutation rejection (Looking/trainer lesson).
    let visibilityWriteAcked = false;
    try {
      if (packet.kind === 'lookingPut' || packet.kind === 'lookingDelete') {
        if (!this.port.looking) throw new ProfileError('network');
        const ack = await this.port.looking(packet, authority);
        if (!valid()) return;
        // Confirm the original receipt against the immutable packet; then let a fresh own-profile
        // Looking win without resending a new desired action. Never invent SocialProfile fields,
        // never apply historical ACK over newer nested state, never mint a new key.
        this.assertLookingAck(ack, packet);
        const fresh = await this.port.read();
        if (!valid()) return;
        const adopted = this.resolveLookingAfterAck(ack, fresh.lookingForGame, packet);
        const existing = this.state.profile;
        if (!existing) {
          const profile = { ...fresh, lookingForGame: adopted };
          this.show({
            profile,
            draft: form(profile),
            command: undefined,
            status: this.state.cities.length ? 'ready' : 'idle',
            readIntent: null,
            notice: this.lookingNotice(packet, 'ok', adopted),
            noticeOwner: 'looking',
          });
          return;
        }
        // Looking field only — retain SP version and unsaved profile drafts.
        this.show({
          profile: { ...existing, lookingForGame: adopted },
          command: undefined,
          status: 'ready',
          readIntent: null,
          notice: this.lookingNotice(packet, 'ok', adopted),
          noticeOwner: 'looking',
        });
        if (!this.state.cities.length) this.show({ status: 'idle' });
        return;
      }
      if (packet.kind === 'visibility') {
        if (!this.port.visibility) throw new ProfileError('network');
        const ack = await this.port.visibility(packet, authority);
        if (!valid()) return;
        // Original packet ACK is historical only — current own-profile GET wins before unlock.
        this.assertVisibilityAck(ack, packet);
        visibilityWriteAcked = true;
        const fresh = await this.port.read();
        if (!valid()) return;
        const existing = this.state.profile;
        const adopted = this.resolveVisibilityAfterAck(ack, fresh, existing);
        if (!existing) {
          // Same-account reauth: profile was cleared but dirty draft + baseline may be restored.
          const baseline = this.restoredBaseline;
          const draft = baseline
            ? mergeDirtyDraft(this.state.draft, baseline, adopted)
            : this.state.draft;
          // Keep adopted as baseline so a later idle load()/editor remount preserves dirty fields.
          this.restoredBaseline = adopted;
          this.show({
            profile: adopted,
            draft,
            command: undefined,
            status: this.state.cities.length ? 'ready' : 'idle',
            readIntent: null,
            notice: this.visibilityNotice(adopted),
            noticeOwner: 'visibility',
          });
          return;
        }
        // Rebase pristine fields to current GET; preserve each locally dirty draft field.
        const draft = mergeDirtyDraft(this.state.draft, existing, adopted);
        this.restoredBaseline = adopted;
        this.show({
          profile: adopted,
          draft,
          command: undefined,
          status: 'ready',
          readIntent: null,
          notice: this.visibilityNotice(adopted),
          noticeOwner: 'visibility',
        });
        if (!this.state.cities.length) this.show({ status: 'idle' });
        return;
      }
      const profile = await this.port.send(packet, authority);
      if (!valid()) return;
      if (packet.kind === 'contactPolicy') {
        const { body } = packet;
        if (profile.version <= body.expectedVersion || profile.contactPolicy !== body.contactPolicy) throw new ProfileError('invalid');
        // Authoritative policy/version only — never wipe unsaved name/level/area/bio draft.
        this.show({
          profile,
          command: undefined,
          status: 'ready',
          readIntent: null,
          notice: profile.contactPolicy === 'requests'
            ? 'Личные сообщения разрешены.'
            : 'Личные сообщения выключены. Новые входящие не принимаются; история переписок сохраняется.',
          noticeOwner: 'contactPolicy',
        });
        if (!this.state.cities.length) this.show({ status: 'idle' });
        return;
      }
      const { body } = packet;
      if (profile.version <= body.expectedVersion || profile.displayName !== body.displayName || profile.cityId !== body.cityId
          || profile.areaKey !== body.areaKey || profile.bio !== body.bio || !sameStoredLevel(profile.level, body.level)) throw new ProfileError('invalid');
      this.restoredBaseline = null;
      this.show({ profile, draft: form(profile), command: undefined, status: 'ready', readIntent: null, notice: 'Профиль сохранён.', noticeOwner: 'profile' });
      // A restored UNKNOWN has no catalog yet. Read only on the next explicit editor load.
      if (!this.state.cities.length) this.show({ status: 'idle' });
    } catch (error) {
      if (!valid()) return;
      // Rejected visibility write only — post-ACK current-read failures (incl. business 429/403) stay locked UNKNOWN.
      if (!visibilityWriteAcked
        && error instanceof ProfileError
        && error.kind === 'business'
        && error.status < 500
        && error.code !== 'COMMAND_IN_PROGRESS') {
        // profile=null after same-actor restore: keep restoredBaseline; expose reachable recovery.
        const nullProfile = !this.state.profile;
        if (packet.kind === 'visibility' && error.code === 'CONSENT_POLICY_VERSION_INVALID') {
          this.show({
            command: undefined,
            status: 'stale',
            readIntent: 'rebase',
            noticeOwner: 'visibility',
            notice: 'Не удалось включить видимость. Обновите данные профиля',
          });
          return;
        }
        const stale = error.status === 409;
        // Other definitive visibility 4xx with no profile → error so retry/load is reachable
        // (ready+null hid all controls). Profile present keeps ready for an in-place retry.
        const status = stale ? 'stale'
          : (packet.kind === 'visibility' && nullProfile ? 'error' : 'ready');
        const readIntent = stale ? 'rebase' as const
          : (packet.kind === 'visibility' && nullProfile ? null : this.state.readIntent);
        this.show({
          command: undefined,
          status,
          readIntent,
          noticeOwner: stale
            ? (packet.kind === 'visibility' ? 'visibility' : 'profile')
            : noticeOwnerOf(packet),
          notice: stale
            ? (packet.kind === 'visibility'
              ? 'Профиль изменился. Обновите данные, чтобы проверить видимость.'
              : 'Профиль изменился. Загрузите актуальный профиль и проверьте его перед новым редактированием. Прежние изменения не будут отправлены автоматически.')
            : packet.kind === 'contactPolicy' ? 'Настройка личных сообщений не сохранена. Проверьте соединение или повторите.'
            : packet.kind === 'lookingPut' || packet.kind === 'lookingDelete' ? this.lookingNotice(packet, 'fail')
            : packet.kind === 'visibility' ? 'Изменение видимости не сохранено. Проверьте соединение или повторите.'
            : moderationCodes.includes(error.code) ? 'Изменения не сохранены. Проверьте публичный текст или повторите позже. Введённые данные сохранены в форме.'
            : 'Изменения не сохранены. Проверьте поля и повторите.',
        });
      } else this.show({ command: { packet, status: 'unknown' }, noticeOwner: noticeOwnerOf(packet), notice: packet.kind === 'contactPolicy'
        ? 'Результат настройки личных сообщений неизвестен. Проверка повторит только эту отправку с прежним значением и ключом. Новые изменения пока недоступны.'
        : packet.kind === 'lookingPut' || packet.kind === 'lookingDelete' ? this.lookingNotice(packet, 'unknown')
        : packet.kind === 'visibility'
        ? 'Пока не удалось подтвердить изменение видимости. Проверка повторит только эту отправку с прежним значением и ключом. Новые изменения пока недоступны.'
        : 'Результат сохранения неизвестен. Проверка повторит только это сохранение с прежними данными и ключом. Новое сохранение пока недоступно.' });
    }
  }
}
