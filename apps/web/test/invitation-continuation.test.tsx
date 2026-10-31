import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Me } from "../src/lib/consumer-types";
import { InvitationChooser } from "../src/components/consumer/messages/InvitationChooser";
import { conversationWithInvitePath, createGameForInvitePath, inviteGameAuthReturnPath, pendingInviteeFromSearch } from "../src/lib/invitation-continuation";

const peer = "10000000-0000-4000-8000-000000000001";
const me = { id: "viewer", csrfToken: "csrf" } as Me;

describe("invite → create game → resume exactly the same player", () => {
  it("carries only one valid public player UUID in a same-origin route", () => {
    expect(createGameForInvitePath(peer.toUpperCase())).toBe("/games/create?invitePlayer=" + peer);
    expect(pendingInviteeFromSearch("?invitePlayer=" + peer)).toBe(peer);
    expect(pendingInviteeFromSearch("?venueId=other&invitePlayer=" + peer)).toBe(peer);
    for (const search of ["", "?invitePlayer=../messages", "?invitePlayer=https://bad.example", "?invitePlayer=" + peer + "&invitePlayer=" + peer]) {
      expect(pendingInviteeFromSearch(search)).toBeNull();
    }
    expect(createGameForInvitePath("javascript:alert(1)")).toBe("/games/create");
  });
  it("keeps the invitee through OAuth and profile-city setup but filters unrelated params", () => {
    expect(inviteGameAuthReturnPath("?invitePlayer=" + peer)).toBe("/games/create?invitePlayer=" + peer);
    expect(inviteGameAuthReturnPath("?venueId=venue&invitePlayer=" + peer + "&next=https://bad.example"))
      .toBe("/games/create?venueId=venue&invitePlayer=" + peer);
    expect(inviteGameAuthReturnPath("?invitePlayer=" + peer, "venue"))
      .toBe("/games/create?venueId=venue&invitePlayer=" + peer);
    expect(inviteGameAuthReturnPath("?invitePlayer=" + peer + "&invitePlayer=" + peer))
      .toBe("/games/create");
    expect(inviteGameAuthReturnPath("?invitePlayer=not-a-uuid&untrusted=1")).toBe("/games/create");
  });
  it("preserves intent when the player already has an existing conversation", () => {
    expect(conversationWithInvitePath("conv&ref", true)).toBe("/messages?conversation=conv%26ref&action=invite");
    expect(conversationWithInvitePath("conv", false)).toBe("/messages?conversation=conv");
  });
  it("offers a create-game continuation before an invitation exists", () => {
    const html = renderToStaticMarkup(<InvitationChooser me={me} playerId={peer} onClose={() => {}} onCreated={() => {}} />);
    expect(html).toContain("/games/create?invitePlayer=" + peer);
    expect(html).not.toContain("inviteePublicPlayerId");
  });
  it("preselects created-game flow without looping back to create again", () => {
    const html = renderToStaticMarkup(<InvitationChooser me={me} playerId={peer} preferredGameId="game" onClose={() => {}} onCreated={() => {}} />);
    expect(html).toContain("Пригласить на игру");
    expect(html).not.toContain("Пригласить в созданную игру");
    expect(html).not.toContain("+ Создать новую игру");
  });
});
