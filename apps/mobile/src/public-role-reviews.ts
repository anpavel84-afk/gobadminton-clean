import type { RoleKind } from './role-reputation.ts';
import { ROLE_TOPIC_LABEL } from './role-reputation.ts';

export type { RoleKind };
export { ROLE_TOPIC_LABEL };

export const PUBLIC_ROLE_TEXT_MAX = 500;
export const PUBLIC_ROLE_OWN_LIST_MAX = 50;
export const ORGANIZATION_TOPIC_OPTIONS = [
  { value: 'agreements', label: 'Договорённости' },
  { value: 'flow', label: 'Ход встречи' },
  { value: 'communication', label: 'Общение' },
] as const;
export const TRAINING_TOPIC_OPTIONS = [
  { value: 'explanations', label: 'Объяснения' },
  { value: 'attention', label: 'Внимание' },
  { value: 'session_organization', label: 'Организация занятия' },
] as const;

const HANDLE = /^[0-9a-f]{32}$/i;
const CONSENT_HASH = /^[0-9a-f]{64}$/i;
const ORG_TOPICS = new Set(ORGANIZATION_TOPIC_OPTIONS.map(t => t.value));
const TRAIN_TOPICS = new Set(TRAINING_TOPIC_OPTIONS.map(t => t.value));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PublicRoleError extends Error {
  readonly kind: 'invalid' | 'network' | 'business' | 'private' | 'auth';
  readonly status: number;
  readonly code: string;
  constructor(kind: PublicRoleError['kind'], status = 0, code = '') {
    super(kind);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export type PublicAudience = 'personal' | 'public';
export type OwnEligibilityBasis = {
  gameId: string;
  /** Nested basis role — must match parent OwnEligibility.role (API OwnEligibilityBasisDto). */
  role: RoleKind;
  endsAt: string;
  proofVersion: number;
  outcomeVersion: number;
  attendanceVersion: number;
  projectionHashPreview: string | null;
  admission: 'may_submit' | 'deny' | 'hold';
  reason: string | null;
};
export type OwnEligibility = {
  roleHandle: string;
  role: RoleKind;
  bases: OwnEligibilityBasis[];
};
export type OwnPublicRoleReview = {
  id: string;
  reviewHandle: string;
  role: RoleKind;
  roleHandle: string;
  subjectDisplayName: string | null;
  status: string;
  version: number;
  text: string | null;
  topics: string[];
  receiptToken: string | null;
  pendingIntakeStatus: 'waiting_intake' | 'linked' | 'none';
  approvedRevision: number | null;
  pendingRevision: number | null;
};
export type OwnPublicRoleReviewsPage = { items: OwnPublicRoleReview[] };
export type PublicRoleMutationReceipt = {
  id: string;
  reviewHandle: string;
  version: number;
  status: string;
  receiptToken: string;
  pendingIntakeStatus: 'waiting_intake' | 'linked';
};
export type ConsentPreview = { consentProjectionHash: string };
export type PublicRoleAuthorTarget = {
  roleHandle: string;
  role: RoleKind;
  gameId: string;
  subjectDisplayName?: string | null;
};
export type PublicRoleDraft = {
  audience: PublicAudience;
  text: string;
  topics: string[];
  gameId: string;
  consent: boolean;
  /** Explicit intentional empty / dirty create text across non-authoritative refresh. */
  textDirty?: boolean;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicRoleError('invalid');
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== 'string') throw new PublicRoleError('invalid');
  return value;
}
function num(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 2147483647) {
    throw new PublicRoleError('invalid');
  }
  return value;
}
function nullable<T>(value: unknown, parse: (v: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function choice<T extends string>(value: unknown, values: readonly T[]): T {
  for (const item of values) if (value === item) return item;
  throw new PublicRoleError('invalid');
}
function roleHandle(value: unknown): string {
  const raw = str(value);
  if (!HANDLE.test(raw)) throw new PublicRoleError('invalid');
  return raw.toLowerCase();
}
function roleKind(value: unknown): RoleKind {
  return choice(value, ['organization', 'training'] as const);
}
function uuid(value: unknown): string {
  const raw = str(value);
  if (!UUID.test(raw)) throw new PublicRoleError('invalid');
  return raw.toLowerCase();
}
function time(value: unknown): string {
  const raw = str(value);
  if (!Number.isFinite(Date.parse(raw))) throw new PublicRoleError('invalid');
  return raw;
}

/** Public DTO text: CRLF→LF, LF allowed, other controls rejected, trim, 1..500. */
export function normalizePublicRoleText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}
export function publicRoleReviewText(value: string): string {
  const normalized = normalizePublicRoleText(value);
  if (normalized.length < 1 || normalized.length > PUBLIC_ROLE_TEXT_MAX) throw new PublicRoleError('invalid');
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) throw new PublicRoleError('invalid');
  }
  return normalized;
}
export function publicRoleTopics(role: RoleKind, topics: readonly string[]): string[] {
  if (topics.length > 2) throw new PublicRoleError('invalid');
  const allowed = role === 'organization' ? ORG_TOPICS : TRAIN_TOPICS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of topics) {
    if (!allowed.has(topic as never) || seen.has(topic)) throw new PublicRoleError('invalid');
    seen.add(topic);
    out.push(topic);
  }
  return out;
}
export function topicOptionsForRole(role: RoleKind) {
  return role === 'organization' ? ORGANIZATION_TOPIC_OPTIONS : TRAINING_TOPIC_OPTIONS;
}

export function publicRoleStatusLabel(
  status: string,
  pending: OwnPublicRoleReview['pendingIntakeStatus'] | PublicRoleMutationReceipt['pendingIntakeStatus'] | null,
): string {
  // Terminal status wins over leftover intake fields on withdraw receipts.
  if (status === 'withdrawn') return 'Отозван';
  if (status === 'removed') return 'Снят';
  if (pending === 'waiting_intake') return 'Ожидает разбора';
  switch (status) {
    case 'published':
      return 'Опубликован';
    case 'submitted':
    case 'revision_waiting':
      return 'Ожидает разбора';
    case 'needs_correction':
      return 'Нужна правка';
    case 'held_basis':
      return 'Основание на проверке';
    default:
      return 'Статус обновлён. Обновите список отзывов.';
  }
}
/** Actionable Russian notice — never surface raw server CODE to the author. */
export function publicRoleBusinessNotice(code: string | undefined, kind: 'create' | 'preview' | 'command' = 'create'): string {
  switch (code) {
    case 'VERSION_CONFLICT':
    case 'BASIS_VERSION_CONFLICT':
      return kind === 'command'
        ? 'Версия отзыва изменилась. Обновите список и повторите действие.'
        : 'Основание устарело. Обновите допуск, заново подтвердите согласие и отправьте.';
    case 'ROLE_CONSENT_MISMATCH':
      return 'Текст или темы изменились. Заново подтвердите согласие с текущей версией.';
    case 'ROLE_REPUTATION_SELF':
      return 'Нельзя оставить публичный отзыв о своей роли.';
    case 'POST_GAME_WRITES_UNAVAILABLE':
      return 'Запись публичных отзывов сейчас недоступна. Попробуйте позже.';
    default:
      return kind === 'preview'
        ? 'Не удалось подготовить согласие. Обновите допуск и повторите.'
        : kind === 'command'
          ? 'Не удалось выполнить действие. Обновите список отзывов.'
          : 'Не удалось отправить. Обновите допуск и согласие.';
  }
}
export function publicRoleLabel(role: RoleKind): string {
  return role === 'training' ? 'Как о тренере' : 'Как об организаторе';
}
export function mayWithdrawOwnPublic(item: OwnPublicRoleReview): boolean {
  return item.status !== 'withdrawn' && item.status !== 'removed';
}
/** Withdraw/removed terminal projection — never resurrect private author text from stale GET/receipt. */
export function retireOwnPublicReviewText(item: OwnPublicRoleReview): OwnPublicRoleReview {
  if (item.status !== 'withdrawn' && item.status !== 'removed') return item;
  return {
    ...item,
    text: null,
    pendingIntakeStatus: item.pendingIntakeStatus === 'waiting_intake' ? 'none' : item.pendingIntakeStatus,
  };
}
/**
 * Monotonic own-list merge: version/status terminal fence wins across GET/ACK order.
 * Returns null when incoming is stale vs floor or would resurrect a terminal row.
 */
export function mergeOwnPublicReviewItem(
  prior: OwnPublicRoleReview | undefined,
  incoming: OwnPublicRoleReview,
  floor: number,
): OwnPublicRoleReview | null {
  if (incoming.version < floor) return null;
  if (prior && incoming.version < prior.version) return null;
  const priorTerminal = prior && (prior.status === 'withdrawn' || prior.status === 'removed');
  if (priorTerminal && prior) {
    if (incoming.version < prior.version) return null;
    if (incoming.version === prior.version && incoming.status !== 'withdrawn' && incoming.status !== 'removed') {
      return null;
    }
  }
  return retireOwnPublicReviewText(incoming);
}
/**
 * Settle a mutation ACK onto an own-list row without replacing a newer typed projection.
 * Receipt raises authority only when version/status survive the same monotonic floor rules as GET.
 */
export function applyOwnPublicAckToItem(
  prior: OwnPublicRoleReview,
  receipt: PublicRoleMutationReceipt,
  floor: number,
): OwnPublicRoleReview {
  if (receipt.status === 'withdrawn' || receipt.status === 'removed') {
    const incoming: OwnPublicRoleReview = {
      ...prior,
      status: receipt.status,
      version: receipt.version,
      text: null,
      receiptToken: receipt.receiptToken,
      pendingIntakeStatus: receipt.pendingIntakeStatus === 'waiting_intake'
        ? 'none'
        : prior.pendingIntakeStatus,
    };
    return mergeOwnPublicReviewItem(prior, incoming, floor) ?? prior;
  }
  if (receipt.version < prior.version || receipt.version < floor) return prior;
  return { ...prior, version: Math.max(prior.version, receipt.version) };
}

/** Minimal focusable opener identity for sheet return-focus (Pressable-compatible). */
export type PublicRoleFocusHandle = { focus: () => void };

let publicRoleFocusTarget: PublicRoleFocusHandle | null = null;

export function rememberPublicRoleFocusTarget(target: PublicRoleFocusHandle | null) {
  publicRoleFocusTarget = target;
}
export function clearPublicRoleFocusTarget(target: PublicRoleFocusHandle | null) {
  if (target && publicRoleFocusTarget === target) publicRoleFocusTarget = null;
}
export function currentPublicRoleFocusTarget(): PublicRoleFocusHandle | null {
  return publicRoleFocusTarget;
}
/**
 * Callback-ref attach/detach for author/history openers.
 * Retains instance across React nulling so unmount clears the remembered target by identity.
 * Callers must reuse one held ref + one stable callback (no per-render recreate).
 */
export function bindPublicRoleFocusRef(
  held: { current: PublicRoleFocusHandle | null },
  node: PublicRoleFocusHandle | null,
): void {
  if (node) {
    held.current = node;
    return;
  }
  clearPublicRoleFocusTarget(held.current);
  held.current = null;
}

/** Empty historical roleHandle is not authoring authority or a guessed recipient. */
export function usableOwnRoleHandle(roleHandleValue: string): boolean {
  return HANDLE.test(roleHandleValue) && roleHandleValue.length === 32;
}

function parseBasis(value: unknown, expectedRole: RoleKind): OwnEligibilityBasis {
  const row = object(value);
  const role = roleKind(row.role);
  // Reject missing/invalid/mismatched nested role — parent card role is authoritative.
  if (role !== expectedRole) throw new PublicRoleError('invalid');
  return {
    gameId: uuid(row.gameId),
    role,
    endsAt: time(row.endsAt),
    proofVersion: num(row.proofVersion, 1),
    outcomeVersion: num(row.outcomeVersion),
    attendanceVersion: num(row.attendanceVersion),
    projectionHashPreview: nullable(row.projectionHashPreview, v => {
      const hash = str(v);
      if (!CONSENT_HASH.test(hash)) throw new PublicRoleError('invalid');
      return hash.toLowerCase();
    }),
    admission: choice(row.admission, ['may_submit', 'deny', 'hold'] as const),
    reason: nullable(row.reason, str),
  };
}

export function parseOwnEligibility(value: unknown, expectedHandle?: string): OwnEligibility {
  const row = object(value);
  const handle = roleHandle(row.roleHandle);
  if (expectedHandle && handle !== expectedHandle.toLowerCase()) throw new PublicRoleError('invalid');
  if (!Array.isArray(row.bases)) throw new PublicRoleError('invalid');
  const role = roleKind(row.role);
  return { roleHandle: handle, role, bases: row.bases.map(b => parseBasis(b, role)) };
}

export function parseOwnPublicRoleReview(value: unknown): OwnPublicRoleReview {
  const row = object(value);
  const handle = str(row.roleHandle);
  // Service may return empty-string when historical subject is missing — keep literal, do not invent authority.
  if (handle !== '' && !HANDLE.test(handle)) throw new PublicRoleError('invalid');
  if (!Array.isArray(row.topics)) throw new PublicRoleError('invalid');
  return {
    id: uuid(row.id),
    reviewHandle: roleHandle(row.reviewHandle),
    role: roleKind(row.role),
    roleHandle: handle === '' ? '' : handle.toLowerCase(),
    subjectDisplayName: nullable(row.subjectDisplayName, str),
    status: str(row.status),
    version: num(row.version, 1),
    text: nullable(row.text, str),
    topics: row.topics.map(str),
    receiptToken: nullable(row.receiptToken, str),
    pendingIntakeStatus: choice(row.pendingIntakeStatus, ['waiting_intake', 'linked', 'none'] as const),
    approvedRevision: nullable(row.approvedRevision, v => num(v, 1)),
    pendingRevision: nullable(row.pendingRevision, v => num(v, 1)),
  };
}

export function parseOwnPublicRoleReviewsPage(value: unknown): OwnPublicRoleReviewsPage {
  const row = object(value);
  if (!Array.isArray(row.items)) throw new PublicRoleError('invalid');
  if (row.items.length > PUBLIC_ROLE_OWN_LIST_MAX) throw new PublicRoleError('invalid');
  return { items: row.items.map(parseOwnPublicRoleReview) };
}

export function parsePublicRoleMutationReceipt(value: unknown): PublicRoleMutationReceipt {
  const row = object(value);
  return {
    id: uuid(row.id),
    reviewHandle: roleHandle(row.reviewHandle),
    version: num(row.version, 1),
    status: str(row.status),
    receiptToken: str(row.receiptToken),
    pendingIntakeStatus: choice(row.pendingIntakeStatus, ['waiting_intake', 'linked'] as const),
  };
}

export function parseConsentPreview(value: unknown): ConsentPreview {
  const row = object(value);
  const hash = str(row.consentProjectionHash);
  if (!CONSENT_HASH.test(hash)) throw new PublicRoleError('invalid');
  return { consentProjectionHash: hash.toLowerCase() };
}

export function eligibleBases(eligibility: OwnEligibility | null | undefined): OwnEligibilityBasis[] {
  return eligibility?.bases.filter(b => b.admission === 'may_submit') ?? [];
}

export function pickPreferredGameId(
  eligibility: OwnEligibility,
  preferredGameId?: string | null,
): string {
  const eligible = eligibleBases(eligibility);
  if (preferredGameId && eligible.some(b => b.gameId === preferredGameId)) return preferredGameId;
  return eligible[0]?.gameId ?? '';
}

/** Generation key for read/preview fences — actor/session/roleHandle/role/game/editor. */
export function publicReadGenerationKey(args: {
  actorId: string;
  sessionId: string;
  roleHandle: string;
  role: RoleKind;
  gameId: string;
  editor: string;
}): string {
  return `${args.actorId}:${args.sessionId}:${args.roleHandle}:${args.role}:${args.gameId}:${args.editor}`;
}

export function draftEditorKey(draft: PublicRoleDraft, roleHandle: string, role: RoleKind): string {
  return [
    roleHandle,
    role,
    draft.gameId,
    draft.audience,
    draft.text,
    draft.topics.join(','),
    draft.consent ? '1' : '0',
  ].join('|');
}

export type PublicCreateBody = {
  gameId: string;
  role: RoleKind;
  expectedBasisVersions: {
    proofVersion: number;
    outcomeVersion: number;
    attendanceVersion: number;
  };
  text: string;
  topics: string[];
  consentProjectionHash: string;
};

export type PublicCommandBody =
  | { action: 'withdraw'; expectedVersion: number }
  | {
      action: 'submit_revision' | 'resubmit';
      expectedVersion: number;
      gameId: string;
      expectedBasisVersions: {
        proofVersion: number;
        outcomeVersion: number;
        attendanceVersion: number;
      };
      text: string;
      topics: string[];
      consentProjectionHash: string;
    }
  | { action: 'appeal'; expectedVersion: number; explanation: string };

export function buildPublicCreateBody(args: {
  basis: OwnEligibilityBasis;
  role: RoleKind;
  text: string;
  topics: readonly string[];
  consentProjectionHash: string;
}): PublicCreateBody {
  const text = publicRoleReviewText(args.text);
  const topics = publicRoleTopics(args.role, args.topics);
  const hash = args.consentProjectionHash.toLowerCase();
  if (!CONSENT_HASH.test(hash)) throw new PublicRoleError('invalid');
  return {
    gameId: args.basis.gameId,
    role: args.role,
    expectedBasisVersions: {
      proofVersion: args.basis.proofVersion,
      outcomeVersion: args.basis.outcomeVersion,
      attendanceVersion: args.basis.attendanceVersion,
    },
    text,
    topics,
    consentProjectionHash: hash,
  };
}

export function buildPublicWithdrawBody(item: OwnPublicRoleReview): PublicCommandBody {
  if (!mayWithdrawOwnPublic(item)) throw new PublicRoleError('invalid');
  return { action: 'withdraw', expectedVersion: item.version };
}

export function consentPreviewBody(args: {
  role: RoleKind;
  subjectRoleHandle: string;
  text: string;
  topics: readonly string[];
}): { role: RoleKind; subjectRoleHandle: string; text: string; topics: string[] } {
  return {
    role: args.role,
    subjectRoleHandle: roleHandle(args.subjectRoleHandle),
    text: publicRoleReviewText(args.text),
    topics: publicRoleTopics(args.role, args.topics),
  };
}

/** Stable guest return uses existing game path only — role/game target lives on PostgameCoordinator. */
export function publicAuthorReturnPath(gameId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(gameId)) return null;
  try {
    const path = `/games/${encodeURIComponent(gameId)}`;
    return path;
  } catch {
    return null;
  }
}

export function isPublicRolePacketKind(
  kind: string,
): kind is 'public-role-create' | 'public-role-command' {
  return kind === 'public-role-create' || kind === 'public-role-command';
}

export function emptyPublicRoleDraft(preferredGameId = ''): PublicRoleDraft {
  return {
    audience: 'personal',
    text: '',
    topics: [],
    gameId: preferredGameId,
    consent: false,
    textDirty: false,
  };
}
