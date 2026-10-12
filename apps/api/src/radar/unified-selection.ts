import { unrestrictedSql } from "../restrictions/policy";
import type { PoolClient } from "pg";
import type { UnifiedContext, UnifiedCursor } from "./unified-contract";
import { UNIFIED_POLICY } from "./unified-contract";

export type UnifiedRow = {
  user_id: string | null;
  public_player_id: string;
  display_name: string;
  name_key: string;
  city_id: string | null;
  area_key: string | null;
  bio: string | null;
  level_scale_id: string | null;
  level_scale_version: number | null;
  level_id: string | null;
  trainer: boolean;
  looking: boolean | null;
  directory_visible: boolean;
  activation_id: string | null;
  owner_session_id: string;
  consent_evidence_id: string;
  version: string;
  latitude: number;
  longitude: number;
  grid_size_meters: 100 | 1000;
  source_accuracy_meters: number;
  source_captured_at: Date;
  location_model: "regional_grid_100m_v1" | "regional_grid_1000m_v1";
  dist_m: number | null;
  distance_key: number;
  group_key: number;
  rank: string;
  valid_until: Date;
  matching_total: string;
  radar_total: string;
  ordinary_total: string;
  set_deadline: Date | null;
};
/** Full identity union, projection, filters, counts, expiry and ordering before keyset LIMIT. No JS cohort merge. */
export async function selectUnified(
  client: PoolClient,
  context: UnifiedContext,
  cursor: UnifiedCursor | null,
  limit: number,
  map = false,
  restrictionsEnabled = false,
): Promise<UnifiedRow[]> {
  const f = context.filters;
  const name = (f.name ?? "").trim().toLowerCase();
  const prefix =
    name.length >= 2 ? name.replace(/[\\%_]/g, "\\$&") + "%" : null;
  const r = await client.query<UnifiedRow>(
    `
 WITH origin AS (SELECT CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7::float8,$6::float8),4326)::geography END g),
 publishers AS MATERIALIZED (
  SELECT r.*,LEAST(r.expires_at,r.hard_expires_at,r.foreground_until,r.location_valid_until,s.expires_at) pub_deadline
  FROM radar_presences r JOIN app_sessions s ON s.id=r.owner_session_id AND s.user_id=r.user_id
  JOIN player_social_profiles p ON p.user_id=r.user_id
  JOIN radar_consent_events e ON e.id=r.consent_evidence_id AND e.id=p.radar_consent_evidence_id AND e.user_id=r.user_id
  WHERE ${unrestrictedSql(restrictionsEnabled,"r.user_id",["account.access","profile.public","social.radar"])} AND r.policy_version=$5 AND r.region_id=$3 AND r.location_model IS NOT NULL
   AND e.policy_version=$5 AND e.event_type='accepted' AND p.radar_consented AND p.radar_consent_policy_version=$5
   AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id)
   AND s.revoked_at IS NULL AND s.audience='consumer_browser' AND s.expires_at>to_timestamp($8::float8/1000)
   AND r.expires_at>to_timestamp($8::float8/1000) AND r.hard_expires_at>to_timestamp($8::float8/1000)
   AND r.foreground_until>to_timestamp($8::float8/1000) AND r.location_valid_until>to_timestamp($8::float8/1000)
 ), projected AS MATERIALIZED (
  SELECT p.user_id,p.public_player_id,p.display_name,lower(p.display_name) name_key,(p.directory_visible AND ${unrestrictedSql(restrictionsEnabled,"p.user_id",["social.directory"])}) AS directory_visible,
   CASE WHEN (p.directory_visible AND ${unrestrictedSql(restrictionsEnabled,"p.user_id",["social.directory"])}) THEN p.city_id ELSE NULL END city_id,
   CASE WHEN (p.directory_visible AND ${unrestrictedSql(restrictionsEnabled,"p.user_id",["social.directory"])}) THEN p.area_key ELSE NULL END area_key,
   CASE WHEN (p.directory_visible AND ${unrestrictedSql(restrictionsEnabled,"p.user_id",["social.directory"])}) THEN p.bio ELSE NULL END bio,
   p.level_scale_id,p.level_scale_version,p.level_id,
   EXISTS(SELECT 1 FROM trainer_profiles tp WHERE tp.user_id=p.user_id AND tp.status='active') trainer,
   CASE WHEN (p.directory_visible AND ${unrestrictedSql(restrictionsEnabled,"p.user_id",["social.directory"])}) THEN li.deadline IS NOT NULL ELSE NULL END looking,
   CASE WHEN r.user_id IS NOT NULL THEN $2::uuid ELSE p.city_id END effective_city,
   r.activation_id,r.owner_session_id,r.consent_evidence_id,r.version,r.location_model,r.grid_size_meters,r.source_accuracy_meters,r.source_captured_at,
   ST_Y(r.coarse_center::geometry) latitude,ST_X(r.coarse_center::geometry) longitude,
   CASE WHEN o.g IS NULL OR r.user_id IS NULL THEN NULL ELSE ST_Distance(r.coarse_center,o.g,true) END dist_m,
   CASE WHEN r.user_id IS NULL THEN 1 ELSE 0 END group_key,
   r.pub_deadline valid_until,LEAST(r.pub_deadline,CASE WHEN (p.directory_visible AND ${unrestrictedSql(restrictionsEnabled,"p.user_id",["social.directory"])}) THEN li.deadline ELSE NULL END) row_deadline
  FROM player_social_profiles p JOIN users u ON u.id=p.user_id AND u.status='active'
  LEFT JOIN publishers r ON r.user_id=p.user_id CROSS JOIN origin o
  LEFT JOIN LATERAL (SELECT min(expires_at) deadline FROM player_looking_intents WHERE user_id=p.user_id AND active AND expires_at>to_timestamp($8::float8/1000)) li ON true
  WHERE ${unrestrictedSql(restrictionsEnabled,"p.user_id",["account.access","profile.public"])} AND p.social_eligible AND btrim(p.display_name)<>'' AND p.user_id<>$1 AND ((p.directory_visible AND ${unrestrictedSql(restrictionsEnabled,"p.user_id",["social.directory"])}) OR r.user_id IS NOT NULL)
   AND (p.user_id::text ~ '^d0f0[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$')=($4='synthetic_demo')
   AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id=$1 AND b.blocked_user_id=p.user_id) OR (b.blocker_user_id=p.user_id AND b.blocked_user_id=$1))
 ), filtered AS MATERIALIZED (
  SELECT *,coalesce(dist_m,0) distance_key FROM projected WHERE effective_city=$2
   AND ($9::text IS NULL OR area_key=$9) AND ($10::text IS NULL OR name_key LIKE $10 ESCAPE '\\')
   AND (NOT $11::boolean OR looking=true) AND (NOT $12::boolean OR trainer=true)
 ), ranked AS (
  SELECT *,row_number() OVER(ORDER BY group_key,distance_key,name_key,public_player_id) rank FROM filtered
 ), stats AS (
  SELECT count(*) matching_total,count(*) FILTER(WHERE group_key=0) radar_total,count(*) FILTER(WHERE group_key=1) ordinary_total,min(row_deadline) set_deadline FROM filtered
 ), page AS (
  SELECT * FROM ranked WHERE (NOT $18::boolean OR group_key=0) AND
   ($13::int IS NULL OR (group_key,distance_key,name_key,public_player_id)>($13::int,$14::float8,$15::text,$16::uuid))
  ORDER BY group_key,distance_key,name_key,public_player_id LIMIT $17
 ) SELECT stats.*,page.* FROM stats LEFT JOIN page ON true ORDER BY page.rank`,
    [
      context.viewerId,
      f.cityId,
      context.regionId,
      context.mode,
      UNIFIED_POLICY,
      context.origin?.latitude ?? null,
      context.origin?.longitude ?? null,
      context.asOf,
      f.areaKey || null,
      prefix,
      f.looking === true,
      f.trainer === true,
      cursor?.group ?? null,
      cursor?.distance ?? null,
      cursor?.name ?? null,
      cursor?.publicId ?? null,
      limit + 1,
      map,
    ],
  );
  return r.rows;
}
