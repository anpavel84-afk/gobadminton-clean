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

/** Client fence matching server idempotency completed/UNKNOWN TTL. */
export const VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

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
  return basis?.admission === 'may_submit' ? basis : null;
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
  if (!(row.receiptToken === null || text(row.receiptToken) && row.receiptToken.length >= 1)) {
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
  return (receipt.status === 'submitted_waiting' || receipt.status === 'revision_waiting')
    && typeof receipt.receiptToken === 'string' && receipt.receiptToken.length > 0;
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
    return `Сейчас нельзя оставить отзыв по этой игре.${basis.reason ? ` Причина: ${basis.reason}.` : ''}`;
  }
  return null;
}

export function isVenueExperiencePacketKind(kind: string): kind is 'venue-experience-create' {
  return kind === 'venue-experience-create';
}

export function venueExperienceIdempotencyExpired(firstDispatchedAt: number, now = Date.now()): boolean {
  return Number.isFinite(firstDispatchedAt) && now - firstDispatchedAt >= VENUE_EXPERIENCE_IDEMPOTENCY_TTL_MS;
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
