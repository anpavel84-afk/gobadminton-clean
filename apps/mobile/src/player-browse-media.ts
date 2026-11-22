import type { PublicPlayer } from './players.ts';
import { playerMediaUrl } from './media.ts';

/** Same finite ahead window as accepted WEB `browseMediaNeighborhood` (+ previous). */
export const NATIVE_BROWSE_MEDIA_AHEAD = 4;
/** Hard union cap: current + up to 4 ahead + previous. */
export const NATIVE_BROWSE_MEDIA_CAP = NATIVE_BROWSE_MEDIA_AHEAD + 2;
/**
 * Hard cap on concurrently started native Image.prefetch work units.
 * Prefetch promises cannot be cancelled once handed to the OS; aborting local
 * entries only fences UI. Already-started work counts until it actually settles.
 */
export const NATIVE_BROWSE_PREFETCH_INFLIGHT_CAP = NATIVE_BROWSE_MEDIA_CAP;

export type BrowseMediaPrefetch = (url: string) => Promise<boolean>;

export type BrowseMediaScope = {
  episode: number;
  actorId: string | null;
  sessionId: string | null;
  generation: number;
  filterKey: string;
  focused: boolean;
  foreground: boolean;
};

export type BrowsePeerMediaUrls = {
  peerId: string;
  mediaKey: string;
  cover: string | null;
  avatars: string[];
};

/**
 * Tinder browse window: previous + current + next 4 (max 6), deduped.
 * Priority order: current, then ahead peers, then previous — so prep/eviction
 * never starves the visible/next cards for far-behind work.
 */
export function browseMediaNeighborhood(index: number, length: number): number[] {
  if (length <= 0 || index < 0 || index >= length) return [];
  const out: number[] = [];
  const push = (i: number) => {
    if (i >= 0 && i < length && !out.includes(i)) out.push(i);
  };
  push(index);
  for (let ahead = 1; ahead <= NATIVE_BROWSE_MEDIA_AHEAD; ahead += 1) push(index + ahead);
  push(index - 1);
  return out;
}

/** Media identity for fence/dedupe; same publicPlayerId with new URLs must not reuse prep. */
export function browsePeerMediaKey(player: PublicPlayer): string {
  const uploaded = player.avatar?.uploadedUrl ?? '';
  const provider = player.avatar?.providerUrl ?? '';
  const cover = player.cover && 'uploadedUrl' in player.cover
    ? `c:${player.cover.uploadedUrl ?? 'null'}`
    : 'c:missing';
  return `${player.publicPlayerId}|a:${uploaded}|p:${provider}|${cover}`;
}

/**
 * Authorized media already present on the loaded peer DTO only.
 * Reuses `playerMediaUrl` — no speculative profile GET or foreign hosts.
 */
export function browsePeerMediaUrls(player: PublicPlayer): BrowsePeerMediaUrls {
  const cover = playerMediaUrl(player.cover?.uploadedUrl, 'cover');
  const avatars = [player.avatar?.uploadedUrl, player.avatar?.providerUrl]
    .map(url => playerMediaUrl(url, 'avatar'))
    .filter((url): url is string => url !== null);
  return {
    peerId: player.publicPlayerId,
    mediaKey: browsePeerMediaKey(player),
    cover,
    avatars: [...new Set(avatars)],
  };
}

export function browseMediaScopeKey(scope: BrowseMediaScope): string {
  return JSON.stringify([
    scope.episode,
    scope.actorId,
    scope.sessionId,
    scope.generation,
    scope.filterKey,
    scope.focused,
    scope.foreground,
  ]);
}

type WarmEntry = {
  mediaKey: string;
  controller: AbortController;
  status: 'loading' | 'ready' | 'error';
};

type PendingWarm = {
  peerId: string;
  urls: BrowsePeerMediaUrls;
};

function scopeAllowsWarm(scope: BrowseMediaScope): boolean {
  return scope.focused && scope.foreground;
}

/**
 * Bounded native swipe media warmup owner.
 * Prefetch only — never blocks gestures/commands and never commits pixels into the visible card.
 * Platform Image.prefetch cannot be revoked; generation/abort fences ignore stale resolves.
 * Concurrent native work is capped; obsolete queued targets are dropped and never started on settle.
 */
export class BrowseMediaWarmup {
  private readonly prefetch: BrowseMediaPrefetch;
  private readonly entries = new Map<string, WarmEntry>();
  private readonly wanted = new Map<string, BrowsePeerMediaUrls>();
  private pending: PendingWarm[] = [];
  private scopeKey = '';
  private serial = 0;
  /** Peer warms started but not fully settled (includes aborted ghosts still awaiting native settle). */
  private activeWork = 0;
  /** Actual native prefetch() calls started and not yet settled. */
  private unsettledPrefetch = 0;

  constructor(prefetch: BrowseMediaPrefetch) {
    this.prefetch = prefetch;
  }

  /** Test/observability: peer ids currently retained (loading or ready). */
  occupancy(): { retained: string[]; loading: string[] } {
    const retained: string[] = [];
    const loading: string[] = [];
    for (const [id, entry] of this.entries) {
      retained.push(id);
      if (entry.status === 'loading') loading.push(id);
    }
    return { retained, loading };
  }

  /** Actual started-unsettled native prefetch calls (honest; cannot retract OS work). */
  realInflight(): number {
    return this.unsettledPrefetch;
  }

  /** Peer warms still settling, including aborted ghosts that hold a cap slot. */
  activeWarmCount(): number {
    return this.activeWork;
  }

  /** Queued peer ids waiting for an inflight slot (latest window only). */
  pendingPeerIds(): string[] {
    return this.pending.map(item => item.peerId);
  }

  retire(): void {
    this.clearLocalState();
    this.scopeKey = '';
  }

  /**
   * Sync the finite neighborhood for the current browse episode.
   * Dropped peers are aborted locally; mediaKey mismatch restarts; errors stay honest.
   * Already-started native prefetch still counts against the cap until settle.
   */
  sync(players: readonly PublicPlayer[], selectedIndex: number, scope: BrowseMediaScope): void {
    if (!scopeAllowsWarm(scope)) {
      this.retire();
      return;
    }
    const nextScope = browseMediaScopeKey(scope);
    if (nextScope !== this.scopeKey) {
      // Same live owner: clear UI/queue only — do not reset real active native work.
      this.clearLocalState();
      this.scopeKey = nextScope;
    }
    const neighborhood = browseMediaNeighborhood(selectedIndex, players.length);
    this.wanted.clear();
    for (const i of neighborhood) {
      const peer = players[i];
      if (!peer) continue;
      this.wanted.set(peer.publicPlayerId, browsePeerMediaUrls(peer));
    }

    for (const [id, entry] of [...this.entries.entries()]) {
      const next = this.wanted.get(id);
      if (!next || next.mediaKey !== entry.mediaKey) {
        entry.controller.abort();
        this.entries.delete(id);
      }
    }

    while (this.entries.size > NATIVE_BROWSE_MEDIA_CAP) {
      const victim = [...this.entries.keys()].find(id => !this.wanted.has(id));
      if (!victim) break;
      const entry = this.entries.get(victim);
      entry?.controller.abort();
      this.entries.delete(victim);
    }

    // Rebuild latest-window pending in neighborhood priority; drop obsolete queued work.
    this.pending = [];
    for (const i of neighborhood) {
      const peer = players[i];
      if (!peer) continue;
      const urls = this.wanted.get(peer.publicPlayerId);
      if (!urls) continue;
      if (this.entries.has(peer.publicPlayerId)) continue;
      this.pending.push({ peerId: peer.publicPlayerId, urls });
    }
    this.pump();
  }

  /**
   * Drop local entries/queue/wanted. Does not reset activeWork / unsettledPrefetch —
   * native promises already handed to the OS keep their cap slots until settle.
   */
  private clearLocalState(): void {
    this.serial += 1;
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
    this.pending = [];
    this.wanted.clear();
  }

  private stillWanted(item: PendingWarm): boolean {
    const current = this.wanted.get(item.peerId);
    return !!current && current.mediaKey === item.urls.mediaKey;
  }

  private pump(): void {
    while (this.pending.length > 0 && this.activeWork < NATIVE_BROWSE_PREFETCH_INFLIGHT_CAP) {
      const item = this.pending.shift()!;
      if (!this.stillWanted(item)) continue;
      if (this.entries.has(item.peerId)) continue;
      this.begin(item.peerId, item.urls);
    }
  }

  private begin(peerId: string, urls: BrowsePeerMediaUrls): void {
    const controller = new AbortController();
    const serial = this.serial;
    const scopeKey = this.scopeKey;
    this.entries.set(peerId, { mediaKey: urls.mediaKey, controller, status: 'loading' });
    this.activeWork += 1;
    void this.warm(urls, controller.signal)
      .then(status => {
        if (serial !== this.serial || scopeKey !== this.scopeKey) return;
        const entry = this.entries.get(peerId);
        if (!entry || entry.mediaKey !== urls.mediaKey || entry.controller !== controller) return;
        if (controller.signal.aborted) {
          this.entries.delete(peerId);
          return;
        }
        entry.status = status;
      })
      .finally(() => {
        this.activeWork -= 1;
        this.pump();
      });
  }

  private async warm(urls: BrowsePeerMediaUrls, signal: AbortSignal): Promise<'ready' | 'error'> {
    const targets = [...(urls.cover ? [urls.cover] : []), ...urls.avatars];
    if (targets.length === 0) return 'ready';
    let sawError = false;
    for (const url of targets) {
      if (signal.aborted) return 'error';
      this.unsettledPrefetch += 1;
      try {
        const ok = await this.prefetch(url);
        if (signal.aborted) return 'error';
        if (!ok) sawError = true;
      } catch {
        if (signal.aborted) return 'error';
        sawError = true;
      } finally {
        this.unsettledPrefetch -= 1;
      }
    }
    return sawError ? 'error' : 'ready';
  }
}

export function createBrowseMediaWarmup(prefetch: BrowseMediaPrefetch): BrowseMediaWarmup {
  return new BrowseMediaWarmup(prefetch);
}

/**
 * Weak association from a stable root owner (PlayInterestCoordinator) to warmup accounting.
 * Browse route remounts reuse the same instance so unabortable native prefetch counts survive
 * teardown. Direct createBrowseMediaWarmup() stays available for isolated tests (no shared map).
 */
const warmupByStableOwner = new WeakMap<object, BrowseMediaWarmup>();

export function acquireBrowseMediaWarmup(
  stableOwner: object,
  prefetch: BrowseMediaPrefetch,
): BrowseMediaWarmup {
  let existing = warmupByStableOwner.get(stableOwner);
  if (!existing) {
    existing = createBrowseMediaWarmup(prefetch);
    warmupByStableOwner.set(stableOwner, existing);
  }
  return existing;
}
