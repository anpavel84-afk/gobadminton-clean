"use client";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { nearestGameLabel, venueGameCount } from "../../../lib/venue-popup";
import { VenueCover } from "../venues/VenueCover";
import "../../../styles/venue-popup.css";

export function VenuePreviewCard({ venue, games, gamesReady, now, onOpen, onSwipe }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number; onOpen: () => void; onSwipe?: () => void;
}) {
  let start: { x: number; y: number; id: number } | undefined;
  let suppressClick = false;
  return <div className="gb-venue-preview" role="region" aria-label="Выбранная площадка"
    onClickCapture={event => { if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation(); } }}
    onPointerDown={event => { if (event.target instanceof Element && event.target.closest(".gb-venue-handle")) { start = { x: event.clientX, y: event.clientY, id: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); } }}
    onPointerCancel={() => { start = undefined; }}
    onPointerUp={event => { const origin = start; start = undefined; if (origin && origin.id === event.pointerId && origin.y - event.clientY > 80 && Math.abs(event.clientY - origin.y) > Math.abs(event.clientX - origin.x)) { suppressClick = true; onSwipe?.(); onOpen(); } }}>
    <button type="button" className="gb-venue-handle" aria-label="Развернуть площадку" onClick={onOpen}><span /></button>
    <button type="button" className="gb-venue-preview-button" aria-label={`Открыть площадку ${venue.name}`} onClick={onOpen}>
      <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-preview-cover" />
      <span className="gb-venue-preview-copy">
        <strong>{venue.name}</strong><span className="gb-venue-preview-address">{venue.address}</span>
        <span className="gb-venue-preview-time">{gamesReady ? nearestGameLabel(games, venue.timezone, now) : "Расписание временно недоступно"}</span>
      <span className="gb-venue-preview-count">{gamesReady && games.length > 0 ? venueGameCount(games.length) : "\u00a0"}</span>
      </span>
      <span className="gb-venue-preview-arrow" aria-hidden="true">↑</span>
    </button>
  </div>;
}
