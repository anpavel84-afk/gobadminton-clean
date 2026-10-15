import type { AppEnv } from "../config/env";
import type { ActorFenceService } from "../common/actor-fence.service";
import type { PoolClient } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { MOSCOW_CITY_ID } from "../venues/venues.service";
import { quantizeUnified } from "./unified-location";
import { UNIFIED_POLICY, UNIFIED_DISCLOSURE_ID, UNIFIED_DISCLOSURE_HASH } from "./unified-contract";

const validActorId = (value: string | undefined) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) && !DEV_MOSCOW_PEER_IDS.includes(value);

// Reserved non-demo fixture identities. Never linked to any provider/login.
export const DEV_MOSCOW_PEER_IDS = Array.from({ length: 6 }, (_, i) =>
  `a17e2026-1014-4000-8000-${String(i + 1).padStart(12, "0")}`);
export function devMoscowFixturesEnabled(env: AppEnv | undefined): boolean {
  return !!env && ["mvp", "stage"].includes(env.APP_ENV) &&
    env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru" &&
    env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru" &&
    validActorId(env.RADAR_DEV_TEST_OWNER_USER_ID) &&
    (env.RADAR_DEV_TEST_SECOND_USER_ID === undefined || validActorId(env.RADAR_DEV_TEST_SECOND_USER_ID));
}
export function devMoscowTestAllowed(env: AppEnv | undefined, actorId: string): boolean {
  return devMoscowFixturesEnabled(env) && (actorId === env!.RADAR_DEV_TEST_OWNER_USER_ID || actorId === env!.RADAR_DEV_TEST_SECOND_USER_ID);
}
export const devMoscowTestLocation = { latitude: 55.7558, longitude: 37.6173, accuracyMeters: 25 };

/** Exact DEV gate and authenticated actor fence precede all fixture SQL. Caller owns the transaction. */
export async function refreshDevMoscowPeers(
  client: PoolClient, env: AppEnv, fence: ActorFenceService,
  actor: { actorId: string; sessionId: string },
) {
  if (!devMoscowFixturesEnabled(env) || DEV_MOSCOW_PEER_IDS.includes(actor.actorId)) throw new Error("DEV fixtures disabled");
  await fence.assertActiveConsumerInTransaction(client, actor);
  // Serialize fixture writers before checking due dates. No work/timer on continuation.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('radar-dev-moscow-peers',0))");
  const active = await client.query<{ user_id: string }>(
    `SELECT r.user_id FROM radar_presences r JOIN app_sessions s ON s.id=r.owner_session_id AND s.user_id=r.user_id
     WHERE r.user_id=ANY($1::uuid[]) AND s.revoked_at IS NULL
     AND s.csrf_ciphertext='!fixture-no-login' AND r.policy_version='radar-geographic-sharing-v2'
     AND LEAST(r.foreground_until,r.location_valid_until,r.expires_at,r.hard_expires_at,s.expires_at)>clock_timestamp()+interval '30 seconds'`, [DEV_MOSCOW_PEER_IDS]);
  const fresh = new Set(active.rows.map(r => r.user_id));
  for (const [i, id] of DEV_MOSCOW_PEER_IDS.entries()) {
    // Fail closed on UUID collisions: never overwrite a real identity/profile.
    const existing = await client.query<{ display_name: string; credentials: boolean; fixture: boolean }>(
      "SELECT display_name,EXISTS(SELECT 1 FROM external_identities WHERE user_id=$1) credentials,EXISTS(SELECT 1 FROM app_sessions s JOIN player_social_profiles p ON p.user_id=s.user_id WHERE s.user_id=$1 AND s.csrf_ciphertext='!fixture-no-login' AND p.display_name=users.display_name AND NOT p.directory_visible AND p.contact_policy='closed' AND NOT EXISTS(SELECT 1 FROM app_sessions other WHERE other.user_id=$1 AND other.csrf_ciphertext<>'!fixture-no-login')) fixture FROM users WHERE id=$1", [id]);
    const name = `TEST · DEV Москва ${i + 1}`;
    if (existing.rows[0] && (existing.rows[0].display_name !== name || existing.rows[0].credentials || !existing.rows[0].fixture)) throw new Error("DEV fixture identity collision");
    if (fresh.has(id)) continue;
    await client.query("INSERT INTO users(id,display_name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [id, name]);
    await client.query("INSERT INTO player_social_profiles(user_id,display_name,directory_visible,contact_policy) VALUES($1,$2,false,'closed') ON CONFLICT(user_id) DO NOTHING", [id, name]);
    const receipt = await client.query<{ id: string }>(
      "INSERT INTO radar_consent_events(user_id,event_type,policy_version,disclosure_id,disclosure_sha256,locale,source) VALUES($1,'accepted',$2,$3,$4,'ru','radar_enable') RETURNING id",
      [id, UNIFIED_POLICY, UNIFIED_DISCLOSURE_ID, UNIFIED_DISCLOSURE_HASH]);
    await client.query("UPDATE player_social_profiles SET radar_consented=true,radar_consent_policy_version=$2,radar_consent_evidence_id=$3,radar_consented_at=clock_timestamp(),version=version+1 WHERE user_id=$1", [id, UNIFIED_POLICY, receipt.rows[0]!.id]);
    // Random unknown hash and unusable ciphertext: authority binding, no issued cookie/CSRF.
    const sessionId = randomUUID();
    await client.query("UPDATE app_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
    await client.query("INSERT INTO app_sessions(id,user_id,session_hash,csrf_ciphertext,expires_at) VALUES($1,$2,$3,'!fixture-no-login',clock_timestamp()+interval '30 minutes')", [sessionId, id, randomBytes(32).toString("hex")]);
    const point = await quantizeUnified(client, { latitude: 55.7558 + (i - 2) * 0.004, longitude: 37.6173 + (i - 2) * 0.007, accuracyMeters: 25, capturedAt: new Date().toISOString() }, MOSCOW_CITY_ID, "live");
    await client.query("DELETE FROM radar_presences WHERE user_id=$1", [id]);
    await client.query(`INSERT INTO radar_presences(user_id,activation_id,owner_session_id,version,policy_version,region_id,started_at,expires_at,hard_expires_at,foreground_until,location_valid_until,next_location_update_at,next_radius_change_at,radius_changes_window_started_at,radius_changes_in_window,cell_i,cell_j,coarse_center,radius_bucket_km,consent_evidence_id,location_model,grid_size_meters,source_accuracy_meters,source_captured_at)
      VALUES($1,$2,$3,1,$4,$5,clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '90 seconds',clock_timestamp()+interval '6 minutes',clock_timestamp()+interval '5 minutes',clock_timestamp(),clock_timestamp(),0,$6,$7,ST_SetSRID(ST_MakePoint($8::float8,$9::float8),4326)::geography,5,$10,$11,$12,25,to_timestamp($13::float8/1000))`,
      [id, randomUUID(), sessionId, UNIFIED_POLICY, point.regionId, point.cellI, point.cellJ, point.longitude, point.latitude, receipt.rows[0]!.id, point.model, point.grid, point.capturedAt]);
  }
}
