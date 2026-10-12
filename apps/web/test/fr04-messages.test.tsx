import { createElement, type AnchorHTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterEach } from "vitest";
import { canCompose, canDecideRequest, mergeMessages, socialError } from "../src/lib/messaging-presentation";
import { getConversation, listMessages, listInvitations } from "../src/lib/messaging-api";
import type { Conversation, DirectMessage, GameInvitation } from "../src/lib/messaging-types";
import { InvitationCard, RequestCard, MessageBubble, InboxRow } from "../src/components/consumer/messages/MessageComposition";
vi.mock("next/link", () => ({ default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props) }));
const thread: Conversation = { id: "c", kind: "direct", version: 1, peer: { publicPlayerId: "peer", displayName: "Мария" }, role: "recipient", requestState: "pending", lastMessageAt: null, lastMessageSeq: "1", readThroughSeq: "0", unreadCount: 1, archived: false, muted: false, requestExpiresAt: null, createdAt: "2030-01-01T12:00:00Z" };
const message: DirectMessage = { id: "m", conversationId: "c", seq: "1", kind: "text", authorPublicPlayerId: "peer", createdAt: "2030-01-01T12:00:00Z", contentState: "live", text: "Привет" };
const invitation: GameInvitation = { id: "i", gameId: "g", version: 1, status: "pending", inviterPublicPlayerId: "peer", inviteePublicPlayerId: "own", expiresAt: null, decidedAt: null, participationId: null, createdAt: "2030-01-01T12:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
describe("FR-04 backend-driven state projections", () => {
  it.each(["pending", "declined", "expired", "closed"] as const)("never enables a %s composer", requestState => expect(canCompose({ ...thread, requestState })).toBe(false));
  it("requires accepted backend state and recipient role for the respective actions", () => {
    expect(canCompose(null)).toBe(false); expect(canCompose({ ...thread, requestState: "accepted" })).toBe(true);
    expect(canDecideRequest(thread)).toBe(true); expect(canDecideRequest({ ...thread, role: "initiator" })).toBe(false);
    const html = renderToStaticMarkup(createElement(RequestCard, { conversation: { ...thread, role: "initiator" }, disabled: false, decide: vi.fn() }));
    expect(html).not.toContain("<button"); expect(html).toContain("Дождитесь ответа");
  });
  it("deduplicates pages, applies tombstones and sorts seq beyond safe integer range", () => {
    const results = mergeMessages([{ ...message, seq: "9007199254740993" }], [{ ...message, seq: "9007199254740993", contentState: "purged", text: null }, { ...message, id: "older", seq: "9007199254740992" }]);
    expect(results.map(m => m.id)).toEqual(["older", "m"]); expect(results[1]?.text).toBeNull();
  });
  it("does not expose purged text or render user text as markup", () => {
    const purged = renderToStaticMarkup(createElement(MessageBubble, { message: { ...message, contentState: "purged", text: "secret" }, peerId: "peer" }));
    expect(purged).not.toContain("secret"); expect(purged).toContain("Сообщение недоступно");
    const escaped = renderToStaticMarkup(createElement(MessageBubble, { message: { ...message, text: "<script>bad()</script>" }, peerId: "peer" }));
    expect(escaped).not.toContain("<script>"); expect(escaped).toContain("&lt;script&gt;");
  });
  it.each(["pending", "accepted", "declined", "expired", "revoked", "cancelled_by_game"] as const)("renders invitation %s without an inferred seat", status => {
    const html = renderToStaticMarkup(createElement(InvitationCard, { invitation: { ...invitation, status } }));
    expect(html).not.toContain("Участие подтверждено"); expect(html).toContain("Приглашение в игру");
    if (status === "pending") expect(html).toContain("Место не зарезервировано");
  });
  it("renders capacity conflict distinctly and confirmation only when explicitly supplied", () => {
    const html = renderToStaticMarkup(createElement(InvitationCard, { invitation, unavailable: true }));
    expect(html).toContain('data-invitation-state="unavailable"'); expect(html).toContain("Место не подтверждено");
    expect(renderToStaticMarkup(createElement(InvitationCard, { invitation: { ...invitation, status: "accepted" }, confirmed: true }))).toContain("Участие подтверждено");
  });
  it("does not invent invitation unread counts", () => {
    const html = renderToStaticMarkup(createElement(InboxRow, { name: "Игра", preview: "Ожидает ответа", time: invitation.createdAt, kind: "invitation", selected: false, href: "/messages?invitation=i" }));
    expect(html).not.toContain("непрочитанных");
  });
  it("keeps server diagnostics out of consumer copy", () => {
    expect(socialError({ ok: false, status: 409, error: "internal", problem: { code: "GAME_FULL", title: "internal", status: 409, type: "", requestId: "" } })).toContain("Участие не подтверждено");
    for (const status of [0, 401, 403, 404, 409, 422, 429, 500]) expect(socialError({ ok: false, status, error: "INTERNAL GET /v1" })).not.toContain("INTERNAL");
  });
  it("uses the accepted member/list pagination endpoints, cookies and no-store", async () => {
    vi.stubGlobal("window", {});
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    await getConversation("a/b"); await listMessages("c", "9007199254740993"); await listInvitations("a+b");
    expect(fetchMock.mock.calls.map(call => (call as unknown[])[0])).toEqual(expect.arrayContaining([expect.stringContaining("/v1/conversations/a%2Fb"), expect.stringContaining("beforeSeq=9007199254740993"), expect.stringContaining("cursor=a%2Bb")]));
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit; expect(init.credentials).toBe("include"); expect(init.cache).toBe("no-store");
  });
});
