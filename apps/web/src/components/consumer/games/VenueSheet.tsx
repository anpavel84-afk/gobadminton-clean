"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { venueDays, venueDayLabel } from "../../../lib/venue-popup";
import { formatSeats } from "../../../lib/game-presentation";
import { VenueCover } from "../venues/VenueCover";
import { Avatar } from "../players/ProfileComposition";
import { GameHero, GameTerms } from "./GameDetailComposition";
import "../../../styles/venue-popup.css";

export function VenueSheet({ venue, games, gamesReady, now, onCollapse, onDeselect, onSwipe }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number;
  onCollapse: () => void; onDeselect: () => void; onSwipe?: () => void;
}) {
  const [view, setView] = useState<"info" | "schedule" | "game">("info");
  const [selectedDate, setSelectedDate] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const days = venueDays(gamesReady ? games : [], venue.timezone);
  const day = days.find(item => item.date === selectedDate) ?? days[0];
  const game = gamesReady ? games.find(item => item.id === gameId) : undefined;
  // Render invalidation immediately; effects also clear the old selection permanently.
  const currentView = !gamesReady || !days.length ? "info" : view === "game" && !game ? "schedule" : view;
  useEffect(() => {
    if (!gamesReady || !days.length) { setView("info"); setGameId(null); }
    else if (view === "game" && !game) { setView("schedule"); setGameId(null); }
    if (selectedDate !== day?.date) setSelectedDate(day?.date ?? "");
  }, [gamesReady, days.length, day?.date, selectedDate, view, game]);
  const label = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const collapse = useRef(onCollapse); collapse.current = onCollapse;
  useEffect(() => {
    const initiator = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse.current(); }
      if (event.key !== "Tab") return;
      const targets = [...panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') ?? []];
      const first = targets[0]; const last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true); document.body.style.overflow = overflow;
      if (initiator instanceof HTMLElement && initiator.isConnected) initiator.focus();
      else document.querySelector<HTMLButtonElement>('.gb-venue-preview-button')?.focus();
    };
  }, []);
  const gesture = useRef<{ x: number; y: number; id: number } | null>(null);
  const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: venue.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return <>
    <div className="gb-venue-sheet-backdrop" onClick={onDeselect} />
    <div ref={panel} className="gb-venue-sheet" role="dialog" aria-modal="true" aria-labelledby={label}
      onPointerDown={event => {
        gesture.current = null;
        if (event.target instanceof Element && event.target.closest(".gb-venue-handle") && panel.current?.scrollTop === 0) {
          gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => { gesture.current = null; }}
      onPointerUp={event => {
        const origin = gesture.current; gesture.current = null;
        if (origin && origin.id === event.pointerId && event.clientY - origin.y > 80 && Math.abs(event.clientY - origin.y) > Math.abs(event.clientX - origin.x) && panel.current?.scrollTop === 0) {
          onSwipe?.(); onCollapse();
        }
      }}>
      <div className="gb-venue-handle" data-venue-handle="true"><span /></div>
      <header className="gb-venue-sheet-header">
        {currentView !== "info" && <button type="button" aria-label={currentView === "game" ? "К расписанию" : "К информации о площадке"} onClick={() => setView(currentView === "game" ? "schedule" : "info")}>←</button>}
        <h2 id={label}>{venue.name}</h2>
        <button ref={close} className="gb-venue-sheet-close" type="button" aria-label="Закрыть" onClick={onCollapse}>×</button>
      </header>
      {currentView === "info" ? <div className="gb-venue-sheet-info">
        <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-sheet-cover" />
        <h3>{venue.name}</h3><p>{venue.address}</p>
        {!gamesReady && <p role="status">Расписание временно недоступно</p>}
        {gamesReady && days.length > 0 && <button type="button" className="gb-venue-sheet-primary" onClick={() => setView("schedule")}>Показать игры на этой площадке</button>}
      </div> : currentView === "game" && game ? <div className="gb-venue-sheet-detail"><GameHero game={game} /><GameTerms game={game} onVenueClick={() => setView("info")} /></div>
        : <div><h3>Игры на этой площадке</h3>
          <div className="gb-venue-sheet-dates" aria-label="Даты игр">{days.map(item => {
            const first = item.games[0]; if (!first) return null;
            return <button type="button" key={item.date} aria-pressed={item.date === day?.date} onClick={() => setSelectedDate(item.date)}>
              <span>{venueDayLabel(item.date, venue.timezone, now, first.startsAt)}</span>
              <span>{new Intl.DateTimeFormat("ru-RU", { timeZone: venue.timezone, day: "numeric", month: "short" }).format(new Date(first.startsAt))}</span>
            </button>;
          })}</div>
          {day?.games.map(item => <button type="button" className="gb-venue-sheet-game" key={item.id} onClick={() => { setGameId(item.id); setView("game"); }}>
            <span>{time(item.startsAt)}–{time(item.endsAt)}</span><span><strong>{item.title}</strong>
              {item.levelRule.allowedLevelIds.length > 0 && <span>{item.levelRule.allowedLevelIds.join(", ")}</span>}
              <small>Организатор</small><span className="gb-game-identity"><Avatar name={item.organizer.displayName} avatar={item.organizer.avatar} className="gb-discovery-avatar" />{item.organizer.displayName}</span>
              <span className="gb-venue-sheet-count">{formatSeats(item)}</span></span>
          </button>)}
        </div>}
    </div>
  </>;
}
