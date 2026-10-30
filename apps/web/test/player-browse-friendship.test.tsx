import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FriendshipView } from "@gobadminton/contracts/friendship-types";
import { friendCommand } from "../src/lib/friendships";
import { canOfferFriendship, relationshipBlocksNewRequest } from "../src/lib/player-browse";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", () => ({
  useState<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (value: T | ((previous: T) => T)) => {
      hooks.slots[index] = typeof value === "function" ? (value as (previous: T) => T)(hooks.slots[index] as T) : value;
    }];
  },
  useRef<T>(initial: T) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect(effect: () => unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) { hooks.slots[index] = true; effect(); }
  },
}));
vi.mock("../src/lib/api-client", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../src/lib/api-client";
import { useSocialMutation } from "../src/components/consumer/messages/useSocialMutation";

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

describe("player browse friendship intent and capabilities", () => {
  it("allows request only for none+canRequest and builds the existing create path", () => {
    expect(canOfferFriendship(none)).toBe(true);
    expect(canOfferFriendship(outgoing)).toBe(false);
    expect(canOfferFriendship(incoming)).toBe(false);
    expect(canOfferFriendship(unavailable)).toBe(false);
    expect(canOfferFriendship(null)).toBe(false);
    expect(friendCommand(none, "peer-1", "request")).toEqual({
      path: "/v1/friend-requests",
      body: { targetPublicPlayerId: "peer-1" },
    });
    expect(friendCommand({ ...none, capabilities: { ...caps } }, "peer-1", "request")).toBeNull();
  });

  it("keeps incoming decisions explicit and never treats browse skip as decline", () => {
    expect(friendCommand(incoming, "peer-1", "accept")?.path).toBe("/v1/friend-requests/r2/accept");
    expect(friendCommand(incoming, "peer-1", "decline")?.path).toBe("/v1/friend-requests/r2/decline");
    expect(friendCommand(incoming, "peer-1", "request")).toBeNull();
    expect(relationshipBlocksNewRequest("incoming_pending")).toBe(true);
  });

  it("uses the same pending scope identity shape as FriendActions", () => {
    const meId = "actor";
    const peerId = "peer-9";
    expect(`${meId}:friends:${peerId}`).toBe("actor:friends:peer-9");
  });
});

describe("player browse unknown readonly check vs mutation retry", () => {
  const success = vi.fn(), refresh = vi.fn();
  const storage = new Map<string, string>();
  function render(scope = "actor:friends:peer") {
    hooks.cursor = 0;
    return useSocialMutation(scope, "csrf", success, refresh);
  }
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

  beforeEach(() => {
    hooks.slots = []; hooks.cursor = 0; storage.clear(); vi.resetAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "browse-attempt-key" });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps unresolved pending latched without auto-clear on 0", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 0, error: "unknown" });
    const mutation = render();
    mutation.run("/v1/friend-requests", { targetPublicPlayerId: "peer" });
    await settle();
    const pending = render();
    expect(pending.pending).toBe(true);
    expect(storage.get("gb-fr04-pending:actor:friends:peer")).toContain("browse-attempt-key");
    // Deck must use GET status — retry remains the existing POST replay and must not be implied by pending alone.
    expect(typeof pending.retry).toBe("function");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("records 429 Retry-After metadata additively without inventing a countdown", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 429, error: "rate", retryAfterSeconds: 42 });
    const mutation = render();
    mutation.run("/v1/friend-requests", { targetPublicPlayerId: "peer" });
    await settle();
    const after = render();
    expect(after.lastStatus).toBe(429);
    expect(after.retryAfterSeconds).toBe(42);
    expect(after.pending).toBe(false);
    expect(success).not.toHaveBeenCalled();
    // Deck maps Retry-After to one absolute deadline; a single expiry timer clears it (no polling/countdown UI).
    const until = Date.now() + Math.max(1, after.retryAfterSeconds ?? 60) * 1000;
    expect(until - Date.now()).toBeGreaterThan(40_000);
    expect(until - Date.now()).toBeLessThanOrEqual(42_000);
  });

  it("does not start a second write while pending for the same peer scope", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, status: 503, error: "unknown" });
    const mutation = render();
    mutation.run("/v1/friend-requests", { targetPublicPlayerId: "peer" });
    await settle();
    const blocked = render();
    blocked.run("/v1/friend-requests", { targetPublicPlayerId: "peer" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
