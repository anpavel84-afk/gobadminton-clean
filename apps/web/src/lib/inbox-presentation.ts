import type { InboxItem, InboxCounts } from "./messaging-types";
import { invitationCopy, requestCopy } from "./messaging-presentation";
export function inboxRow(item: InboxItem) {
  const kind = item.kind === "game_chat" ? "game" : item.kind === "game_invitation" ? "invitation" : item.kind === "dm_request" ? "request" : "dm";
  const target = kind === "game" ? item.gameId : kind === "invitation" ? item.invitationId : item.conversationId;
  if (!target) return null;
  return { id: target, key: `${item.kind}:${item.id}`, kind, name: item.title, avatar: item.peer?.avatar,
    preview: item.invitationStatus ? invitationCopy[item.invitationStatus][0] : item.requestState ? requestCopy[item.requestState] : item.subtitle,
    time: item.lastActivityAt, unread: item.unreadCount, attention: item.attention,
    href: `/messages?${kind === "game" ? "game" : kind === "invitation" ? "invitation" : "conversation"}=${encodeURIComponent(target)}` } as const;
}
export function inboxCount(counts: InboxCounts) {
  return counts.pendingRequestCount + counts.pendingInvitationCount + counts.dmUnread + counts.gameChatUnread;
}
