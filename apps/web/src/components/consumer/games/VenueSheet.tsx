"use client";
import { CloseButton } from "../CloseButton";
import { DesktopOverlayHeader } from "../DesktopOverlayHeader";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import type { Game, VenueSummary, Me } from "../../../lib/consumer-types";
import { venueDays, venueDayLabel } from "../../../lib/venue-popup";
import { formatSeats } from "../../../lib/game-presentation";
import { CreateGamePage } from "../pages/CreateGamePage";
import { GameCover } from "./GameCover";
import { VenueGallery, type GalleryItem } from "../venues/VenueGallery";
import { VenuePublicContacts } from "../venues/VenuePublicContacts";
import { Avatar } from "../players/ProfileComposition";
import { GameHero, GameTerms } from "./GameDetailComposition";
import { DesktopInspectorGame } from "./DesktopInspectorGame";
import { VenueGameActions } from "./VenueGameActions";
import { useVenuePopupModalLifecycle, useVenuePopupContentVisible } from "./VenuePopup";
import { useDesktopMapInspector } from "./DesktopMapInspector";
import { VenueCommunityContent, type VenueCommunitySection } from "../venues/VenueCommunityContent";
import { Button } from "../Button";
import { VenueCommunityRating } from "../venues/VenueCommunityRating";
import type { CommunityRatingSummary } from "../../../lib/venue-community-api";
import "../../../styles/venue-popup.css";
import "../../../styles/desktop-overlays.css";

/** Compatible re-export — shared renderer lives in venues/VenuePublicContacts. */
export { VenuePublicContacts } from "../venues/VenuePublicContacts";

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

export function VenueSheet({ venue, games, gamesReady, now, onCollapse, onDeselect, embedded = false, active = true, coverSlot, coverFallback = false, coverReady = false, onCoverRetry, galleryIndex, onGalleryIndexChange, communitySummary = null, communitySummaryState, showCommunityRating = true, communitySection = null, onCommunitySectionChange, me = null, authReturnPath, onUnresolvedChange }: {
  communitySection?: VenueCommunitySection | null;
  onCommunitySectionChange?: (section: VenueCommunitySection | null) => void;
  me?: Me | null; authReturnPath?: string; onUnresolvedChange?: (value: boolean) => void;
  venue: VenueSummary; games: readonly Game[]; gamesReady: boolean; now: number;
  onCollapse: () => void; onDeselect: () => void; embedded?: boolean; active?: boolean; coverSlot?: ReactNode;
  coverFallback?: boolean;
  /** Shared SelectedVenueCover.ready — morph slot loan is not decoded readiness. */
  coverReady?: boolean;
  /** Shared SelectedVenueCover.retry wired from GamesMapView for morph main-loan failure. */
  onCoverRetry?: () => void;
  galleryIndex?: number;
  onGalleryIndexChange?: (index: number, item: GalleryItem | null) => void;
  communitySummary?: CommunityRatingSummary | null;
  communitySummaryState?: "idle" | "loading" | "ready" | "error";
  /** False while compact preview already shows the same summary. */
  showCommunityRating?: boolean;
}) {
  const desktop = useDesktopMapInspector();
  const contentVisible = useVenuePopupContentVisible();
  const communityOpened = useRef(false);
  if (communitySection) communityOpened.current = true;
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
  const deselect = useRef(onDeselect); deselect.current = onDeselect;
  // Desktop X closes to a clean map; mobile X still collapses to the compact card.
  const onCloseClick = desktop ? onDeselect : onCollapse;
  const backFromGame = () => setView(desktop ? "info" : "schedule");
  useVenuePopupModalLifecycle({
    active, embedded, panelRef: panel, initialFocusRef: close,
    onEscape: () => {
      if (communitySection) { onCommunitySectionChange?.(null); return; }
      if (desktop && currentView === "create") { setView("info"); return; }
      if (desktop && (currentView === "game" || currentView === "schedule")) {
        if (currentView === "game") backFromGame();
        else setView("info");
        return;
      }
      if (desktop) deselect.current();
      else collapse.current();
    },
    lockBody: !desktop,
  });
  const openCreate = () => setView("create");
  const desktopBack = communitySection ? { label: "К площадке", ariaLabel: "К площадке", onClick: () => onCommunitySectionChange?.(null) } : currentView !== "info" ? {
    label: currentView === "game" ? "К площадке" : "К площадке",
    ariaLabel: currentView === "game" ? "К площадке" : "К информации о площадке",
    onClick: () => currentView === "game" ? backFromGame() : setView("info"),
  } : undefined;
  const infoPrimary = gamesReady && games.length === 0
    ? <button type="button" className="gb-venue-sheet-primary" aria-label="Создать игру на этой площадке" onClick={openCreate}>Создать игру на этой площадке<span aria-hidden="true">→</span></button>
    : gamesReady && days.length > 0
      ? <button type="button" className="gb-venue-sheet-primary" aria-label="Показать игры на этой площадке" onClick={() => setView("schedule")}>Показать игры на этой площадке<span aria-hidden="true">→</span></button>
      : null;
  const infoBody = <div className="gb-venue-sheet-info">
    {contentVisible && <VenueGallery
      venue={venue}
      className="gb-venue-sheet-cover"
      coverSlot={coverSlot}
      coverFallback={coverFallback}
      coverReady={coverReady}
      onCoverRetry={onCoverRetry}
      showCredit
      index={galleryIndex}
      onIndexChange={onGalleryIndexChange}
    />}
    {venue.profile?.description ? <p className="gb-venue-sheet-description">{venue.profile.description}</p> : null}
    <h3>{venue.name}</h3><p>{venue.address}</p>
    {showCommunityRating ? (
      <VenueCommunityRating
        venueId={venue.id}
        variant="compact"
        signedIn={false}
        csrfToken={null}
        authReturnPath={`/venues/${venue.id}`}
        href={`/venues/${encodeURIComponent(venue.id)}#ratings`}
        summary={communitySummary}
        summaryLoadState={communitySummaryState}
        linkToRatings={false}
      />
    ) : null}
    {onCommunitySectionChange && <nav className="gb-venue-community-actions" data-community-actions aria-label="Сообщество площадки">
      <Button variant="outline" onClick={() => onCommunitySectionChange("ratings")}>Оценить</Button>
      <Button variant="outline" onClick={() => onCommunitySectionChange("discussion")}>Обсуждение</Button>
      <Button variant="ghost" onClick={() => onCommunitySectionChange("reviews")}>Отзывы после игры</Button>
    </nav>}
    <VenuePublicContacts value={venue.publicContacts} />
    {!gamesReady && <p role="status">Расписание временно недоступно</p>}
    {gamesReady && games.length === 0 && (desktop
      ? <section className="gb-venue-sheet-empty" aria-label="Ближайшие игры">
          <h3>Ближайшие игры</h3>
          <div className="gb-venue-sheet-empty-card">
            <p><strong>На этой площадке пока нет игр</strong></p>
            <p>Будьте первым, кто создаст игру и соберет компанию!</p>
          </div>
        </section>
      : infoPrimary
    )}
    {!desktop && gamesReady && days.length > 0 && infoPrimary}
  </div>;
  const scheduleBody = <div><h3>Игры на этой площадке</h3>
    <div className="gb-venue-sheet-dates" aria-label="Даты игр">{days.map(item => {
      const first = item.games[0]; if (!first) return null;
      return <button type="button" key={item.date} aria-pressed={item.date === day?.date} onClick={() => setSelectedDate(item.date)}>
        <span>{venueDayLabel(item.date, venue.timezone, now, first.startsAt)}</span>
        <span>{new Intl.DateTimeFormat("ru-RU", { timeZone: venue.timezone, day: "numeric", month: "short" }).format(new Date(first.startsAt))}</span>
      </button>;
    })}</div>
    {day?.games.map(item => VenueSheetGameRow({ game: item, timezone: venue.timezone, onOpen: () => { setGameId(item.id); setView("game"); } }))}
  </div>;
  return <>
    {!embedded && !desktop && <div className="gb-venue-sheet-backdrop" onClick={onDeselect} />}
    <div ref={panel} className="gb-venue-sheet" data-view={communitySection ? "community" : currentView} data-desktop={desktop ? "true" : undefined} role={active && !embedded ? "dialog" : undefined} aria-modal={active && !embedded && !desktop ? "true" : undefined} aria-labelledby={label}>
      {!embedded && !desktop && <button type="button" className="gb-venue-handle" aria-label="Свернуть площадку" onClick={onCollapse}><span /></button>}
      {desktop ? (
        <DesktopOverlayHeader
          title={communitySection ? "Сообщество" : venue.name}
          titleId={label}
          kicker={currentView === "info" ? "Площадка" : undefined}
          back={desktopBack}
          onClose={onCloseClick}
          closeRef={close}
        />
      ) : (
        <header className="gb-venue-sheet-header">
          {(communitySection || currentView !== "info") && <button type="button" className="gb-venue-sheet-back" aria-label={currentView === "game" ? "К расписанию" : "К информации о площадке"} onClick={() => communitySection ? onCommunitySectionChange?.(null) : currentView === "game" ? backFromGame() : setView("info")}>
            <span aria-hidden="true">←</span>
          </button>}
          <div className="gb-venue-sheet-heading">
            <h2 id={label}>{communitySection ? "К площадке" : venue.name}</h2>
            {!communitySection && currentView !== "info" && <p className="gb-venue-sheet-header-address">{venue.address}</p>}
          </div>
          <CloseButton ref={close} className="gb-venue-sheet-close" onClick={onCloseClick} />
        </header>
      )}
      <div className="gb-venue-sheet-community-body" hidden={!communitySection} inert={!communitySection}>
        {communityOpened.current && <>
          <div className="gb-venue-community-identity"><h3>{venue.name}</h3><p>{venue.address}</p></div>
          <nav className="gb-venue-community-actions" aria-label="Разделы сообщества">
            {(["ratings", "discussion", "reviews"] as const).map((value, index) => <Button key={value} variant="ghost" onClick={() => onCommunitySectionChange?.(value)}>{["Оценки", "Обсуждение", "После игры"][index]}</Button>)}
          </nav>
          <VenueCommunityContent venueId={venue.id} me={me} embedded section={communitySection} authReturnPath={authReturnPath ?? `/venues/${venue.id}`} onUnresolvedChange={onUnresolvedChange} />
        </>}
      </div>
      <div className="gb-venue-sheet-overview" hidden={Boolean(communitySection)} inert={Boolean(communitySection)}>
      {desktop && currentView === "info" ? <>
        <div className="gb-desktop-overlay-body">{infoBody}</div>
        {infoPrimary ? <footer className="gb-desktop-overlay-footer">{infoPrimary}</footer> : null}
      </> : desktop && currentView === "create" ? (
        <div className="gb-desktop-overlay-body"><CreateGamePage key={`${venue.cityId}:${venue.id}`} embedded initialVenue={venue} onClose={() => setView("info")} /></div>
      ) : desktop && currentView === "game" && game ? (
        <DesktopInspectorGame game={game} onVenueClick={() => setView("info")} />
      ) : desktop && currentView === "schedule" ? (
        <div className="gb-desktop-overlay-body">{scheduleBody}</div>
      ) : currentView === "info" ? infoBody : currentView === "create" ? <CreateGamePage key={`${venue.cityId}:${venue.id}`} embedded initialVenue={venue} onClose={() => setView("info")} /> : currentView === "game" && game ? (
        <div className="gb-venue-sheet-detail"><GameHero game={game} /><VenueGameActions key={game.id} gameId={game.id} /><GameTerms game={game} onVenueClick={() => setView("info")} /></div>
      ) : scheduleBody}
      </div>
    </div>
  </>;
}
