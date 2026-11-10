"use client";
import type { VenueCommunitySection } from "../venues/VenueCommunityContent";
import type { ReactNode } from "react";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { nearestGameLabel, venueGameCount } from "../../../lib/venue-popup";
import { VenueCover, venueCoverUrl } from "../venues/VenueCover";
import { VenueGallery, type GalleryItem } from "../venues/VenueGallery";
import { VenueSourceCredit, safeCatalogSource } from "../venues/VenueSourceCredit";
import { VenueCommunityRating } from "../venues/VenueCommunityRating";
import type { CommunityRatingSummary } from "../../../lib/venue-community-api";
import "../../../styles/venue-popup.css";

export function VenuePreviewCard({ venue, games, gamesReady, now, onOpen, embedded = false, coverSlot, coverFallback = false, coverReady = false, onCoverRetry, galleryIndex, onGalleryIndexChange, communitySummary = null, communitySummaryState, showCommunityRating = true, onCommunityOpen: _onCommunityOpen }: {
  /** Retained for map caller compatibility; compact community jump strip is removed (Owner R3.1). */
  onCommunityOpen?: (section: VenueCommunitySection) => void;
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number; onOpen: () => void; embedded?: boolean; coverSlot?: ReactNode;
  coverFallback?: boolean;
  /** Shared SelectedVenueCover.ready — morph slot loan is not decoded readiness. */
  coverReady?: boolean;
  /** Shared SelectedVenueCover.retry for morph main-loan failure (expanded sheet owns the visible control). */
  onCoverRetry?: () => void;
  galleryIndex?: number;
  onGalleryIndexChange?: (index: number, item: GalleryItem | null) => void;
  /** Parent-batched public summary — no per-card N+1. */
  communitySummary?: CommunityRatingSummary | null;
  communitySummaryState?: "idle" | "loading" | "ready" | "error";
  /** False when expanded sheet already shows the same summary (no nested double render). */
  showCommunityRating?: boolean;
}) {
  // Cover/media stay presentational inside the single row button — no nested interactive controls.
  // Morph slot still goes through VenueGallery so ordered gallery + main-at-nonzero stay coherent.
  // Source credit is a sibling footer outside the 64px/minmax(0,1fr)/44px row button (not a 4th grid child).
  const multi = (venue.profile?.gallery?.items?.length ?? 0) > 1;
  const galleryCount = venue.profile?.gallery?.items?.length ?? 0;
  const catalogSource = venue.profile?.catalogSource;
  const hasSource = Boolean(safeCatalogSource(catalogSource));
  // Default illustration label sits in the copy column — not a 4th grid child / nested control.
  const showDefaultIllustrationLabel = !venueCoverUrl(venue.cover?.uploadedUrl) && galleryCount === 0;
  const media = coverSlot || multi
    ? <VenueGallery
        venue={venue}
        size="compact"
        showCredit={false}
        showSourceCredit={false}
        coverSlot={coverSlot}
        coverFallback={coverFallback}
        coverReady={coverReady}
        onCoverRetry={onCoverRetry}
        className="gb-venue-preview-cover"
        index={galleryIndex}
        onIndexChange={onGalleryIndexChange}
      />
    : <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-preview-cover" venueId={venue.id} />;
  return <div
    className="gb-venue-preview"
    data-has-source={hasSource ? "true" : undefined}
    role="region"
    aria-label="Выбранная площадка"
  >
    {!embedded && <button type="button" className="gb-venue-handle" aria-label="Развернуть площадку" onClick={onOpen}><span /></button>}
    <button type="button" className="gb-venue-preview-button" aria-label={`Открыть площадку ${venue.name}`} onClick={onOpen}>
      {media}
      <span className="gb-venue-preview-copy">
        <strong>{venue.name}</strong><span className="gb-venue-preview-address">{venue.address}</span>
        {showDefaultIllustrationLabel
          ? <span className="gb-venue-illustration-label">Иллюстрация</span>
          : null}
        {showCommunityRating ? (
          <VenueCommunityRating
            venueId={venue.id}
            variant="compact"
            signedIn={false}
            csrfToken={null}
            authReturnPath={`/venues/${venue.id}`}
            summary={communitySummary}
            summaryLoadState={communitySummaryState}
            linkToRatings={false}
          />
        ) : null}
        <span className="gb-venue-preview-time">{gamesReady ? nearestGameLabel(games, venue.timezone, now) : "Расписание временно недоступно"}</span>
      <span className="gb-venue-preview-count">{gamesReady && games.length > 0 ? venueGameCount(games.length) : "\u00a0"}</span>
      </span>
      <span className="gb-venue-preview-arrow" aria-hidden="true">↑</span>
    </button>
    {hasSource ? (
      <div className="gb-venue-preview-source">
        <VenueSourceCredit catalogSource={catalogSource} variant="compactPrimary" />
      </div>
    ) : null}
  </div>;
}
