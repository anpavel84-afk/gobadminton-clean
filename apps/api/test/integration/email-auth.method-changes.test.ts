import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { deliverEmail } from "../../src/auth/email-delivery";
import { FakeMailTransport } from "../../src/auth/mail-transport";
import { IdentityService } from "../../src/auth/identity.service";
import { SessionService } from "../../src/auth/session.service";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { buildTestCoreModule } from "./test-core.module";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL ?? "postgres://email_test@127.0.0.1:16492/email_behavior";
const origin = "http://127.0.0.1:3001", root = "/v1/me/auth-methods/email";
run("E3 method proof/revoke on real PostgreSQL", () => {
  let app: NestFastifyApplication, pool: Pool, env: AppEnv, mail: FakeMailTransport, sessions: SessionService, identities: IdentityService;
  beforeAll(async () => {
    Object.assign(process.env,{NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:databaseUrl,PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",PUBLIC_WEB_ORIGIN:origin,ALLOWED_WEB_ORIGINS:origin,AUTH_PEPPER:"e3-synthetic-session-secret-only-32chars",EMAIL_AUTH_TRANSPORT:"fake",EMAIL_AUTH_HMAC_SECRET:"e3-synthetic-hmac-secret-only-32chars",EMAIL_AUTH_ENCRYPTION_SECRET:"e3-synthetic-encryption-only-32chars",EMAIL_AUTH_RATE_SECRET:"e3-synthetic-rate-secret-only-32chars",COOKIE_SECURE:"true"});
    execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:process.env,stdio:"inherit"});
    env=loadEnv();pool=createDatabase(databaseUrl).pool;
    const ref=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AuthModule]}).compile();
    mail=ref.get(FakeMailTransport);sessions=ref.get(SessionService);identities=ref.get(IdentityService);
    app=ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => { await pool.query("DELETE FROM email_auth_rate_buckets"); });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  async function actor(oauth = false) {
    const userId=(await pool.query<{id:string}>("INSERT INTO users(display_name) VALUES('E3 Synthetic') RETURNING id")).rows[0]!.id;
    const email=`${randomUUID()}@example.test`;
    const methodId=(await pool.query<{id:string}>("INSERT INTO email_auth_methods(user_id,email_canonical,email_display) VALUES($1,$2,$2) RETURNING id",[userId,email])).rows[0]!.id;
    if(oauth) await pool.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject) VALUES($1,'vk','e3-fixture',$2)",[userId,randomUUID()]);
    const issued=await sessions.createConsumerSession(userId);
    return {userId,email,methodId,sessionId:issued.session.id,headers:{origin,"x-gb-email-auth":"1","x-csrf-token":issued.csrfToken},cookies:{[SESSION_COOKIE]:issued.sessionToken}};
  }
  type Actor=Awaited<ReturnType<typeof actor>>;
  async function issue(a:Actor,purpose="change/current",payload:object={}) {
    const r=await app.inject({method:"POST",url:`${root}/${purpose}/challenges`,headers:a.headers,cookies:a.cookies,payload});expect(r.statusCode,r.body).toBe(202);
    const id=r.json().challengeId as string;await deliverEmail({pool,env,transport:mail,payload:{challengeId:id,generation:1}});const code=mail.read(`${id}:1`)!.code;return {id,code};
  }
  async function verify(a:Actor,c:{id:string;code:string},purpose="change/current") {return app.inject({method:"POST",url:`${root}/${purpose}/challenges/${c.id}/verify`,headers:a.headers,cookies:a.cookies,payload:{code:c.code}});}
  async function current(a:Actor) {const c=await issue(a);const r=await verify(a,c);expect(r.statusCode,r.body).toBe(200);expect(r.json()).toEqual({proved:true,proofChallengeId:c.id});return c;}
  async function revoke(a:Actor) {return app.inject({method:"DELETE",url:root,headers:a.headers,cookies:a.cookies,payload:{}});}
  it("email-only change proves current then new mailbox; atomic replacement and single-use proof",async()=>{
    const a=await actor(),proof=await current(a),email=`${randomUUID()}@example.test`;
    const c=await issue(a,"change",{email,proofChallengeId:proof.id});
    expect((await pool.query("SELECT email_canonical FROM email_auth_methods WHERE user_id=$1 AND status='active'",[a.userId])).rows[0]!.email_canonical).toBe(a.email);
    const dup=await app.inject({method:"POST",url:root+"/change/challenges",headers:a.headers,cookies:a.cookies,payload:{email:`${randomUUID()}@example.test`,proofChallengeId:proof.id}});expect(dup.statusCode).toBe(403);
    const results=await Promise.all([verify(a,c,"change"),verify(a,c,"change")]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
    const rows=(await pool.query("SELECT email_canonical,status FROM email_auth_methods WHERE user_id=$1 ORDER BY status",[a.userId])).rows;expect(rows).toEqual([{email_canonical:email,status:"active"},{email_canonical:a.email,status:"revoked"}]);
    expect((await pool.query("SELECT code_ciphertext FROM email_auth_challenges WHERE id=$1",[c.id])).rows[0]!.code_ciphertext).toBeNull();
  });
  it("no replacement without proof, with another session, expired proof, wrong Origin or absent CSRF",async()=>{
    const a=await actor(),p=await current(a),email=`${randomUUID()}@example.test`;
    const request=()=>app.inject({method:"POST",url:root+"/change/challenges",headers:a.headers,cookies:a.cookies,payload:{email,proofChallengeId:p.id}});
    const other=await sessions.createConsumerSession(a.userId);
    const mismatch=await app.inject({method:"POST",url:root+"/change/challenges",headers:{...a.headers,"x-csrf-token":other.csrfToken},cookies:{[SESSION_COOKIE]:other.sessionToken},payload:{email,proofChallengeId:p.id}});expect(mismatch.statusCode).toBe(403);
    await pool.query("UPDATE email_auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[p.id]);expect((await request()).statusCode).toBe(403);
    for(const headers of [{...a.headers,origin:"http://evil.test"},{origin,"x-gb-email-auth":"1"}]) expect((await app.inject({method:"DELETE",url:root,headers,cookies:a.cookies,payload:{}})).statusCode).toBe(403);
  });
  it("collision consumes new proof without revoke/merge; wrong current code and reused current code rejected",async()=>{
    const a=await actor(),b=await actor(),p=await issue(a);
    expect((await verify(a,{...p,code:p.code==="00000000"?"11111111":"00000000"})).statusCode).toBe(422);
    expect((await verify(a,p)).statusCode).toBe(200);expect((await verify(a,p)).statusCode).toBe(422);
    const c=await issue(a,"change",{email:b.email,proofChallengeId:p.id});const r=await verify(a,c,"change");expect(r.statusCode).toBe(409);expect(r.json().code).toBe("EMAIL_ALREADY_LINKED");
    expect((await pool.query("SELECT email_canonical FROM email_auth_methods WHERE user_id=$1 AND status='active'",[a.userId])).rows[0]!.email_canonical).toBe(a.email);
    expect((await pool.query("SELECT state FROM email_auth_challenges WHERE id=$1",[c.id])).rows[0]!.state).toBe("consumed");
  });
  it("parallel OAuth/email unlink always keeps one usable credential",async()=>{
    for(let i=0;i<4;i++) {
      const a=await actor(true);
      const result=await Promise.all([revoke(a),identities.unlinkProvider(a.userId,"vk",a.sessionId).then(()=>200,error=>error.getStatus())]);
      expect([result[0].statusCode,result[1]].sort()).toEqual([200,409]);
      const counts=(await pool.query("SELECT (SELECT count(*) FROM external_identities WHERE user_id=$1)+(SELECT count(*) FROM email_auth_methods WHERE user_id=$1 AND status='active') AS n",[a.userId])).rows[0]!;expect(Number(counts.n)).toBe(1);
    }
    const a=await actor();expect((await revoke(a)).json().code).toBe("LAST_AUTH_METHOD");
  });
  it("stale sessions fail both OAuth and email revoke; inactive and revoked sessions cannot change",async()=>{
    const a=await actor(true);await pool.query("UPDATE app_sessions SET authenticated_at=now()-interval '16 minutes' WHERE id=$1",[a.sessionId]);
    expect((await revoke(a)).json().code).toBe("RECENT_AUTH_REQUIRED");await expect(identities.unlinkProvider(a.userId,"vk",a.sessionId)).rejects.toMatchObject({response:{code:"RECENT_AUTH_REQUIRED"}});
    await pool.query("UPDATE app_sessions SET authenticated_at=now() WHERE id=$1",[a.sessionId]);const p=await current(a);const c=await issue(a,"change",{email:`${randomUUID()}@example.test`,proofChallengeId:p.id});
    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[a.sessionId]);expect((await verify(a,c,"change")).statusCode).toBe(401);
  });
  it("unlink invalidates pending change and old credential cannot sign into the old User",async()=>{
    const a=await actor(true),p=await current(a),c=await issue(a,"change",{email:`${randomUUID()}@example.test`,proofChallengeId:p.id});expect((await revoke(a)).statusCode).toBe(200);expect((await verify(a,c,"change")).statusCode).toBe(409);expect((await revoke(a)).statusCode).toBe(404);
    expect((await pool.query("SELECT id FROM email_auth_methods WHERE user_id=$1 AND status='active'",[a.userId])).rows).toHaveLength(0);
  });
  it("browser status POST obeys exact Origin/session and discloses no code",async()=>{
    const a=await actor(),c=await issue(a);const r=await app.inject({method:"POST",url:root+`/change/current/challenges/${c.id}/status`,headers:a.headers,cookies:a.cookies,payload:{}});expect(r.statusCode).toBe(200);expect(Object.keys(r.json()).sort()).toEqual(["challengeId","expiresAt","resendAvailableAt","deliveryState"].sort());expect(r.body).not.toContain(c.code);
  });
  it("login waiting on User fence rechecks a revoked credential instead of signing into its former owner",async()=>{
    const a=await actor(true);
    const r=await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers:{origin,"x-gb-email-auth":"1"},payload:{email:a.email}});
    expect(r.statusCode).toBe(202);const id=r.json().challengeId as string;
    const binding=String(r.headers["set-cookie"]).split(";")[0]!.split("=")[1]!;
    await deliverEmail({pool,env,transport:mail,payload:{challengeId:id,generation:1}});const code=mail.read(`${id}:1`)!.code;
    const fence=await pool.connect();await fence.query("BEGIN");await fence.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[a.userId]);
    const verification=app.inject({method:"POST",url:`/v1/auth/email/challenges/${id}/verify`,headers:{origin,"x-gb-email-auth":"1"},cookies:{"__Host-gb_email_auth_binding":binding},payload:{code}});
    // Force inject to execute while a real transaction holds the User fence.
    const pending=Promise.resolve(verification);let waiting=false;
    for(let n=0;n<50;n++) {const q=await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT status FROM users%'");if(q.rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    expect(waiting).toBe(true);
    await fence.query("UPDATE email_auth_methods SET status='revoked',revoked_at=now() WHERE id=$1",[a.methodId]);await fence.query("COMMIT");fence.release();
    const result=await pending;expect(result.statusCode,result.body).toBe(422);expect(result.headers["set-cookie"]).toBeUndefined();
  });
  it("inactive account and session revoked while waiting cannot complete a mailbox change",async()=>{
    const a=await actor(true),p=await current(a),c=await issue(a,"change",{email:`${randomUUID()}@example.test`,proofChallengeId:p.id});
    const fence=await pool.connect();await fence.query("BEGIN");await fence.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[a.userId]);
    const pending=Promise.resolve(verify(a,c,"change"));let waiting=false;
    for(let n=0;n<50;n++) {const q=await pool.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT status FROM users%'");if(q.rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
    expect(waiting).toBe(true);await fence.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[a.sessionId]);await fence.query("COMMIT");fence.release();
    expect((await pending).statusCode).toBe(401);
    const b=await actor();await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[b.userId]);expect((await revoke(b)).statusCode).toBe(401);
  });

});
