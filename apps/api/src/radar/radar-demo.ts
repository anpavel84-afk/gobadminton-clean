import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  DEMO_MOSCOW_CITY_ID,
  DEMO_PERSON_ORDINALS,
  DEMO_SPB_CITY_ID,
  demoRadarActivationId,
  demoRadarSessionId,
  demoUserId,
  isDemoUuid,
} from "../database/demo-ids";
import { forbidden, unprocessable } from "../auth/problem";
import {
  RADAR_FOREGROUND_LEASE_SECONDS,
  RADAR_HARD_LIFETIME_MINUTES,
  RADAR_LOCATION_UPDATE_MINUTES,
  RADAR_LOCATION_VALID_MINUTES,
  RADAR_POLICY_VERSION,
  RADAR_REGION_MOSCOW,
  RADAR_REGION_SPB,
  RADAR_TTL_DEFAULT_MINUTES,
  type RadarRegionConfig,
} from "./constants";
import { DEMO_ALLOWED_RADAR_REGIONS, quantizeFix } from "./coarse-location";

/** City-scoped synthetic anchors (venue-adjacent; not live GPS). */
const CITY_ANCHORS: Record<
  string,
  { latitude: number; longitude: number; region: RadarRegionConfig }
> = {
  [DEMO_MOSCOW_CITY_ID]: {
    latitude: 55.7558,
    longitude: 37.6173,
    region: RADAR_REGION_MOSCOW,
  },
  [DEMO_SPB_CITY_ID]: {
    latitude: 59.9343,
    longitude: 30.3351,
    region: RADAR_REGION_SPB,
  },
};

/**
 * Deterministic ~100–400 m offsets so peers quantize to nearby distinct cells
 * without claiming real-person GPS.
 */
function syntheticOffset(ordinal: number): { dLat: number; dLon: number } {
  const angle = ((ordinal * 47) % 360) * (Math.PI / 180);
  const meters = 120 + (ordinal % 5) * 60;
  const dLat = (meters * Math.cos(angle)) / 111_320;
  const dLon =
    (meters * Math.sin(angle)) /
    (111_320 * Math.cos((59.9 * Math.PI) / 180));
  return { dLat, dLon };
}

export function admittedDemoCityIds(): readonly string[] {
  return [DEMO_MOSCOW_CITY_ID, DEMO_SPB_CITY_ID];
}

export function regionForDemoCity(cityId: string): RadarRegionConfig {
  const anchor = CITY_ANCHORS[cityId];
  if (!anchor) {
    throw unprocessable(
      "RADAR_DEMO_CITY_UNSUPPORTED",
      "Демо Radar доступен только в допущенных городах",
    );
  }
  return anchor.region;
}

export function syntheticDemoFix(
  cityId: string,
  ordinal: number,
  now = new Date(),
): {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
} {
  const anchor = CITY_ANCHORS[cityId];
  if (!anchor) {
    throw unprocessable(
      "RADAR_DEMO_CITY_UNSUPPORTED",
      "Демо Radar доступен только в допущенных городах",
    );
  }
  const { dLat, dLon } = syntheticOffset(ordinal);
  return {
    latitude: anchor.latitude + dLat,
    longitude: anchor.longitude + dLon,
    accuracyMeters: 25,
    capturedAt: now.toISOString(),
  };
}

export function ordinalFromDemoUserId(userId: string): number | null {
  if (!isDemoUuid(userId)) return null;
  const match = /^d0f00001-0000-4000-8000-([0-9a-f]{12})$/i.exec(userId);
  if (!match) return null;
  return Number.parseInt(match[1]!, 16);
}

@Injectable()
export class RadarDemoService {
  allowedRegionsForMode(mode: "live" | "synthetic_demo"): readonly RadarRegionConfig[] {
    return mode === "synthetic_demo"
      ? DEMO_ALLOWED_RADAR_REGIONS
      : [RADAR_REGION_MOSCOW];
  }

  async requireDemoCityScope(
    client: PoolClient,
    userId: string,
  ): Promise<{ cityId: string; region: RadarRegionConfig }> {
    if (!isDemoUuid(userId)) {
      throw forbidden("SOCIAL_INELIGIBLE", "Социальный профиль недоступен");
    }
    const result = await client.query<{ city_id: string | null }>(
      `SELECT city_id FROM player_social_profiles WHERE user_id = $1`,
      [userId],
    );
    const cityId = result.rows[0]?.city_id;
    if (!cityId || !admittedDemoCityIds().includes(cityId)) {
      throw unprocessable(
        "RADAR_DEMO_CITY_REQUIRED",
        "Для демо Radar нужна допущенная демо-городская привязка",
      );
    }
    return { cityId, region: regionForDemoCity(cityId) };
  }

  assertFixMatchesCity(
    cityId: string,
    location: { latitude: number; longitude: number },
  ): void {
    const region = regionForDemoCity(cityId);
    if (
      location.latitude < region.latMin ||
      location.latitude > region.latMax ||
      location.longitude < region.lonMin ||
      location.longitude > region.lonMax
    ) {
      throw unprocessable(
        "RADAR_DEMO_CITY_MISMATCH",
        "Геолокация демо Radar должна быть в городе профиля",
      );
    }
  }

  /**
   * Materialize/refresh synthetic peer presence for other consented demo identities
   * in the same city so DEMO observation can exercise R1 nearby without live GPS.
   * Does not invent real-person rows; IDs stay in the deterministic demo namespace.
   *
   * Ownership fence (QRDA-F01): cohort refresh may create or renew only synthetic
   * fixture activations (`demoRadarSessionId` / `demoRadarActivationId`). It must
   * never replace or renew an effectively active interactive demo user's presence
   * (real browser session ownership). Deliberate start/takeover/stop remain the
   * only paths that transfer interactive ownership.
   */
  async ensureCityCohort(
    client: PoolClient,
    viewerUserId: string,
    cityId: string,
    now: Date,
  ): Promise<void> {
    const region = regionForDemoCity(cityId);
    const peers = await client.query<{ user_id: string }>(
      `SELECT user_id
       FROM player_social_profiles
       WHERE city_id = $1
         AND social_eligible = true
         AND radar_consented = true
         AND radar_consent_policy_version = $2
         AND user_id <> $3
         AND user_id = ANY($4::uuid[])`,
      [
        cityId,
        RADAR_POLICY_VERSION,
        viewerUserId,
        DEMO_PERSON_ORDINALS.map(demoUserId),
      ],
    );

    for (const row of peers.rows) {
      const ordinal = ordinalFromDemoUserId(row.user_id);
      if (ordinal === null) continue;
      const sessionId = demoRadarSessionId(ordinal);
      const activationId = demoRadarActivationId(ordinal);
      await client.query(
        `INSERT INTO app_sessions
           (id, user_id, audience, session_hash, csrf_ciphertext, expires_at)
         VALUES ($1, $2, 'consumer_browser', $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET revoked_at = NULL,
               expires_at = EXCLUDED.expires_at,
               user_id = EXCLUDED.user_id`,
        [
          sessionId,
          row.user_id,
          `demo-radar-hash-${ordinal}`,
          `demo-radar-csrf-${ordinal}`,
          new Date(now.getTime() + 24 * 60 * 60 * 1000),
        ],
      );

      const fix = syntheticDemoFix(cityId, ordinal, now);
      const coarse = await quantizeFix(client, fix, now, [region]);
      const hardExpiresAt = new Date(
        now.getTime() + RADAR_HARD_LIFETIME_MINUTES * 60 * 1000,
      );
      const expiresAt = new Date(
        now.getTime() + RADAR_TTL_DEFAULT_MINUTES * 60 * 1000,
      );
      const foregroundUntil = new Date(
        now.getTime() + RADAR_FOREGROUND_LEASE_SECONDS * 1000,
      );
      const locationValidUntil = new Date(
        now.getTime() + RADAR_LOCATION_VALID_MINUTES * 60 * 1000,
      );
      const nextLocationUpdateAt = new Date(
        now.getTime() + RADAR_LOCATION_UPDATE_MINUTES * 60 * 1000,
      );

      // Upsert only when absent, already owned by this synthetic fixture session,
      // or no longer effectively active. Interactive ownership is left untouched.
      await client.query(
        `INSERT INTO radar_presences (
           user_id, activation_id, owner_session_id, version, policy_version, region_id,
           started_at, expires_at, hard_expires_at, foreground_until, location_valid_until,
           next_location_update_at, next_radius_change_at, radius_changes_window_started_at,
           radius_changes_in_window, cell_i, cell_j, coarse_center, radius_bucket_km
         ) VALUES (
           $1,$2,$3,1,$4,$5,
           $6,$7,$8,$9,$10,
           $11,$6,$6,
           0,$12,$13,
           ST_SetSRID(ST_MakePoint($14::float8,$15::float8),4326)::geography,
           5
         )
         ON CONFLICT (user_id) DO UPDATE SET
           activation_id = EXCLUDED.activation_id,
           owner_session_id = EXCLUDED.owner_session_id,
           version = radar_presences.version + 1,
           policy_version = EXCLUDED.policy_version,
           region_id = EXCLUDED.region_id,
           started_at = EXCLUDED.started_at,
           expires_at = EXCLUDED.expires_at,
           hard_expires_at = EXCLUDED.hard_expires_at,
           foreground_until = EXCLUDED.foreground_until,
           location_valid_until = EXCLUDED.location_valid_until,
           next_location_update_at = EXCLUDED.next_location_update_at,
           next_radius_change_at = EXCLUDED.next_radius_change_at,
           radius_changes_window_started_at = EXCLUDED.radius_changes_window_started_at,
           radius_changes_in_window = 0,
           cell_i = EXCLUDED.cell_i,
           cell_j = EXCLUDED.cell_j,
           coarse_center = EXCLUDED.coarse_center,
           radius_bucket_km = EXCLUDED.radius_bucket_km,
           updated_at = EXCLUDED.started_at
         WHERE radar_presences.owner_session_id = EXCLUDED.owner_session_id
            OR NOT (
              radar_presences.expires_at > EXCLUDED.started_at
              AND radar_presences.foreground_until > EXCLUDED.started_at
              AND radar_presences.location_valid_until > EXCLUDED.started_at
              AND radar_presences.policy_version = EXCLUDED.policy_version
            )`,
        [
          row.user_id,
          activationId,
          sessionId,
          RADAR_POLICY_VERSION,
          coarse.regionId,
          now,
          expiresAt,
          hardExpiresAt,
          foregroundUntil,
          locationValidUntil,
          nextLocationUpdateAt,
          coarse.cellI,
          coarse.cellJ,
          coarse.longitude,
          coarse.latitude,
        ],
      );
    }
  }
}
