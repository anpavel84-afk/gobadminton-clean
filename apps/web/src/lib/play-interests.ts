import type {
  PlayInterestCreateRequest,
  PlayInterestReceipt,
  PlayInterestStates,
  PlayInterestView,
  PlayInterestWithdrawRequest,
} from "@gobadminton/contracts/friendship-types";
import { apiFetch } from "./api-client";

export type PlayInterestAction = "send" | "withdraw";

/** User-facing browse status only — domain API/relationship names stay play-interest. */
export const playInterestStatus: Record<PlayInterestView["relationship"], string> = {
  none: "Давай сыграем",
  outgoing: "Предложение отправлено",
  mutual: "Вы оба хотите сыграть",
  /** Not shown as a technical panel; definitive unavailable uses deck Next/Skip eligibility. */
  unavailable: "",
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
