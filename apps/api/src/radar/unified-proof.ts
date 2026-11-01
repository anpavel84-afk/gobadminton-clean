import type { AppEnv } from "../config/env";
import { DEV_MOSCOW_PEER_IDS, devMoscowFixturesEnabled } from "./dev-moscow-test";
import { unrestrictedSql } from "../restrictions/policy";
import type { PoolClient } from "pg";
import { notFound } from "../auth/problem";
import {
  UNIFIED_POLICY,
  publicGeo,
  distanceEstimate,
  type UnifiedProof,
  type UnifiedPoint,
} from "./unified-contract";
import { assertUnifiedOrigin } from "./unified-origin";
import { geographicCity } from "./geographic-contract";
import { isDemoUuid } from "../database/demo-ids";
import { safePublicDisplayName } from "../profiles/social-profile-defaults";
import type { RedeemedRadarProof } from "./radar-proof.service";
const unavailable = (): never => {
  throw notFound("RESOURCE_UNAVAILABLE", "Результат Radar недоступен");
};
export async function redeemUnifiedProof(
  client: PoolClient,
  p: UnifiedProof,
  held = false,
  restrictionsEnabled = false,
  env?: AppEnv,
): Promise<RedeemedRadarProof> {
  const c = p.context;
  if (
    c.wire !== "players-unified-radar-v1" ||
    (c.origin &&
      (c.origin.viewerId !== c.viewerId ||
        c.origin.sessionId !== c.sessionId ||
        c.origin.cityId !== c.filters.cityId ||
        c.origin.regionId !== c.regionId ||
        c.origin.mode !== c.mode)) ||
    (DEV_MOSCOW_PEER_IDS.includes(p.targetId) && (!devMoscowFixturesEnabled(env) || c.mode !== "live")) ||
    c.viewerId === p.targetId ||
    isDemoUuid(c.viewerId) !== isDemoUuid(p.targetId) ||
    isDemoUuid(p.targetId) !== (c.mode === "synthetic_demo")
  )
    unavailable();
  try {
    if (geographicCity(c.filters.cityId, c.mode).regionId !== c.regionId)
      unavailable();
  } catch {
    unavailable();
  }
  if (!held)
    await client.query(
      "SELECT user_id FROM radar_presences WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR SHARE",
      [[p.targetId, ...(c.origin?.activationId ? [c.viewerId] : [])].sort()],
    );
  if (
    p.expiresAt <= Date.now() ||
    p.expiresAt > c.expiresAt ||
    c.asOf > Date.now() ||
    c.expiresAt <= Date.now()
  )
    unavailable();
  if (c.origin) {
    try {
      await assertUnifiedOrigin(client, c.origin);
    } catch {
      unavailable();
    }
  }
  const name = (c.filters.name ?? "").trim().toLowerCase();
  const prefix =
    name.length >= 2 ? name.replace(/[\\%_]/g, "\\$&") + "%" : null;
  const r = await client.query<{
    public_player_id: string;
    display_name: string;
    level_scale_id: string | null;
    level_scale_version: number | null;
    level_id: string | null;
    trainer: boolean;
    latitude: number;
    longitude: number;
    grid_size_meters: 100 | 1000;
    source_accuracy_meters: number;
    source_captured_at: Date;
    location_model: UnifiedPoint["model"];
    dist_m: number | null;
    deadline: Date;
  }>(
    `
 WITH origin AS(SELECT CASE WHEN $12::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($13::float8,$12::float8),4326)::geography END g)
 SELECT p.public_player_id,p.display_name,p.level_scale_id,p.level_scale_version,p.level_id,
 EXISTS(SELECT 1 FROM trainer_profiles tp WHERE tp.user_id=p.user_id AND tp.status='active') trainer,
 ST_Y(r.coarse_center::geometry) latitude,ST_X(r.coarse_center::geometry) longitude,r.grid_size_meters,r.source_accuracy_meters,r.source_captured_at,r.location_model,
 CASE WHEN o.g IS NULL THEN NULL ELSE ST_Distance(r.coarse_center,o.g,true) END dist_m,
 LEAST(r.expires_at,r.hard_expires_at,r.foreground_until,r.location_valid_until,s.expires_at) deadline
 FROM radar_presences r JOIN player_social_profiles p ON p.user_id=r.user_id JOIN users u ON u.id=r.user_id AND u.status='active'
 JOIN app_sessions s ON s.id=r.owner_session_id AND s.user_id=r.user_id AND s.revoked_at IS NULL AND s.audience='consumer_browser' AND s.expires_at>clock_timestamp()
 JOIN radar_consent_events e ON e.id=r.consent_evidence_id AND e.id=p.radar_consent_evidence_id AND e.user_id=r.user_id AND e.event_type='accepted' AND e.policy_version=$9 CROSS JOIN origin o
 WHERE ${unrestrictedSql(restrictionsEnabled,"r.user_id",["account.access","profile.public","social.radar"])} AND ${unrestrictedSql(restrictionsEnabled,"$1",["account.access","profile.public","social.radar"])} AND r.user_id=$3 AND r.activation_id=$4 AND r.version=$5 AND r.owner_session_id=$6 AND r.consent_evidence_id=$7 AND r.location_model=$8 AND r.policy_version=$9 AND r.region_id=$10 AND p.public_player_id=$11
 AND p.social_eligible AND p.radar_consented AND p.radar_consent_policy_version=$9 AND btrim(p.display_name)<>''
 AND LEAST(r.expires_at,r.hard_expires_at,r.foreground_until,r.location_valid_until)>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id)
 AND EXISTS(SELECT 1 FROM users vu JOIN app_sessions vs ON vs.user_id=vu.id WHERE vu.id=$1 AND vu.status='active' AND vs.id=$2 AND vs.revoked_at IS NULL AND vs.audience='consumer_browser' AND vs.expires_at>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM player_social_profiles vp WHERE vp.user_id=$1 AND NOT vp.social_eligible)
 AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=$3) OR (b.blocker_user_id=$3 AND b.blocked_user_id=$1))
 AND ($14::text IS NULL OR p.directory_visible AND p.area_key=$14)
 AND ($15::text IS NULL OR lower(p.display_name) LIKE $15 ESCAPE '\\')
 AND (NOT $16::boolean OR p.directory_visible AND EXISTS(SELECT 1 FROM player_looking_intents li WHERE li.user_id=p.user_id AND li.active AND li.expires_at>clock_timestamp()))
 AND (NOT $17::boolean OR EXISTS(SELECT 1 FROM trainer_profiles tp WHERE tp.user_id=p.user_id AND tp.status='active'))`,
    [
      c.viewerId,
      c.sessionId,
      p.targetId,
      p.activationId,
      p.version,
      p.ownerSessionId,
      p.receiptId,
      p.model,
      UNIFIED_POLICY,
      c.regionId,
      p.publicId,
      c.origin?.latitude ?? null,
      c.origin?.longitude ?? null,
      c.filters.areaKey || null,
      prefix,
      c.filters.looking === true,
      c.filters.trainer === true,
    ],
  );
  const row = r.rows[0];
  if (!row) return unavailable();
  const point: UnifiedPoint = {
    latitude: row.latitude,
    longitude: row.longitude,
    grid: row.grid_size_meters,
    accuracy: row.source_accuracy_meters,
    capturedAt: row.source_captured_at.getTime(),
    model: row.location_model,
  };
  return {
    targetUserId: p.targetId,
    publicPlayerId: row.public_player_id,
    displayName: safePublicDisplayName(row.display_name),
    levelScaleId: row.level_scale_id,
    levelScaleVersion: row.level_scale_version,
    levelId: row.level_id,
    trainer: row.trainer,
    proximityBand: null,
    radiusBucketKm: null,
    radar: {
      consentPolicyVersion: UNIFIED_POLICY,
      geo: publicGeo(point, Date.now()),
      validUntil: new Date(
        Math.min(p.expiresAt, row.deadline.getTime()),
      ).toISOString(),
      distance:
        c.origin && row.dist_m !== null
          ? distanceEstimate(row.dist_m, point, c.origin)
          : null,
    },
  };
}
