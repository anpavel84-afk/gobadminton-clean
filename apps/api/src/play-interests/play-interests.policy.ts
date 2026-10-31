import { z } from "zod";
import type { AppEnv } from "../config/env";
import { notFound, unprocessable } from "../auth/problem";
import type { Availability } from "../friendships/friendships.policy";
import { eligible } from "../friendships/friendships.policy";
import type { PlayInterestView } from "@gobadminton/contracts/friendship-types";

/** Bounded local/DEV/PROD send policy — no new env keys and independent of Friends ON. */
export const PLAY_INTEREST_RATE_WINDOW_SECONDS = 600;
export const PLAY_INTEREST_SEND_LIMIT = 40;

export const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const createRequest = z.object({ targetPublicPlayerId: uuid }).strict();
export const withdrawRequest = z.object({
  expectedVersion: z.string().regex(/^[1-9][0-9]{0,18}$/)
    .refine(value => BigInt(value) <= 9223372036854775807n),
}).strict();

export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw unprocessable("PLAY_INTEREST_INPUT_INVALID", "Некорректный запрос");
  return result.data;
}

export function unavailable(): never {
  throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
}

/**
 * Local/DEV/canonical PROD opt-in via existing app-env/origin + social directory.
 * Independent of FRIENDS_INTERNAL_ENABLED; does not auto-create interests or mutate user data.
 */
export function playInterestsEnabled(env: AppEnv): boolean {
  const local = env.NODE_ENV === "test" && env.APP_ENV === "local";
  const dev = env.NODE_ENV === "production" && ["mvp", "stage"].includes(env.APP_ENV)
    && env.PUBLIC_WEB_ORIGIN === "https://dev.gobadminton.ru"
    && env.PUBLIC_API_ORIGIN === "https://dev.gobadminton.ru";
  const prod = env.NODE_ENV === "production" && env.APP_ENV === "prod"
    && env.PUBLIC_WEB_ORIGIN === "https://gobadminton.ru"
    && env.PUBLIC_API_ORIGIN === "https://gobadminton.ru";
  return (local || dev || prod) && env.SOCIAL_DIRECTORY_ENABLED;
}

export type PlayInterestRow = {
  id: string;
  pair_id: string;
  actor_user_id: string;
  peer_user_id: string;
  interest_id: string;
  generation: string;
  version: string;
  state: string;
  actor_epoch: string;
  peer_epoch: string;
  created_at: Date;
  updated_at: Date;
};

export { eligible };
export type { Availability };

/**
 * Current directed intent is live only when both peers and epochs still match.
 * Returns a plain boolean — false may mean an existing inactive/stale row, not absence.
 */
export function effectiveActive(
  row: PlayInterestRow | undefined,
  profiles: Availability[],
  blocked: boolean,
): boolean {
  if (!row || row.state !== "active" || blocked || profiles.length !== 2 || !profiles.every(eligible)) {
    return false;
  }
  const actor = profiles.find(p => p.user_id === row.actor_user_id);
  const peer = profiles.find(p => p.user_id === row.peer_user_id);
  return Boolean(actor && peer
    && actor.social_action_epoch === row.actor_epoch
    && peer.social_action_epoch === row.peer_epoch);
}

export function canSend(
  own: PlayInterestRow | undefined,
  profiles: Availability[],
  blocked: boolean,
  enabled: boolean,
): boolean {
  return enabled && !blocked && profiles.length === 2 && profiles.every(eligible)
    && !effectiveActive(own, profiles, blocked);
}

export function emptyView(): PlayInterestView {
  return {
    interestId: null,
    relationship: "unavailable",
    version: null,
    capabilities: { canSend: false, canWithdraw: false },
  };
}

/** Actor-visible relationship: never disclose unilateral inbound interest. */
export function actorRelationship(
  own: PlayInterestRow | undefined,
  peerTowardActor: PlayInterestRow | undefined,
  profiles: Availability[],
  blocked: boolean,
  enabled: boolean,
): PlayInterestView["relationship"] {
  const ownLive = effectiveActive(own, profiles, blocked);
  const peerLive = effectiveActive(peerTowardActor, profiles, blocked);
  if (ownLive && peerLive) return "mutual";
  if (ownLive) return "outgoing";
  if (enabled && !blocked && profiles.length === 2 && profiles.every(eligible)) return "none";
  return "unavailable";
}
