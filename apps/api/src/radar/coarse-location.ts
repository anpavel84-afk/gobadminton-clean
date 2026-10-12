import type { PoolClient } from "pg";
import { unprocessable } from "../auth/problem";
import {
  RADAR_FIX_FUTURE_TOLERANCE_SECONDS,
  RADAR_FIX_MAX_ACCURACY_METERS,
  RADAR_FIX_MAX_AGE_SECONDS,
  RADAR_GRID_METERS,
  RADAR_REGION_MOSCOW,
  RADAR_REGION_OWNER_GLOBAL,
  RADAR_REGION_SPB,
  type RadarRegionConfig,
} from "./constants";

export type RawFixInput = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
};

export type CoarseCell = {
  cellI: number;
  cellJ: number;
  longitude: number;
  latitude: number;
  regionId: string;
};

function regionContains(region: RadarRegionConfig, lat: number, lon: number): boolean {
  return (
    lat >= region.latMin &&
    lat <= region.latMax &&
    lon >= region.lonMin &&
    lon <= region.lonMax
  );
}

export function resolveRadarRegion(
  lat: number,
  lon: number,
  allowed: readonly RadarRegionConfig[],
): RadarRegionConfig {
  const hit = allowed.find((region) => regionContains(region, lat, lon));
  if (!hit) {
    throw unprocessable(
      "RADAR_REGION_UNSUPPORTED",
      "Регион Radar не поддерживается",
    );
  }
  return hit;
}

/**
 * Validate transient fix metadata then quantize via PostGIS ST_Transform.
 * Raw coordinates must not leave this function into durable logs/receipts.
 */
export async function quantizeFix(
  client: PoolClient,
  input: RawFixInput,
  now: Date,
  allowedRegions: readonly RadarRegionConfig[] = [RADAR_REGION_MOSCOW],
  gridMeters: 100 | 1000 = 1000,
): Promise<CoarseCell> {
  const lat = input.latitude;
  const lon = input.longitude;
  const accuracy = input.accuracyMeters;
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    throw unprocessable("LOCATION_INVALID", "Некорректные координаты");
  }
  if (
    typeof accuracy !== "number" ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > RADAR_FIX_MAX_ACCURACY_METERS
  ) {
    throw unprocessable(
      "LOCATION_TOO_INACCURATE",
      "Слишком неточная геолокация",
    );
  }
  const capturedMs = Date.parse(input.capturedAt);
  if (!Number.isFinite(capturedMs)) {
    throw unprocessable("LOCATION_INVALID", "Некорректное время фиксации");
  }
  const ageSec = (now.getTime() - capturedMs) / 1000;
  if (ageSec > RADAR_FIX_MAX_AGE_SECONDS) {
    throw unprocessable("LOCATION_TOO_OLD", "Геолокация устарела");
  }
  if (ageSec < -RADAR_FIX_FUTURE_TOLERANCE_SECONDS) {
    throw unprocessable("LOCATION_INVALID", "Некорректное время фиксации");
  }

  const region = resolveRadarRegion(lat, lon, allowedRegions);

  const result = await client.query<{
    cell_i: number;
    cell_j: number;
    lon: number;
    lat: number;
  }>(
    `WITH raw AS (
       SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326) AS g
     ),
     metric AS (
       SELECT ST_Transform(g, $3::int) AS g FROM raw
     ),
     cell AS (
       SELECT
         floor(ST_X(g) / $4::float8)::int AS cell_i,
         floor(ST_Y(g) / $4::float8)::int AS cell_j
       FROM metric
     ),
     center_metric AS (
       SELECT ST_SetSRID(
         ST_MakePoint(
           (cell_i + 0.5) * $4::float8,
           (cell_j + 0.5) * $4::float8
         ),
         $3::int
       ) AS g,
       cell_i,
       cell_j
       FROM cell
     ),
     center_wgs AS (
       SELECT
         cell_i,
         cell_j,
         ST_Transform(g, 4326) AS g
       FROM center_metric
     )
     SELECT
       cell_i,
       cell_j,
       ST_X(g) AS lon,
       ST_Y(g) AS lat
     FROM center_wgs`,
    [lon, lat, region.gridSrid, gridMeters],
  );
  const row = result.rows[0];
  if (!row) {
    throw unprocessable(
      "RADAR_REGION_UNSUPPORTED",
      "Регион Radar не поддерживается",
    );
  }
  return {
    cellI: row.cell_i,
    cellJ: row.cell_j,
    longitude: row.lon,
    latitude: row.lat,
    regionId: region.regionId,
  };
}

export function coarseCenterDistanceMeters(
  a: { cellI: number; cellJ: number },
  b: { cellI: number; cellJ: number },
): number {
  const dx = (a.cellI - b.cellI) * RADAR_GRID_METERS;
  const dy = (a.cellJ - b.cellJ) * RADAR_GRID_METERS;
  return Math.hypot(dx, dy);
}

/** Re-export region catalogs for demo adapters. */
export const DEMO_ALLOWED_RADAR_REGIONS = [
  RADAR_REGION_MOSCOW,
  RADAR_REGION_SPB,
] as const;
export const LIVE_ALLOWED_RADAR_REGIONS = [RADAR_REGION_MOSCOW] as const;
/** Specific regions first; the global owner fallback must be last. */
export const OWNER_GLOBAL_DEBUG_RADAR_REGIONS = [
  RADAR_REGION_MOSCOW,
  RADAR_REGION_SPB,
  RADAR_REGION_OWNER_GLOBAL,
] as const;
