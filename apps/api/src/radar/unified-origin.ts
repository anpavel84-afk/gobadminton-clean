import type { PoolClient } from "pg";
import { notFound } from "../auth/problem";
import { UNIFIED_POLICY, type UnifiedOrigin } from "./unified-contract";
export async function assertUnifiedOrigin(
  client: PoolClient,
  origin: UnifiedOrigin,
) {
  if (origin.expiresAt <= Date.now())
    throw notFound(
      "RESOURCE_UNAVAILABLE",
      "Источник местоположения недоступен",
    );
  if (!origin.activationId) return;
  const r = await client.query(
    `SELECT 1 FROM radar_presences r JOIN player_social_profiles p ON p.user_id=r.user_id
 JOIN users u ON u.id=r.user_id AND u.status='active'
 JOIN app_sessions s ON s.id=r.owner_session_id AND s.user_id=r.user_id AND s.audience='consumer_browser' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
 JOIN radar_consent_events e ON e.id=r.consent_evidence_id AND e.id=p.radar_consent_evidence_id AND e.user_id=r.user_id AND e.event_type='accepted' AND e.policy_version=$7
 WHERE r.user_id=$1 AND r.owner_session_id=$2 AND r.activation_id=$3 AND r.version=$4 AND r.region_id=$5 AND r.location_model=$6 AND r.policy_version=$7
 AND p.social_eligible AND p.radar_consented AND p.radar_consent_policy_version=$7
 AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id)
 AND LEAST(r.expires_at,r.hard_expires_at,r.foreground_until,r.location_valid_until)>clock_timestamp()`,
    [
      origin.viewerId,
      origin.sessionId,
      origin.activationId,
      origin.version,
      origin.regionId,
      origin.model,
      UNIFIED_POLICY,
    ],
  );
  if (!r.rows[0])
    throw notFound(
      "RESOURCE_UNAVAILABLE",
      "Источник местоположения недоступен",
    );
}
