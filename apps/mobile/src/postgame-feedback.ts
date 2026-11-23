/**
 * Native private peer feedback — types, parsers, and display helpers.
 * Mutations stay on root PostgameCoordinator; this module never owns a queue.
 * Only imports PostgameError from postgame.ts (defined before peer re-exports).
 */
import { PostgameError } from './postgame.ts';

const invalid = (): never => { throw new PostgameError('invalid'); };
function str(v: unknown): string { return typeof v === 'string' ? v : invalid(); }
function bool(v: unknown): boolean { return typeof v === 'boolean' ? v : invalid(); }
function num(v: unknown, min = 0): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 2147483647 ? v : invalid();
}
function nullable<T>(v: unknown, parse: (v: unknown) => T): T | null { return v === null ? null : parse(v); }
function choice<T extends string>(v: unknown, values: readonly T[]): T {
  for (const item of values) if (v === item) return item;
  return invalid();
}
function array<T>(v: unknown, parse: (v: unknown) => T): T[] {
  return Array.isArray(v) ? v.map(parse) : invalid();
}
function time(v: unknown): string {
  const value = str(v);
  return Number.isFinite(Date.parse(value)) ? value : invalid();
}
function hasControl(value: string): boolean {
  return Array.from(value).some(char => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function postgameId(v: unknown): string {
  const id = str(v);
  return /^[A-Za-z0-9_-]{1,128}$/.exec(id)?.[0] === id ? id : invalid();
}
function cursor(v: unknown): string {
  const value = str(v);
  return value.length > 0 && value.length <= 2048 && !/\s/.test(value) && !hasControl(value) ? value : invalid();
}

export const PEER_RATINGS = ['play_again', 'neutral', 'difficulties'] as const;
export type PeerRating = (typeof PEER_RATINGS)[number];
export const PEER_TAGS = ['communication', 'teamwork', 'agreements'] as const;
export type PeerTag = (typeof PEER_TAGS)[number];
export const REVIEW_KINDS = ['peer', 'organization', 'training'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const PEER_CREATE_REASONS = [
  'game_not_confirmed',
  'attendance_unmarked',
  'attendance_clarifying',
  'no_eligible_peers',
] as const;
export type PeerCreateReason = (typeof PEER_CREATE_REASONS)[number];
export const REPORT_REASONS = [
  { code: 'harassment', label: 'Оскорбления / давление' },
  { code: 'spam', label: 'Спам' },
  { code: 'fake_profile', label: 'Поддельный профиль' },
  { code: 'inappropriate', label: 'Неприемлемый контент' },
  { code: 'other', label: 'Другое' },
] as const;
export type ReviewReportReason = (typeof REPORT_REASONS)[number]['code'];

export type PrivateReviewReply = {
  text: string;
  version: number;
  editedAt: string | null;
  updatedAt: string;
};

export type PrivateReview = {
  id: string;
  gameId: string;
  kind: ReviewKind;
  subjectContextId: string | null;
  recipientDisplay: string;
  peerRating: PeerRating | null;
  organizationScore: number | null;
  comment: string | null;
  tags: PeerTag[];
  experienceAssertion: 'i_experienced_this_game';
  discrepancyExplanation: string | null;
  attendanceContext:
    | 'present'
    | 'absent'
    | 'unknown'
    | 'contested'
    | 'not_participant_manager'
    | 'outcome_not_held';
  outcomeContext: 'unknown' | 'held' | 'not_held';
  version: number;
  editedAt: string | null;
  createdAt: string;
  direction: 'sent' | 'received';
  reply: PrivateReviewReply | null;
  allowedActions: { canEdit: boolean; canReply: boolean; canReport: boolean };
};

export type MeReviewsPage = { items: PrivateReview[]; nextCursor: string | null };

export type ReviewReportReceipt = {
  reportId: string;
  status: 'submitted';
  reviewId: string;
  version: number;
};

export const PEER_OPTIONS: Array<{ value: PeerRating; title: string; hint: string }> = [
  { value: 'play_again', title: 'Было здорово сыграть', hint: 'Хотелось бы повторить' },
  { value: 'neutral', title: 'Всё спокойно', hint: 'Обычный игровой опыт' },
  { value: 'difficulties', title: 'Были сложности', hint: 'Играть вместе было трудно' },
];

export const TAG_OPTIONS: Array<{ value: PeerTag; label: string }> = [
  { value: 'communication', label: 'Общение' },
  { value: 'teamwork', label: 'Командная игра' },
  { value: 'agreements', label: 'Договорённости' },
];

export function peerRatingLabel(rating: PeerRating | null | undefined): string {
  return PEER_OPTIONS.find(o => o.value === rating)?.title ?? '—';
}

export function peerCreateReasonLabel(code: PeerCreateReason | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'game_not_confirmed': return 'Игра ещё не подтверждена';
    case 'attendance_unmarked': return 'Посещение ещё не отмечено';
    case 'attendance_clarifying': return 'Уточняем посещение';
    case 'no_eligible_peers': return 'Пока нет участников для отзыва';
    default: return null;
  }
}

export function reviewComment(v: unknown): string {
  const s = str(v);
  return s === s.trim() && s.length > 0 && s.length <= 500 && !hasControl(s) ? s : invalid();
}

export function reviewReplyText(v: unknown): string {
  return reviewComment(v);
}

export function reportDetailText(v: unknown): string | null {
  if (v === null) return null;
  const s = str(v);
  return s === s.trim() && s.length > 0 && s.length <= 1000 && !hasControl(s) ? s : invalid();
}

function parseReply(v: unknown): PrivateReviewReply {
  const r = object(v);
  const text = str(r.text);
  if (!text.trim() || text.length > 500 || hasControl(text)) invalid();
  return {
    text,
    version: num(r.version, 1),
    editedAt: nullable(r.editedAt, time),
    updatedAt: time(r.updatedAt),
  };
}

/** Parse any private review kind (peer / organization / training). */
export function parsePrivateReview(v: unknown): PrivateReview {
  const r = object(v);
  const rights = object(r.allowedActions);
  const tags = array(r.tags ?? [], item => choice(item, PEER_TAGS));
  if (tags.length > 3) invalid();
  const seen = new Set<string>();
  for (const tag of tags) {
    if (seen.has(tag)) invalid();
    seen.add(tag);
  }
  const kind = choice(r.kind, REVIEW_KINDS);
  const peerRating = nullable(r.peerRating, x => choice(x, PEER_RATINGS));
  const organizationScore = nullable(r.organizationScore, x => {
    const n = num(x, 1);
    return n >= 1 && n <= 5 ? n : invalid();
  });
  if (kind === 'peer' && peerRating === null) invalid();
  if (kind !== 'peer' && peerRating !== null) invalid();
  const comment = nullable(r.comment, reviewComment);
  const discrepancy = nullable(r.discrepancyExplanation, reviewComment);
  const recipientDisplay = str(r.recipientDisplay);
  if (!recipientDisplay.trim() || recipientDisplay.length > 80) invalid();
  const canReport = r.allowedActions && 'canReport' in rights ? bool(rights.canReport) : false;
  const review: PrivateReview = {
    id: postgameId(r.id),
    gameId: postgameId(r.gameId),
    kind,
    subjectContextId: nullable(r.subjectContextId, postgameId),
    recipientDisplay,
    peerRating,
    organizationScore,
    comment,
    tags,
    experienceAssertion: choice(r.experienceAssertion, ['i_experienced_this_game'] as const),
    discrepancyExplanation: discrepancy,
    attendanceContext: choice(r.attendanceContext, [
      'present', 'absent', 'unknown', 'contested', 'not_participant_manager', 'outcome_not_held',
    ] as const),
    outcomeContext: choice(r.outcomeContext, ['unknown', 'held', 'not_held'] as const),
    version: num(r.version, 1),
    editedAt: nullable(r.editedAt, time),
    createdAt: time(r.createdAt),
    direction: choice(r.direction, ['sent', 'received'] as const),
    reply: nullable(r.reply, parseReply),
    allowedActions: {
      canEdit: bool(rights.canEdit),
      canReply: bool(rights.canReply),
      canReport,
    },
  };
  if (review.kind === 'peer' && review.subjectContextId === null) invalid();
  return review;
}

export function parseMeReviewsPage(v: unknown): MeReviewsPage {
  const r = object(v);
  const items = array(r.items, parsePrivateReview);
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) invalid();
    seen.add(item.id);
  }
  return { items, nextCursor: nullable(r.nextCursor, cursor) };
}

export function parseReviewReportReceipt(v: unknown): ReviewReportReceipt {
  const r = object(v);
  return {
    reportId: postgameId(r.reportId),
    status: choice(r.status, ['submitted'] as const),
    reviewId: postgameId(r.reviewId),
    version: num(r.version, 1),
  };
}

export function reviewsQuery(opts: { direction?: 'sent' | 'received'; cursor?: string; limit?: number } = {}): string {
  const p = new URLSearchParams();
  if (opts.direction !== undefined) {
    if (opts.direction !== 'sent' && opts.direction !== 'received') invalid();
    p.set('direction', opts.direction);
  }
  if (opts.limit !== undefined) {
    const n = num(opts.limit, 1);
    if (n > 50) invalid();
    p.set('limit', String(n));
  }
  if (opts.cursor !== undefined) p.set('cursor', cursor(opts.cursor));
  return p.size ? `?${p}` : '';
}

/** Peer-only rows for UI; non-peer may be parsed but never rendered as peer. */
export function peerReviewsOnly(items: readonly PrivateReview[]): PrivateReview[] {
  return items.filter(r => r.kind === 'peer');
}

export function peerReviewsForGame(items: readonly PrivateReview[], gameId: string): PrivateReview[] {
  return peerReviewsOnly(items).filter(r => r.gameId === gameId);
}

/** All private kinds (peer / organization / training) for own history lanes. */
export function privateReviewsOnly(items: readonly PrivateReview[]): PrivateReview[] {
  return items.filter(r => r.kind === 'peer' || r.kind === 'organization' || r.kind === 'training');
}

export function privateReviewsForGame(items: readonly PrivateReview[], gameId: string): PrivateReview[] {
  return privateReviewsOnly(items).filter(r => r.gameId === gameId);
}

export function reviewKindModeLabel(kind: ReviewKind): string {
  switch (kind) {
    case 'peer': return 'Игроку';
    case 'organization': return 'Организатору лично';
    case 'training': return 'Тренировка';
  }
}

/** Card headline: peer rating title, org score line, or training label. */
export function privateReviewHeadline(review: PrivateReview): string {
  if (review.kind === 'peer') return peerRatingLabel(review.peerRating);
  if (review.kind === 'organization') {
    return review.organizationScore != null
      ? `Оценка организации: ${review.organizationScore} из 5`
      : 'Организатору лично';
  }
  return 'Тренировка';
}

/**
 * When own attendance/outcome is known present or not_participant_manager, omit discrepancy
 * from the wire body. Outcome not_held always allows the field. Ambiguous (no results) → optional.
 */
export function shouldOmitRoleDiscrepancy(results: {
  outcome: { value: 'unknown' | 'held' | 'not_held' };
  attendance?: { installed: boolean; myAttendance: { value: string; dispute: { status: string } | null } | null } | null;
} | undefined): boolean {
  if (!results) return false;
  if (results.outcome.value === 'not_held') return false;
  const my = results.attendance?.installed ? results.attendance.myAttendance : undefined;
  if (results.attendance?.installed && my === null) return true;
  if (my && my.value === 'present' && my.dispute?.status !== 'open') return true;
  return false;
}

/**
 * Feedback section: installed=false shows honest disable; create rights, peer reason,
 * org/training caps, or own history lane (incl. when results denied) show the surface.
 */
export function feedbackSectionVisible(
  gameId: string,
  feedback: {
    installed: boolean;
    capabilities: {
      canCreatePeer?: boolean;
      canCreateOrganization?: boolean;
      canCreateTraining?: boolean;
      organizationRecipientDisplay?: string | null;
      peerCreateReason?: PeerCreateReason | null;
      peerSubjects?: { contextId: string; displayName: string }[];
    };
  } | undefined,
  histories: {
    received?: { status: string; data?: MeReviewsPage };
    sent?: { status: string; data?: MeReviewsPage };
  },
): boolean {
  if (feedback?.installed === false) return true;
  const caps = feedback?.capabilities;
  if (caps?.canCreatePeer) return true;
  if (caps?.canCreateOrganization || caps?.organizationRecipientDisplay) return true;
  if (caps?.canCreateTraining) return true;
  if ((caps?.peerSubjects?.length ?? 0) > 0) return true;
  if (caps?.peerCreateReason) return true;
  for (const lane of [histories.received, histories.sent]) {
    if (!lane) continue;
    if (lane.status === 'loading' || lane.status === 'error' || lane.status === 'idle') return true;
    if (lane.status === 'ready') {
      if (privateReviewsForGame(lane.data?.items ?? [], gameId).length > 0) return true;
      // Honest empty history is still a visible lane when results denied / create unavailable.
      if (lane.data) return true;
    }
    if (lane.status === 'unavailable') return true;
  }
  return false;
}

/**
 * Monotonic merge: same id keeps higher review version; reply revision is independent —
 * adopt legitimate newer review content while preserving the highest accepted reply/text.
 * Both arrival orders: never regress parent content/permissions from an older parent;
 * still adopt an independently newer reply onto the kept parent.
 */
export function mergeReviewPages(
  prior: PrivateReview[],
  incoming: PrivateReview[],
  direction: 'sent' | 'received',
): PrivateReview[] {
  const byId = new Map<string, PrivateReview>();
  for (const row of prior) {
    if (row.direction !== direction) continue;
    byId.set(row.id, row);
  }
  for (const row of incoming) {
    if (row.direction !== direction) continue;
    const old = byId.get(row.id);
    if (!old) {
      byId.set(row.id, row);
      continue;
    }
    const oldReply = old.reply?.version ?? 0;
    const nextReply = row.reply?.version ?? 0;
    if (row.version < old.version) {
      // Older parent must not win content/permissions; may still raise reply floor.
      if (nextReply > oldReply) byId.set(row.id, { ...old, reply: row.reply });
      continue;
    }
    // Across review-version advances and same-version refreshes: keep highest reply.
    if (nextReply < oldReply) {
      byId.set(row.id, { ...row, reply: old.reply });
    } else {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

/** Prefer monotonic store projection over raw history/results page rows. */
export function projectReviewsFromStore(
  items: readonly PrivateReview[],
  byId: Record<string, PrivateReview>,
): PrivateReview[] {
  return items.map(row => byId[row.id] ?? row);
}

/** Pending/error/unavailable history is display-only — no new reply/report controls. */
export function reviewCommandsOpen(historyStatus: string | undefined): boolean {
  return historyStatus === 'ready';
}

/** Strip write actions for retained display rows while history is not ready. */
export function displayOnlyReview(row: PrivateReview): PrivateReview {
  return {
    ...row,
    allowedActions: { canEdit: false, canReply: false, canReport: false },
  };
}

export type PeerSubjectOption = { contextId: string; displayName: string };

/**
 * Pin peer create to an explicit user-selected subject.
 * Never silently rebind to first/singular when the prior choice leaves the list;
 * draft rating/comment/tags stay in the store for the reselect path.
 */
export function resolvePeerDraftSubject(
  subjects: readonly PeerSubjectOption[],
  draftSubjectContextId: string | undefined,
): { selected: PeerSubjectOption | undefined; needsReselect: boolean } {
  if (draftSubjectContextId) {
    const match = subjects.find(s => s.contextId === draftSubjectContextId);
    if (match) return { selected: match, needsReselect: false };
    return { selected: undefined, needsReselect: subjects.length > 0 };
  }
  return { selected: undefined, needsReselect: false };
}

/** Empty copy for same-game private history; cursor means the page is not definitive. */
export function peerHistoryEmptyText(
  direction: 'received' | 'sent',
  nextCursor: string | null | undefined,
): string {
  if (nextCursor) return 'Среди загруженных отзывов по этой игре пока нет';
  return direction === 'received'
    ? 'Пока нет полученных отзывов по этой игре.'
    : 'Пока нет отправленных отзывов по этой игре.';
}

export function organizationScoreValue(v: unknown): number {
  const n = num(v, 1);
  return n >= 1 && n <= 5 ? n : invalid();
}
