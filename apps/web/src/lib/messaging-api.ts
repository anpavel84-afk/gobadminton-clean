import { apiFetch } from "./api-client";
import type { Conversation, DirectMessage, GameInvitation, Page, GameChat, GameChatMember, InboxFilter, InboxPage, ContactState } from "./messaging-types";
const id = encodeURIComponent;
export function listConversations(cursor?: string) {
  return apiFetch<Page<Conversation>>(`/v1/conversations?limit=50${cursor ? `&cursor=${id(cursor)}` : ""}`);
}
export function getContactState(value: string, signal?: AbortSignal) { return apiFetch<ContactState>(`/v1/me/contact-state?targetPublicPlayerId=${id(value)}`, { signal }); }
export function getConversation(value: string, signal?: AbortSignal) { return apiFetch<Conversation>(`/v1/conversations/${id(value)}`, { signal }); }
export function listMessages(value: string, beforeSeq?: string, afterSeq?: string, signal?: AbortSignal) {
  return apiFetch<Page<DirectMessage>>(`/v1/conversations/${id(value)}/messages?limit=50${beforeSeq ? `&beforeSeq=${id(beforeSeq)}` : ""}${afterSeq ? `&afterSeq=${id(afterSeq)}` : ""}`, { signal });
}
export function listInvitations(cursor?: string) {
  return apiFetch<Page<GameInvitation>>(`/v1/me/invitations?limit=50${cursor ? `&cursor=${id(cursor)}` : ""}`);
}
export function getInvitation(value: string) { return apiFetch<GameInvitation>(`/v1/invitations/${id(value)}`); }
export const conversationPath = (value: string) => `/v1/conversations/${id(value)}`;
export const invitationPath = (value: string) => `/v1/invitations/${id(value)}`;

export function listInbox(filter: InboxFilter, cursor?: string, signal?: AbortSignal) {
  return apiFetch<InboxPage>(`/v1/me/inbox?limit=50&filter=${filter}${cursor ? `&cursor=${id(cursor)}` : ""}`, { signal });
}
export const gameChatPath = (value: string) => `/v1/games/${id(value)}/chat`;
export function getGameChat(value: string, signal?: AbortSignal) { return apiFetch<GameChat>(gameChatPath(value), { signal }); }
export function listGameChatMessages(value: string, beforeSeq?: string, signal?: AbortSignal) {
  return apiFetch<Page<DirectMessage>>(`${gameChatPath(value)}/messages?limit=50${beforeSeq ? `&beforeSeq=${id(beforeSeq)}` : ""}`, { signal });
}
export function listGameChatMembers(value: string, signal?: AbortSignal) {
  return apiFetch<{ items: GameChatMember[] }>(`${gameChatPath(value)}/members`, { signal });
}
