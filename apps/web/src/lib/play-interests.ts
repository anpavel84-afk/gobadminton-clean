import type {
  PlayInterestCreateRequest,
  PlayInterestReceipt,
  PlayInterestStates,
  PlayInterestView,
  PlayInterestWithdrawRequest,
} from "@gobadminton/contracts/friendship-types";
import { apiFetch } from "./api-client";

export type PlayInterestAction = "send" | "withdraw";

export const playInterestStatus: Record<PlayInterestView["relationship"], string> = {
  none: "Можно отметить интерес к игре",
  outgoing: "Интерес отправлен",
  mutual: "Вы хотите сыграть вместе",
  unavailable: "Интерес к игре сейчас недоступен",
};

export const getPlayInterestState = (id: string) =>
  apiFetch<PlayInterestStates>(`/v1/me/play-interest-states?publicPlayerId=${encodeURIComponent(id)}`);

/** Only server capabilities authorize controls. Versions remain decimal strings. */
export function playInterestCommand(
  view: PlayInterestView,
  peerId: string | undefined,
  action: PlayInterestAction,
): { path: string; body: PlayInterestCreateRequest | PlayInterestWithdrawRequest } | null {
  if (action === "send") {
    return view.capabilities.canSend && peerId
      ? { path: "/v1/play-interests", body: { targetPublicPlayerId: peerId } }
      : null;
  }
  if (!view.capabilities.canWithdraw || !view.interestId || !view.version) return null;
  return {
    path: `/v1/play-interests/${encodeURIComponent(view.interestId)}/withdraw`,
    body: { expectedVersion: view.version },
  };
}

export function isBrowseConfirmedPlayInterestOutcome(
  outcome: PlayInterestReceipt["outcome"],
): boolean {
  return outcome === "outgoing" || outcome === "mutual";
}
