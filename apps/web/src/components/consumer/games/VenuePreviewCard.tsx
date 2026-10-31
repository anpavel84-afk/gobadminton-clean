"use client";
import type { ReactNode } from "react";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { nearestGameLabel, venueGameCount } from "../../../lib/venue-popup";
import { VenueCover } from "../venues/VenueCover";
import { VenueGallery, type GalleryItem } from "../venues/VenueGallery";
import "../../../styles/venue-popup.css";

export function VenuePreviewCard({ venue, games, gamesReady, now, onOpen, embedded = false, coverSlot, galleryIndex, onGalleryIndexChange }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number; onOpen: () => void; embedded?: boolean; coverSlot?: ReactNode;
  galleryIndex?: number;
  onGalleryIndexChange?: (index: number, item: GalleryItem | null) => void;
}) {
  // Cover/media stay presentational inside the single row button — no nested interactive controls.
  // Morph slot still goes through VenueGallery so ordered gallery + main-at-nonzero stay coherent.
  const multi = (venue.profile?.gallery?.items?.length ?? 0) > 1;
  const media = coverSlot || multi
    ? <VenueGallery
        venue={venue}
        size="compact"
        showCredit={false}
        coverSlot={coverSlot}
        className="gb-venue-preview-cover"
        index={galleryIndex}
        onIndexChange={onGalleryIndexChange}
      />
    : <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-preview-cover" />;
  return <div className="gb-venue-preview" role="region" aria-label="Выбранная площадка">
    {!embedded && <button type="button" className="gb-venue-handle" aria-label="Развернуть площадку" onClick={onOpen}><span /></button>}
    <button type="button" className="gb-venue-preview-button" aria-label={`Открыть площадку ${venue.name}`} onClick={onOpen}>
      {media}
      <span className="gb-venue-preview-copy">
        <strong>{venue.name}</strong><span className="gb-venue-preview-address">{venue.address}</span>
        <span className="gb-venue-preview-time">{gamesReady ? nearestGameLabel(games, venue.timezone, now) : "Расписание временно недоступно"}</span>
      <span className="gb-venue-preview-count">{gamesReady && games.length > 0 ? venueGameCount(games.length) : "\u00a0"}</span>
      </span>
      <span className="gb-venue-preview-arrow" aria-hidden="true">↑</span>
    </button>
  </div>;
}
