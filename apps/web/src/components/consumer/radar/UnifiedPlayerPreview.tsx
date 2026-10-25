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
  const deadline = Math.min(
    Date.parse(directory.view.snapshot?.validUntil ?? "invalid"),
    Date.parse(row?.radar?.validUntil ?? "invalid"),
    Date.parse(preview?.radar.validUntil ?? row?.radar?.validUntil ?? "invalid"));
  useEffect(() => {
    if (!directory.controller || !Number.isFinite(deadline)) return;
    const id = window.setTimeout(() => directory.controller?.tick(), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(id);
  }, [directory.controller, deadline]);
  // Use live wall clock, not the last one-second session tick, as the final
  // rendering fence. The exact-deadline timer retires retained preview state.
  const now = Date.now();
  if (!row?.radar || !directory.view.snapshot || directory.view.stale ||
      !Number.isFinite(deadline) || deadline <= now) return null;
  const content = <div ref={focus} tabIndex={-1} className="unified-preview" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    {directory.view.previewBusy && <p role="status">Проверяем доступность игрока…</p>}
    {preview && <><Avatar name={preview.player.displayName} avatar={preview.player.avatar} /><h2>{preview.player.displayName}</h2>{preview.player.level && <p>{formatSocialLevel(preview.player.level)}</p>}<p>{distanceText(preview.radar.distance) ?? "Расстояние неизвестно"}</p><p>Приблизительное положение · погрешность {preview.radar.geo.uncertaintyMeters} м · возраст геопозиции до {preview.radar.geo.sourceAgeSeconds} с.</p>{preview.radar.geo.quality === "degraded" && <p>Местоположение определяется неточно.</p>}{row.projection === "directory" && <Button variant="outline" href={`/players/${row.publicPlayerId}`}>Открыть профиль</Button>}{view.me && <RadarContact key={row.radar.resultRef} me={view.me} item={{ resultId: row.radar.resultId, resultRef: row.radar.resultRef, player: preview.player }} />}</>}
  </div>;
  return dialog ? <ProfileDialog title="Участник Radar" onClose={onClose}>{content}</ProfileDialog> : content;
}
