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

/**
 * Distinct secondary card line only — never repeat the kind tab label.
 * Org without score and training rely on reviewKindModeLabel alone.
 */
export function privateReviewHeadline(review: PrivateReview): string | null {
  if (review.kind === 'peer') return peerRatingLabel(review.peerRating);
  if (review.kind === 'organization') {
    return review.organizationScore != null
      ? `Оценка организации: ${review.organizationScore} из 5`
      : null;
  }
  return null;
}

/** Russian field copy for FEEDBACK_DISCREPANCY_REQUIRED — also gates recover-on-wire. */
export const DISCREPANCY_REQUIRED_MESSAGE = 'Поясните расхождение с отметкой или итогом игры';
/** Russian field copy for FEEDBACK_DISCREPANCY_UNEXPECTED. */
export const DISCREPANCY_UNEXPECTED_MESSAGE = 'Пояснение для этой встречи не требуется';
/** Honest hint when client knows explanation will not be sent. */
export const DISCREPANCY_OMIT_HINT = 'Пояснение сейчас не требуется и не будет отправлено';

export type RoleDiscrepancyResults = {
  outcome: { value: 'unknown' | 'held' | 'not_held' };
  attendance?: {
    installed: boolean;
    myAttendance: { value: string; dispute: { status: string } | null } | null;
  } | null;
};

/** Attendance/outcome fingerprint — server decision must not survive unrelated context. */
export type RoleDiscrepancyContext = {
  outcome: 'unknown' | 'held' | 'not_held';
  attendance: 'present' | 'absent' | 'unknown' | 'null' | 'missing';
  disputeOpen: boolean;
};

/** Server FEEDBACK_DISCREPANCY_* bound to the kind+context that produced it — not a translated-message key. */
export type RoleDiscrepancyDecision = {
  kind: 'organization' | 'training';
  fieldError: typeof DISCREPANCY_REQUIRED_MESSAGE | typeof DISCREPANCY_UNEXPECTED_MESSAGE;
  context: RoleDiscrepancyContext;
};

export function roleDiscrepancyContextFromResults(
  results: RoleDiscrepancyResults | undefined,
): RoleDiscrepancyContext {
  if (!results) return { outcome: 'unknown', attendance: 'missing', disputeOpen: false };
  const my = results.attendance?.installed ? results.attendance.myAttendance : undefined;
  let attendance: RoleDiscrepancyContext['attendance'] = 'missing';
  let disputeOpen = false;
  if (results.attendance?.installed) {
    if (my === null) attendance = 'null';
    else if (my) {
      attendance = my.value === 'present' || my.value === 'absent' || my.value === 'unknown'
        ? my.value
        : 'unknown';
      disputeOpen = my.dispute?.status === 'open';
    }
  }
  return { outcome: results.outcome.value, attendance, disputeOpen };
}

export function roleDiscrepancyContextsEqual(
  a: RoleDiscrepancyContext,
  b: RoleDiscrepancyContext,
): boolean {
  return a.outcome === b.outcome && a.attendance === b.attendance && a.disputeOpen === b.disputeOpen;
}

export function roleDiscrepancyDecisionFromError(
  kind: 'organization' | 'training',
  code: 'FEEDBACK_DISCREPANCY_REQUIRED' | 'FEEDBACK_DISCREPANCY_UNEXPECTED',
  resultsOrContext: RoleDiscrepancyResults | RoleDiscrepancyContext | undefined,
): RoleDiscrepancyDecision {
  // Accept a pre-captured owned-packet fingerprint, or derive from results.
  const context = resultsOrContext != null && typeof resultsOrContext.outcome === 'string'
    ? resultsOrContext
    : roleDiscrepancyContextFromResults(resultsOrContext);
  return {
    kind,
    fieldError: code === 'FEEDBACK_DISCREPANCY_REQUIRED'
      ? DISCREPANCY_REQUIRED_MESSAGE
      : DISCREPANCY_UNEXPECTED_MESSAGE,
    context,
  };
}

/** Decision applies only to matching kind + current attendance/outcome context. */
export function roleDiscrepancyActiveDecision(
  decision: RoleDiscrepancyDecision | null | undefined,
  kind: 'organization' | 'training',
  results: RoleDiscrepancyResults | undefined,
): RoleDiscrepancyDecision | null {
  if (!decision || decision.kind !== kind) return null;
  if (!roleDiscrepancyContextsEqual(decision.context, roleDiscrepancyContextFromResults(results))) {
    return null;
  }
  return decision;
}

export function boundRoleDiscrepancyFieldError(
  decision: RoleDiscrepancyDecision | null | undefined,
  kind: 'organization' | 'training',
  results: RoleDiscrepancyResults | undefined,
): string | null {
  return roleDiscrepancyActiveDecision(decision, kind, results)?.fieldError ?? null;
}

/**
 * Omit discrepancy from the wire only when own attendance is known present (no open dispute).
 * Null myAttendance is AMBIGUOUS (manager projection gap) — never proof of not_participant_manager;
 * do not drop text. Outcome not_held always allows the field. Missing results → optional.
 */
export function shouldOmitRoleDiscrepancy(results: RoleDiscrepancyResults | undefined): boolean {
  if (!results) return false;
  if (results.outcome.value === 'not_held') return false;
  const my = results.attendance?.installed ? results.attendance.myAttendance : undefined;
  // Ambiguous null projection: server may still require explanation — keep text.
  if (results.attendance?.installed && my === null) return false;
  if (my && my.value === 'present' && my.dispute?.status !== 'open') return true;
  return false;
}

export type RoleDiscrepancyPresentation = {
  /** Show the discrepancy input (or a disabled stand-in with hint). */
  visible: boolean;
  /** Accept typed input; false when explanation is known-unnecessary. */
  editable: boolean;
  /** Strip discrepancyExplanation from the POST body. */
  omitFromWire: boolean;
  /** Clear Russian hint when the field must not look silently editable. */
  hint: string | null;
};

/**
 * UI + wire for role discrepancy: server REQUIRED recovers even if prior omit inference differs;
 * known-unnecessary (present) hides editable input and omits on wire while draft stays in store.
 * Callers pass already kind+context-bound fieldError (see boundRoleDiscrepancyFieldError).
 */
export function roleDiscrepancyPresentation(
  results: RoleDiscrepancyResults | undefined,
  fieldError: string | null | undefined,
): RoleDiscrepancyPresentation {
  if (fieldError === DISCREPANCY_REQUIRED_MESSAGE) {
    return { visible: true, editable: true, omitFromWire: false, hint: null };
  }
  if (shouldOmitRoleDiscrepancy(results) || fieldError === DISCREPANCY_UNEXPECTED_MESSAGE) {
    return {
      visible: true,
      editable: false,
      omitFromWire: true,
      hint: DISCREPANCY_OMIT_HINT,
    };
  }
  return { visible: true, editable: true, omitFromWire: false, hint: null };
}

/**
 * After explicit server FEEDBACK_DISCREPANCY_REQUIRED, empty normalized current-role
 * discrepancy blocks create CTA and handler. First ambiguous open (no REQUIRED) does not.
 * Callers pass normalizeFormReason(...) for the currently rendered role field.
 */
export function roleDiscrepancyRequiredBlocksCreate(
  fieldError: string | null | undefined,
  normalizedDiscrepancy: string,
): boolean {
  return fieldError === DISCREPANCY_REQUIRED_MESSAGE && !normalizedDiscrepancy;
}

export type FeedbackUiMode = 'peer' | 'organization' | 'training' | 'received' | 'sent';

/**
 * Display mode from visible tabs — never auto-write draft.mode.
 * Hidden-tab draft.mode (e.g. lost canCreateTraining) falls back to an available surface.
 */
export function resolveFeedbackDisplayMode(
  draftMode: FeedbackUiMode | undefined,
  tabs: { peer: boolean; organization: boolean; training: boolean },
): FeedbackUiMode {
  const allowed = (mode: FeedbackUiMode): boolean => {
    if (mode === 'peer') return tabs.peer;
    if (mode === 'organization') return tabs.organization;
    if (mode === 'training') return tabs.training;
    return true;
  };
  if (draftMode !== undefined && allowed(draftMode)) return draftMode;
  if (tabs.peer) return 'peer';
  if (tabs.organization) return 'organization';
  if (tabs.training) return 'training';
  return 'received';
}

/**
 * Same patch DiscrepancyField applies — explicit rendered kind, never inferred draft.mode.
 * Peer comment/tags are untouched. REQUIRED recover stays while editing in the SAME bound context.
 * Pass the active (kind+context-matched) decision; unbound/stale/cross-kind clears the store slot.
 */
export function feedbackDiscrepancyDraftPatch(
  kind: 'organization' | 'training',
  text: string,
  activeDecision?: RoleDiscrepancyDecision | null,
): (
  | { organizationDiscrepancy: string; discrepancyDecision: RoleDiscrepancyDecision | null }
  | { trainingDiscrepancy: string; discrepancyDecision: RoleDiscrepancyDecision | null }
) {
  const discrepancyDecision = activeDecision
    && activeDecision.kind === kind
    && activeDecision.fieldError === DISCREPANCY_REQUIRED_MESSAGE
    ? activeDecision
    : null;
  return kind === 'organization'
    ? { organizationDiscrepancy: text, discrepancyDecision }
    : { trainingDiscrepancy: text, discrepancyDecision };
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

/** Hub private history empty copy (cross-game; not same-game lane). */
export function privateHubHistoryEmptyText(direction: 'received' | 'sent'): string {
  return direction === 'received'
    ? 'Пока нет полученных отзывов'
    : 'Пока нет отправленных отзывов';
}

/**
 * Validated results deep-link section from My Games private history.
 * Only `feedback` is admitted — unknown/array noise falls back to null.
 */
export function parseResultsFeedbackSection(
  raw: string | string[] | null | undefined,
): 'feedback' | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'feedback' ? 'feedback' : null;
}

/**
 * Expo-router params for exact-game results with feedback section.
 * Never carries comment, recipient name, or other private review fields.
 */
export function feedbackResultsNavParams(gameId: string): { gameId: string; section: 'feedback' } {
  return { gameId: postgameId(gameId), section: 'feedback' };
}

/** History-surface peer rating labels (web GameReviewsHistory parity; distinct from create titles). */
export function peerReviewHistoryLabel(rating: PeerRating | null | undefined): string {
  if (rating === 'play_again') return 'Сыграл бы снова';
  if (rating === 'neutral') return 'Нейтрально';
  if (rating === 'difficulties') return 'Были трудности';
  return '—';
}

/** History-surface kind eyebrow (web reviewKindLabel parity). */
export function privateReviewKindHistoryLabel(kind: ReviewKind): string {
  if (kind === 'peer') return 'Отзыв игроку';
  if (kind === 'organization') return 'Отзыв организации';
  return 'Тренировочный отзыв';
}

/** Rating/score line for a hub private-history row. */
export function privateReviewHistoryDetail(review: PrivateReview): string {
  if (review.kind === 'peer') return peerReviewHistoryLabel(review.peerRating);
  if (review.kind === 'organization' && review.organizationScore != null) {
    return `Оценка ${review.organizationScore} из 5`;
  }
  return 'Без оценки';
}

/** Russian date line for hub private-history rows; invalid Date falls back to raw ISO. */
export function formatPrivateReviewWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return iso;
  }
}

export function organizationScoreValue(v: unknown): number {
  const n = num(v, 1);
  return n >= 1 && n <= 5 ? n : invalid();
}
