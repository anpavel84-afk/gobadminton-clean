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
/** Local synthetic admission remains unchanged; public runtime is exact DEV opt-in only. */
export function friendsEnabled(env: AppEnv): boolean {
  const local = env.NODE_ENV === "test" && env.APP_ENV === "local";
  const bounded = (value: number | undefined, max: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
  const dev = env.NODE_ENV === "production" && ["mvp", "stage"].includes(env.APP_ENV)
    && env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru"
    && env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru"
    && bounded(env.FRIENDS_REQUEST_TTL_SECONDS, 30 * 86400)
    && bounded(env.FRIENDS_RATE_WINDOW_SECONDS, 86400)
    && bounded(env.FRIENDS_SEND_LIMIT, 100) && bounded(env.FRIENDS_RECEIVE_LIMIT, 100);
  return env.FRIENDS_INTERNAL_ENABLED && (local || dev)
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
/** A retired or expired attempt must not permanently disable requesting again. */
export function canRequestAgain(row: FriendshipRow, profiles: Availability[], blocked: boolean, now: Date, enabled: boolean): boolean {
  return enabled && !blocked && profiles.length === 2 && profiles.every(eligible)
    && row.state !== "accepted" && !effectivePending(row, profiles, blocked, now);
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
