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

/** UUID shape for PlayInterestReceipt.interestId (OpenAPI format: uuid). */
const PLAY_INTEREST_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decimal version string — OpenAPI `^[1-9][0-9]{0,18}$`. */
const PLAY_INTEREST_DECIMAL_VERSION = /^[1-9][0-9]{0,18}$/;

/**
 * Strict runtime receipt for confirmed browse send (outgoing/mutual).
 * Missing/malformed interestId, version, or outcome → false (caller treats as UNKNOWN).
 * Never throws on null/non-object input.
 */
export function isValidConfirmedPlayInterestReceipt(
  data: unknown,
): data is PlayInterestReceipt {
  if (!data || typeof data !== "object") return false;
  const receipt = data as Record<string, unknown>;
  if (typeof receipt.interestId !== "string" || !PLAY_INTEREST_UUID.test(receipt.interestId)) {
    return false;
  }
  if (typeof receipt.version !== "string" || !PLAY_INTEREST_DECIMAL_VERSION.test(receipt.version)) {
    return false;
  }
  return receipt.outcome === "outgoing" || receipt.outcome === "mutual";
}

/** SessionStorage pending marker must match path/body/key/method/peer — never self-declare safe. */
export function isValidPlayInterestSendPendingMarker(
  value: unknown,
  peerId: string,
): value is { path: string; body: { targetPublicPlayerId: string }; key: string; method: string } {
  if (!value || typeof value !== "object" || !peerId) return false;
  const marker = value as Record<string, unknown>;
  if (marker.method !== "POST" || marker.path !== "/v1/play-interests") return false;
  if (typeof marker.key !== "string" || !marker.key.trim()) return false;
  if (!marker.body || typeof marker.body !== "object") return false;
  const body = marker.body as Record<string, unknown>;
  return body.targetPublicPlayerId === peerId;
}

export function playInterestPendingStorageKey(actorId: string, peerId: string): string {
  return `gb-fr04-pending:${actorId}:play-interest:${peerId}`;
}
