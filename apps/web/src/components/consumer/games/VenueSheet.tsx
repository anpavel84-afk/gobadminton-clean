"use client";
import { CloseButton } from "../CloseButton";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { Game, VenueSummary } from "../../../lib/consumer-types";
import { forbiddenUrlScalars, httpUrlAgreesWithOriginalAuthority } from "../../../lib/original-http-authority";
import { venueDays, venueDayLabel } from "../../../lib/venue-popup";
import { formatSeats } from "../../../lib/game-presentation";
import { CreateGamePage } from "../pages/CreateGamePage";
import { GameCover } from "./GameCover";
import { VenueCover } from "../venues/VenueCover";
import { Avatar } from "../players/ProfileComposition";
import { GameHero, GameTerms } from "./GameDetailComposition";
import { VenueGameActions } from "./VenueGameActions";
import "../../../styles/venue-popup.css";

// Validate untrusted/older API data independently of server normalization.
const hasForbiddenContactCharacters = forbiddenUrlScalars;
function contactUrl(value: unknown, kind?: string): string | null {
  if (typeof value !== "string" || hasForbiddenContactCharacters(value)) return null;
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  const url = httpUrlAgreesWithOriginalAuthority(raw, hasForbiddenContactCharacters);
  if (!url) return null;
  if (!url.hostname.startsWith("[") && (url.hostname.length > 253 || !url.hostname.split(".").every(label => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return null;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 300) return null;
  const host = kind === "telegram" ? "t.me" : kind === "whatsapp" ? "wa.me" : kind === "vk" ? "vk.com" : null;
  if (kind && (!host || url.protocol !== "https:" || url.hostname !== host || url.pathname === "/")) return null;
  return url.href;
}
export function VenuePublicContacts({ value }: { value: unknown }) {
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
  return <section className="gb-venue-contacts" aria-label="Контакты площадки"><h3>Контакты площадки</h3>
    <div className="gb-venue-contact-rows">
      {phone && <a className="gb-venue-contact-row" href={`tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`}><ContactIcon kind="phone" /><span>{phone}</span></a>}
      {website && <a className="gb-venue-contact-row" href={website} target="_blank" rel="noopener noreferrer"><ContactIcon kind="website" /><span>{new URL(website).hostname}</span><span aria-hidden="true">↗</span></a>}
      {links.length > 0 && <div className="gb-venue-contact-messengers">{links.map(link => <a className="gb-venue-contact-row" key={link.kind} href={link.url} target="_blank" rel="noopener noreferrer"><ContactIcon kind={link.kind} /><span>{link.label}</span></a>)}</div>}
    </div>
    {!phone && !website && !links.length && <p>Контакты пока не добавлены</p>}
  </section>;
}

function ContactIcon({ kind }: { kind: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "website" ? <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>
      : kind === "phone" ? <path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z" />
      : kind === "telegram" ? <path d="m3 11 18-7-4 16-6-5-4 3 1-6 9-5-6 8" />
      : kind === "whatsapp" ? <><path d="m4 20 1-5a9 9 0 1 1 4 5l-5 1Z" /><path d="m9 8-1 2c1 3 3 5 6 6l2-2-3-2-1 1-2-2 1-1-2-2Z" /></>
      : <path d="M3 7c1 6 4 10 9 10h1v-4c2 0 3 2 5 4h3l-5-6 4-4h-3l-4 4V7h-3v7c-2-1-3-4-4-7H3Z" />}
  </svg>;
}

/** Hook-free row presentation: one accessible action, with media/identity in child components. */
export function VenueSheetGameRow({ game, timezone, onOpen }: { game: Game; timezone: string; onOpen: () => void }) {
  const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return <button key={game.id} type="button" className="gb-venue-sheet-game" onClick={onOpen}>
    <span className="gb-venue-sheet-game-main">
      <GameCover game={game} className="gb-venue-sheet-game-cover" />
      <span className="gb-venue-sheet-game-summary">
        <span className="gb-venue-sheet-game-time">{time(game.startsAt)}–{time(game.endsAt)}</span>
        <strong>{game.title}</strong>
        {game.levelRule.allowedLevelIds.length > 0 && <span className="gb-venue-sheet-game-levels">{game.levelRule.allowedLevelIds.join(", ")}</span>}
      </span>
    </span>
    <span className="gb-venue-sheet-game-footer">
      <span className="gb-venue-sheet-game-organizer">
        <span className="gb-venue-sheet-game-organizer-label">Организатор</span>
        <Avatar name={game.organizer.displayName} avatar={game.organizer.avatar} className="gb-discovery-avatar" />
        <span className="gb-venue-sheet-game-organizer-name">{game.organizer.displayName}</span>
      </span>
      <span className="gb-venue-sheet-count">{formatSeats(game)}</span>
    </span>
  </button>;
}

export function VenueSheet({ venue, games, gamesReady, now, onCollapse, onDeselect, embedded = false, active = true, coverSlot }: {
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number;
  onCollapse: () => void; onDeselect: () => void; embedded?: boolean; active?: boolean; coverSlot?: ReactNode;
}) {
  const [view, setView] = useState<"info" | "schedule" | "game" | "create">("info");
  const [selectedDate, setSelectedDate] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const days = venueDays(gamesReady ? games : [], venue.timezone);
  const day = days.find(item => item.date === selectedDate) ?? days[0];
  const game = gamesReady ? games.find(item => item.id === gameId) : undefined;
  // Render invalidation immediately; effects also clear the old selection permanently.
  const currentView = view === "create" ? "create" : !gamesReady || !days.length ? "info" : view === "game" && !game ? "schedule" : view;
  useEffect(() => {
    if (view !== "create" && (!gamesReady || !days.length)) { setView("info"); setGameId(null); }
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
      // The portal/native dialog owns its own keyboard and focus lifecycle.
      if (document.querySelector(".gb-venue-picker, dialog[open]")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse.current(); }
      if (event.key !== "Tab") return;
      const boundary = embedded ? panel.current?.closest?.<HTMLElement>(".gb-venue-popup") ?? panel.current : panel.current;
      const targets = [...boundary?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]') ?? []].filter(target => {
        if (target.tabIndex < 0 || target.matches(':disabled, [aria-disabled="true"], input[type="hidden"]') || target.closest('[hidden], [inert]')) return false;
        const style = window.getComputedStyle(target);
        return style.visibility !== 'hidden' && style.visibility !== 'collapse' && target.getClientRects().length > 0;
      });
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
  return <>
    {!embedded && <div className="gb-venue-sheet-backdrop" onClick={onDeselect} />}
    <div ref={panel} className="gb-venue-sheet" data-view={currentView} role={active && !embedded ? "dialog" : undefined} aria-modal={active && !embedded ? "true" : undefined} aria-labelledby={label}>
      {!embedded && <button type="button" className="gb-venue-handle" aria-label="Свернуть площадку" onClick={onCollapse}><span /></button>}
      <header className="gb-venue-sheet-header">
        {currentView !== "info" && <button type="button" aria-label={currentView === "game" ? "К расписанию" : "К информации о площадке"} onClick={() => setView(currentView === "game" ? "schedule" : "info")}>←</button>}
        <h2 id={label}>{venue.name}</h2>
        <CloseButton ref={close} className="gb-venue-sheet-close" onClick={onCollapse} />
      </header>
      {currentView === "info" ? <div className="gb-venue-sheet-info">
        {coverSlot ?? <VenueCover cover={venue.cover} name={venue.name} className="gb-venue-sheet-cover" />}
        <h3>{venue.name}</h3><p>{venue.address}</p>
        <VenuePublicContacts value={venue.publicContacts} />
        {!gamesReady && <p role="status">Расписание временно недоступно</p>}
        {gamesReady && games.length === 0 && <button type="button" className="gb-venue-sheet-primary" aria-label="Создать игру на этой площадке" onClick={() => setView("create")}>Создать игру на этой площадке<span aria-hidden="true">→</span></button>}
        {gamesReady && days.length > 0 && <button type="button" className="gb-venue-sheet-primary" aria-label="Показать игры на этой площадке" onClick={() => setView("schedule")}>Показать игры на этой площадке<span aria-hidden="true">→</span></button>}
      </div> : currentView === "create" ? <CreateGamePage key={`${venue.cityId}:${venue.id}`} embedded initialVenue={venue} onClose={() => setView("info")} /> : currentView === "game" && game ? <div className="gb-venue-sheet-detail"><GameHero game={game} /><VenueGameActions key={game.id} gameId={game.id} /><GameTerms game={game} onVenueClick={() => setView("info")} /></div>
        : <div><h3>Игры на этой площадке</h3>
          <div className="gb-venue-sheet-dates" aria-label="Даты игр">{days.map(item => {
            const first = item.games[0]; if (!first) return null;
            return <button type="button" key={item.date} aria-pressed={item.date === day?.date} onClick={() => setSelectedDate(item.date)}>
              <span>{venueDayLabel(item.date, venue.timezone, now, first.startsAt)}</span>
              <span>{new Intl.DateTimeFormat("ru-RU", { timeZone: venue.timezone, day: "numeric", month: "short" }).format(new Date(first.startsAt))}</span>
            </button>;
          })}</div>
          {day?.games.map(item => VenueSheetGameRow({ game: item, timezone: venue.timezone, onOpen: () => { setGameId(item.id); setView("game"); } }))}
        </div>}
    </div>
  </>;
}
