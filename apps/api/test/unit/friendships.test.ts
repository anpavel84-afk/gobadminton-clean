import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../src/config/env";
import { loadEnv } from "../../src/config/env";
import { assertDecision, canRequestAgain, createRequest, decideRequest, effectivePending, eligible, emptyView, friendsEnabled,
  listQuery, parse, type Availability, type FriendshipRow } from "../../src/friendships/friendships.policy";
import { FriendshipsController } from "../../src/friendships/friendships.controller";
import { FriendshipsService } from "../../src/friendships/friendships.service";
import { ConsumerAuthService } from "../../src/auth/consumer-auth.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { IdempotencyService } from "../../src/common/idempotency.service";

const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const now = new Date("2026-10-11T00:00:00Z");
const row: FriendshipRow = { id: a, pair_id: b, requester_user_id: a, recipient_user_id: b,
  request_id: requestId, generation: "2", version: "9007199254740993", state: "pending",
  requester_epoch: "2", recipient_epoch: "3", requested_at: new Date(now.getTime()-1000),
  expires_at: new Date(now.getTime()+1000), accepted_at: null };
const profile = (id: string, epoch: string): Availability => ({ user_id:id,public_player_id:id,display_name:"Synthetic",
  directory_visible:true,social_eligible:true,contact_policy:"requests",social_action_epoch:epoch,status:"active",unrestricted:true });
const profiles = [profile(a,"2"),profile(b,"3")];
function env(extra = {}): AppEnv {
  return loadEnv({NODE_ENV:"test", APP_ENV:"local", DATABASE_URL:"postgres://fixture:fixture@127.0.0.1/s1_disposable",
    PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",SOCIAL_DIRECTORY_ENABLED:"1",...extra});
}
describe("Friends S1 policy and HTTP authentication", () => {
  it("defaults OFF and missing numerical policy fails closed", () => {
    expect(friendsEnabled(env())).toBe(false);
    expect(friendsEnabled(env({FRIENDS_INTERNAL_ENABLED:"1"}))).toBe(false);
    const fixture = env({FRIENDS_INTERNAL_ENABLED:"1",FRIENDS_REQUEST_TTL_SECONDS:"90",FRIENDS_RATE_WINDOW_SECONDS:"60",FRIENDS_SEND_LIMIT:"2",FRIENDS_RECEIVE_LIMIT:"3"});
    expect(friendsEnabled(fixture)).toBe(true);
    expect(friendsEnabled({...fixture,NODE_ENV:"production"})).toBe(false);
    expect(friendsEnabled({...fixture,APP_ENV:"stage"})).toBe(false);
  });
  it("admits exact canonical PROD and rejects wrong APP/mixed origins", () => {
    const fixture = env({FRIENDS_INTERNAL_ENABLED:"1",FRIENDS_REQUEST_TTL_SECONDS:"90",FRIENDS_RATE_WINDOW_SECONDS:"60",FRIENDS_SEND_LIMIT:"2",FRIENDS_RECEIVE_LIMIT:"3"});
    const prod = {...fixture,NODE_ENV:"production" as const,APP_ENV:"prod" as const,
      PUBLIC_WEB_ORIGIN:"https://gobadminton.ru",PUBLIC_API_ORIGIN:"https://gobadminton.ru"};
    expect(friendsEnabled(prod)).toBe(true);
    expect(friendsEnabled({...prod,SOCIAL_DIRECTORY_ENABLED:false})).toBe(false);
    expect(friendsEnabled({...prod,APP_ENV:"mvp"})).toBe(false);
    expect(friendsEnabled({...prod,PUBLIC_WEB_ORIGIN:"https://dev.gobadminton.ru"})).toBe(false);
    expect(friendsEnabled({...prod,PUBLIC_API_ORIGIN:"https://dev.gobadminton.ru"})).toBe(false);
    expect(friendsEnabled({...prod,PUBLIC_WEB_ORIGIN:"https://www.gobadminton.ru"})).toBe(false);
    expect(friendsEnabled({...prod,PUBLIC_API_ORIGIN:"https://api.gobadminton.ru"})).toBe(false);
    expect(friendsEnabled({...prod,NODE_ENV:"test"})).toBe(false);
  });
  it("requires exact decimal bigint versions and rejects actor fields", () => {
    expect(parse(decideRequest,{expectedVersion:row.version}).expectedVersion).toBe(row.version);
    for (const expectedVersion of [1,"0","01","1e3","9223372036854775808","-1"]) {
      expect(() => parse(decideRequest,{expectedVersion})).toThrow();
    }
    expect(() => parse(createRequest,{targetPublicPlayerId:b,actorId:a})).toThrow();
  });
  it("uses bounded strict list transport and literal search text", () => {
    expect(parse(listQuery,{view:"accepted"}).limit).toBe(20);
    expect(parse(listQuery,{view:"incoming",q:" %_ ",limit:"50"})).toMatchObject({q:"%_",limit:50});
    for (const limit of ["1x",0,51,2.5]) expect(() => parse(listQuery,{view:"accepted",limit})).toThrow();
    expect(() => parse(listQuery,{view:"friends"})).toThrow();
    expect(() => parse(listQuery,{view:"accepted",q:"x".repeat(81)})).toThrow();
  });
  it.each(["accept","decline"])("%s requires actual recipient", action => {
    expect(() => assertDecision(row,a,action,requestId,row.version)).toThrow();
    expect(() => assertDecision(row,b,action,requestId,row.version)).not.toThrow();
  });
  it("cancel requires requester and remove permits either accepted endpoint", () => {
    expect(() => assertDecision(row,b,"cancel",requestId,row.version)).toThrow();
    expect(() => assertDecision(row,a,"cancel",requestId,row.version)).not.toThrow();
    for (const actor of [a,b]) expect(() => assertDecision({...row,state:"accepted"},actor,"remove",row.id,row.version)).not.toThrow();
  });
  it("rejects stale request identity, exact version and outsider", () => {
    expect(() => assertDecision(row,b,"accept",a,row.version)).toThrow();
    expect(() => assertDecision(row,b,"accept",requestId,"9007199254740992")).toThrow();
    expect(() => assertDecision(row,requestId,"remove",row.id,row.version)).toThrow();
    expect(() => assertDecision({...row,state:"cancelled"},b,"accept",requestId,row.version)).toThrow();
  });
  it("expiry equality denies with no worker", () => {
    expect(effectivePending(row,profiles,false,now)).toBe(true);
    expect(effectivePending(row,profiles,false,row.expires_at!)).toBe(false);
  });
  it("allows a fresh request after terminal states or expiry without restoring old rights", () => {
    for (const state of ["declined", "cancelled", "removed", "blocked", "expired"]) {
      expect(canRequestAgain({...row,state},profiles,false,now,true)).toBe(true);
    }
    expect(canRequestAgain(row,profiles,false,row.expires_at!,true)).toBe(true);
    expect(canRequestAgain(row,[profiles[0]!,{...profiles[1]!,social_action_epoch:"4"}],false,now,true)).toBe(true);
    expect(canRequestAgain(row,profiles,false,now,true)).toBe(false);
    const retired = {...row,state:"removed"};
    expect(canRequestAgain({...row,state:"accepted"},profiles,false,now,true)).toBe(false);
    expect(canRequestAgain(retired,profiles,true,now,true)).toBe(false);
    expect(canRequestAgain(retired,profiles,false,now,false)).toBe(false);
    expect(canRequestAgain(retired,[profiles[0]!],false,now,true)).toBe(false);
    expect(canRequestAgain(retired,[profiles[0]!,{...profiles[1]!,directory_visible:false}],false,now,true)).toBe(false);
  });
  it("block and changed epochs never resurrect pending after reenable", () => {
    expect(effectivePending(row,profiles,true,now)).toBe(false);
    expect(effectivePending(row,[profiles[0]!,{...profiles[1]!,social_action_epoch:"4"}],false,now)).toBe(false);
    expect(effectivePending({...row,state:"blocked"},profiles,false,now)).toBe(false);
    expect(effectivePending(row,[profiles[0]!],false,now)).toBe(false);
  });
  it("permits friendship requests without opening direct-message contact requests", () => {
    const closed = {...profiles[1]!,contact_policy:"closed"};
    expect(eligible(closed)).toBe(true);
    expect(canRequestAgain({...row,state:"removed"},[profiles[0]!,closed],false,now,true)).toBe(true);
    expect(effectivePending(row,[profiles[0]!,closed],false,now)).toBe(true);
    expect(effectivePending(row,[profiles[0]!,{...closed,social_action_epoch:"4"}],false,now)).toBe(false);
  });
  it.each([{status:"disabled"},{status:"deletion_pending"},{directory_visible:false},
    {social_eligible:false},{unrestricted:false}])("availability fails closed: %j", change => {
    expect(eligible({...profiles[1]!,...change})).toBe(false);
    expect(effectivePending(row,[profiles[0]!,{...profiles[1]!,...change}],false,now)).toBe(false);
  });
  it("placeholder has no internal identity or peer", () => {
    expect(emptyView()).toEqual({friendshipId:null,relationship:"unavailable",version:null,request:null,peer:null,
      capabilities:{canRequest:false,canAccept:false,canDecline:false,canCancel:false,canRemove:false}});
  });
  it.each([
    {headers:{origin:"https://evil.test","x-csrf-token":"ok"},cookies:{[SESSION_COOKIE]:"session"}},
    {headers:{origin:"http://127.0.0.1:3001"},cookies:{[SESSION_COOKIE]:"session"}},
    {headers:{origin:"http://127.0.0.1:3001","x-csrf-token":"ok",authorization:"Bearer other"},cookies:{[SESSION_COOKIE]:"session"}},
    {headers:{origin:"http://127.0.0.1:3001","x-csrf-token":"bad"},cookies:{[SESSION_COOKIE]:"session"}},
  ])("controller rejects credential/origin/CSRF attacks before mutation", async req => {
    const config=env();
    const auth=new ConsumerAuthService(config,{lookupActiveSession:async()=>({userId:a,id:b}),verifyCsrf:async(_:string,value:string)=>value==="ok"} as never,
      {getUser:async()=>({id:a,status:"active"})} as never);
    const create=vi.fn();
    const controller=new FriendshipsController(auth,new IdempotencyService({} as never,config),{create} as never);
    await expect(controller.create({...req,body:{targetPublicPlayerId:b}} as never,{status:vi.fn()} as never)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("controller forwards session actor, key and payload, preserving response status", async () => {
    const config=env();
    const auth=new ConsumerAuthService(config,{lookupActiveSession:async()=>({userId:a,id:b}),verifyCsrf:async()=>true} as never,
      {getUser:async()=>({id:a,status:"active"})} as never);
    const create=vi.fn().mockResolvedValue({statusCode:201,body:{version:"1"}});const status=vi.fn();
    const controller=new FriendshipsController(auth,new IdempotencyService({} as never,config),{create} as never);
    const body={targetPublicPlayerId:b};
    await expect(controller.create({headers:{origin:config.PUBLIC_WEB_ORIGIN,"x-csrf-token":"ok","idempotency-key":"synthetic-key-123"},
      cookies:{[SESSION_COOKIE]:"session"},body} as never,{status} as never)).resolves.toEqual({version:"1"});
    expect(create).toHaveBeenCalledWith(a,b,"synthetic-key-123",body);expect(status).toHaveBeenCalledWith(201);
  });
});

describe("Friends S1 Service.view retired relationship contract", () => {
  const enabledEnv = env({
    FRIENDS_INTERNAL_ENABLED: "1",
    FRIENDS_REQUEST_TTL_SECONDS: "90",
    FRIENDS_RATE_WINDOW_SECONDS: "60",
    FRIENDS_SEND_LIMIT: "2",
    FRIENDS_RECEIVE_LIMIT: "3",
  });
  const avatarClient = {
    query: async () => ({ rows: [{ avatar_key: null, provider_url: null }] }),
  };
  function serviceWithEnv(config: AppEnv = enabledEnv) {
    return Object.assign(Object.create(FriendshipsService.prototype), { env: config }) as FriendshipsService;
  }
  async function viewOf(
    service: FriendshipsService,
    actor: string,
    friendship: FriendshipRow,
    ctx: { profiles: Availability[]; blocked: boolean; now: Date },
  ) {
    return (service as unknown as {
      view: (client: unknown, actor: string, row: FriendshipRow, ctx: unknown) => Promise<{
        relationship: string; peer: { publicPlayerId: string } | null;
        capabilities: { canRequest: boolean };
        request: unknown;
      }>;
    }).view(avatarClient, actor, friendship, ctx);
  }

  it("retired/expired/stale-epoch eligible peers surface as none + canRequest with visible peer", async () => {
    const service = serviceWithEnv();
    const ctx = { profiles, blocked: false, now };
    for (const state of ["declined", "cancelled", "removed", "blocked", "expired"] as const) {
      const viewed = await viewOf(service, a, { ...row, state }, ctx);
      expect(viewed).toMatchObject({
        relationship: "none",
        peer: { publicPlayerId: b },
        capabilities: { canRequest: true },
        request: null,
      });
    }
    const expired = await viewOf(service, a, row, { profiles, blocked: false, now: row.expires_at! });
    expect(expired).toMatchObject({ relationship: "none", peer: { publicPlayerId: b }, capabilities: { canRequest: true } });
    const staleEpoch = await viewOf(service, a, row, {
      profiles: [profiles[0]!, { ...profiles[1]!, social_action_epoch: "4" }],
      blocked: false,
      now,
    });
    expect(staleEpoch).toMatchObject({ relationship: "none", peer: { publicPlayerId: b }, capabilities: { canRequest: true } });
  });

  it("preserves accepted/pending and blocked/ineligible/disabled unavailable boundaries", async () => {
    const service = serviceWithEnv();
    const friends = await viewOf(service, a, { ...row, state: "accepted" }, { profiles, blocked: false, now });
    expect(friends).toMatchObject({ relationship: "friends", peer: { publicPlayerId: b }, capabilities: { canRequest: false } });
    const outgoing = await viewOf(service, a, row, { profiles, blocked: false, now });
    expect(outgoing).toMatchObject({
      relationship: "outgoing_pending",
      peer: { publicPlayerId: b },
      capabilities: { canRequest: false },
    });
    const incoming = await viewOf(service, b, row, { profiles, blocked: false, now });
    expect(incoming).toMatchObject({ relationship: "incoming_pending", capabilities: { canRequest: false } });

    const blocked = await viewOf(service, a, { ...row, state: "removed" }, { profiles, blocked: true, now });
    expect(blocked).toMatchObject({ relationship: "unavailable", peer: null, capabilities: { canRequest: false } });
    const ineligible = await viewOf(service, a, { ...row, state: "removed" }, {
      profiles: [profiles[0]!, { ...profiles[1]!, directory_visible: false }],
      blocked: false,
      now,
    });
    expect(ineligible).toMatchObject({ relationship: "unavailable", peer: null, capabilities: { canRequest: false } });
    const disabled = await viewOf(service, a, { ...row, state: "removed" }, {
      profiles: [profiles[0]!, { ...profiles[1]!, status: "disabled" }],
      blocked: false,
      now,
    });
    expect(disabled).toMatchObject({ relationship: "unavailable", peer: null, capabilities: { canRequest: false } });
    const featureOff = await viewOf(serviceWithEnv(env()), a, { ...row, state: "removed" }, { profiles, blocked: false, now });
    expect(featureOff).toMatchObject({ relationship: "unavailable", peer: null, capabilities: { canRequest: false } });
  });
});

describe("Friends S1 cursor privacy regression", () => {
  it("opaque cursor contains no internal user/pair IDs, retains public friendship pagination and actor/query binding", async () => {
    const visibleFriendshipId = "10000000-0000-4000-8000-000000000004";
    const secondFriendshipId = "10000000-0000-4000-8000-000000000005";
    const first = { ...row, id: visibleFriendshipId, state: "accepted" };
    const second = { ...row, id: secondFriendshipId, state: "accepted" };
    const service = Object.assign(Object.create(FriendshipsService.prototype), {
      env: env({ FRIENDS_REQUEST_TTL_SECONDS: "90", AUTH_PEPPER: "S1-only-synthetic-privacy-secret-not-production" }),
      read: async (_actor: string, _session: string,
        callback: (client: unknown) => Promise<unknown>) => callback({
        query: async (sql: string) => {
          if (sql.includes("to_regclass")) return { rows: [{ name: "friendships" }] };
          if (sql.includes("SELECT f.* FROM friendships f")) return { rows: [first, second] };
          throw new Error("unexpected synthetic SQL");
        },
      }),
      profiles: async () => profiles,
      lock: async (_client: unknown, _actor: string, locator: FriendshipRow) =>
        ({ row: locator, ctx: { profiles, blocked: false, now: new Date() } }),
      view: async (_client: unknown, _actor: string, locator: FriendshipRow) =>
        ({ ...emptyView(), friendshipId: locator.id, relationship: "friends" }),
    }) as FriendshipsService;
    const page = await service.list(a, b, { view: "accepted", limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.friendshipId).toBe(visibleFriendshipId);
    const cursor = page.nextCursor!;
    expect(cursor).toBeTypeOf("string");
    const segments = cursor.split(".");
    expect(segments).toHaveLength(2);
    const decoded = Buffer.from(segments[0]!, "base64url").toString("utf8");
    const data = JSON.parse(decoded);
    expect(data.binding).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const privateId of [a, b, requestId]) expect(decoded).not.toContain(privateId);
    // 'after' is the documented actor-visible friendshipId, never a userId or pairId.
    expect(data.after).toBe(visibleFriendshipId);
    expect(data.expires).toBeGreaterThan(data.asOf);
    await expect(service.list(a, b, { view: "accepted", limit: 1, cursor })).resolves.toMatchObject({
      items: [{ friendshipId: visibleFriendshipId }],
    });
    for (const query of [
      { actor: b, view: "accepted", q: undefined }, { actor: a, view: "incoming", q: undefined },
      { actor: a, view: "accepted", q: "Synthetic" },
    ]) {
      await expect(service.list(query.actor, b, { view: query.view, q: query.q, cursor }))
        .rejects.toThrow();
    }
    await expect(service.list(a, b, { view: "accepted", cursor: cursor + "tampered" }))
      .rejects.toThrow();
  });
});
