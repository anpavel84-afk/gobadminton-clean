import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { MutationRunner } from "../../src/common/mutation-runner.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GameRecommendationsModule } from "../../src/game-recommendations/game-recommendations.module";
import type { Receipt } from "../../src/game-recommendations/game-recommendations.policy";
import { PairFenceService } from "../../src/safety/pair-fence.service";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run=process.env.RUN_DB_INTEGRATION==="1"?describe:describe.skip;
const origin="http://127.0.0.1:3001";
/** Dedicated local DB, or the exact existing ephemeral Actions recipe. No fallback. */
function disposableUrl() {
  const raw=process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url=new URL(raw);
  const dedicated=url.pathname==="/gobadminton_recommendations_disposable";
  const hosted=url.pathname==="/gobadminton" && process.env.GITHUB_ACTIONS==="true"
    && process.env.GMAP1_DISPOSABLE_DB==="1" && /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER??"")
    && url.port===process.env.CI_DB_PORT;
  if (process.env.NODE_ENV!=="test" || !["postgres:","postgresql:"].includes(url.protocol)
    || !["localhost","127.0.0.1","[::1]"].includes(url.hostname) || url.search || url.hash || !(dedicated||hosted)) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};
}
class ObservedPairs extends PairFenceService {
  gate:{held:ReturnType<typeof deferred<void>>;release:ReturnType<typeof deferred<void>>}|null=null;
  arm(){const gate={held:deferred<void>(),release:deferred<void>()};this.gate=gate;return gate;}
  override async lockOrCreate(client:PoolClient,a:string,b:string) {
    const gate=this.gate;this.gate=null;
    const pair=await super.lockOrCreate(client,a,b);
    if(gate){gate.held.resolve();await gate.release.promise;}return pair;
  }
}
type Actor={userId:string;publicPlayerId:string;sessionId:string;csrfToken:string;cookie:string};
type Response=Awaited<ReturnType<NestFastifyApplication["inject"]>>;
run("FR-3A protected recommendations — disposable synthetic PostGIS",()=>{
  let app:NestFastifyApplication,pool:Pool,env:AppEnv,sessions:SessionService,runner:MutationRunner;
  let a:Actor,b:Actor,c:Actor;
  const pairs=new ObservedPairs();
  const migrations=path.resolve(__dirname,"../../migrations");
  beforeAll(async()=>{
    const databaseUrl=disposableUrl();
    pool=new Pool({connectionString:databaseUrl,max:12,connectionTimeoutMillis:5000,application_name:"fr3a-synthetic"});
    const existing=await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'");
    if(existing.rows.length)throw new Error("Requires EMPTY disposable application schema");
    await pool.query("CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())");
    for(const file of (await readdir(migrations)).filter(f=>f.endsWith(".sql")&&f<"0040").sort()) await migrate(file);
    env=loadEnv({NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:databaseUrl,PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN:origin,COOKIE_SECURE:"false",AUTH_PEPPER:"fr3a-synthetic-fixture-pepper-only",
      CONTENT_MODERATION_PROVIDER:"fake",CONTENT_MODERATION_FINGERPRINT_SECRET:"fr3a-synthetic-fingerprint-only",
      SOCIAL_DIRECTORY_ENABLED:"1",FRIENDS_INTERNAL_ENABLED:"1",FRIENDS_REQUEST_TTL_SECONDS:"120",
      FRIENDS_RATE_WINDOW_SECONDS:"600",FRIENDS_SEND_LIMIT:"100",FRIENDS_RECEIVE_LIMIT:"100"});
    // Test-only constructed environment: exercise existing local policy overlays without enabling Admin runtime.
    env.USER_RESTRICTIONS_INTERNAL_ENABLED=true;env.GAME_MODERATION_INTERNAL_ENABLED=true;
    const ref=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),GameRecommendationsModule,VenuesModule]})
      .overrideProvider(PairFenceService).useValue(pairs).compile();
    app=ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();await app.getHttpAdapter().getInstance().ready();sessions=ref.get(SessionService);runner=ref.get(MutationRunner);
    // Current N app on N-1 schema: reads/capability empty and writes fail closed.
    const old=await actor("N-1 synthetic");
    expect((await get(old,"/v1/me/social-capabilities")).json().gameRecommendations).toBe(false);
    expect((await get(old,"/v1/me/game-recommendations?view=received")).json().items).toEqual([]);
    expect((await post(old,`/v1/games/${randomUUID()}/recommendations`,{friendshipId:randomUUID()})).statusCode).toBe(503);
    await migrate("0040_game_recommendations.sql");
    const client=await pool.connect();
    try{
      await client.query("BEGIN");await client.query(await readFile(path.join(migrations,"rollback/0040_game_recommendations.sql"),"utf8"));
      expect((await client.query("SELECT to_regclass('game_recommendations') AS name")).rows[0].name).toBeNull();
      expect((await client.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n).toBe(39);
    }finally{await client.query("ROLLBACK");client.release();}
    // Additive API/schema installation preserves the accepted Friends S1 capabilities.
    expect((await get(old,"/v1/me/social-capabilities")).json()).toEqual({
      friends:true,gameRecommendations:false,gameAttention:false,socialPush:false});
  },60000);
  async function migrate(file:string){const client=await pool.connect();try{
    await client.query("BEGIN");await client.query(await readFile(path.join(migrations,file),"utf8"));
    await client.query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  afterAll(async()=>{pairs.gate?.release.resolve();await app?.close();await pool?.end();});
  beforeEach(async()=>{
    env.FRIENDS_INTERNAL_ENABLED=true;env.FRIENDS_REQUEST_TTL_SECONDS=120;
    env.FRIENDS_SEND_LIMIT=100;env.FRIENDS_RECEIVE_LIMIT=100;
    a=await actor("FR3 synthetic A");b=await actor("FR3 synthetic B");c=await actor("FR3 synthetic outsider");
  });
  async function actor(name:string):Promise<Actor>{
    const userId=randomUUID(),publicPlayerId=randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)",[userId,name]);
    await pool.query(`INSERT INTO player_social_profiles(user_id,public_player_id,display_name,city_id,
      directory_visible,contact_policy,consent_policy_version,opted_in_at,bio)
      VALUES($1,$2,$3,$4,true,'requests','fr3-synthetic',clock_timestamp(),'PRIVATE BIO SENTINEL')`,[userId,publicPlayerId,name,MOSCOW_CITY_ID]);
    const issued=await sessions.createConsumerSession(userId);
    return {userId,publicPlayerId,sessionId:issued.session.id,csrfToken:issued.csrfToken,
      cookie:`${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`};
  }
  const key=()=>`fr3a-synthetic-${randomUUID()}`;
  function headers(who:Actor,idem=key()){return {cookie:who.cookie,origin,"x-csrf-token":who.csrfToken,"idempotency-key":idem};}
  function post(who:Actor,url:string,payload:unknown,idem=key()):Promise<Response>{return app.inject({method:"POST",url,
    payload:payload as object,headers:headers(who,idem)}) as Promise<Response>;}
  function get(who:Actor,url:string):Promise<Response>{return app.inject({method:"GET",url,headers:{cookie:who.cookie}}) as Promise<Response>;}
  async function accepted(from=a,to=b){
    const r=await post(from,"/v1/friend-requests",{targetPublicPlayerId:to.publicPlayerId});expect(r.statusCode).toBe(201);
    const decision=await post(to,`/v1/friend-requests/${r.json().requestId}/accept`,{expectedVersion:r.json().version});
    expect(decision.statusCode).toBe(200);return decision.json() as {friendshipId:string;version:string};
  }
  async function game(){
    const venue=await post(a,"/v1/venues",{cityId:MOSCOW_CITY_ID,name:`FR3 court ${randomUUID()}`,address:"Synthetic Moscow",
      timezone:"Europe/Moscow",latitude:55.75,longitude:37.62});expect([200,201]).toContain(venue.statusCode);
    const starts=Date.now()+7*86400000;
    const draft=await post(a,"/v1/games",{hostDisplayName:"Synthetic host",hostPublicContact:"telegram:@synthetic_private",
      venueId:venue.json().id,title:"FR3 disposable game",startsAt:new Date(starts).toISOString(),
      endsAt:new Date(starts+7200000).toISOString(),timezone:"Europe/Moscow",applicationDeadlineAt:new Date(starts-86400000).toISOString(),
      capacity:2,externalReservedCount:0,visibility:"public",formatKey:"doubles",activityKind:"regular",
      levelRule:{scaleId:"ntrp",scaleVersion:1,allowedLevelIds:["3.0","3.5"]},
      settlement:{mode:"external",purpose:"no_trainer_fee",priceMinor:null,currency:null,terms:"PRIVATE TERMS SENTINEL"}});
    expect(draft.statusCode).toBe(201);
    const published=await post(a,`/v1/games/${draft.json().id}/publish`,{expectedVersion:draft.json().version});
    expect(published.statusCode).toBe(200);return published.json() as {id:string;version:number};
  }
  const send=(who:Actor,gameId:string,friendshipId:string,idem=key())=>post(who,`/v1/games/${gameId}/recommendations`,{friendshipId},idem);
  const inbox=(who:Actor,view="received")=>get(who,`/v1/me/game-recommendations?view=${view}`);
  const action=(who:Actor,r:Receipt,kind:"hide"|"withdraw",idem=key())=>post(who,`/v1/me/game-recommendations/${r.id}/${kind}`,{expectedVersion:r.version},idem);
  async function noContent(){expect((await inbox(b)).json().items).toEqual([]);expect((await inbox(a,"sent")).json().items).toEqual([]);}
  async function count(gameId:string){return (await pool.query("SELECT count(*)::int AS n FROM game_recommendations WHERE game_id=$1",[gameId])).rows[0].n;}
  async function effects(gameId:string){
    const r=await pool.query(`SELECT
      (SELECT count(*)::int FROM participations WHERE game_id=$1) AS seats,
      (SELECT count(*)::int FROM game_invitations WHERE game_id=$1) AS invites,
      (SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1) AS outbox`,[gameId]);return r.rows[0];
  }
  it("two accepted actors send/replay/list/hide/withdraw; audit only, no seats or delivery effects",async()=>{
    const f=await accepted(),g=await game(),before=await effects(g.id),idem=key();
    // The protected API uses Friends admission; the future UI capability stays OFF.
    for(const who of [a,b]) expect((await get(who,"/v1/me/social-capabilities")).json()).toEqual({
      friends:true,gameRecommendations:false,gameAttention:false,socialPush:false});
    const sent=await send(a,g.id,f.friendshipId,idem);expect(sent.statusCode).toBe(201);const r=sent.json() as Receipt;
    expect(sent.headers["cache-control"]).toBe("no-store");expect(r).toEqual({id:expect.any(String),version:1,outcome:"sent"});
    const replay=await send(a,g.id,f.friendshipId,idem);expect(replay.statusCode).toBe(201);expect(replay.json()).toEqual(r);
    const duplicate=await send(a,g.id,f.friendshipId);expect(duplicate.statusCode).toBe(200);expect(duplicate.json()).toEqual(r);
    const received=await inbox(b),own=await inbox(a,"sent");
    expect(received.json().items).toHaveLength(1);expect(own.json().items).toHaveLength(1);
    const item=received.json().items[0];expect(Object.keys(item).sort()).toEqual(["createdAt","expiresAt","game","id","peer","state","version"]);
    expect(Object.keys(item.game).sort()).toEqual(["endsAt","id","startsAt","timezone","title"]);
    expect(item.peer).toEqual({publicPlayerId:a.publicPlayerId,displayName:"FR3 synthetic A"});
    for(const hidden of [a.userId,b.userId,"PRIVATE BIO SENTINEL","PRIVATE TERMS SENTINEL","telegram:@synthetic_private","recipient_hidden","pair_id"]){
      expect(received.body).not.toContain(hidden);expect(own.body).not.toContain(hidden);
    }
    expect((await inbox(c)).json().items).toEqual([]);expect((await inbox(c,"sent")).json().items).toEqual([]);
    expect((await action(a,r,"hide")).statusCode).toBe(404);expect((await action(b,r,"withdraw")).statusCode).toBe(404);
    expect((await action(c,r,"hide")).statusCode).toBe(404);
    const hideKey=key(),hidden=await action(b,r,"hide",hideKey);expect(hidden.statusCode).toBe(200);
    expect((await action(b,r,"hide",hideKey)).json()).toEqual(hidden.json());expect((await inbox(b)).json().items).toEqual([]);
    expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(404);
    expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(409);
    const latest=(await inbox(a,"sent")).json().items[0];expect(latest.state).toBe("active");
    expect((await action(a,r,"withdraw")).statusCode).toBe(409);
    const withdrawKey=key(),withdrawn=await action(a,latest,"withdraw",withdrawKey);expect(withdrawn.statusCode).toBe(200);
    expect((await action(a,latest,"withdraw",withdrawKey)).json()).toEqual(withdrawn.json());
    expect((await action(b,r,"hide",hideKey)).json()).toEqual(hidden.json());
    expect((await inbox(a,"sent")).json().items[0].state).toBe("withdrawn");
    expect(await count(g.id)).toBe(1);expect(await effects(g.id)).toEqual(before);
    const audit=await pool.query("SELECT action,version,actor_user_id FROM game_recommendation_actions WHERE recommendation_id=$1 ORDER BY version",[r.id]);
    expect(audit.rows).toEqual([{action:"send",version:1,actor_user_id:a.userId},{action:"hide",version:2,actor_user_id:b.userId},{action:"withdraw",version:3,actor_user_id:a.userId}]);
  });
  it("opposite friend directions are separate; same-key target changes cannot bypass the request hash",async()=>{
    const f=await accepted(),g=await game(),other=await game(),idem=key();
    const forward=await send(a,g.id,f.friendshipId,idem),back=await send(b,g.id,f.friendshipId);
    expect(forward.statusCode).toBe(201);expect(back.statusCode).toBe(201);
    expect(back.json().id).not.toBe(forward.json().id);expect(await count(g.id)).toBe(2);
    expect((await inbox(a)).json().items).toHaveLength(1);expect((await inbox(b,"sent")).json().items).toHaveLength(1);
    expect((await send(a,other.id,f.friendshipId,idem)).statusCode).toBe(409);expect(await count(other.id)).toBe(0);
  });
  it("requires accepted own friendship only, strict single target and no unknown-ID enumeration",async()=>{
    const g=await game(),pending=await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
    expect((await send(a,g.id,pending.json().friendshipId)).statusCode).toBe(404);
    const f=await accepted(a,c);
    expect((await send(b,g.id,f.friendshipId)).statusCode).toBe(404);
    expect((await send(a,g.id,randomUUID())).statusCode).toBe(404);
    expect((await send(a,randomUUID(),f.friendshipId)).statusCode).toBe(404);
    for(const payload of [{friendshipId:f.friendshipId,actorId:b.userId},{targetPublicPlayerId:c.publicPlayerId},
      {friendshipIds:[f.friendshipId]},{friendshipId:f.friendshipId,gameId:g.id}]){
      expect((await post(a,`/v1/games/${g.id}/recommendations`,payload)).statusCode).toBe(422);
    }
    expect(await count(g.id)).toBe(0);
  });
  it.each(["decline","cancel"])("%s of a pending friendship never grants a recommendation",async kind=>{
    const g=await game(),pending=await post(a,"/v1/friend-requests",{targetPublicPlayerId:b.publicPlayerId});
    expect((await post(kind==="decline"?b:a,`/v1/friend-requests/${pending.json().requestId}/${kind}`,{expectedVersion:pending.json().version})).statusCode).toBe(200);
    expect((await send(a,g.id,pending.json().friendshipId)).statusCode).toBe(404);
  });
  it.each(["draft","unlisted","cancelled","completed","past","hidden","taken_down","locked"])("game %s fails closed on send/list/replay",async kind=>{
    const f=await accepted(),g=await game(),idem=key();const r=await send(a,g.id,f.friendshipId,idem);expect(r.statusCode).toBe(201);
    if(kind==="unlisted")await pool.query("UPDATE games SET visibility='unlisted' WHERE id=$1",[g.id]);
    else if(kind==="past")await pool.query("UPDATE games SET starts_at=clock_timestamp()-interval '1 hour',application_deadline_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[g.id]);
    else if(["hidden","taken_down","locked"].includes(kind))await pool.query("INSERT INTO game_moderation_state(game_id,state,requests_locked) VALUES($1,$2,$3)",[g.id,kind==="locked"?"clear":kind,kind==="locked"]);
    else await pool.query("UPDATE games SET status=$2 WHERE id=$1",[g.id,kind]);
    await noContent();expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(404);
    expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(404);
    expect((await action(a,r.json(),"withdraw")).statusCode).toBe(200);
  });
  it.each(["remove","block_a","block_b","optout_a","optout_b","closed","ineligible","disabled","deletion","missing_profile"])("peer/pair %s revokes content and replay",async kind=>{
    const f=await accepted(),g=await game(),idem=key(),r=await send(a,g.id,f.friendshipId,idem);expect(r.statusCode).toBe(201);
    if(kind==="remove")expect((await post(a,`/v1/friendships/${f.friendshipId}/remove`,{expectedVersion:f.version})).statusCode).toBe(200);
    else if(kind.startsWith("block")){
      const who=kind==="block_a"?a:b,peer=kind==="block_a"?b:a;
      expect((await app.inject({method:"PUT",url:`/v1/me/blocks/${peer.publicPlayerId}`,payload:{},headers:headers(who)})).statusCode).toBe(200);
    }else if(kind.startsWith("optout"))await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[kind==="optout_a"?a.userId:b.userId]);
    else if(kind==="closed")await pool.query("UPDATE player_social_profiles SET contact_policy='closed' WHERE user_id=$1",[b.userId]);
    else if(kind==="ineligible")await pool.query("UPDATE player_social_profiles SET social_eligible=false WHERE user_id=$1",[b.userId]);
    else if(kind==="missing_profile")await pool.query("DELETE FROM player_social_profiles WHERE user_id=$1",[b.userId]);
    else await pool.query("UPDATE users SET status=$2 WHERE id=$1",[b.userId,kind==="deletion"?"deletion_pending":"disabled"]);
    expect((await inbox(a,"sent")).json().items).toEqual([]);
    if(!["disabled","deletion"].includes(kind))expect((await inbox(b)).json().items).toEqual([]);
    else expect((await inbox(b)).statusCode).toBe(401);
    expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(404);
    expect((await action(a,r.json(),"withdraw")).statusCode).toBe(200);
  });
  it.each(["profile.public","social.directory","account.access"])("both endpoint restriction %s denies send/read without peer metadata",async capability=>{
    const f=await accepted(),g=await game(),idem=key();expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(201);
    const principal=(await pool.query("INSERT INTO admin_principals(user_id) VALUES($1) RETURNING id",[c.userId])).rows[0].id;
    await pool.query("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,$2,'synthetic_fixture',clock_timestamp()+interval '1 hour',$3)",[b.userId,capability,principal]);
    expect((await inbox(a,"sent")).json().items).toEqual([]);expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(404);
    await pool.query("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,$2,'synthetic_fixture',clock_timestamp()+interval '1 hour',$3)",[a.userId,capability,principal]);
    expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(403);
  });
  it("old recommendation does not resurrect after opt-out/re-enable or remove/re-friend",async()=>{
    const f=await accepted(),g=await game(),idem=key();expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(201);
    await pool.query("UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1",[b.userId]);
    await pool.query("UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1",[b.userId]);
    await noContent();expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(404);
    expect((await post(a,`/v1/friendships/${f.friendshipId}/remove`,{expectedVersion:f.version})).statusCode).toBe(200);
    const fresh=await accepted();await noContent();expect((await send(a,g.id,fresh.friendshipId)).statusCode).toBe(409);
    expect(await count(g.id)).toBe(1);
  });
  it("expiry is effective without worker; cannot send old direction anew",async()=>{
    env.FRIENDS_REQUEST_TTL_SECONDS=1;
    const f=await accepted(),g=await game(),idem=key();expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(201);
    await new Promise(resolve=>setTimeout(resolve,1100));
    await noContent();expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(404);
    expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(409);
  });
  it("cookie/CSRF/origin/key/session fences apply before any write or enumeration",async()=>{
    const f=await accepted(),g=await game(),url=`/v1/games/${g.id}/recommendations`,payload={friendshipId:f.friendshipId};
    expect((await app.inject({method:"GET",url:"/v1/me/game-recommendations?view=received"})).statusCode).toBe(401);
    for(const change of [{cookie:""},{"x-csrf-token":""},{origin:"https://evil.invalid"},{authorization:"Bearer fake"},{"idempotency-key":""}]){
      const response=await app.inject({method:"POST",url,payload,headers:{...headers(a),...change}});
      expect([400,401,403]).toContain(response.statusCode);
    }
    expect(await count(g.id)).toBe(0);
    await sessions.revokeSession(a.sessionId);expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(401);
    expect((await inbox(a,"sent")).statusCode).toBe(401);
  });
  it("bounded rate limits do not charge duplicate sends; recipient cap is neutral 404",async()=>{
    const f=await accepted(),g=await game();env.FRIENDS_SEND_LIMIT=1;
    expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(201);
    expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(200);
    const next=await game(),limited=await send(a,next.id,f.friendshipId);expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    env.FRIENDS_SEND_LIMIT=100;env.FRIENDS_RECEIVE_LIMIT=1;
    const other=await accepted(c,b);expect((await send(c,next.id,other.friendshipId)).statusCode).toBe(404);
    expect(await count(next.id)).toBe(0);
  });
  it("signed cursor is actor/view-bound, private, strict, and survives empty revalidated pages",async()=>{
    const f=await accepted(),g1=await game(),g2=await game();await send(a,g1.id,f.friendshipId);await send(a,g2.id,f.friendshipId);
    const page=await get(b,"/v1/me/game-recommendations?view=received&limit=1"),cursor=page.json().nextCursor;
    expect(page.json().items).toHaveLength(1);expect(cursor).toBeTypeOf("string");
    const decoded=Buffer.from(cursor.split(".")[0],"base64url").toString();
    for(const id of [a.userId,b.userId,f.friendshipId])expect(decoded).not.toContain(id);
    const next=await get(b,`/v1/me/game-recommendations?view=received&limit=1&cursor=${encodeURIComponent(cursor)}`);
    expect(next.json().items).toHaveLength(1);expect(next.json().items[0].id).not.toBe(page.json().items[0].id);
    for(const [who,view,value] of [[a,"received",cursor],[b,"sent",cursor],[b,"received",cursor+"bad"]] as const){
      expect((await get(who,`/v1/me/game-recommendations?view=${view}&cursor=${encodeURIComponent(value)}`)).statusCode).toBe(409);
    }
    for(const suffix of ["limit=21","limit=0","actorId=unknown","view=other"]){
      expect((await get(b,`/v1/me/game-recommendations?view=received&${suffix}`)).statusCode).toBe(422);
    }
    await pool.query("UPDATE games SET visibility='unlisted' WHERE id=ANY($1::uuid[])",[[g1.id,g2.id]]);
    const empty=await get(b,"/v1/me/game-recommendations?view=received&limit=1");
    expect(empty.json().items).toEqual([]);expect(empty.json().nextCursor).toBeTypeOf("string");
  });
  it("Friends OFF/N-1-safe read and capability; safe terminal actions remain possible",async()=>{
    const f=await accepted(),g=await game(),r=(await send(a,g.id,f.friendshipId)).json();env.FRIENDS_INTERNAL_ENABLED=false;
    await noContent();expect((await get(a,"/v1/me/social-capabilities")).json().gameRecommendations).toBe(false);
    expect((await send(a,g.id,f.friendshipId)).statusCode).toBe(503);
    expect((await action(b,r,"hide")).statusCode).toBe(200);
    expect((await action(a,{...r,version:2},"withdraw")).statusCode).toBe(200);
  });
  it("same and different-key concurrent sends serialize to a single audited row",async()=>{
    const f=await accepted(),g=await game(),idem=key(),gate=pairs.arm();
    const first=send(a,g.id,f.friendshipId,idem);await gate.held.promise;
    const second=send(a,g.id,f.friendshipId,idem),third=send(a,g.id,f.friendshipId);
    gate.release.resolve();const responses=await Promise.all([first,second,third]);
    expect(responses.map(r=>r.statusCode).sort()).toEqual([200,201,201]);
    expect(new Set(responses.map(r=>r.json().id)).size).toBe(1);expect(await count(g.id)).toBe(1);
  });
  it("send holding Pair fence serializes with friendship remove; read and replay fail closed after remove",async()=>{
    const f=await accepted(),g=await game(),idem=key(),gate=pairs.arm();
    const first=send(a,g.id,f.friendshipId,idem);await gate.held.promise;
    const removal=post(b,`/v1/friendships/${f.friendshipId}/remove`,{expectedVersion:f.version});
    gate.release.resolve();expect((await first).statusCode).toBe(201);expect((await removal).statusCode).toBe(200);
    await noContent();expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(404);
  });
  it("lost COMMIT acknowledgement returns no success; exact-key retry recovers one real row",async()=>{
    const f=await accepted(),g=await game(),idem=key();
    let armed=true;
    // Fault only the MutationRunner connection, preserving pg Pool.query's callback API for auth.
    Object.assign(runner,{pool:{connect:async()=>{
      const client=await pool.connect(),query=client.query.bind(client);let inserted=false;
      client.query=(async(sql:string,values?:unknown[])=>{
        const result=await query(sql,values);
        if(typeof sql==="string"&&sql.includes("INSERT INTO game_recommendations"))inserted=true;
        if(sql==="COMMIT"&&inserted&&armed){armed=false;throw new Error("synthetic lost commit acknowledgement");}
        return result;
      }) as typeof client.query;
      // Pool can reuse this client; restore the real method before release.
      const release=client.release.bind(client);client.release=()=>{client.query=query;client.release=release;release();};
      return client;
    }}});
    try{expect((await send(a,g.id,f.friendshipId,idem)).statusCode).toBe(500);}finally{Object.assign(runner,{pool});}
    expect(await count(g.id)).toBe(1);
    const replay=await send(a,g.id,f.friendshipId,idem);expect(replay.statusCode).toBe(201);expect(await count(g.id)).toBe(1);
    expect((await inbox(b)).json().items).toHaveLength(1);
  });
  it("DB rejects forged endpoints/state/version/history and populated schema rollback",async()=>{
    const f=await accepted(),g=await game(),r=(await send(a,g.id,f.friendshipId)).json();
    await expect(pool.query(`INSERT INTO game_recommendations(friendship_id,friendship_generation,game_id,sender_user_id,recipient_user_id,
      sender_epoch,recipient_epoch,expires_at) VALUES($1,1,$2,$3,$4,1,1,clock_timestamp()+interval '1 minute')`,[f.friendshipId,g.id,c.userId,b.userId])).rejects.toMatchObject({code:"23514"});
    await expect(pool.query("UPDATE game_recommendations SET version=version+2 WHERE id=$1",[r.id])).rejects.toMatchObject({code:"23514"});
    await expect(pool.query("UPDATE game_recommendations SET state='confirmed' WHERE id=$1",[r.id])).rejects.toMatchObject({code:"23514"});
    await expect(pool.query("DELETE FROM game_recommendation_actions WHERE recommendation_id=$1",[r.id])).rejects.toMatchObject({code:"23514"});
    const client=await pool.connect();try{await client.query("BEGIN");
      await expect(client.query(await readFile(path.join(migrations,"rollback/0040_game_recommendations.sql"),"utf8"))).rejects.toMatchObject({code:"23514"});
    }finally{await client.query("ROLLBACK");client.release();}
  });
});
