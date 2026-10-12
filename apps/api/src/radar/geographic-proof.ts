import { unrestrictedSql } from "../restrictions/policy";
import type { PoolClient } from "pg";
import { notFound } from "../auth/problem";
import { isDemoUuid } from "../database/demo-ids";
import {
  displayLocation,
  GEO_POLICY,
  geographicCity,
  type GeographicProof,
} from "./geographic-contract";
import { assertCurrentOrigin } from "./geographic.service";
import type { RedeemedRadarProof } from "./radar-proof.service";

function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Результат Radar недоступен");
}

/** Pair and command object fences precede this last visibility fence.
 * No user/profile/session lock acquisition after presence. Revokers invalidate
 * presence in the eligibility transaction. Use wall clock AFTER all waits.
 */
export async function redeemGeographicProof(
  client: PoolClient,
  payload: GeographicProof,
  visibilityAlreadyHeld = false,
  restrictionsEnabled = false,
): Promise<RedeemedRadarProof> {
  let region: ReturnType<typeof geographicCity>;
  try {
    region = geographicCity(payload.cityId, payload.exposureMode);
  } catch {
    unavailable();
  }
  if (
    region.regionId !== payload.regionId ||
    isDemoUuid(payload.viewerUserId) !== isDemoUuid(payload.targetUserId) ||
    isDemoUuid(payload.targetUserId) !==
      (payload.exposureMode === "synthetic_demo")
  )
    unavailable();
  const ids = [
    payload.targetUserId,
    ...(payload.origin?.activationId ? [payload.viewerUserId] : []),
  ].sort();
  if (!visibilityAlreadyHeld)
    await client.query(
      `SELECT user_id FROM radar_presences WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE`,
      [ids],
    );
  const now = Date.now();
  if (
    payload.expiresAt <= now ||
    payload.issuedAt > now ||
    (payload.origin && payload.origin.expiresAt <= now)
  )
    unavailable();
  if (payload.origin) {
    try {
      await assertCurrentOrigin(client, payload.origin);
    } catch {
      unavailable();
    }
  }
  const r = await client.query<{
    public_player_id: string;
    display_name: string;
    level_scale_id: string | null;
    level_scale_version: number | null;
    level_id: string | null;
    trainer: boolean;
    latitude: number;
    longitude: number;
    dist_m: number | null;
  }>(
    `WITH origin AS (SELECT CASE WHEN $11::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($12::float8,$11::float8),4326)::geography END AS g)
    SELECT p.public_player_id,p.display_name,p.level_scale_id,p.level_scale_version,p.level_id,
      EXISTS(SELECT 1 FROM trainer_profiles tp WHERE tp.user_id=r.user_id AND tp.status='active') AS trainer,
      ST_Y(r.coarse_center::geometry) AS latitude,ST_X(r.coarse_center::geometry) AS longitude,
      CASE WHEN o.g IS NULL THEN NULL ELSE ST_Distance(r.coarse_center,o.g) END AS dist_m
    FROM radar_presences r JOIN player_social_profiles p ON p.user_id=r.user_id
    JOIN users u ON u.id=r.user_id AND u.status='active'
    JOIN app_sessions s ON s.id=r.owner_session_id AND s.user_id=r.user_id AND s.revoked_at IS NULL AND s.audience='consumer_browser' AND s.expires_at>clock_timestamp()
    JOIN radar_consent_events e ON e.id=r.consent_evidence_id AND e.id=p.radar_consent_evidence_id AND e.user_id=r.user_id AND e.event_type='accepted' AND e.policy_version=$7
    CROSS JOIN origin o
    WHERE ${unrestrictedSql(restrictionsEnabled,"r.user_id",["account.access","profile.public","social.radar"])} AND ${unrestrictedSql(restrictionsEnabled,"$1",["account.access","profile.public","social.radar"])} AND r.user_id=$3 AND r.activation_id=$4 AND r.version=$5 AND r.region_id=$6 AND r.policy_version=$7 AND p.public_player_id=$8
      AND r.expires_at>clock_timestamp() AND r.hard_expires_at>clock_timestamp() AND r.foreground_until>clock_timestamp() AND r.location_valid_until>clock_timestamp()
      AND p.social_eligible AND p.radar_consented AND p.radar_consent_policy_version=$7 AND btrim(p.display_name)<>''
      AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id)
      AND EXISTS(SELECT 1 FROM users vu JOIN app_sessions vs ON vs.user_id=vu.id WHERE vu.id=$1 AND vu.status='active'
        AND vs.id=$2 AND vs.revoked_at IS NULL AND vs.audience='consumer_browser' AND vs.expires_at>clock_timestamp())
      AND NOT EXISTS(SELECT 1 FROM player_social_profiles vp WHERE vp.user_id=$1 AND NOT vp.social_eligible)
      AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$3) OR (b.blocker_user_id=$3 AND b.blocked_user_id=$1))
      AND ($9='city' OR ST_DWithin(r.coarse_center,o.g,$10::int*1000))`,
    [
      payload.viewerUserId,
      payload.viewerSessionId,
      payload.targetUserId,
      payload.targetActivationId,
      payload.targetVersion,
      payload.regionId,
      GEO_POLICY,
      payload.targetPublicPlayerId,
      payload.scope,
      payload.radiusBucketKm,
      payload.origin?.latitude ?? null,
      payload.origin?.longitude ?? null,
    ],
  );
  const row = r.rows[0];
  if (!row) unavailable();
  return {
    targetUserId: payload.targetUserId,
    publicPlayerId: row.public_player_id,
    displayName: row.display_name,
    levelScaleId: row.level_scale_id,
    levelScaleVersion: row.level_scale_version,
    levelId: row.level_id,
    trainer: row.trainer,
    displayLocation: displayLocation(row.latitude, row.longitude),
    proximityBand:
      row.dist_m === null
        ? null
        : row.dist_m <= 3000
          ? "near"
          : row.dist_m <= 5000
            ? "middle"
            : "outer",
    radiusBucketKm: payload.radiusBucketKm,
  };
}
