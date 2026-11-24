import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { registerAvatarHttp } from "../../src/profiles/avatar-http";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";

// Dedicated loopback admin only. Never falls back to DATABASE_URL or a DEV database.
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("native game management · self-migrating isolated database", () => {
  let app: NestFastifyApplication, disabledApp: NestFastifyApplication;
  let pool: Pool, admin: Pool, databaseName: string;
  let png: Buffer;
  const origin = "https://localhost:3001", clientId = "native.management.fixture", redirectUri = "https://app.example.test/auth/callback";
  let media = "";
  const envSeed = {
    NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:15432/postgres",
    PUBLIC_API_ORIGIN: "https://localhost:3000", PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true", VK_CLIENT_ID: "vk-fixture", VK_CLIENT_SECRET: "vk-fixture-secret", VK_REDIRECT_URI: "https://localhost:3000/v1/auth/vk/callback",
    AUTH_PEPPER: "native-game-management-dedicated-synthetic-pepper-32chars", NATIVE_AUTH_ENABLED: "1",
    SOCIAL_DIRECTORY_ENABLED: "1",
    CONTENT_MODERATION_PROVIDER: "fake", CONTENT_MODERATION_FINGERPRINT_SECRET: "native-game-management-dedicated-synthetic-fingerprint-only",
    AVATAR_MEDIA_ROOT: path.join(tmpdir(), "native-game-management-foundation-media-placeholder"),
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId, redirectUris: [redirectUri] }]),
  };
  let env = loadEnv(envSeed);
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
    registerAvatarHttp(instance.getHttpAdapter().getInstance());
    await instance.register(cookie); instance.setGlobalPrefix("v1"); instance.useGlobalFilters(new ProblemExceptionFilter());
    await instance.init(); await instance.getHttpAdapter().getInstance().ready(); return instance;
  }
  beforeAll(async () => {
    const raw = process.env.NATIVE_GAME_MANAGEMENT_TEST_DATABASE_URL;
    if (!raw) throw Error("Set NATIVE_GAME_MANAGEMENT_TEST_DATABASE_URL to dedicated loopback disposable PostgreSQL admin /postgres");
    const url = new URL(raw);
    if (!["postgres:","postgresql:"].includes(url.protocol) || url.search || url.hash || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.pathname !== "/postgres") throw Error("Isolated fixture requires loopback admin /postgres");
    // One unique owned temp media directory; cleaned only in afterAll finally (DB drop preserved separately).
    media = await mkdtemp(path.join(tmpdir(), "native-game-management-foundation-media-"));
    env = loadEnv({ ...envSeed, AVATAR_MEDIA_ROOT: media });
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
    await mkdir(media, { recursive: true });
    png = await sharp(randomBytes(600 * 400 * 3), { raw: { width: 600, height: 400, channels: 3 } }).png().toBuffer();
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
    } finally {
      await admin?.end();
      if (media && media.startsWith(tmpdir()) && media.includes("native-game-management-foundation-media-")) {
        await rm(media, { recursive: true, force: true });
      }
    }
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
  async function creation(owner: Actor, native = true, options: { capacity?: number; trainer?: boolean; save?: number; visibility?: 'public' | 'unlisted' } = {}) {
    if (!fixtureVenueId) {
    const venue = await app.inject({ method: 'POST', url: '/v1/venues', headers: browser(owner), payload: {
      cityId: MOSCOW_CITY_ID, name: 'Synthetic management venue '+randomUUID(), address: 'Synthetic fixture', timezone: 'Europe/Moscow', latitude: 55.75, longitude: 37.62,
    } }); expect(venue.statusCode).toBe(201);
    fixtureVenueId = venue.json().id as string;
    }
    const starts = Date.now() + 7 * 86400000;
    const payload = { venueId: fixtureVenueId, hostDisplayName: 'Synthetic host', hostPublicContact: 'telegram:@management_fixture',
      title: 'Synthetic management game', startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 7200000).toISOString(), applicationDeadlineAt: new Date(starts).toISOString(),
      timezone: 'Europe/Moscow', capacity: options.capacity ?? 3, externalReservedCount: 0, visibility: options.visibility ?? 'unlisted', formatKey: 'doubles',
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
    expect((await app.inject({url:roster,headers:bearer(manager)})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:confirm,headers:bearer(manager,key),payload})).statusCode).toBe(403);
  });
  it('authoritative active own trainer context, native create/edit/off/reactivate CAS/replay; inactive denies new trainer-led create; old management remains', async () => {
    const owner=await actor();
    const notTrainer=await creation(owner,true,{trainer:true}); expect(notTrainer.result.statusCode).toBe(422);
    const createKey=randomUUID(), createPayload={selfDeclared:true,displayName:'Synthetic Trainer',bio:'About'};
    const created=await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner,createKey),payload:createPayload});
    expect([200,201]).toContain(created.statusCode);
    expect(created.json()).toMatchObject({status:'active',displayName:'Synthetic Trainer',bio:'About',declarationSource:'self_declared'});
    expect(created.json().version).toBeGreaterThanOrEqual(1);
    expect((await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner,createKey),payload:createPayload})).json()).toEqual(created.json());
    const own=await app.inject({url:'/v1/me/trainer-profile',headers:bearer(owner)}); expect(own.statusCode).toBe(200); expect(own.json()).toEqual(created.json());
    expect((await app.inject({url:'/v1/me/trainer-profile',headers:{cookie:owner.cookie}})).json()).toEqual(own.json());
    expect((await app.inject({url:'/v1/me/social-profile',headers:bearer(owner)})).json().trainer).toBe(true);
    expect((await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner),payload:{selfDeclared:true,displayName:'Stale',expectedVersion:own.json().version+1}})).statusCode).toBe(409);
    const editKey=randomUUID(), editPayload={selfDeclared:true,displayName:'Edited Trainer',bio:null,expectedVersion:own.json().version};
    const edited=await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner,editKey),payload:editPayload});
    expect([200,201]).toContain(edited.statusCode);
    expect(edited.json()).toMatchObject({status:'active',displayName:'Edited Trainer',bio:null});
    expect(edited.json().version).toBeGreaterThan(own.json().version);
    expect((await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner,editKey),payload:editPayload})).json()).toEqual(edited.json());
    expect((await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner),payload:{selfDeclared:false,displayName:'No'}})).statusCode).toBe(422);
    const made=await creation(owner,true,{trainer:true}); expect(made.result.statusCode).toBe(201);
    expect(made.result.json()).toMatchObject({activityKind:'trainer_led',confirmedCount:0,availablePlaces:3,trainer:{profileId:created.json().id},settlement:{priceStatus:'by_agreement',priceMinor:null,currency:null}});
    expect((await pool.query('SELECT 1 FROM participations WHERE game_id=$1',[made.result.json().id])).rowCount).toBe(0);
    const offKey=randomUUID(), offPayload={expectedVersion:edited.json().version};
    const off=await app.inject({method:'POST',url:'/v1/me/trainer-profile/deactivate',headers:bearer(owner,offKey),payload:offPayload});
    expect(off.statusCode).toBe(200); expect(off.json().status).toBe('inactive');
    expect((await app.inject({method:'POST',url:'/v1/me/trainer-profile/deactivate',headers:bearer(owner,offKey),payload:offPayload})).json()).toEqual(off.json());
    expect((await app.inject({url:'/v1/me/trainer-profile',headers:bearer(owner)})).json().status).toBe('inactive');
    expect((await app.inject({url:'/v1/me/social-profile',headers:bearer(owner)})).json().trainer).toBe(false);
    const inactive=await creation(owner,true,{trainer:true}); expect(inactive.result.statusCode).toBe(422);
    expect((await app.inject({url:`/v1/games/${made.result.json().id}`,headers:bearer(owner)})).statusCode).toBe(200);
    const reactivateKey=randomUUID(), reactivatePayload={selfDeclared:true,displayName:'Back On',bio:'Again',expectedVersion:off.json().version};
    const on=await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner,reactivateKey),payload:reactivatePayload});
    expect([200,201]).toContain(on.statusCode); expect(on.json().status).toBe('active');
    expect((await app.inject({method:'PUT',url:'/v1/me/trainer-profile',headers:bearer(owner,reactivateKey),payload:reactivatePayload})).json()).toEqual(on.json());
    expect((await app.inject({url:'/v1/me/social-profile',headers:bearer(owner)})).json().trainer).toBe(true);
    const remade=await creation(owner,true,{trainer:true}); expect(remade.result.statusCode).toBe(201);
  });
  it('exact ten LOCAL fixture optins preserve browser Origin/CSRF on every mutation, invalid/duplicate/mixed/disabled/revoked boundaries and closed neighbors', async () => {
    const owner=await actor(), made=await creation(owner); expect(made.result.statusCode).toBe(201); const g=made.result.json();
    const routes: {method:'GET'|'POST'|'PUT';url:string;payload?:object}[]=[
      {method:'POST',url:'/v1/games',payload:made.payload}, {method:'POST',url:`/v1/games/${g.id}/publish`,payload:{expectedVersion:g.version}},
      {method:'GET',url:`/v1/games/${g.id}/participations`}, {method:'GET',url:'/v1/me/game-preferences'}, {method:'GET',url:'/v1/me/trainer-profile'},
      {method:'PUT',url:'/v1/me/trainer-profile',payload:{selfDeclared:true,displayName:'Optin Trainer'}},
      {method:'POST',url:'/v1/me/trainer-profile/deactivate',payload:{expectedVersion:1}},
      ...['confirm','reject','remove'].map(action=>({method:'POST' as const,url:`/v1/participations/${randomUUID()}/${action}`,payload:{expectedVersion:1,reason:'Synthetic reason'}})),
    ];
    expect(routes).toHaveLength(10);
    for(const route of routes) {
      for(const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${'x'.repeat(43)}`]) expect((await app.inject({...route,headers:{authorization,'idempotency-key':randomUUID()}})).statusCode).toBe(401);
      expect((await app.inject({...route,headers:{Authorization:[`Bearer ${owner.accessToken}`,`Bearer ${owner.accessToken}`],'idempotency-key':randomUUID()}})).statusCode).toBe(401);
      expect((await app.inject({...route,headers:{...bearer(owner),cookie:owner.cookie}})).statusCode).toBe(403);
      expect((await disabledApp.inject({...route,headers:bearer(owner)})).statusCode).toBe(404);
      if(route.method==='POST' || route.method==='PUT') {
        expect((await app.inject({...route,headers:{origin,cookie:owner.cookie,'idempotency-key':randomUUID()}})).json().code).toBe('CSRF_REQUIRED');
        expect((await app.inject({...route,headers:{...browser(owner),origin:'https://evil.test'}})).json().code).toBe('ORIGIN_REJECTED');
      }
    }
    expect((await app.inject({url:'/v1/me/discovery-preference',headers:bearer(owner)})).statusCode).toBe(401);
    // PATCH /me/game-preferences is native-opted via requirePrincipalMutation; closed cancel neighbor stays 403.
    expect((await app.inject({method:'POST',url:`/v1/games/${g.id}/cancel`,headers:bearer(owner),payload:{expectedVersion:g.version,reason:'Not admitted'}})).statusCode).toBe(403);
    await app.get(SessionService).revokeSession(owner.sessionId);
    for(const route of routes) expect((await app.inject({...route,headers:bearer(owner)})).statusCode).toBe(401);
  });
  it('native bearer court-booking GET/PUT: manager+participant read, write/replay/CAS, revocation, cookie CSRF, bearer boundaries; closed cancel neighbor', async () => {
    // Prior suite cases mint many native transaction actors against the shared fixture IP budget.
    await pool.query('DELETE FROM native_auth_budgets');
    const owner = await actor(), player = await actor(), outsider = await actor();
    const made = await creation(owner); expect(made.result.statusCode).toBe(201);
    const g = await publish(owner, made.result.json());
    const pending = await request(player, g);
    const confirm = await app.inject({
      method: 'POST', url: `/v1/participations/${pending.id}/confirm`,
      headers: bearer(owner), payload: { expectedVersion: pending.version },
    });
    expect(confirm.statusCode).toBe(200);
    const url = `/v1/games/${g.id}/court-booking`;
    const managerGet = await app.inject({ url, headers: bearer(owner) });
    expect(managerGet.statusCode).toBe(200);
    expect(managerGet.json()).toMatchObject({
      gameId: g.id, status: 'unspecified', version: 0, updatedAt: null,
      declarationSource: 'organizer_declared', allowedActions: { canUpdate: true },
    });
    expect((await app.inject({ url, headers: { cookie: owner.cookie } })).json()).toEqual(managerGet.json());
    const participantGet = await app.inject({ url, headers: bearer(player) });
    expect(participantGet.statusCode).toBe(200);
    expect(participantGet.json()).toMatchObject({ status: 'unspecified', version: 0, allowedActions: { canUpdate: false } });
    expect((await app.inject({ url, headers: bearer(outsider) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url, headers: bearer(player), payload: { expectedVersion: 0, status: 'arranging' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url, headers: bearer(outsider), payload: { expectedVersion: 0, status: 'arranging' } })).statusCode).toBe(404);
    const key = randomUUID(), payload = { expectedVersion: 0, status: 'arranging' as const };
    const written = await app.inject({ method: 'PUT', url, headers: bearer(owner, key), payload });
    expect(written.statusCode).toBe(200);
    expect(written.json()).toMatchObject({ status: 'arranging', version: 1, allowedActions: { canUpdate: true } });
    expect((await app.inject({ method: 'PUT', url, headers: bearer(owner, key), payload })).json()).toEqual(written.json());
    expect((await app.inject({ method: 'PUT', url, headers: bearer(owner, key), payload: { expectedVersion: 0, status: 'not_arranged' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url, headers: bearer(owner), payload: { expectedVersion: 0, status: 'organizer_confirmed' } })).statusCode).toBe(409);
    const cookieKey = randomUUID();
    expect((await app.inject({ method: 'PUT', url, headers: { origin, cookie: owner.cookie, 'idempotency-key': cookieKey }, payload: { expectedVersion: 1, status: 'organizer_confirmed' } })).json().code).toBe('CSRF_REQUIRED');
    expect((await app.inject({ method: 'PUT', url, headers: { ...browser(owner), origin: 'https://evil.test' }, payload: { expectedVersion: 1, status: 'organizer_confirmed' } })).json().code).toBe('ORIGIN_REJECTED');
    const cookiePut = await app.inject({ method: 'PUT', url, headers: browser(owner), payload: { expectedVersion: 1, status: 'organizer_confirmed' } });
    expect(cookiePut.statusCode).toBe(200);
    expect(cookiePut.json()).toMatchObject({ status: 'organizer_confirmed', version: 2 });
    expect((await app.inject({ method: 'PUT', url, headers: { ...bearer(owner), cookie: owner.cookie }, payload: { expectedVersion: 2, status: 'not_arranged' } })).statusCode).toBe(403);
    // Explicit Authorization + valid cookie: CREDENTIALS_CONFLICT before bearer shape (no cookie fallback).
    const mixedGet = await app.inject({ url, headers: { authorization: 'Bearer invalid', cookie: owner.cookie } });
    expect(mixedGet.statusCode).toBe(403);
    expect(mixedGet.json().code).toBe('CREDENTIALS_CONFLICT');
    const mixedPut = await app.inject({
      method: 'PUT', url,
      headers: { authorization: 'Bearer invalid', cookie: owner.cookie, 'idempotency-key': randomUUID() },
      payload: { expectedVersion: 2, status: 'not_arranged' },
    });
    expect(mixedPut.statusCode).toBe(403);
    expect(mixedPut.json().code).toBe('CREDENTIALS_CONFLICT');
    for (const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${'x'.repeat(43)}`]) {
      expect((await app.inject({ url, headers: { authorization } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'PUT', url, headers: { authorization, 'idempotency-key': randomUUID() }, payload: { expectedVersion: 2, status: 'not_arranged' } })).statusCode).toBe(401);
    }
    expect((await disabledApp.inject({ url, headers: bearer(owner) })).statusCode).toBe(404);
    expect((await disabledApp.inject({ method: 'PUT', url, headers: bearer(owner), payload: { expectedVersion: 2, status: 'not_arranged' } })).statusCode).toBe(404);
    // Closed neighbor stays cookie-only / bearer-denied.
    expect((await app.inject({ method: 'POST', url: `/v1/games/${g.id}/cancel`, headers: bearer(owner), payload: { expectedVersion: g.version, reason: 'Not admitted' } })).statusCode).toBe(403);
    await pool.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2", [g.id, owner.id]);
    expect((await app.inject({ method: 'PUT', url, headers: bearer(owner, key), payload })).statusCode).toBe(403);
    // Creator remains confirmed participant → readonly GET retained.
    const revokedGet = await app.inject({ url, headers: bearer(owner) });
    expect(revokedGet.statusCode).toBe(200);
    expect(revokedGet.json()).toMatchObject({ status: 'organizer_confirmed', version: 2, allowedActions: { canUpdate: false } });
    await app.get(SessionService).revokeSession(owner.sessionId);
    expect((await app.inject({ url, headers: bearer(owner) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url, headers: bearer(owner), payload: { expectedVersion: 2, status: 'not_arranged' } })).statusCode).toBe(401);
  });
  it('native bearer game-cover GET/PUT/DELETE: manager rights, private media, replay/CAS, cookie CSRF, bearer boundaries', async () => {
    await pool.query('DELETE FROM native_auth_budgets');
    const owner = await actor(), player = await actor(), outsider = await actor(), manager = await actor();
    const made = await creation(owner); expect(made.result.statusCode).toBe(201);
    const draft = made.result.json() as { id: string; version: number; status: string };
    const coverUrl = `/v1/games/${draft.id}/cover`;
    const coverGet = await app.inject({ url: coverUrl, headers: bearer(owner) });
    expect(coverGet.statusCode).toBe(200);
    expect(coverGet.json()).toMatchObject({ version: draft.version, hasCover: false });
    expect((await app.inject({ url: coverUrl, headers: { cookie: owner.cookie } })).json()).toEqual(coverGet.json());
    expect((await app.inject({ url: coverUrl, headers: bearer(outsider) })).statusCode).toBe(404);
    expect((await app.inject({ url: coverUrl, headers: bearer(player) })).statusCode).toBe(404);
    const putKey = randomUUID();
    const putHeaders = { ...bearer(owner, putKey), 'x-game-version': String(draft.version), 'content-type': 'image/png' };
    const saved = await app.inject({ method: 'PUT', url: coverUrl, headers: putHeaders, payload: png });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ hasCover: true, version: draft.version + 1 });
    const ownUrl = saved.json().cover.uploadedUrl as string;
    expect(ownUrl).toMatch(/^\/v1\/media\/game-covers\/[a-f0-9]{64}\.png$/);
    expect((await app.inject({ method: 'PUT', url: coverUrl, headers: putHeaders, payload: png })).json()).toEqual(saved.json());
    expect((await app.inject({ method: 'PUT', url: coverUrl, headers: { ...bearer(owner), 'x-game-version': String(draft.version), 'content-type': 'image/png' }, payload: png })).statusCode).toBe(409);
    // Same-key changed packet rejection (different bytes, same Idempotency-Key).
    const otherPng = await sharp(randomBytes(600 * 400 * 3), { raw: { width: 600, height: 400, channels: 3 } }).png().toBuffer();
    expect((await app.inject({ method: 'PUT', url: coverUrl, headers: putHeaders, payload: otherPng })).statusCode).toBe(409);
    // Draft private media: bearer manager 200; anonymous 404; Vary includes Authorization.
    const mediaBearer = await app.inject({ url: ownUrl, headers: { authorization: `Bearer ${owner.accessToken}` } });
    expect(mediaBearer.statusCode, mediaBearer.body).toBe(200);
    expect(mediaBearer.headers.vary).toBe('Authorization, Cookie, Accept');
    expect((await app.inject({ url: ownUrl })).statusCode).toBe(404);
    expect((await app.inject({ url: ownUrl, headers: bearer(outsider) })).statusCode).toBe(404);
    // Exact-media invalid/empty/mixed bearer + disabled transport.
    for (const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${'x'.repeat(43)}`]) {
      expect((await app.inject({ url: ownUrl, headers: { authorization } })).statusCode).toBe(401);
    }
    expect((await app.inject({
      url: ownUrl,
      headers: { authorization: `Bearer ${owner.accessToken}`, cookie: owner.cookie },
    })).statusCode).toBe(403);
    expect((await disabledApp.inject({ url: ownUrl, headers: { authorization: `Bearer ${owner.accessToken}` } })).statusCode).toBe(404);
    // Non-owner manager permit vs participant denial on draft private media.
    await pool.query("INSERT INTO game_managers(game_id,user_id,role,status) VALUES($1,$2,'manager','active')", [draft.id, manager.id]);
    expect((await app.inject({ url: ownUrl, headers: { authorization: `Bearer ${manager.accessToken}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: ownUrl, headers: bearer(player) })).statusCode).toBe(404);
    const cookieKey = randomUUID();
    expect((await app.inject({
      method: 'PUT', url: coverUrl,
      headers: { origin, cookie: owner.cookie, 'idempotency-key': cookieKey, 'x-game-version': String(saved.json().version), 'content-type': 'image/png' },
      payload: png,
    })).json().code).toBe('CSRF_REQUIRED');
    expect((await app.inject({
      method: 'PUT', url: coverUrl,
      headers: { ...browser(owner), origin: 'https://evil.test', 'x-game-version': String(saved.json().version), 'content-type': 'image/png' },
      payload: png,
    })).json().code).toBe('ORIGIN_REJECTED');
    expect((await app.inject({
      method: 'PUT', url: coverUrl,
      headers: { ...bearer(owner), cookie: owner.cookie, 'x-game-version': String(saved.json().version), 'content-type': 'image/png' },
      payload: png,
    })).statusCode).toBe(403);
    for (const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${'x'.repeat(43)}`]) {
      expect((await app.inject({ url: coverUrl, headers: { authorization } })).statusCode).toBe(401);
      expect((await app.inject({
        method: 'PUT', url: coverUrl,
        headers: { authorization, 'idempotency-key': randomUUID(), 'x-game-version': String(saved.json().version), 'content-type': 'image/png' },
        payload: png,
      })).statusCode).toBe(401);
    }
    expect((await disabledApp.inject({ url: coverUrl, headers: bearer(owner) })).statusCode).toBe(404);
    const delKey = randomUUID(), delVersion = saved.json().version as number;
    const removed = await app.inject({
      method: 'DELETE', url: coverUrl,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'idempotency-key': delKey,
        'x-game-version': String(delVersion),
        'content-type': 'application/json',
      },
      payload: { expectedVersion: delVersion },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toMatchObject({ hasCover: false });
    expect((await app.inject({
      method: 'DELETE', url: coverUrl,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'idempotency-key': delKey,
        'x-game-version': String(delVersion),
        'content-type': 'application/json',
      },
      payload: { expectedVersion: delVersion },
    })).json()).toEqual(removed.json());
    // Public published anonymous 200 vs private draft 404 (above); replace cover then publish public.
    const publicMade = await creation(owner, true, { visibility: 'public' });
    expect(publicMade.result.statusCode).toBe(201);
    const publicDraft = publicMade.result.json() as { id: string; version: number };
    const publicCoverUrl = `/v1/games/${publicDraft.id}/cover`;
    const publicPutKey = randomUUID();
    const publicSaved = await app.inject({
      method: 'PUT', url: publicCoverUrl,
      headers: { ...bearer(owner, publicPutKey), 'x-game-version': String(publicDraft.version), 'content-type': 'image/png' },
      payload: png,
    });
    expect(publicSaved.statusCode, publicSaved.body).toBe(200);
    const publicMediaUrl = publicSaved.json().cover.uploadedUrl as string;
    expect((await app.inject({ url: publicMediaUrl })).statusCode).toBe(404); // still draft → private
    const published = await publish(owner, { id: publicDraft.id, version: publicSaved.json().version as number });
    expect(published.id).toBe(publicDraft.id);
    expect((await app.inject({ url: publicMediaUrl })).statusCode).toBe(200); // public published anonymous
    await pool.query("UPDATE game_managers SET status='revoked' WHERE game_id=$1 AND user_id=$2", [draft.id, owner.id]);
    expect((await app.inject({
      method: 'PUT', url: coverUrl,
      headers: { ...bearer(owner, putKey), 'x-game-version': String(draft.version), 'content-type': 'image/png' },
      payload: png,
    })).statusCode).toBe(403);
    await app.get(SessionService).revokeSession(owner.sessionId);
    expect((await app.inject({ url: coverUrl, headers: bearer(owner) })).statusCode).toBe(401);
  });
  it('native bearer game-preferences PATCH lifecycle: save/remove, CAS409, key replay/mismatch, cookie CSRF and revoked bearer', async () => {
    const owner = await actor(), outsider = await actor();
    const empty = await app.inject({url:'/v1/me/game-preferences',headers:bearer(owner)});
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({version:0,defaultPublicGameContact:null});
    const saveKey = randomUUID(), savePayload = {expectedVersion:0,defaultPublicGameContact:'telegram:@native_pref'};
    const saved = await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner,saveKey),payload:savePayload});
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({version:1,defaultPublicGameContact:'telegram:@native_pref'});
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner,saveKey),payload:savePayload})).json()).toEqual(saved.json());
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner,saveKey),payload:{expectedVersion:0,defaultPublicGameContact:'telegram:@other'}})).statusCode).toBe(409);
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner),payload:{expectedVersion:0,defaultPublicGameContact:'telegram:@stale'}})).statusCode).toBe(409);
    const cookieKey = randomUUID();
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:{origin,cookie:owner.cookie,'idempotency-key':cookieKey},payload:{expectedVersion:1,defaultPublicGameContact:null}})).json().code).toBe('CSRF_REQUIRED');
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:{...browser(owner),origin:'https://evil.test'},payload:{expectedVersion:1,defaultPublicGameContact:null}})).json().code).toBe('ORIGIN_REJECTED');
    const cookieRemove = await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:browser(owner),payload:{expectedVersion:1,defaultPublicGameContact:'telegram:@cookie_path'}});
    expect(cookieRemove.statusCode).toBe(200);
    expect(cookieRemove.json()).toEqual({version:2,defaultPublicGameContact:'telegram:@cookie_path'});
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:{...bearer(owner),cookie:owner.cookie},payload:{expectedVersion:2,defaultPublicGameContact:null}})).statusCode).toBe(403);
    for (const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${'x'.repeat(43)}`]) {
      expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:{authorization,'idempotency-key':randomUUID()},payload:{expectedVersion:2,defaultPublicGameContact:null}})).statusCode).toBe(401);
    }
    expect((await disabledApp.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner),payload:{expectedVersion:2,defaultPublicGameContact:null}})).statusCode).toBe(404);
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(outsider),payload:{expectedVersion:2,defaultPublicGameContact:null}})).statusCode).toBe(409);
    const removeKey = randomUUID(), removePayload = {expectedVersion:2,defaultPublicGameContact:null};
    const removed = await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner,removeKey),payload:removePayload});
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({version:3,defaultPublicGameContact:null});
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner,removeKey),payload:removePayload})).json()).toEqual(removed.json());
    expect((await app.inject({url:'/v1/me/game-preferences',headers:bearer(owner)})).json()).toEqual(removed.json());
    await app.get(SessionService).revokeSession(owner.sessionId);
    expect((await app.inject({method:'PATCH',url:'/v1/me/game-preferences',headers:bearer(owner),payload:{expectedVersion:3,defaultPublicGameContact:'telegram:@revoked'}})).statusCode).toBe(401);
  });
});
