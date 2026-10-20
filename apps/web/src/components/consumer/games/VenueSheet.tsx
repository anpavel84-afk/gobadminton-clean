"use client";
import Link from "next/link";
import { venueCreatePath } from "../../../lib/games-venue-map";
import { useEffect, useId, useRef, useState } from "react";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { venueDays, venueDayLabel } from "../../../lib/venue-popup";
import { formatSeats } from "../../../lib/game-presentation";
import { VenueCover } from "../venues/VenueCover";
import { Avatar } from "../players/ProfileComposition";
import { GameHero, GameTerms } from "./GameDetailComposition";
import "../../../styles/venue-popup.css";

export function VenueSheet({ venue, games, gamesReady, now, onCollapse, onDeselect, embedded = false, active = true }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number;
  onCollapse: () => void; onDeselect: () => void; embedded?: boolean; active?: boolean;
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
    if (!active) return;
    const initiator = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse.current(); }
      if (event.key !== "Tab") return;
      const boundary = embedded ? panel.current?.closest?.<HTMLElement>(".gb-venue-popup") ?? panel.current : panel.current;
      const targets = [...boundary?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]') ?? []];
      const first = targets[0]; const last = targets.at(-1);
      if (event.shiftKey && (document.activeElement === first || !boundary?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !boundary?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const options = { capture: true };
    window.addEventListener("keydown", keydown, options);
    return () => {
      window.removeEventListener("keydown", keydown, options); document.body.style.overflow = overflow;
      if (initiator instanceof HTMLElement && initiator.isConnected && !initiator.closest?.("[hidden]")) initiator.focus();
      else (document.querySelector<HTMLButtonElement>('.gb-venue-popup .gb-venue-handle') ?? document.querySelector<HTMLButtonElement>('.gb-venue-preview-button'))?.focus();
    };
  }, [active, embedded]);
  const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: venue.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return <>
    {!embedded && <div className="gb-venue-sheet-backdrop" onClick={onDeselect} />}
    <div ref={panel} className="gb-venue-sheet" role={active && !embedded ? "dialog" : undefined} aria-modal={active && !embedded ? "true" : undefined} aria-labelledby={label}>
      {!embedded && <button type="button" className="gb-venue-handle" aria-label="Свернуть площадку" onClick={onCollapse}><span /></button>}
      <header className="gb-venue-sheet-header">
        {currentView !== "info" && <button type="button" aria-label={currentView === "game" ? "К расписанию" : "К информации о площадке"} onClick={() => setView(currentView === "game" ? "schedule" : "info")}>←</button>}
        <h2 id={label}>{venue.name}</h2>
        <button ref={close} className="gb-venue-sheet-close" type="button" aria-label="Закрыть" onClick={onCollapse}>×</button>
      </header>
      {currentView === "info" ? <div className="gb-venue-sheet-info">
        <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-sheet-cover" />
        <h3>{venue.name}</h3><p>{venue.address}</p>
        {!gamesReady && <p role="status">Расписание временно недоступно</p>}
        {gamesReady && games.length === 0 && <Link className="gb-venue-sheet-primary" href={venueCreatePath(new URLSearchParams({ venueId: venue.id }).toString())}>Создать игру на этой площадке</Link>}
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
