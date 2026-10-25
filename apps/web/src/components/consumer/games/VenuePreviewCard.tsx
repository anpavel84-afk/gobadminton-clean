"use client";
import type { ReactNode } from "react";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { nearestGameLabel, venueGameCount } from "../../../lib/venue-popup";
import { VenueCover } from "../venues/VenueCover";
import "../../../styles/venue-popup.css";

export function VenuePreviewCard({ venue, games, gamesReady, now, onOpen, embedded = false, coverSlot }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number; onOpen: () => void; embedded?: boolean; coverSlot?: ReactNode;
}) {
  return <div className="gb-venue-preview" role="region" aria-label="Выбранная площадка">
    {!embedded && <button type="button" className="gb-venue-handle" aria-label="Развернуть площадку" onClick={onOpen}><span /></button>}
    <button type="button" className="gb-venue-preview-button" aria-label={`Открыть площадку ${venue.name}`} onClick={onOpen}>
      {coverSlot ?? <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-preview-cover" />}
      <span className="gb-venue-preview-copy">
        <strong>{venue.name}</strong><span className="gb-venue-preview-address">{venue.address}</span>
        <span className="gb-venue-preview-time">{gamesReady ? nearestGameLabel(games, venue.timezone, now) : "Расписание временно недоступно"}</span>
      <span className="gb-venue-preview-count">{gamesReady && games.length > 0 ? venueGameCount(games.length) : "\u00a0"}</span>
      </span>
      <span className="gb-venue-preview-arrow" aria-hidden="true">↑</span>
    </button>
  </div>;
}
