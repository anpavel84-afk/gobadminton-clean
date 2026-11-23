import { PublicApiError } from './public-api.ts';
import { isVenueId } from './venues.ts';

export type VenueReviewTopic = 'surface' | 'lighting' | 'amenities';
export type VenueAudience = 'self_draft' | 'public_venue';

export type PublicVenueReviewItem = {
  reviewHandle: string;
  authorLabel: 'Участник игры';
  text: string;
  topics: VenueReviewTopic[];
  publishedRevision: number;
  publishedAt: string;
};

export type VenueReviewsSummary = {
  venueId: string;
  publishedCount: number;
  items: PublicVenueReviewItem[];
  nextCursor: string | null;
  canWriteHint: boolean;
};

export type OwnVenueEligibilityBasis = {
  gameId: string;
  gameTitle: string | null;
  admission: 'may_submit' | 'hold' | 'deny' | 'missing_history';
  reason: string | null;
  outcomeVersion: number;
  attendanceVersion: number;
  firstEligibleAt: string | null;
  helpHint: 'attendance_unmarked' | 'attendance_clarifying' | 'missing_history' | null;
};

export type OwnVenueEligibility = { bases: OwnVenueEligibilityBasis[] };

export type VenueConsentPreview = {
  consentProjectionHash: string;
  authorLabel: 'Участник игры';
};

export type VenueReviewMutationReceipt = {
  id: string;
  version: number;
  status: string;
  reviewHandle: string;
  receiptToken: string | null;
  publicVisible: boolean;
  notBefore: string | null;
};

export type VenueExperienceCreateBody = {
  venueId: string;
  gameId: string;
  audience: VenueAudience;
  expectedBasisVersions: { outcomeVersion: number; attendanceVersion: number };
  text: string;
  topics: VenueReviewTopic[];
  consentProjectionHash?: string;
};

export type VenueExperienceDraft = {
  audience: VenueAudience;
  text: string;
  topics: VenueReviewTopic[];
  consent: boolean;
};

/** Client fence matching server idempotency completed/UNKNOWN TTL (journal-wide). */
export const VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Same 24h TTL for every Postgame journal packet (private / public / venue). */
export const POSTGAME_IDEMPOTENCY_TTL_MS = VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS;

/** Honest expired UNKNOWN recovery — result unknown; status on site; no GET-success claim. */
export const POSTGAME_RETENTION_EXPIRED_NOTICE =
  'Результат исходной отправки неизвестен. Безопасный повтор того же действия уже недоступен. Актуальный статус можно посмотреть на сайте.';

const TOPICS = new Set<string>(['surface', 'lighting', 'amenities']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE = /^[0-9a-f]{32}$/i;
const CONSENT_HASH = /^[0-9a-f]{64}$/i;
const ADMISSIONS = new Set(['may_submit', 'hold', 'deny', 'missing_history']);
const HELP = new Set(['attendance_unmarked', 'attendance_clarifying', 'missing_history']);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicApiError('invalid');
  return value as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function date(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}

function uuid(value: unknown): string {
  if (!text(value) || !UUID.test(value)) throw new PublicApiError('invalid');
  return value.toLowerCase();
}

function int(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 2147483647) {
    throw new PublicApiError('invalid');
  }
  return value;
}

function venueTopics(value: unknown): VenueReviewTopic[] {
  if (!Array.isArray(value) || value.length > 3) throw new PublicApiError('invalid');
  const out: VenueReviewTopic[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!text(item) || !TOPICS.has(item) || seen.has(item)) throw new PublicApiError('invalid');
    seen.add(item);
    out.push(item as VenueReviewTopic);
  }
  return out;
}

/** Closed parser for GET /v1/venues/{id}/experience-reviews — public read only. */
export function parseVenueReviewsSummary(value: unknown, venueId: string): VenueReviewsSummary {
  if (!isVenueId(venueId)) throw new PublicApiError('invalid');
  const row = object(value);
  if (!isVenueId(row.venueId) || row.venueId !== venueId) throw new PublicApiError('invalid');
  if (!Number.isInteger(row.publishedCount) || Number(row.publishedCount) < 0) throw new PublicApiError('invalid');
  if (!(row.nextCursor === null || text(row.nextCursor) && row.nextCursor.length > 0 && row.nextCursor.length <= 4096)) {
    throw new PublicApiError('invalid');
  }
  if (typeof row.canWriteHint !== 'boolean') throw new PublicApiError('invalid');
  if (!Array.isArray(row.items)) throw new PublicApiError('invalid');
  const items = row.items.map(item => {
    const entry = object(item);
    if (!text(entry.reviewHandle) || entry.reviewHandle.length !== 32) throw new PublicApiError('invalid');
    if (entry.authorLabel !== 'Участник игры') throw new PublicApiError('invalid');
    if (!text(entry.text) || entry.text.length < 1 || entry.text.length > 500) throw new PublicApiError('invalid');
    if (!Array.isArray(entry.topics) || entry.topics.length > 3 || entry.topics.some(t => !TOPICS.has(String(t)))) {
      throw new PublicApiError('invalid');
    }
    if (!Number.isInteger(entry.publishedRevision) || Number(entry.publishedRevision) < 1) throw new PublicApiError('invalid');
    if (!date(entry.publishedAt)) throw new PublicApiError('invalid');
    return {
      reviewHandle: entry.reviewHandle,
      authorLabel: 'Участник игры' as const,
      text: entry.text,
      topics: entry.topics as VenueReviewTopic[],
      publishedRevision: entry.publishedRevision as number,
      publishedAt: entry.publishedAt,
    };
  });
  return {
    venueId,
    publishedCount: row.publishedCount as number,
    items,
    nextCursor: row.nextCursor as string | null,
    canWriteHint: row.canWriteHint,
  };
}

/** Closed whitelist for GET /me/venue-reviews/eligibility — venue-specific; never role IDs. */
export function parseOwnVenueEligibility(value: unknown): OwnVenueEligibility {
  const row = object(value);
  if (!Array.isArray(row.bases)) throw new PublicApiError('invalid');
  const bases = row.bases.map(item => {
    const basis = object(item);
    const admission = text(basis.admission) && ADMISSIONS.has(basis.admission) ? basis.admission : null;
    if (!admission) throw new PublicApiError('invalid');
    if (!(basis.gameTitle === null || text(basis.gameTitle))) throw new PublicApiError('invalid');
    if (!(basis.reason === null || text(basis.reason))) throw new PublicApiError('invalid');
    if (!(basis.firstEligibleAt === null || date(basis.firstEligibleAt))) throw new PublicApiError('invalid');
    const help = basis.helpHint === null ? null
      : text(basis.helpHint) && HELP.has(basis.helpHint) ? basis.helpHint as OwnVenueEligibilityBasis['helpHint']
        : (() => { throw new PublicApiError('invalid'); })();
    return {
      gameId: uuid(basis.gameId),
      gameTitle: basis.gameTitle as string | null,
      admission: admission as OwnVenueEligibilityBasis['admission'],
      reason: basis.reason as string | null,
      outcomeVersion: int(basis.outcomeVersion),
      attendanceVersion: int(basis.attendanceVersion),
      firstEligibleAt: basis.firstEligibleAt as string | null,
      helpHint: help,
    };
  });
  return { bases };
}

/** Exact-game may_submit basis only — canWriteHint/roster/stars confer no rights. */
export function exactGameMaySubmitBasis(
  eligibility: OwnVenueEligibility | null | undefined,
  gameId: string,
): OwnVenueEligibilityBasis | null {
  if (!eligibility || !UUID.test(gameId)) return null;
  const wanted = gameId.toLowerCase();
  const basis = eligibility.bases.find(b => b.gameId === wanted);
  // Missing/invalid firstEligibleAt is unusable — do not invent rights from the clock alone.
  if (!basis || basis.admission !== 'may_submit') return null;
  if (!basis.firstEligibleAt || !Number.isFinite(Date.parse(basis.firstEligibleAt))) return null;
  return basis;
}

/**
 * Exact surface-game admitted authority fingerprint.
 * Public preview/consent must renew when identity/version/admission/anchor changes or disappears.
 */
export function venueExperienceBasisAuthority(
  eligibility: OwnVenueEligibility | null | undefined,
  gameId: string,
): string | null {
  if (!eligibility || !UUID.test(gameId)) return null;
  const wanted = gameId.toLowerCase();
  const basis = eligibility.bases.find(b => b.gameId === wanted);
  if (!basis) return null;
  return [
    basis.gameId,
    basis.admission,
    String(basis.outcomeVersion),
    String(basis.attendanceVersion),
    basis.firstEligibleAt ?? '',
    basis.reason ?? '',
    basis.helpHint ?? '',
  ].join('\u0001');
}

export function parseVenueConsentPreview(value: unknown): VenueConsentPreview {
  const row = object(value);
  if (!text(row.consentProjectionHash) || !CONSENT_HASH.test(row.consentProjectionHash)) {
    throw new PublicApiError('invalid');
  }
  if (row.authorLabel !== 'Участник игры') throw new PublicApiError('invalid');
  return {
    consentProjectionHash: row.consentProjectionHash.toLowerCase(),
    authorLabel: 'Участник игры',
  };
}

export function parseVenueReviewMutationReceipt(value: unknown): VenueReviewMutationReceipt {
  const row = object(value);
  const id = uuid(row.id);
  if (!text(row.reviewHandle) || !HANDLE.test(row.reviewHandle)) throw new PublicApiError('invalid');
  if (!text(row.status) || row.status.length < 1 || row.status.length > 64) throw new PublicApiError('invalid');
  if (typeof row.publicVisible !== 'boolean') throw new PublicApiError('invalid');
  // Blank/whitespace-only intake token is not a successful receipt (public or otherwise).
  if (!(row.receiptToken === null
    || text(row.receiptToken) && row.receiptToken.trim().length >= 1)) {
    throw new PublicApiError('invalid');
  }
  if (!(row.notBefore === null || date(row.notBefore))) throw new PublicApiError('invalid');
  return {
    id,
    version: int(row.version, 1),
    status: row.status,
    reviewHandle: row.reviewHandle.toLowerCase(),
    receiptToken: row.receiptToken as string | null,
    publicVisible: row.publicVisible,
    notBefore: row.notBefore as string | null,
  };
}

/** Private self_draft|revision_waiting with null token; public submitted_waiting|revision_waiting with intake token. */
export function isVenueExperienceCreateReceipt(
  receipt: VenueReviewMutationReceipt,
  audience: VenueAudience,
): boolean {
  if (receipt.publicVisible !== false || receipt.notBefore !== null) return false;
  if (audience === 'self_draft') {
    return (receipt.status === 'self_draft' || receipt.status === 'revision_waiting')
      && receipt.receiptToken === null;
  }
  const token = typeof receipt.receiptToken === 'string' ? receipt.receiptToken.trim() : '';
  return (receipt.status === 'submitted_waiting' || receipt.status === 'revision_waiting')
    && token.length > 0;
}

export function venueExperienceText(value: string): string {
  const s = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (s.length < 1 || s.length > 500) throw new PublicApiError('invalid');
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) throw new PublicApiError('invalid');
  }
  return s;
}

export function buildVenueExperienceCreateBody(args: {
  venueId: string;
  basis: OwnVenueEligibilityBasis;
  audience: VenueAudience;
  text: string;
  topics: VenueReviewTopic[];
  consentProjectionHash?: string;
}): VenueExperienceCreateBody {
  if (!isVenueId(args.venueId)) throw new PublicApiError('invalid');
  if (args.basis.admission !== 'may_submit') throw new PublicApiError('invalid');
  const text = venueExperienceText(args.text);
  const topics = venueTopics(args.topics);
  if (args.audience === 'public_venue') {
    const hash = args.consentProjectionHash?.toLowerCase();
    if (!hash || !CONSENT_HASH.test(hash)) throw new PublicApiError('invalid');
    return {
      venueId: args.venueId.toLowerCase(),
      gameId: args.basis.gameId,
      audience: 'public_venue',
      expectedBasisVersions: {
        outcomeVersion: args.basis.outcomeVersion,
        attendanceVersion: args.basis.attendanceVersion,
      },
      text,
      topics,
      consentProjectionHash: hash,
    };
  }
  if (args.consentProjectionHash !== undefined) throw new PublicApiError('invalid');
  return {
    venueId: args.venueId.toLowerCase(),
    gameId: args.basis.gameId,
    audience: 'self_draft',
    expectedBasisVersions: {
      outcomeVersion: args.basis.outcomeVersion,
      attendanceVersion: args.basis.attendanceVersion,
    },
    text,
    topics,
  };
}

export function emptyVenueExperienceDraft(): VenueExperienceDraft {
  return { audience: 'self_draft', text: '', topics: ['surface'], consent: false };
}

/**
 * Closed Russian copy for known eligibility reasons — never echo raw server codes in product UI.
 * Own-key Map only: unknown / prototype keys (__proto__, constructor, toString, …) stay neutral null.
 */
const VENUE_ELIGIBILITY_REASON_COPY = new Map<string, string>([
  ['venue_affiliation', 'Площадка связана с вашей организацией, поэтому отзыв недоступен.'],
  ['lifecycle', 'Площадка сейчас недоступна для отзыва.'],
  ['outcome_unknown', 'Исход игры ещё не подтверждён.'],
  ['outcome_dispute', 'По исходу игры идёт уточнение.'],
  ['window_closed', 'Срок подачи отзыва по этой игре истёк.'],
  ['wrong_venue', 'Отзыв относится к другой площадке этой игры.'],
  ['venue_attribution_unavailable', 'Не удалось подтвердить историческую площадку этой игры.'],
  ['attendance_unmarked', 'Посещение ещё не отмечено.'],
  ['attendance_unknown', 'Посещение ещё не отмечено.'],
  ['attendance_dispute', 'По посещению идёт уточнение.'],
]);

export function venueEligibilityReasonCopy(reason: string | null | undefined): string | null {
  if (!reason || typeof reason !== 'string') return null;
  return VENUE_ELIGIBILITY_REASON_COPY.get(reason) ?? null;
}

export function venueReviewEligibilityHelp(basis: OwnVenueEligibilityBasis | undefined | null): string | null {
  if (!basis) return 'Не удалось подтвердить возможность отзыва по этой игре.';
  if (basis.helpHint === 'attendance_unmarked') {
    return 'Посещение ещё не отмечено. Можно попросить уточнение в итогах игры — без самостоятельной отметки.';
  }
  if (basis.helpHint === 'attendance_clarifying') {
    return 'Уточняем посещение. Пока спор или отсутствие не закрыты, отзыв о площадке недоступен.';
  }
  if (basis.helpHint === 'missing_history' || basis.admission === 'missing_history') {
    return 'Не удалось подтвердить историческую площадку этой игры. Это ограничение данных, а не новое разрешение.';
  }
  if (basis.admission === 'deny' && basis.reason === 'window_closed') {
    return 'Срок подачи отзыва по этой игре истёк.';
  }
  if (basis.admission !== 'may_submit') {
    const reasonCopy = venueEligibilityReasonCopy(basis.reason);
    return reasonCopy
      ? `Сейчас нельзя оставить отзыв по этой игре. ${reasonCopy}`
      : 'Сейчас нельзя оставить отзыв по этой игре.';
  }
  return null;
}

export type VenueExperienceReceiptSummary = {
  primary: string;
  visibility: string;
};

/**
 * One verified audience/token receipt summary.
 * Private (incl. revision_waiting + null token): saved only for you; no moderation claim.
 * Public pending: awaiting review; older published may remain.
 */
export function venueExperienceReceiptSummary(
  receipt: VenueReviewMutationReceipt,
  audience: VenueAudience,
): VenueExperienceReceiptSummary {
  if (receipt.publicVisible) {
    return {
      primary: 'Публичная версия отзыва доступна на странице площадки.',
      visibility: 'Актуальный статус отзыва о площадке можно посмотреть на сайте.',
    };
  }
  const privateNullToken = audience === 'self_draft'
    || ((receipt.status === 'self_draft' || receipt.status === 'revision_waiting')
      && receipt.receiptToken === null);
  if (privateNullToken) {
    return {
      primary: 'Сохранено только вам. Эти изменения видите только вы.',
      visibility: 'Ранее опубликованная версия может оставаться видимой. Только вам — без публикации этой версии на странице площадки.',
    };
  }
  if (
    receipt.status === 'submitted_waiting'
    || receipt.status === 'submitted'
    || receipt.status === 'revision_waiting'
  ) {
    return {
      primary: receipt.status === 'revision_waiting'
        ? 'Новая публичная версия ожидает проверки. Пока она не опубликована.'
        : 'Новая публичная версия отправлена и ожидает проверки. Пока она не опубликована.',
      visibility: 'Эта новая версия ещё не опубликована. Более ранняя опубликованная версия может оставаться видимой.',
    };
  }
  return {
    primary: 'Отправка принята. Актуальный статус смотрите на сайте.',
    visibility: 'Актуальный статус отзыва о площадке можно посмотреть на сайте.',
  };
}

/** Immutable owner for one focused VenueExperienceEntry route lifetime. */
export type VenueExperienceRouteOwner = {
  gen: number;
  gameId: string;
  venueId: string;
  actorId: string;
  sessionId: string;
};

/**
 * Capture THIS route's owned surface when live actor+surface match the Entry game.
 * Blur/unmount cleanup must retire this capture — never rebuild expected from a later getSnapshot().
 */
export function captureVenueExperienceRouteOwner(args: {
  gameId: string;
  actor: { actorId: string; sessionId: string } | null | undefined;
  surface: { gen: number; gameId: string; venueId: string } | null | undefined;
}): VenueExperienceRouteOwner | null {
  const { gameId, actor, surface } = args;
  if (!actor || !surface || surface.gameId !== gameId) return null;
  return {
    gen: surface.gen,
    gameId: surface.gameId,
    venueId: surface.venueId,
    actorId: actor.actorId,
    sessionId: actor.sessionId,
  };
}

/**
 * While the route stays focused, remember the latest matching owner (open after focus / reopen).
 * A null next leaves the prior capture unchanged — ordinary close does not clear departure debt.
 */
export function noteVenueExperienceRouteOwner(
  prior: VenueExperienceRouteOwner | null,
  next: VenueExperienceRouteOwner | null,
): VenueExperienceRouteOwner | null {
  return next ?? prior;
}

/**
 * Production gate for VenueExperienceEntry eligibility GET.
 * Probe only when THIS route is focused, actor/session verified, live venue + ready results,
 * composer closed (open owns its load), and no original venue journal is pending.
 * Returns null for hidden/blurred, open-composer, pending, or incomplete admission — no target leak.
 */
export function venueExperienceEntryProbeTarget(args: {
  routeFocused: boolean;
  authenticated: boolean;
  actor: { actorId: string; sessionId: string } | null | undefined;
  meActorId: string | null | undefined;
  meSessionId: string | null | undefined;
  gameId: string;
  liveVenueId: string | null | undefined;
  resultsStatus: string | null | undefined;
  composerOpen: boolean;
  pendingVenueJournal: boolean;
}): { gameId: string; venueId: string } | null {
  if (!args.routeFocused || args.composerOpen || args.pendingVenueJournal) return null;
  if (!args.authenticated || !args.actor || !args.meActorId || !args.meSessionId) return null;
  if (args.actor.actorId !== args.meActorId || args.actor.sessionId !== args.meSessionId) return null;
  if (!UUID.test(args.gameId) || !args.liveVenueId || !isVenueId(args.liveVenueId)) return null;
  if (args.resultsStatus !== 'ready') return null;
  return { gameId: args.gameId.toLowerCase(), venueId: args.liveVenueId.toLowerCase() };
}

export type OwnVenueReview = {
  id: string;
  reviewHandle: string;
  venueId: string;
  status: string;
  version: number;
  audience: VenueAudience | null;
  text: string | null;
  topics: VenueReviewTopic[];
  pendingRevision: number | null;
  approvedRevision: number | null;
  publicVisible: boolean;
  notBefore: string | null;
  firstEligibleAt: string | null;
  receiptToken: string | null;
};

export type SelectedOwnVenueReview = OwnVenueReview & {
  editContext: {
    revisionId: string;
    resourceVersion: number;
    gameId: string;
    basis: OwnVenueEligibilityBasis;
  } | null;
  editUnavailableReason: 'withdrawn' | 'missing_history' | null;
};

export type VenueExperienceSubmitRevisionBody = {
  action: 'submit_revision';
  expectedVersion: number;
  gameId: string;
  audience: VenueAudience;
  expectedBasisVersions: { outcomeVersion: number; attendanceVersion: number };
  text: string;
  topics: VenueReviewTopic[];
  consentProjectionHash?: string;
};

export type VenueExperienceWithdrawBody = {
  action: 'withdraw';
  expectedVersion: number;
};

export type VenueExperienceCommandBody =
  | VenueExperienceSubmitRevisionBody
  | VenueExperienceWithdrawBody;

export type OwnVenueReviewsPage = { items: OwnVenueReview[] };

/** Closed parser for GET /me/venue-reviews — owner private list only. */
export function parseOwnVenueReviewsPage(value: unknown): OwnVenueReviewsPage {
  const row = object(value);
  if (!Array.isArray(row.items) || row.items.length > 50) throw new PublicApiError('invalid');
  const items = row.items.map(parseOwnVenueReview);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new PublicApiError('invalid');
  return { items };
}

export function parseOwnVenueReview(value: unknown): OwnVenueReview {
  const entry = object(value);
  const id = uuid(entry.id);
  if (!text(entry.reviewHandle) || !HANDLE.test(entry.reviewHandle)) throw new PublicApiError('invalid');
  if (!isVenueId(entry.venueId)) throw new PublicApiError('invalid');
  if (!text(entry.status) || entry.status.length < 1 || entry.status.length > 64) {
    throw new PublicApiError('invalid');
  }
  if (!(entry.audience === null || entry.audience === 'self_draft' || entry.audience === 'public_venue')) {
    throw new PublicApiError('invalid');
  }
  if (!(entry.text === null || (text(entry.text) && entry.text.length <= 500))) {
    throw new PublicApiError('invalid');
  }
  const topics = venueTopics(entry.topics ?? []);
  if (!(entry.pendingRevision === null || (typeof entry.pendingRevision === 'number' && Number.isInteger(entry.pendingRevision) && entry.pendingRevision >= 1))) {
    throw new PublicApiError('invalid');
  }
  if (!(entry.approvedRevision === null || (typeof entry.approvedRevision === 'number' && Number.isInteger(entry.approvedRevision) && entry.approvedRevision >= 1))) {
    throw new PublicApiError('invalid');
  }
  if (typeof entry.publicVisible !== 'boolean') throw new PublicApiError('invalid');
  if (!(entry.notBefore === null || date(entry.notBefore))) throw new PublicApiError('invalid');
  if (!(entry.firstEligibleAt === null || date(entry.firstEligibleAt))) throw new PublicApiError('invalid');
  if (!(entry.receiptToken === null
    || (text(entry.receiptToken) && entry.receiptToken.trim().length >= 1))) {
    throw new PublicApiError('invalid');
  }
  return {
    id,
    reviewHandle: entry.reviewHandle.toLowerCase(),
    venueId: String(entry.venueId).toLowerCase(),
    status: entry.status,
    version: int(entry.version, 1),
    audience: entry.audience as VenueAudience | null,
    text: entry.text as string | null,
    topics,
    pendingRevision: entry.pendingRevision as number | null,
    approvedRevision: entry.approvedRevision as number | null,
    publicVisible: entry.publicVisible,
    notBefore: entry.notBefore as string | null,
    firstEligibleAt: entry.firstEligibleAt as string | null,
    receiptToken: entry.receiptToken as string | null,
  };
}

/** Closed parser for GET /me/venue-reviews/{id} — selected owner snapshot. */
export function parseSelectedOwnVenueReview(value: unknown): SelectedOwnVenueReview {
  const base = parseOwnVenueReview(value);
  const row = object(value);
  const reason = row.editUnavailableReason;
  if (!(reason === null || reason === 'withdrawn' || reason === 'missing_history')) {
    throw new PublicApiError('invalid');
  }
  if (row.editContext === null) {
    if (reason !== 'withdrawn' && reason !== 'missing_history') throw new PublicApiError('invalid');
    return { ...base, editContext: null, editUnavailableReason: reason };
  }
  const edit = object(row.editContext);
  const basisRaw = object(edit.basis);
  const admission = text(basisRaw.admission) && ADMISSIONS.has(basisRaw.admission)
    ? basisRaw.admission as OwnVenueEligibilityBasis['admission']
    : null;
  if (!admission) throw new PublicApiError('invalid');
  if (!(basisRaw.gameTitle === null || text(basisRaw.gameTitle))) throw new PublicApiError('invalid');
  if (!(basisRaw.reason === null || text(basisRaw.reason))) throw new PublicApiError('invalid');
  if (!(basisRaw.firstEligibleAt === null || date(basisRaw.firstEligibleAt))) {
    throw new PublicApiError('invalid');
  }
  const help = basisRaw.helpHint === null ? null
    : text(basisRaw.helpHint) && HELP.has(basisRaw.helpHint)
      ? basisRaw.helpHint as OwnVenueEligibilityBasis['helpHint']
      : (() => { throw new PublicApiError('invalid'); })();
  const gameId = uuid(edit.gameId);
  const basis: OwnVenueEligibilityBasis = {
    gameId: uuid(basisRaw.gameId),
    gameTitle: basisRaw.gameTitle as string | null,
    admission,
    reason: basisRaw.reason as string | null,
    outcomeVersion: int(basisRaw.outcomeVersion),
    attendanceVersion: int(basisRaw.attendanceVersion),
    firstEligibleAt: basisRaw.firstEligibleAt as string | null,
    helpHint: help,
  };
  if (basis.gameId !== gameId) throw new PublicApiError('invalid');
  if (!text(edit.revisionId) || !UUID.test(edit.revisionId)) throw new PublicApiError('invalid');
  const resourceVersion = int(edit.resourceVersion, 1);
  if (resourceVersion !== (base.pendingRevision ?? base.approvedRevision)) {
    throw new PublicApiError('invalid');
  }
  if (base.status === 'withdrawn' || reason !== null) throw new PublicApiError('invalid');
  return {
    ...base,
    editContext: {
      revisionId: String(edit.revisionId).toLowerCase(),
      resourceVersion,
      gameId,
      basis,
    },
    editUnavailableReason: null,
  };
}

/** Validate selected private response still matches the row identity before edit/withdraw. */
export function isSelectedOwnVenueReview(
  value: SelectedOwnVenueReview,
  own: Pick<OwnVenueReview, 'id' | 'venueId' | 'reviewHandle'>,
): boolean {
  if (!value || value.id !== own.id || value.venueId !== own.venueId
    || value.reviewHandle !== own.reviewHandle
    || !Number.isSafeInteger(value.version) || value.version < 1
    || !Array.isArray(value.topics) || value.topics.length > 3
    || value.topics.some(topic => !TOPICS.has(topic))
    || (value.text !== null && typeof value.text !== 'string')
    || ![null, 'self_draft', 'public_venue'].includes(value.audience)) {
    return false;
  }
  const edit = value.editContext;
  if (edit === null) {
    return value.editUnavailableReason === 'withdrawn'
      || value.editUnavailableReason === 'missing_history';
  }
  return Boolean(
    value.status !== 'withdrawn'
    && value.editUnavailableReason === null
    && typeof edit.revisionId === 'string' && edit.revisionId
    && Number.isSafeInteger(edit.resourceVersion) && edit.resourceVersion >= 1
    && edit.resourceVersion === (value.pendingRevision ?? value.approvedRevision)
    && typeof edit.gameId === 'string' && edit.gameId
    && edit.basis && edit.basis.gameId === edit.gameId
    && ADMISSIONS.has(edit.basis.admission)
    && Number.isSafeInteger(edit.basis.outcomeVersion) && edit.basis.outcomeVersion >= 0
    && Number.isSafeInteger(edit.basis.attendanceVersion) && edit.basis.attendanceVersion >= 0,
  );
}

export function isWithdrawVenueReviewReceipt(
  value: unknown,
  own: Pick<OwnVenueReview, 'id' | 'reviewHandle' | 'version'>,
): value is VenueReviewMutationReceipt {
  if (!value || typeof value !== 'object') return false;
  try {
    const receipt = parseVenueReviewMutationReceipt(value);
    return receipt.id === own.id
      && receipt.reviewHandle === own.reviewHandle
      && Number.isSafeInteger(own.version) && own.version >= 1
      && receipt.version === own.version + 1
      && receipt.status === 'withdrawn'
      && receipt.publicVisible === false
      && receipt.receiptToken === null
      && receipt.notBefore === null;
  } catch {
    return false;
  }
}

export function isSubmitVenueReviewReceipt(
  value: unknown,
  own: Pick<OwnVenueReview, 'id' | 'reviewHandle' | 'version'>,
  audience: VenueAudience,
): value is VenueReviewMutationReceipt {
  if (!value || typeof value !== 'object') return false;
  try {
    const receipt = parseVenueReviewMutationReceipt(value);
    if (receipt.id !== own.id || receipt.reviewHandle !== own.reviewHandle
      || receipt.version !== own.version + 1) {
      return false;
    }
    return isVenueExperienceCreateReceipt(receipt, audience);
  } catch {
    return false;
  }
}

export function buildVenueExperienceWithdrawBody(
  own: Pick<OwnVenueReview, 'version'>,
): VenueExperienceWithdrawBody {
  if (!Number.isSafeInteger(own.version) || own.version < 1) throw new PublicApiError('invalid');
  return { action: 'withdraw', expectedVersion: own.version };
}

export function buildVenueExperienceSubmitRevisionBody(args: {
  own: SelectedOwnVenueReview;
  audience: VenueAudience;
  text: string;
  topics: VenueReviewTopic[];
  consentProjectionHash?: string;
}): VenueExperienceSubmitRevisionBody {
  const edit = args.own.editContext;
  if (!edit || edit.basis.admission !== 'may_submit' || args.own.status === 'withdrawn') {
    throw new PublicApiError('invalid');
  }
  const text = venueExperienceText(args.text);
  const topics = venueTopics(args.topics);
  if (args.audience === 'public_venue') {
    const hash = args.consentProjectionHash?.toLowerCase();
    if (!hash || !CONSENT_HASH.test(hash)) throw new PublicApiError('invalid');
    return {
      action: 'submit_revision',
      expectedVersion: args.own.version,
      gameId: edit.gameId,
      audience: 'public_venue',
      expectedBasisVersions: {
        outcomeVersion: edit.basis.outcomeVersion,
        attendanceVersion: edit.basis.attendanceVersion,
      },
      text,
      topics,
      consentProjectionHash: hash,
    };
  }
  if (args.consentProjectionHash !== undefined) throw new PublicApiError('invalid');
  return {
    action: 'submit_revision',
    expectedVersion: args.own.version,
    gameId: edit.gameId,
    audience: 'self_draft',
    expectedBasisVersions: {
      outcomeVersion: edit.basis.outcomeVersion,
      attendanceVersion: edit.basis.attendanceVersion,
    },
    text,
    topics,
  };
}

export function mayWithdrawOwnVenue(item: OwnVenueReview): boolean {
  return item.status !== 'withdrawn' && Number.isSafeInteger(item.version) && item.version >= 1;
}

export function mayEditOwnVenue(item: SelectedOwnVenueReview): boolean {
  return item.status !== 'withdrawn'
    && item.editContext?.basis.admission === 'may_submit'
    && item.editUnavailableReason === null;
}

export function ownVenueStatusLabel(item: OwnVenueReview): string {
  if (item.status === 'withdrawn') return 'Отозван';
  if (item.pendingRevision !== null || item.receiptToken) return 'Ожидает обработки';
  if (item.publicVisible) return 'Опубликован';
  return 'Не опубликован';
}

export function isVenueExperiencePacketKind(
  kind: string,
): kind is 'venue-experience-create' | 'venue-experience-command' {
  return kind === 'venue-experience-create' || kind === 'venue-experience-command';
}

/**
 * Discriminated Packet guard — narrows owning packet/body (kind-string guard alone does not).
 * Generic intersection keeps actor/key/path from the caller Packet without circular imports.
 */
export function isVenueExperienceCreatePacket<T extends { readonly kind: string }>(
  packet: T,
): packet is T & {
  readonly kind: 'venue-experience-create';
  readonly gameId: string;
  readonly venueId: string;
  readonly body: VenueExperienceCreateBody;
} {
  return packet.kind === 'venue-experience-create';
}

export function isVenueExperienceCommandPacket<T extends { readonly kind: string }>(
  packet: T,
): packet is T & {
  readonly kind: 'venue-experience-command';
  readonly gameId: string;
  readonly venueId: string;
  readonly reviewId: string;
  readonly reviewHandle: string;
  readonly body: VenueExperienceCommandBody;
} {
  return packet.kind === 'venue-experience-command';
}

/**
 * Withdraw confirm view flags — sending is busy; UNKNOWN is pending/actionable, not busy.
 * Hide (not cancel) while sending or UNKNOWN so closing preserves the journal.
 */
export function ownVenueWithdrawConfirmFlags(input: {
  command: { status: string; packet: { readonly kind: string } } | null | undefined;
}): { busy: boolean; pending: boolean; hideWindow: boolean } {
  const owner = input.command && isVenueExperienceCommandPacket(input.command.packet)
    ? input.command
    : null;
  const busy = owner?.status === 'sending';
  const pending = owner?.status === 'unknown';
  return { busy: !!busy, pending: !!pending, hideWindow: !!busy || !!pending };
}

export function venueExperienceIdempotencyExpired(firstDispatchedAt: number, now = Date.now()): boolean {
  return Number.isFinite(firstDispatchedAt) && now - firstDispatchedAt >= VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS;
}

/**
 * Fail-closed UNKNOWN replay gate: missing/invalid/backwards clock or elapsed ≥ 24h.
 * Controllable via `now` for synthetic transport tests — never restarts original age.
 */
export function postgameIdempotencyReplayBlocked(
  firstDispatchedAt: number | undefined,
  now = Date.now(),
): boolean {
  if (typeof firstDispatchedAt !== 'number' || !Number.isFinite(firstDispatchedAt)) return true;
  if (!Number.isFinite(now) || now < firstDispatchedAt) return true;
  const elapsed = now - firstDispatchedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return true;
  return elapsed >= POSTGAME_IDEMPOTENCY_TTL_MS;
}

export const TOPIC_LABEL: Record<VenueReviewTopic, string> = {
  surface: 'Покрытие',
  lighting: 'Свет',
  amenities: 'Удобства',
};

export const VENUE_TOPIC_OPTIONS: Array<{ value: VenueReviewTopic; label: string }> = [
  { value: 'surface', label: TOPIC_LABEL.surface },
  { value: 'lighting', label: TOPIC_LABEL.lighting },
  { value: 'amenities', label: TOPIC_LABEL.amenities },
];
