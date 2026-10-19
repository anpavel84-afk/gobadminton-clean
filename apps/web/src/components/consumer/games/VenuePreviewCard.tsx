"use client";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { nearestGameLabel } from "../../../lib/venue-popup";
import { VenueCover } from "../venues/VenueCover";
import "../../../styles/venue-popup.css";

export function VenuePreviewCard({ venue, games, gamesReady, now, onOpen }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number; onOpen: () => void;
}) {
  return <div className="gb-venue-preview" role="region" aria-label="Выбранная площадка">
    <button type="button" className="gb-venue-preview-button" aria-label={`Открыть площадку ${venue.name}`} onClick={onOpen}>
      <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-preview-cover" />
      <span className="gb-venue-preview-copy">
        <strong>{venue.name}</strong><span className="gb-venue-preview-address">{venue.address}</span>
        <span className="gb-venue-preview-time">{gamesReady ? nearestGameLabel(games, venue.timezone, now) : "Расписание временно недоступно"}</span>
      </span>
      <span className="gb-venue-preview-arrow" aria-hidden="true">→</span>
    </button>
  </div>;
}
