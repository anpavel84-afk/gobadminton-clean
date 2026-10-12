import type { Pool, PoolClient } from "pg";
import { forbidden } from "../auth/problem";
export const USER_CAPABILITIES = ["account.access", "game.create", "participation.request", "profile.public", "social.directory", "social.radar", "social.dm_send", "social.game_chat_send"] as const;
export type UserCapability = typeof USER_CAPABILITIES[number];
/** SQL fragments accept only application-owned expressions, never transport input. */
export function unrestrictedSql(enabled: boolean, userExpression: string, capabilities: readonly UserCapability[]) {
  return enabled ? `NOT EXISTS (SELECT 1 FROM user_restrictions ur WHERE ur.user_id=${userExpression}
    AND ur.capability IN (${capabilities.map(c => `'${c}'`).join(",")})
    AND ur.revoked_at IS NULL AND ur.starts_at<=clock_timestamp() AND ur.expires_at>clock_timestamp())` : "TRUE";
}
export async function assertCapabilities(client: Pool | PoolClient, enabled: boolean, userId: string, capabilities: readonly UserCapability[]) {
  if (!enabled || !capabilities.length) return;
  const denied = await client.query("SELECT 1 WHERE NOT (" + unrestrictedSql(true, "$1", capabilities) + ")", [userId]);
  if (denied.rowCount) throw forbidden("CAPABILITY_RESTRICTED", "Действие временно недоступно");
}
/** Required action boundaries only. History, withdraw, privacy-off, management of existing Games stay available. */
export function operationCapabilities(operation: string): readonly UserCapability[] {
  if (operation === "games.create") return ["game.create"];
  if (["participations.request", "invitations.accept"].includes(operation)) return ["participation.request"];
  if (["dm.request.create", "dm.request.accept", "dm.message.send"].includes(operation)) return ["social.dm_send"];
  if (operation === "game_chat.message.send") return ["social.game_chat_send"];
  if (operation.startsWith("radar.unified.") && operation !== "radar.unified.stop") return ["social.radar", "profile.public"];
  if (operation.startsWith("radar.activation.") && operation !== "radar.activation.stop") return ["social.radar", "profile.public"];
  if (operation === "looking_for_game.put") return ["profile.public", "social.directory"];
  return [];
}
