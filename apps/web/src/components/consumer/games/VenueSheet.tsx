"use client";
import { useEffect, useRef, useState } from "react";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { nearestGameLabel, venueDays, venueHandleGesture } from "../../../lib/venue-popup";
import { formatSeats } from "../../../lib/game-presentation";
import { Avatar } from "../players/ProfileComposition";
import { VenueCover } from "../venues/VenueCover";
import { GameHero, GameTerms } from "./GameDetailComposition";
import "../../../styles/games.css";
import "../../../styles/venue-popup.css";

export function VenueSheet({ venue, games, gamesReady, now, onCollapse, onDismiss }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number;
  onCollapse: () => void; onDismiss: () => void;
}) {
  const [view, setView] = useState<"info" | "schedule" | "game">("info");
  const [date, setDate] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onCollapse });
  callbacks.current = { onCollapse };
  const days = venueDays(gamesReady ? games : [], venue.timezone, now);
  const selectedDay = days.find(day => day.id === date) ?? days[0];
  const game = gamesReady ? games.find(item => item.id === gameId) : undefined;
  const shown = !gamesReady || !games.length ? "info" : view === "game" && !game ? "schedule" : view;
  useEffect(() => {
    if (!gamesReady || !games.length) { setView("info"); setGameId(null); }
    else if (view === "game" && !game) setView("schedule");
    if (selectedDay && selectedDay.id !== date) setDate(selectedDay.id);
  }, [gamesReady, games.length, game, selectedDay?.id, date, view]);
  useEffect(() => {
    const initiator = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); callbacks.current.onCollapse();
      }
      if (event.key !== "Tab") return;
      const controls = [...root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]') ?? []];
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true); document.body.style.overflow = overflow;
      if (initiator?.isConnected) initiator.focus();
      else document.querySelector<HTMLButtonElement>(".gb-venue-preview-button")?.focus();
    };
  }, []);
  const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: venue.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(value));
  return <>
    <div className="gb-venue-backdrop" onClick={onDismiss} aria-hidden="true" />
    <div className="gb-venue-sheet" ref={root} role="dialog" aria-modal="true" aria-labelledby="gb-venue-sheet-title">
      <div className="gb-venue-handle" aria-label="Ручка площадки" {...venueHandleGesture(() => {}, onCollapse, () => root.current?.scrollTop ?? 0)}><span /></div>
      <header className="gb-venue-sheet-header">
        {shown !== "info" && <button type="button" aria-label={shown === "game" ? "Назад к расписанию" : "Назад к информации"} onClick={() => setView(shown === "game" ? "schedule" : "info")}>←</button>}
        <h2 id="gb-venue-sheet-title">{venue.name}</h2>
        <button ref={close} type="button" aria-label="Закрыть" onClick={onCollapse}>×</button>
      </header>
      {shown === "info" ? <>
        <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-sheet-cover" />
        <p className="gb-venue-sheet-address">{venue.address}</p>
        <p role={!gamesReady ? "status" : undefined}>{gamesReady ? nearestGameLabel(games, venue.timezone, now) : "Расписание временно недоступно"}</p>
        {gamesReady && games.length > 0 && <button className="gb-venue-sheet-cta" type="button" onClick={() => setView("schedule")}>Показать игры на этой площадке</button>}
      </> : shown === "schedule" ? <>
        <h3>Игры на этой площадке</h3>
        <div className="gb-venue-dates" aria-label="Даты игр">{days.map(day => <button type="button" key={day.id} aria-pressed={day.id === selectedDay?.id} onClick={() => setDate(day.id)}>{day.label}<small>{day.date}</small></button>)}</div>
        <div className="gb-venue-game-list">{selectedDay?.games.map(item => <button type="button" className="gb-venue-game-row" key={item.id} onClick={() => { setGameId(item.id); setView("game"); }}>
          <span>{time(item.startsAt)}–{time(item.endsAt)}</span>
          <span><strong>{item.title}</strong>{item.levelRule.allowedLevelIds.length > 0 && <span>{item.levelRule.allowedLevelIds.join(", ")}</span>}
            <small>Организатор</small><span className="gb-game-identity"><Avatar className="gb-discovery-avatar" name={item.organizer.displayName} avatar={item.organizer.avatar} />{item.organizer.displayName}</span>
            <span>{formatSeats(item)}</span>
          </span>
        </button>)}</div>
      </> : game && <div className="gb-venue-game-detail"><GameHero game={game} /><GameTerms game={game} onVenueClick={() => setView("info")} /></div>}
    </div>
  </>;
}
