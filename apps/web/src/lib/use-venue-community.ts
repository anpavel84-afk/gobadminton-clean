"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCommunitySummaries,
  subscribeCommunitySummaryInvalidation,
  type CommunityRatingSummary,
} from "./venue-community-api";

export type CommunitySummaryLoadState = "idle" | "loading" | "ready" | "error";

/** Dedupe venue IDs preserving first-seen order; hard cap 200 (batch contract). */
export function stableVenueCommunityIds(venueIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of venueIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 200) break;
  }
  return out;
}

function indexSummaries(
  items: CommunityRatingSummary[],
  requestedIds: readonly string[],
): Record<string, CommunityRatingSummary> {
  const next: Record<string, CommunityRatingSummary> = {};
  for (const item of items) {
    next[item.venueId] = item;
    if (item.canonicalVenueId && requestedIds.includes(item.canonicalVenueId)) {
      next[item.canonicalVenueId] = {
        ...item,
        venueId: item.canonicalVenueId,
      };
    }
  }
  return next;
}

/**
 * Batch public community summaries for currently loaded venue IDs.
 * One coalesced ≤200-id request; invalidation refreshes canonical + alias peers.
 * No own-vote / actor / CSRF in this hook.
 */
export function useVenueCommunitySummaries(venueIds: readonly string[]) {
  // Content key — ignore caller array identity so map().map() parents do not loop.
  const key = stableVenueCommunityIds(venueIds).join(",");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);
  const [map, setMap] = useState<Record<string, CommunityRatingSummary>>({});
  const [state, setState] = useState<CommunitySummaryLoadState>("idle");
  const generation = useRef(0);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const mapRef = useRef(map);
  mapRef.current = map;
  const refreshAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const gen = ++generation.current;
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = null;
    // Identity change: drop prior venue rows immediately (no stale card flash).
    setMap({});
    if (!key) {
      setState("idle");
      return;
    }
    setState("loading");
    const controller = new AbortController();
    const currentIds = key.split(",");

    void fetchCommunitySummaries(currentIds, controller.signal)
      .then((page) => {
        if (gen !== generation.current) return;
        setMap(indexSummaries(page.items, currentIds));
        setState("ready");
      })
      .catch((error: unknown) => {
        if (gen !== generation.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });

    const unsubscribe = subscribeCommunitySummaryInvalidation((touched) => {
      if (gen !== generation.current) return;
      const live = idsRef.current;
      if (live.length === 0) return;
      const liveCanonicals = new Set<string>();
      for (const id of live) {
        const row = mapRef.current[id];
        if (row?.canonicalVenueId) liveCanonicals.add(row.canonicalVenueId);
      }
      const hit = touched.some((id) => live.includes(id) || liveCanonicals.has(id));
      if (!hit) return;

      refreshAbortRef.current?.abort();
      const refreshController = new AbortController();
      refreshAbortRef.current = refreshController;
      const refreshGen = ++generation.current;
      setState("loading");
      void fetchCommunitySummaries(live, refreshController.signal)
        .then((page) => {
          if (refreshGen !== generation.current) return;
          setMap(indexSummaries(page.items, live));
          setState("ready");
        })
        .catch((error: unknown) => {
          if (refreshGen !== generation.current) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setState("error");
        });
    });

    return () => {
      controller.abort();
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
      unsubscribe();
    };
  }, [key]);

  return { summaries: map, state, ids };
}
