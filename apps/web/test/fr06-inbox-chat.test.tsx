import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inboxRow, inboxCount } from "../src/lib/inbox-presentation";
import { inboxSelection } from "../src/components/consumer/messages/inboxSelection";
import { GameAccessLoss, GameMessage } from "../src/components/consumer/messages/GameConversation";
import { listInbox, getGameChat, listGameChatMessages, listGameChatMembers } from "../src/lib/messaging-api";
import type { DirectMessage, InboxItem } from "../src/lib/messaging-types";
const item: InboxItem = { id: "room", kind: "game_chat", title: "Игра", subtitle: "Чат игры", gameId: "game/1", conversationId: "room", invitationId: null, peer: null, requestState: null, invitationStatus: null, lastActivityAt: "2030-01-01T12:00:00Z", unreadCount: 2, attention: false, muted: false };
afterEach(() => vi.unstubAllGlobals());
describe("FR-06 accepted Inbox and Game Chat boundaries", () => {
  it("routes chat rows by gameId, never by room id, and composes initial desktop selection", () => {
    const row = inboxRow(item)!;
    expect(row.href).toBe("/messages?game=game%2F1");
    expect(inboxSelection(new URLSearchParams(), [row], true)).toEqual({ gameId: "game/1", conversationId: null, invitationId: null });
    expect(inboxSelection(new URLSearchParams(), [row], false).gameId).toBeNull();
    expect(inboxSelection(new URLSearchParams("game=denied"), [row], true).gameId).toBe("denied");
  });
  it("preserves attention separately from unread and translates current invitation status", () => {
    const row = inboxRow({ ...item, kind: "game_invitation", invitationId: "invite", invitationStatus: "expired", subtitle: "internal", attention: false, unreadCount: 0 });
    expect(row?.kind).toBe("invitation"); expect(row?.preview).toBe("Срок приглашения истёк"); expect(row?.unread).toBe(0);
    expect(inboxCount({ pendingRequestCount: 1, pendingInvitationCount: 2, dmUnread: 3, gameChatUnread: 4 })).toBe(10);
    expect(inboxRow({ ...item, gameId: null })).toBeNull();
  });
  it("encodes opaque cursors without parsing, and uses source-owned Game endpoints", async () => {
    vi.stubGlobal("window", {}); const fetcher = vi.fn(async () => new Response("{}")); vi.stubGlobal("fetch", fetcher);
    await listInbox("attention", "a+/= cursor"); await getGameChat("a/b"); await listGameChatMessages("g", "9007199254740993"); await listGameChatMembers("g");
    expect(fetcher.mock.calls.map(c => (c as unknown[])[0])).toEqual(["/v1/me/inbox?limit=50&filter=attention&cursor=a%2B%2F%3D%20cursor", "/v1/games/a%2Fb/chat", "/v1/games/g/chat/messages?limit=50&beforeSeq=9007199254740993", "/v1/games/g/chat/members"]);
  });
  it("does not infer own authorship from another peer or render tombstoned text", () => {
    const message: DirectMessage = { id: "m", conversationId: "room", seq: "1", kind: "text", authorPublicPlayerId: "other", createdAt: item.lastActivityAt, contentState: "live", text: "<script>bad</script>" };
    const html = renderToStaticMarkup(createElement(GameMessage, { message, ownId: "me", members: [{ publicPlayerId: "other", role: "manager", displayName: "Мария" }] }));
    expect(html).toContain("message-bubble--peer"); expect(html).toContain("Мария · организатор"); expect(html).not.toContain("<script>");
    const hidden = renderToStaticMarkup(createElement(GameMessage, { message: { ...message, contentState: "purged", text: "SECRET" }, ownId: null, members: [] }));
    expect(hidden).not.toContain("SECRET"); expect(hidden).not.toContain("message-bubble--own");
  });
  it("explains pending exclusion and lifecycle access loss without promising retained history", () => {
    const html = renderToStaticMarkup(createElement(GameAccessLoss));
    expect(html).toContain("Заявка на участие не открывает доступ"); expect(html).toContain("После выхода, отмены или завершения"); expect(html).not.toMatch(/INPUT_REQUIRED|PRODUCT DECISION|API|<input/);
  });
});
