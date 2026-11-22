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

/**
 * Isolated #522 native cancel admission. Author does not run DB.
 * Requires NATIVE_GAME_CANCEL_TEST_DATABASE_URL loopback admin /postgres when RUN_DB_INTEGRATION=1.
 * Built on the native-game-management foundation pattern; GamesService.cancel rules unchanged.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("native game cancel · self-migrating isolated database", () => {
  let app: NestFastifyApplication, disabledApp: NestFastifyApplication;
  let pool: Pool, admin: Pool, databaseName: string;
  const origin = "https://localhost:3001", clientId = "native.cancel.fixture", redirectUri = "https://app.example.test/auth/callback";
  const env = loadEnv({ NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:15432/postgres",
    PUBLIC_API_ORIGIN: "https://localhost:3000", PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true", VK_CLIENT_ID: "vk-fixture", VK_CLIENT_SECRET: "vk-fixture-secret", VK_REDIRECT_URI: "https://localhost:3000/v1/auth/vk/callback",
    AUTH_PEPPER: "native-game-cancel-dedicated-synthetic-pepper-32chars!!", NATIVE_AUTH_ENABLED: "1",
    SOCIAL_DIRECTORY_ENABLED: "1",
    CONTENT_MODERATION_PROVIDER: "fake", CONTENT_MODERATION_FINGERPRINT_SECRET: "native-game-cancel-dedicated-synthetic-fingerprint-only",
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId, redirectUris: [redirectUri] }]) });
  const fake: AuthProviderAdapter = { key: "vk", configured: true,
    async startAuthorization(input) { return { authorizationUrl: `https://provider.test/authorize?state=${input.state}` }; },
    async exchangeCode() { return { accessToken: "synthetic-provider-access" }; },
    async fetchVerifiedIdentity() { return { provider: "vk", issuerNamespace: "vkid:app:native-game-cancel-fixture", subject: randomUUID(), displayName: "Fixture" }; },
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
    const raw = process.env.NATIVE_GAME_CANCEL_TEST_DATABASE_URL;
    if (!raw) throw Error("Set NATIVE_GAME_CANCEL_TEST_DATABASE_URL to dedicated loopback disposable PostgreSQL admin /postgres");
    const url = new URL(raw);
    if (!["postgres:","postgresql:"].includes(url.protocol) || url.search || url.hash || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) || url.pathname !== "/postgres") throw Error("Isolated fixture requires loopback admin /postgres");
    admin = new Pool({ connectionString: url.href }); databaseName = "native_game_cancel_" + randomUUID().replaceAll("-", "");
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
      if (closeErrors.length) throw new AggregateError(closeErrors, "Native game cancel fixture graceful cleanup failed");
      if (admin && databaseName) {
        if (!/^native_game_cancel_[a-f0-9]{32}$/.test(databaseName)) throw Error("Refusing cleanup of an unowned fixture database");
        const drainTimeoutMs = 5_000, deadline = Date.now() + drainTimeoutMs;
        let remainingConnections: number | undefined;
        while (true) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) throw Error(`Native game cancel fixture cleanup leak: ${remainingConnections} connections remain in ${databaseName} after ${drainTimeoutMs}ms; database was not dropped`);
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
  async function creation(owner: Actor, native = true) {
    if (!fixtureVenueId) {
      const venue = await app.inject({ method: 'POST', url: '/v1/venues', headers: browser(owner), payload: {
        cityId: MOSCOW_CITY_ID, name: 'Synthetic cancel venue '+randomUUID(), address: 'Synthetic fixture', timezone: 'Europe/Moscow', latitude: 55.75, longitude: 37.62,
      } }); expect(venue.statusCode).toBe(201);
      fixtureVenueId = venue.json().id as string;
    }
    const starts = Date.now() + 7 * 86400000;
    const payload = { venueId: fixtureVenueId, hostDisplayName: 'Synthetic host', hostPublicContact: 'telegram:@cancel_fixture',
      title: 'Synthetic cancel game', startsAt: new Date(starts).toISOString(), endsAt: new Date(starts + 7200000).toISOString(), applicationDeadlineAt: new Date(starts).toISOString(),
      timezone: 'Europe/Moscow', capacity: 3, externalReservedCount: 0, visibility: 'unlisted', formatKey: 'doubles',
      activityKind: 'regular', levelRule: { scaleId: 'ntrp', scaleVersion: 1, allowedLevelIds: ['3.0','3.5'] },
      settlement: { mode: 'external', purpose: 'no_trainer_fee', priceMinor: null, currency: null, terms: 'Venue terms outside platform' },
    };
    const key = randomUUID(), headers = native ? bearer(owner,key) : browser(owner,key);
    const result = await app.inject({ method:'POST',url:'/v1/games',headers,payload });
    return { result,payload,key,headers };
  }
  async function publish(owner: Actor, draft: { id: string; version: number }) {
    const response = await app.inject({method:'POST',url:`/v1/games/${draft.id}/publish`,headers:bearer(owner),payload:{expectedVersion:draft.version}});
    expect(response.statusCode).toBe(200); return response.json() as { id: string; version: number; status: string };
  }
  it('native bearer cancel succeeds with idempotent replay; cookie Origin/CSRF remains; mixed/disabled/unauthorized stay closed', async () => {
    const owner = await actor(), outsider = await actor();
    const made = await creation(owner); expect(made.result.statusCode).toBe(201);
    const published = await publish(owner, made.result.json());
    const url = `/v1/games/${published.id}/cancel`, key = randomUUID(), payload = { expectedVersion: published.version, reason: 'Synthetic native cancel' };
    expect((await app.inject({ method:'POST', url, headers: bearer(outsider), payload })).statusCode).toBe(403);
    expect((await app.inject({ method:'POST', url, headers: bearer(owner), payload: { expectedVersion: published.version + 1, reason: 'stale' } })).statusCode).toBe(409);
    const cancelled = await app.inject({ method:'POST', url, headers: bearer(owner, key), payload });
    expect(cancelled.statusCode).toBe(200); expect(cancelled.json()).toMatchObject({ id: published.id, status: 'cancelled' });
    expect((await app.inject({ method:'POST', url, headers: bearer(owner, key), payload })).json()).toEqual(cancelled.json());
    expect((await pool.query('SELECT status, cancel_reason FROM games WHERE id=$1',[published.id])).rows).toEqual([{ status: 'cancelled', cancel_reason: 'Synthetic native cancel' }]);

    const draft = await creation(owner); expect(draft.result.statusCode).toBe(201);
    const draftBody = draft.result.json() as { id: string; version: number };
    const cookieCancel = await app.inject({ method:'POST', url:`/v1/games/${draftBody.id}/cancel`, headers: browser(owner), payload: { expectedVersion: draftBody.version, reason: 'Cookie cancel parity' } });
    expect(cookieCancel.statusCode).toBe(200); expect(cookieCancel.json().status).toBe('cancelled');

    const next = await creation(owner); expect(next.result.statusCode).toBe(201);
    const g = await publish(owner, next.result.json());
    const route = { method:'POST' as const, url:`/v1/games/${g.id}/cancel`, payload: { expectedVersion: g.version, reason: 'Fence check' } };
    for (const authorization of ['', 'Basic invalid', 'Bearer invalid', `Bearer ${'x'.repeat(43)}`]) {
      expect((await app.inject({ ...route, headers: { authorization, 'idempotency-key': randomUUID() } })).statusCode).toBe(401);
    }
    expect((await app.inject({ ...route, headers: { ...bearer(owner), cookie: owner.cookie } })).statusCode).toBe(403);
    expect((await disabledApp.inject({ ...route, headers: bearer(owner) })).statusCode).toBe(404);
    expect((await app.inject({ ...route, headers: { origin, cookie: owner.cookie, 'idempotency-key': randomUUID() } })).json().code).toBe('CSRF_REQUIRED');
    expect((await app.inject({ ...route, headers: { ...browser(owner), origin: 'https://evil.test' } })).json().code).toBe('ORIGIN_REJECTED');
    await app.get(SessionService).revokeSession(owner.sessionId);
    expect((await app.inject({ ...route, headers: bearer(owner) })).statusCode).toBe(401);
  });
});
