"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { Me } from "../../../lib/consumer-types";
import { VenueCommunityRating } from "./VenueCommunityRating";
import { CommentsSection } from "../comments/CommentsSection";
import { VenueReviewsPanel } from "./VenueReviewsPanel";
import { SurfacePanel } from "../Surfaces";
import "../../../styles/venue-community.css";

export type VenueCommunitySection = "ratings" | "discussion" | "reviews";

/** One mounted owner for the selected physical venue, independent of host density. */
export function VenueCommunityContent({ venueId, me, authReturnPath, embedded = false, section = null,
  onUnresolvedChange,
}: {
  venueId: string; me: Me | null; authReturnPath: string; embedded?: boolean;
  section?: VenueCommunitySection | null;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const prefix = useId();
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef({ ratings: false, discussion: false });
  const ratingPending = useCallback((value: boolean) => {
    pending.current.ratings = value;
    onUnresolvedChange?.(value || pending.current.discussion);
  }, [onUnresolvedChange]);
  const discussionPending = useCallback((value: boolean) => {
    pending.current.discussion = value;
    onUnresolvedChange?.(value || pending.current.ratings);
  }, [onUnresolvedChange]);
  const id = (value: VenueCommunitySection) => embedded ? `${prefix}-${value}` : value;
  useEffect(() => {
    if (!section) return;
    const frame = requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(`[data-community-section="${section}"]`);
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);
  const returnBase = authReturnPath.split("#")[0];
  return <div ref={root} className={`gb-venue-community${embedded ? " gb-venue-community--embedded" : ""}`} data-venue-community={venueId}>
    <div data-community-section="ratings" tabIndex={-1}>
      <VenueCommunityRating venueId={venueId} sectionId={id("ratings")} signedIn={Boolean(me?.id && me.csrfToken)}
        actorId={me?.id ?? null} csrfToken={me?.csrfToken ?? null} authReturnPath={returnBase} onUnresolvedChange={ratingPending} />
    </div>
    <div data-community-section="discussion" tabIndex={-1}>
      <CommentsSection kind="venue" entityId={venueId} me={me} title="Обсуждение площадки"
        description="Вопросы и впечатления о площадке · не проверенные отзывы после игры"
        authReturnPath={`${returnBase}#discussion`} parentPublic sectionId={id("discussion")} onUnresolvedChange={discussionPending} />
    </div>
    <SurfacePanel tone="bordered" aria-label="Отзывы после игры" id={id("reviews")} data-community-section="reviews" tabIndex={-1}>
      <VenueReviewsPanel venueId={venueId} embedded={embedded} csrfToken={me?.csrfToken ?? null}
        canWrite={Boolean(me?.id && me.csrfToken)} onLogin={() => { window.location.href = `/auth?returnTo=${encodeURIComponent(`${returnBase}#reviews`)}`; }} />
    </SurfacePanel>
  </div>;
}
