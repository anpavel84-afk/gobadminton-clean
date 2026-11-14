import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { AuthModule } from "../../src/auth/auth.module";
import { SessionService } from "../../src/auth/session.service";
import { NativeSessionService } from "../../src/auth/native-session.service";
import { NativeAuthService } from "../../src/auth/native-auth.service";
import { ConsumerAuthService } from "../../src/auth/consumer-auth.service";
import { ActorFenceService } from "../../src/common/actor-fence.service";
import { NATIVE_BINDING_COOKIE, SESSION_COOKIE } from "../../src/auth/constants";
import { s256 } from "../../src/auth/native-auth-security";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { buildTestCoreModule } from "./test-core.module";

// Requires the existing disposable local DB harness, migrated through 0072 by the parent.
// A skipped run is NOT_TESTED. Never supplies or discovers live credentials.
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("native auth atomic handoff and refresh foundation",()=>{
  let app:NestFastifyApplication;
  let pool:ReturnType<typeof createDatabase>["pool"];
  let sessions:SessionService, native:NativeSessionService;
  const origin="https://localhost:3001", clientId="android.test",redirectUri="https://app.example.test/auth/callback";
  const env=loadEnv({NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:process.env.DATABASE_URL??"postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton",
    PUBLIC_API_ORIGIN:"https://localhost:3000",PUBLIC_WEB_ORIGIN:origin,COOKIE_SECURE:"true",NATIVE_AUTH_ENABLED:"1",
    NATIVE_AUTH_CLIENTS_JSON:JSON.stringify([{clientId,redirectUris:[redirectUri]}])});
  beforeAll(async()=>{
    pool=createDatabase(env.DATABASE_URL).pool;
    expect((await pool.query("SELECT to_regclass('native_refresh_tokens')::text AS name")).rows[0]?.name).toBe("native_refresh_tokens");
    const module=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AuthModule]}).compile();
    app=module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    await app.register(cookie);app.setGlobalPrefix("v1");await app.init();await app.getHttpAdapter().getInstance().ready();
    sessions=app.get(SessionService);native=app.get(NativeSessionService);
  });
  afterAll(async()=>{await app?.close();await pool?.end();});
  async function browser() {
    const id=randomUUID();await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Native fixture')",[id]);
    const issued=await sessions.createConsumerSession(id);
    return {id,...issued,cookie:`${SESSION_COOKIE}=${issued.sessionToken}`};
  }
  async function handoff(actor:Awaited<ReturnType<typeof browser>>) {
    const verifier="v".repeat(43),state="state".repeat(8);
    const created=await app.inject({method:"POST",url:"/v1/auth/native/transactions",payload:{clientId,redirectUri,codeChallenge:s256(verifier),codeChallengeMethod:"S256",state,returnPath:"/games"}});
    expect(created.statusCode).toBe(200);const tx=created.json();expect(tx.browserStartUrl).toBe(`${origin}/auth/native?transactionId=${tx.transactionId}`);
    const url=`/v1/auth/native/transactions/${tx.transactionId}`;
    expect((await app.inject({url:url+"/complete"})).statusCode).toBe(404);
    const binding=await app.inject({method:"POST",url:url+"/bind",headers:{origin,"x-native-auth":"1"},payload:{}});
    expect(binding.statusCode).toBe(200);
    const set=binding.headers["set-cookie"];
    const nonce=(Array.isArray(set)?set:[set]).find(item=>item?.startsWith(NATIVE_BINDING_COOKIE+"="))!.split(";")[0]!;
    expect((await app.inject({method:"POST",url:url+"/bind",headers:{origin,"x-native-auth":"1"},payload:{}})).statusCode).toBe(403);
    const headers={origin,"x-native-auth":"1",cookie:`${actor.cookie}; ${nonce}`,"x-csrf-token":actor.csrfToken};
    expect((await app.inject({method:"POST",url:url+"/bind",headers,payload:{}})).statusCode).toBe(200);
    const complete=await app.inject({method:"POST",url:url+"/complete",headers,payload:{}});
    expect(complete.statusCode).toBe(200);expect(complete.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({method:"POST",url:url+"/complete",headers,payload:{}})).statusCode).toBe(409);
    const callback=new URL(complete.json().callbackUrl);expect([...callback.searchParams.keys()].sort()).toEqual(["code","state"]);expect(callback.searchParams.get("state")).toBe(state);
    return {clientId,redirectUri,code:callback.searchParams.get("code")!,verifier};
  }
  async function login(actor:Awaited<ReturnType<typeof browser>>) {
    const payload=await handoff(actor),response=await app.inject({method:"POST",url:"/v1/auth/native/exchange",payload});
    expect(response.statusCode).toBe(200);return response.json() as {accessToken:string;refreshToken:string;sessionId:string};
  }
  it("consumes a handoff atomically, enforces verifier, stores hashes, separates browser/native and owned routes",async()=>{
    const actor=await browser(),grant=await handoff(actor);
    expect((await app.inject({method:"POST",url:"/v1/auth/native/exchange",payload:{...grant,verifier:"wrong".repeat(10)}})).statusCode).toBe(401);
    const results=await Promise.all([1,2].map(()=>app.inject({method:"POST",url:"/v1/auth/native/exchange",payload:grant})));
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,401]);
    const issued=results.find(r=>r.statusCode===200)!.json();const headers={authorization:`Bearer ${issued.accessToken}`};
    const me=await app.inject({url:"/v1/me",headers});expect(me.statusCode).toBe(200);expect(me.json()).toMatchObject({id:actor.id,session:{audience:"consumer_native"}});expect(me.json()).not.toHaveProperty("csrfToken");
    expect((await app.inject({url:"/v1/me",headers:{cookie:actor.cookie}})).json().csrfToken).toBe(actor.csrfToken);
    expect((await app.inject({url:"/v1/me/sessions",headers})).json().items).toHaveLength(2);
    expect((await app.inject({url:"/v1/me/linked-providers",headers})).statusCode).toBe(401);
    expect((await app.inject({url:"/v1/me",headers:{...headers,cookie:actor.cookie}})).statusCode).toBe(403);
    expect((await app.inject({url:"/v1/me",headers:{authorization:"Bearer invalid"}})).statusCode).toBe(401);
    expect((await sessions.lookupActiveSession(issued.accessToken))).toBeNull();
    const stored=await pool.query("SELECT to_jsonb(t)::text AS value FROM native_auth_transactions t WHERE code_hash=$1",[native.hash(grant.code)]);
    expect(stored.rows[0].value).not.toContain(grant.code);
    const credentials=await pool.query("SELECT token_hash FROM native_access_tokens WHERE session_id=$1 UNION ALL SELECT token_hash FROM native_refresh_tokens WHERE session_id=$1",[issued.sessionId]);
    expect(credentials.rows.map(r=>r.token_hash)).not.toContain(issued.accessToken);expect(credentials.rows.map(r=>r.token_hash)).not.toContain(issued.refreshToken);
    const other=await browser();
    await expect(sessions.revokeOwnedSession({userId:other.id,currentSessionId:other.session.id,sessionId:issued.sessionId})).rejects.toMatchObject({status:404});
    expect((await app.inject({method:"DELETE",url:`/v1/me/sessions/${actor.session.id}`,headers:{...headers,"idempotency-key":randomUUID()}})).statusCode).toBe(200);
    expect(await sessions.lookupActiveSession(actor.sessionToken)).toBeNull();
    const extra=await sessions.createConsumerSession(actor.id);
    expect((await app.inject({method:"DELETE",url:`/v1/me/sessions/${issued.sessionId}`,headers:{...headers,"idempotency-key":randomUUID()}})).statusCode).toBe(409);
    const revoked=await app.inject({method:"POST",url:"/v1/me/sessions/revoke-others",headers:{...headers,"idempotency-key":randomUUID()},payload:{}});
    expect(revoked.statusCode).toBe(200);expect(revoked.json().revokedCount).toBe(1);
    expect(await sessions.lookupActiveSession(extra.sessionToken)).toBeNull();
    expect((await app.inject({url:"/v1/me/sessions",headers})).json().items[0].current).toBe(true);
  });
  it("serializes refresh, commits replay revocation and retains consumed history",async()=>{
    const issued=await login(await browser());
    const rotated=await Promise.allSettled([native.refresh(issued.refreshToken,clientId),native.refresh(issued.refreshToken,clientId)]);
    expect(rotated.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(rotated.filter(r=>r.status==="rejected")).toHaveLength(1);
    await expect(native.lookup(issued.accessToken)).rejects.toMatchObject({status:401});
    const winner=rotated.find(r=>r.status==="fulfilled");if(winner?.status!=="fulfilled") throw Error("Expected rotation");
    await expect(native.lookup(winner.value.accessToken)).rejects.toMatchObject({status:401});
    const row=(await pool.query("SELECT s.revoked_at,t.consumed_at FROM app_sessions s JOIN native_refresh_tokens t ON t.session_id=s.id WHERE t.token_hash=$1",[native.hash(issued.refreshToken)])).rows[0];
    expect(row.revoked_at).not.toBeNull();expect(row.consumed_at).not.toBeNull();
  });
  it("rejects revoked grants, inactive/restricted users, expiry, and supports expired-access logout with refresh",async()=>{
    const actor=await browser(),grant=await handoff(actor);await sessions.revokeSession(actor.session.id);
    expect((await app.inject({method:"POST",url:"/v1/auth/native/exchange",payload:grant})).statusCode).toBe(401);
    const second=await browser(),issued=await login(second);
    await pool.query("UPDATE native_access_tokens SET expires_at=now()-interval '1 second' WHERE session_id=$1",[issued.sessionId]);
    await expect(native.lookup(issued.accessToken)).rejects.toMatchObject({status:401});
    expect(await native.logout({clientId,refreshToken:issued.refreshToken})).toEqual({ok:true});
    expect(await native.logout({clientId,refreshToken:issued.refreshToken})).toEqual({ok:true});
    expect(await sessions.lookupActiveSession(second.sessionToken)).not.toBeNull();
    const third=await browser(),thirdSession=await login(third);await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[third.id]);
    await expect(native.refresh(thirdSession.refreshToken,clientId)).rejects.toMatchObject({status:401});
    const restricted=new NativeSessionService(pool,{...env,USER_RESTRICTIONS_INTERNAL_ENABLED:true},new ActorFenceService({...env,USER_RESTRICTIONS_INTERNAL_ENABLED:true}));
    const fourth=await browser(),fourthSession=await login(fourth);
    const adminUser=await browser();
    const principal=(await pool.query("INSERT INTO admin_principals(user_id) VALUES($1) RETURNING id",[adminUser.id])).rows[0].id;
    await pool.query("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,'account.access','test_native',now()+interval '1 hour',$2)",[fourth.id,principal]);
    await expect(restricted.lookup(fourthSession.accessToken)).rejects.toMatchObject({status:401});
    await expect(restricted.refresh(fourthSession.refreshToken,clientId)).rejects.toMatchObject({status:403});
    expect((await pool.query("SELECT revoked_at FROM app_sessions WHERE id=$1",[fourthSession.sessionId])).rows[0].revoked_at).toBeNull();
    await pool.query("UPDATE native_refresh_families SET idle_expires_at=now()-interval '1 second' WHERE session_id=$1",[fourthSession.sessionId]);
    await expect(native.refresh(fourthSession.refreshToken,clientId)).rejects.toMatchObject({status:401});
  });
  it("post-lock fence rechecks a native session revoked while waiting; disabled transport never falls back",async()=>{
    const actor=await browser(),issued=await login(actor),blocker=await pool.connect(),waiter=await pool.connect();
    try {
      await blocker.query("BEGIN");await blocker.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE",[actor.id]);
      await waiter.query("BEGIN");
      const pid=(await waiter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const fenced=expect(app.get(ActorFenceService).assertActiveConsumerInTransaction(waiter,{actorId:actor.id,sessionId:issued.sessionId})).rejects.toMatchObject({status:401});
      let waiting=false;
      for(let i=0;i<100;i++) {
        waiting=(await pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true;
        if(waiting) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await blocker.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[issued.sessionId]);await blocker.query("COMMIT");
      await fenced;await waiter.query("ROLLBACK");
    } finally {await blocker.query("ROLLBACK");await waiter.query("ROLLBACK");blocker.release();waiter.release();}
    const disabled=new NativeSessionService(pool,{...env,NATIVE_AUTH_ENABLED:false},app.get(ActorFenceService));
    const consumer=new ConsumerAuthService({...env,NATIVE_AUTH_ENABLED:false},sessions,{} as never,disabled);
    await expect(consumer.requirePrincipal({headers:{authorization:`Bearer ${issued.accessToken}`},raw:{rawHeaders:[]}} as never)).rejects.toMatchObject({status:404});
  });
  it("bounds transaction retention and preserves a live transaction and handoff across transaction expiry",async()=>{
    const actor=await browser(),grant=await handoff(actor),prefix=`retention-${randomUUID()}-`;
    const created=await app.inject({method:"POST",url:"/v1/auth/native/transactions",payload:{
      clientId,redirectUri,codeChallenge:s256("v".repeat(43)),codeChallengeMethod:"S256",state:"s".repeat(32)}});
    expect(created.statusCode).toBe(200);
    const liveHash=native.hash(created.json().transactionId);
    // The completed grant is still valid for 60 seconds, although its transaction just expired.
    await pool.query("UPDATE native_auth_transactions SET expires_at=now()-interval '1 second' WHERE code_hash=$1",[native.hash(grant.code)]);
    await pool.query(`INSERT INTO native_auth_transactions(id_hash,client_id,redirect_uri,challenge,callback_state,return_path,expires_at)
      SELECT $1||i,$2,$3,$4,$5,'/games',now()-interval '100 years' FROM generate_series(1,103) i`,
      [prefix,clientId,redirectUri,s256("v".repeat(43)),"s".repeat(32)]);
    const remaining=async()=>Number((await pool.query("SELECT count(*) FROM native_auth_transactions WHERE id_hash LIKE $1",[prefix+"%"])).rows[0].count);
    await app.get(NativeAuthService).budget({ip:"retention-test"} as never,"retention-test");
    expect(await remaining()).toBe(3);
    expect((await pool.query("SELECT id_hash FROM native_auth_transactions WHERE id_hash=$1",[liveHash])).rowCount).toBe(1);
    expect((await pool.query("SELECT id_hash FROM native_auth_transactions WHERE code_hash=$1",[native.hash(grant.code)])).rowCount).toBe(1);
    const exchanged=await app.inject({method:"POST",url:"/v1/auth/native/exchange",payload:grant});
    expect(exchanged.statusCode).toBe(200);
    expect(await remaining()).toBe(0);
    // A consumed grant never gains a replay window from the retention exception.
    expect((await app.inject({method:"POST",url:"/v1/auth/native/exchange",payload:grant})).statusCode).toBe(401);
  });
  it("bounds expired access/history deletion, retains live and revoked family replay history and all session audit rows",async()=>{
    const live=await login(await browser()),liveRotation=await native.refresh(live.refreshToken,clientId);
    const revoked=await login(await browser()),revokedRotation=await native.refresh(revoked.refreshToken,clientId);
    await native.logout({clientId,refreshToken:revokedRotation.refreshToken});
    const actor=await browser(),expired=await login(actor),prefix=`retention-${randomUUID()}-`;
    await pool.query("UPDATE native_refresh_families SET absolute_expires_at=now()-interval '1 second' WHERE session_id=$1",[expired.sessionId]);
    await pool.query("UPDATE native_access_tokens SET expires_at=now()-interval '100 years' WHERE session_id=$1",[expired.sessionId]);
    await pool.query(`INSERT INTO native_access_tokens(token_hash,session_id,expires_at)
      SELECT $1||i,$2,now()-interval '100 years' FROM generate_series(1,102) i`,[prefix,expired.sessionId]);
    await pool.query(`INSERT INTO native_refresh_tokens(token_hash,session_id,consumed_at)
      SELECT $1||i,$2,now() FROM generate_series(1,102) i`,[prefix,expired.sessionId]);
    const validAccess=prefix+"valid-access";
    await pool.query("INSERT INTO native_access_tokens(token_hash,session_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[validAccess,expired.sessionId]);
    const counts=async()=>(await pool.query(`SELECT
      (SELECT count(*)::int FROM native_access_tokens WHERE session_id=$1 AND expires_at<=now()) AS access,
      (SELECT count(*)::int FROM native_refresh_tokens WHERE session_id=$1) AS refresh,
      (SELECT count(*)::int FROM native_refresh_families WHERE session_id=$1) AS family`,[expired.sessionId])).rows[0];
    await native.cleanupExpired();
    expect(await counts()).toEqual({access:3,refresh:3,family:1});
    await native.cleanupExpired();
    expect(await counts()).toEqual({access:0,refresh:0,family:1});
    expect((await pool.query("SELECT token_hash FROM native_access_tokens WHERE token_hash=$1",[validAccess])).rowCount).toBe(1);
    // An idle-expired but not absolutely expired family must retain consumed history too.
    await pool.query("UPDATE native_refresh_families SET idle_expires_at=now()-interval '1 second' WHERE session_id=$1",[revoked.sessionId]);
    await Promise.all([native.cleanupExpired(),native.cleanupExpired()]);
    expect(await counts()).toEqual({access:0,refresh:0,family:1});
    await pool.query("UPDATE native_access_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[validAccess]);
    await native.cleanupExpired();
    expect(await counts()).toEqual({access:0,refresh:0,family:0});
    for (const issued of [live,revoked]) {
      expect((await pool.query("SELECT consumed_at FROM native_refresh_tokens WHERE token_hash=$1",[native.hash(issued.refreshToken)])).rows[0]?.consumed_at).toBeInstanceOf(Date);
      expect((await pool.query("SELECT session_id FROM native_refresh_families WHERE session_id=$1",[issued.sessionId])).rowCount).toBe(1);
    }
    expect((await pool.query("SELECT revoked_at FROM native_refresh_families WHERE session_id=$1",[revoked.sessionId])).rows[0].revoked_at).toBeInstanceOf(Date);
    expect((await native.lookup(liveRotation.accessToken)).sessionId).toBe(live.sessionId);
    // The browser and expired native audit records survive credential retention.
    expect((await pool.query("SELECT id FROM app_sessions WHERE id=ANY($1::uuid[])",[[actor.session.id,expired.sessionId]])).rowCount).toBe(2);
    expect(await sessions.lookupActiveSession(actor.sessionToken)).not.toBeNull();
  });
  it("returns 401 if expiry cleanup removes the family after refresh identity lookup while waiting for User",async()=>{
    const actor=await browser(),issued=await login(actor),blocker=await pool.connect();
    // One real DB connection gives a stable backend PID for deterministic lock-wait observation.
    const refreshPool=new Pool({connectionString:env.DATABASE_URL,max:1});
    const refreshing=new NativeSessionService(refreshPool,env,app.get(ActorFenceService));
    let outcome:Promise<unknown>|undefined;
    try {
      const pid=(await refreshPool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await pool.query("UPDATE native_refresh_families SET absolute_expires_at=now()-interval '1 second' WHERE session_id=$1",[issued.sessionId]);
      await pool.query("UPDATE native_access_tokens SET expires_at=now()-interval '1 second' WHERE session_id=$1",[issued.sessionId]);
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE",[actor.id]);
      outcome=refreshing.refresh(issued.refreshToken,clientId).then(value=>value,error=>error);
      let waiting=false;
      for(let i=0;i<100;i++) {
        waiting=(await pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true;
        if(waiting) break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);
      await native.cleanupExpired();
      expect((await pool.query("SELECT session_id FROM native_refresh_families WHERE session_id=$1",[issued.sessionId])).rowCount).toBe(0);
      await blocker.query("COMMIT");
      expect(await outcome).toMatchObject({status:401});
    } finally {
      await blocker.query("ROLLBACK");blocker.release();
      await outcome;await refreshPool.end();
    }
  });
});
