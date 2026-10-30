"use client";
import { useEffect, useRef, useState } from "react";
import { formatSocialLevel } from "../../../lib/player-presentation";
import { distanceText, liveUnifiedPreview } from "../../../lib/unified-directory";
import type { UnifiedUpcomingGame } from "@gobadminton/contracts";
import type { PublicPlayer } from "../../../lib/consumer-types";
import { Avatar, Badge, ProfileDialog } from "../players/ProfileComposition";
import {
  browsePeerMediaKey,
  PreparedBrowseAvatar,
  subscribeRadarPreparedMedia,
  takeRadarPreparedMedia,
} from "../players/PlayerBrowseMedia";
import { PublicPlayerProfile, reportUnknownScopeKey } from "../players/PublicPlayerProfile";
import { Button } from "../Button";
import { CloseButton } from "../CloseButton";
import { DesktopOverlayHeader } from "../DesktopOverlayHeader";
import { GameCover } from "../games/GameCover";
import { useVenuePopupModalLifecycle } from "../games/VenuePopup";
import { useDesktopMapInspector } from "../games/DesktopMapInspector";
import { RadarContact } from "./RadarContact";
import { useRadarSession, useUnifiedDirectory } from "./RadarSessionProvider";
import "../../../styles/desktop-overlays.css";

function gameWhen(game: UnifiedUpcomingGame): string {
  const start = new Date(game.startsAt);
  const end = new Date(game.endsAt);
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone, day: "numeric", month: "short" }).format(start);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone, hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time.format(start)}–${time.format(end)}`;
}

export function UnifiedPlayerPreview({ dialog = false, onClose, expanded: controlled, onExpandedChange, surface, onOpen, onCollapse, skipFocusRestore, reportUnknownScopes, onReportUnknownScope }: {
  dialog?: boolean; onClose: () => void; expanded?: boolean; onExpandedChange?: (value: boolean) => void;
  /** compact/detail split the same content into VenuePopup preview + sheet slots. */
  surface?: "compact" | "detail";
  onOpen?: () => void;
  onCollapse?: () => void;
  /** Shared with RadarPage: venue replacement must not restore the old player trigger. */
  skipFocusRestore?: { current: boolean };
  /**
   * RadarPage-held additive set of viewer:peer keys survives VenuePopup detail unmount.
   * When omitted (dialog / standalone), this preview keeps its own narrow set across games↔profile.
   */
  reportUnknownScopes?: ReadonlySet<string>;
  onReportUnknownScope?: (scopeKey: string) => void;
}) {
  const desktop = useDesktopMapInspector();
  const [localExpanded, setLocalExpanded] = useState(false);
  const [gamesView, setGamesView] = useState(false);
  const [localReportUnknownScopes, setLocalReportUnknownScopes] = useState(new Set<string>());
  const expanded = surface === "compact" ? false : surface === "detail" ? true : (controlled ?? localExpanded);
  const expand = (value: boolean) => { setLocalExpanded(value); onExpandedChange?.(value); if (!value) setGamesView(false); };
  const collapseSheet = () => {
    setGamesView(false);
    if (onCollapse) onCollapse();
    else if (surface !== "detail") expand(false);
    else onClose();
  };
  const directory = useUnifiedDirectory(); const { view } = useRadarSession(); const focus = useRef<HTMLDivElement>(null);
  const latchScopes = reportUnknownScopes ?? localReportUnknownScopes;
  const latchUnknown = onReportUnknownScope
    ?? ((scope: string) => setLocalReportUnknownScopes(prev => new Set([...prev, scope])));
  const row = [...directory.view.pins, ...directory.view.rows].find(row => row.publicPlayerId === directory.view.selected);
  const preview = directory.view.preview;
  const now = Date.now();
  const safePreview = preview && row && liveUnifiedPreview(preview, row.publicPlayerId, now) ? preview : null;
  const [, setMediaTick] = useState(0);
  // Provider owns prewarm lifecycle; subscribe to end-of-load commits (no fixed 200ms timeout).
  useEffect(() => subscribeRadarPreparedMedia(() => setMediaTick(n => n + 1)), []);
  // Default session matches RadarAuthorizedMediaPrewarm; catalog mediaKey may omit cover until GET.
  const preparedMedia = row
    ? (takeRadarPreparedMedia(row.publicPlayerId, browsePeerMediaKey(row.player as PublicPlayer))
      ?? takeRadarPreparedMedia(row.publicPlayerId))
    : null;
  const deadline = Math.min(
    Date.parse(directory.view.snapshot?.validUntil ?? "invalid"),
    Date.parse(row?.radar?.validUntil ?? "invalid"),
    Date.parse(safePreview?.radar.validUntil ?? row?.radar?.validUntil ?? "invalid"),
    ...((safePreview?.upcomingGames ?? []).map(game => Date.parse(game.startsAt))));
  const detailLive = surface === "detail" && !!row?.radar && !!directory.view.snapshot && !directory.view.stale
    && Number.isFinite(deadline) && deadline > now && !(preview && !safePreview);
  useEffect(() => { setLocalExpanded(false); setGamesView(false); }, [directory.view.selected]);
  // Selection and internal profile↔games transitions move focus into the new view.
  useEffect(() => {
    if (dialog || surface === "compact") return;
    if (surface === "detail" && !detailLive) return;
    focus.current?.focus();
  }, [directory.view.selected, dialog, surface, gamesView, detailLive]);
  const escapeDetail = useRef(() => {});
  escapeDetail.current = () => {
    if (gamesView) setGamesView(false);
    else collapseSheet();
  };
  // Same VenueSheet shell lifecycle: handle Escape, Tab containment, body overflow, nested dialogs.
  useVenuePopupModalLifecycle({
    active: detailLive,
    embedded: true,
    panelRef: focus,
    initialFocusRef: focus,
    onEscape: () => escapeDetail.current(),
    skipFocusRestore,
    lockBody: !desktop,
  });
  useEffect(() => {
    if (!directory.controller || !Number.isFinite(deadline)) return;
    const id = window.setTimeout(() => directory.controller?.tick(), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(id);
  }, [directory.controller, deadline]);
  // Use live wall clock, not the last one-second session tick, as the final
  // rendering fence. The exact-deadline timer retires retained preview state.
  if (!detailLive && surface === "detail") return null;
  if (!row?.radar || !directory.view.snapshot || directory.view.stale ||
      !Number.isFinite(deadline) || deadline <= now) return null;
  if (preview && !safePreview) return null;

  const levelLabel = safePreview?.player.level ? formatSocialLevel(safePreview.player.level) : null;
  const distance = safePreview ? (distanceText(safePreview.radar.distance) ?? "Расстояние неизвестно") : null;
  const games = safePreview ? safePreview.upcomingGames.slice(0, 3) : [];
  // Ordinary public profile mounts only behind the live Radar fence for this peer/viewer/TTL.
  const profileMountKey = safePreview && row?.radar
    ? `${safePreview.player.publicPlayerId}:${view.me?.id ?? "guest"}:${row.radar.resultRef}`
    : null;

  const gamesSection = safePreview && <section id="radar-player-detail" className="unified-preview__games" aria-label="Ближайшие публичные игры игрока">
    <header className="unified-preview__games-head"><small>Публичные будущие события</small><h3>Ближайшие публичные игры</h3></header>
    {directory.view.previewBusy ? <p role="status">Проверяем доступность игрока…</p> :
      games.length === 0 ? <p role="status">Нет доступных ближайших публичных игр</p> :
      <ul className="g2-player-games">{games.map(game => <li key={game.id} className="upcoming-game-row">
        <GameCover game={game} />
        <div>
          <span className={`status-badge status-badge--${game.activityKind === "trainer_led" ? "attention" : "past"}`}>{game.activityKind === "trainer_led" ? "С тренером" : "Обычная игра"}</span>
          <h4>{game.title}</h4>
          <strong><time dateTime={game.startsAt}>{gameWhen(game)}</time></strong>
          <p>{game.venue.name}</p>
        </div>
        <Button variant="outline" href={`/games/${game.id}`}>Открыть игру</Button>
      </li>)}</ul>}
  </section>;

  const statusBlock = <>
    {directory.view.previewBusy && <p role="status">Проверяем доступность игрока…</p>}
    {!preview && !directory.view.previewBusy && <div role="alert"><p>{directory.view.notice || "Карточка игрока временно недоступна."}</p><Button variant="outline" onClick={() => void directory.controller?.select(row)}>Повторить</Button></div>}
  </>;

  if (surface === "compact") {
    const avatarTone = safePreview?.player.trainer ? "purple" : "yellow";
    // Compact must not bind retained DOM nodes — detail/PublicPlayerProfile owns them (#404 steal).
    return <div className="gb-venue-preview unified-preview is-compact" data-preview-mode="compact" role="region" aria-label={safePreview ? `Кратко: ${safePreview.player.displayName}` : "Карточка игрока"}>
      {statusBlock}
      {safePreview && <button type="button" className="gb-venue-preview-button" aria-label={`Открыть игрока ${safePreview.player.displayName}`} onClick={() => onOpen?.()}>
        <span className="gb-venue-preview-cover unified-preview__compact-cover">
          <Avatar name={safePreview.player.displayName} avatar={safePreview.player.avatar} tone={avatarTone} />
        </span>
        <span className="gb-venue-preview-copy">
          <strong>{safePreview.player.displayName}</strong>
          {levelLabel && <span className="gb-venue-preview-address">{levelLabel}{safePreview.player.trainer ? " · Тренер" : ""}</span>}
          <span className="gb-venue-preview-time">{distance}</span>
        </span>
        <span className="gb-venue-preview-arrow" aria-hidden="true">↑</span>
      </button>}
    </div>;
  }

  const collapseLabel = "Свернуть карточку игрока" as const;
  const reportScope = view.me && safePreview
    ? reportUnknownScopeKey(view.me.id, safePreview.player.publicPlayerId)
    : null;
  const profileInner = safePreview && profileMountKey && row.radar && <>
    <PublicPlayerProfile
      key={profileMountKey}
      publicPlayerId={safePreview.player.publicPlayerId}
      embedded
      distance={distance}
      titleAs="h2"
      preparedMedia={preparedMedia}
      contactActions={view.me
        ? <RadarContact key={row.radar.resultRef} me={view.me} item={{ resultId: row.radar.resultId, resultRef: row.radar.resultRef, player: safePreview.player }} />
        : undefined}
      nearbyGamesAction={null}
      reportUnknown={reportScope !== null && latchScopes.has(reportScope)}
      onReportUnknown={latchUnknown}
    />
    <Button variant="outline" aria-controls="radar-player-detail" onClick={() => setGamesView(true)}>Ближайшие публичные игры</Button>
    <p className="unified-preview__privacy"><small>Только публичная информация</small></p>
  </>;
  const profileArticle = safePreview && profileMountKey && row.radar && <article className="unified-preview__expanded" aria-label={`Карточка: ${safePreview.player.displayName}`}>
    {!desktop && <div className="unified-preview__sheet-head"><span /><CloseButton aria-label={collapseLabel} onClick={collapseSheet} /></div>}
    {profileInner}
  </article>;

  const gamesInternal = safePreview && gamesView && (desktop
    ? gamesSection
    : <div className="unified-preview__games-view" data-player-view="games">
      <header className="unified-preview__games-nav">
        <button type="button" className="unified-preview__back" aria-label={`Назад к профилю ${safePreview.player.displayName}`} onClick={() => setGamesView(false)}>← {safePreview.player.displayName}</button>
        <CloseButton aria-label={collapseLabel} onClick={collapseSheet} />
      </header>
      {gamesSection}
    </div>);

  const desktopChrome = desktop && safePreview ? (
    <DesktopOverlayHeader
      kicker={gamesView ? undefined : "Игрок"}
      title={gamesView ? "Ближайшие публичные игры" : "Профиль игрока"}
      back={gamesView ? {
        label: safePreview.player.displayName,
        ariaLabel: `Назад к профилю ${safePreview.player.displayName}`,
        onClick: () => setGamesView(false),
      } : undefined}
      onClose={collapseSheet}
      closeLabel={collapseLabel}
    />
  ) : null;

  const body = <div ref={focus} tabIndex={-1} className={`unified-preview ${expanded ? "is-expanded" : "is-compact"}`} data-preview-mode={expanded ? "expanded" : "compact"} data-player-view={gamesView ? "games" : "profile"} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (gamesView) setGamesView(false); else onClose(); } }}>
    {statusBlock}
    {safePreview && !expanded && <article className="unified-preview__compact radar-player-preview" aria-label={`Кратко: ${safePreview.player.displayName}`}>
      {preparedMedia
        ? <PreparedBrowseAvatar media={preparedMedia.avatar} name={safePreview.player.displayName} tone={safePreview.player.trainer ? "purple" : "yellow"} />
        : <Avatar name={safePreview.player.displayName} avatar={safePreview.player.avatar} tone={safePreview.player.trainer ? "purple" : "yellow"} />}
      <div className="unified-preview__compact-body">
        <span className="unified-preview__title-row"><h2>{safePreview.player.displayName}</h2>{safePreview.player.trainer && <Badge trainer>Тренер</Badge>}</span>
        {levelLabel && <strong>{levelLabel}</strong>}
        <p>{distance}</p>
      </div>
      <Button variant="outline" aria-expanded={false} aria-controls="radar-player-detail" onClick={() => expand(true)}>Подробнее об игроке</Button>
    </article>}
    {safePreview && expanded && (gamesView ? gamesInternal : profileArticle)}
  </div>;

  if (surface === "detail") {
    return <div ref={focus} tabIndex={-1} className="unified-preview is-expanded" data-preview-mode="expanded" data-player-view={gamesView ? "games" : "profile"} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); escapeDetail.current(); } }}>
      {desktopChrome}
      {statusBlock}
      {safePreview && (desktop
        ? <div className="unified-preview__scroll" data-player-view={gamesView ? "games" : "profile"}>{gamesView ? gamesInternal : profileArticle}</div>
        : (gamesView ? gamesInternal : profileArticle))}
    </div>;
  }

  return dialog ? <ProfileDialog title="Участник Radar" onClose={onClose}>{body}</ProfileDialog> : body;
}
