"use client";
import type { UnifiedRow } from "@gobadminton/contracts";
import type { UnifiedDirectoryController } from "../../../lib/unified-directory";
import { GamesMapView } from "../games/GamesMapView";
import { MOSCOW_BUNDLE } from "../../../lib/radar-map-assets";

/** Compatibility entry: all geographic presentation and private layers are shared. */
export function GeographicRadarMap(_props: { controller: UnifiedDirectoryController; rows: UnifiedRow[]; selected: string | null; onSelect: (row: UnifiedRow) => void; onUnavailable: () => void }) {
  return <GamesMapView cityId={MOSCOW_BUNDLE.cityId} day="" />;
}
