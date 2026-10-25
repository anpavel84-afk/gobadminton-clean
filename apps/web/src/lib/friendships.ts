import type { FriendshipCreateRequest, FriendshipDecisionRequest, FriendshipList, FriendshipStates, FriendshipView, SocialCapabilities } from "@gobadminton/contracts/friendship-types";
import { apiFetch } from "./api-client";

export type FriendsTab = "accepted" | "incoming" | "outgoing";
export type FriendAction = "request" | "accept" | "decline" | "cancel" | "remove";
export const friendStatus: Record<FriendshipView["relationship"], string> = {
  none: "Можно отправить запрос", outgoing_pending: "Запрос отправлен", incoming_pending: "Входящий запрос",
  friends: "В друзьях", unavailable: "Дружба сейчас недоступна",
};
export const getSocialCapabilities = () => apiFetch<SocialCapabilities>("/v1/me/social-capabilities");
export const getFriendState = (id: string) => apiFetch<FriendshipStates>(`/v1/me/friendship-states?publicPlayerId=${encodeURIComponent(id)}`);
export const listFriends = (view: FriendsTab, cursor: string | null = null) => {
  const query = new URLSearchParams({ view, limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return apiFetch<FriendshipList>(`/v1/me/friendships?${query}`);
};
/** Only server capabilities authorize controls. Versions remain decimal strings. */
export function friendCommand(view: FriendshipView, peerId: string | undefined, action: FriendAction): { path: string; body: FriendshipCreateRequest | FriendshipDecisionRequest } | null {
  if (action === "request") return view.capabilities.canRequest && peerId
    ? { path: "/v1/friend-requests", body: { targetPublicPlayerId: peerId } } : null;
  const permitted = { accept: view.capabilities.canAccept, decline: view.capabilities.canDecline,
    cancel: view.capabilities.canCancel, remove: view.capabilities.canRemove };
  const id = action === "remove" ? view.friendshipId : view.request?.id;
  if (!permitted[action] || !id || !view.version) return null;
  return { path: action === "remove" ? `/v1/friendships/${encodeURIComponent(id)}/remove`
    : `/v1/friend-requests/${encodeURIComponent(id)}/${action}`, body: { expectedVersion: view.version } };
}
