import { z } from "zod";
import type { AppEnv } from "../config/env";
import { conflict, notFound, unprocessable } from "../auth/problem";
import type { FriendshipView } from "@gobadminton/contracts/friendship-types";

export const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const createRequest = z.object({ targetPublicPlayerId: uuid }).strict();
export const decideRequest = z.object({ expectedVersion: z.string().regex(/^[1-9][0-9]{0,18}$/)
  .refine(value => BigInt(value) <= 9223372036854775807n) }).strict();
export const listQuery = z.object({
  view: z.enum(["accepted", "incoming", "outgoing"]),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw unprocessable("FRIENDSHIP_INPUT_INVALID", "Некорректный запрос");
  return result.data;
}
export function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}
/** G-03 remains closed: only explicitly configured local synthetic execution. */
export function friendsEnabled(env: AppEnv): boolean {
  return env.FRIENDS_INTERNAL_ENABLED && env.NODE_ENV === "test" && env.APP_ENV === "local"
    && env.SOCIAL_DIRECTORY_ENABLED && Boolean(env.FRIENDS_REQUEST_TTL_SECONDS
      && env.FRIENDS_RATE_WINDOW_SECONDS && env.FRIENDS_SEND_LIMIT && env.FRIENDS_RECEIVE_LIMIT);
}
export type FriendshipRow = {
  id: string; pair_id: string; requester_user_id: string; recipient_user_id: string;
  request_id: string; generation: string; version: string; state: string;
  requester_epoch: string; recipient_epoch: string; requested_at: Date;
  expires_at: Date | null; accepted_at: Date | null;
};
export type Availability = {
  user_id: string; public_player_id: string; display_name: string;
  directory_visible: boolean; social_eligible: boolean; contact_policy: string;
  social_action_epoch: string; status: string; unrestricted: boolean;
};
export function eligible(p: Availability | undefined): p is Availability {
  return Boolean(p && p.status === "active" && p.directory_visible && p.social_eligible
    && p.contact_policy === "requests" && p.unrestricted);
}
export function effectivePending(row: FriendshipRow, profiles: Availability[], blocked: boolean, now: Date): boolean {
  return row.state === "pending" && !blocked && Boolean(row.expires_at && row.expires_at > now)
    && profiles.length === 2 && profiles.every(eligible)
    && profiles.find(p => p.user_id === row.requester_user_id)?.social_action_epoch === row.requester_epoch
    && profiles.find(p => p.user_id === row.recipient_user_id)?.social_action_epoch === row.recipient_epoch;
}
export function assertDecision(row: FriendshipRow, actor: string, action: string, id: string, version: string): void {
  if (row.requester_user_id !== actor && row.recipient_user_id !== actor) unavailable();
  if (action !== "remove" && row.request_id !== id) throw conflict("FRIENDSHIP_STALE", "Состояние изменилось");
  if ((action === "accept" || action === "decline") && row.recipient_user_id !== actor) unavailable();
  if (action === "cancel" && row.requester_user_id !== actor) unavailable();
  if (row.version !== version || row.state !== (action === "remove" ? "accepted" : "pending")) {
    throw conflict("FRIENDSHIP_STALE", "Состояние изменилось");
  }
}
export function emptyView(): FriendshipView {
  return { friendshipId: null, relationship: "unavailable", version: null, request: null, peer: null,
    capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: false } };
}
