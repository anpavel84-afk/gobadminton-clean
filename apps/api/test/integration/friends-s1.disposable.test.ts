import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FriendshipReceipt, FriendshipView } from "@gobadminton/contracts/friendship-types";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { FriendshipsService } from "../../src/friendships/friendships.service";
import { FriendshipsModule } from "../../src/friendships/friendships.module";
import { GamesModule } from "../../src/games/games.module";
import { InvitationsModule } from "../../src/invitations/invitations.module";
import { InboxModule } from "../../src/inbox/inbox.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { PairFenceService } from "../../src/safety/pair-fence.service";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

// No URL fallback, no shared test DB, no external provider or existing users.
// Runner must provide a fresh disposable PostGIS DB with this exact name.
const DB_NAME = "gobadminton_friends_s1_disposable";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
function disposableUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL must explicitly identify the Friends S1 disposable DB");
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || decodeURIComponent(url.pathname) !== `/${DB_NAME}` || url.search || url.hash
    || process.env.NODE_ENV !== "test") {
    throw new Error("Refusing nonlocal/non-test/nonisolated Friends S1 DB before connecting");
  }
  return raw;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return {promise,resolve};
}
/** Test-only barrier around the authentic PairFence SQL; no lock simulation. */
class ObservedPairs extends PairFenceService {
  private armed: { held: ReturnType<typeof deferred<number>>; release: ReturnType<typeof deferred<void>> } | null = null;
  arm() {
    if (this.armed) throw new Error("Pair barrier already armed");
    const gate = {held:deferred<number>(),release:deferred<void>()};
    this.armed = gate;
    return gate;
  }
  override async lockOrCreate(client: PoolClient, a: string, b: string) {
    const gate = this.armed;
    if (gate) this.armed = null; // Only the first writer pauses; waiter uses real SQL.
    const row = await super.lockOrCreate(client,a,b);
    if (gate) {
      const pid = (await client.query<{pid:number}>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      gate.held.resolve(pid);
      await gate.release.promise;
    }
    return row;
  }
  clear() { this.armed = null; }
}
type Actor = {userId:string;publicPlayerId:string;sessionId:string;csrfToken:string;cookie:string};
type Response = Awaited<ReturnType<NestFastifyApplication["inject"]>>;

run("Friends S1 API — isolated synthetic PostGIS only", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  const pairs = new ObservedPairs();
  let a: Actor, b: Actor, outsider: Actor;
  let schema0031Evidence: {capabilities:unknown;list:unknown;sendStatus:number};
  const fixturePolicy = { FRIENDS_INTERNAL_ENABLED:"1", FRIENDS_REQUEST_TTL_SECONDS:"120",
    FRIENDS_RATE_WINDOW_SECONDS:"600", FRIENDS_SEND_LIMIT:"100", FRIENDS_RECEIVE_LIMIT:"100" };
  // All numbers in this file are synthetic fixture inputs, not approved G-03 policy.

  beforeAll(async () => {
    const databaseUrl = disposableUrl(); // Validation happens before constructing Pool.
    pool = new Pool({connectionString:databaseUrl,max:12,connectionTimeoutMillis:5000,
      application_name:"gobadminton-friends-s1-synthetic"});
    const existing = await pool.query<{name:string}>(`SELECT tablename AS name FROM pg_tables
      WHERE schemaname='public' AND tablename <> 'spatial_ref_sys'`);
    if (existing.rows.length) throw new Error("S1 suite requires an EMPTY application DB; recreate only its disposable DB");
    const migrations = path.resolve(__dirname,"../../migrations");
    const files = (await readdir(migrations)).filter(f => f.endsWith(".sql")).sort();
    const client = await pool.connect();
    try {
      await client.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
      for (const file of files.filter(f => f < "0032")) {
        await client.query("BEGIN");
        try {
          await client.query(await readFile(path.join(migrations,file),"utf8"));
          await client.query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]);
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
      }
    } finally { client.release(); }
    env = loadEnv({NODE_ENV:"test",APP_ENV:"local",HOST:"127.0.0.1",DATABASE_URL:databaseUrl,
      PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",PUBLIC_WEB_ORIGIN:origin,COOKIE_SECURE:"false",
      AUTH_PEPPER:"friends-s1-synthetic-fixture-pepper-only",CONTENT_MODERATION_PROVIDER:"fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET:"friends-s1-synthetic-fingerprint-only",SOCIAL_DIRECTORY_ENABLED:"1",
      SOCIAL_INVITATIONS_ENABLED:"1",SOCIAL_INBOX_ENABLED:"1",
      ...fixturePolicy});
    // Actual registered FriendsModule/Auth/Profiles/Safety and shared test core.
    const ref = await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),FriendshipsModule,
      GamesModule,InvitationsModule,InboxModule,VenuesModule]})
      .overrideProvider(PairFenceService).useValue(pairs).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    await app.register(cookie);
    app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);
    // Feature OFF against schema0031, before unchanged migration0032 is applied.
    env.FRIENDS_INTERNAL_ENABLED = false;
    const oldActor = await actor("S1 schema0031 synthetic");
    const caps = await get(oldActor,"/v1/me/social-capabilities");
    const list = await get(oldActor,"/v1/me/friendships?view=accepted");
    const send = await post(oldActor,"/v1/friend-requests",{targetPublicPlayerId:randomUUID()});
    expect(caps.statusCode).toBe(200);expect(list.statusCode).toBe(200);
    schema0031Evidence = {capabilities:caps.json(),list:list.json(),sendStatus:send.statusCode};
    const oldPeer = await actor("S1 schema0031 peer synthetic");
    expect((await putBlock(oldActor,oldPeer)).statusCode).toBe(200);
    expect((await putBlock(oldActor,oldPeer,true)).statusCode).toBe(200);
    const upgrade = await pool.connect();
    try {
      await upgrade.query("BEGIN");
      await upgrade.query(await readFile(path.join(migrations,"0032_friendship_core.sql"),"utf8"));
      await upgrade.query("INSERT INTO schema_migrations(id) VALUES('0032_friendship_core')");
      await upgrade.query("COMMIT");
    } catch (error) { await upgrade.query("ROLLBACK"); throw error; }
    finally { upgrade.release(); }
    expect((await pool.query("SELECT count(*)::int AS n FROM friendships")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT social_action_epoch FROM player_social_profiles WHERE user_id=$1",[oldActor.userId])).rows[0].social_action_epoch).toBe("1");
    // Exercise the actual recovery SQL only in this validated disposable DB.
    // Roll the recovery transaction back so the remaining API cases use 0032.
    const recovery = await pool.connect();
    try {
      await recovery.query("BEGIN");
      await recovery.query(await readFile(path.join(migrations,"rollback/0032_friendship_core.sql"),"utf8"));
      expect((await recovery.query("SELECT to_regclass('friendships') AS name")).rows[0].name).toBeNull();
      expect((await recovery.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBe(31);
      expect((await recovery.query(`SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='player_social_profiles' AND column_name='social_action_epoch'`)).rows[0].n).toBe(0);
      expect((await recovery.query("SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[])",[[oldActor.userId,oldPeer.userId]])).rows[0].n).toBe(2);
    } finally { await recovery.query("ROLLBACK"); recovery.release(); }
    expect((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBe(32);
    console.info("S1 disposable migrations applied through unchanged0032; no inferred relations");
    // Preserve the 0031/0032 recovery evidence above, then use the current schema
    // for the integrated game projections (including the cover-wave columns).
    const current = await pool.connect();
    try {
      for (const file of files.filter(f => f > "0032_friendship_core.sql")) {
        await current.query("BEGIN");
        try {
          await current.query(await readFile(path.join(migrations,file),"utf8"));
          await current.query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]);
          await current.query("COMMIT");
        } catch (error) { await current.query("ROLLBACK"); throw error; }
      }
    } finally { current.release(); }
  });
  afterAll(async () => {
    pairs.clear();
    await app?.close();await pool?.end();
    // Append-only attempts are preserved. Runner disposes the dedicated DB/container.
    console.info(`S1 connections closed; external runner must dispose ${DB_NAME}`);
  });
  beforeEach(async () => {
    Object.assign(env,{FRIENDS_INTERNAL_ENABLED:true,FRIENDS_REQUEST_TTL_SECONDS:120,
      FRIENDS_RATE_WINDOW_SECONDS:600,FRIENDS_SEND_LIMIT:100,FRIENDS_RECEIVE_LIMIT:100});
    // New synthetic identities per case, no DELETE/TRUNCATE of accepted ledger.
    a = await actor("Synthetic A");b = await actor("Synthetic B");outsider = await actor("Synthetic outsider");
  });
  async function actor(name: string): Promise<Actor> {
    const userId=randomUUID(),publicPlayerId=randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)",[userId,name]);
    await pool.query(`INSERT INTO player_social_profiles(user_id,public_player_id,display_name,city_id,
      directory_visible,contact_policy,consent_policy_version,opted_in_at)
      VALUES($1,$2,$3,$4,true,'requests','synthetic-s1-fixture',clock_timestamp())`,[userId,publicPlayerId,name,MOSCOW_CITY_ID]);
    const issued=await sessions.createConsumerSession(userId);
    return {userId,publicPlayerId,sessionId:issued.session.id,csrfToken:issued.csrfToken,
      cookie:`${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`};
  }
  const key = () => `s1-synthetic-${randomUUID()}`;
  function post(who:Actor,url:string,payload:unknown,idem=key()):Promise<Response> {
    return app.inject({method:"POST",url,payload:payload as object,
      headers:{cookie:who.cookie,origin,"x-csrf-token":who.csrfToken,"idempotency-key":idem}}) as Promise<Response>;
  }
  function get(who:Actor,url:string):Promise<Response> {return app.inject({method:"GET",url,headers:{cookie:who.cookie}}) as Promise<Response>;}
  async function request(from=a,to=b,idem=key()):Promise<FriendshipReceipt> {
    const response=await post(from,"/v1/friend-requests",{targetPublicPlayerId:to.publicPlayerId},idem);
    expect(response.statusCode).toBe(201);expect(response.headers["cache-control"]).toBe("no-store");
    return response.json();
  }
  function decide(who:Actor,r:FriendshipReceipt,action:"accept"|"decline"|"cancel"|"remove",idem=key()) {
    return post(who,action==="remove" ? `/v1/friendships/${r.friendshipId}/remove` : `/v1/friend-requests/${r.requestId}/${action}`,
      {expectedVersion:r.version},idem);
  }
  async function stored(r:FriendshipReceipt) {
    return (await pool.query("SELECT * FROM friendships WHERE id=$1",[r.friendshipId])).rows[0];
  }
  async function ledgerCount(r:FriendshipReceipt) {
    return (await pool.query("SELECT count(*)::int AS n FROM friendship_request_attempts WHERE friendship_id=$1",[r.friendshipId])).rows[0].n;
  }
  // Existing HTTP game flow; creator retains the real initial seat. Capacity 2
  // therefore leaves exactly one place for invitation/ordinary participation.
  async function friendGame() {
    const venue = await post(a,"/v1/venues",{cityId:MOSCOW_CITY_ID,name:"Wave C synthetic court",
      address:"Moscow",timezone:"Europe/Moscow",latitude:55.75,longitude:37.62});
    expect([200,201]).toContain(venue.statusCode);
    const starts = Date.now()+7*86400000;
    const draft = await post(a,"/v1/games",{hostDisplayName:"Synthetic host",hostPublicContact:"telegram:@synthetic",
      venueId:venue.json().id,title:"Wave C disposable game",startsAt:new Date(starts).toISOString(),
      endsAt:new Date(starts+7200000).toISOString(),timezone:"Europe/Moscow",
      applicationDeadlineAt:new Date(starts-86400000).toISOString(),capacity:2,externalReservedCount:0,
      visibility:"public",formatKey:"doubles",activityKind:"regular",
      levelRule:{scaleId:"ntrp",scaleVersion:1,allowedLevelIds:["3.0","3.5"]},
      settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,
        terms:"Synthetic external court terms"}});
    expect(draft.statusCode).toBe(201);
    const published = await post(a,`/v1/games/${draft.json().id}/publish`,{expectedVersion:draft.json().version});
    expect(published.statusCode).toBe(200);
    return published.json() as {id:string;version:number};
  }
  async function inviteFriend(game:{id:string;version:number},peer:Actor) {
    const friendship = await request(a,peer);
    expect((await decide(peer,friendship,"accept")).statusCode).toBe(200);
    const response = await post(a,`/v1/games/${game.id}/invitations`,{
      inviteePublicPlayerId:peer.publicPlayerId,expectedGameVersion:game.version});
    expect(response.statusCode).toBe(201);
    return response.json() as {id:string;version:number};
  }
  async function mine(who:Actor,gameId:string) {
    const response = await get(who,"/v1/me/participations?limit=50");
    expect(response.statusCode).toBe(200);
    return response.json().items.filter((p:{gameId:string})=>p.gameId===gameId) as Array<{id:string;status:string}>;
  }
  async function inboxInvitation(who:Actor,id:string) {
    const response = await get(who,"/v1/me/inbox?limit=50");
    expect(response.statusCode).toBe(200);
    return response.json().items.find((item:{invitationId:string|null})=>item.invitationId===id);
  }
  it("Wave C: friends do not grant invitation ownership or reserve seats; accept projects to My Games/Messages",async()=>{
    const game=await friendGame(),invitation=await inviteFriend(game,b);
    expect(await mine(b,game.id)).toEqual([]);
    expect(await inboxInvitation(b,invitation.id)).toMatchObject({kind:"game_invitation",invitationStatus:"pending"});
    expect(await inboxInvitation(outsider,invitation.id)).toBeUndefined();
    expect((await get(outsider,`/v1/invitations/${invitation.id}`)).statusCode).toBe(404);
    const denied=await post(outsider,`/v1/invitations/${invitation.id}/accept`,{
      expectedVersion:invitation.version,expectedGameVersion:game.version});
    expect(denied.statusCode).toBe(404);
    expect((await get(b,`/v1/games/${game.id}`)).json()).toMatchObject({confirmedCount:1,availablePlaces:1});
    const idem=key(),payload={expectedVersion:invitation.version,expectedGameVersion:game.version};
    const accepted=await post(b,`/v1/invitations/${invitation.id}/accept`,payload,idem);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().participation.status).toBe("confirmed");
    expect(await mine(b,game.id)).toEqual([expect.objectContaining({id:accepted.json().participation.id,status:"confirmed"})]);
    expect(await inboxInvitation(b,invitation.id)).toMatchObject({invitationStatus:"accepted"});
    const replay=await post(b,`/v1/invitations/${invitation.id}/accept`,payload,idem);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(accepted.json());
    expect((await get(b,`/v1/games/${game.id}`)).json()).toMatchObject({confirmedCount:2,availablePlaces:0});
    const row=(await pool.query("SELECT count(*)::int AS n FROM participations WHERE game_id=$1 AND user_id=$2 AND status='confirmed'",[game.id,b.userId])).rows[0];
    expect(row.n).toBe(1);
  });
  it.each(["decline","revoke"] as const)("Wave C: friend invitation %s gives no My Games seat and stale accept cannot revive it",async action=>{
    const game=await friendGame(),invitation=await inviteFriend(game,b);
    const terminal=await post(action==="decline"?b:a,`/v1/invitations/${invitation.id}/${action}`,{expectedVersion:invitation.version});
    expect(terminal.statusCode).toBe(200);
    const status=action==="decline"?"declined":"revoked";
    expect((await get(b,`/v1/invitations/${invitation.id}`)).json().status).toBe(status);
    expect(await inboxInvitation(b,invitation.id)).toMatchObject({invitationStatus:status});
    expect((await post(b,`/v1/invitations/${invitation.id}/accept`,{
      expectedVersion:invitation.version,expectedGameVersion:game.version})).statusCode).toBe(409);
    expect(await mine(b,game.id)).toEqual([]);
    expect((await get(b,`/v1/games/${game.id}`)).json()).toMatchObject({confirmedCount:1,availablePlaces:1});
  });
  it("Wave C: two accepted friends compete for one real seat, not two invitation reservations",async()=>{
    const game=await friendGame(),first=await inviteFriend(game,b),second=await inviteFriend(game,outsider);
    const results=await Promise.all(([[b,first],[outsider,second]] as const).map(([who,invitation])=>{
      return post(who,`/v1/invitations/${invitation.id}/accept`,{
        expectedVersion:invitation.version,expectedGameVersion:game.version});
    }));
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
    expect(results.find(r=>r.statusCode===409)!.json().code).toBe("GAME_FULL");
    const loser=results[0]!.statusCode===409?b:outsider,inv=loser===b?first:second;
    expect(await mine(loser,game.id)).toEqual([]);
    expect((await get(loser,`/v1/invitations/${inv.id}`)).json().status).toBe("pending");
    expect((await get(b,`/v1/games/${game.id}`)).json()).toMatchObject({confirmedCount:2,availablePlaces:0});
  });
  it("Wave C: ordinary confirmation consumes the same capacity as a friend's pending invitation",async()=>{
    const game=await friendGame(),invitation=await inviteFriend(game,b);
    const requested=await post(outsider,`/v1/games/${game.id}/participations`,{expectedGameVersion:game.version});
    expect(requested.statusCode).toBe(201);
    expect(requested.json().status).toBe("pending");
    expect((await get(b,`/v1/games/${game.id}`)).json().availablePlaces).toBe(1);
    const confirmed=await post(a,`/v1/participations/${requested.json().id}/confirm`,{expectedVersion:requested.json().version});
    expect(confirmed.statusCode).toBe(200);
    const fresh=await get(b,`/v1/games/${game.id}`);
    expect(fresh.json()).toMatchObject({confirmedCount:2,availablePlaces:0});
    const accept=await post(b,`/v1/invitations/${invitation.id}/accept`,{
      expectedVersion:invitation.version,expectedGameVersion:fresh.json().version});
    expect(accept.statusCode).toBe(409);expect(accept.json().code).toBe("GAME_FULL");
    expect(await mine(b,game.id)).toEqual([]);
    expect(await mine(outsider,game.id)).toEqual([expect.objectContaining({status:"confirmed"})]);
  });
  it("Wave C: friendship does not revive an expired invitation, even without the expiry worker",async()=>{
    const game=await friendGame(),invitation=await inviteFriend(game,b);
    await pool.query("UPDATE game_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[invitation.id]);
    const expired=await get(b,`/v1/invitations/${invitation.id}`);
    expect(expired.statusCode).toBe(200);expect(expired.json().status).toBe("expired");
    expect((await post(b,`/v1/invitations/${invitation.id}/accept`,{
      expectedVersion:invitation.version,expectedGameVersion:game.version})).statusCode).toBe(409);
    expect(await mine(b,game.id)).toEqual([]);
    const friends=await get(b,"/v1/me/friendships?view=accepted");
    expect(friends.statusCode).toBe(200);
    expect(friends.json().items).toEqual([expect.objectContaining({relationship:"friends"})]);
    expect((await get(b,`/v1/games/${game.id}`)).json().availablePlaces).toBe(1);
  });
  async function putBlock(who:Actor,target:Actor,remove=false):Promise<Response> {
    return app.inject({method:remove ? "DELETE" : "PUT",url:`/v1/me/blocks/${target.publicPlayerId}`,
      headers:{cookie:who.cookie,origin,"x-csrf-token":who.csrfToken,"idempotency-key":key()}}) as Promise<Response>;
  }
  async function waitBlocked(blocker:number) {
    const deadline=Date.now()+2000;
    while (Date.now()<deadline) {
      const rows=await pool.query(`SELECT pid,wait_event_type,wait_event,state
        FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`,[blocker]);
      if (rows.rows.length) {console.info("S1 observed real PostgreSQL waiter",JSON.stringify(rows.rows));return;}
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    throw new Error("Expected a real two-connection SQL lock waiter before releasing barrier");
  }
  async function overlap(first:()=>Promise<Response>,second:()=>Promise<Response>) {
    const gate=pairs.arm();const winner=first();let waiter:Promise<Response>|undefined;
    try {
      const pid=await Promise.race([gate.held.promise,winner.then(()=>{throw new Error("First writer did not reach Pair barrier");})]);
      waiter=second();await waitBlocked(pid);gate.release.resolve();
      const results=await Promise.all([winner,waiter]);
      console.info("S1 overlap HTTP results",results.map(r=>({status:r.statusCode,code:r.json().code ?? null})));
      return results;
    } finally {gate.release.resolve();pairs.clear();await Promise.allSettled([winner,...(waiter?[waiter]:[])]);}
  }

  it("keeps schema0031 compatibility and source capability gates truthful",async()=>{
    expect(schema0031Evidence.capabilities).toEqual({friends:false,gameRecommendations:false,gameAttention:false,socialPush:false});
    expect(schema0031Evidence.list).toMatchObject({items:[],nextCursor:null});expect(schema0031Evidence.sendStatus).toBe(503);
    // Eligible DEV actor + installed friendships/game_recommendations → true; schema0031/off stay false above/below.
    expect((await get(a,"/v1/me/social-capabilities")).json()).toEqual({friends:true,gameRecommendations:true,gameAttention:false,socialPush:false});
    env.FRIENDS_SEND_LIMIT=undefined;
    expect((await get(a,"/v1/me/social-capabilities")).json()).toEqual({friends:false,gameRecommendations:false,gameAttention:false,socialPush:false});
    expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId})).statusCode).toBe(503);
  });
  it("creates pending + exact immutable attempt atomically, dedupes and requires crossed decision",async()=>{
    const r=await request();const row=await stored(r);
    const attempt=(await pool.query("SELECT * FROM friendship_request_attempts WHERE request_id=$1",[r.requestId])).rows[0];
    expect(row.state).toBe("pending");expect(attempt).toMatchObject({friendship_id:r.friendshipId,generation:row.generation,
      requester_user_id:a.userId,recipient_user_id:b.userId,requested_at:row.requested_at,expires_at:row.expires_at});
    const duplicate=await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
    expect(duplicate.statusCode).toBe(200);expect(duplicate.json()).toEqual(r);expect(await ledgerCount(r)).toBe(1);
    const crossed=await post(b,"/v1/friend-requests",{targetPublicPlayerId:a.publicPlayerId});
    expect(crossed.statusCode).toBe(409);expect(crossed.json().code).toBe("FRIEND_REQUEST_DECISION_REQUIRED");
    expect((await stored(r)).state).toBe("pending");
    const counts=await pool.query("SELECT bucket,count FROM social_action_rate_buckets WHERE user_id=ANY($1::uuid[])",[[a.userId,b.userId]]);
    expect(counts.rows.map(x=>x.count)).toEqual([1,1]);
  });
  it("accepts only actual recipient, exposes minimal view, removes by either endpoint",async()=>{
    const r=await request();expect((await decide(a,r,"accept")).statusCode).toBe(404);
    expect((await decide(outsider,r,"accept")).statusCode).toBe(404);
    const accepted=await decide(b,r,"accept");expect(accepted.statusCode).toBe(200);
    const receipt=accepted.json<FriendshipReceipt>();expect(receipt.version).toBe("2");
    const response=await get(a,`/v1/friendships/${r.friendshipId}`);const view=response.json<FriendshipView>();
    expect(view.relationship).toBe("friends");expect(view.peer?.publicPlayerId).toBe(b.publicPlayerId);
    expect(Object.keys(view).sort()).toEqual(["capabilities","friendshipId","peer","relationship","request","version"]);
    expect(Object.keys(view.peer!).sort()).toEqual(["avatar","displayName","publicPlayerId"]);
    const wire=JSON.stringify(view);for (const secret of [a.userId,b.userId,(await stored(r)).pair_id,"social_action_epoch","latitude","longitude","contactPolicy","generation"]) expect(wire).not.toContain(secret);
    expect((await get(outsider,`/v1/friendships/${r.friendshipId}`)).statusCode).toBe(404);
    expect((await decide(a,receipt,"remove")).statusCode).toBe(200);expect((await stored(r)).state).toBe("removed");
    const afterRemove=(await get(a,`/v1/me/friendship-states?publicPlayerId=${b.publicPlayerId}`)).json().items[0];
    expect(afterRemove.relationship).toBe("none");expect(afterRemove.capabilities.canRequest).toBe(true);
    expect(afterRemove.peer?.publicPlayerId).toBe(b.publicPlayerId);
    const fresh=await request();const acceptAgain=(await decide(b,fresh,"accept")).json<FriendshipReceipt>();
    expect((await decide(b,acceptAgain,"remove")).statusCode).toBe(200);
  });
  it.each(["decline","cancel"] as const)("%s enforces role and retired request/version cannot affect fresh generation",async action=>{
    const old=await request();const rightful=action==="decline"?b:a;const wrong=action==="decline"?a:b;
    expect((await decide(wrong,old,action)).statusCode).toBe(404);
    expect((await decide(rightful,old,action)).statusCode).toBe(200);
    const afterRetire=(await get(a,`/v1/me/friendship-states?publicPlayerId=${b.publicPlayerId}`)).json().items[0];
    expect(afterRetire.relationship).toBe("none");expect(afterRetire.capabilities.canRequest).toBe(true);
    expect(afterRetire.peer?.publicPlayerId).toBe(b.publicPlayerId);
    const fresh=await request();expect(fresh.requestId).not.toBe(old.requestId);expect(fresh.friendshipId).toBe(old.friendshipId);
    expect((await stored(fresh)).generation).toBe("2");expect(await ledgerCount(fresh)).toBe(2);
    expect((await decide(b,old,"accept")).json().code).toBe("FRIENDSHIP_STALE");
    const staleVersion=await post(b,`/v1/friend-requests/${fresh.requestId}/accept`,{expectedVersion:old.version});
    expect(staleVersion.statusCode).toBe(409);expect((await stored(fresh)).state).toBe("pending");
  });
  it("safe replay is exactly once, payload mismatch conflicts and stale privilege receipts are denied",async()=>{
    const idem=key(),r=await request(a,b,idem);
    const replay=await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId},idem);
    expect(replay.statusCode).toBe(201);expect(replay.json()).toEqual(r);expect(await ledgerCount(r)).toBe(1);
    expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:outsider.publicPlayerId},idem)).statusCode).toBe(409);
    const acceptKey=key(),accepted=await decide(b,r,"accept",acceptKey);expect(accepted.statusCode).toBe(200);
    expect((await decide(b,r,"accept",acceptKey)).json()).toEqual(accepted.json());
    const removeKey=key(),removed=await decide(a,accepted.json(),"remove",removeKey);expect(removed.statusCode).toBe(200);
    expect((await decide(b,r,"accept",acceptKey)).statusCode).toBe(404);
    expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId},idem)).statusCode).toBe(404);
    env.FRIENDS_INTERNAL_ENABLED=false;
    expect((await decide(a,accepted.json(),"remove",removeKey)).json()).toEqual(removed.json());
    await sessions.revokeSession(a.sessionId);
    expect((await decide(a,accepted.json(),"remove",removeKey)).statusCode).toBe(401);
  });
  it.each(["sender","recipient"])("bilateral block by %s hides target and permanently ends pending generation",async direction=>{
    const blocker=direction==="sender"?a:b,blocked=direction==="sender"?b:a;
    expect((await putBlock(blocker,blocked)).statusCode).toBe(200);
    const rejected=await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
    expect(rejected.statusCode).toBe(404);expect(rejected.json().code).toBe("RESOURCE_UNAVAILABLE");
    expect((await putBlock(blocker,blocked,true)).statusCode).toBe(200);
    const r=await request();expect((await putBlock(blocker,blocked)).statusCode).toBe(200);
    expect((await stored(r)).state).toBe("blocked");expect((await decide(b,r,"accept")).statusCode).toBe(409);
    expect((await putBlock(blocker,blocked,true)).statusCode).toBe(200);
    const fresh=await request();expect(fresh.requestId).not.toBe(r.requestId);
    expect((await decide(b,r,"accept")).statusCode).toBe(409);expect((await stored(fresh)).state).toBe("pending");
  });
  it("block terminates accepted generation; unblock cannot restore friendship",async()=>{
    const r=await request();expect((await decide(b,r,"accept")).statusCode).toBe(200);
    expect((await putBlock(b,a)).statusCode).toBe(200);expect((await stored(r)).state).toBe("blocked");
    expect((await putBlock(b,a,true)).statusCode).toBe(200);
    const view=(await get(a,`/v1/friendships/${r.friendshipId}`)).json();
    // Blocked generation stays non-friends; after unblock eligible peers may re-request (none, not unavailable).
    expect(view.relationship).toBe("none");expect(view.peer?.publicPlayerId).toBe(b.publicPlayerId);
    expect(view.capabilities.canRequest).toBe(true);
    expect((await get(a,"/v1/me/friendships?view=accepted")).json().items).toEqual([]);
  });
  it.each(["directory","eligibility","disabled","deletion_pending"])("%s closure invalidates pending epoch permanently",async kind=>{
    const requestKey=key(),r=await request(a,b,requestKey);const oldEpoch=(await pool.query("SELECT social_action_epoch FROM player_social_profiles WHERE user_id=$1",[b.userId])).rows[0].social_action_epoch;
    if (kind==="directory") await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[b.userId]);

    else if (kind==="eligibility") await pool.query("UPDATE player_social_profiles SET social_eligible=false WHERE user_id=$1",[b.userId]);
    else await pool.query("UPDATE users SET status=$2 WHERE id=$1",[b.userId,kind]);
    const epoch=(await pool.query("SELECT social_action_epoch FROM player_social_profiles WHERE user_id=$1",[b.userId])).rows[0].social_action_epoch;
    expect(BigInt(epoch)).toBeGreaterThan(BigInt(oldEpoch));
    expect((await decide(b,r,"accept")).statusCode).toBe(kind==="disabled" || kind==="deletion_pending" ? 401 : 404);
    const unavailable=await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});expect(unavailable.statusCode).toBe(404);
    await pool.query("UPDATE users SET status='active' WHERE id=$1",[b.userId]);
    await pool.query("UPDATE player_social_profiles SET directory_visible=true,contact_policy='requests',social_eligible=true WHERE user_id=$1",[b.userId]);
    expect((await decide(b,r,"accept")).statusCode).toBe(404);
    expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId},requestKey)).statusCode).toBe(404);
    const fresh=await request();expect(fresh.requestId).not.toBe(r.requestId);expect(await ledgerCount(fresh)).toBe(2);
  });
  it("direct-message opt-out does not block a new friend request, but old epoch stays invalid",async()=>{
    const old=await request();
    await pool.query("UPDATE player_social_profiles SET contact_policy='closed' WHERE user_id=$1",[b.userId]);
    expect((await decide(b,old,"accept")).statusCode).toBe(404);
    const fresh=await request();
    expect(fresh.requestId).not.toBe(old.requestId);
    expect((await decide(b,fresh,"accept")).statusCode).toBe(200);
    const searched=(await get(a,"/v1/me/friendships?view=accepted&q=Synthetic%20B")).json();
    expect(searched.items.map((item:FriendshipView)=>item.friendshipId)).toContain(fresh.friendshipId);
    const policy=(await pool.query("SELECT contact_policy FROM player_social_profiles WHERE user_id=$1",[b.userId])).rows[0].contact_policy;
    expect(policy).toBe("closed");
  });
  it("TTL expiration is authoritative with no worker, old replay and decisions cannot revive it",async()=>{
    env.FRIENDS_REQUEST_TTL_SECONDS=1;
    const idem=key(),r=await request(a,b,idem);const row=await stored(r);
    // Wait for the recorded DB deadline, not a sleep-based concurrency race.
    await pool.query("SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM $1::timestamptz-clock_timestamp())))",[row.expires_at]);
    expect((await decide(b,r,"accept")).statusCode).toBe(404);
    expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId},idem)).statusCode).toBe(404);
    expect((await get(a,"/v1/me/friendships?view=outgoing")).json().items).toEqual([]);
    expect((await get(a,`/v1/me/friendship-states?publicPlayerId=${b.publicPlayerId}`)).json().items[0].capabilities.canRequest).toBe(true);
    env.FRIENDS_REQUEST_TTL_SECONDS=120;
    const fresh=await request();expect(fresh.requestId).not.toBe(r.requestId);
    expect((await decide(b,r,"accept")).statusCode).toBe(409);expect(await ledgerCount(fresh)).toBe(2);
  });
  it("migration recovery refuses to erase a populated immutable attempt ledger",async()=>{
    const r=await request();const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(client.query(await readFile(path.resolve(__dirname,"../../migrations/rollback/0032_friendship_core.sql"),"utf8")))
        .rejects.toMatchObject({code:"23514"});
    } finally {await client.query("ROLLBACK");client.release();}
    expect(await ledgerCount(r)).toBe(1);expect((await stored(r)).state).toBe("pending");
  });
  it("concurrent accepts commit once and reject the stale second version",async()=>{
    const r=await request();
    const responses=await overlap(()=>decide(b,r,"accept"),()=>decide(b,r,"accept"));
    expect(responses.map(response=>response.statusCode)).toEqual([200,409]);
    expect(responses[1]!.json().code).toBe("FRIENDSHIP_STALE");
    expect(await stored(r)).toMatchObject({state:"accepted",version:"2"});
    expect(await ledgerCount(r)).toBe(1);
  });
  it("accepted dormant friends redact peer and name search; restoring visibility does not restore removed relation",async()=>{
    const r=await request();const accepted=(await decide(b,r,"accept")).json<FriendshipReceipt>();
    await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[b.userId]);
    const list=await get(a,"/v1/me/friendships?view=accepted");expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);expect(list.json().items[0]).toMatchObject({relationship:"friends",peer:null,request:null});
    expect((await get(a,"/v1/me/friendships?view=accepted&q=Synthetic")).json().items).toEqual([]);
    const states=await get(a,`/v1/me/friendship-states?publicPlayerId=${b.publicPlayerId}&publicPlayerId=${randomUUID()}`);
    expect(states.json().items[0].peer).toBeNull();expect(states.json().items[1].friendshipId).toBeNull();
    await pool.query("UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1",[b.userId]);
    expect((await get(a,`/v1/friendships/${r.friendshipId}`)).json().peer.publicPlayerId).toBe(b.publicPlayerId);
    env.FRIENDS_INTERNAL_ENABLED=false;
    expect((await decide(a,accepted,"remove")).statusCode).toBe(200);
    expect((await get(a,`/v1/friendships/${r.friendshipId}`)).json().peer).toBeNull();
  });
  it("bound cursor cannot be reused by another actor/view/search and list limits remain technical ceilings",async()=>{
    await request();await request(a,outsider);
    const page=await get(a,"/v1/me/friendships?view=outgoing&limit=1");expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(1);const cursor=page.json().nextCursor;expect(cursor).toBeTypeOf("string");
    const suffix=`&cursor=${encodeURIComponent(cursor)}`;
    const next=await get(a,`/v1/me/friendships?view=outgoing&limit=1${suffix}`);expect(next.statusCode).toBe(200);
    expect(next.json().items[0].friendshipId).not.toBe(page.json().items[0].friendshipId);
    for (const [who,url] of [[b,`/v1/me/friendships?view=outgoing${suffix}`],[a,`/v1/me/friendships?view=incoming${suffix}`],
      [a,`/v1/me/friendships?view=outgoing&q=Synthetic${suffix}`]] as const) expect((await get(who,url)).statusCode).toBe(409);
    expect((await get(a,"/v1/me/friendships?view=outgoing&limit=51")).statusCode).toBe(422);
    const noSearch=await get(a,"/v1/me/friendships?view=outgoing&q=%25_");expect(noSearch.json().items).toEqual([]);
  });
  it("cookie/Origin/CSRF/key guards deny attacks before effects; no bearer actor override",async()=>{
    for (const headers of [{origin:"https://evil.test","x-csrf-token":a.csrfToken},{origin,"x-csrf-token":"wrong"},
      {origin,"x-csrf-token":a.csrfToken,authorization:"Bearer synthetic"},{origin}]) {
      const response=await app.inject({method:"POST",url:"/v1/friend-requests",payload:{targetPublicPlayerId:b.publicPlayerId},
        headers:{cookie:a.cookie,"idempotency-key":key(),...headers}});expect(response.statusCode).toBe(403);
    }
    const missing=await app.inject({method:"POST",url:"/v1/friend-requests",payload:{targetPublicPlayerId:b.publicPlayerId},
      headers:{cookie:a.cookie,origin,"x-csrf-token":a.csrfToken}});expect(missing.statusCode).toBe(400);
    expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId,actorId:outsider.userId})).statusCode).toBe(422);
    expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:a.publicPlayerId})).statusCode).toBe(404);
    expect((await pool.query("SELECT count(*)::int AS n FROM friendships WHERE requester_user_id=$1",[a.userId])).rows[0].n).toBe(0);
  });
  it("ledger failure rolls back pair/friendship/rates/idempotency; explicit SQLSTATE is captured",async()=>{
    const client=await pool.connect();
    try {
      await client.query(`CREATE FUNCTION s1_fixture_fail_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic ledger fault' USING ERRCODE='23514'; END $$`);
      await client.query("CREATE TRIGGER s1_fixture_fail_attempt BEFORE INSERT ON friendship_request_attempts FOR EACH ROW EXECUTE FUNCTION s1_fixture_fail_attempt()");
      const idem=key();
      const failed=await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId},idem);expect(failed.statusCode).toBe(500);
      const service=app.get(FriendshipsService);
      await expect(service.create(a.userId,a.sessionId,key(),{targetPublicPlayerId:b.publicPlayerId})).rejects.toMatchObject({code:"23514"});
      console.info("S1 injected ledger SQLSTATE 23514, entire command rolled back");
      for (const table of ["friendships","friendship_request_attempts"]) {
        expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE requester_user_id=$1`,[a.userId])).rows[0].n).toBe(0);
      }
      expect((await pool.query("SELECT count(*)::int AS n FROM social_pairs WHERE user_low=LEAST($1::uuid,$2::uuid) AND user_high=GREATEST($1::uuid,$2::uuid)",[a.userId,b.userId])).rows[0].n).toBe(0);
      expect((await pool.query("SELECT count(*)::int AS n FROM idempotency_records WHERE actor_id=$1",[a.userId])).rows[0].n).toBe(0);
      expect((await pool.query("SELECT count(*)::int AS n FROM social_action_rate_buckets WHERE user_id=ANY($1::uuid[])",[[a.userId,b.userId]])).rows[0].n).toBe(0);
      await client.query("DROP TRIGGER s1_fixture_fail_attempt ON friendship_request_attempts");
      await client.query("DROP FUNCTION s1_fixture_fail_attempt()");
      expect((await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId},idem)).statusCode).toBe(201);
    } finally {
      await client.query("DROP TRIGGER IF EXISTS s1_fixture_fail_attempt ON friendship_request_attempts");
      await client.query("DROP FUNCTION IF EXISTS s1_fixture_fail_attempt()");client.release();
    }
  });
  it.each(["A","B"])("opposed sends truly overlap with %s first: one ledger, no auto accept",async winner=>{
    const from=winner==="A"?a:b,to=winner==="A"?b:a;
    const [first,second]=await overlap(
      ()=>post(from,"/v1/friend-requests",{targetPublicPlayerId:to.publicPlayerId}),
      ()=>post(to,"/v1/friend-requests",{targetPublicPlayerId:from.publicPlayerId}));
    expect(first.statusCode).toBe(201);expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("FRIEND_REQUEST_DECISION_REQUIRED");
    const r=first.json<FriendshipReceipt>();expect(await ledgerCount(r)).toBe(1);expect((await stored(r)).state).toBe("pending");
  });
  it.each(["accept","cancel"] as const)("%s wins real accept/cancel overlap and the loser is stale",async winner=>{
    const r=await request();const [first,second]=await overlap(
      ()=>decide(winner==="accept"?b:a,r,winner),()=>decide(winner==="accept"?a:b,r,winner==="accept"?"cancel":"accept"));
    expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("FRIENDSHIP_STALE");expect((await stored(r)).state).toBe(winner==="accept"?"accepted":"cancelled");
    expect((await stored(r)).version).toBe("2");
  });
  it.each(["block","accept"] as const)("%s first in actual Pair overlap; block is terminal in both orders",async winner=>{
    const r=await request();const [first,second]=await overlap(
      ()=>winner==="block"?putBlock(a,b):decide(b,r,"accept"),()=>winner==="block"?decide(b,r,"accept"):putBlock(a,b));
    expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(winner==="block"?409:200);
    expect((await stored(r)).state).toBe("blocked");expect((await get(a,`/v1/friendships/${r.friendshipId}`)).json().peer).toBeNull();
  });
  it("send holds profile SHARE: concurrent hide waits, then old request remains epoch-invalid after show",async()=>{
    const gate=pairs.arm();const sending=post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
    const lifecycle=await pool.connect();let hiding:Promise<unknown>|undefined;
    try {
      const pid=await Promise.race([gate.held.promise,sending.then(()=>{throw new Error("Missing send Pair barrier");})]);
      await lifecycle.query("BEGIN");await lifecycle.query("SET LOCAL lock_timeout='3s'");await lifecycle.query("SET LOCAL statement_timeout='10s'");
      await lifecycle.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE",[b.userId]);
      hiding=lifecycle.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[b.userId]);
      await waitBlocked(pid);gate.release.resolve();const response=await sending;expect(response.statusCode).toBe(201);
      await hiding;await lifecycle.query("COMMIT");
      await pool.query("UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1",[b.userId]);
      expect((await decide(b,response.json(),"accept")).statusCode).toBe(404);
    } finally {gate.release.resolve();pairs.clear();await Promise.allSettled([sending,...(hiding?[hiding]:[])]);await lifecycle.query("ROLLBACK");lifecycle.release();}
  });
  it("contact opt-out holds profile UPDATE: concurrent friend request waits then succeeds",async()=>{
    const lifecycle=await pool.connect();let sending:Promise<Response>|undefined;
    try {
      await lifecycle.query("BEGIN");await lifecycle.query("SET LOCAL lock_timeout='3s'");await lifecycle.query("SET LOCAL statement_timeout='10s'");
      const pid=(await lifecycle.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await lifecycle.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE",[b.userId]);
      await lifecycle.query("UPDATE player_social_profiles SET contact_policy='closed' WHERE user_id=$1",[b.userId]);
      sending=post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
      await waitBlocked(pid);await lifecycle.query("COMMIT");expect((await sending).statusCode).toBe(201);
      expect((await pool.query("SELECT count(*)::int AS n FROM friendship_request_attempts WHERE requester_user_id=$1",[a.userId])).rows[0].n).toBe(1);
    } finally {await lifecycle.query("ROLLBACK");await Promise.allSettled(sending?[sending]:[]);lifecycle.release();}
  });
  it.each(["disabled","deletion_pending"])("account %s waits behind send's profile fence and permanently invalidates its epoch",async status=>{
    const gate=pairs.arm();const sending=post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
    const lifecycle=await pool.connect();let closing:Promise<unknown>|undefined;
    try {
      const pid=await Promise.race([gate.held.promise,sending.then(()=>{throw new Error("Missing send Pair barrier");})]);
      await lifecycle.query("BEGIN");await lifecycle.query("SET LOCAL lock_timeout='3s'");await lifecycle.query("SET LOCAL statement_timeout='10s'");
      closing=lifecycle.query("UPDATE users SET status=$2 WHERE id=$1",[b.userId,status]);
      await waitBlocked(pid);gate.release.resolve();const response=await sending;expect(response.statusCode).toBe(201);
      await closing;await lifecycle.query("COMMIT");
      const row=await stored(response.json());
      const epoch=(await pool.query("SELECT social_action_epoch FROM player_social_profiles WHERE user_id=$1",[b.userId])).rows[0].social_action_epoch;
      expect(BigInt(epoch)).toBeGreaterThan(BigInt(row.recipient_epoch));
      await pool.query("UPDATE users SET status='active' WHERE id=$1",[b.userId]);
      expect((await decide(b,response.json(),"accept")).statusCode).toBe(404);
    } finally {gate.release.resolve();pairs.clear();await Promise.allSettled([sending,...(closing?[closing]:[])]);await lifecycle.query("ROLLBACK");lifecycle.release();}
  });
  it.each(["disabled","deletion_pending"])("account %s commits first: waiting send cannot create a request/ledger",async status=>{
    const lifecycle=await pool.connect();let sending:Promise<Response>|undefined;
    try {
      await lifecycle.query("BEGIN");await lifecycle.query("SET LOCAL lock_timeout='3s'");await lifecycle.query("SET LOCAL statement_timeout='10s'");
      const pid=(await lifecycle.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await lifecycle.query("UPDATE users SET status=$2 WHERE id=$1",[b.userId,status]);
      sending=post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
      await waitBlocked(pid);await lifecycle.query("COMMIT");expect((await sending).statusCode).toBe(404);
      expect((await pool.query("SELECT count(*)::int AS n FROM friendship_request_attempts WHERE requester_user_id=$1",[a.userId])).rows[0].n).toBe(0);
    } finally {await lifecycle.query("ROLLBACK");await Promise.allSettled(sending?[sending]:[]);lifecycle.release();}
  });
  it("configured sender and recipient caps are atomic across different pairs and recipient failure is generic",async()=>{
    env.FRIENDS_SEND_LIMIT=1;
    const outcomes=await Promise.all([post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId}),
      post(a,"/v1/friend-requests",{targetPublicPlayerId:outsider.publicPlayerId})]);
    expect(outcomes.map(r=>r.statusCode).sort()).toEqual([201,429]);
    expect(outcomes.find(r=>r.statusCode===429)!.headers["retry-after"]).toBeDefined();
    env.FRIENDS_SEND_LIMIT=100;env.FRIENDS_RECEIVE_LIMIT=1;
    const target=await actor("Synthetic cap recipient");
    const receiving=await Promise.all([post(b,"/v1/friend-requests",{targetPublicPlayerId:target.publicPlayerId}),
      post(outsider,"/v1/friend-requests",{targetPublicPlayerId:target.publicPlayerId})]);
    expect(receiving.map(r=>r.statusCode).sort()).toEqual([201,404]);
    expect(receiving.find(r=>r.statusCode===404)!.json().code).toBe("RESOURCE_UNAVAILABLE");
    expect((await pool.query("SELECT count FROM social_action_rate_buckets WHERE user_id=$1 AND bucket='friend.receive'",[target.userId])).rows[0].count).toBe(1);
  });
});
