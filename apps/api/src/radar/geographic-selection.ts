import { DEV_MOSCOW_PEER_IDS } from "./dev-moscow-test";
import { unrestrictedSql } from "../restrictions/policy";
import type { PoolClient } from "pg";
import { GEO_POLICY, type PrivateOrigin } from "./geographic-contract";
import type { RadarExposureMode } from "./constants";

export type GeographicCandidate = {
  user_id: string;
  public_player_id: string;
  activation_id: string;
  version: string;
  display_name: string;
  level_scale_id: string | null;
  level_scale_version: number | null;
  level_id: string | null;
  trainer: boolean;
  latitude: number;
  longitude: number;
  dist_m: number | null;
  valid_until: Date;
  avatar_key: string | null;
  provider_url: string | null;
  contactable: boolean;
};
/** One statement snapshot, deterministic total order BEFORE cap; no WITH TIES or unbounded JS cohort. */
export async function geographicCandidates(
  client: PoolClient,
  input: {
    restrictionsEnabled?: boolean;
    viewerId: string;
    regionId: string;
    mode: RadarExposureMode;
    scope: "city" | "nearby";
    origin: PrivateOrigin | null;
    radius: number | null;
    rankSeed: string;
  },
) {
  const result = await client.query<GeographicCandidate>(
    `WITH origin AS (SELECT CASE WHEN $5::float8 IS NULL THEN NULL ELSE
       ST_SetSRID(ST_MakePoint($6::float8,$5::float8),4326)::geography END AS g)
     SELECT r.user_id, p.public_player_id, r.activation_id, r.version,
       p.display_name, p.level_scale_id, p.level_scale_version, p.level_id, p.avatar_key,
       (SELECT e.avatar_url FROM external_identities e WHERE e.user_id=r.user_id
        AND e.provider_key IN ('vk','yandex') AND e.avatar_url IS NOT NULL ORDER BY e.created_at,e.id LIMIT 1) AS provider_url,
       (p.directory_visible AND p.contact_policy='requests'
        AND EXISTS(SELECT 1 FROM player_social_profiles vp WHERE vp.user_id=$1 AND vp.social_eligible)
        AND NOT EXISTS(SELECT 1 FROM conversations c WHERE c.kind='direct' AND
          ((c.initiator_user_id=$1 AND c.recipient_user_id=r.user_id) OR
           (c.initiator_user_id=r.user_id AND c.recipient_user_id=$1)))) AS contactable,
       EXISTS (SELECT 1 FROM trainer_profiles tp WHERE tp.user_id=r.user_id AND tp.status='active') AS trainer,
       ST_Y(r.coarse_center::geometry) AS latitude, ST_X(r.coarse_center::geometry) AS longitude,
       CASE WHEN o.g IS NULL THEN NULL ELSE ST_Distance(r.coarse_center,o.g) END AS dist_m,
       LEAST(r.expires_at,r.hard_expires_at,r.foreground_until,r.location_valid_until,s.expires_at) AS valid_until
     FROM radar_presences r
     JOIN player_social_profiles p ON p.user_id=r.user_id
     JOIN users u ON u.id=r.user_id AND u.status='active'
     JOIN app_sessions s ON s.id=r.owner_session_id AND s.user_id=r.user_id
       AND s.audience='consumer_browser' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
     JOIN radar_consent_events e ON e.id=r.consent_evidence_id AND e.id=p.radar_consent_evidence_id
       AND e.user_id=r.user_id AND e.event_type='accepted' AND e.policy_version=$4
     CROSS JOIN origin o
     WHERE ${unrestrictedSql(input.restrictionsEnabled??false,"r.user_id",["account.access","profile.public","social.radar"])} AND r.user_id<>$1 AND r.region_id=$2 AND r.policy_version=$4
       AND r.expires_at>clock_timestamp() AND r.hard_expires_at>clock_timestamp()
       AND r.foreground_until>clock_timestamp() AND r.location_valid_until>clock_timestamp()
       AND p.social_eligible AND p.radar_consented AND p.radar_consent_policy_version=$4
       AND btrim(p.display_name)<>''
       AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id AND w.event_type='withdrawn')
       AND r.user_id NOT IN (${DEV_MOSCOW_PEER_IDS.map(id => `'${id}'::uuid`).join(',')})
       AND (r.user_id::text ~ '^d0f0[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}$')=($3='synthetic_demo')
       AND ($7='city' OR ST_DWithin(r.coarse_center,o.g,$8::int*1000))
       AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
         (b.blocker_user_id=$1 AND b.blocked_user_id=r.user_id) OR
         (b.blocker_user_id=r.user_id AND b.blocked_user_id=$1))
     ORDER BY dist_m ASC NULLS LAST, md5($9 || ':' || p.public_player_id::text), p.public_player_id
     LIMIT 20`,
    [
      input.viewerId,
      input.regionId,
      input.mode,
      GEO_POLICY,
      input.origin?.latitude ?? null,
      input.origin?.longitude ?? null,
      input.scope,
      input.radius,
      input.rankSeed,
    ],
  );
  return result.rows;
}
