import { execFileSync } from "node:child_process";
import path from "node:path";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type { AuthProviderAdapter } from "../../src/auth/providers/types";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { NativeSessionService } from "../../src/auth/native-session.service";
import { SessionService } from "../../src/auth/session.service";
import { GamesModule } from "../../src/games/games.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";

// Owns its migration prerequisite in the fresh per-suite disposable CI database.
// Synthetic provider only; no DEV database, provider network, SMTP or runtime configuration writes.
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("bounded native public Players principal opt-in", () => {
  let app: NestFastifyApplication, disabledApp: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  const origin = "https://localhost:3001";
  const env = loadEnv({ NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: process.env.DATABASE_URL ?? "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton",
    PUBLIC_API_ORIGIN: "https://localhost:3000", PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true", VK_CLIENT_ID: "vk-fixture", VK_CLIENT_SECRET: "vk-fixture-secret", VK_REDIRECT_URI: "https://localhost:3000/v1/auth/vk/callback", AUTH_PEPPER: "native-players-test-pepper-32chars", NATIVE_AUTH_ENABLED: "1",
    SOCIAL_DIRECTORY_ENABLED: "1", SOCIAL_DM_ENABLED: "1", CONTENT_MODERATION_PROVIDER: "fake",
    CONTENT_MODERATION_FINGERPRINT_SECRET: "native-players-synthetic-fingerprint-only",
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId: "native.fixture", redirectUris: ["https://app.example.test/auth/callback"] }]) });
  const fake: AuthProviderAdapter = {
    key: "vk", configured: true,
    async startAuthorization(input) { return { authorizationUrl: `https://provider.test/authorize?state=${input.state}` }; },
    async exchangeCode() { return { accessToken: "fake-provider-access" }; },
    async fetchVerifiedIdentity() { return { provider: "vk", issuerNamespace: "vkid:app:native-players", subject: randomUUID(), displayName: "Fixture" }; },
  };
  async function build(enabled: boolean) {
    const module = await Test.createTestingModule({ imports: [buildTestCoreModule({ ...env, NATIVE_AUTH_ENABLED: enabled }, pool), AuthModule,
      OrganizersModule, VenuesModule, GamesModule, ParticipationsModule, ProfilesModule, SafetyModule] })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES).useValue([fake]).compile();
    const instance = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await instance.register(cookie); instance.setGlobalPrefix("v1"); await instance.init(); await instance.getHttpAdapter().getInstance().ready();
    return instance;
  }
  beforeAll(async () => {
    const target = new URL(env.DATABASE_URL);
    // db-ci.sh creates a fresh gobadminton database on a disposable loopback PostGIS container for each file.
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !/^\/gobadminton(?:_[a-z0-9_]+)?$/.test(target.pathname)) {
      throw new Error("native-players requires the local disposable test database");
    }
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: env.DATABASE_URL,
        PUBLIC_API_ORIGIN: "https://localhost:3000", PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin,
        CONTENT_MODERATION_PROVIDER: "fake", CONTENT_MODERATION_FINGERPRINT_SECRET: "native-players-synthetic-fingerprint-only",
        COREPACK_ENABLE_NETWORK: "0", },
      stdio: "inherit",
    });
    pool = createDatabase(env.DATABASE_URL).pool;
    expect((await pool.query("SELECT to_regclass('native_refresh_tokens')::text AS name")).rows[0]?.name).toBe("native_refresh_tokens");
    app = await build(true); disabledApp = await build(false);
  }, 120_000);
  afterAll(async () => { await disabledApp?.close(); await app?.close(); await pool?.end(); });
  async function actor() {
    const start = await app.inject({ url: "/v1/auth/vk/start?returnPath=/games" });
    expect(start.statusCode).toBe(200);
    const state = new URL(start.json().authorizationUrl).searchParams.get("state")!;
    const header = start.headers["set-cookie"];
    const cookies = (Array.isArray(header) ? header : [header]).filter(Boolean).map(value => value!.split(";")[0]).join("; ");
    const callback = await app.inject({ url: `/v1/auth/vk/callback?code=fixture&device_id=fixture&state=${encodeURIComponent(state)}`, headers: { cookie: cookies } });
    expect(callback.statusCode).toBe(302);
    const set = callback.headers["set-cookie"];
    const browserCookie = (Array.isArray(set) ? set : [set]).find(value => value?.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0]!;
    const me = await app.inject({ url: "/v1/me", headers: { cookie: browserCookie } }); expect(me.statusCode).toBe(200);
    const id = me.json().id as string, csrfToken = me.json().csrfToken as string;
    // Fixture issuance only. Browser PKCE handoff/refresh is covered independently in native-auth.foundation.
    const issued = await app.get(NativeSessionService).transaction(client => app.get(NativeSessionService).issue(client, id, "native.fixture"));
    return { id, csrfToken, cookie: browserCookie, ...issued };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  const browser = (a: Actor, key = randomUUID()) => ({ origin, cookie: a.cookie, "x-csrf-token": a.csrfToken, "idempotency-key": key });
  const bearer = (a: Actor, key = randomUUID()) => ({ authorization: `Bearer ${a.accessToken}`, "idempotency-key": key });
  async function profile(a: Actor, displayName: string) {
    const own = await app.inject({ url: "/v1/me/social-profile", headers: { cookie: a.cookie } });
    expect(own.statusCode).toBe(200);
    const result = await app.inject({ method: "PATCH", url: "/v1/me/social-profile", headers: browser(a), payload: {
      expectedVersion: own.json().version, displayName, cityId: MOSCOW_CITY_ID, areaKey: "sokol", bio: "Игрок", socialEligible: true,
    } });
    expect([200, 201]).toContain(result.statusCode);
    let body = result.json();
    if (!body.directoryVisible) {
      const visible = await app.inject({ method: "PUT", url: "/v1/me/social-profile/visibility", headers: browser(a), payload: {
        expectedVersion: body.version, directoryVisible: true, consentPolicyVersion: "directory-mvp-v1",
      } });
      expect(visible.statusCode).toBe(200); body = visible.json();
    }
    expect(body.publicPlayerId).toBeTruthy();
    return body as { publicPlayerId: string; version: number };
  }
  it("retains anonymous/browser projections and applies native bilateral block, private404 and outsider visibility", async () => {
    const owner = await actor(), peer = await actor(), outsider = await actor();
    const ownerProfile = await profile(owner, "Native Owner"), peerProfile = await profile(peer, "Native Peer");
    await profile(outsider, "Native Outsider");
    const detail = `/v1/players/${peerProfile.publicPlayerId}`, directory = "/v1/players?name=Native&limit=50";
    const ids = (response: { json: () => { items: { publicPlayerId: string }[] } }) => response.json().items.map(p => p.publicPlayerId);
    const anonymousBefore = await app.inject({ url: detail }); expect(anonymousBefore.statusCode).toBe(200);
    const nativeBefore = await app.inject({ url: detail, headers: bearer(owner) }); expect(nativeBefore.statusCode).toBe(200);
    const cookieBefore = await app.inject({ url: detail, headers: { cookie: owner.cookie } });
    expect(cookieBefore.statusCode).toBe(200); expect(nativeBefore.json()).toEqual(cookieBefore.json());
    expect(nativeBefore.json().canRequestContact).toBe(true);
    for (const forbidden of ["userId", "email", "contacts", "publicContact", "friendship", "mutual"]) expect(nativeBefore.json()).not.toHaveProperty(forbidden);
    expect(nativeBefore.headers["cache-control"]).toBe("no-store");
    const anonymousList = await app.inject({ url: directory }); expect(anonymousList.statusCode).toBe(200);
    expect(ids(anonymousList)).toContain(peerProfile.publicPlayerId);
    const nativeList = await app.inject({ url: directory, headers: bearer(owner) }); expect(nativeList.statusCode).toBe(200);
    expect(ids(nativeList)).not.toContain(ownerProfile.publicPlayerId);
    expect(nativeList.json()).toEqual((await app.inject({ url: directory, headers: { cookie: owner.cookie } })).json());
    const block = await app.inject({ method: "PUT", url: `/v1/me/blocks/${peerProfile.publicPlayerId}`, headers: browser(owner), payload: {} });
    expect(block.statusCode).toBe(200);
    expect((await app.inject({ url: detail, headers: bearer(owner) })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/players/${ownerProfile.publicPlayerId}`, headers: bearer(peer) })).statusCode).toBe(404);
    expect((await app.inject({ url: detail, headers: { cookie: owner.cookie } })).statusCode).toBe(404);
    expect(ids(await app.inject({ url: directory, headers: bearer(owner) }))).not.toContain(peerProfile.publicPlayerId);
    expect(ids(await app.inject({ url: directory, headers: bearer(peer) }))).not.toContain(ownerProfile.publicPlayerId);
    expect((await app.inject({ url: detail })).json()).toEqual(anonymousBefore.json());
    expect((await app.inject({ url: detail, headers: bearer(outsider) })).statusCode).toBe(200);
    const hide = await app.inject({ method: "PUT", url: "/v1/me/social-profile/visibility", headers: browser(peer), payload: {
      expectedVersion: peerProfile.version, directoryVisible: false,
    } }); expect(hide.statusCode).toBe(200);
    for (const headers of [{}, bearer(outsider), { cookie: outsider.cookie }]) expect((await app.inject({ url: detail, headers })).statusCode).toBe(404);
    expect(ids(await app.inject({ url: directory, headers: bearer(outsider) }))).not.toContain(peerProfile.publicPlayerId);
  });
  it("fails closed on invalid, malformed, duplicate, mixed, revoked and disabled native authority on exactly both reads", async () => {
    const viewer = await actor(), peer = await actor(), p = await profile(peer, "Native Public");
    const routes = ["/v1/players", `/v1/players/${p.publicPlayerId}`];
    for (const url of routes) {
      for (const authorization of ["", "Basic invalid", "Bearer invalid", `Bearer ${"x".repeat(43)}`]) {
        expect((await app.inject({ url, headers: { authorization } })).statusCode).toBe(401);
      }
      expect((await app.inject({ url, headers: { Authorization: [`Bearer ${viewer.accessToken}`, `Bearer ${viewer.accessToken}`] } })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: { ...bearer(viewer), cookie: viewer.cookie } })).statusCode).toBe(403);
      expect((await disabledApp.inject({ url, headers: bearer(viewer) })).statusCode).toBe(404);
      expect((await disabledApp.inject({ url })).statusCode).toBe(200);
      expect((await disabledApp.inject({ url, headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
    }
    await app.get(SessionService).revokeSession(viewer.sessionId);
    for (const url of routes) {
      expect((await app.inject({ url, headers: bearer(viewer) })).statusCode).toBe(401);
      expect((await app.inject({ url })).statusCode).toBe(200);
    }
    // Neighbouring private read remains cookie-only: this slice grants no broader bearer surface.
    expect((await app.inject({ url: "/v1/me/discovery-preference", headers: bearer(peer) })).statusCode).toBe(401);
  });
});
