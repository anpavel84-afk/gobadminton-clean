import { describe, expect, it } from "vitest";
import { inboxSelection } from "../src/components/consumer/messages/inboxSelection";

const rows = [{ id: "first-visible", kind: "dm" as const }, { id: "other", kind: "request" as const }];
describe("FR-04 initial Inbox selection", () => {
  it("selects the first displayed conversation in split-pane mode", () => {
    expect(inboxSelection(new URLSearchParams(), rows, true)).toEqual({ conversationId: "first-visible", invitationId: null, gameId: null });
  });
  it("selects a first request or invitation through its own detail route", () => {
    expect(inboxSelection(new URLSearchParams(), rows.slice(1), true).conversationId).toBe("other");
    expect(inboxSelection(new URLSearchParams(), [{ id: "invite", kind: "invitation" }, ...rows], true)).toEqual({ conversationId: null, invitationId: "invite", gameId: null });
  });
  it.each(["conversation=other", "conversation=unavailable", "invitation=invite", "to=new-player", "to=new-player&action=invite", "conversation="])("preserves explicit target %s", query => {
    const params = new URLSearchParams(query);
    expect(inboxSelection(params, rows, true)).toEqual({ conversationId: params.get("conversation"), invitationId: params.get("invitation"), gameId: null });
  });
  it("keeps mobile entry on the list without opening a hidden conversation", () => {
    expect(inboxSelection(new URLSearchParams(), rows, false)).toEqual({ conversationId: null, invitationId: null, gameId: null });
    expect(inboxSelection(new URLSearchParams("conversation=other"), rows, false).conversationId).toBe("other");
  });
  it("keeps an empty or filtered-empty Inbox unselected", () => {
    expect(inboxSelection(new URLSearchParams(), [], true)).toEqual({ conversationId: null, invitationId: null, gameId: null });
  });
});
