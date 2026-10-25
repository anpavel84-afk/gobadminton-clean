"use client";
import type { UnifiedRow } from "@gobadminton/contracts";
import { distanceExplanation, distanceText } from "../../../lib/unified-directory";
import type { PublicPlayer } from "../../../lib/consumer-types";
import { PlayerCard } from "../players/ProfileComposition";
export function UnifiedPlayerCard({ row, city, onSelect }: { row: UnifiedRow; city?: string; onSelect: () => void }) {
  const metadata = row.radar && <span className="unified-distance" title={distanceExplanation(row)}>{distanceText(row.radar.distance) ?? "Расстояние неизвестно"}</span>;
  return <PlayerCard player={row.player as PublicPlayer} city={city} metadata={metadata} onSelect={row.projection === "directory" ? undefined : onSelect} />;
}
