import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { loadEnv } from "../../src/config/env";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type { AuthProviderAdapter } from "../../src/auth/providers/types";
import { SessionService } from "../../src/auth/session.service";
import { GamesModule } from "../../src/games/games.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";

import { NATIVE_BINDING_COOKIE } from "../../src/auth/constants";
import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { GameChatModule } from "../../src/game-chat/game-chat.module";
import { InvitationsModule } from "../../src/invitations/invitations.module";
import { InboxModule } from "../../src/inbox/inbox.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";

// Dedicated loopback admin only. Never falls back to DATABASE_URL or a DEV database.
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("native Messages · self-migrating isolated database", () => {
  let app: NestFastifyApplication, disabledApp: NestFastifyApplication;
  let pool: Pool, admin: Pool, databaseName: string;
  const origin = "https://localhost:3001", clientId = "native.messages.fixture", redirectUri = "https://app.example.test/auth/callback";
  const env = loadEnv({ NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:15432/postgres",
    PUBLIC_API_ORIGIN: "https://localhost:3000", PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true", VK_CLIENT_ID: "vk-fixture", VK_CLIENT_SECRET: "vk-fixture-secret", VK_REDIRECT_URI: "https://localhost:3000/v1/auth/vk/callback",
    AUTH_PEPPER: "native-messages-dedicated-synthetic-pepper-32chars", NATIVE_AUTH_ENABLED: "1",
    SOCIAL_DIRECTORY_ENABLED: "1", SOCIAL_DM_ENABLED: "1", SOCIAL_INVITATIONS_ENABLED: "1", SOCIAL_GAME_CHAT_ENABLED: "1", SOCIAL_INBOX_ENABLED: "1",
    CONTENT_MODERATION_PROVIDER: "fake", CONTENT_MODERATION_FINGERPRINT_SECRET: "native-messages-dedicated-synthetic-fingerprint-only",
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId, redirectUris: [redirectUri] }]) });
  const fake: AuthProviderAdapter = { key: "vk", configured: true,
    async startAuthorization(input) { return { authorizationUrl: `https://provider.test/authorize?state=${input.state}` }; },
    async exchangeCode() { return { accessToken: "synthetic-provider-access" }; },
    async fetchVerifiedIdentity() { return { provider: "vk", issuerNamespace: "vkid:app:native-messages-fixture", subject: randomUUID(), displayName: "Fixture" }; },
  };
  async function build(enabled: boolean) {
    const module = await Test.createTestingModule({ imports: [buildTestCoreModule({ ...env, NATIVE_AUTH_ENABLED: enabled }, pool), AuthModule,
      OrganizersModule, VenuesModule, TrainersModule, GamesModule, ParticipationsModule, ProfilesModule, SafetyModule,
      MessagingModule, GameChatModule, InvitationsModule, InboxModule] }).overrideProvider(AUTH_PROVIDER_OVERRIDES).useValue([fake]).compile();
    const instance = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await instance.register(cookie); instance.setGlobalPrefix("v1"); instance.useGlobalFilters(new ProblemExceptionFilter());
    await instance.init(); await instance.getHttpAdapter().getInstance().ready(); return instance;
  }
  beforeAll(async () => {
    const raw = process.env.NATIVE_MESSAGES_TEST_DATABASE_URL;
    if (!raw) throw Error("Set NATIVE_MESSAGES_TEST_DATABASE_URL to dedicated loopback disposable PostgreSQL admin /postgres");
    const url = new URL(raw);
    if (!["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.pathname !== "/postgres") throw Error("Isolated fixture requires loopback admin /postgres");
    admin = new Pool({ connectionString: url.href }); databaseName = "native_messages_" + randomUUID().replaceAll("-", "");
    await admin.query("CREATE DATABASE " + databaseName); url.pathname = "/" + databaseName; env.DATABASE_URL = url.href;
    pool = new Pool({ connectionString: env.DATABASE_URL });
    const migrations = path.resolve(__dirname,"../../migrations"), client = await pool.connect();
    try {
      await client.query("CREATE TABLE schema_migrations(id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      for (const file of (await readdir(migrations)).filter(f => f.endsWith(".sql")).sort()) {
        await client.query("BEGIN");
        try { await client.query(await readFile(path.join(migrations,file),"utf8")); await client.query("INSERT INTO schema_migrations(id) VALUES($1)",[file.replace(/\.sql$/,"")]); await client.query("COMMIT"); }
        catch (e) { await client.query("ROLLBACK"); throw e; }
      }
      expect((await client.query("SELECT to_regclass('native_refresh_tokens')::text AS name")).rows[0].name).toBe("native_refresh_tokens");
    } finally { client.release(); }
    app = await build(true); disabledApp = await build(false);
  },120_000);
  afterAll(async () => {
    try {
      const appClosures = await Promise.allSettled([disabledApp?.close(), app?.close()]);
      const poolClosure = await Promise.allSettled([pool?.end()]);
      const closeErrors = [...appClosures, ...poolClosure].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (closeErrors.length) throw new AggregateError(closeErrors, "Native Messages fixture graceful cleanup failed");
      if (admin && databaseName) {
        if (!/^native_messages_[a-f0-9]{32}$/.test(databaseName)) throw Error("Refusing cleanup of an unowned fixture database");
        // Pool shutdown can finish before PostgreSQL observes every socket disconnect.
        const drainTimeoutMs = 5_000, deadline = Date.now() + drainTimeoutMs;
        let remainingConnections: number | undefined;
        while (true) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) throw Error(`Native Messages fixture cleanup leak: ${remainingConnections} connections remain in ${databaseName} after ${drainTimeoutMs}ms; database was not dropped`);
          const activity = await admin.query<{ count: number }>({
            text: "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1",
            values: [databaseName],
            query_timeout: remainingMs,
          });
          remainingConnections = activity.rows[0]!.count;
          if (remainingConnections === 0) break;
          await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
        }
        await admin.query("DROP DATABASE " + databaseName);
        expect((await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName])).rowCount).toBe(0);
      }
    } finally { await admin?.end(); }
  },45_000);
  const cookies = (header: string | string[] | undefined) => (Array.isArray(header) ? header : header ? [header] : []).map(v => v.split(";")[0]).join("; ");
  async function actor() {
    const start = await app.inject({ url: "/v1/auth/vk/start?returnPath=/messages" }); expect(start.statusCode).toBe(200);
    const state = new URL(start.json().authorizationUrl).searchParams.get("state")!;
    const callback = await app.inject({ url: `/v1/auth/vk/callback?code=fixture&device_id=fixture&state=${encodeURIComponent(state)}`, headers: { cookie: cookies(start.headers["set-cookie"]) } }); expect(callback.statusCode).toBe(302);
    const browserCookie = cookies(callback.headers["set-cookie"]), me = await app.inject({ url: "/v1/me", headers: { cookie: browserCookie } }); expect(me.statusCode).toBe(200);
    const id = me.json().id as string, csrfToken = me.json().csrfToken as string;
    const verifier = "v".repeat(43), callbackState = "s".repeat(43);
    const tx = await app.inject({ method: "POST",url: "/v1/auth/native/transactions",payload: { clientId,redirectUri,codeChallenge:createHash("sha256").update(verifier).digest("base64url"),codeChallengeMethod:"S256",state:callbackState,returnPath:"/messages" } }); expect(tx.statusCode).toBe(200);
    const txPath = `/v1/auth/native/transactions/${tx.json().transactionId}`;
    const binding = await app.inject({ method:"POST",url:txPath+"/bind",headers:{ origin,"x-native-auth":"1" },payload:{} }); expect(binding.statusCode).toBe(200);
    const nonce = cookies(binding.headers["set-cookie"]).split("; ").find(c => c.startsWith(NATIVE_BINDING_COOKIE+"="))!;
    const headers = { origin,"x-native-auth":"1",cookie:`${browserCookie}; ${nonce}`,"x-csrf-token":csrfToken };
    expect((await app.inject({ method:"POST",url:txPath+"/bind",headers,payload:{} })).statusCode).toBe(200);
    const complete = await app.inject({ method:"POST",url:txPath+"/complete",headers,payload:{} }); expect(complete.statusCode).toBe(200);
    const code = new URL(complete.json().callbackUrl).searchParams.get("code");
    const exchange = await app.inject({ method:"POST",url:"/v1/auth/native/exchange",payload:{clientId,redirectUri,code,verifier} }); expect(exchange.statusCode).toBe(200);
    return { id,csrfToken,cookie:browserCookie,...exchange.json() as {accessToken:string;refreshToken:string;sessionId:string} };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const browser = (a: Actor, key = randomUUID()) => ({ origin, cookie: a.cookie, "x-csrf-token": a.csrfToken, "idempotency-key": key });
  const bearer = (a: Actor, key = randomUUID()) => ({ authorization: `Bearer ${a.accessToken}`, "idempotency-key": key });
  async function game(owner: Actor, capacity = 2, options: { draft?: boolean; visibility?: "public" | "unlisted" } = {}) {
    const venue = await app.inject({ method: "POST", url: "/v1/venues", headers: browser(owner), payload: {
      cityId: MOSCOW_CITY_ID, name: "Native fixture", address: "Fixture", timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62,
    } }); expect([200, 201]).toContain(venue.statusCode);
    const starts = new Date(Date.now() + 7 * 86400000);
    const draft = await app.inject({ method: "POST", url: "/v1/games", headers: browser(owner), payload: {
      venueId: venue.json().id, hostDisplayName: "Fixture host", hostPublicContact: "telegram:@fixture", title: "Native fixture",
      startsAt: starts.toISOString(), endsAt: new Date(+starts + 7200000).toISOString(), applicationDeadlineAt: new Date(+starts - 86400000).toISOString(),
      timezone: "Europe/Moscow", capacity, externalReservedCount: 0, visibility: options.visibility ?? "public", formatKey: "doubles", activityKind: "regular",
      levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0", "3.5"] },
      settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "Outside app" },
    } }); expect(draft.statusCode).toBe(201);
    const id = draft.json().id as string;
    if (options.draft) return draft.json() as { id: string; version: number };
    const seat = (await pool.query("SELECT id FROM participations WHERE game_id=$1 AND user_id=$2", [id, owner.id])).rows[0].id;
    expect((await app.inject({ method: "POST", url: `/v1/participations/${seat}/withdraw`, headers: browser(owner), payload: { expectedVersion: 1 } })).statusCode).toBe(200);
    const published = await app.inject({ method: "POST", url: `/v1/games/${id}/publish`, headers: browser(owner), payload: { expectedVersion: draft.json().version + 1 } });
    expect(published.statusCode).toBe(200); return published.json() as { id: string; version: number };
  }
  async function profile(a: Actor) {
    const current = await app.inject({ url: '/v1/me/social-profile', headers: bearer(a) }); expect(current.statusCode).toBe(200);
    const patched = await app.inject({ method:'PATCH',url:'/v1/me/social-profile',headers:browser(a),payload:{expectedVersion:current.json().version,displayName:'Fixture '+randomUUID().slice(0,8),cityId:MOSCOW_CITY_ID,areaKey:'sokol',bio:'Synthetic Messages fixture',contactPolicy:'requests',socialEligible:true} }); expect(patched.statusCode).toBe(200);
    const visible = await app.inject({ method:'PUT',url:'/v1/me/social-profile/visibility',headers:browser(a),payload:{directoryVisible:true,consentPolicyVersion:'directory-mvp-v1',expectedVersion:patched.json().version} }); expect(visible.statusCode).toBe(200);
    return visible.json() as {publicPlayerId:string;version:number};
  }
  async function invite(owner: Actor, target: string, g: {id:string;version:number}) {
    const r = await app.inject({method:'POST',url:`/v1/games/${g.id}/invitations`,headers:browser(owner),payload:{inviteePublicPlayerId:target,expectedGameVersion:g.version}}); expect(r.statusCode).toBe(201); return r.json() as {id:string;version:number};
  }
  async function direct(owner: Actor, target: string) {
    const r = await app.inject({method:'POST',url:'/v1/conversations/requests',headers:browser(owner),payload:{targetPublicPlayerId:target,text:'Hello fixture',clientMessageId:randomUUID()}}); expect(r.statusCode).toBe(201); return r.json().conversation as {id:string;version:number};
  }
  it('real HTTP issuance + unlisted recipient read context, current versions, capacity, idempotency and unrelated 404', async () => {
    const owner=await actor(), player=await actor(), outsider=await actor();
    await profile(owner); const p=await profile(player); await profile(outsider);
    expect(p.publicPlayerId).not.toBe(player.id);
    const g=await game(owner,1,{visibility:'unlisted'}), invitation=await invite(owner,p.publicPlayerId,g), url=`/v1/invitations/${invitation.id}`;
    expect((await pool.query('SELECT 1 FROM participations WHERE game_id=$1 AND user_id=$2',[g.id,player.id])).rowCount).toBe(0);
    for (const headers of [{},bearer(player),bearer(outsider)]) expect((await app.inject({url:`/v1/games/${g.id}`,headers})).statusCode).toBe(404);
    expect((await app.inject({url,headers:bearer(outsider)})).statusCode).toBe(404);
    const cookieDetail=await app.inject({url,headers:{cookie:player.cookie}}); expect(cookieDetail.statusCode).toBe(200);
    expect(Object.keys(cookieDetail.json()).sort()).toEqual([
      'id','gameId','status','version','inviterPublicPlayerId','inviteePublicPlayerId','expiresAt','decidedAt','participationId','createdAt',
    ].sort());
    expect(cookieDetail.json()).not.toHaveProperty('acceptanceContext');
    const detail=await app.inject({url,headers:bearer(player)}); expect(detail.statusCode).toBe(200);
    expect(detail.json().acceptanceContext).toMatchObject({gameVersion:g.version,title:'Native fixture',availablePlaces:1,settlementTerms:'Outside app'});
    expect((await app.inject({url,headers:bearer(owner)})).json().acceptanceContext).toBeNull();
    const key=randomUUID(), payload={expectedVersion:detail.json().version,expectedGameVersion:detail.json().acceptanceContext.gameVersion};
    expect((await app.inject({method:'POST',url:url+'/accept',headers:bearer(player),payload:{...payload,expectedGameVersion:g.version-1}})).statusCode).toBe(409);
    const accepted=await app.inject({method:'POST',url:url+'/accept',headers:bearer(player,key),payload}); expect(accepted.statusCode).toBe(200); expect(accepted.json().participation.status).toBe('confirmed');
    expect((await app.inject({method:'POST',url:url+'/accept',headers:bearer(player,key),payload})).json()).toEqual(accepted.json());
    expect((await app.inject({method:'POST',url:url+'/accept',headers:bearer(player,key),payload:{...payload,expectedVersion:payload.expectedVersion+1}})).statusCode).toBe(409);
    expect((await app.inject({url:`/v1/games/${g.id}`,headers:bearer(player)})).statusCode).toBe(200);
    expect((await app.inject({url:`/v1/games/${g.id}`,headers:bearer(outsider)})).statusCode).toBe(404);
    const g2=await game(owner,1,{visibility:'unlisted'}), inv2=await invite(owner,p.publicPlayerId,g2);
    // Real current capacity changes after invitation, under the ordinary participant mutation path.
    const current=await app.inject({url:`/v1/games/${g2.id}`,headers:bearer(owner)});
    const apply=await app.inject({method:'POST',url:`/v1/games/${g2.id}/participations`,headers:bearer(outsider),payload:{expectedGameVersion:current.json().version}}); expect(apply.statusCode).toBe(201);
    expect((await app.inject({method:'POST',url:`/v1/participations/${apply.json().id}/confirm`,headers:browser(owner),payload:{expectedVersion:apply.json().version}})).statusCode).toBe(200);
    const full=await app.inject({url:`/v1/invitations/${inv2.id}`,headers:bearer(player)}); expect(full.statusCode).toBe(200); expect(full.json().acceptanceContext.availablePlaces).toBe(0);
    expect((await app.inject({method:'POST',url:`/v1/invitations/${inv2.id}/accept`,headers:bearer(player),payload:{expectedVersion:full.json().version,expectedGameVersion:full.json().acceptanceContext.gameVersion}})).json().code).toBe('GAME_FULL');
    expect((await app.inject({method:'POST',url:`/v1/invitations/${inv2.id}/decline`,headers:bearer(player),payload:{expectedVersion:full.json().version}})).json().status).toBe('declined');
    const g3=await game(owner), expired=await invite(owner,p.publicPlayerId,g3);
    await pool.query("UPDATE game_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
    const expiration=await app.inject({url:`/v1/invitations/${expired.id}`,headers:bearer(player)}); expect(expiration.json().status).toBe('expired'); expect(expiration.json().acceptanceContext).toBeNull();
  });
  it('all four actual inbox kinds, direct request decisions/text/history/read privacy and game member authority', async () => {
    const owner=await actor(), player=await actor(), other=await actor();
    await profile(owner); const p=await profile(player); await profile(other);
    const dm=await direct(owner,p.publicPlayerId), pending=await direct(other,p.publicPlayerId);
    // Existing legacy pending requests must remain usable; current new-contact flow opens accepted DMs.
    await pool.query("UPDATE conversations SET request_state='pending',request_expires_at=now()+interval '1 day' WHERE id=$1",[pending.id]);
    const pendingUrl=`/v1/conversations/${pending.id}`;
    expect((await app.inject({url:pendingUrl,headers:bearer(player)})).json().requestState).toBe('pending');
    const g=await game(owner,2), acceptedInvite=await invite(owner,p.publicPlayerId,g);
    const context=(await app.inject({url:`/v1/invitations/${acceptedInvite.id}`,headers:bearer(player)})).json();
    expect((await app.inject({method:'POST',url:`/v1/invitations/${acceptedInvite.id}/accept`,headers:bearer(player),payload:{expectedVersion:context.version,expectedGameVersion:context.acceptanceContext.gameVersion}})).statusCode).toBe(200);
    const chat=`/v1/games/${g.id}/chat`; expect((await app.inject({url:chat,headers:bearer(player)})).statusCode).toBe(200);
    const g2=await game(owner), waiting=await invite(owner,p.publicPlayerId,g2);
    expect(waiting.id).toBeTruthy();
    const inbox=await app.inject({url:'/v1/me/inbox',headers:bearer(player)}); expect(inbox.statusCode).toBe(200);
    const kinds=inbox.json().items.map((i:{kind:string})=>i.kind); for(const kind of ['dm','dm_request','game_chat','game_invitation']) expect(kinds).toContain(kind);
    expect((await app.inject({url:'/v1/me/inbox/counts',headers:bearer(player)})).json().pendingRequestCount).toBeGreaterThan(0);
    for (const filter of ['unread','attention']) expect((await app.inject({url:'/v1/me/inbox?filter='+filter,headers:bearer(player)})).statusCode).toBe(200);
    const first=await app.inject({url:'/v1/me/inbox?limit=1',headers:bearer(player)}); expect(first.json().nextCursor).toBeTruthy();
    expect((await app.inject({url:'/v1/me/inbox?limit=1&cursor='+encodeURIComponent(first.json().nextCursor),headers:bearer(player)})).statusCode).toBe(200);
    const decision=await app.inject({method:'POST',url:pendingUrl+'/accept',headers:bearer(player),payload:{expectedVersion:pending.version}}); expect(decision.statusCode).toBe(200);
    const third=await actor(); await profile(third); const legacy=await direct(third,p.publicPlayerId);
    await pool.query("UPDATE conversations SET request_state='pending',request_expires_at=now()+interval '1 day' WHERE id=$1",[legacy.id]);
    expect((await app.inject({method:'POST',url:`/v1/conversations/${legacy.id}/decline`,headers:bearer(player),payload:{expectedVersion:legacy.version}})).json().requestState).toBe('declined');
    const replayKey=randomUUID(), replayPayload={kind:'text',text:'Established history before block',clientMessageId:randomUUID()};
    const dmUrl=`/v1/conversations/${dm.id}`;
    const beforeBlock=await app.inject({method:'POST',url:dmUrl+'/messages',headers:bearer(owner,replayKey),payload:replayPayload});
    expect(beforeBlock.statusCode).toBe(201);
    for(const url of [dmUrl,chat]) {
      const payload={kind:'text',text:'Text fixture',clientMessageId:randomUUID()}, key=randomUUID();
      const sent=await app.inject({method:'POST',url:url+'/messages',headers:bearer(owner,key),payload}); expect(sent.statusCode).toBe(201);
      expect((await app.inject({method:'POST',url:url+'/messages',headers:bearer(owner,key),payload})).json()).toEqual(sent.json());
      expect((await app.inject({method:'POST',url:url+'/messages',headers:bearer(owner,key),payload:{...payload,text:'changed'}})).statusCode).toBe(409);
      const history=await app.inject({url:url+'/messages',headers:bearer(player)}); expect(history.statusCode).toBe(200); expect(history.json().items.length).toBeGreaterThan(0);
      const throughSeq=history.json().items.at(-1).seq; expect(typeof throughSeq).toBe('string');
      const unread=(await app.inject({url,headers:bearer(player)})).json().readThroughSeq;
      expect(unread).not.toBe(throughSeq); // Header/history GET never marks read.
      expect((await app.inject({method:'POST',url:url+'/read',headers:bearer(player),payload:{throughSeq}})).statusCode).toBe(200);
      expect((await app.inject({url:url+'/messages?afterSeq='+throughSeq,headers:bearer(player)})).json().items).toEqual([]);
      expect((await app.inject({url:url+'/messages',headers:bearer(other)})).statusCode).toBe(404);
    }
    expect((await app.inject({url:chat+'/members',headers:bearer(player)})).json().items.length).toBeGreaterThan(1);
    // Established member history stays readable; fresh writes and receipt replay recheck block policy.
    const ownerProfile = (await app.inject({url:'/v1/me/social-profile',headers:bearer(owner)})).json();
    expect((await app.inject({method:'PUT',url:`/v1/me/blocks/${ownerProfile.publicPlayerId}`,headers:browser(player),payload:{}})).statusCode).toBe(200);
    expect((await app.inject({url:`/v1/invitations/${waiting.id}`,headers:bearer(player)})).statusCode).toBe(404);
    for (const url of [dmUrl,dmUrl+'/messages']) {
      const native=await app.inject({url,headers:bearer(player)}), cookieRead=await app.inject({url,headers:browser(player)});
      expect(native.statusCode).toBe(200); expect(cookieRead.statusCode).toBe(200);
      expect(native.json()).toEqual(cookieRead.json());
      expect((await app.inject({url,headers:bearer(other)})).statusCode).toBe(404);
    }
    const historyAfterBlock=await app.inject({url:dmUrl+'/messages',headers:bearer(player)});
    expect(historyAfterBlock.json().items.map((m:{id:string})=>m.id)).toContain(beforeBlock.json().messageId);
    for (const a of [owner,player]) {
      const denied=await app.inject({method:'POST',url:dmUrl+'/messages',headers:bearer(a),payload:{kind:'text',text:'Blocked new send',clientMessageId:randomUUID()}});
      expect(denied.statusCode).toBe(404); expect(denied.json().code).toBe('RESOURCE_UNAVAILABLE');
    }
    const replay=await app.inject({method:'POST',url:dmUrl+'/messages',headers:bearer(owner,replayKey),payload:replayPayload});
    expect(replay.statusCode).toBe(404); expect(replay.json().code).toBe('RESOURCE_UNAVAILABLE');
  });
  it('malformed/duplicate/mixed/revoked/disabled bearer, cookie Origin/CSRF and neighboring closed routes', async () => {
    const owner=await actor(), player=await actor(); await profile(owner); const p=await profile(player); const dm=await direct(owner,p.publicPlayerId);
    const url=`/v1/conversations/${dm.id}`, payload={kind:'text',text:'Cookie fixture',clientMessageId:randomUUID()};
    for(const authorization of ['', 'Basic invalid','Bearer invalid',`Bearer ${'x'.repeat(43)}`]) expect((await app.inject({url,headers:{authorization}})).statusCode).toBe(401);
    expect((await app.inject({url,headers:{Authorization:[`Bearer ${player.accessToken}`,`Bearer ${player.accessToken}`]}})).statusCode).toBe(401);
    expect((await app.inject({url,headers:{...bearer(player),cookie:player.cookie}})).statusCode).toBe(403);
    expect((await disabledApp.inject({url,headers:bearer(player)})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:url+'/messages',headers:{cookie:owner.cookie,origin,'idempotency-key':randomUUID()},payload})).json().code).toBe('CSRF_REQUIRED');
    expect((await app.inject({method:'POST',url:url+'/messages',headers:{...browser(owner),origin:'https://evil.test'},payload})).json().code).toBe('ORIGIN_REJECTED');
    expect((await app.inject({method:'POST',url:url+'/messages',headers:browser(owner),payload})).statusCode).toBe(201);
    for(const [method,closed] of [['POST','/v1/conversations/requests'],['POST',url+'/messages/'+randomUUID()+'/hide'],['POST',`/v1/me/inbox/items/dm/${dm.id}/read`],['PATCH','/v1/me/social-profile'],['POST','/v1/games/'+randomUUID()+'/invitations'],['POST','/v1/invitations/'+randomUUID()+'/revoke']] as const) {
      expect([401,403]).toContain((await app.inject({method,url:closed,headers:bearer(player),payload:{}})).statusCode);
    }
    await app.get(SessionService).revokeSession(player.sessionId);
    expect((await app.inject({url,headers:bearer(player)})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:url+'/read',headers:bearer(player),payload:{throughSeq:'1'}})).statusCode).toBe(401);
  });
});
