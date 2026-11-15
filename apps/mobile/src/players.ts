/** Current /players public projection; deliberately contains no private contact or friendship data. */
export type PublicPlayer = {
  publicPlayerId: string; displayName: string; cityId: string | null; areaKey: string | null;
  level: { scaleId: string; scaleVersion: number; levelId: string; provenance: 'self_declared' } | null;
  bio: string | null; trainer: boolean; lookingForGame: boolean;
  avatar?: { uploadedUrl: string | null; providerUrl: string | null };
  cover?: { uploadedUrl: string | null }; canRequestContact?: boolean;
};
export type PlayerPage = { items: PublicPlayer[]; nextCursor: string | null };
export type PlayerFilters = { cityId: string | null; name: string; areaKey?: string; looking: boolean; trainer: boolean };
export class PlayersError extends Error {
  readonly kind: 'invalid' | 'unavailable' | 'network' | 'server';
  readonly status?: number;
  constructor(kind: 'invalid' | 'unavailable' | 'network' | 'server', status?: number) { super(kind); this.kind = kind; this.status = status; }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlayersError('invalid');
  return value as Record<string, unknown>;
}
function text(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new PlayersError('invalid');
  return value;
}
export function parsePlayer(value: unknown): PublicPlayer {
  const row = record(value);
  if (!row.publicPlayerId || !row.displayName || typeof row.trainer !== 'boolean' || typeof row.lookingForGame !== 'boolean') throw new PlayersError('invalid');
  let level: PublicPlayer['level'] = null;
  if (row.level !== null) {
    const l = record(row.level);
    if (!Number.isInteger(l.scaleVersion) || l.provenance !== 'self_declared') throw new PlayersError('invalid');
    level = { scaleId: text(l.scaleId)!, scaleVersion: l.scaleVersion as number, levelId: text(l.levelId)!, provenance: 'self_declared' };
  }
  const player: PublicPlayer = { publicPlayerId: text(row.publicPlayerId)!, displayName: text(row.displayName)!,
    cityId: text(row.cityId, true), areaKey: text(row.areaKey, true), bio: text(row.bio, true), level,
    trainer: row.trainer, lookingForGame: row.lookingForGame };
  if (row.avatar != null) {
    const a = record(row.avatar);
    player.avatar = { uploadedUrl: text(a.uploadedUrl, true), providerUrl: text(a.providerUrl, true) };
  }
  if (row.cover != null) player.cover = { uploadedUrl: text(record(row.cover).uploadedUrl, true) };
  if (typeof row.canRequestContact === 'boolean') player.canRequestContact = row.canRequestContact;
  return player;
}
export function parsePlayerPage(value: unknown): PlayerPage {
  const row = record(value);
  if (!Array.isArray(row.items) || !(row.nextCursor === null || typeof row.nextCursor === 'string' && row.nextCursor.length > 0)) throw new PlayersError('invalid');
  return { items: row.items.map(parsePlayer), nextCursor: row.nextCursor as string | null };
}
export function resetPlayerFilters(): PlayerFilters { return { cityId: null, name: '', areaKey: '', looking: false, trainer: false }; }
export function playerFilterKey(f: PlayerFilters): string { return JSON.stringify([f.cityId, f.name.trim(), f.looking, f.trainer, f.areaKey?.trim() ?? '']); }
export function playerQuery(f: PlayerFilters, cursor?: string): string {
  const q = new URLSearchParams({ limit: '20' });
  if (f.cityId) q.set('cityId', f.cityId);
  if (f.name.trim()) q.set('name', f.name.trim());
  if (f.areaKey?.trim()) q.set('areaKey', f.areaKey.trim());
  if (f.looking) q.set('looking', 'true');
  if (f.trainer) q.set('trainer', 'true');
  if (cursor) q.set('cursor', cursor);
  return q.toString();
}
export function appendPlayers(old: PlayerPage, page: PlayerPage): PlayerPage {
  const rows = new Map(old.items.map(p => [p.publicPlayerId, p]));
  page.items.forEach(p => rows.set(p.publicPlayerId, p));
  if (page.nextCursor && page.nextCursor === old.nextCursor) throw new PlayersError('invalid');
  return { items: [...rows.values()], nextCursor: page.nextCursor };
}
type Reader = { list: (filters: PlayerFilters, cursor?: string) => Promise<PlayerPage>; detail: (id: string) => Promise<PublicPlayer> };
type Status = 'idle' | 'loading' | 'ready' | 'error';
export type PlayersSnapshot = {
  scope: string | null;
  list: { key: string; status: Status; data: PlayerPage | null; error: unknown; moreError: unknown; loadingMore: boolean };
  detail: { id: string; status: Status; data: PublicPlayer | null; error: unknown };
};
const empty = (scope: string | null): PlayersSnapshot => ({ scope,
  list: { key: '', status: 'idle', data: null, error: null, moreError: null, loadingMore: false },
  detail: { id: '', status: 'idle', data: null, error: null } });
/** One cache owner, scoped to the auth generation; monotonic requests fence A→B→A and logout. */
export class PlayersCoordinator {
  private snapshot = empty(null);
  private lastFilters: PlayerFilters | null = null;
  private reader: Reader | null = null;
  private generation = 0;
  private listSequence = 0;
  private detailSequence = 0;
  /** Peer IDs removed by authoritative detail 404; cleared on scope change and list-endpoint 404. */
  private unavailablePeerIds = new Set<string>();
  /** In-flight list/page sequences at or below this must drop unavailable peers; newer fresh reads may recover. */
  private unavailableBeforeListSequence = 0;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private show(snapshot: PlayersSnapshot) { this.snapshot = snapshot; this.listeners.forEach(fn => fn()); }
  private clearPeerInvalidation() {
    this.unavailablePeerIds = new Set();
    this.unavailableBeforeListSequence = 0;
  }
  setScope(scope: string | null, reader: Reader | null) {
    if (scope === this.snapshot.scope) return;
    this.lastFilters = null;
    this.clearPeerInvalidation();
    this.generation++; this.reader = reader; this.show(empty(scope));
  }
  /** Drop unavailable peers from responses at/before invalidation; only fresher catalog sequences may recover by authority. Detail success does not clear tombstones. */
  private applyPeerInvalidation(page: PlayerPage, sequence: number): PlayerPage {
    if (this.unavailablePeerIds.size === 0) return page;
    if (sequence > this.unavailableBeforeListSequence) {
      for (const row of page.items) this.unavailablePeerIds.delete(row.publicPlayerId);
      return page;
    }
    return { items: page.items.filter(row => !this.unavailablePeerIds.has(row.publicPlayerId)), nextCursor: page.nextCursor };
  }
  loadList = async (filters: PlayerFilters, cursor?: string) => {
    const reader = this.reader, generation = this.generation, key = playerFilterKey(filters), old = this.snapshot.list;
    if (!reader || (cursor && (old.key !== key || old.data?.nextCursor !== cursor || old.loadingMore || old.status !== 'ready'))) return;
    this.lastFilters = { ...filters };
    const sequence = ++this.listSequence;
    this.show({ ...this.snapshot, list: cursor ? { ...old, loadingMore: true, moreError: null }
      : { key, status: 'loading', data: null, error: null, moreError: null, loadingMore: false } });
    try {
      const page = await reader.list({ ...filters }, cursor);
      if (generation !== this.generation || sequence !== this.listSequence) return;
      // Prefer the live accepted catalog so detail-404 removals are not resurrected from a pre-request capture.
      const baseline = cursor ? this.snapshot.list.data : null;
      const merged = cursor && baseline ? appendPlayers(baseline, page) : page;
      const data = this.applyPeerInvalidation(merged, sequence);
      this.show({ ...this.snapshot, list: { key, status: 'ready', data, error: null, moreError: null, loadingMore: false } });
    } catch (error) {
      if (generation !== this.generation || sequence !== this.listSequence) return;
      if (error instanceof PlayersError && error.status === 404) { this.clearUnavailable(error); return; }
      this.show({ ...this.snapshot, list: cursor ? { ...this.snapshot.list, moreError: error, loadingMore: false }
        : { key, status: 'error', data: null, error, moreError: null, loadingMore: false } });
    }
  };
  loadDetail = async (id: string, safetyReread = false) => {
    const reader = this.reader, generation = this.generation, sequence = ++this.detailSequence;
    if (!reader) return;
    this.show({ ...this.snapshot, detail: { id, status: 'loading', data: null, error: null } });
    try {
      const data = await reader.detail(id);
      if (generation !== this.generation || sequence !== this.detailSequence) return;
      if (data.publicPlayerId !== id) throw new PlayersError('invalid');
      // Fresh detail must not authorize an older captured catalog projection; only a newer list sequence may recover the peer.
      this.show({ ...this.snapshot, detail: { id, status: 'ready', data, error: null } });
    } catch (error) {
      if (generation !== this.generation || sequence !== this.detailSequence) return;
      if (!safetyReread && error instanceof PlayersError && error.status === 404) { this.invalidatePeer(id, error); return; }
      this.show({ ...this.snapshot, detail: { id, status: 'error', data: null, error } });
    }
  };
  rereadSafety = (peer: string) => {
    ++this.listSequence;
    if (this.lastFilters) void this.loadList(this.lastFilters);
    if (this.snapshot.detail.id === peer) void this.loadDetail(peer, true);
  };
  /** Narrow detail-404: drop only that peer from accepted catalog; keep key/rows/cursor/paging and in-flight list sequences. */
  private invalidatePeer(id: string, error: unknown) {
    this.unavailablePeerIds.add(id);
    this.unavailableBeforeListSequence = Math.max(this.unavailableBeforeListSequence, this.listSequence);
    const list = this.snapshot.list;
    const data = list.data
      ? { items: list.data.items.filter(row => row.publicPlayerId !== id), nextCursor: list.data.nextCursor }
      : list.data;
    this.show({
      ...this.snapshot,
      list: { ...list, data },
      detail: { id, status: 'error', data: null, error },
    });
  }
  /** List-endpoint authoritative 404: retire catalog eligibility for the current scope generation. */
  private clearUnavailable(error: unknown) {
    this.generation++; this.listSequence++; this.detailSequence++;
    this.clearPeerInvalidation();
    this.show({ scope: this.snapshot.scope,
      list: { ...this.snapshot.list, status: 'error', data: null, error, moreError: null, loadingMore: false },
      detail: { ...this.snapshot.detail, status: 'error', data: null, error } });
  }
}
