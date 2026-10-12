import type { PoolClient } from "pg";
import { quantizeFix, type RawFixInput } from "./coarse-location";
import { geographicCity } from "./geographic-contract";
import type { RadarExposureMode } from "./constants";
import type { UnifiedPoint } from "./unified-contract";
import { unprocessable } from "../auth/problem";
export async function quantizeUnified(
  client: PoolClient,
  fix: RawFixInput,
  cityId: string,
  mode: RadarExposureMode,
): Promise<UnifiedPoint & { cellI: number; cellJ: number; regionId: string }> {
  const grid = fix.accuracyMeters <= 100 ? 100 : 1000;
  const cell = await quantizeFix(
    client,
    fix,
    new Date(),
    [geographicCity(cityId, mode)],
    grid,
  );
  if (Date.parse(fix.capturedAt) + 60_000 <= Date.now())
    throw unprocessable("LOCATION_TOO_OLD", "Геолокация устарела");
  return {
    ...cell,
    grid,
    model: grid === 100 ? "regional_grid_100m_v1" : "regional_grid_1000m_v1",
    accuracy: fix.accuracyMeters,
    capturedAt: Date.parse(fix.capturedAt),
  };
}
