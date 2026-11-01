import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FriendshipView } from "@gobadminton/contracts/friendship-types";
import { friendCommand } from "../src/lib/friendships";
import { canOfferFriendship, relationshipBlocksNewRequest } from "../src/lib/player-browse";

const friendshipSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/components/consumer/players/PlayerBrowseFriendship.tsx"),
  "utf8",
);
const deckSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/components/consumer/players/PlayerBrowseDeck.tsx"),
  "utf8",
);
const profileFriendshipSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/components/consumer/friends/ProfileFriendship.tsx"),
  "utf8",
);

const caps = { canRequest: false, canAccept: false, canDecline: false, canCancel: false, canRemove: false };
const none: FriendshipView = {
  friendshipId: null, relationship: "none", version: null, request: null, peer: null,
  capabilities: { ...caps, canRequest: true },
};
const outgoing: FriendshipView = {
  friendshipId: null, relationship: "outgoing_pending", version: "1", request: { id: "r1", expiresAt: "2099-01-01T00:00:00Z" }, peer: null,
  capabilities: { ...caps, canCancel: true },
};
const incoming: FriendshipView = {
  friendshipId: null, relationship: "incoming_pending", version: "1", request: { id: "r2", expiresAt: "2099-01-01T00:00:00Z" }, peer: null,
  capabilities: { ...caps, canAccept: true, canDecline: true },
};
const unavailable: FriendshipView = {
  friendshipId: null, relationship: "unavailable", version: null, request: null, peer: null, capabilities: { ...caps },
};
const retiredButEligible: FriendshipView = {
  friendshipId: "f1", relationship: "unavailable", version: "3", request: null, peer: null,
  capabilities: { ...caps, canRequest: true },
};
const friends: FriendshipView = {
  friendshipId: "f2", relationship: "friends", version: "2", request: null, peer: null,
  capabilities: { ...caps, canRemove: true },
};

describe("profile friendship remains intact outside browse deck", () => {
  it("keeps ProfileFriendship source and friendCommand paths for the friends panel", () => {
    expect(profileFriendshipSource).toContain("getFriendState");
    expect(canOfferFriendship(none)).toBe(true);
    expect(canOfferFriendship(outgoing)).toBe(false);
    expect(canOfferFriendship(incoming)).toBe(false);
    expect(canOfferFriendship(unavailable)).toBe(false);
    expect(canOfferFriendship(retiredButEligible)).toBe(true);
    expect(canOfferFriendship(friends)).toBe(false);
    expect(canOfferFriendship({ ...friends, capabilities: { ...caps, canRequest: true } })).toBe(false);
    expect(friendCommand(none, "peer-1", "request")).toEqual({
      path: "/v1/friend-requests",
      body: { targetPublicPlayerId: "peer-1" },
    });
    expect(friendCommand(incoming, "peer-1", "accept")?.path).toBe("/v1/friend-requests/r2/accept");
    expect(relationshipBlocksNewRequest("incoming_pending")).toBe(true);
  });

  it("browse deck no longer mounts PlayerBrowseFriendship; legacy component keeps friends pending scope for non-deck reuse", () => {
    expect(deckSource).not.toContain("PlayerBrowseFriendship");
    expect(deckSource).toContain("PlayerBrowsePlayInterest");
    expect(friendshipSource).toContain('from "../../../lib/friendships"');
    expect(friendshipSource).toMatch(/\$\{me\.id\}:friends:\$\{peerId\}/);
    expect(friendshipSource).toMatch(/friendCommand\(/);
    expect(friendCommand(none, "peer-1", "request")?.path).toBe("/v1/friend-requests");
  });

  it("finder layout CTAs unchanged while friendship scope stays outside deck (#445 C negative)", () => {
    const pageSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/components/consumer/pages/PlayersDirectoryPage.tsx"),
      "utf8",
    );
    expect(pageSource).toContain("Свайп");
    expect(pageSource).toContain("По одному");
    expect(deckSource).not.toContain("PlayerBrowseFriendship");
    expect(deckSource).toContain("PlayerBrowsePlayInterest");
  });
});
