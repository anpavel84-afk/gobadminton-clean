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

export type RoleLaneState = {
  role: RoleKind;
  phase: RoleLoadPhase;
  summary: RoleReputationSummary | null;
  loadingMore: boolean;
};

export type RoleReputationCardState = {
  gameId: string | null;
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

/** Closed parser for public role-reputation summaries — never invents zero history from null. */
export function parseRoleReputationSummary(value: unknown, expected?: {
  roleHandle?: string;
  role?: RoleKind;
}): RoleReputationSummary {
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
  const items = row.availability === 'available'
    ? row.items.map(item => parseItem(item, role))
    : [];
  if (row.availability === 'unavailable' && row.items.length > 0) throw new PublicApiError('invalid');
  return {
    roleHandle: handle,
    role,
    subjectDisplayName: row.subjectDisplayName as string | null,
    heldGamesCount: row.heldGamesCount as number | null,
    countScope: 'confirmed_history',
    historyMayBeIncomplete: true,
    publishedReviewCount: nonNegInt(row.publishedReviewCount),
    projectionVersion: row.projectionVersion,
    items,
    nextCursor: cursor(row.nextCursor),
    availability: row.availability,
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
  return { role, phase: 'idle', summary: null, loadingMore: false };
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
 * Per-card public role-history owner. Loads only after explicit expand.
 * Game/role switches and collapse retire in-flight work so late payloads cannot cross cards.
 */
export class RoleReputationCoordinator {
  private state: RoleReputationCardState = {
    gameId: null,
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
    if (this.state.gameId === gameId && this.state.wantTraining === options.wantTraining) return;
    this.retire();
    this.show({
      gameId,
      wantTraining: options.wantTraining,
      expanded: false,
      organization: emptyLane('organization'),
      training: emptyLane('training'),
    });
  }

  collapse = () => {
    if (!this.state.expanded) return;
    this.retire();
    this.show({
      expanded: false,
      organization: emptyLane('organization'),
      training: emptyLane('training'),
    });
  };

  expand = () => {
    if (!this.state.gameId) return;
    if (this.state.expanded) return;
    this.show({ expanded: true });
    void this.loadRole('organization');
    if (this.state.wantTraining) void this.loadRole('training');
  };

  toggle = () => {
    if (this.state.expanded) this.collapse();
    else this.expand();
  };

  retry = (role: RoleKind) => {
    if (!this.state.expanded || !this.state.gameId) return;
    if (role === 'training' && !this.state.wantTraining) return;
    void this.loadRole(role);
  };

  loadMore = (role: RoleKind) => {
    if (!this.state.expanded || !this.state.gameId) return;
    const lane = this.state[this.laneKey(role)];
    if (lane.phase !== 'ready' || !lane.summary || lane.loadingMore) return;
    if (lane.summary.availability !== 'available' || !lane.summary.nextCursor) return;
    const gameId = this.state.gameId;
    const handle = lane.summary.roleHandle;
    const cursorValue = lane.summary.nextCursor;
    const key = `more:${role}`;
    const { signal, alive } = this.ticket(key);
    this.setLane(role, { ...lane, loadingMore: true });
    void this.ports.byHandle(handle, { gameId, cursor: cursorValue, limit: 20 }, signal).then(page => {
      if (!alive()) return;
      if (this.state.gameId !== gameId) return;
      const current = this.state[this.laneKey(role)];
      if (!current.summary || current.summary.roleHandle !== handle) return;
      if (page.roleHandle !== handle || page.role !== role) throw new PublicApiError('invalid');
      if (page.availability !== 'available') {
        this.setLane(role, { role, phase: 'unavailable', summary: page, loadingMore: false });
        return;
      }
      this.setLane(role, {
        role,
        phase: 'ready',
        loadingMore: false,
        summary: {
          ...page,
          items: appendItems(current.summary.items, page.items),
          // Preserve provenance: only the page that matches the requested cursor may advance it.
          nextCursor: page.nextCursor,
        },
      });
    }, (error: unknown) => {
      if (!alive()) return;
      if (error instanceof PublicApiError && error.kind === 'unavailable') {
        this.setLane(role, { role, phase: 'unavailable', summary: null, loadingMore: false });
        return;
      }
      const current = this.state[this.laneKey(role)];
      this.setLane(role, { ...current, loadingMore: false });
    });
  };

  private async loadRole(role: RoleKind) {
    const gameId = this.state.gameId;
    if (!gameId || !this.state.expanded) return;
    if (role === 'training' && !this.state.wantTraining) return;
    const key = `load:${role}`;
    const { signal, alive } = this.ticket(key);
    this.setLane(role, { role, phase: 'loading', summary: null, loadingMore: false });
    try {
      const summary = await this.ports.gameRole(gameId, role, signal);
      if (!alive() || this.state.gameId !== gameId || !this.state.expanded) return;
      if (summary.role !== role) throw new PublicApiError('invalid');
      if (summary.availability !== 'available') {
        this.setLane(role, { role, phase: 'unavailable', summary, loadingMore: false });
        return;
      }
      this.setLane(role, { role, phase: 'ready', summary, loadingMore: false });
    } catch (error) {
      if (!alive() || this.state.gameId !== gameId || !this.state.expanded) return;
      if (error instanceof PublicApiError && error.kind === 'unavailable') {
        this.setLane(role, { role, phase: 'unavailable', summary: null, loadingMore: false });
        return;
      }
      this.setLane(role, { role, phase: 'error', summary: null, loadingMore: false });
    }
  }
}
