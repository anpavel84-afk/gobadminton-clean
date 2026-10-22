"use client";
import { useEffect, useRef } from "react";
import { formatSocialLevel } from "../../../lib/player-presentation";
import { distanceText, liveUnifiedPreview } from "../../../lib/unified-directory";
import { Avatar, ProfileDialog } from "../players/ProfileComposition";
import { GameCover } from "../games/GameCover";
import { Button } from "../Button";
import { RadarContact } from "./RadarContact";
import { useRadarSession, useUnifiedDirectory } from "./RadarSessionProvider";

/** Map embeds this content in its existing panel; ordinary directory keeps its dialog. */
export function UnifiedPlayerPreview({ dialog = false, onClose, expanded = true, onToggle, onMap = false }: {
  dialog?: boolean; onClose: () => void; expanded?: boolean; onToggle?: () => void; onMap?: boolean;
}) {
  const directory = useUnifiedDirectory(); const { view } = useRadarSession();
  const focus = useRef<HTMLDivElement>(null); const toggle = useRef<HTMLButtonElement>(null);
  const row = [...directory.view.pins, ...directory.view.rows].find(row => row.publicPlayerId === directory.view.selected);
  const raw = directory.view.preview;
  useEffect(() => { if (!dialog) focus.current?.focus({ preventScroll: true }); }, [directory.view.selected, dialog]);
  useEffect(() => { if (onMap) { if (expanded) focus.current?.focus({ preventScroll: true }); else toggle.current?.focus({ preventScroll: true }); } }, [expanded, onMap]);
  const deadline = Math.min(
    Date.parse(directory.view.snapshot?.validUntil ?? "invalid"),
    Date.parse(row?.radar?.validUntil ?? "invalid"),
    Date.parse(raw?.radar?.validUntil ?? row?.radar?.validUntil ?? "invalid"));
  useEffect(() => {
    if (!directory.controller || !Number.isFinite(deadline)) return;
    const id = window.setTimeout(() => directory.controller?.tick(), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(id);
  }, [directory.controller, deadline]);
  const now = Date.now();
  if (!row?.radar || !directory.view.snapshot || directory.view.stale ||
      !Number.isFinite(deadline) || deadline <= now ||
      (onMap && (view.phase !== "active" || !view.confirmedOn || view.pendingStop))) return null;
  const preview = liveUnifiedPreview(raw, row.publicPlayerId, now) ? raw : null;
  // A mismatched response must not paint even a compact identity or an empty schedule.
  if (raw && !preview) return null;
  const player = preview?.player ?? row.player;
  const content = <div ref={focus} tabIndex={-1} className="unified-preview" data-expanded={expanded} onKeyDown={e => {
    if (e.key === "Escape" && !(e.target as Element).closest("dialog")) { e.preventDefault(); e.stopPropagation(); onClose(); }
  }}>
    <div className="unified-preview-identity"><Avatar name={player.displayName} avatar={player.avatar} /><div><h2>{player.displayName}</h2>
      {player.level && <p>{formatSocialLevel(player.level)}</p>}
      <p>{distanceText(preview?.radar.distance ?? row.radar.distance) ?? "Расстояние неизвестно"}</p></div></div>
    {onToggle && <button ref={toggle} type="button" className="unified-preview-toggle" aria-expanded={expanded} aria-controls="unified-player-detail" onClick={onToggle}>{expanded ? "Свернуть" : "Подробнее об игроке"}</button>}
    {directory.view.previewBusy && <p role="status" aria-live="polite">Загружаем данные игрока и ближайшие публичные игры…</p>}
    {directory.view.previewError && <div role="alert"><p>{directory.view.previewError}</p><Button variant="outline" onClick={() => void directory.controller?.select(row)}>Повторить</Button></div>}
    <section id="unified-player-detail" aria-label="Подробности об игроке" hidden={!expanded || !preview}>{expanded && preview && <>
      <p>Приблизительное положение · погрешность {preview.radar.geo.uncertaintyMeters} м · возраст геопозиции до {preview.radar.geo.sourceAgeSeconds} с.</p>
      {preview.radar.geo.quality === "degraded" && <p>Местоположение определяется неточно.</p>}
      <section className="unified-player-games" aria-label="Ближайшие публичные игры"><h3>Ближайшие публичные игры</h3>
        {preview.upcomingGames.length ? <ul>{preview.upcomingGames.map(game => <li key={game.id}>
          <GameCover game={game} className="unified-player-game-cover" />
          <div><strong>{game.title}</strong><span>{game.activityKind === "trainer_led" ? "Тренировка" : "Игра"}</span>
            <time dateTime={game.startsAt}>{new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(game.startsAt))}</time>
            <span>{game.venue.name}</span></div>
        </li>)}</ul> : <p role="status">Нет доступных ближайших публичных игр</p>}
      </section>
      {!onMap && row.projection === "directory" && <Button variant="outline" href={`/players/${row.publicPlayerId}`}>Открыть профиль</Button>}
      {view.me && <RadarContact key={row.radar.resultRef} me={view.me} item={{ resultId: row.radar.resultId, resultRef: row.radar.resultRef, player: preview.player }} />}
    </>}</section>
  </div>;
  return dialog ? <ProfileDialog title="Участник Radar" onClose={onClose}>{content}</ProfileDialog> : content;
}
