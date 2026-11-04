import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SyntheticAuthenticator } from "./admin-webauthn.fixture";
import { AdminModule } from "../../src/admin/admin.module";
import { AdminProviders } from "../../src/admin/admin-providers";
import { AdminService } from "../../src/admin/admin.service";
import { ADMIN_COOKIE } from "../../src/admin/rbac";
import { devQaKeyAllowed, DEV_QA_USER_ID } from "../../src/admin/dev-qa-policy";
import { provisionDevQa, revokeDevQa } from "../../src/admin/dev-qa-ops";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { buildTestCoreModule } from "./test-core.module";
const run=process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin="https://dev.gobadminton.ru";
run("DEV QA key real isolated DB authentication",()=>{
 let app:NestFastifyApplication,pool:Pool,env:AppEnv,key:string,credentialId:string;
 const nonce=()=>randomBytes(32).toString("base64url");
 beforeAll(async()=>{
  Object.assign(process.env,{NODE_ENV:"test",APP_ENV:"local",AUTH_PEPPER:"qa480-consumer-pepper-only-test-000000",PUBLIC_API_ORIGIN:"http://127.0.0.1:18641",PUBLIC_WEB_ORIGIN:"http://127.0.0.1:18642",ALLOWED_WEB_ORIGINS:"http://127.0.0.1:18642"});
  execFileSync("pnpm",["exec","tsx","src/database/migrate.ts"],{cwd:path.resolve(__dirname,"../.."),env:process.env,stdio:"inherit"});
  const base=loadEnv({...process.env,ADMIN_INTERNAL_ENABLED:"1",ADMIN_ORIGIN:"http://localhost:18640",ADMIN_AUTH_PEPPER:"qa480-admin-dedicated-pepper-000000000",CASES_INTERNAL_ENABLED:"1",USER_RESTRICTIONS_INTERNAL_ENABLED:"1",GAME_MODERATION_INTERNAL_ENABLED:"1"});
  env={...base,NODE_ENV:"production",APP_ENV:"mvp",ADMIN_DEV_ENABLED:true,ADMIN_DEV_PATH_ENABLED:true,ADMIN_DEV_QA_KEY_ENABLED:true,ADMIN_DEV_QA_VPS_VERIFIED:true,ADMIN_ORIGIN:origin,PUBLIC_WEB_ORIGIN:origin,PUBLIC_API_ORIGIN:origin,COOKIE_SECURE:true};
  pool=new Pool({connectionString:env.DATABASE_URL,max:5});
  const mod=await Test.createTestingModule({imports:[buildTestCoreModule(base,pool),AdminModule]}).overrideProvider(AdminService).useFactory({factory:(providers:AdminProviders)=>new AdminService(pool,env,providers),inject:[AdminProviders]}).compile();
  app=mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({logger:false}),{logger:false});await app.register(cookie);app.setGlobalPrefix("v1");app.useGlobalFilters(new ProblemExceptionFilter());await app.init();await app.getHttpAdapter().getInstance().ready();
 },120000);
 beforeEach(async()=>{
  env.APP_ENV="mvp";env.ADMIN_DEV_QA_KEY_ENABLED=true;
  await revokeDevQa(pool);await pool.query("DELETE FROM admin_rate_windows");
  key=randomBytes(48).toString("base64url");credentialId=(await provisionDevQa(pool,env,key)).credentialId;
 });
 afterAll(async()=>{await app?.close();await pool?.end();});
 async function login(k=key,n=nonce()) {return app.inject({method:"POST",url:"/v1/admin/auth/dev-qa-key",headers:{origin,"x-csrf-token":n},payload:{key:k,requestNonce:n}});}
 function cookies(response:Awaited<ReturnType<typeof login>>) {return response.cookies.map(c=>c.name+"="+c.value).join("; ");}
 const get=(url:string,cookie:string)=>app.inject({method:"GET",url,headers:{origin,cookie}});
 it("creates actual QA session, exact read-only role, Secure cookie, no WebAuthn or consumer identity",async()=>{
  const res=await login();expect(res.statusCode).toBe(200);const cookie=cookies(res);
  expect(res.cookies.find(c=>c.name===ADMIN_COOKIE)).toMatchObject({httpOnly:true,secure:true,sameSite:"Strict",path:"/"});
  const me=await get("/v1/admin/auth/me",cookie);expect(me.statusCode).toBe(200);expect(me.json().roles).toEqual(["pilot_viewer"]);expect(me.json().authMethod).toBe("dev_qa_key");
  expect((await get("/v1/admin/pilot-metrics",cookie)).statusCode).toBe(200);
  const row=(await pool.query("SELECT * FROM admin_sessions WHERE qa_credential_id=$1",[credentialId])).rows[0];expect(row.credential_id).toBeNull();expect(row.audience).toBe("gobadminton-admin-dev-qa");expect(row.expires_at.getTime()-row.created_at.getTime()).toBeLessThanOrEqual(900000);
  expect((await pool.query("SELECT status FROM users WHERE id=$1",[DEV_QA_USER_ID])).rows[0].status).toBe("disabled");expect((await pool.query("SELECT 1 FROM admin_webauthn_credentials WHERE principal_id=$1",[row.principal_id])).rowCount).toBe(0);
  expect((await pool.query("SELECT 1 FROM external_identities WHERE user_id=$1",[DEV_QA_USER_ID])).rowCount).toBe(0);
 });
 it("denies every unrelated admin read and OAuth/WebAuthn/identity commands",async()=>{
  const res=await login(),cookie=cookies(res),csrf=res.json().csrfToken;
  for(const url of ["/v1/admin/principals","/v1/admin/audit/security","/v1/admin/games","/v1/admin/venues","/v1/admin/cases","/v1/admin/reports"])
   expect((await get(url,cookie)).statusCode,url).toBe(403);
  for(const [url,payload] of [["/v1/admin/auth/vk/start",{}],["/v1/admin/auth/webauthn/options",{purpose:"step_up"}],["/v1/admin/identity/commands",{action:"revoke_sessions",principalId:res.json().principalId,expectedVersion:1,reasonCode:"qa_probe"}]] as const)
   expect((await app.inject({method:"POST",url,headers:{origin,cookie,"x-csrf-token":csrf,"idempotency-key":"qa480-command-test-0000001"},payload})).statusCode,url).toBe(403);
 });
 it("rejects wrong key and exact POST replay; fresh nonce permits second session",async()=>{
  expect((await login(randomBytes(48).toString("base64url"))).statusCode).toBe(401);
  const n=nonce();expect((await login(key,n)).statusCode).toBe(200);expect((await login(key,n)).statusCode).toBe(401);expect((await login()).statusCode).toBe(200);
 });
 it("persists rate limit across authentication failures",async()=>{
  for(let i=0;i<5;i++)expect((await login(randomBytes(48).toString("base64url"))).statusCode).toBe(401);
  expect((await login()).statusCode).toBe(429);
 });
 it("enforces origin/query/CSRF and cannot act as consumer",async()=>{
  const noOrigin=await app.inject({method:"POST",url:"/v1/admin/auth/dev-qa-key",payload:{key,requestNonce:nonce()}});expect(noOrigin.statusCode).toBe(403);
  const query=await app.inject({method:"POST",url:"/v1/admin/auth/dev-qa-key?unexpected=1",headers:{origin},payload:{key,requestNonce:nonce()}});expect(query.statusCode).toBe(400);
  const res=await login(),cookie=cookies(res);
  expect((await get("/v1/me/social-profile",cookie)).statusCode).toBe(401);
  expect((await app.inject({method:"POST",url:"/v1/admin/auth/logout",headers:{origin,cookie,"idempotency-key":"qa480-own-logout-000001"},payload:{}})).statusCode).toBe(403);
  expect((await app.inject({method:"POST",url:"/v1/admin/auth/logout",headers:{origin,cookie,"idempotency-key":"qa480-own-logout-000001","x-csrf-token":res.json().csrfToken},payload:{}})).statusCode).toBe(204);
  expect((await get("/v1/admin/pilot-metrics",cookie)).statusCode).toBe(401);
 });
 it("expiry and flag/PROD changes invalidate existing cookies, dynamically validates roles",async()=>{
  const cookie=cookies(await login());
  env.ADMIN_DEV_QA_KEY_ENABLED=false;expect((await login()).statusCode).toBe(404);expect((await get("/v1/admin/pilot-metrics",cookie)).statusCode).toBe(401);
  env.ADMIN_DEV_QA_KEY_ENABLED=true;env.APP_ENV="prod";expect(devQaKeyAllowed(env)).toBe(false);expect((await login()).statusCode).toBe(404);env.APP_ENV="mvp";
  await pool.query("UPDATE admin_role_grants SET active=false WHERE principal_id=(SELECT principal_id FROM admin_dev_qa_credentials WHERE id=$1)",[credentialId]);expect((await get("/v1/admin/pilot-metrics",cookie)).statusCode).toBe(403);
  await pool.query("UPDATE admin_role_grants SET active=true WHERE role='pilot_viewer'");
  await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) SELECT principal_id,'superadmin','isolated_test' FROM admin_dev_qa_credentials WHERE id=$1",[credentialId]);
  expect((await get("/v1/admin/pilot-metrics",cookie)).statusCode).toBe(403);
  await pool.query("DELETE FROM admin_role_grants WHERE role='superadmin' AND principal_id=(SELECT principal_id FROM admin_dev_qa_credentials WHERE id=$1)",[credentialId]);
  await pool.query("UPDATE admin_dev_qa_credentials SET expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[credentialId]);expect((await get("/v1/admin/pilot-metrics",cookie)).statusCode).toBe(401);
 });
 it("session deadline is enforced independently of still-valid credential",async()=>{
  const cookie=cookies(await login());
  await pool.query("UPDATE admin_sessions SET created_at=clock_timestamp()-interval '16 minutes',expires_at=clock_timestamp()-interval '2 minutes' WHERE qa_credential_id=$1",[credentialId]);
  expect((await get("/v1/admin/pilot-metrics",cookie)).statusCode).toBe(401);
 });
 it("revokes all QA sessions atomically, preserves unrelated WebAuthn rows, idempotent; revoked key never reissues",async()=>{
  const first=cookies(await login()),second=cookies(await login());
  const user=randomUUID();await pool.query("INSERT INTO users(id) VALUES($1)",[user]);
  const principal=(await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",[user])).rows[0].id;
  const auth=new SyntheticAuthenticator();await pool.query("INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",[auth.id,principal,auth.publicKey()]);
  await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'superadmin','isolated_test')",[principal]);
  const normal=randomBytes(32).toString("base64url");await pool.query("INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",[principal,auth.id,hashSecret(env.ADMIN_AUTH_PEPPER!,normal),sealSecret(env.ADMIN_AUTH_PEPPER!,nonce())]);
  expect((await get("/v1/admin/principals",ADMIN_COOKIE+"="+normal)).statusCode).toBe(200);
  const before=(await pool.query("SELECT count(*)::int AS n FROM admin_sessions WHERE auth_method='webauthn' AND revoked_at IS NULL")).rows[0].n;
  expect((await revokeDevQa(pool)).revokedSessions).toBe(2);
  expect((await get("/v1/admin/pilot-metrics",first)).statusCode).toBe(401);expect((await get("/v1/admin/pilot-metrics",second)).statusCode).toBe(401);expect((await login()).statusCode).toBe(401);
  expect((await revokeDevQa(pool)).revokedSessions).toBe(0);expect((await pool.query("SELECT count(*)::int AS n FROM admin_sessions WHERE auth_method='webauthn' AND revoked_at IS NULL")).rows[0].n).toBe(before);
  expect((await get("/v1/admin/principals",ADMIN_COOKIE+"="+normal)).statusCode).toBe(200);
  await expect(provisionDevQa(pool,env,key)).rejects.toThrow("DEV_QA_REVOKED_KEY_NOT_REUSABLE");
  expect(app.get(AdminService)).toBeDefined();
 });
});
