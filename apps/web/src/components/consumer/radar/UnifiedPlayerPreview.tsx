"use client";
import { useEffect, useRef, useState } from "react";
import { formatSocialLevel } from "../../../lib/player-presentation";
import { distanceText, liveUnifiedPreview } from "../../../lib/unified-directory";
import { Avatar, ProfileDialog } from "../players/ProfileComposition";
import { Button } from "../Button";
import { GameCover } from "../games/GameCover";
import { RadarContact } from "./RadarContact";
import { useRadarSession, useUnifiedDirectory } from "./RadarSessionProvider";
export function UnifiedPlayerPreview({ dialog = false, onClose, expanded: controlled, onExpandedChange }: { dialog?: boolean; onClose: () => void; expanded?: boolean; onExpandedChange?: (value: boolean) => void }) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlled ?? localExpanded;
  const expand = (value: boolean) => { setLocalExpanded(value); onExpandedChange?.(value); };
  const directory = useUnifiedDirectory(); const { view } = useRadarSession(); const focus = useRef<HTMLDivElement>(null);
  const row = [...directory.view.pins, ...directory.view.rows].find(row => row.publicPlayerId === directory.view.selected);
  const preview = directory.view.preview;
  const now = Date.now();
  const safePreview = preview && row && liveUnifiedPreview(preview, row.publicPlayerId, now) ? preview : null;
  useEffect(() => { setLocalExpanded(false); }, [directory.view.selected]);
  useEffect(() => { if (!dialog) focus.current?.focus(); }, [directory.view.selected, dialog]);
  const deadline = Math.min(
    Date.parse(directory.view.snapshot?.validUntil ?? "invalid"),
    Date.parse(row?.radar?.validUntil ?? "invalid"),
    Date.parse(safePreview?.radar.validUntil ?? row?.radar?.validUntil ?? "invalid"),
    ...((safePreview?.upcomingGames ?? []).map(game => Date.parse(game.startsAt))));
  useEffect(() => {
    if (!directory.controller || !Number.isFinite(deadline)) return;
    const id = window.setTimeout(() => directory.controller?.tick(), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(id);
  }, [directory.controller, deadline]);
  // Use live wall clock, not the last one-second session tick, as the final
  // rendering fence. The exact-deadline timer retires retained preview state.
  if (!row?.radar || !directory.view.snapshot || directory.view.stale ||
      !Number.isFinite(deadline) || deadline <= now) return null;
  if (preview && !safePreview) return null;
  const content = <div ref={focus} tabIndex={-1} className="unified-preview" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    {directory.view.previewBusy && <p role="status">Проверяем доступность игрока…</p>}
    {!preview && !directory.view.previewBusy && <div role="alert"><p>{directory.view.notice || "Карточка игрока временно недоступна."}</p><Button variant="outline" onClick={() => void directory.controller?.select(row)}>Повторить</Button></div>}
    {safePreview && <><Avatar name={safePreview.player.displayName} avatar={safePreview.player.avatar} /><h2>{safePreview.player.displayName}</h2>{safePreview.player.level && <p>{formatSocialLevel(safePreview.player.level)}</p>}<p>{distanceText(safePreview.radar.distance) ?? "Расстояние неизвестно"}</p><p>Приблизительное положение · погрешность {safePreview.radar.geo.uncertaintyMeters} м · возраст геопозиции до {safePreview.radar.geo.sourceAgeSeconds} с.</p>{safePreview.radar.geo.quality === "degraded" && <p>Местоположение определяется неточно.</p>}<Button variant="outline" aria-expanded={expanded} aria-controls="radar-player-detail" onClick={() => expand(!expanded)}>{expanded ? "Свернуть карточку" : "Подробнее об игроке"}</Button>
      {expanded && <section id="radar-player-detail" aria-label="Подробная карточка игрока">
        <h3>Ближайшие публичные игры</h3>
        {safePreview.upcomingGames.length === 0 ? <p role="status">Нет доступных ближайших публичных игр</p> :
          <ul className="g2-player-games">{safePreview.upcomingGames.map(game => <li key={game.id}>
            <GameCover game={game} /><div><a href={`/games/${game.id}`}>{game.title}</a><p>{game.venue.name}</p>
              <time dateTime={game.startsAt}>{new Intl.DateTimeFormat("ru-RU", { timeZone: game.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(game.startsAt))}</time></div>
          </li>)}</ul>}
      </section>}{view.me && <RadarContact key={row.radar.resultRef} me={view.me} item={{ resultId: row.radar.resultId, resultRef: row.radar.resultRef, player: safePreview.player }} />}</>}
  </div>;
  return dialog ? <ProfileDialog title="Участник Radar" onClose={onClose}>{content}</ProfileDialog> : content;
}
