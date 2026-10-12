/** Web projections of accepted packages/contracts/openapi.json LS-03 / LS-04 schemas. */
import type { Participation, PlayerAvatar } from "./consumer-types";
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Conversation = {
  id: string; kind: "direct"; requestState: "pending" | "accepted" | "declined" | "expired" | "closed";
  version: number; peer: { avatar?: PlayerAvatar; publicPlayerId: string; displayName: string }; role: "initiator" | "recipient";
  lastMessageAt: string | null; lastMessageSeq: string; readThroughSeq: string; unreadCount: number;
  archived: boolean; muted: boolean; requestExpiresAt: string | null; createdAt: string;
};
export type DirectMessage = {
  id: string; conversationId: string; seq: string; kind: "text"; authorPublicPlayerId: string | null;
  createdAt: string; contentState: "live" | "tombstoned" | "purged"; text: string | null;
};
export type SendReceipt = { messageId: string; conversationId: string; seq: string; createdAt: string; outcome: "created" | "duplicate" };
export type ContactResult = { conversation: Conversation; receipt: SendReceipt };
export type GameInvitation = {
  id: string; gameId: string; status: "pending" | "accepted" | "declined" | "expired" | "revoked" | "cancelled_by_game";
  version: number; inviterPublicPlayerId: string | null; inviteePublicPlayerId: string | null;
  expiresAt: string | null; decidedAt: string | null; participationId: string | null; createdAt: string;
};
export type AcceptInvitationResult = { invitation: GameInvitation; participation: Participation };

/** Accepted LS-05/LS-06 wire projections; messages remain text-only. */
export type GameChat = {
  id: string; kind: "game"; gameId: string; lifecycleState: "active" | "closed"; version: number;
  lastMessageAt: string | null; lastMessageSeq: string; readThroughSeq: string; unreadCount: number;
  memberRole: "manager" | "member"; createdAt: string;
};
export type GameChatMember = { publicPlayerId: string; displayName: string; role: "manager" | "member" };
export type InboxFilter = "all" | "unread" | "attention";
export type InboxCounts = { pendingRequestCount: number; pendingInvitationCount: number; dmUnread: number; gameChatUnread: number };
export type InboxItem = {
  kind: "dm" | "dm_request" | "game_invitation" | "game_chat"; id: string; lastActivityAt: string;
  title: string; subtitle: string; unreadCount: number; attention: boolean;
  conversationId: string | null; invitationId: string | null; gameId: string | null;
  peer: Conversation["peer"] | null; requestState: Conversation["requestState"] | null;
  invitationStatus: GameInvitation["status"] | null; muted: boolean;
};
export type InboxPage = Page<InboxItem> & { counts: InboxCounts };

export type ContactState = { targetPublicPlayerId: string } & (
  | { state: "none"; canRequestContact: true }
  | { state: "accepted" | "pending_incoming" | "pending_outgoing"; conversationId: string; version: number }
  | { state: "terminal" | "unavailable" }
);
