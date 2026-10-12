"use client";
import { useEffect, useRef } from "react";
import { formatSocialLevel } from "../../../lib/player-presentation";
import { distanceText } from "../../../lib/unified-directory";
import { Avatar, ProfileDialog } from "../players/ProfileComposition";
import { Button } from "../Button";
import { RadarContact } from "./RadarContact";
import { useRadarSession, useUnifiedDirectory } from "./RadarSessionProvider";
export function UnifiedPlayerPreview({ dialog = false, onClose }: { dialog?: boolean; onClose: () => void }) {
  const directory = useUnifiedDirectory(); const { view } = useRadarSession(); const focus = useRef<HTMLDivElement>(null);
  const row = [...directory.view.pins, ...directory.view.rows].find(row => row.publicPlayerId === directory.view.selected);
  const preview = directory.view.preview;
  useEffect(() => { if (!dialog) focus.current?.focus(); }, [directory.view.selected, dialog]);
  if (!row?.radar) return null;
  const content = <div ref={focus} tabIndex={-1} className="unified-preview" onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
    {directory.view.previewBusy && <p role="status">Проверяем доступность игрока…</p>}
    {preview && <><Avatar name={preview.player.displayName} avatar={preview.player.avatar} /><h2>{preview.player.displayName}</h2><p>{formatSocialLevel(preview.player.level)}</p><p>{distanceText(preview.radar.distance) ?? "Расстояние неизвестно"}</p><p>Приблизительное положение · погрешность {preview.radar.geo.uncertaintyMeters} м · возраст геопозиции до {preview.radar.geo.sourceAgeSeconds} с.</p>{preview.radar.geo.quality === "degraded" && <p>Местоположение определяется неточно.</p>}{row.projection === "directory" && <Button variant="outline" href={`/players/${row.publicPlayerId}`}>Открыть профиль</Button>}{view.me && <RadarContact key={row.radar.resultRef} me={view.me} item={{ resultId: row.radar.resultId, resultRef: row.radar.resultRef, player: preview.player }} />}</>}
  </div>;
  return dialog ? <ProfileDialog title="Участник Radar" onClose={onClose}>{content}</ProfileDialog> : content;
}
