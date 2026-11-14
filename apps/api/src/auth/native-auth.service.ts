import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { ActorFenceService } from "../common/actor-fence.service";
import { NativeSessionService } from "./native-session.service";
import { ConsumerAuthService } from "./consumer-auth.service";
import { NATIVE_BINDING_COOKIE, NATIVE_POLICY } from "./constants";
import { readCookie, validateMutationOrigin } from "./cookies";
import { randomToken } from "./crypto";
import { badRequest, conflict, forbidden, problem, unauthorized } from "./problem";
import { nativeBody, nativeString, opaquePattern, s256 } from "./native-auth-security";
import { normalizeReturnPath } from "./return-path";

type Transaction = { id_hash:string;client_id:string;redirect_uri:string;challenge:string;callback_state:string;
  binding_hash:string|null;user_id:string|null;browser_session_id:string|null;code_expires_at:Date|null;
  completed_at:Date|null;consumed_at:Date|null;cancelled_at:Date|null;expires_at:Date };
@Injectable()
export class NativeAuthService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,@Inject(APP_ENV) private readonly env: AppEnv,
    private readonly native: NativeSessionService,private readonly consumer: ConsumerAuthService,private readonly fence: ActorFenceService) {}
  private client(body: Record<string,unknown>) {
    const id = nativeString(body,"clientId",/^[A-Za-z0-9._-]{1,80}$/);
    const client = this.env.NATIVE_AUTH_CLIENTS.find(item=>item.clientId===id);
    if (!client) throw badRequest("INVALID_NATIVE_CLIENT","Клиент не зарегистрирован");
    return client;
  }
  async budget(request: FastifyRequest, operation: string) {
    this.native.enabled();
    // Lazy retention is bounded on every native credential request, including rejected ones.
    await this.pool.query(`DELETE FROM native_auth_transactions WHERE id_hash IN (
      SELECT id_hash FROM native_auth_transactions
      WHERE GREATEST(expires_at,COALESCE(code_expires_at,expires_at))<=now()
      ORDER BY GREATEST(expires_at,COALESCE(code_expires_at,expires_at)) LIMIT 100 FOR UPDATE SKIP LOCKED)`);
    await this.native.cleanupExpired();
    await this.pool.query("DELETE FROM native_auth_budgets WHERE expires_at<=now()");
    for (const [key,limit] of [["global",1000],[request.ip,60]] as const) {
      const hash = this.native.hash(`native:${operation}:${key}`);
      const count = await this.pool.query<{attempts:number}>(`INSERT INTO native_auth_budgets(key_hash,attempts,expires_at)
        VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(key_hash) DO UPDATE SET attempts=native_auth_budgets.attempts+1
        RETURNING attempts`,[hash]);
      if (count.rows[0]!.attempts>limit) throw problem(429,"NATIVE_RATE_LIMIT","Повторите позже",undefined,600);
    }
  }
  private bridge(request: FastifyRequest) {
    if (!validateMutationOrigin(request,this.env.ALLOWED_WEB_ORIGINS) || request.headers["x-native-auth"]!=="1" ||
      !/^application\/json(?:;|$)/i.test(request.headers["content-type"]??"")) throw forbidden("ORIGIN_REJECTED","Недопустимый browser запрос");
    if (request.headers.authorization !== undefined) throw forbidden("CREDENTIALS_CONFLICT","Требуется browser cookie");
  }
  private live(row: Transaction | undefined, handoff = false): Transaction {
    // A grant completed just before transaction expiry retains its full handoff lifetime.
    if (!row || (row.expires_at.getTime()<=Date.now() && !(handoff && row.code_expires_at && row.code_expires_at.getTime()>Date.now())) ||
      row.cancelled_at || row.consumed_at) throw unauthorized("NATIVE_FLOW_EXPIRED","Начните вход из приложения заново");
    return row;
  }
  private bound(row: Transaction, request: FastifyRequest) {
    const nonce=readCookie(request,NATIVE_BINDING_COOKIE);
    if (!nonce || row.binding_hash!==this.native.hash(nonce)) throw forbidden("NATIVE_BROWSER_MISMATCH","Откройте исходный браузер входа");
  }
  async create(raw: unknown) {
    const body=nativeBody(raw), client=this.client(body);
    const redirectUri=nativeString(body,"redirectUri",/^https:\/\//);
    if (!client.redirectUris.includes(redirectUri)) throw badRequest("INVALID_NATIVE_REDIRECT","Redirect не зарегистрирован");
    if (body.codeChallengeMethod!=="S256") throw badRequest("INVALID_NATIVE_CHALLENGE","Требуется S256");
    const challenge=nativeString(body,"codeChallenge",opaquePattern);
    const state=nativeString(body,"state",/^[A-Za-z0-9_-]{16,128}$/);
    if (body.returnPath!==undefined && typeof body.returnPath!=="string") throw badRequest("INVALID_RETURN_PATH","Некорректный путь");
    const returnPath=normalizeReturnPath(body.returnPath as string|undefined);
    if (!returnPath) throw badRequest("INVALID_RETURN_PATH","Некорректный путь");
    const transactionId=randomToken(32), expiresAt=new Date(Date.now()+NATIVE_POLICY.transaction*1000);
    await this.pool.query(`INSERT INTO native_auth_transactions(id_hash,client_id,redirect_uri,challenge,callback_state,return_path,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[this.native.hash(transactionId),client.clientId,redirectUri,challenge,state,returnPath,expiresAt]);
    const url=new URL("/auth/native",this.env.PUBLIC_WEB_ORIGIN);url.searchParams.set("transactionId",transactionId);
    return {transactionId,expiresAt:expiresAt.toISOString(),browserStartUrl:url.toString()};
  }
  async bind(id:string,request:FastifyRequest,reply:FastifyReply) {
    this.bridge(request);
    const existing=readCookie(request,NATIVE_BINDING_COOKIE), nonce=existing??randomToken(32);
    await this.native.transaction(async client=>{
      const row=this.live((await client.query<Transaction>("SELECT * FROM native_auth_transactions WHERE id_hash=$1 FOR UPDATE",[this.native.hash(id)])).rows[0]);
      if (row.completed_at) throw conflict("NATIVE_ALREADY_COMPLETED","Вход уже подтверждён");
      if (row.binding_hash) this.bound(row,request);
      else await client.query("UPDATE native_auth_transactions SET binding_hash=$2 WHERE id_hash=$1",[row.id_hash,this.native.hash(nonce)]);
    });
    (reply as FastifyReply & {setCookie: (name:string,value:string,options:Record<string,unknown>)=>unknown}).setCookie(NATIVE_BINDING_COOKIE,nonce,
      {path:"/",httpOnly:true,secure:this.env.COOKIE_SECURE,sameSite:"lax",maxAge:NATIVE_POLICY.transaction});
    return {ok:true};
  }
  async complete(id:string,request:FastifyRequest) {
    this.bridge(request);
    const actor=await this.consumer.requireCookieMutation(request);
    return this.native.transaction(async client=>{
      await this.fence.assertActiveConsumerInTransaction(client,{actorId:actor.userId,sessionId:actor.sessionId});
      const row=this.live((await client.query<Transaction>("SELECT * FROM native_auth_transactions WHERE id_hash=$1 FOR UPDATE",[this.native.hash(id)])).rows[0]);
      this.bound(row,request);
      if (row.completed_at) throw conflict("NATIVE_ALREADY_COMPLETED","Вход уже подтверждён");
      const code=randomToken(32);
      await client.query(`UPDATE native_auth_transactions SET completed_at=clock_timestamp(),user_id=$2,browser_session_id=$3,
        code_hash=$4,code_expires_at=now()+interval '60 seconds' WHERE id_hash=$1`,[row.id_hash,actor.userId,actor.sessionId,this.native.hash(code)]);
      const callback=new URL(row.redirect_uri);callback.searchParams.set("code",code);callback.searchParams.set("state",row.callback_state);
      return {callbackUrl:callback.toString()};
    });
  }
  async cancel(id:string,request:FastifyRequest) {
    this.bridge(request);
    await this.native.transaction(async client=>{
      const row=this.live((await client.query<Transaction>("SELECT * FROM native_auth_transactions WHERE id_hash=$1 FOR UPDATE",[this.native.hash(id)])).rows[0]);
      this.bound(row,request);
      await client.query("UPDATE native_auth_transactions SET cancelled_at=clock_timestamp() WHERE id_hash=$1",[row.id_hash]);
    });return {ok:true};
  }
  async exchange(raw:unknown) {
    const body=nativeBody(raw), clientConfig=this.client(body);
    const code=nativeString(body,"code",opaquePattern), verifier=nativeString(body,"verifier",/^[A-Za-z0-9._~-]{43,128}$/);
    const redirectUri=nativeString(body,"redirectUri",/^https:\/\//);
    if (!clientConfig.redirectUris.includes(redirectUri)) throw unauthorized();
    return this.native.transaction(async client=>{
      const initial=(await client.query<Transaction>("SELECT * FROM native_auth_transactions WHERE code_hash=$1",[this.native.hash(code)])).rows[0];
      if (!initial?.user_id || !initial.browser_session_id) throw unauthorized();
      await this.fence.assertActiveConsumerInTransaction(client,{actorId:initial.user_id,sessionId:initial.browser_session_id});
      const row=this.live((await client.query<Transaction>("SELECT * FROM native_auth_transactions WHERE code_hash=$1 FOR UPDATE",[this.native.hash(code)])).rows[0],true);
      if (!row.completed_at || !row.code_expires_at || row.code_expires_at.getTime()<=Date.now() || row.client_id!==clientConfig.clientId ||
        row.redirect_uri!==redirectUri || row.challenge!==s256(verifier)) throw unauthorized("INVALID_NATIVE_GRANT");
      await client.query("UPDATE native_auth_transactions SET consumed_at=clock_timestamp() WHERE id_hash=$1",[row.id_hash]);
      return this.native.issue(client,initial.user_id,clientConfig.clientId);
    });
  }
  async refresh(raw:unknown) { const body=nativeBody(raw),client=this.client(body);return this.native.refresh(nativeString(body,"refreshToken",opaquePattern),client.clientId); }
  async logout(raw:unknown,accessToken:string|null) {
    const body=nativeBody(raw), client=this.client(body);
    const refreshToken=body.refreshToken===undefined?undefined:nativeString(body,"refreshToken",opaquePattern);
    return this.native.logout({clientId:client.clientId,refreshToken,accessToken:accessToken??undefined});
  }
}
