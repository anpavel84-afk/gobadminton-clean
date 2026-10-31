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

/** Batch GET: one `publicPlayerId` query param per id (1–50). Response items are positional — no peerId. */
export const PLAY_INTEREST_STATES_BATCH_MAX = 50;

export function getPlayInterestStates(ids: readonly string[]) {
  if (ids.length === 0) {
    return Promise.resolve({
      ok: true as const,
      status: 200,
      data: { items: [] as PlayInterestView[] },
    });
  }
  const unique = ids.slice(0, PLAY_INTEREST_STATES_BATCH_MAX);
  const params = new URLSearchParams();
  for (const id of unique) params.append("publicPlayerId", id);
  return apiFetch<PlayInterestStates>(`/v1/me/play-interest-states?${params.toString()}`);
}

/**
 * Bind positional states to the frozen request ID list.
 * Returns null when length/shape cannot be trusted (caller must not invent none).
 */
export function bindPlayInterestStates(
  orderedIds: readonly string[],
  items: readonly PlayInterestView[] | null | undefined,
): Map<string, PlayInterestView> | null {
  if (!items || items.length !== orderedIds.length) return null;
  const map = new Map<string, PlayInterestView>();
  for (let i = 0; i < orderedIds.length; i += 1) {
    const id = orderedIds[i];
    const view = items[i];
    if (!id || !view || typeof view.relationship !== "string" || !view.capabilities) return null;
    map.set(id, view);
  }
  return map;
}

/** Finder candidate: server none + canSend; excludes outgoing/mutual/unavailable. */
export function isFinderSendEligible(view: PlayInterestView | null | undefined): boolean {
  return Boolean(view && view.relationship === "none" && view.capabilities.canSend);
}

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
