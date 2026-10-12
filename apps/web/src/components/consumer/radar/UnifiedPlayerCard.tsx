"use client";
import type { UnifiedRow } from "@gobadminton/contracts";
import { distanceExplanation, distanceText } from "../../../lib/unified-directory";
import { formatSocialLevel } from "../../../lib/player-presentation";
import type { PublicPlayer } from "../../../lib/consumer-types";
import { Avatar, PlayerCard } from "../players/ProfileComposition";

export function UnifiedPlayerCard({ row, city, onSelect }: { row: UnifiedRow; city?: string; onSelect: () => void }) {
  const metadata = row.radar && <span className="unified-distance" title={distanceExplanation(row)}>{distanceText(row.radar.distance) ?? "Участник Radar · расстояние неизвестно"}{row.radar.geo.quality === "degraded" && <small>Местоположение определяется неточно</small>}</span>;
  if (row.projection === "directory") return <div className="unified-row"><PlayerCard player={row.player as PublicPlayer} city={city} metadata={metadata} />{row.radar && <button className="unified-detail" onClick={onSelect} aria-label={`Показать участника Radar: ${row.player.displayName}`}>Подробнее</button>}</div>;
  return <button className="player-card unified-public" onClick={onSelect}><Avatar name={row.player.displayName} avatar={row.player.avatar} /><span className="player-card__main"><span className="player-card__title"><strong>{row.player.displayName}</strong></span><span>{formatSocialLevel(row.player.level)}</span>{city && <span>{city}</span>}{metadata}{row.player.trainer && <em>Тренер</em>}</span></button>;
}
