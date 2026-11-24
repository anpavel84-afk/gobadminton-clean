import { PublicApiError } from './public-api.ts';
import { isVenueId } from './venues.ts';

export type RoleKind = 'organization' | 'training';
export type RoleAvailability = 'available' | 'unavailable';
export type RoleLoadPhase = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export type PublicRoleReply = {
  text: string;
  experienceState: 'published';
  publishedRevision: number;
};

export type PublicRoleReviewItem = {
  reviewHandle: string;
  role: RoleKind;
  text: string;
  topics: string[];
  authorLabel: 'Участник игры' | 'Участник тренировки';
  experienceState: 'published' | 'basis_under_review';
  publishedRevision: number;
  replyAggregateVersion: number;
  reply: PublicRoleReply | null;
};

/** Subject-only tip — status/version/pendingRevision; never pending body text. */
export type SubjectOwnReplyTip = {
  status: string;
  version: number;
  pendingRevision: number | null;
};

/** Actor-aware item from signed-in by-handle GET — typed actions required; never from anonymous list. */
export type ActorAwarePublicRoleReviewItem = PublicRoleReviewItem & {
  subjectOwnReply: SubjectOwnReplyTip | null;
  allowedActions: { canReport: boolean; canReply: boolean };
};

export type RoleReputationSummary = {
  roleHandle: string;
  role: RoleKind;
  subjectDisplayName: string | null;
  heldGamesCount: number | null;
  countScope: 'confirmed_history';
  historyMayBeIncomplete: true;
  publishedReviewCount: number;
  projectionVersion: string;
  items: PublicRoleReviewItem[];
  nextCursor: string | null;
  availability: RoleAvailability;
};

export type ActorAwareRoleReputationSummary = Omit<RoleReputationSummary, 'items'> & {
  items: ActorAwarePublicRoleReviewItem[];
};

export type RoleLaneState = {
  role: RoleKind;
  phase: RoleLoadPhase;
  summary: RoleReputationSummary | null;
  loadingMore: boolean;
  /** Scoped next-page failure — accepted summary/cursor stay until unavailable/privacy. */
  moreError: boolean;
};

export type RoleReputationCardState = {
  gameId: string | null;
  /** Profile-surface peer; mutually exclusive with gameId provenance. */
  publicPlayerId: string | null;
  wantTraining: boolean;
  expanded: boolean;
  organization: RoleLaneState;
  training: RoleLaneState;
};

export type RoleReputationPorts = {
  gameRole: (gameId: string, role: RoleKind, signal?: AbortSignal) => Promise<RoleReputationSummary>;
  byHandle: (
    roleHandle: string,
    query: { gameId: string; cursor?: string; limit?: number },
    signal?: AbortSignal,
  ) => Promise<RoleReputationSummary>;
  /** PUBLIC player profile role lane — never invents a gameId. Optional so game cards stay unchanged. */
  playerRole?: (
    publicPlayerId: string,
    role: RoleKind,
    query?: { cursor?: string; limit?: number },
    signal?: AbortSignal,
  ) => Promise<RoleReputationSummary>;
};

const ORGANIZATION_TOPICS = new Set(['agreements', 'flow', 'communication']);
const TRAINING_TOPICS = new Set(['explanations', 'attention', 'session_organization']);
const ALL_TOPICS = new Set([...ORGANIZATION_TOPICS, ...TRAINING_TOPICS]);

export const ROLE_TOPIC_LABEL: Record<string, string> = {
  agreements: 'Договорённости',
  flow: 'Ход встречи',
  communication: 'Общение',
  explanations: 'Объяснения',
  attention: 'Внимание',
  session_organization: 'Организация занятия',
};

const HANDLE = /^[0-9a-f]{32}$/i;
const TEXT_MAX = 500;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicApiError('invalid');
  return value as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function roleHandle(value: unknown): string {
  if (!text(value) || !HANDLE.test(value)) throw new PublicApiError('invalid');
  return value.toLowerCase();
}

function roleKind(value: unknown): RoleKind {
  if (value === 'organization' || value === 'training') return value;
  throw new PublicApiError('invalid');
}

function nonNegInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    throw new PublicApiError('invalid');
  }
  return value;
}

function posInt(value: unknown): number {
  const n = nonNegInt(value);
  if (n < 1) throw new PublicApiError('invalid');
  return n;
}

function plainReviewText(value: unknown): string {
  if (!text(value) || value.length < 1 || value.length > TEXT_MAX) throw new PublicApiError('invalid');
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) throw new PublicApiError('invalid');
  }
  return value;
}

function cursor(value: unknown): string | null {
  if (value === null) return null;
  if (!text(value) || !value || value.length > 4096) throw new PublicApiError('invalid');
  return value;
}

function parseReply(value: unknown): PublicRoleReply | null {
  if (value === null) return null;
  const row = object(value);
  if (row.experienceState !== 'published') throw new PublicApiError('invalid');
  return {
    text: plainReviewText(row.text),
    experienceState: 'published',
    publishedRevision: posInt(row.publishedRevision),
  };
}

function parseItem(value: unknown, expectedRole: RoleKind): PublicRoleReviewItem {
  const row = object(value);
  const role = roleKind(row.role);
  if (role !== expectedRole) throw new PublicApiError('invalid');
  const authorLabel = row.authorLabel;
  if (authorLabel !== 'Участник игры' && authorLabel !== 'Участник тренировки') {
    throw new PublicApiError('invalid');
  }
  if (role === 'organization' && authorLabel !== 'Участник игры') throw new PublicApiError('invalid');
  if (role === 'training' && authorLabel !== 'Участник тренировки') throw new PublicApiError('invalid');
  if (row.experienceState !== 'published' && row.experienceState !== 'basis_under_review') {
    throw new PublicApiError('invalid');
  }
  if (!Array.isArray(row.topics) || row.topics.length > 3) throw new PublicApiError('invalid');
  const allowed = role === 'organization' ? ORGANIZATION_TOPICS : TRAINING_TOPICS;
  for (const topic of row.topics) {
    if (!text(topic) || !allowed.has(topic) || !ALL_TOPICS.has(topic)) throw new PublicApiError('invalid');
  }
  // Guest/public projection stays private-field-free — discard action/tip if present on wire.
  return {
    reviewHandle: roleHandle(row.reviewHandle),
    role,
    text: plainReviewText(row.text),
    topics: row.topics as string[],
    authorLabel,
    experienceState: row.experienceState,
    publishedRevision: posInt(row.publishedRevision),
    replyAggregateVersion: nonNegInt(row.replyAggregateVersion),
    reply: parseReply(row.reply),
  };
}

function parseSubjectOwnReply(value: unknown): SubjectOwnReplyTip | null {
  if (value === null) return null;
  const tip = object(value);
  if (!text(tip.status) || !tip.status || tip.status.length > 64) throw new PublicApiError('invalid');
  return {
    status: tip.status,
    version: nonNegInt(tip.version),
    pendingRevision: tip.pendingRevision === null ? null : posInt(tip.pendingRevision),
  };
}

function parseActorAwareItem(value: unknown, expectedRole: RoleKind): ActorAwarePublicRoleReviewItem {
  const base = parseItem(value, expectedRole);
  const row = object(value);
  const actions = object(row.allowedActions);
  if (typeof actions.canReport !== 'boolean' || typeof actions.canReply !== 'boolean') {
    throw new PublicApiError('invalid');
  }
  return {
    ...base,
    subjectOwnReply: parseSubjectOwnReply(row.subjectOwnReply),
    allowedActions: { canReport: actions.canReport, canReply: actions.canReply },
  };
}

function parseSummaryShell(value: unknown, expected?: {
  roleHandle?: string;
  role?: RoleKind;
}): {
  handle: string;
  role: RoleKind;
  row: Record<string, unknown>;
} {
  const row = object(value);
  const handle = roleHandle(row.roleHandle);
  if (expected?.roleHandle && handle !== expected.roleHandle.toLowerCase()) throw new PublicApiError('invalid');
  const role = roleKind(row.role);
  if (expected?.role && role !== expected.role) throw new PublicApiError('invalid');
  if (row.countScope !== 'confirmed_history') throw new PublicApiError('invalid');
  if (row.historyMayBeIncomplete !== true) throw new PublicApiError('invalid');
  if (row.availability !== 'available' && row.availability !== 'unavailable') throw new PublicApiError('invalid');
  if (!(row.subjectDisplayName === null || text(row.subjectDisplayName) && row.subjectDisplayName.length > 0 && row.subjectDisplayName.length <= 200)) {
    throw new PublicApiError('invalid');
  }
  if (!(row.heldGamesCount === null || typeof row.heldGamesCount === 'number' && Number.isInteger(row.heldGamesCount) && row.heldGamesCount >= 0 && row.heldGamesCount <= 2147483647)) {
    throw new PublicApiError('invalid');
  }
  if (!text(row.projectionVersion) || !row.projectionVersion || row.projectionVersion.length > 128) {
    throw new PublicApiError('invalid');
  }
  if (!Array.isArray(row.items)) throw new PublicApiError('invalid');
  if (row.items.length > 50) throw new PublicApiError('invalid');
  if (row.availability === 'unavailable' && row.items.length > 0) throw new PublicApiError('invalid');
  return { handle, role, row };
}

/** Closed parser for public role-reputation summaries — never invents zero history from null. */
export function parseRoleReputationSummary(value: unknown, expected?: {
  roleHandle?: string;
  role?: RoleKind;
}): RoleReputationSummary {
  const { handle, role, row } = parseSummaryShell(value, expected);
  const items = row.availability === 'available'
    ? (row.items as unknown[]).map(item => parseItem(item, role))
    : [];
  return {
    roleHandle: handle,
    role,
    subjectDisplayName: row.subjectDisplayName as string | null,
    heldGamesCount: row.heldGamesCount as number | null,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: nonNegInt(row.publishedReviewCount),
    projectionVersion: row.projectionVersion as string,
    items,
    nextCursor: cursor(row.nextCursor),
    availability: row.availability as RoleAvailability,
  };
}

/**
 * Signed-in by-handle page — requires typed allowedActions + subjectOwnReply on every item.
 * Never used for anonymous PublicApi lanes; denial must not fall back to guest parse.
 */
export function parseActorAwareRoleReputationSummary(value: unknown, expected?: {
  roleHandle?: string;
  role?: RoleKind;
}): ActorAwareRoleReputationSummary {
  const { handle, role, row } = parseSummaryShell(value, expected);
  const items = row.availability === 'available'
    ? (row.items as unknown[]).map(item => parseActorAwareItem(item, role))
    : [];
  return {
    roleHandle: handle,
    role,
    subjectDisplayName: row.subjectDisplayName as string | null,
    heldGamesCount: row.heldGamesCount as number | null,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: nonNegInt(row.publishedReviewCount),
    projectionVersion: row.projectionVersion as string,
    items,
    nextCursor: cursor(row.nextCursor),
    availability: row.availability as RoleAvailability,
  };
}

export function gameRoleReputationPath(gameId: string, role: RoleKind): string {
  if (!isVenueId(gameId)) throw new PublicApiError('invalid');
  if (role !== 'organization' && role !== 'training') throw new PublicApiError('invalid');
  return `/games/${encodeURIComponent(gameId)}/role-reputations/${role}`;
}

export function roleReputationPath(
  roleHandleValue: string,
  query: { gameId: string; cursor?: string; limit?: number },
): string {
  const handle = roleHandle(roleHandleValue);
  if (!isVenueId(query.gameId)) throw new PublicApiError('invalid');
  if (query.cursor !== undefined && (!query.cursor || query.cursor.length > 4096)) {
    throw new PublicApiError('invalid');
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)) {
    throw new PublicApiError('invalid');
  }
  const params = new URLSearchParams({ gameId: query.gameId });
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  return `/role-reputations/${encodeURIComponent(handle)}?${params}`;
}

/**
 * Actor-aware by-handle path for signed-in reader sheet.
 * Game origin requires real gameId; profile origin omits gameId (never invents one).
 */
export function actorAwareRoleReputationPath(
  roleHandleValue: string,
  query: { gameId?: string; cursor?: string; limit?: number } = {},
): string {
  const handle = roleHandle(roleHandleValue);
  if (query.gameId !== undefined && !isVenueId(query.gameId)) throw new PublicApiError('invalid');
  if (query.cursor !== undefined && (!query.cursor || query.cursor.length > 4096)) {
    throw new PublicApiError('invalid');
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)) {
    throw new PublicApiError('invalid');
  }
  const params = new URLSearchParams();
  if (query.gameId) params.set('gameId', query.gameId);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return `/role-reputations/${encodeURIComponent(handle)}${qs ? `?${qs}` : ''}`;
}

const PUBLIC_PLAYER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function publicPlayerIdValue(value: unknown): string {
  if (!text(value) || !PUBLIC_PLAYER_ID.test(value)) throw new PublicApiError('invalid');
  return value;
}

/** PUBLIC player-profile role path — no gameId; cursor/limit optional. */
export function playerRoleReputationPath(
  publicPlayerId: string,
  role: RoleKind,
  query: { cursor?: string; limit?: number } = {},
): string {
  const id = publicPlayerIdValue(publicPlayerId);
  if (role !== 'organization' && role !== 'training') throw new PublicApiError('invalid');
  if (query.cursor !== undefined && (!query.cursor || query.cursor.length > 4096)) {
    throw new PublicApiError('invalid');
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)) {
    throw new PublicApiError('invalid');
  }
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return `/players/${encodeURIComponent(id)}/role-reputations/${role}${qs ? `?${qs}` : ''}`;
}

function ruForm(count: number, one: string, few: string, many: string): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n100 >= 11 && n100 <= 14) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}

function heldGamesForm(count: number): string {
  return ruForm(count, 'проведённая игра', 'проведённые игры', 'проведённых игр');
}

export function roleTitle(role: RoleKind): string {
  return role === 'organization' ? 'Как организатор' : 'Как тренер';
}

export function roleSectionTitle(role: RoleKind): string {
  return role === 'organization' ? 'Об организации' : 'О тренировках';
}

/**
 * Direct game-details training lane — web parity: only trainer_led with a specified trainer.
 * Discovery expand still uses activityKind alone; do not reuse this for card disclosure.
 */
export function gameDetailWantsTrainingRole(game: {
  activityKind: string;
  trainer: unknown;
}): boolean {
  return game.activityKind === 'trainer_led' && game.trainer != null;
}

/**
 * Author CTA policy for a role lane. Omitted/undefined canWrite keeps Discovery default
 * (gameId + handle enables «Поделиться опытом»). Explicit false is game-details read parity.
 */
export function roleLaneCanAuthor(input: {
  canWrite?: boolean;
  gameId?: string;
  roleHandle?: string | null;
}): boolean {
  return input.canWrite !== false && !!input.gameId && !!input.roleHandle;
}

/** Organization confirmed-history label — null stays null (never invent zero). */
export function heldHistoryLabel(count: number | null, incomplete: boolean): string | null {
  if (count == null) return null;
  const base = count === 0
    ? 'По подтверждённой истории проведённых игр пока нет'
    : `${count} ${heldGamesForm(count)} по подтверждённой истории`;
  return incomplete ? `${base}. История может быть неполной` : base;
}

export function compactHistoryLabel(count: number | null, incomplete: boolean): string | null {
  if (count == null) return null;
  if (count === 0) return heldHistoryLabel(0, incomplete);
  const base = `Подтверждённая история: ${count} ${heldGamesForm(count)}.`;
  return incomplete ? `${base} Может быть неполной.` : base;
}

export function publishedReviewsLabel(count: number): string {
  if (count <= 0) return 'Пока нет опубликованных отзывов по этой роли.';
  const form = ruForm(count, 'опубликованный отзыв', 'опубликованных отзыва', 'опубликованных отзывов');
  return `${count} ${form}. Приватные сообщения и ожидающие тексты сюда не входят.`;
}

export function reviewReplyLabel(role: RoleKind, text: string): string {
  return `Ответ ${role === 'training' ? 'тренера' : 'организатора'}: ${text}`;
}

function emptyLane(role: RoleKind): RoleLaneState {
  return { role, phase: 'idle', summary: null, loadingMore: false, moreError: false };
}

function appendItems(
  previous: PublicRoleReviewItem[],
  next: PublicRoleReviewItem[],
): PublicRoleReviewItem[] {
  const seen = new Set(previous.map(item => item.reviewHandle));
  const merged = [...previous];
  for (const item of next) {
    if (seen.has(item.reviewHandle)) continue;
    seen.add(item.reviewHandle);
    merged.push(item);
  }
  return merged;
}

/**
 * Per-card / profile public role-history owner.
 * Game cards load only after explicit expand; profile binds both lanes immediately.
 * Game/role/peer switches and collapse retire in-flight work so late payloads cannot cross scopes.
 */
export class RoleReputationCoordinator {
  private state: RoleReputationCardState = {
    gameId: null,
    publicPlayerId: null,
    wantTraining: false,
    expanded: false,
    organization: emptyLane('organization'),
    training: emptyLane('training'),
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private serial = 0;
  private reads = new Map<string, number>();
  private controllers = new Map<string, AbortController>();
  private ports: RoleReputationPorts;

  constructor(ports: RoleReputationPorts) {
    this.ports = ports;
  }

  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private show(patch: Partial<RoleReputationCardState> = {}) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
  }

  private laneKey(role: RoleKind) {
    return role === 'organization' ? 'organization' as const : 'training' as const;
  }

  private setLane(role: RoleKind, lane: RoleLaneState) {
    this.show({ [this.laneKey(role)]: lane });
  }

  private retire(key?: string) {
    if (key) {
      this.controllers.get(key)?.abort();
      this.controllers.delete(key);
      this.reads.delete(key);
      return;
    }
    this.epoch += 1;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.reads.clear();
  }

  private ticket(key: string) {
    this.retire(key);
    const serial = ++this.serial;
    const epoch = this.epoch;
    const controller = new AbortController();
    this.reads.set(key, serial);
    this.controllers.set(key, controller);
    return {
      signal: controller.signal,
      alive: () => epoch === this.epoch && this.reads.get(key) === serial,
    };
  }

  /** Bind discovery card identity. Different game clears expanded content immediately. */
  bind(gameId: string, options: { wantTraining: boolean }) {
    if (!isVenueId(gameId)) throw new PublicApiError('invalid');
    if (
      this.state.gameId === gameId
      && this.state.publicPlayerId === null
      && this.state.wantTraining === options.wantTraining
    ) return;
    this.retire();
    this.show({
      gameId,
      publicPlayerId: null,
      wantTraining: options.wantTraining,
      expanded: false,
      organization: emptyLane('organization'),
      training: emptyLane('training'),
    });
  }

  /**
   * Bind public player profile surface — both organization and training lanes load immediately.
   * Peer change clears prior reviews immediately; never invents a gameId.
   */
  bindPlayer(publicPlayerId: string) {
    if (!this.ports.playerRole) throw new PublicApiError('invalid');
    const id = publicPlayerIdValue(publicPlayerId);
    if (this.state.publicPlayerId === id && this.state.gameId === null && this.state.expanded) return;
    this.retire();
    this.show({
      gameId: null,
      publicPlayerId: id,
      wantTraining: true,
      expanded: true,
      organization: emptyLane('organization'),
      training: emptyLane('training'),
    });
    void this.loadRole('organization');
    void this.loadRole('training');
  }

  collapse = () => {
    if (!this.state.expanded && !this.state.publicPlayerId) return;
    this.retire();
    this.show({
      expanded: false,
      publicPlayerId: null,
      organization: emptyLane('organization'),
      training: emptyLane('training'),
    });
  };

  expand = () => {
    if (!this.state.gameId || this.state.publicPlayerId) return;
    if (this.state.expanded) return;
    this.show({ expanded: true });
    void this.loadRole('organization');
    if (this.state.wantTraining) void this.loadRole('training');
  };

  toggle = () => {
    if (this.state.publicPlayerId) return;
    if (this.state.expanded) this.collapse();
    else this.expand();
  };

  retry = (role: RoleKind) => {
    if (!this.state.expanded) return;
    if (role === 'training' && !this.state.wantTraining) return;
    if (!this.state.gameId && !this.state.publicPlayerId) return;
    void this.loadRole(role);
  };

  loadMore = (role: RoleKind) => {
    if (!this.state.expanded) return;
    const lane = this.state[this.laneKey(role)];
    if (lane.phase !== 'ready' || !lane.summary || lane.loadingMore) return;
    if (lane.summary.availability !== 'available' || !lane.summary.nextCursor) return;
    const handle = lane.summary.roleHandle;
    const cursorValue = lane.summary.nextCursor;
    const key = `more:${role}`;
    const { signal, alive } = this.ticket(key);
    this.setLane(role, { ...lane, loadingMore: true, moreError: false });

    if (this.state.publicPlayerId) {
      const publicPlayerId = this.state.publicPlayerId;
      const playerRole = this.ports.playerRole;
      if (!playerRole) {
        this.setLane(role, { ...lane, loadingMore: false, moreError: true });
        return;
      }
      void (async () => {
        try {
          const page = await playerRole(publicPlayerId, role, { cursor: cursorValue, limit: 20 }, signal);
          if (!alive()) return;
          if (this.state.publicPlayerId !== publicPlayerId) return;
          const current = this.state[this.laneKey(role)];
          if (!current.summary || current.summary.roleHandle !== handle) return;
          if (current.summary.nextCursor !== cursorValue) return;
          if (page.roleHandle !== handle || page.role !== role) throw new PublicApiError('invalid');
          if (page.availability !== 'available') {
            this.setLane(role, {
              role, phase: 'unavailable', summary: page, loadingMore: false, moreError: false,
            });
            return;
          }
          this.setLane(role, {
            role,
            phase: 'ready',
            loadingMore: false,
            moreError: false,
            summary: {
              ...page,
              items: appendItems(current.summary.items, page.items),
              nextCursor: page.nextCursor,
            },
          });
        } catch (error: unknown) {
          if (!alive()) return;
          if (this.state.publicPlayerId !== publicPlayerId) return;
          const current = this.state[this.laneKey(role)];
          if (!current.summary || current.summary.roleHandle !== handle) return;
          if (error instanceof PublicApiError && error.kind === 'unavailable') {
            this.setLane(role, {
              role, phase: 'unavailable', summary: null, loadingMore: false, moreError: false,
            });
            return;
          }
          this.setLane(role, {
            ...current,
            phase: 'ready',
            loadingMore: false,
            moreError: true,
          });
        }
      })();
      return;
    }

    const gameId = this.state.gameId;
    if (!gameId) return;
    // Fulfilment throws (e.g. wrong-role page) must not escape .then(success, error) —
    // that path is unhandled and would leave loadingMore stuck true.
    void (async () => {
      try {
        const page = await this.ports.byHandle(handle, { gameId, cursor: cursorValue, limit: 20 }, signal);
        if (!alive()) return;
        if (this.state.gameId !== gameId) return;
        const current = this.state[this.laneKey(role)];
        if (!current.summary || current.summary.roleHandle !== handle) return;
        // Stale page must still target the cursor we requested (retry same page).
        if (current.summary.nextCursor !== cursorValue) return;
        if (page.roleHandle !== handle || page.role !== role) throw new PublicApiError('invalid');
        if (page.availability !== 'available') {
          this.setLane(role, {
            role, phase: 'unavailable', summary: page, loadingMore: false, moreError: false,
          });
          return;
        }
        this.setLane(role, {
          role,
          phase: 'ready',
          loadingMore: false,
          moreError: false,
          summary: {
            ...page,
            items: appendItems(current.summary.items, page.items),
            // Preserve provenance: only the page that matches the requested cursor may advance it.
            nextCursor: page.nextCursor,
          },
        });
      } catch (error: unknown) {
        if (!alive()) return;
        if (this.state.gameId !== gameId) return;
        const current = this.state[this.laneKey(role)];
        if (!current.summary || current.summary.roleHandle !== handle) return;
        if (error instanceof PublicApiError && error.kind === 'unavailable') {
          // Authoritative privacy/unavailable retires public material — do not retain revoked content.
          this.setLane(role, {
            role, phase: 'unavailable', summary: null, loadingMore: false, moreError: false,
          });
          return;
        }
        // Transient/malformed next page: keep accepted summary/items/handle/cursor for page retry.
        this.setLane(role, {
          ...current,
          phase: 'ready',
          loadingMore: false,
          moreError: true,
        });
      }
    })();
  };

  private async loadRole(role: RoleKind) {
    if (!this.state.expanded) return;
    if (role === 'training' && !this.state.wantTraining) return;
    const key = `load:${role}`;
    const { signal, alive } = this.ticket(key);
    this.setLane(role, { role, phase: 'loading', summary: null, loadingMore: false, moreError: false });

    if (this.state.publicPlayerId) {
      const publicPlayerId = this.state.publicPlayerId;
      const playerRole = this.ports.playerRole;
      if (!playerRole) {
        this.setLane(role, { role, phase: 'error', summary: null, loadingMore: false, moreError: false });
        return;
      }
      try {
        const summary = await playerRole(publicPlayerId, role, { limit: 3 }, signal);
        if (!alive() || this.state.publicPlayerId !== publicPlayerId || !this.state.expanded) return;
        if (summary.role !== role) throw new PublicApiError('invalid');
        if (summary.availability !== 'available') {
          this.setLane(role, { role, phase: 'unavailable', summary, loadingMore: false, moreError: false });
          return;
        }
        this.setLane(role, { role, phase: 'ready', summary, loadingMore: false, moreError: false });
      } catch (error) {
        if (!alive() || this.state.publicPlayerId !== publicPlayerId || !this.state.expanded) return;
        if (error instanceof PublicApiError && error.kind === 'unavailable') {
          this.setLane(role, { role, phase: 'unavailable', summary: null, loadingMore: false, moreError: false });
          return;
        }
        this.setLane(role, { role, phase: 'error', summary: null, loadingMore: false, moreError: false });
      }
      return;
    }

    const gameId = this.state.gameId;
    if (!gameId) return;
    try {
      const summary = await this.ports.gameRole(gameId, role, signal);
      if (!alive() || this.state.gameId !== gameId || !this.state.expanded) return;
      if (summary.role !== role) throw new PublicApiError('invalid');
      if (summary.availability !== 'available') {
        this.setLane(role, { role, phase: 'unavailable', summary, loadingMore: false, moreError: false });
        return;
      }
      this.setLane(role, { role, phase: 'ready', summary, loadingMore: false, moreError: false });
    } catch (error) {
      if (!alive() || this.state.gameId !== gameId || !this.state.expanded) return;
      if (error instanceof PublicApiError && error.kind === 'unavailable') {
        this.setLane(role, { role, phase: 'unavailable', summary: null, loadingMore: false, moreError: false });
        return;
      }
      this.setLane(role, { role, phase: 'error', summary: null, loadingMore: false, moreError: false });
    }
  }
}
