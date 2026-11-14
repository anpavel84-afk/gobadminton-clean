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
import { ProblemExceptionFilter } from "../../src/common/problem.filter";

// Dedicated loopback admin only. Never falls back to DATABASE_URL or a DEV database.
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("native game management · self-migrating isolated database", () => {
  let app: NestFastifyApplication, disabledApp: NestFastifyApplication;
  let pool: Pool, admin: Pool, databaseName: string;
  const origin = "https://localhost:3001", clientId = "native.management.fixture", redirectUri = "https://app.example.test/auth/callback";
  const env = loadEnv({ NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:15432/postgres",
    PUBLIC_API_ORIGIN: "https://localhost:3000", PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true", VK_CLIENT_ID: "vk-fixture", VK_CLIENT_SECRET: "vk-fixture-secret", VK_REDIRECT_URI: "https://localhost:3000/v1/auth/vk/callback",
    AUTH_PEPPER: "native-game-management-dedicated-synthetic-pepper-32chars", NATIVE_AUTH_ENABLED: "1",
    SOCIAL_DIRECTORY_ENABLED: "1",
    CONTENT_MODERATION_PROVIDER: "fake", CONTENT_MODERATION_FINGERPRINT_SECRET: "native-game-management-dedicated-synthetic-fingerprint-only",
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId, redirectUris: [redirectUri] }]) });
  const fake: AuthProviderAdapter = { key: "vk", configured: true,
    async startAuthorization(input) { return { authorizationUrl: `https://provider.test/authorize?state=${input.state}` }; },
    async exchangeCode() { return { accessToken: "synthetic-provider-access" }; },
    async fetchVerifiedIdentity() { return { provider: "vk", issuerNamespace: "vkid:app:native-game-management-fixture", subject: randomUUID(), displayName: "Fixture" }; },
  };
  async function build(enabled: boolean) {
    const module = await Test.createTestingModule({ imports: [buildTestCoreModule({ ...env, NATIVE_AUTH_ENABLED: enabled }, pool), AuthModule,
      OrganizersModule, VenuesModule, TrainersModule, GamesModule, ParticipationsModule, ProfilesModule, SafetyModule,
      ] }).overrideProvider(AUTH_PROVIDER_OVERRIDES).useValue([fake]).compile();
    const instance = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await instance.register(cookie); instance.setGlobalPrefix("v1"); instance.useGlobalFilters(new ProblemExceptionFilter());
    await instance.init(); await instance.getHttpAdapter().getInstance().ready(); return instance;
  }
  beforeAll(async () => {
    const raw = process.env.NATIVE_GAME_MANAGEMENT_TEST_DATABASE_URL;
    if (!raw) throw Error("Set NATIVE_GAME_MANAGEMENT_TEST_DATABASE_URL to dedicated loopback disposable PostgreSQL admin /postgres");
    const url = new URL(raw);
    if (!["postgres:","postgresql:"].includes(url.protocol) || url.search || url.hash || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.pathname !== "/postgres") throw Error("Isolated fixture requires loopback admin /postgres");
    admin = new Pool({ connectionString: url.href }); databaseName = "native_game_management_" + randomUUID().replaceAll("-", "");
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
      if (closeErrors.length) throw new AggregateError(closeErrors, "Native game management fixture graceful cleanup failed");
      if (admin && databaseName) {
        if (!/^native_game_management_[a-f0-9]{32}$/.test(databaseName)) throw Error("Refusing cleanup of an unowned fixture database");
        // Pool shutdown can finish before PostgreSQL observes every socket disconnect.
        const drainTimeoutMs = 5_000, deadline = Date.now() + drainTimeoutMs;
        let remainingConnections: number | undefined;
        while (true) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) throw Error(`Native game management fixture cleanup leak: ${remainingConnections} connections remain in ${databaseName} after ${drainTimeoutMs}ms; database was not dropped`);
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
  let fixtureVenueId: string | undefined;
  async function creation(owner: Actor, native = true, options: { capacity?: number; trainer?: boolean; save?: number } = {}) {
    if (!fixtureVenueId) {
    const venue = await app.inject({ method: 'POST', url: '/v1/venues', headers: browser(owner), payload: {
      cityId: MOSCOW_CITY_ID, name: 'Synthetic management venue '+randomUUID(), address: 'Synthetic fixture', timezone: 'Europe/Moscow', latitude: 55.75, longitude: 37.62,
    } }); expect(venue.statusCode).toBe(201);
    fixtureVenueId = venue.json().id as string;
    }
    const starts = Date.now() + 7 * 86400000;
    const payload = { venueId: fixtureVenueId, hostDisplayName: 'Synthetic host', hostPublicContact: 'telegram:@management_fixture',
      title: 'Synthetic management game', startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 7200000).toISOString(), applicationDeadlineAt: new Date(starts).toISOString(),
      timezone: 'Europe/Moscow', capacity: options.capacity ?? 3, externalReservedCount: 0, visibility: 'unlisted', formatKey: 'doubles',
      activityKind: options.trainer ? 'trainer_led' : 'regular', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0','3.5'] },
      settlement: options.trainer ? { mode: 'external', purpose: 'trainer_fee', priceStatus: 'by_agreement', priceMinor: null, currency: null, terms: 'By agreement outside platform' }
        : { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'Venue terms outside platform' },
      ...(options.save === undefined ? {} : { savePublicContactDefault: { expectedVersion: options.save } }),
    };
    const key = randomUUID(), headers = native ? bearer(owner,key) : browser(owner,key);
    const result = await app.inject({ method:'POST',url:'/v1/games',headers,payload });
    return { result,payload,key,headers };
  }
  async function publish(owner: Actor, draft: { id: string; version: number }) {
    const response = await app.inject({method:'POST',url:`/v1/games/${draft.id}/publish`,headers:bearer(owner),payload:{expectedVersion:draft.version}});
    expect(response.statusCode).toBe(200); return response.json() as { id: string; version: number; availablePlaces: number };
  }
  async function request(player: Actor, game: { id: string; version: number }) {
    const response = await app.inject({method:'POST',url:`/v1/games/${game.id}/participations`,headers:bearer(player),payload:{expectedGameVersion:game.version}});
    expect(response.statusCode).toBe(201); return response.json() as { id: string; version: number };
  }
  it('ordinary create/publish native and cookie parity, creator seat, atomic preference version and current replay authority', async () => {
    const owner = await actor(), outsider = await actor();
    const prefs = await app.inject({url:'/v1/me/game-preferences',headers:bearer(owner)}); expect(prefs.statusCode).toBe(200);
    expect(prefs.json()).toEqual({version:0,defaultPublicGameContact:null});
    expect((await app.inject({url:'/v1/me/game-preferences',headers:{cookie:owner.cookie}})).json()).toEqual(prefs.json());
    expect((await app.inject({url:'/v1/me/trainer-profile',headers:bearer(owner)})).statusCode).toBe(404);
    const created = await creation(owner,true,{save:0}); expect(created.result.statusCode).toBe(201);
    const g = created.result.json(); expect(g.status).toBe('draft'); expect(g.confirmedCount).toBe(1); expect(g.availablePlaces).toBe(2);
    expect((await app.inject({url:'/v1/me/game-preferences',headers:bearer(owner)})).json()).toEqual({version:1,defaultPublicGameContact:created.payload.hostPublicContact});
    expect((await pool.query('SELECT status FROM participations WHERE game_id=$1 AND user_id=$2',[g.id,owner.id])).rows).toEqual([{status:'confirmed'}]);
    expect((await app.inject({method:'POST',url:'/v1/games',headers:created.headers,payload:created.payload})).json()).toEqual(g);
    const before = Number((await pool.query('SELECT count(*) FROM games WHERE created_by_user_id=$1',[owner.id])).rows[0].count);
    const stale = await creation(owner,true,{save:0}); expect(stale.result.statusCode).toBe(409);
    expect(Number((await pool.query('SELECT count(*) FROM games WHERE created_by_user_id=$1',[owner.id])).rows[0].count)).toBe(before);
    const cookieCreated = await creation(owner,false); expect(cookieCreated.result.statusCode).toBe(201); expect(cookieCreated.result.json().confirmedCount).toBe(1);
    const url = `/v1/games/${g.id}/publish`, key = randomUUID(), payload = {expectedVersion:g.version};
    expect((await app.inject({method:'POST',url,headers:bearer(owner),payload:{expectedVersion:g.version+1}})).statusCode).toBe(409);
    const published = await app.inject({method:'POST',url,headers:bearer(owner,key),payload}); expect(published.statusCode).toBe(200);
    expect((await app.inject({method:'POST',url,headers:bearer(owner,key),payload})).json()).toEqual(published.json());
    expect((await app.inject({url:`/v1/games/${g.id}`,headers:bearer(outsider)})).statusCode).toBe(404);
    expect((await app.inject({url:`/v1/games/${g.id}`})).statusCode).toBe(404);
    await pool.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2",[g.id,owner.id]);
    expect((await app.inject({method:'POST',url:'/v1/games',headers:created.headers,payload:created.payload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url,headers:bearer(owner,key),payload})).statusCode).toBe(403);
  });
  it('noncreator manager roster pagination, current versions, capacity, confirm/reject/remove and replay rights', async () => {
    const owner=await actor(), manager=await actor(), player=await actor(), second=await actor(), outsider=await actor();
    const draft=await creation(owner,true,{capacity:2}); expect(draft.result.statusCode).toBe(201);
    const g=await publish(owner,draft.result.json());
    await pool.query("INSERT INTO game_managers(game_id,user_id,role,status) VALUES($1,$2,'manager','active')",[g.id,manager.id]);
    const managed=await app.inject({url:'/v1/me/games?limit=1',headers:bearer(manager)}); expect(managed.statusCode).toBe(200);
    expect(managed.json().items[0]).toMatchObject({id:g.id,management:{role:'manager',createdByMe:false}});
    expect((await app.inject({url:`/v1/games/${g.id}`,headers:bearer(manager)})).statusCode).toBe(200);
    const first=await request(player,g), other=await request(second,g), roster=`/v1/games/${g.id}/participations`;
    const page=await app.inject({url:roster+'?limit=1',headers:bearer(manager)}); expect(page.statusCode).toBe(200); expect(page.json().nextCursor).toBeTruthy();
    expect((await app.inject({url:roster+'?limit=1&cursor='+encodeURIComponent(page.json().nextCursor),headers:bearer(manager)})).json().items.length).toBe(1);
    expect((await app.inject({url:roster,headers:{cookie:manager.cookie}})).json()).toEqual((await app.inject({url:roster,headers:bearer(manager)})).json());
    expect((await app.inject({url:roster,headers:bearer(outsider)})).statusCode).toBe(404);
    const confirm=`/v1/participations/${first.id}/confirm`, key=randomUUID(), payload={expectedVersion:first.version};
    expect((await app.inject({method:'POST',url:confirm,headers:bearer(manager),payload:{expectedVersion:99}})).statusCode).toBe(409);
    const accepted=await app.inject({method:'POST',url:confirm,headers:bearer(manager,key),payload}); expect(accepted.statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:confirm,headers:bearer(manager,key),payload})).json()).toEqual(accepted.json());
    expect((await app.inject({method:'POST',url:`/v1/participations/${other.id}/confirm`,headers:bearer(manager),payload:{expectedVersion:other.version}})).json().code).toBe('GAME_FULL');
    const rejected=await app.inject({method:'POST',url:`/v1/participations/${other.id}/reject`,headers:browser(manager),payload:{expectedVersion:other.version,reason:'Synthetic rejection'}}); expect(rejected.statusCode).toBe(200); expect(rejected.json().status).toBe('rejected');
    const removed=await app.inject({method:'POST',url:`/v1/participations/${first.id}/remove`,headers:bearer(manager),payload:{expectedVersion:accepted.json().version,reason:'Synthetic removal'}}); expect(removed.statusCode).toBe(200); expect(removed.json().status).toBe('removed');
    expect((await app.inject({url:`/v1/games/${g.id}`,headers:bearer(manager)})).json().availablePlaces).toBe(1);
    await pool.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2",[g.id,manager.id]);
    expect((await app.inject({url:'/v1/me/games',headers:bearer(manager)})).json().items).toEqual([]);
    expect((await app.inject({url:roster,headers:bearer(manager)})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:confirm,headers:bearer(manager,key),payload})).statusCode).toBe(403);
  });
  it('authoritative active own trainer context, no trainer seat, no invented fee; inactive trainer remains ordinary', async () => {
    const owner=await actor();
    const notTrainer=await creation(owner,true,{trainer:true}); expect(notTrainer.result.statusCode).toBe(422);
    const trainer=await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:browser(owner),payload:{selfDeclared:true,displayName:'Synthetic Trainer'}}); expect([200,201]).toContain(trainer.statusCode);
    const own=await app.inject({url:'/v1/me/trainer-profile',headers:bearer(owner)}); expect(own.statusCode).toBe(200); expect(own.json().status).toBe('active');
    expect((await app.inject({url:'/v1/me/trainer-profile',headers:{cookie:owner.cookie}})).json()).toEqual(own.json());
    expect((await app.inject({url:'/v1/me/social-profile',headers:bearer(owner)})).json().trainer).toBe(true);
    const made=await creation(owner,true,{trainer:true}); expect(made.result.statusCode).toBe(201);
    expect(made.result.json()).toMatchObject({activityKind:'trainer_led',confirmedCount:0,availablePlaces:3,trainer:{profileId:trainer.json().id},settlement:{priceStatus:'by_agreement',priceMinor:null,currency:null}});
    expect((await pool.query('SELECT 1 FROM participations WHERE game_id=$1',[made.result.json().id])).rowCount).toBe(0);
    expect((await app.inject({method:'POST',url:'/v1/me/trainer-profile/deactivate',headers:browser(owner),payload:{expectedVersion:trainer.json().version}})).statusCode).toBe(200);
    expect((await app.inject({url:'/v1/me/trainer-profile',headers:bearer(owner)})).json().status).toBe('inactive');
    expect((await app.inject({url:'/v1/me/social-profile',headers:bearer(owner)})).json().trainer).toBe(false);
    const inactive=await creation(owner,true,{trainer:true}); expect(inactive.result.statusCode).toBe(422);
  });
  it('exact eight optins preserve browser Origin/CSRF, invalid/duplicate/mixed/disabled/revoked boundaries and closed neighbors', async () => {
    const owner=await actor(), made=await creation(owner); expect(made.result.statusCode).toBe(201); const g=made.result.json();
    const routes: {method:'GET'|'POST';url:string;payload?:object}[]=[
      {method:'POST',url:'/v1/games',payload:made.payload}, {method:'POST',url:`/v1/games/${g.id}/publish`,payload:{expectedVersion:g.version}},
      {method:'GET',url:`/v1/games/${g.id}/participations`}, {method:'GET',url:'/v1/me/game-preferences'}, {method:'GET',url:'/v1/me/trainer-profile'},
      ...['confirm','reject','remove'].map(action=>({method:'POST' as const,url:`/v1/participations/${randomUUID()}/${action}`,payload:{expectedVersion:1,reason:'Synthetic reason'}})),
    ];
    for(const route of routes) {
      for(const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${'x'.repeat(43)}`]) expect((await app.inject({...route,headers:{authorization,'idempotency-key':randomUUID()}})).statusCode).toBe(401);
      expect((await app.inject({...route,headers:{Authorization:[`Bearer ${owner.accessToken}`,`Bearer ${owner.accessToken}`],'idempotency-key':randomUUID()}})).statusCode).toBe(401);
      expect((await app.inject({...route,headers:{...bearer(owner),cookie:owner.cookie}})).statusCode).toBe(403);
      expect((await disabledApp.inject({...route,headers:bearer(owner)})).statusCode).toBe(404);
      if(route.method==='POST') {
        expect((await app.inject({...route,headers:{origin,cookie:owner.cookie,'idempotency-key':randomUUID()}})).json().code).toBe('CSRF_REQUIRED');
        expect((await app.inject({...route,headers:{...browser(owner),origin:'https://evil.test'}})).json().code).toBe('ORIGIN_REJECTED');
      }
    }
    expect((await app.inject({url:'/v1/me/discovery-preference',headers:bearer(owner)})).statusCode).toBe(401);
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner),payload:{expectedVersion:1,defaultPublicGameContact:null}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:`/v1/games/${g.id}/cancel`,headers:bearer(owner),payload:{expectedVersion:g.version,reason:'Not admitted'}})).statusCode).toBe(403);
    await app.get(SessionService).revokeSession(owner.sessionId);
    for(const route of routes) expect((await app.inject({...route,headers:bearer(owner)})).statusCode).toBe(401);
  });
});
