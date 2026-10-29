import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env";
import { effectivePending, eligible, friendsEnabled, type Availability, type FriendshipRow } from "../../src/friendships/friendships.policy";
import { FriendshipsService } from "../../src/friendships/friendships.service";
const dev = {
  NODE_ENV: "production", APP_ENV: "mvp", DATABASE_URL: "postgres://synthetic:synthetic@localhost/friends_disposable",
  PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru", PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru",
  CONTENT_MODERATION_PROVIDER: "openai", CONTENT_MODERATION_FINGERPRINT_SECRET: "synthetic-fingerprint-secret-32chars",
  OPENAI_MODERATION_API_KEY: "synthetic-not-a-real-key", FRIENDS_INTERNAL_ENABLED: "1", SOCIAL_DIRECTORY_ENABLED: "1",
  FRIENDS_REQUEST_TTL_SECONDS: "604800", FRIENDS_RATE_WINDOW_SECONDS: "3600", FRIENDS_SEND_LIMIT: "20", FRIENDS_RECEIVE_LIMIT: "50",
};
describe("explicit Friends DEV admission", () => {
  it.each(["mvp", "stage"])("admits exact DEV production runtime %s", APP_ENV => {
    expect(friendsEnabled(loadEnv({ ...dev, APP_ENV }))).toBe(true);
  });
  it("defaults off even at DEV and rejects bypass through runtime object", () => {
    expect(friendsEnabled(loadEnv({ ...dev, FRIENDS_INTERNAL_ENABLED: undefined }))).toBe(false);
    expect(friendsEnabled({ ...loadEnv(dev), APP_ENV: "prod" })).toBe(false);
    expect(friendsEnabled({ ...loadEnv(dev), FRIENDS_SEND_LIMIT: 101 })).toBe(false);
    expect(friendsEnabled({ ...loadEnv(dev), FRIENDS_SEND_LIMIT: -1 })).toBe(false);
    expect(friendsEnabled({ ...loadEnv(dev), FRIENDS_RATE_WINDOW_SECONDS: 1.5 })).toBe(false);
    expect(friendsEnabled({ ...loadEnv(dev), NODE_ENV: "development" })).toBe(false);
  });
  it.each([
    { APP_ENV: "prod" }, { APP_ENV: "prod", NODE_ENV: "test" }, { APP_ENV: "local" }, { PUBLIC_WEB_ORIGIN: "https://gobadminton.ru" },
    { PUBLIC_API_ORIGIN: "https://api.gobadminton.ru" }, { PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru/" },
    { PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru:443" }, { SOCIAL_DIRECTORY_ENABLED: "0" },
    { FRIENDS_REQUEST_TTL_SECONDS: undefined }, { FRIENDS_RATE_WINDOW_SECONDS: undefined },
    { FRIENDS_SEND_LIMIT: undefined }, { FRIENDS_RECEIVE_LIMIT: undefined },
    { FRIENDS_REQUEST_TTL_SECONDS: "2592001" }, { FRIENDS_RATE_WINDOW_SECONDS: "86401" },
    { FRIENDS_SEND_LIMIT: "101" }, { FRIENDS_RECEIVE_LIMIT: "101" }, { FRIENDS_SEND_LIMIT: "0" },
  ])("rejects non-DEV or unbounded explicit admission: %j", extra => {
    expect(() => loadEnv({ ...dev, ...extra })).toThrow();
  });
  it("allows ordinary PROD configuration with flag off", () => {
    expect(friendsEnabled(loadEnv({ ...dev, APP_ENV: "prod", PUBLIC_WEB_ORIGIN: "https://gobadminton.ru", PUBLIC_API_ORIGIN: "https://api.gobadminton.ru", FRIENDS_INTERNAL_ENABLED: "0" }))).toBe(false);
  });
  it("does not enable restrictions Admin or invitations globally", () => {
    const env = loadEnv(dev);
    expect(env.ADMIN_INTERNAL_ENABLED).toBe(false);
    expect(env.USER_RESTRICTIONS_INTERNAL_ENABLED).toBe(false);
    expect(env.SOCIAL_INVITATIONS_ENABLED).toBe(false);
  });
});

// The DEV switch must not bypass the existing contact/epoch/block policy.
describe("DEV privacy fences", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const actor: Availability = { user_id: "actor", public_player_id: "public-actor", display_name: "Synthetic",
    directory_visible: true, social_eligible: true, contact_policy: "requests", social_action_epoch: "2", status: "active", unrestricted: true };
  const peer = { ...actor, user_id: "peer", public_player_id: "public-peer", social_action_epoch: "3" };
  const pending: FriendshipRow = { id: "friend", pair_id: "pair", requester_user_id: "actor", recipient_user_id: "peer",
    request_id: "request", generation: "1", version: "1", state: "pending", requester_epoch: "2", recipient_epoch: "3",
    requested_at: now, expires_at: new Date(now.getTime() + 60000), accepted_at: null };
  it("admitted DEV still denies blocked pair and revoked contact epochs", () => {
    expect(friendsEnabled(loadEnv(dev))).toBe(true);
    expect(effectivePending(pending, [actor, peer], false, now)).toBe(true);
    expect(effectivePending(pending, [actor, peer], true, now)).toBe(false);
    expect(effectivePending(pending, [actor, { ...peer, social_action_epoch: "4" }], false, now)).toBe(false);
  });
  it.each([{ directory_visible: false }, { social_eligible: false }, { unrestricted: false }, { status: "deleted" }])("withdraw/restriction denies entitlement: %j", extra => {
    expect(eligible({ ...peer, ...extra })).toBe(false);
    expect(effectivePending(pending, [actor, { ...peer, ...extra }], false, now)).toBe(false);
  });
  it("permits an independent friend request when private messages are closed", () => {
    const closed = { ...peer, contact_policy: "closed" };
    expect(eligible(closed)).toBe(true);
    expect(effectivePending(pending, [actor, closed], false, now)).toBe(true);
    expect(effectivePending(pending, [actor, { ...closed, social_action_epoch: "4" }], false, now)).toBe(false);
  });
  it("DEV capabilities query enforces existing restrictions even with global Admin flag off", async () => {
    const queries: string[] = [];
    const client = { query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("to_regclass")) {
        return { rows: [{ friendships: "friendships", recommendations: "game_recommendations" }] };
      }
      if (sql.includes("SELECT p.*")) return { rows: [{ ...actor, unrestricted: false }] };
      return { rows: [] };
    } };
    const service = Object.assign(Object.create(FriendshipsService.prototype), {
      env: loadEnv(dev), read: async (_actor: string, _session: string, fn: (value: unknown) => Promise<unknown>) => fn(client),
    }) as FriendshipsService;
    expect(await service.capabilities("actor", "session")).toEqual({
      friends: false, gameRecommendations: false, gameAttention: false, socialPush: false,
    });
    expect(queries.find(sql => sql.includes("SELECT p.*"))).toContain("FROM user_restrictions ur");
    expect(queries.find(sql => sql.includes("SELECT p.*"))).toContain("'account.access'");
  });
  it("gameRecommendations requires friends eligibility and both installed tables", async () => {
    const cases: Array<{
      friendships: string | null; recommendations: string | null; profile: Availability; friendsOn: boolean;
      expectFriends: boolean; expectRecs: boolean;
    }> = [
      { friendships: "friendships", recommendations: "game_recommendations", profile: actor, friendsOn: true,
        expectFriends: true, expectRecs: true },
      { friendships: "friendships", recommendations: null, profile: actor, friendsOn: true,
        expectFriends: true, expectRecs: false },
      { friendships: null, recommendations: "game_recommendations", profile: actor, friendsOn: true,
        expectFriends: false, expectRecs: false },
      { friendships: "friendships", recommendations: "game_recommendations", profile: { ...actor, unrestricted: false },
        friendsOn: true, expectFriends: false, expectRecs: false },
      { friendships: "friendships", recommendations: "game_recommendations", profile: actor, friendsOn: false,
        expectFriends: false, expectRecs: false },
    ];
    for (const c of cases) {
      const client = { query: async (sql: string) => {
        if (sql.includes("to_regclass")) {
          return { rows: [{ friendships: c.friendships, recommendations: c.recommendations }] };
        }
        if (sql.includes("SELECT p.*")) return { rows: [c.profile] };
        return { rows: [] };
      } };
      const env = loadEnv(dev);
      if (!c.friendsOn) env.FRIENDS_INTERNAL_ENABLED = false;
      const service = Object.assign(Object.create(FriendshipsService.prototype), {
        env, read: async (_a: string, _s: string, fn: (value: unknown) => Promise<unknown>) => fn(client),
      }) as FriendshipsService;
      expect(await service.capabilities("actor", "session")).toEqual({
        friends: c.expectFriends, gameRecommendations: c.expectRecs, gameAttention: false, socialPush: false,
      });
    }
  });
});
