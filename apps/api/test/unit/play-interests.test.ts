import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../src/config/env";
import { loadEnv } from "../../src/config/env";
import {
  actorRelationship, canSend, createRequest, effectiveActive, eligible, emptyView,
  parse, playInterestsEnabled, withdrawRequest, type Availability, type PlayInterestRow,
} from "../../src/play-interests/play-interests.policy";
import { PlayInterestsController } from "../../src/play-interests/play-interests.controller";
import { ConsumerAuthService } from "../../src/auth/consumer-auth.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { IdempotencyService } from "../../src/common/idempotency.service";

const a = "10000000-0000-4000-8000-000000000001";
const b = "10000000-0000-4000-8000-000000000002";
const interestId = "10000000-0000-4000-8000-000000000003";
const now = new Date("2026-10-30T00:00:00Z");
const row: PlayInterestRow = {
  id: a, pair_id: b, actor_user_id: a, peer_user_id: b, interest_id: interestId,
  generation: "1", version: "1", state: "active", actor_epoch: "2", peer_epoch: "3",
  created_at: now, updated_at: now,
};
const profile = (id: string, epoch: string): Availability => ({
  user_id: id, public_player_id: id, display_name: "Synthetic",
  directory_visible: true, social_eligible: true, contact_policy: "requests",
  social_action_epoch: epoch, status: "active", unrestricted: true,
});
const profiles = [profile(a, "2"), profile(b, "3")];

function env(extra: Record<string, string> = {}): AppEnv {
  return loadEnv({
    NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: "postgres://fixture:fixture@127.0.0.1/play_interest_disposable",
    PUBLIC_API_ORIGIN: "http://127.0.0.1:3000", SOCIAL_DIRECTORY_ENABLED: "1", ...extra,
  });
}

describe("Play interest policy and HTTP authentication", () => {
  it("enables on local test + directory without Friends toggle; fails closed outside DEV origin", () => {
    expect(playInterestsEnabled(env())).toBe(true);
    expect(playInterestsEnabled(env({ SOCIAL_DIRECTORY_ENABLED: "0" }))).toBe(false);
    expect(playInterestsEnabled({ ...env(), NODE_ENV: "production", APP_ENV: "prod" })).toBe(false);
    expect(playInterestsEnabled({
      ...env(),
      NODE_ENV: "production",
      APP_ENV: "stage",
      PUBLIC_WEB_ORIGIN: "https://dev.gobadminton.ru",
      PUBLIC_API_ORIGIN: "https://dev.gobadminton.ru",
    })).toBe(true);
    expect(playInterestsEnabled({
      ...env(),
      NODE_ENV: "production",
      APP_ENV: "stage",
      PUBLIC_WEB_ORIGIN: "https://gobadminton.ru",
      PUBLIC_API_ORIGIN: "https://gobadminton.ru",
    })).toBe(false);
  });

  it("requires exact decimal bigint versions and rejects actor fields", () => {
    expect(parse(withdrawRequest, { expectedVersion: "1" }).expectedVersion).toBe("1");
    for (const expectedVersion of [1, "0", "01", "1e3", "9223372036854775808", "-1"]) {
      expect(() => parse(withdrawRequest, { expectedVersion })).toThrow();
    }
    expect(() => parse(createRequest, { targetPublicPlayerId: b, actorId: a })).toThrow();
  });

  it("treats live active rows as effective only with matching epochs and no block", () => {
    expect(effectiveActive(row, profiles, false)).toBe(true);
    expect(effectiveActive(row, profiles, true)).toBe(false);
    expect(effectiveActive({ ...row, state: "withdrawn" }, profiles, false)).toBe(false);
    expect(effectiveActive(row, [profiles[0]!, { ...profiles[1]!, social_action_epoch: "9" }], false)).toBe(false);
  });

  it("never discloses unilateral inbound: actor sees none while peer intent is live alone", () => {
    // Reverse directed actors and swap epochs so peer→actor matches profiles[b]=3 / profiles[a]=2.
    const peerOnly: PlayInterestRow = {
      ...row, actor_user_id: b, peer_user_id: a, interest_id: interestId,
      actor_epoch: "3", peer_epoch: "2",
    };
    expect(actorRelationship(undefined, peerOnly, profiles, false, true)).toBe("none");
    expect(canSend(undefined, profiles, false, true)).toBe(true);
    expect(actorRelationship(row, undefined, profiles, false, true)).toBe("outgoing");
    expect(actorRelationship(row, peerOnly, profiles, false, true)).toBe("mutual");
  });

  it("allows resend after withdraw or epoch invalidation without restoring mutual rights", () => {
    expect(canSend({ ...row, state: "withdrawn" }, profiles, false, true)).toBe(true);
    expect(canSend(row, [profiles[0]!, { ...profiles[1]!, social_action_epoch: "9" }], false, true)).toBe(true);
    expect(canSend(row, profiles, false, true)).toBe(false);
    expect(canSend(row, profiles, true, true)).toBe(false);
    expect(canSend(undefined, profiles, false, false)).toBe(false);
  });

  it("play interest eligibility ignores contact_policy; public/social/blocks still fence", () => {
    const closed = { ...profiles[1]!, contact_policy: "closed" };
    expect(eligible(closed)).toBe(true);
    expect(effectiveActive(row, [profiles[0]!, closed], false)).toBe(true);
    expect(eligible({ ...profiles[1]!, directory_visible: false })).toBe(false);
  });

  it("placeholder has no interest id or rights", () => {
    expect(emptyView()).toEqual({
      interestId: null, relationship: "unavailable", version: null,
      capabilities: { canSend: false, canWithdraw: false },
    });
  });

  it.each([
    { headers: { origin: "https://evil.test", "x-csrf-token": "ok" }, cookies: { [SESSION_COOKIE]: "session" } },
    { headers: { origin: "http://127.0.0.1:3001" }, cookies: { [SESSION_COOKIE]: "session" } },
    { headers: { origin: "http://127.0.0.1:3001", "x-csrf-token": "ok", authorization: "Bearer other" }, cookies: { [SESSION_COOKIE]: "session" } },
    { headers: { origin: "http://127.0.0.1:3001", "x-csrf-token": "bad" }, cookies: { [SESSION_COOKIE]: "session" } },
  ])("controller rejects credential/origin/CSRF attacks before mutation", async req => {
    const config = env();
    const auth = new ConsumerAuthService(
      config,
      { lookupActiveSession: async () => ({ userId: a, id: b }), verifyCsrf: async (_: string, value: string) => value === "ok" } as never,
      { getUser: async () => ({ id: a, status: "active" }) } as never,
    );
    const create = vi.fn();
    const controller = new PlayInterestsController(auth, new IdempotencyService({} as never, config), { create } as never);
    await expect(controller.create({ ...req, body: { targetPublicPlayerId: b } } as never, { status: vi.fn() } as never)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("controller forwards session actor, key and payload, preserving response status", async () => {
    const config = env();
    const auth = new ConsumerAuthService(
      config,
      { lookupActiveSession: async () => ({ userId: a, id: b }), verifyCsrf: async () => true } as never,
      { getUser: async () => ({ id: a, status: "active" }) } as never,
    );
    const create = vi.fn().mockResolvedValue({ statusCode: 201, body: { version: "1" } });
    const status = vi.fn();
    const controller = new PlayInterestsController(auth, new IdempotencyService({} as never, config), { create } as never);
    const body = { targetPublicPlayerId: b };
    await expect(controller.create({
      headers: { origin: config.PUBLIC_WEB_ORIGIN, "x-csrf-token": "ok", "idempotency-key": "synthetic-key-123456" },
      cookies: { [SESSION_COOKIE]: "session" }, body,
    } as never, { status } as never)).resolves.toEqual({ version: "1" });
    expect(create).toHaveBeenCalledWith(a, b, "synthetic-key-123456", body);
    expect(status).toHaveBeenCalledWith(201);
  });
});
