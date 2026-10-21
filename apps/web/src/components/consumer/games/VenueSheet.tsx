"use client";
import type { ReactNode } from "react";
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

// Validate untrusted/older API data independently of server normalization.
function hasForbiddenContactCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || character === "\\";
  });
}
function contactUrl(value: unknown, kind?: string): string | null {
  if (typeof value !== "string" || hasForbiddenContactCharacters(value)) return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || raw.split(/[/?#]/)[2]?.includes("@")) return null;
  try {
    const url = new URL(raw);
    if (!url.hostname.startsWith("[") && (url.hostname.length > 253 || !url.hostname.split(".").every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return null;
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 300) return null;
    const host = kind === "telegram" ? "t.me" : kind === "whatsapp" ? "wa.me" : kind === "vk" ? "vk.com" : null;
    if (kind && (!host || url.protocol !== "https:" || url.hostname !== host || url.pathname === "/")) return null;
    return url.href;
  } catch { return null; }
}
function VenuePublicContacts({ value }: { value: unknown }) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawPhone = row.phone;
  const trimmed = typeof rawPhone === "string" ? rawPhone.trim() : "";
  const digits = trimmed.replace(/[^0-9]/g, "");
  const phone = typeof rawPhone === "string" && !hasForbiddenContactCharacters(rawPhone) && trimmed.length <= 40 && /^\+?[0-9 ()-]+$/.test(trimmed) && digits.length >= 7 && digits.length <= 15 ? trimmed : null;
  const website = contactUrl(row.website);
  const links: { kind: string; url: string; label: string }[] = [];
  for (const [kind, label] of [["telegram", "Telegram"], ["whatsapp", "WhatsApp"], ["vk", "ВКонтакте"]] as const) {
    if (!Array.isArray(row.messengers)) continue;
    for (const item of row.messengers as unknown[]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const messenger = item as Record<string, unknown>;
      if (messenger.kind !== kind) continue;
      const url = contactUrl(messenger.url, kind);
      if (url) { links.push({kind,url,label}); break; }
    }
  }
  return <section aria-label="Контакты площадки"><h3>Контакты площадки</h3><p>Публичные контакты организации</p>
    {phone && <p><a href={`tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`}>{phone}</a></p>}
    {website && <p><a href={website} target="_blank" rel="noopener noreferrer">Сайт площадки</a></p>}
    {links.map(link => <p key={link.kind}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></p>)}
    {!phone && !website && !links.length && <p>Публичные контакты не указаны</p>}
  </section>;
}

export function VenueSheet({ venue, games, gamesReady, now, onCollapse, onDeselect, embedded = false, active = true, coverSlot }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number;
  onCollapse: () => void; onDeselect: () => void; embedded?: boolean; active?: boolean; coverSlot?: ReactNode;
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
        {coverSlot ?? <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-sheet-cover" />}
        <h3>{venue.name}</h3><p>{venue.address}</p>
        <VenuePublicContacts value={venue.publicContacts} />
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
