"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCommunitySummaries,
  type CommunityRatingSummary,
} from "./venue-community-api";

/** Batch community summaries for loaded venue IDs; one request per id set. */
export function useVenueCommunitySummaries(venueIds: readonly string[]) {
  const key = venueIds.filter(Boolean).slice(0, 200).join(",");
  const [map, setMap] = useState<Record<string, CommunityRatingSummary>>({});
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const generation = useRef(0);

  const reload = useCallback(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setMap({});
      setState("idle");
      return;
    }
    const gen = ++generation.current;
    setState("loading");
    const controller = new AbortController();
    void fetchCommunitySummaries(ids, controller.signal)
      .then((page) => {
        if (gen !== generation.current) return;
        const next: Record<string, CommunityRatingSummary> = {};
        for (const item of page.items) next[item.venueId] = item;
        setMap(next);
        setState("ready");
      })
      .catch(() => {
        if (gen !== generation.current) return;
        setState("error");
      });
    return () => controller.abort();
  }, [key]);

  useEffect(() => reload(), [reload]);

  return { summaries: map, state, reload };
}
