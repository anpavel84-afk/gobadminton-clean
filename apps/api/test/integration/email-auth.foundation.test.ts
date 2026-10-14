import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { deliverEmail, cleanupEmail } from "../../src/auth/email-delivery";
import { EMAIL_BINDING_COOKIE, EMAIL_DELIVERY_QUEUE } from "../../src/auth/email-security";
import { FakeMailTransport } from "../../src/auth/mail-transport";
import { IdentityService } from "../../src/auth/identity.service";
import { SessionService } from "../../src/auth/session.service";
import { type AppEnv, loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { JobEnqueueService } from "../../src/jobs/job-enqueue.service";
import { startWorkerRuntime } from "../../src/jobs/worker-runtime";
import { buildTestCoreModule } from "./test-core.module";

const databaseUrl=process.env.DATABASE_URL ?? "postgres://email_test@127.0.0.1:16472/email_behavior";
const run=process.env.RUN_DB_INTEGRATION==="1" ? describe : describe.skip;
const origin="http://127.0.0.1:3001";
const headers={origin,"x-gb-email-auth":"1"};
type Issued={id:string; binding:string; code:string; email:string};
function cookies(response: {headers: Record<string, unknown>}) {
  const value=response.headers["set-cookie"];
  return Object.fromEntries((Array.isArray(value)?value:value?[value]:[]).map(v=>String(v).split(";")[0]!.split("=")));
}
run("E1 verified email auth, actual PostgreSQL and API",()=>{
  let app:NestFastifyApplication,pool:Pool,env:AppEnv,mail:FakeMailTransport, sessions:SessionService,identities:IdentityService;
  beforeAll(async()=>{
    Object.assign(process.env,{NODE_ENV:"test",APP_ENV:"local",DATABASE_URL:databaseUrl,PUBLIC_API_ORIGIN:"http://127.0.0.1:3000",PUBLIC_WEB_ORIGIN:origin,
      ALLOWED_WEB_ORIGINS:origin+",http://localhost:3001",AUTH_PEPPER:"email-test-session-pepper-32chars!!",EMAIL_AUTH_TRANSPORT:"fake",
      EMAIL_AUTH_HMAC_SECRET:"email-test-hmac-dedicated-32chars!!",EMAIL_AUTH_ENCRYPTION_SECRET:"email-test-encrypt-dedicated-32chars!!",EMAIL_AUTH_RATE_SECRET:"email-test-rate-dedicated-32chars!!",COOKIE_SECURE:"true"});
    execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:process.env,stdio:"inherit"});
    env=loadEnv();pool=createDatabase(databaseUrl).pool;
    const ref=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AuthModule]}).compile();
    mail=ref.get(FakeMailTransport);sessions=ref.get(SessionService);identities=ref.get(IdentityService);
    app=ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async()=>{await pool.query("DELETE FROM email_auth_rate_buckets");});
  afterAll(async()=>{await app?.close();await pool?.end();});
  async function send(id:string,generation=1) {await deliverEmail({pool,env,transport:mail,payload:{challengeId:id,generation}});return mail.read(`${id}:${generation}`)?.code;}
  async function issue(email=`${randomUUID()}@example.test`,binding?:string):Promise<Issued> {
    const r=await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email,returnPath:"/games?intent=join"},cookies:binding?{[EMAIL_BINDING_COOKIE]:binding}:{}});
    expect(r.statusCode,r.body).toBe(202);expect(Object.keys(r.json()).sort()).toEqual(["challengeId","deliveryState","expiresAt","resendAvailableAt"].sort());
    const id=r.json().challengeId as string;return {id,email,binding:cookies(r)[EMAIL_BINDING_COOKIE] ?? binding!,code:(await send(id))!};
  }
  async function verify(c:Issued,code=c.code) {return app.inject({method:"POST",url:`/v1/auth/email/challenges/${c.id}/verify`,headers,payload:{code},cookies:{[EMAIL_BINDING_COOKIE]:c.binding}});}
  async function actor() {
    const r=await pool.query<{id:string}>("INSERT INTO users(display_name) VALUES('Synthetic OAuth') RETURNING id");const userId=r.rows[0]!.id;
    await pool.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject,email) VALUES($1,'vk','e1-test',$2,'metadata@example.test')",[userId,randomUUID()]);
    const issued=await sessions.createConsumerSession(userId);
    return {userId,issued,headers:{...headers,"x-csrf-token":issued.csrfToken},cookies:{[SESSION_COOKIE]:issued.sessionToken}};
  }
  async function link(a:Awaited<ReturnType<typeof actor>>,email:string) {
    const r=await app.inject({method:"POST",url:"/v1/me/auth-methods/email/link/challenges",headers:a.headers,cookies:a.cookies,payload:{email}});expect(r.statusCode,r.body).toBe(202);
    return {id:r.json().challengeId as string,code:(await send(r.json().challengeId))!};
  }
  async function linkVerify(a:Awaited<ReturnType<typeof actor>>,c:{id:string;code:string}) {
    return app.inject({method:"POST",url:`/v1/me/auth-methods/email/link/challenges/${c.id}/verify`,headers:a.headers,cookies:a.cookies,payload:{code:c.code}});
  }
  it("does not create User before proof; atomic signup/session; repeat login same canonical owner",async()=>{
    const email=`${randomUUID()}@example.test`;
    const before=await pool.query<{count:string}>("SELECT count(*)::text AS count FROM users");
    const c=await issue(email.toUpperCase());expect((await pool.query("SELECT count(*)::text AS count FROM users")).rows).toEqual(before.rows);
    const result=await verify(c);expect(result.statusCode,result.body).toBe(200);expect(result.json()).toEqual({authenticated:true,returnPath:"/games?intent=join"});
    expect(String(result.headers["set-cookie"])).toMatch(/HttpOnly/);expect(String(result.headers["set-cookie"])).toMatch(/Secure/);expect(String(result.headers["set-cookie"])).not.toMatch(/Domain=/);
    const token=cookies(result)[SESSION_COOKIE];const me=await app.inject({method:"GET",url:"/v1/me",cookies:{[SESSION_COOKIE]:token}});expect(me.statusCode).toBe(200);
    const next=await issue(email);const nextResult=await verify(next);
    const me2=await app.inject({method:"GET",url:"/v1/me",cookies:{[SESSION_COOKIE]:cookies(nextResult)[SESSION_COOKIE]}});expect(me2.json().id).toBe(me.json().id);
    const replay=await verify(c);expect(replay.statusCode).toBe(422);
    const row=(await pool.query("SELECT state,code_ciphertext FROM email_auth_challenges WHERE id=$1",[c.id])).rows[0];expect(row).toEqual({state:"consumed",code_ciphertext:null});
  });
  it("anonymous issue is existence safe for fresh, existing, disabled email",async()=>{
    const first=await issue();await verify(first);
    const own=(await pool.query<{user_id:string}>("SELECT user_id FROM email_auth_methods WHERE email_canonical=$1",[first.email])).rows[0]!;
    const existing=await issue(first.email);await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[own.user_id]);
    const blocked=await issue(first.email);const fresh=await issue();
    for(const c of [existing,blocked,fresh]) {
      const r=await app.inject({method:"GET",url:`/v1/auth/email/challenges/${c.id}`,headers:{origin},cookies:{[EMAIL_BINDING_COOKIE]:c.binding}});
      expect(Object.keys(r.json()).sort()).toEqual(["challengeId","deliveryState","expiresAt","resendAvailableAt"].sort());expect(r.json().deliveryState).toBe("sent");
    }
    const result=await verify(blocked);expect(result.statusCode).toBe(403);expect(result.json().code).toBe("ACCOUNT_UNAVAILABLE");expect(cookies(result)[SESSION_COOKIE]).toBeUndefined();
  });
  it("parallel correct verification consumes once and issues one session",async()=>{
    const c=await issue();const results=await Promise.all([verify(c),verify(c),verify(c)]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,422,422]);
    const n=await pool.query<{count:string}>("SELECT count(*)::text AS count FROM app_sessions s JOIN email_auth_methods e ON s.user_id=e.user_id WHERE e.email_canonical=$1",[c.email]);expect(n.rows[0]!.count).toBe("1");
  });
  it("two browser challenges for same mailbox create only one User and credential",async()=>{
    const email=`${randomUUID()}@example.test`;const [a,b]=await Promise.all([issue(email),issue(email)]);
    const results=await Promise.all([verify(a),verify(b)]);expect(results.map(r=>r.statusCode)).toEqual([200,200]);
    expect((await pool.query("SELECT user_id FROM email_auth_methods WHERE email_canonical=$1 AND status='active'",[email])).rows).toHaveLength(1);
  });
  it("wrong attempts commit atomically, fifth locks, resend cannot reset",async()=>{
    const c=await issue();const wrong=c.code==="00000000"?"99999999":"00000000";
    const results=await Promise.all(Array.from({length:5},()=>verify(c,wrong)));expect(results.map(r=>r.statusCode).sort()).toEqual([422,422,422,422,429]);
    const row=(await pool.query("SELECT verify_attempts,state,code_ciphertext FROM email_auth_challenges WHERE id=$1",[c.id])).rows[0];expect(row).toEqual({verify_attempts:5,state:"locked",code_ciphertext:null});
    expect((await verify(c)).statusCode).toBe(429);
    const resend=await app.inject({method:"POST",url:`/v1/auth/email/challenges/${c.id}/resend`,headers,payload:{},cookies:{[EMAIL_BINDING_COOKIE]:c.binding}});expect(resend.statusCode).toBe(422);
  });
  it("Origin, custom header, cookie, purpose and malformed paths fail closed",async()=>{
    const c=await issue();
    for(const h of [{...headers,origin:"https://evil.test"},{...headers,origin:"http://localhost:3001"},{origin}]) {
      const r=await app.inject({method:"POST",url:`/v1/auth/email/challenges/${c.id}/verify`,headers:h,payload:{code:c.code},cookies:{[EMAIL_BINDING_COOKIE]:c.binding}});expect(r.statusCode).toBe(403);
    }
    const wrong=await app.inject({method:"POST",url:`/v1/auth/email/challenges/${c.id}/verify`,headers,payload:{code:c.code},cookies:{[EMAIL_BINDING_COOKIE]:'X'.repeat(43)}});expect(wrong.statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:`/v1/auth/email/challenges/${c.id}`,headers:{origin}})).statusCode).toBe(403);
    for(const returnPath of ["//evil.test","https://evil.test",123]) expect((await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email:c.email,returnPath}})).statusCode).toBe(422);
    const malformed=await verify(c,"123");expect(malformed.statusCode).toBe(422);
    expect((await verify(c)).statusCode).toBe(200);
  });
  it("expired, superseded and rotated generations reject previous codes; cooldown and resend race",async()=>{
    const c=await issue();const resend=()=>app.inject({method:"POST",url:`/v1/auth/email/challenges/${c.id}/resend`,headers,payload:{},cookies:{[EMAIL_BINDING_COOKIE]:c.binding}});
    expect((await resend()).statusCode).toBe(429);
    await pool.query("UPDATE email_auth_challenges SET resend_after=now()-interval '1 second' WHERE id=$1",[c.id]);
    const results=await Promise.all([resend(),resend()]);expect(results.map(r=>r.statusCode).sort()).toEqual([202,429]);
    expect((await verify(c)).statusCode).toBe(422);expect(await send(c.id,1)).toBe(c.code);
    const code=(await send(c.id,2))!;expect((await verify({...c,code})).statusCode).toBe(200);
    const expired=await issue();await pool.query("UPDATE email_auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);expect((await verify(expired)).statusCode).toBe(422);
    const old=await issue();await pool.query("UPDATE email_auth_challenges SET resend_after=now()-interval '1 second' WHERE id=$1",[old.id]);const newer=await issue(old.email,old.binding);expect((await verify(old)).statusCode).toBe(422);expect((await verify(newer)).statusCode).toBe(200);
  });
  it("link requires CSRF, fresh and exact bound session; collision consumes without merge",async()=>{
    const a=await actor();const c=await link(a,`${randomUUID()}@example.test`);
    const noCsrf=await app.inject({method:"POST",url:`/v1/me/auth-methods/email/link/challenges/${c.id}/verify`,headers,cookies:a.cookies,payload:{code:c.code}});expect(noCsrf.statusCode).toBe(403);
    const other=await sessions.createConsumerSession(a.userId);expect((await linkVerify({...a,issued:other,cookies:{[SESSION_COOKIE]:other.sessionToken},headers:{...headers,"x-csrf-token":other.csrfToken}},c)).statusCode).toBe(403);
    const purpose=await app.inject({method:"POST",url:`/v1/auth/email/challenges/${c.id}/verify`,headers,payload:{code:c.code},cookies:{[EMAIL_BINDING_COOKIE]:'X'.repeat(43)}});expect(purpose.statusCode).toBe(403);
    expect((await linkVerify(a,c)).statusCode).toBe(200);
    const inv=await app.inject({method:"GET",url:"/v1/me/auth-methods",cookies:a.cookies});expect(inv.json().items.map((v:{method:string})=>v.method)).toEqual(["vk","email"]);expect(inv.body).not.toContain(c.code);
    await pool.query("UPDATE app_sessions SET authenticated_at=now()-interval '16 minutes' WHERE id=$1",[a.issued.session.id]);
    const stale=await app.inject({method:"POST",url:"/v1/me/auth-methods/email/link/challenges",headers:a.headers,cookies:a.cookies,payload:{email:`${randomUUID()}@example.test`}});expect(stale.statusCode).toBe(403);
    const b=await actor();const owned=(await pool.query<{email_canonical:string}>("SELECT email_canonical FROM email_auth_methods WHERE user_id=$1",[a.userId])).rows[0]!.email_canonical;
    const collision=await link(b,owned);const result=await linkVerify(b,collision);expect(result.statusCode).toBe(409);expect(result.json().code).toBe("EMAIL_ALREADY_LINKED");
    expect((await pool.query("SELECT user_id FROM email_auth_methods WHERE email_canonical=$1",[owned])).rows[0]!.user_id).toBe(a.userId);
  });
  it("revoked session/user deletion and session revocation during link cannot grant authority",async()=>{
    const a=await actor(),c=await link(a,`${randomUUID()}@example.test`);await sessions.revokeSession(a.issued.session.id);expect((await linkVerify(a,c)).statusCode).toBe(401);
    const fresh=await issue();await verify(fresh);await pool.query("UPDATE users SET status='deletion_pending' WHERE id=(SELECT user_id FROM email_auth_methods WHERE email_canonical=$1)",[fresh.email]);const blocked=await issue(fresh.email);expect((await verify(blocked)).statusCode).toBe(403);
    const b=await actor(),d=await link(b,`${randomUUID()}@example.test`);
    const client=await pool.connect();await client.query("BEGIN");await client.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1",[b.issued.session.id]);
    const pending=linkVerify(b,d);await new Promise(resolve=>setTimeout(resolve,100));await client.query("COMMIT");client.release();expect((await pending).statusCode).toBe(401);
  });
  it("last OAuth unlink counts email, and removal races preserve one method",async()=>{
    const a=await actor();expect((await app.inject({method:"DELETE",url:"/v1/me/linked-providers/vk",headers:{...a.headers,"idempotency-key":randomUUID()},cookies:a.cookies})).statusCode).toBe(409);
    const c=await link(a,`${randomUUID()}@example.test`);await linkVerify(a,c);
    expect((await app.inject({method:"DELETE",url:"/v1/me/linked-providers/vk",headers:{...a.headers,"idempotency-key":randomUUID()},cookies:a.cookies})).statusCode).toBe(200);
    const b=await actor();await pool.query("INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject) VALUES($1,'yandex','e1-test',$2)",[b.userId,randomUUID()]);
    const results=await Promise.all(['vk','yandex'].map(provider=>app.inject({method:"DELETE",url:`/v1/me/linked-providers/${provider}`,headers:{...b.headers,"idempotency-key":randomUUID()},cookies:b.cookies})));expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
  });
  it("OAuth metadata email never auto-links and explicit OAuth can link to an email User",async()=>{
    const metadataOwner=await actor();const metadataEmail=`${randomUUID()}@example.test`;
    await pool.query("UPDATE external_identities SET email=$2 WHERE user_id=$1",[metadataOwner.userId,metadataEmail]);
    const c=await issue(metadataEmail);const r=await verify(c);const me=await app.inject({method:"GET",url:"/v1/me",cookies:{[SESSION_COOKIE]:cookies(r)[SESSION_COOKIE]}});
    expect(me.json().id).not.toBe(metadataOwner.userId);
    expect((await pool.query("SELECT id FROM external_identities WHERE user_id=$1",[me.json().id])).rows).toHaveLength(0);
    await identities.linkIdentityToUser(me.json().id,{provider:"yandex",issuerNamespace:"e1-explicit",subject:randomUUID(),email:"metadata@example.test"});
    expect((await identities.listLinkedProviders(me.json().id))).toEqual(["yandex"]);
  });
  it("concurrent mailbox links have one owner; verify/resend race has one authoritative result",async()=>{
    const a=await actor(), b=await actor(),email=`${randomUUID()}@example.test`;
    const [ca,cb]=await Promise.all([link(a,email),link(b,email)]);
    const linked=await Promise.all([linkVerify(a,ca),linkVerify(b,cb)]);expect(linked.map(r=>r.statusCode).sort()).toEqual([200,409]);
    expect((await pool.query("SELECT user_id FROM email_auth_methods WHERE email_canonical=$1",[email])).rows).toHaveLength(1);
    const c=await issue();await pool.query("UPDATE email_auth_challenges SET resend_after=now()-interval '1 second' WHERE id=$1",[c.id]);
    const result=await Promise.all([verify(c),app.inject({method:'POST',url:`/v1/auth/email/challenges/${c.id}/resend`,headers,payload:{},cookies:{[EMAIL_BINDING_COOKIE]:c.binding}})]);
    expect([[200,422],[422,202]]).toContainEqual(result.map(r=>r.statusCode));
  });
  it("DB shared email/IP/global budgets apply across replicas and have no raw keys",async()=>{
    // Earlier scenarios intentionally share one test IP; clear synthetic buckets only for this isolated budget case.
    await pool.query("DELETE FROM email_auth_rate_buckets");
    const email=`${randomUUID()}@example.test`;
    for(let i=0;i<5;i++) await issue(email);
    const replicaRef=await Test.createTestingModule({imports:[buildTestCoreModule(env,pool),AuthModule]}).compile();
    const replica=replicaRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}));
    await replica.register(cookie);replica.setGlobalPrefix('v1');replica.useGlobalFilters(new ProblemExceptionFilter());await replica.init();await replica.getHttpAdapter().getInstance().ready();
    try {
      const denied=await replica.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email}});expect(denied.statusCode).toBe(429);expect(denied.headers['retry-after']).toBeTruthy();
    } finally {await replica.close();}
    expect((await pool.query("SELECT key_hash FROM email_auth_rate_buckets")).rows.every((r:{key_hash:string})=>/^[a-f0-9]{64}$/.test(r.key_hash))).toBe(true);
    await pool.query("DELETE FROM email_auth_rate_buckets");
    for(let i=0;i<20;i++) await issue();
    expect((await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email:`${randomUUID()}@example.test`}})).statusCode).toBe(429);
    await pool.query("DELETE FROM email_auth_rate_buckets");
    const key=(await import("../../src/auth/crypto")).hmacSha256Hex(env.EMAIL_AUTH_RATE_SECRET!,"global");
    await pool.query("INSERT INTO email_auth_rate_buckets VALUES($1,'global_hour',date_trunc('hour',now()),$2,now()+interval '1 hour')",[key,env.EMAIL_AUTH_GLOBAL_HOURLY_BUDGET]);
    expect((await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email:`${randomUUID()}@example.test`}})).statusCode).toBe(429);
    await pool.query("DELETE FROM email_auth_rate_buckets");
  });
  it("delivery retries same generation, wipes ciphertext, permanent failure/cleanup are safe",async()=>{
    const r=await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email:`${randomUUID()}@example.test`}});expect(r.statusCode).toBe(202);const id=r.json().challengeId as string;
    mail.failNext(`${id}:1`,["temporary"]);await expect(send(id)).rejects.toThrow("TEMPORARY");
    expect((await pool.query("SELECT code_ciphertext FROM email_auth_challenges WHERE id=$1",[id])).rows[0]!.code_ciphertext).toBeTruthy();
    const code=await send(id);expect(code).toMatch(/^\d{8}$/);expect((await pool.query("SELECT code_ciphertext FROM email_auth_challenges WHERE id=$1",[id])).rows[0]!.code_ciphertext).toBeNull();
    const fail=await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email:`${randomUUID()}@example.test`}});const fid=fail.json().challengeId as string;
    mail.failNext(`${fid}:1`,["permanent"]);await send(fid);expect((await pool.query("SELECT state,code_ciphertext FROM email_auth_challenges WHERE id=$1",[fid])).rows[0]).toEqual({state:"delivery_failed",code_ciphertext:null});
    const exp=await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email:`${randomUUID()}@example.test`}});const eid=exp.json().challengeId as string;
    await pool.query("UPDATE email_auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[eid]);await cleanupEmail(pool);expect(await send(eid)).toBeUndefined();
    const jobs=await pool.query<{data:Record<string,unknown>}>("SELECT data FROM pgboss.job WHERE name=$1",[EMAIL_DELIVERY_QUEUE]);expect(jobs.rows.length).toBeGreaterThan(0);expect(jobs.rows.every(row=>Object.keys(row.data).sort().join(',')==='challengeId,generation')).toBe(true);
    expect((await pool.query("SELECT * FROM email_auth_delivery_attempts WHERE challenge_id=$1 ORDER BY attempt_no",[id])).rows.map(row=>row.state)).toEqual(["temporary_failure","sent"]);
  });
  it("actual sends including retries are capped across workers, exhausted budget fails safely",async()=>{
    const ids:string[]=[];
    for(let i=0;i<2;i++) {
      const r=await app.inject({method:'POST',url:'/v1/auth/email/challenges',headers,payload:{email:`${randomUUID()}@example.test`}});
      expect(r.statusCode).toBe(202);ids.push(r.json().challengeId as string);
    }
    const restricted={...env,EMAIL_AUTH_GLOBAL_HOURLY_BUDGET:1};
    await Promise.all(ids.map(challengeId=>deliverEmail({pool,env:restricted,transport:mail,payload:{challengeId,generation:1}})));
    const rows=(await pool.query("SELECT state,code_ciphertext FROM email_auth_challenges WHERE id=ANY($1::uuid[]) ORDER BY state",[ids])).rows;
    expect(rows).toEqual([{state:'delivery_failed',code_ciphertext:null},{state:'sent',code_ciphertext:null}]);
    expect(ids.filter(id=>mail.read(`${id}:1`))).toHaveLength(1);
  });
  it("session insertion failure rolls back User/method/consume, queue failure rolls back issue and budgets",async()=>{
    const c=await issue();const before=(await pool.query("SELECT count(*)::text AS n FROM users")).rows;
    await pool.query("CREATE FUNCTION e1_fail_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic session failure'; END $$; CREATE TRIGGER e1_fail_session BEFORE INSERT ON app_sessions FOR EACH ROW EXECUTE FUNCTION e1_fail_session()");
    try {expect((await verify(c)).statusCode).toBe(500);} finally {await pool.query("DROP TRIGGER e1_fail_session ON app_sessions; DROP FUNCTION e1_fail_session()");}
    expect((await pool.query("SELECT count(*)::text AS n FROM users")).rows).toEqual(before);
    expect((await pool.query("SELECT state FROM email_auth_challenges WHERE id=$1",[c.id])).rows[0]!.state).toBe('sent');
    expect((await verify(c)).statusCode).toBe(200);
    const jobs=app.get(JobEnqueueService).getBoss();const spy=vi.spyOn(jobs,'send').mockRejectedValueOnce(new Error('synthetic queue failure'));
    const email=`${randomUUID()}@example.test`;
    try {expect((await app.inject({method:'POST',url:'/v1/auth/email/challenges',headers,payload:{email}})).statusCode).toBe(500);} finally {spy.mockRestore();}
    expect((await pool.query("SELECT id FROM email_auth_challenges WHERE email_canonical=$1",[email])).rows).toHaveLength(0);
  });
  it("real pg-boss worker delivers durable job without exposing mailbox API",async()=>{
    await pool.query("DELETE FROM email_auth_rate_buckets");
    const r=await app.inject({method:"POST",url:"/v1/auth/email/challenges",headers,payload:{email:`${randomUUID()}@example.test`}});const id=r.json().challengeId as string;
    mail.failNext(`${id}:1`,["temporary"]);
    const runtime=await startWorkerRuntime({connectionString:databaseUrl,pool,gitSha:"synthetic-e1",email:{env,transport:mail}});
    try {
      const until=Date.now()+30000;
      // Fake transport observation precedes the worker transaction COMMIT.
      while(Date.now()<until) {
        const committed=await pool.query("SELECT 1 FROM email_auth_challenges c WHERE c.id=$1 AND c.state='sent' AND c.code_ciphertext IS NULL AND EXISTS(SELECT 1 FROM email_auth_delivery_attempts a WHERE a.challenge_id=c.id AND a.state='sent')",[id]);
        if(committed.rowCount) break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(mail.read(`${id}:1`)?.code).toMatch(/^\d{8}$/);
      expect((await pool.query("SELECT state FROM email_auth_delivery_attempts WHERE challenge_id=$1 ORDER BY attempt_no",[id])).rows.map(r=>r.state)).toEqual(['temporary_failure','sent']);
      expect((await app.inject({method:"GET",url:`/v1/auth/email/mailbox/${id}`})).statusCode).toBe(404);
    } finally {await runtime.stop();}
  });
});
