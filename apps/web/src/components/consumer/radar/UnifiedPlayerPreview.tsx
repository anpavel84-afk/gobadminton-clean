"use client";
import { useEffect, useRef, useState } from "react";
import { formatSocialLevel } from "../../../lib/player-presentation";
import { distanceText, liveUnifiedPreview } from "../../../lib/unified-directory";
import type { UnifiedUpcomingGame } from "@gobadminton/contracts";
import { Avatar, Badge, ProfileDialog } from "../players/ProfileComposition";
import { Button } from "../Button";
import { CloseButton } from "../CloseButton";
import { GameCover } from "../games/GameCover";
import { useVenuePopupModalLifecycle } from "../games/VenuePopup";
import { RadarContact } from "./RadarContact";
import { useRadarSession, useUnifiedDirectory } from "./RadarSessionProvider";

function gameWhen(game: UnifiedUpcomingGame): string {
  const start = new Date(game.startsAt);
  const end = new Date(game.endsAt);
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone, day: "numeric", month: "short" }).format(start);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone, hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time.format(start)}–${time.format(end)}`;
}

export function UnifiedPlayerPreview({ dialog = false, onClose, expanded: controlled, onExpandedChange, surface, onOpen, onCollapse, skipFocusRestore }: {
  dialog?: boolean; onClose: () => void; expanded?: boolean; onExpandedChange?: (value: boolean) => void;
  /** compact/detail split the same content into VenuePopup preview + sheet slots. */
  surface?: "compact" | "detail";
  onOpen?: () => void;
  onCollapse?: () => void;
  /** Shared with RadarPage: venue replacement must not restore the old player trigger. */
  skipFocusRestore?: { current: boolean };
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [gamesView, setGamesView] = useState(false);
  const expanded = surface === "compact" ? false : surface === "detail" ? true : (controlled ?? localExpanded);
  const expand = (value: boolean) => { setLocalExpanded(value); onExpandedChange?.(value); if (!value) setGamesView(false); };
  const directory = useUnifiedDirectory(); const { view } = useRadarSession(); const focus = useRef<HTMLDivElement>(null);
  const row = [...directory.view.pins, ...directory.view.rows].find(row => row.publicPlayerId === directory.view.selected);
  const preview = directory.view.preview;
  const now = Date.now();
  const safePreview = preview && row && liveUnifiedPreview(preview, row.publicPlayerId, now) ? preview : null;
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
    else if (onCollapse) onCollapse();
    else onClose();
  };
  // Same VenueSheet shell lifecycle: handle Escape, Tab containment, body overflow, nested dialogs.
  useVenuePopupModalLifecycle({
    active: detailLive,
    embedded: true,
    panelRef: focus,
    initialFocusRef: focus,
    onEscape: () => escapeDetail.current(),
    skipFocusRestore,
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
    return <div className="gb-venue-preview unified-preview is-compact" data-preview-mode="compact" role="region" aria-label={safePreview ? `Кратко: ${safePreview.player.displayName}` : "Карточка игрока"}>
      {statusBlock}
      {safePreview && <button type="button" className="gb-venue-preview-button" aria-label={`Открыть игрока ${safePreview.player.displayName}`} onClick={() => onOpen?.()}>
        <span className="gb-venue-preview-cover unified-preview__compact-cover"><Avatar name={safePreview.player.displayName} avatar={safePreview.player.avatar} tone={safePreview.player.trainer ? "purple" : "yellow"} /></span>
        <span className="gb-venue-preview-copy">
          <strong>{safePreview.player.displayName}</strong>
          {levelLabel && <span className="gb-venue-preview-address">{levelLabel}{safePreview.player.trainer ? " · Тренер" : ""}</span>}
          <span className="gb-venue-preview-time">{distance}</span>
        </span>
        <span className="gb-venue-preview-arrow" aria-hidden="true">↑</span>
      </button>}
    </div>;
  }

  const profileArticle = safePreview && <article className="unified-preview__expanded" aria-label={`Карточка: ${safePreview.player.displayName}`}>
    <div className="unified-preview__sheet-head"><span /><CloseButton aria-label="Закрыть карточку игрока" onClick={onClose} /></div>
    <div className="unified-preview__hero">
      <Avatar name={safePreview.player.displayName} avatar={safePreview.player.avatar} tone={safePreview.player.trainer ? "purple" : "yellow"} />
    </div>
    <div className="unified-preview__expanded-copy">
      <h2>{safePreview.player.displayName}</h2>
      <div className="unified-preview__meta-row">
        {levelLabel && <Badge>{levelLabel}</Badge>}
        {safePreview.player.trainer && <Badge trainer>Тренер</Badge>}
      </div>
      <p className="unified-distance">{distance}</p>
      <p>Приблизительное положение · погрешность {safePreview.radar.geo.uncertaintyMeters} м · возраст геопозиции до {safePreview.radar.geo.sourceAgeSeconds} с.</p>
      {safePreview.radar.geo.quality === "degraded" && <p>Местоположение определяется неточно.</p>}
      {surface === "detail"
        ? <Button variant="outline" onClick={() => onCollapse?.()}>Свернуть карточку</Button>
        : <Button variant="outline" aria-expanded={true} aria-controls="radar-player-detail" onClick={() => expand(false)}>Свернуть карточку</Button>}
      {view.me && <RadarContact key={row.radar.resultRef} me={view.me} item={{ resultId: row.radar.resultId, resultRef: row.radar.resultRef, player: safePreview.player }} />}
      <Button variant="outline" aria-controls="radar-player-detail" onClick={() => setGamesView(true)}>Ближайшие публичные игры</Button>
      <p className="unified-preview__privacy"><small>Только публичная информация</small></p>
    </div>
  </article>;

  const gamesInternal = safePreview && gamesView && <div className="unified-preview__games-view" data-player-view="games">
    <header className="unified-preview__games-nav">
      <button type="button" className="unified-preview__back" aria-label={`Назад к профилю ${safePreview.player.displayName}`} onClick={() => setGamesView(false)}>← {safePreview.player.displayName}</button>
      <CloseButton aria-label="Закрыть карточку игрока" onClick={onClose} />
    </header>
    {gamesSection}
  </div>;

  const body = <div ref={focus} tabIndex={-1} className={`unified-preview ${expanded ? "is-expanded" : "is-compact"}`} data-preview-mode={expanded ? "expanded" : "compact"} data-player-view={gamesView ? "games" : "profile"} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (gamesView) setGamesView(false); else onClose(); } }}>
    {statusBlock}
    {safePreview && !expanded && <article className="unified-preview__compact radar-player-preview" aria-label={`Кратко: ${safePreview.player.displayName}`}>
      <Avatar name={safePreview.player.displayName} avatar={safePreview.player.avatar} tone={safePreview.player.trainer ? "purple" : "yellow"} />
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
      {statusBlock}
      {safePreview && (gamesView ? gamesInternal : profileArticle)}
    </div>;
  }

  return dialog ? <ProfileDialog title="Участник Radar" onClose={onClose}>{body}</ProfileDialog> : body;
}
