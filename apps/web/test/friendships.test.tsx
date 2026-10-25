import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FriendshipView } from "@gobadminton/contracts/friendship-types";
import type { Me } from "../src/lib/consumer-types";
import { apiFetch } from "../src/lib/api-client";
import { friendCommand, getFriendState, listFriends } from "../src/lib/friendships";
import { FriendActions } from "../src/components/consumer/friends/FriendActions";
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn(), startAuth: vi.fn() }));
const view: FriendshipView = { friendshipId: "friend-id", relationship: "incoming_pending", version: "9007199254740993",
  request: { id: "request-id", expiresAt: "2026-10-20T00:00:00Z" }, peer: null,
  capabilities: { canRequest: false, canAccept: true, canDecline: true, canCancel: false, canRemove: false } };
beforeEach(() => vi.clearAllMocks());
describe("Friends wire and server-authorized controls", () => {
  it("accept uses request identity and exact bigint version", () => {
    expect(friendCommand(view, undefined, "accept")).toEqual({ path: "/v1/friend-requests/request-id/accept", body: { expectedVersion: "9007199254740993" } });
    expect(friendCommand(view, "peer", "request")).toBeNull();
    expect(friendCommand(view, "peer", "cancel")).toBeNull();
  });
  it("blocks controls on hidden/blocked/unsupported states with denied capabilities", () => {
    const hidden = { ...view, relationship: "unavailable" as const, request: null, capabilities: { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: false } };
    for (const action of ["request", "accept", "decline", "cancel", "remove"] as const) expect(friendCommand(hidden, "peer", action)).toBeNull();
    const html = renderToStaticMarkup(<FriendActions me={{ id: "actor", csrfToken: "csrf" } as Me} view={hidden} refresh={() => {}} />);
    expect(html).toContain("Дружба сейчас недоступна");
    expect(html).not.toContain("<button");
  });
  it("renders incoming actions and only opens removal confirmation through a button", () => {
    const html = renderToStaticMarkup(<FriendActions me={{ id: "actor", csrfToken: "csrf" } as Me} view={view} refresh={() => {}} />);
    expect(html).toContain("Принять"); expect(html).toContain("Отклонить"); expect(html).not.toContain("Добавить в друзья");
    const accepted = { ...view, relationship: "friends" as const, request: null, capabilities: { ...view.capabilities, canAccept: false, canDecline: false, canRemove: true } };
    expect(friendCommand(accepted, undefined, "remove")).toEqual({ path: "/v1/friendships/friend-id/remove", body: { expectedVersion: view.version } });
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("withdrawn recipient has no identity link but accepted relationship can be removed", () => {
    const hidden = { ...view, relationship: "unavailable" as const, request: null, capabilities: { ...view.capabilities, canAccept: false, canDecline: false, canRemove: true } };
    expect(friendCommand(hidden, undefined, "accept")).toBeNull();
    expect(friendCommand(hidden, undefined, "remove")?.body).toEqual({ expectedVersion: view.version });
  });
  it("reads bounded same-host list with opaque cursor and public profile ID only", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 409, error: "stale cursor" });
    await listFriends("incoming", "opaque&view=outgoing");
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/v1/me/friendships?view=incoming&limit=20&cursor=opaque%26view%3Doutgoing");
    await getFriendState("public-id");
    expect(apiFetch).toHaveBeenLastCalledWith("/v1/me/friendship-states?publicPlayerId=public-id");
  });
});
