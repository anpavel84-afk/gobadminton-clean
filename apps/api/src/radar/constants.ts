/** PROPOSED synthetic Radar profile — not Owner/Product/Trust live closure. */
export const RADAR_POLICY_VERSION = "radar-mvp-v1";
/** Moscow live + demo region (UTM zone 37N). */
export const RADAR_REGION_ID = "moscow-mvp";
/** Санкт-Петербург synthetic/internal demo region (UTM zone 36N). */
export const RADAR_REGION_SPB_ID = "spb-mvp";
/** Owner/test-only fallback region. Never enabled globally. */
export const RADAR_REGION_OWNER_GLOBAL_ID = "owner-debug-global";
export const RADAR_GRID_SRID = 32637;
export const RADAR_GRID_SRID_SPB = 32636;
export const RADAR_GRID_SRID_OWNER_GLOBAL = 3857;
export const RADAR_GRID_METERS = 1000;

export const RADAR_TTL_DEFAULT_MINUTES = 15;
export const RADAR_TTL_MAX_MINUTES = 15;
export const RADAR_HARD_LIFETIME_MINUTES = 30;

export const RADAR_RADIUS_BUCKETS_KM = [3, 5, 10] as const;
export type RadarRadiusBucketKm = (typeof RADAR_RADIUS_BUCKETS_KM)[number];
export const RADAR_DEFAULT_RADIUS_KM: RadarRadiusBucketKm = 5;

export const RADAR_FOREGROUND_LEASE_SECONDS = 90;
export const RADAR_LOCATION_UPDATE_MINUTES = 5;
export const RADAR_LOCATION_VALID_MINUTES = 6;
export const RADAR_FIX_MAX_AGE_SECONDS = 60;
export const RADAR_FIX_FUTURE_TOLERANCE_SECONDS = 30;
export const RADAR_FIX_MAX_ACCURACY_METERS = 1000;
export const RADAR_RADIUS_CHANGE_COOLDOWN_MINUTES = 5;
export const RADAR_RADIUS_CHANGES_PER_WINDOW = 2;
export const RADAR_RADIUS_CHANGE_WINDOW_MINUTES = 15;

export const RADAR_SPARSE_K = 1;
export const RADAR_RESULT_CAP = 20;
export const RADAR_REFRESH_AFTER_SECONDS = 30;
export const RADAR_DISPLAY_TTL_SECONDS = 45;
export const RADAR_PROOF_TTL_SECONDS = 60;

export const RADAR_START_TAKEOVER_PER_HOUR = 6;
export const RADAR_GEO_UPDATES_PER_HOUR = 12;
export const RADAR_NEARBY_MIN_INTERVAL_SECONDS = 30;
export const RADAR_NEARBY_PER_HOUR = 120;
export const RADAR_PREVIEW_PER_MINUTE = 10;

/** Coarse movement plausibility within one activation (PROPOSED). */
export const RADAR_MAX_COARSE_SPEED_KMH = 150;

export const RADAR_BAND_NEAR_M = 3000;
export const RADAR_BAND_MIDDLE_M = 5000;

export type RadarExposureMode = "live" | "synthetic_demo";

export type RadarRegionConfig = {
  regionId: string;
  gridSrid: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

/** Live Radar admits Moscow only. Synthetic demo also admits SPB. */
export const RADAR_REGION_MOSCOW: RadarRegionConfig = {
  regionId: RADAR_REGION_ID,
  gridSrid: RADAR_GRID_SRID,
  latMin: 54.5,
  latMax: 56.5,
  lonMin: 36.0,
  lonMax: 39.5,
};

export const RADAR_REGION_SPB: RadarRegionConfig = {
  regionId: RADAR_REGION_SPB_ID,
  gridSrid: RADAR_GRID_SRID_SPB,
  latMin: 59.7,
  latMax: 60.2,
  lonMin: 29.8,
  lonMax: 30.7,
};

/**
 * Web Mercator fallback used only for explicitly allowlisted owner/test users.
 * ±85° avoids the projection's polar singularity. This does not enable a
 * global live cohort: matching still requires equal region_id.
 */
export const RADAR_REGION_OWNER_GLOBAL: RadarRegionConfig = {
  regionId: RADAR_REGION_OWNER_GLOBAL_ID,
  gridSrid: RADAR_GRID_SRID_OWNER_GLOBAL,
  latMin: -85,
  latMax: 85,
  lonMin: -180,
  lonMax: 180,
};

export function isAdmittedRadarRegionId(regionId: string): boolean {
  return (
    regionId === RADAR_REGION_ID ||
    regionId === RADAR_REGION_SPB_ID ||
    regionId === RADAR_REGION_OWNER_GLOBAL_ID
  );
}
