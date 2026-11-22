import { RadarModule } from "../../src/radar/radar.module";
import { NativeSessionService } from "../../src/auth/native-session.service";
import { UNIFIED_WIRE, UNIFIED_POLICY, UNIFIED_DISCLOSURE_ID, UNIFIED_DISCLOSURE_HASH } from "../../src/radar/unified-contract";
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
    SOCIAL_RADAR_ENABLED:"1", SOCIAL_RADAR_GEOGRAPHIC_ENABLED:"1", SOCIAL_RADAR_UNIFIED_ENABLED:"1", SOCIAL_RADAR_PUBLISHING_V2_ENABLED:"1",
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
      MessagingModule, GameChatModule, InvitationsModule, InboxModule, RadarModule] }).overrideProvider(AUTH_PROVIDER_OVERRIDES).useValue([fake]).compile();
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
          const query = {
            text: "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1",
            values: [databaseName],
            query_timeout: remainingMs,
          };
          const activity = await admin.query<{ count: number }>(query);
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
  it('GET /me/invitations NativeBearer list: invitee isolation, pagination, expiry, cookie/bearer auth and closed neighbors', async () => {
    const owner=await actor(), player=await actor(), other=await actor();
    await profile(owner); const p=await profile(player); const o=await profile(other);
    const g1=await game(owner), g2=await game(owner), g3=await game(owner);
    const a=await invite(owner,p.publicPlayerId,g1), b=await invite(owner,p.publicPlayerId,g2);
    await invite(owner,o.publicPlayerId,g3);
    await pool.query("UPDATE game_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",[b.id]);
    const listUrl='/v1/me/invitations';
    const cookieList=await app.inject({url:listUrl,headers:{cookie:player.cookie}}); expect(cookieList.statusCode).toBe(200);
    const bearerList=await app.inject({url:listUrl,headers:bearer(player)}); expect(bearerList.statusCode).toBe(200);
    expect(bearerList.json().items.map((row:{id:string})=>row.id).sort()).toEqual([a.id,b.id].sort());
    expect(bearerList.json().items.every((row:{inviteePublicPlayerId:string})=>row.inviteePublicPlayerId===p.publicPlayerId)).toBe(true);
    expect(bearerList.json().items.find((row:{id:string})=>row.id===b.id)?.status).toBe('expired');
    const page1=await app.inject({url:listUrl+'?limit=1',headers:bearer(player)}); expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(1); expect(page1.json().nextCursor).toBeTruthy();
    const page2=await app.inject({url:listUrl+'?limit=1&cursor='+encodeURIComponent(page1.json().nextCursor),headers:bearer(player)});
    expect(page2.statusCode).toBe(200); expect(page2.json().items).toHaveLength(1);
    expect([page1.json().items[0].id,page2.json().items[0].id].sort()).toEqual([a.id,b.id].sort());
    const outsider=await app.inject({url:listUrl,headers:bearer(other)}); expect(outsider.statusCode).toBe(200);
    expect(outsider.json().items.every((row:{id:string})=>row.id!==a.id && row.id!==b.id)).toBe(true);
    expect((await app.inject({url:listUrl,headers:{}})).statusCode).toBe(401);
    for (const headers of [{authorization:'Basic invalid'},{authorization:'Bearer invalid'},{authorization:`Bearer ${'x'.repeat(43)}`},
      {Authorization:[`Bearer ${player.accessToken}`,`Bearer ${player.accessToken}`]}]) {
      expect((await app.inject({url:listUrl,headers})).statusCode).toBe(401);
    }
    expect((await app.inject({url:listUrl,headers:{...bearer(player),cookie:player.cookie}})).statusCode).toBe(403);
    expect((await disabledApp.inject({url:listUrl,headers:bearer(player)})).statusCode).toBe(404);
    for (const [method,closed] of [['POST',`/v1/games/${g1.id}/invitations`],['POST',`/v1/invitations/${a.id}/revoke`],['GET',`/v1/games/${g1.id}/invitations`]] as const) {
      expect([401,403]).toContain((await app.inject({method,url:closed,headers:bearer(player),payload:{}})).statusCode);
    }
    await app.get(SessionService).revokeSession(player.sessionId);
    expect((await app.inject({url:listUrl,headers:bearer(player)})).statusCode).toBe(401);
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
  it('native first contact uses authoritative target, exact replay and global client-message destination/body binding', async () => {
    const owner=await actor(), player=await actor(), other=await actor();
    const own=await profile(owner), p=await profile(player), q=await profile(other);
    const lookup='/v1/me/contact-state?targetPublicPlayerId='+p.publicPlayerId;
    const state=await app.inject({url:lookup,headers:bearer(owner)});
    expect(state.statusCode).toBe(200); expect(state.json()).toEqual({state:'none',targetPublicPlayerId:p.publicPlayerId,canRequestContact:true});
    expect((await app.inject({url:lookup,headers:{cookie:owner.cookie}})).json()).toEqual(state.json());
    expect((await pool.query('SELECT 1 FROM conversations WHERE initiator_user_id=$1',[owner.id])).rowCount).toBe(0);
    const url='/v1/conversations/requests', key=randomUUID(), payload={targetPublicPlayerId:p.publicPlayerId,text:'First native contact',clientMessageId:randomUUID()};
    const created=await app.inject({method:'POST',url,headers:bearer(owner,key),payload}); expect(created.statusCode).toBe(201);
    const body=created.json();
    expect(body.conversation).toMatchObject({requestState:'accepted',peer:{publicPlayerId:p.publicPlayerId}});
    expect(body.receipt).toMatchObject({conversationId:body.conversation.id,seq:'1',outcome:'created'});
    expect(body.receipt.messageId).toBeTruthy(); expect(Number.isFinite(Date.parse(body.receipt.createdAt))).toBe(true);
    const replay=await app.inject({method:'POST',url,headers:bearer(owner,key),payload}); expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(body);
    const duplicate=await app.inject({method:'POST',url,headers:bearer(owner),payload}); expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().receipt).toEqual({...body.receipt,outcome:'duplicate'});
    for (const changed of [{...payload,text:'Changed body'},{...payload,targetPublicPlayerId:q.publicPlayerId},{...payload,clientMessageId:randomUUID()}]) {
      expect((await app.inject({method:'POST',url,headers:bearer(owner,key),payload:changed})).statusCode).toBe(409);
    }
    for (const changed of [{...payload,text:'Changed body'},{...payload,targetPublicPlayerId:q.publicPlayerId}]) {
      const mismatch=await app.inject({method:'POST',url,headers:bearer(owner),payload:changed});
      expect(mismatch.statusCode).toBe(409); expect(mismatch.json().code).toBe('CLIENT_MESSAGE_ID_REUSED');
    }
    const race=await app.inject({method:'POST',url,headers:bearer(owner),payload:{...payload,clientMessageId:randomUUID()}});
    expect(race.statusCode).toBe(409); expect(race.json().code).toBe('CONVERSATION_ALREADY_OPEN');
    expect((await pool.query('SELECT 1 FROM conversations WHERE initiator_user_id=$1',[owner.id])).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM messages WHERE author_user_id=$1',[owner.id])).rowCount).toBe(1);
    expect((await app.inject({url:lookup,headers:bearer(owner)})).json()).toMatchObject({state:'accepted',targetPublicPlayerId:p.publicPlayerId,conversationId:body.conversation.id});
    const reverse=await app.inject({url:'/v1/me/contact-state?targetPublicPlayerId='+own.publicPlayerId,headers:bearer(player)});
    expect(reverse.json()).toMatchObject({state:'accepted',targetPublicPlayerId:own.publicPlayerId,conversationId:body.conversation.id});
    expect((await app.inject({url:'/v1/conversations/'+body.conversation.id,headers:bearer(player)})).json().peer.publicPlayerId).toBe(own.publicPlayerId);
    expect((await app.inject({url:'/v1/conversations/'+body.conversation.id,headers:bearer(other)})).statusCode).toBe(404);
  });
  it('native first-contact blocked, ineligible, private and local moderation denials INSERT no conversation/message', async () => {
    const owner=await actor(), blocked=await actor(), ineligible=await actor(), privatePlayer=await actor(), moderated=await actor();
    await profile(owner); const b=await profile(blocked), i=await profile(ineligible), hidden=await profile(privatePlayer), m=await profile(moderated);
    expect((await app.inject({method:'PUT',url:'/v1/me/blocks/'+b.publicPlayerId,headers:browser(owner),payload:{}})).statusCode).toBe(200);
    expect((await app.inject({method:'PATCH',url:'/v1/me/social-profile',headers:browser(ineligible),payload:{expectedVersion:i.version,socialEligible:false}})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:'/v1/me/social-profile/visibility',headers:browser(privatePlayer),payload:{directoryVisible:false,consentPolicyVersion:'directory-mvp-v1',expectedVersion:hidden.version}})).statusCode).toBe(200);
    for (const target of [b.publicPlayerId,i.publicPlayerId,hidden.publicPlayerId]) {
      expect((await app.inject({url:'/v1/me/contact-state?targetPublicPlayerId='+target,headers:bearer(owner)})).json()).toEqual({state:'unavailable',targetPublicPlayerId:target});
      const denied=await app.inject({method:'POST',url:'/v1/conversations/requests',headers:bearer(owner),payload:{targetPublicPlayerId:target,text:'Safe fixture',clientMessageId:randomUUID()}});
      expect(denied.statusCode).toBe(404); expect(denied.json().code).toBe('RESOURCE_UNAVAILABLE');
    }
    const rejected=await app.inject({method:'POST',url:'/v1/conversations/requests',headers:bearer(owner),payload:{targetPublicPlayerId:m.publicPlayerId,text:'open javascript:alert(1)',clientMessageId:randomUUID()}});
    expect(rejected.statusCode).toBe(422); expect(rejected.json().code).toBe('PRIVATE_TEXT_CONTENT_REJECTED');
    expect((await pool.query('SELECT 1 FROM conversations WHERE initiator_user_id=$1',[owner.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM messages WHERE author_user_id=$1',[owner.id])).rowCount).toBe(0);
  });
  it('both selected contact routes retain invalid/mixed/revoked/disabled transport and cookie mutation Origin/CSRF', async () => {
    const owner=await actor(), player=await actor(); await profile(owner); const p=await profile(player);
    const lookup='/v1/me/contact-state?targetPublicPlayerId='+p.publicPlayerId;
    const payload={targetPublicPlayerId:p.publicPlayerId,text:'Secure first contact',clientMessageId:randomUUID()};
    const routes=[{method:'GET' as const,url:lookup},{method:'POST' as const,url:'/v1/conversations/requests',payload}];
    for (const route of routes) {
      const anonymous=await app.inject({...route,headers:{}});
      if (route.method==='GET') expect(anonymous.statusCode).toBe(401);
      else {
        expect(anonymous.statusCode).toBe(403);
        expect(anonymous.json().code).toBe('ORIGIN_REJECTED');
      }
      for (const headers of [{authorization:'Basic invalid'}, {authorization:'Bearer invalid'}, {authorization:`Bearer ${'x'.repeat(43)}`},
        {Authorization:[`Bearer ${owner.accessToken}`,`Bearer ${owner.accessToken}`]}]) {
        expect((await app.inject({...route,headers})).statusCode).toBe(401);
      }
      expect((await app.inject({...route,headers:{...bearer(owner),cookie:owner.cookie}})).statusCode).toBe(403);
      expect((await disabledApp.inject({...route,headers:bearer(owner)})).statusCode).toBe(404);
    }
    const url='/v1/conversations/requests';
    expect((await app.inject({method:'POST',url,headers:{cookie:owner.cookie,origin,'idempotency-key':randomUUID()},payload})).json().code).toBe('CSRF_REQUIRED');
    expect((await app.inject({method:'POST',url,headers:{...browser(owner),origin:'https://evil.test'},payload})).json().code).toBe('ORIGIN_REJECTED');
    expect((await pool.query('SELECT 1 FROM messages WHERE author_user_id=$1',[owner.id])).rowCount).toBe(0);
    const cookieCreate=await app.inject({method:'POST',url,headers:browser(owner),payload}); expect(cookieCreate.statusCode).toBe(201);
    expect(cookieCreate.json().conversation.peer.publicPlayerId).toBe(p.publicPlayerId);
    await app.get(SessionService).revokeSession(owner.sessionId);
    for (const route of routes) expect((await app.inject({...route,headers:bearer(owner)})).statusCode).toBe(401);
    expect((await pool.query('SELECT 1 FROM messages WHERE author_user_id=$1',[owner.id])).rowCount).toBe(1);
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
    for(const [method,closed] of [['POST',url+'/messages/'+randomUUID()+'/hide'],['POST',`/v1/me/inbox/items/dm/${dm.id}/read`],['PATCH','/v1/me/game-preferences'],['POST','/v1/games/'+randomUUID()+'/invitations'],['POST','/v1/invitations/'+randomUUID()+'/revoke']] as const) {
      expect([401,403]).toContain((await app.inject({method,url:closed,headers:bearer(player),payload:{}})).statusCode);
    }
    await app.get(SessionService).revokeSession(player.sessionId);
    expect((await app.inject({url,headers:bearer(player)})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:url+'/read',headers:bearer(player),payload:{throughSeq:'1'}})).statusCode).toBe(401);
  });
  it('native safety three route opt-ins preserve bearer containment, cookie Origin/CSRF and idempotency requirements', async () => {
    const owner=await actor(), player=await actor(); await profile(owner); const p=await profile(player);
    const routes=[
      {method:'PUT' as const,url:'/v1/me/blocks/'+p.publicPlayerId,payload:{}},
      {method:'DELETE' as const,url:'/v1/me/blocks/'+p.publicPlayerId,payload:{}},
      {method:'POST' as const,url:'/v1/reports',payload:{targetKind:'player',targetPublicPlayerId:p.publicPlayerId,reasonCode:'spam',detail:null}},
    ];
    for (const route of routes) {
      const guest=await app.inject({...route,headers:{}}); expect(guest.statusCode).toBe(403); expect(guest.json().code).toBe('ORIGIN_REJECTED');
      for (const headers of [{authorization:'Basic invalid'}, {authorization:'Bearer invalid'}, {authorization:`Bearer ${'x'.repeat(43)}`},
        {Authorization:[`Bearer ${owner.accessToken}`,`Bearer ${owner.accessToken}`]}]) expect((await app.inject({...route,headers})).statusCode).toBe(401);
      expect((await app.inject({...route,headers:{...bearer(owner),cookie:owner.cookie}})).statusCode).toBe(403);
      expect((await disabledApp.inject({...route,headers:bearer(owner)})).statusCode).toBe(404);
      const noCsrf=await app.inject({...route,headers:{cookie:owner.cookie,origin,'idempotency-key':randomUUID()}});
      expect(noCsrf.statusCode).toBe(403); expect(noCsrf.json().code).toBe('CSRF_REQUIRED');
      const badOrigin=await app.inject({...route,headers:{...browser(owner),origin:'https://evil.test'}});
      expect(badOrigin.statusCode).toBe(403); expect(badOrigin.json().code).toBe('ORIGIN_REJECTED');
      expect((await app.inject({...route,headers:{authorization:`Bearer ${owner.accessToken}`}})).statusCode).toBe(400);
    }
    await app.get(SessionService).revokeSession(owner.sessionId);
    for (const route of routes) expect((await app.inject({...route,headers:bearer(owner)})).statusCode).toBe(401);
    expect((await pool.query('SELECT 1 FROM abuse_reports WHERE reporter_user_id=$1',[owner.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM user_blocks WHERE blocker_user_id=$1',[owner.id])).rowCount).toBe(0);
  });
  it('native block/unblock receipts and reports use authoritative source, explicit message consent and accepted history privacy', async () => {
    const owner=await actor(), player=await actor(), outsider=await actor();
    const own=await profile(owner), p=await profile(player); await profile(outsider);
    const dm=await direct(owner,p.publicPlayerId), url='/v1/conversations/'+dm.id;
    const history=await app.inject({url:url+'/messages',headers:bearer(player)}); expect(history.statusCode).toBe(200);
    const selected=history.json().items[0] as {id:string;authorPublicPlayerId:string;text:string};
    expect(selected.authorPublicPlayerId).toBe(own.publicPlayerId);
    const payload={targetKind:'message',messageId:selected.id,conversationId:dm.id,reasonCode:'harassment',detail:null,shareMessageWithSupport:true};
    const noConsent=await app.inject({method:'POST',url:'/v1/reports',headers:bearer(player),payload:{...payload,shareMessageWithSupport:false}});
    expect(noConsent.statusCode).toBe(422); expect(noConsent.json().code).toBe('MESSAGE_REPORT_CONSENT_REQUIRED');
    expect((await app.inject({method:'POST',url:'/v1/reports',headers:bearer(outsider),payload})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/v1/reports',headers:bearer(owner),payload})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/v1/reports',headers:bearer(player),payload:{...payload,conversationId:randomUUID()}})).statusCode).toBe(404);
    const reportKey=randomUUID(), submitted=await app.inject({method:'POST',url:'/v1/reports',headers:bearer(player,reportKey),payload});
    expect(submitted.statusCode).toBe(201); expect(submitted.json()).toMatchObject({status:'submitted'});
    expect(Object.keys(submitted.json()).sort()).toEqual(['reportId','status','createdAt'].sort());
    expect(Number.isFinite(Date.parse(submitted.json().createdAt))).toBe(true);
    expect((await app.inject({method:'POST',url:'/v1/reports',headers:bearer(player,reportKey),payload})).json()).toEqual(submitted.json());
    const binding=(await pool.query('SELECT message_id,conversation_id,author_user_id,reporter_user_id,share_consent FROM message_report_bindings WHERE report_id=$1',[submitted.json().reportId])).rows[0];
    expect(binding).toEqual({message_id:selected.id,conversation_id:dm.id,author_user_id:owner.id,reporter_user_id:player.id,share_consent:true});
    const playerPayload={targetKind:'player',targetPublicPlayerId:own.publicPlayerId,reasonCode:'spam',detail:null}, playerKey=randomUUID();
    const reported=await app.inject({method:'POST',url:'/v1/reports',headers:bearer(player,playerKey),payload:playerPayload}); expect(reported.statusCode).toBe(201);
    expect((await app.inject({method:'POST',url:'/v1/reports',headers:bearer(player,playerKey),payload:playerPayload})).json()).toEqual(reported.json());
    const stored=(await pool.query('SELECT target_kind,target_public_player_id,detail,evidence_refs FROM abuse_reports WHERE id=$1',[reported.json().reportId])).rows[0];
    expect(stored).toEqual({target_kind:'player',target_public_player_id:own.publicPlayerId,detail:null,evidence_refs:[]});
    const blockUrl='/v1/me/blocks/'+own.publicPlayerId, blockKey=randomUUID();
    const blocked=await app.inject({method:'PUT',url:blockUrl,headers:bearer(player,blockKey),payload:{}});
    expect(blocked.statusCode).toBe(200); expect(blocked.json()).toEqual({publicPlayerId:own.publicPlayerId,blocked:true});
    expect((await app.inject({method:'PUT',url:blockUrl,headers:bearer(player,blockKey),payload:{}})).json()).toEqual(blocked.json());
    for (const a of [owner,player]) expect((await app.inject({method:'POST',url:url+'/messages',headers:bearer(a),payload:{kind:'text',text:'Blocked',clientMessageId:randomUUID()}})).statusCode).toBe(404);
    expect((await app.inject({url:url+'/messages',headers:bearer(player)})).json()).toEqual(history.json());
    expect((await app.inject({url:url+'/messages',headers:bearer(outsider)})).statusCode).toBe(404);
    const unblockKey=randomUUID(), unblocked=await app.inject({method:'DELETE',url:blockUrl,headers:bearer(player,unblockKey),payload:{}});
    expect(unblocked.statusCode).toBe(200); expect(unblocked.json()).toEqual({publicPlayerId:own.publicPlayerId,blocked:false});
    expect((await app.inject({method:'DELETE',url:blockUrl,headers:bearer(player,unblockKey),payload:{}})).json()).toEqual(unblocked.json());
    // No fabricated restoration: permissions are read again from the existing endpoint.
    expect((await app.inject({url,headers:bearer(player)})).json().requestState).toBe('accepted');
    const fresh=await app.inject({method:'POST',url:url+'/messages',headers:bearer(player),payload:{kind:'text',text:'After authoritative unblock',clientMessageId:randomUUID()}}); expect(fresh.statusCode).toBe(201);
  });

  it('native unified proof reaches explicit first contact; wrong app-session/account, expired/revoked/blocked proof writes zero', async () => {
    const viewer=await actor(), peer=await actor(), outsider=await actor(); await profile(viewer); const target=await profile(peer); await profile(outsider);
    // A Radar-only peer stays discoverable, but the current server contact policy denies first contact.
    await pool.query('UPDATE player_social_profiles SET directory_visible=false WHERE user_id=$1',[peer.id]);
    expect((await app.inject({url:`/v1/players/${target.publicPlayerId}`,headers:bearer(viewer)})).statusCode).toBe(404);
    const start = async (who: Actor) => {
      const r=await app.inject({method:'POST',url:'/v1/me/radar/activations',headers:bearer(who),payload:{contractVersion:UNIFIED_WIRE,consentPolicyVersion:UNIFIED_POLICY,
        consent:{disclosureId:UNIFIED_DISCLOSURE_ID,disclosureHash:UNIFIED_DISCLOSURE_HASH,accepted:true},location:{latitude:55.7558,longitude:37.6173,accuracyMeters:100,capturedAt:new Date().toISOString()}}});
      expect(r.statusCode,r.body).toBe(201); return r.json();
    };
    await start(viewer); await start(peer);
    const query=await app.inject({method:'POST',url:'/v1/players/query',headers:bearer(viewer),payload:{contractVersion:UNIFIED_WIRE,filters:{cityId:MOSCOW_CITY_ID},origin:{kind:'none'},limit:50}});
    expect(query.statusCode,query.body).toBe(200);
    const hiddenRow=query.json().items.find((r:{publicPlayerId:string})=>r.publicPlayerId===target.publicPlayerId);
    expect(hiddenRow.player.canRequestContact).toBe(false);
    const hiddenProof=hiddenRow.radar.resultRef as string;
    const counts=async()=>({messages:(await pool.query('SELECT count(*)::int AS n FROM messages')).rows[0].n,conversations:(await pool.query('SELECT count(*)::int AS n FROM conversations')).rows[0].n});
    const before=await counts();
    const hiddenPreview=await app.inject({method:'POST',url:'/v1/radar/results/preview',headers:bearer(viewer),payload:{resultRef:hiddenProof}});
    expect(hiddenPreview.statusCode,hiddenPreview.body).toBe(200);expect(hiddenPreview.json().player.canRequestContact).toBe(false);
    const hiddenRequest=await app.inject({method:'POST',url:'/v1/conversations/requests',headers:bearer(viewer),payload:{targetPublicPlayerId:target.publicPlayerId,text:'Must remain private',clientMessageId:randomUUID(),discoveryProof:hiddenProof}});
    expect(hiddenRequest.statusCode).toBe(404);expect(await counts()).toEqual(before);
    // Proof is additional authority, not a privacy bypass. Test valid proof on an eligible target.
    await pool.query('UPDATE player_social_profiles SET directory_visible=true WHERE user_id=$1',[peer.id]);
    const freshProof=async()=>{
      await pool.query('DELETE FROM radar_rate_budgets WHERE user_id=$1',[viewer.id]);
      const r=await app.inject({method:'POST',url:'/v1/players/query',headers:bearer(viewer),payload:{contractVersion:UNIFIED_WIRE,filters:{cityId:MOSCOW_CITY_ID},origin:{kind:'none'}}});
      expect(r.statusCode,r.body).toBe(200); const row=r.json().items.find((r:{publicPlayerId:string})=>r.publicPlayerId===target.publicPlayerId); expect(row?.radar).toBeTruthy(); return row.radar.resultRef as string;
    };
    const proof=await freshProof();
    const native=app.get(NativeSessionService), sameUser=await native.transaction(c=>native.issue(c,viewer.id,clientId));
    const payload={targetPublicPlayerId:target.publicPlayerId,text:'Explicit Radar hello',clientMessageId:randomUUID(),discoveryProof:proof};
    for (const headers of [bearer(outsider),{authorization:`Bearer ${sameUser.accessToken}`,'idempotency-key':randomUUID()}]) {
      const failed=await app.inject({method:'POST',url:'/v1/conversations/requests',headers,payload}); expect(failed.statusCode).toBe(404); expect(await counts()).toEqual(before);
    }
    const rejectNew=async(ref:string)=>{
      const prior=await counts(), denied=await app.inject({method:'POST',url:'/v1/conversations/requests',headers:bearer(viewer),payload:{...payload,clientMessageId:randomUUID(),discoveryProof:ref}});
      expect(denied.statusCode,denied.body).toBe(404); expect(await counts()).toEqual(prior);
    };
    // Refusal is exercised before a conversation exists, so it cannot pass on an unrelated existing-DM conflict.
    await pool.query("UPDATE radar_presences SET location_valid_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",[peer.id]); await rejectNew(proof);
    await pool.query('DELETE FROM radar_rate_budgets WHERE user_id=$1',[peer.id]); await start(peer);
    const fresh=await freshProof();
    expect((await app.inject({method:'PUT',url:`/v1/me/blocks/${target.publicPlayerId}`,headers:bearer(viewer),payload:{}})).statusCode).toBe(200); await rejectNew(fresh);
    expect((await app.inject({method:'DELETE',url:`/v1/me/blocks/${target.publicPlayerId}`,headers:bearer(viewer),payload:{}})).statusCode).toBe(200);
    const afterBlock=await freshProof();
    await native.logout({accessToken:peer.accessToken,clientId}); await rejectNew(afterBlock);
    expect((await pool.query('SELECT 1 FROM radar_presences WHERE owner_session_id=$1',[peer.sessionId])).rowCount).toBe(0);
    const peerAgain={...peer,...await native.transaction(c=>native.issue(c,peer.id,clientId))};
    await pool.query('DELETE FROM radar_rate_budgets WHERE user_id=$1',[peer.id]); await start(peerAgain);
    const finalProof=await freshProof(), finalPayload={...payload,discoveryProof:finalProof}, key=randomUUID();
    const sent=await app.inject({method:'POST',url:'/v1/conversations/requests',headers:bearer(viewer,key),payload:finalPayload}); expect(sent.statusCode,sent.body).toBe(201);
    // Existing durable same-key replay returns its original receipt; it does not re-mint geographic proof.
    const replay=await app.inject({method:'POST',url:'/v1/conversations/requests',headers:bearer(viewer,key),payload:finalPayload}); expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(sent.json());
    expect((await counts()).messages).toBe(before.messages+1); expect((await counts()).conversations).toBe(before.conversations+1);
    const csrf=await app.inject({method:'POST',url:'/v1/conversations/requests',headers:{cookie:viewer.cookie,origin,'idempotency-key':randomUUID()},payload}); expect(csrf.statusCode).toBe(403);
  });
  // pinned suite size after #522 MyGames invitations list admission: 10
});
