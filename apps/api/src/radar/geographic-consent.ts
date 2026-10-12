import type { PoolClient } from "pg";
import { forbidden, unprocessable } from "../auth/problem";
import {
  consentSchema,
  GEO_DISCLOSURE_HASH,
  GEO_DISCLOSURE_ID,
  GEO_DISCLOSURE_TEXT,
  GEO_POLICY,
} from "./geographic-contract";

/** Caller holds actor/profile fence. Receipt is non-geographic evidence, never bearer authority. */
export async function ensureGeographicConsent(
  client: PoolClient,
  userId: string,
  policy: unknown,
  consent?: unknown,
): Promise<string> {
  if (policy !== GEO_POLICY)
    throw unprocessable(
      "CONSENT_POLICY_VERSION_INVALID",
      "Требуется текущая версия согласия Radar",
    );
  if (consent !== undefined && !consentSchema.safeParse(consent).success)
    throw unprocessable(
      "RADAR_DISCLOSURE_INVALID",
      "Требуется точное согласие с раскрытием Radar",
    );
  const registry = await client.query(
    `SELECT 1 FROM radar_disclosures WHERE policy_version=$1 AND disclosure_id=$2 AND disclosure_sha256=$3 AND locale='ru' AND disclosure_text=$4`,
    [GEO_POLICY, GEO_DISCLOSURE_ID, GEO_DISCLOSURE_HASH, GEO_DISCLOSURE_TEXT],
  );
  if (!registry.rows[0])
    throw forbidden(
      "RADAR_DISCLOSURE_UNAVAILABLE",
      "Раскрытие Radar недоступно",
    );
  const current = await client.query<{ id: string }>(
    `SELECT e.id FROM player_social_profiles p JOIN radar_consent_events e
    ON e.id=p.radar_consent_evidence_id AND e.user_id=p.user_id AND e.event_type='accepted' AND e.policy_version=$2
    WHERE p.user_id=$1 AND p.radar_consented AND p.radar_consent_policy_version=$2
      AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id AND w.event_type='withdrawn')`,
    [userId, GEO_POLICY],
  );
  if (current.rows[0]) return current.rows[0].id;
  if (consent === undefined)
    throw forbidden(
      "RADAR_CONSENT_REQUIRED",
      "Требуется новое согласие на географический Radar",
    );
  const accepted = await client.query<{ id: string }>(
    `INSERT INTO radar_consent_events(user_id,event_type,policy_version,disclosure_id,disclosure_sha256,locale,source)
    VALUES($1,'accepted',$2,$3,$4,'ru','radar_enable') RETURNING id`,
    [userId, GEO_POLICY, GEO_DISCLOSURE_ID, GEO_DISCLOSURE_HASH],
  );
  const id = accepted.rows[0]!.id;
  await client.query(
    `UPDATE player_social_profiles SET radar_consented=true,radar_consent_policy_version=$2,
    radar_consented_at=clock_timestamp(),radar_consent_evidence_id=$3,version=version+1,updated_at=clock_timestamp() WHERE user_id=$1`,
    [userId, GEO_POLICY, id],
  );
  return id;
}

/** Called inside the existing profile withdrawal transaction even when feature flags are off. */
export async function withdrawGeographicConsent(
  client: PoolClient,
  userId: string,
) {
  await client.query(
    `INSERT INTO radar_consent_events(user_id,event_type,policy_version,disclosure_id,disclosure_sha256,locale,source,reverses_event_id)
    SELECT e.user_id,'withdrawn',e.policy_version,e.disclosure_id,e.disclosure_sha256,e.locale,'radar_consent_withdraw',e.id
    FROM player_social_profiles p JOIN radar_consent_events e ON e.id=p.radar_consent_evidence_id AND e.user_id=p.user_id AND e.event_type='accepted'
    WHERE p.user_id=$1 AND NOT EXISTS(SELECT 1 FROM radar_consent_events w WHERE w.reverses_event_id=e.id)
    ON CONFLICT (reverses_event_id) WHERE reverses_event_id IS NOT NULL DO NOTHING`,
    [userId],
  );
  await client.query(
    "UPDATE player_social_profiles SET radar_consent_evidence_id=NULL WHERE user_id=$1",
    [userId],
  );
  await client.query("DELETE FROM radar_presences WHERE user_id=$1", [userId]);
}
