"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { Me } from "../../../lib/consumer-types";
import { VenueCommunityRating } from "./VenueCommunityRating";
import { CommentsSection } from "../comments/CommentsSection";
import { VenueReviewsPanel } from "./VenueReviewsPanel";
import { VenueCommunityPhotos } from "./VenueCommunityPhotos";
import { VenueCommunityPhotoViewer } from "./VenueCommunityPhotoViewer";
import { useVenueCommunityPhotos } from "./useVenueCommunityPhotos";
import { SurfacePanel } from "../Surfaces";
import "../../../styles/venue-community.css";

export type VenueCommunitySection = "ratings" | "discussion" | "reviews" | "photos";

/** One mounted owner for the selected physical venue, independent of host density. */
export function VenueCommunityContent({ venueId, me, authReturnPath, embedded = false, section = null,
  onUnresolvedChange,
}: {
  venueId: string; me: Me | null; authReturnPath: string; embedded?: boolean;
  section?: VenueCommunitySection | null;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const gallery = useVenueCommunityPhotos(venueId, me?.id ?? null, me?.csrfToken ?? null);
  const prefix = useId();
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef({ ratings: false, discussion: false, ratingReport: false, commentReport: false, reviews: false });
  const signal = useCallback((kind: keyof typeof pending.current, value: boolean) => {
    pending.current[kind] = value;
    onUnresolvedChange?.(Object.values(pending.current).some(Boolean));
  }, [onUnresolvedChange]);
  const ratingPending = useCallback((value: boolean) => signal("ratings", value), [signal]);
  const discussionPending = useCallback((value: boolean) => signal("discussion", value), [signal]);
  const ratingReportPending = useCallback((value: boolean) => signal("ratingReport", value), [signal]);
  const commentReportPending = useCallback((value: boolean) => signal("commentReport", value), [signal]);
  const reviewPending = useCallback((value: boolean) => signal("reviews", value), [signal]);
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
  const [returnBase = ""] = authReturnPath.split("#");
  return <div ref={root} className={`gb-venue-community${embedded ? " gb-venue-community--embedded" : ""}`} data-venue-community={venueId}>
    <div data-community-section="ratings" tabIndex={-1}>
      <VenueCommunityRating venueId={venueId} sectionId={id("ratings")} signedIn={Boolean(me?.id && me.csrfToken)}
        actorId={me?.id ?? null} csrfToken={me?.csrfToken ?? null} authReturnPath={returnBase} onUnresolvedChange={ratingPending} onReportUnresolvedChange={ratingReportPending} />
    </div>
    <div data-community-section="discussion" tabIndex={-1}>
      <CommentsSection kind="venue" entityId={venueId} me={me} title="Обсуждение площадки"
        description="Вопросы и впечатления о площадке · не проверенные отзывы после игры"
        sourceComment={gallery.source} onOpenPhoto={gallery.open} onPublished={gallery.restart}
        authReturnPath={`${returnBase}#discussion`} parentPublic sectionId={id("discussion")} onUnresolvedChange={discussionPending} onReportUnresolvedChange={commentReportPending} />
    </div>
    <SurfacePanel tone="bordered" aria-label="Отзывы после игры" id={id("reviews")} data-community-section="reviews" tabIndex={-1}>
      <VenueReviewsPanel venueId={venueId} embedded={embedded} actorId={me?.id ?? null} onUnresolvedChange={reviewPending} csrfToken={me?.csrfToken ?? null}
        canWrite={Boolean(me?.id && me.csrfToken)} onLogin={() => { window.location.href = `/auth?returnTo=${encodeURIComponent(`${returnBase}#reviews`)}`; }} />
    </SurfacePanel>
    <VenueCommunityPhotos model={gallery} sectionId={id("photos")} />
    {gallery.selected ? <VenueCommunityPhotoViewer model={gallery} /> : null}
  </div>;
}
