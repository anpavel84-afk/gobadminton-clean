import { unrestrictedSql } from "../restrictions/policy";
import type { PoolClient } from "pg";
import {
  RADAR_BAND_MIDDLE_M,
  RADAR_BAND_NEAR_M,
  RADAR_POLICY_VERSION,
  RADAR_RESULT_CAP,
  RADAR_SPARSE_K,
  type RadarRadiusBucketKm,
} from "./constants";
import { orderingEpoch, stableRankScore } from "./result-ref";

export type NearbyCandidateRow = {
  user_id: string;
  activation_id: string;
  version: string | number;
  public_player_id: string;
  display_name: string;
  level_scale_id: string | null;
  level_scale_version: number | null;
  level_id: string | null;
  trainer: boolean;
  dist_m: number;
};

export function bandForDistance(
  distM: number,
  radiusKm: RadarRadiusBucketKm,
): "near" | "middle" | "outer" | null {
  if (distM <= RADAR_BAND_NEAR_M && radiusKm >= 3) return "near";
  if (distM <= RADAR_BAND_MIDDLE_M && radiusKm >= 5) {
    return distM <= RADAR_BAND_NEAR_M ? "near" : "middle";
  }
  if (distM <= radiusKm * 1000) {
    if (distM <= RADAR_BAND_NEAR_M) return "near";
    if (distM <= RADAR_BAND_MIDDLE_M) return "middle";
    return "outer";
  }
  return null;
}

export async function selectEligibleNearbyCandidates(
  client: PoolClient,
  viewerUserId: string,
  now: Date,
  restrictionsEnabled = false,
): Promise<NearbyCandidateRow[]> {
  // WITH TIES includes the complete cutoff bucket so JS can apply the keyed
  // epoch tie-break identically for nearby and proof revalidation. Never cap
  // an unordered candidate set; no exact-distance secondary ordering.
  const result = await client.query<NearbyCandidateRow>(
    `WITH eligible AS (SELECT
       r.user_id,
       r.activation_id,
       r.version,
       p.public_player_id,
       p.display_name,
       p.level_scale_id,
       p.level_scale_version,
       p.level_id,
       EXISTS (
         SELECT 1 FROM trainer_profiles tp
         WHERE tp.user_id = r.user_id AND tp.status = 'active'
       ) AS trainer,
       ST_Distance(r.coarse_center, v.coarse_center) AS dist_m
     FROM radar_presences r
     INNER JOIN radar_presences v ON v.user_id = $1
     INNER JOIN player_social_profiles p ON p.user_id = r.user_id
     INNER JOIN users u ON u.id = r.user_id AND u.status = 'active'
     INNER JOIN app_sessions s
       ON s.id = r.owner_session_id
      AND s.revoked_at IS NULL
      AND s.expires_at > $2
     WHERE r.user_id <> $1
       -- Partition before cohort counting/cap/proof selection; demo cannot seed a live cohort.
       AND (r.user_id::text ~ '^d0f0[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$')
         = ($1::text ~ '^d0f0[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$')
       AND r.policy_version = $3
       AND r.region_id = v.region_id
       AND r.expires_at > $2
       AND r.foreground_until > $2
       AND r.location_valid_until > $2
       AND p.radar_consented = true
       AND p.radar_consent_policy_version = $3
       AND p.social_eligible = true
       AND ${unrestrictedSql(restrictionsEnabled, "r.user_id", ["account.access", "profile.public", "social.radar"])}
       AND ST_DWithin(r.coarse_center, v.coarse_center, v.radius_bucket_km * 1000)
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks b
         WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = r.user_id)
            OR (b.blocker_user_id = r.user_id AND b.blocked_user_id = $1)
       )
     )
     SELECT * FROM eligible
     ORDER BY CASE WHEN dist_m <= $4 THEN 0 WHEN dist_m <= $5 THEN 1 ELSE 2 END,
              floor(dist_m / 1000)
     FETCH FIRST $6 ROWS WITH TIES`,
    [viewerUserId, now, RADAR_POLICY_VERSION, RADAR_BAND_NEAR_M, RADAR_BAND_MIDDLE_M, RADAR_RESULT_CAP],
  );
  return result.rows;
}

export function rankCurrentCohort(
  pepper: string,
  viewerUserId: string,
  radiusBucketKm: RadarRadiusBucketKm,
  now: Date,
  candidates: NearbyCandidateRow[],
): NearbyCandidateRow[] {
  const eligible = candidates.filter(
    (c) => bandForDistance(c.dist_m, radiusBucketKm) !== null,
  );
  if (eligible.length < RADAR_SPARSE_K) {
    return [];
  }
  const epoch = orderingEpoch(now);
  return eligible
    .map((row) => ({
      row,
      band: row.dist_m <= RADAR_BAND_NEAR_M ? 0 : row.dist_m <= RADAR_BAND_MIDDLE_M ? 1 : 2,
      bucket: Math.floor(row.dist_m / 1000),
      rank: stableRankScore(pepper, viewerUserId, row.user_id, epoch),
    }))
    .sort((a, b) => a.band - b.band || a.bucket - b.bucket || a.rank - b.rank || a.row.user_id.localeCompare(b.row.user_id))
    .slice(0, RADAR_RESULT_CAP)
    .map((item) => item.row);
}
