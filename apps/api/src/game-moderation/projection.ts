import type { PoolClient } from "pg";
import { conflict } from "../auth/problem";
export type ModerationProjection = { state: "clear" | "hidden" | "taken_down"; requestsLocked: boolean; version: number; lastActionId: string | null };
export async function readModeration(client: PoolClient, gameId: string): Promise<ModerationProjection> {
  const row = (await client.query<{ state: ModerationProjection["state"]; requests_locked: boolean; version: number; last_action_id: string | null }>(
    "SELECT * FROM game_moderation_state WHERE game_id=$1", [gameId])).rows[0];
  return row ? {state:row.state,requestsLocked:row.requests_locked,version:row.version,lastActionId:row.last_action_id}
    : {state:"clear",requestsLocked:false,version:1,lastActionId:null};
}
/** Caller holds the shared Game fence; moderation commands acquire it too. */
export async function assertNewGameInteraction(client: PoolClient, gameId: string, enabled: boolean) {
  if (!enabled) return;
  const projection = await readModeration(client, gameId);
  if (projection.state === "taken_down" || projection.requestsLocked)
    throw conflict("GAME_REQUESTS_LOCKED", "Новые заявки и приглашения временно закрыты");
}
export function discoveryModerationSql(enabled: boolean, alias = "g") {
  return enabled ? `NOT EXISTS (SELECT 1 FROM game_moderation_state ms WHERE ms.game_id=${alias}.id AND ms.state <> 'clear')` : "TRUE";
}
export function publicModerationSql(enabled: boolean, alias = "g") {
  return enabled ? `NOT EXISTS (SELECT 1 FROM game_moderation_state ms WHERE ms.game_id=${alias}.id AND ms.state = 'taken_down')` : "TRUE";
}
