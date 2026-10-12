import { describe, expect, it } from "vitest";
import { contactAction } from "../src/components/consumer/players/ContactAction";
describe("private relationship navigation", () => {
  it("maps only authoritative eligible state to first contact and preserves exact encoded target", () => {
    expect(contactAction({ state: "none", targetPublicPlayerId: "peer / ?", canRequestContact: true })).toMatchObject({ label: "Написать", href: "/messages?to=peer%20%2F%20%3F" });
    for (const state of ["terminal", "unavailable"] as const) expect(contactAction({ state, targetPublicPlayerId: "peer" }).href).toBeUndefined();
  });
  it("links accepted and pending to their existing conversation without commands", () => {
    for (const state of ["accepted", "pending_outgoing", "pending_incoming"] as const) {
      const action = contactAction({ state, targetPublicPlayerId: "peer", conversationId: "thread / ?", version: 2 });
      expect(action.href).toBe("/messages?conversation=thread%20%2F%20%3F");
      expect(action.label).toBe(state === "accepted" ? "К переписке" : state === "pending_incoming" ? "Ответить на запрос" : "Открыть запрос");
    }
  });
});
