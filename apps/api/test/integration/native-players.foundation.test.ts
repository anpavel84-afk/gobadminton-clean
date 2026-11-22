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

  it("native own name/city save preserves full policies and supports authorized replay, conflict and actor isolation", async () => {
    const a = await actor(), b = await actor();
    await profile(a, "Profile Before");
    const url = "/v1/me/social-profile";
    const read = async (who: Actor) => {
      const response = await app.inject({ url, headers: bearer(who) });
      expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
      return response.json();
    };
    let before = await read(a);
    const seed = await app.inject({ method: "PATCH", url, headers: browser(a), payload: {
      expectedVersion: before.version, level: { scaleId: "future-profile-scale", scaleVersion: 7, levelId: "retained-level", provenance: "self_declared" },
      contactPolicy: "closed", socialEligible: false,
    } }); expect(seed.statusCode).toBe(200); before = seed.json();
    const hide = await app.inject({ method: "PUT", url: url + "/visibility", headers: browser(a), payload: { expectedVersion: before.version, directoryVisible: false } });
    expect(hide.statusCode).toBe(200); before = await read(a);
    const provenance = async () => (await pool.query("SELECT directory_visibility_provenance, consent_policy_version, opted_in_at, radar_consented, radar_consent_policy_version, radar_consented_at FROM player_social_profiles WHERE user_id=$1", [a.id])).rows[0];
    const priorProvenance = await provenance();
    const key = randomUUID(), payload = { expectedVersion: before.version, displayName: "Native Own Name", cityId: MOSCOW_CITY_ID };
    const save = await app.inject({ method: "PATCH", url, headers: bearer(a, key), payload });
    expect(save.statusCode).toBe(200); expect(save.headers["cache-control"]).toBe("no-store");
    const saved = save.json(); expect(saved.version).toBe(before.version + 1); expect(saved.displayName).toBe(payload.displayName); expect(saved.cityId).toBe(payload.cityId);
    for (const field of ["level", "bio", "areaKey", "directoryVisible", "contactPolicy", "socialEligible", "consentPolicyVersion", "optedInAt", "radarConsented", "radarConsentPolicyVersion", "radarConsentedAt", "lookingForGame", "trainer"]) expect(saved[field]).toEqual(before[field]);
    expect(await provenance()).toEqual(priorProvenance);
    const replay = await app.inject({ method: "PATCH", url, headers: bearer(a, key), payload });
    expect(replay.statusCode).toBe(200); expect(replay.json()).toEqual(saved); expect(await read(a)).toEqual(saved);
    const returned = { ...a, ...await app.get(NativeSessionService).transaction(client => app.get(NativeSessionService).issue(client, a.id, "native.fixture")) };
    const afterReauth = await app.inject({ method: "PATCH", url, headers: bearer(returned, key), payload });
    expect(afterReauth.statusCode).toBe(200); expect(afterReauth.json()).toEqual(saved);
    await app.get(SessionService).revokeSession(returned.sessionId);
    expect((await app.inject({ method: "PATCH", url, headers: bearer(returned, key), payload })).statusCode).toBe(401);
    const changed = await app.inject({ method: "PATCH", url, headers: bearer(a, key), payload: { ...payload, displayName: "Changed packet" } });
    expect(changed.statusCode).toBe(409); expect(changed.json().code).toMatch(/KEY_REUSED/);
    const stale = await app.inject({ method: "PATCH", url, headers: bearer(a), payload });
    expect(stale.statusCode).toBe(409); expect(stale.json().code).toBe("VERSION_CONFLICT");
    // Same key under B is B's independent mutation, never an A receipt or identity.
    const ownB = await read(b);
    const isolated = await app.inject({ method: "PATCH", url, headers: bearer(b, key), payload: { ...payload, expectedVersion: ownB.version, displayName: "Other Own Name" } });
    expect(isolated.statusCode).toBe(200); expect(isolated.json().publicPlayerId).not.toBe(saved.publicPlayerId); expect(await read(a)).toEqual(saved);
    // Deliberate repeated edit consumes the returned version.
    const next = await app.inject({ method: "PATCH", url, headers: bearer(a), payload: { ...payload, expectedVersion: saved.version, displayName: "Native Next Name" } });
    expect(next.statusCode).toBe(200); expect(next.json().version).toBe(saved.version + 1);
    const stable = await read(a);
    for (const invalid of [{ cityId: randomUUID() }, { displayName: "хуй" }, { email: "private@example.test" }, { userId: b.id }, { publicPlayerId: ownB.publicPlayerId }]) {
      const rejected = await app.inject({ method: "PATCH", url, headers: bearer(a), payload: { ...payload, expectedVersion: stable.version, ...invalid } });
      expect(rejected.statusCode).toBe(422);
      expect(rejected.json().code).toBe("cityId" in invalid ? "CITY_ID_INVALID" : "displayName" in invalid ? "PUBLIC_TEXT_CONTENT_REJECTED" : "PRIVATE_IDENTITY_NOT_ACCEPTED");
      expect(await read(a)).toEqual(stable);
    }
  });
  it("native bearer contactPolicy-only on/off readback with existing disposable fixture; no incidental profile fields", async () => {
    const a = await actor();
    await profile(a, "Policy Owner");
    const url = "/v1/me/social-profile";
    const read = async () => {
      const response = await app.inject({ url, headers: bearer(a) });
      expect(response.statusCode).toBe(200);
      return response.json();
    };
    const before = await read();
    const closeKey = randomUUID();
    const close = await app.inject({
      method: "PATCH", url, headers: bearer(a, closeKey),
      payload: { expectedVersion: before.version, contactPolicy: "closed" },
    });
    expect(close.statusCode).toBe(200);
    const closed = close.json();
    expect(closed.version).toBe(before.version + 1);
    expect(closed.contactPolicy).toBe("closed");
    expect(closed.displayName).toBe(before.displayName);
    expect(closed.cityId).toBe(before.cityId);
    expect(closed.directoryVisible).toBe(before.directoryVisible);
    expect(closed.socialEligible).toBe(before.socialEligible);
    expect(await read()).toEqual(closed);
    const replay = await app.inject({
      method: "PATCH", url, headers: bearer(a, closeKey),
      payload: { expectedVersion: before.version, contactPolicy: "closed" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(closed);
    const openKey = randomUUID();
    const open = await app.inject({
      method: "PATCH", url, headers: bearer(a, openKey),
      payload: { expectedVersion: closed.version, contactPolicy: "requests" },
    });
    expect(open.statusCode).toBe(200);
    const opened = open.json();
    expect(opened.contactPolicy).toBe("requests");
    expect(opened.version).toBe(closed.version + 1);
    expect(await read()).toEqual(opened);
    const stale = await app.inject({
      method: "PATCH", url, headers: bearer(a),
      payload: { expectedVersion: closed.version, contactPolicy: "closed" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    expect(await read()).toEqual(opened);
  });

  it("keeps own PATCH cookie Origin/CSRF and native malformed/revoked/disabled/mixed authority gates without anonymous fallback", async () => {
    const a = await actor(), inactive = await actor(), url = "/v1/me/social-profile";
    const own = await app.inject({ url, headers: bearer(a) }); expect(own.statusCode).toBe(200);
    const payload = { expectedVersion: own.json().version, displayName: "Native Gate Name", cityId: MOSCOW_CITY_ID };
    for (const authorization of ["", "Basic invalid", "Bearer invalid", `Bearer ${"x".repeat(43)}`]) {
      expect((await app.inject({ method: "PATCH", url, headers: { authorization, "idempotency-key": randomUUID() }, payload })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: "PATCH", url, headers: { Authorization: [`Bearer ${a.accessToken}`, `Bearer ${a.accessToken}`], "idempotency-key": randomUUID() }, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url, headers: { ...bearer(a), cookie: a.cookie }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url, headers: { "idempotency-key": randomUUID() }, payload })).statusCode).toBe(403);
    expect((await disabledApp.inject({ method: "PATCH", url, headers: bearer(a), payload })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url, headers: { ...browser(a), origin: "https://outside.example.test" }, payload })).statusCode).toBe(403);
    const noCsrf = { origin, cookie: a.cookie, "idempotency-key": randomUUID() };
    expect((await app.inject({ method: "PATCH", url, headers: noCsrf, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url, headers: { ...browser(a), "x-csrf-token": "invalid" }, payload })).statusCode).toBe(403);
    const cookieSave = await disabledApp.inject({ method: "PATCH", url, headers: browser(a), payload }); expect(cookieSave.statusCode).toBe(200);
    await app.get(SessionService).revokeSession(a.sessionId);
    expect((await app.inject({ method: "PATCH", url, headers: bearer(a), payload })).statusCode).toBe(401);
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [inactive.id]);
    expect((await app.inject({ method: "PATCH", url, headers: bearer(inactive), payload })).statusCode).toBe(401);
    const browserRead = await app.inject({ url, headers: { cookie: a.cookie } }); expect(browserRead.statusCode).toBe(200);
    expect(browserRead.json()).toEqual(cookieSave.json());
  });

  it("native bearer looking PUT update DELETE GET readback; cookie CSRF/Origin; replay TTL; conflicts; closed neighbors", async () => {
    const a = await actor(), inactive = await actor();
    await profile(a, "Looking Owner");
    const lookingUrl = "/v1/me/looking-for-game";
    const socialUrl = "/v1/me/social-profile";
    const readSocial = async () => {
      const response = await app.inject({ url: socialUrl, headers: bearer(a) });
      expect(response.statusCode).toBe(200);
      return response.json();
    };
    const before = await readSocial();
    expect(before.lookingForGame).toBeNull();
    const putKey = randomUUID();
    const putBody = { cityId: MOSCOW_CITY_ID, areaKey: "sokol", ttlMinutes: 60 };
    const created = await app.inject({ method: "PUT", url: lookingUrl, headers: bearer(a, putKey), payload: putBody });
    expect([200, 201]).toContain(created.statusCode);
    const createdBody = created.json();
    expect(createdBody.state).toBe("active");
    expect(createdBody.version).toBe(1);
    expect(createdBody.cityId).toBe(MOSCOW_CITY_ID);
    expect(createdBody.areaKey).toBe("sokol");
    expect(createdBody.expiresAt).toEqual(expect.any(String));
    const afterCreate = await readSocial();
    expect(afterCreate.version).toBe(before.version);
    expect(afterCreate.lookingForGame).toEqual(createdBody);
    const replay = await app.inject({ method: "PUT", url: lookingUrl, headers: bearer(a, putKey), payload: putBody });
    expect(replay.statusCode).toBe(created.statusCode);
    expect(replay.json()).toEqual(createdBody);
    expect(replay.json().expiresAt).toBe(createdBody.expiresAt);
    const updateKey = randomUUID();
    const updated = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(a, updateKey),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: "north", ttlMinutes: 180, expectedVersion: createdBody.version },
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json();
    expect(updatedBody.version).toBe(createdBody.version + 1);
    expect(updatedBody.areaKey).toBe("north");
    expect(updatedBody.state).toBe("active");
    // Real key reuse: same putKey + different body → KEY_REUSED (not a duplicate stale-version probe).
    const changedKey = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(a, putKey),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: "other", ttlMinutes: 60, expectedVersion: updatedBody.version },
    });
    expect(changedKey.statusCode).toBe(409);
    expect(changedKey.json().code).toMatch(/KEY_REUSED/);
    const stale = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(a),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: "stale", ttlMinutes: 60, expectedVersion: createdBody.version },
    });
    expect(stale.statusCode).toBe(409);
    const gps = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(a),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: null, ttlMinutes: 60, expectedVersion: updatedBody.version, latitude: 55.75 },
    });
    expect(gps.statusCode).toBe(422);
    expect(gps.json().code).toBe("RAW_LOCATION_NOT_ACCEPTED");
    const stopKey = randomUUID();
    const stopped = await app.inject({ method: "DELETE", url: lookingUrl, headers: bearer(a, stopKey), payload: {} });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json().state).toBe("inactive");
    expect(stopped.json().version).toBe(updatedBody.version + 1);
    expect((await readSocial()).lookingForGame).toEqual(stopped.json());
    const stopReplay = await app.inject({ method: "DELETE", url: lookingUrl, headers: bearer(a, stopKey), payload: {} });
    expect(stopReplay.statusCode).toBe(200);
    expect(stopReplay.json()).toEqual(stopped.json());
    const emptyStop = await app.inject({ method: "DELETE", url: lookingUrl, headers: bearer(a), payload: {} });
    expect(emptyStop.statusCode).toBe(200);
    expect(emptyStop.json().state).toBe("inactive");
    for (const authorization of ["", "Basic invalid", "Bearer invalid", `Bearer ${"x".repeat(43)}`]) {
      expect((await app.inject({ method: "PUT", url: lookingUrl, headers: { authorization, "idempotency-key": randomUUID() }, payload: putBody })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: "PUT", url: lookingUrl, headers: { Authorization: [`Bearer ${a.accessToken}`, `Bearer ${a.accessToken}`], "idempotency-key": randomUUID() }, payload: putBody })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: lookingUrl, headers: { ...bearer(a), cookie: a.cookie }, payload: putBody })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: lookingUrl, headers: { "idempotency-key": randomUUID() }, payload: {} })).statusCode).toBe(403);
    expect((await disabledApp.inject({ method: "PUT", url: lookingUrl, headers: bearer(a), payload: putBody })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: lookingUrl, headers: { ...browser(a), origin: "https://outside.example.test" }, payload: putBody })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: lookingUrl, headers: { origin, cookie: a.cookie, "idempotency-key": randomUUID() }, payload: putBody })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: lookingUrl, headers: { ...browser(a), "x-csrf-token": "invalid" }, payload: putBody })).statusCode).toBe(403);
    const neighbor = await actor();
    await profile(neighbor, "Closed Neighbor");
    // Native trainer create is admitted; management fixture owns full lifecycle/credential matrix.
    // Visibility native PUT lives in the dedicated visibility case below — do not restore old denial.
    const trainer = await app.inject({
      method: "PUT", url: "/v1/me/trainer-profile", headers: bearer(neighbor),
      payload: { selfDeclared: true, displayName: "Nope" },
    });
    expect([200, 201]).toContain(trainer.statusCode);
    expect(trainer.json()).toMatchObject({
      status: "active",
      displayName: "Nope",
      declarationSource: "self_declared",
    });
    expect(trainer.json().version).toBeGreaterThanOrEqual(1);
    const cookiePut = await disabledApp.inject({
      method: "PUT", url: lookingUrl, headers: browser(a),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: "cookie", ttlMinutes: 60 },
    });
    expect([200, 201]).toContain(cookiePut.statusCode);
    await app.get(SessionService).revokeSession(a.sessionId);
    expect((await app.inject({ method: "PUT", url: lookingUrl, headers: bearer(a), payload: putBody })).statusCode).toBe(401);
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [inactive.id]);
    expect((await app.inject({ method: "PUT", url: lookingUrl, headers: bearer(inactive), payload: putBody })).statusCode).toBe(401);
  });

  it("native bearer visibility PUT on/off/replay/stale/consent/provenance; cookie Origin/CSRF; authority gates; hide from peers", async () => {
    const a = await actor(), viewer = await actor(), inactive = await actor();
    await profile(a, "Visibility Owner");
    await profile(viewer, "Visibility Viewer");
    const url = "/v1/me/social-profile/visibility";
    const socialUrl = "/v1/me/social-profile";
    const lookingUrl = "/v1/me/looking-for-game";
    const read = async (who: Actor = a) => {
      const response = await app.inject({ url: socialUrl, headers: bearer(who) });
      expect(response.statusCode).toBe(200);
      return response.json();
    };
    const provenance = async () => (await pool.query(
      "SELECT directory_visible, directory_visibility_provenance, consent_policy_version, opted_in_at, radar_consented, radar_consent_policy_version, radar_consented_at, contact_policy FROM player_social_profiles WHERE user_id=$1",
      [a.id],
    )).rows[0];
    let before = await read();
    expect(before.directoryVisible).toBe(true);
    expect(before.publicPlayerId).toBeTruthy();
    const publicId = before.publicPlayerId as string;
    const lookingPut = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(a),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: "vis", ttlMinutes: 60 },
    });
    expect([200, 201]).toContain(lookingPut.statusCode);
    const lookingBody = lookingPut.json();
    const trainerOn = await app.inject({
      method: "PUT", url: "/v1/me/trainer-profile", headers: bearer(a),
      payload: { selfDeclared: true, displayName: "Vis Trainer" },
    });
    expect([200, 201]).toContain(trainerOn.statusCode);
    before = await read();
    // Seed actual radar consent true in synthetic owned DB so OFF/ON cannot compare false≈false.
    await pool.query(
      `UPDATE player_social_profiles
       SET radar_consented=true,
           radar_consent_policy_version='radar-mvp-v1',
           radar_consented_at=clock_timestamp()
       WHERE user_id=$1`,
      [a.id],
    );
    const priorRadar = await provenance();
    expect(priorRadar.radar_consented).toBe(true);
    expect(priorRadar.radar_consent_policy_version).toBe("radar-mvp-v1");
    expect(priorRadar.radar_consented_at).toEqual(expect.anything());
    const offKey = randomUUID();
    const off = await app.inject({
      method: "PUT", url, headers: bearer(a, offKey),
      payload: { directoryVisible: false, expectedVersion: before.version },
    });
    expect(off.statusCode).toBe(200);
    expect(off.headers["cache-control"]).toBe("no-store");
    const hidden = off.json();
    expect(hidden.directoryVisible).toBe(false);
    expect(hidden.version).toBe(before.version + 1);
    expect(hidden.contactPolicy).toBe(before.contactPolicy);
    expect(hidden.lookingForGame).toEqual(lookingBody);
    expect(hidden.trainer).toBe(true);
    const afterOff = await provenance();
    expect(afterOff.directory_visible).toBe(false);
    expect(afterOff.directory_visibility_provenance).toBe("user_opt_out");
    expect(afterOff.radar_consented).toBe(true);
    expect(afterOff.radar_consent_policy_version).toBe(priorRadar.radar_consent_policy_version);
    expect(afterOff.radar_consented_at).toEqual(priorRadar.radar_consented_at);
    expect(afterOff.contact_policy).toEqual(priorRadar.contact_policy);
    const offReplay = await app.inject({
      method: "PUT", url, headers: bearer(a, offKey),
      payload: { directoryVisible: false, expectedVersion: before.version },
    });
    expect(offReplay.statusCode).toBe(200);
    expect(offReplay.json()).toEqual(hidden);
    expect((await app.inject({ url: `/v1/players/${publicId}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/players/${publicId}`, headers: bearer(viewer) })).statusCode).toBe(404);
    expect((await read()).directoryVisible).toBe(false);
    expect((await read()).publicPlayerId).toBe(publicId);
    const stale = await app.inject({
      method: "PUT", url, headers: bearer(a),
      payload: { directoryVisible: true, expectedVersion: before.version, consentPolicyVersion: "directory-mvp-v1" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    // Null city must not block ON under Owner #448; omit consent to exercise OWNER_DEFAULT path.
    await pool.query("UPDATE player_social_profiles SET city_id=NULL, consent_policy_version=NULL, opted_in_at=NULL WHERE user_id=$1", [a.id]);
    const nullCity = await read();
    expect(nullCity.cityId).toBeNull();
    expect(nullCity.consentPolicyVersion).toBeNull();
    const onKey = randomUUID();
    const on = await app.inject({
      method: "PUT", url, headers: bearer(a, onKey),
      payload: { directoryVisible: true, expectedVersion: nullCity.version },
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().directoryVisible).toBe(true);
    expect(on.json().cityId).toBeNull();
    const onProv = await provenance();
    expect(onProv.directory_visibility_provenance).toBe("owner_default");
    expect(onProv.radar_consented).toBe(true);
    expect(onProv.radar_consent_policy_version).toBe(priorRadar.radar_consent_policy_version);
    expect(onProv.radar_consented_at).toEqual(priorRadar.radar_consented_at);
    const onReplay = await app.inject({
      method: "PUT", url, headers: bearer(a, onKey),
      payload: { directoryVisible: true, expectedVersion: nullCity.version },
    });
    expect(onReplay.statusCode).toBe(200);
    expect(onReplay.json()).toEqual(on.json());
    const withConsent = await read();
    const consentOn = await app.inject({
      method: "PUT", url, headers: bearer(a),
      payload: {
        directoryVisible: false, expectedVersion: withConsent.version,
      },
    });
    expect(consentOn.statusCode).toBe(200);
    const again = await read();
    const badConsent = await app.inject({
      method: "PUT", url, headers: bearer(a),
      payload: {
        directoryVisible: true, expectedVersion: again.version,
        consentPolicyVersion: "stale-or-unknown-policy",
      },
    });
    expect(badConsent.statusCode).toBe(422);
    expect(badConsent.json().code).toBe("CONSENT_POLICY_VERSION_INVALID");
    expect((await read()).directoryVisible).toBe(false);
    const ineligible = await actor();
    await profile(ineligible, "Ineligible Vis");
    const inOwn = await read(ineligible);
    const close = await app.inject({
      method: "PATCH", url: socialUrl, headers: bearer(ineligible),
      payload: { expectedVersion: inOwn.version, socialEligible: false },
    });
    expect(close.statusCode).toBe(200);
    const denied = await app.inject({
      method: "PUT", url, headers: bearer(ineligible),
      payload: { directoryVisible: true, expectedVersion: close.json().version },
    });
    expect(denied.statusCode).toBe(422);
    expect(denied.json().code).toBe("SOCIAL_INELIGIBLE");
    const nameless = await actor();
    let namelessOwn = await app.inject({ url: socialUrl, headers: bearer(nameless) });
    expect(namelessOwn.statusCode).toBe(200);
    // Default provisioned row may already be visible; force OFF then attempt ON with empty name.
    if (namelessOwn.json().directoryVisible) {
      const hideName = await app.inject({
        method: "PUT", url, headers: bearer(nameless),
        payload: { directoryVisible: false, expectedVersion: namelessOwn.json().version },
      });
      expect(hideName.statusCode).toBe(200);
      namelessOwn = await app.inject({ url: socialUrl, headers: bearer(nameless) });
    }
    await pool.query(
      "UPDATE player_social_profiles SET display_name='', social_eligible=true WHERE user_id=$1",
      [nameless.id],
    );
    const emptyLatest = await read(nameless);
    const emptyAttempt = await app.inject({
      method: "PUT", url, headers: bearer(nameless),
      payload: { directoryVisible: true, expectedVersion: emptyLatest.version },
    });
    expect(emptyAttempt.statusCode).toBe(422);
    expect(emptyAttempt.json().code).toBe("DIRECTORY_FIELDS_REQUIRED");
    // Fixture-only moderated stored name/bio: ON must reject via existing fake provider; profile unchanged.
    const moderated = await actor();
    await profile(moderated, "Clean Vis Name");
    let moderatedOwn = await read(moderated);
    if (moderatedOwn.directoryVisible) {
      const hideModerated = await app.inject({
        method: "PUT", url, headers: bearer(moderated),
        payload: { directoryVisible: false, expectedVersion: moderatedOwn.version },
      });
      expect(hideModerated.statusCode).toBe(200);
      moderatedOwn = await read(moderated);
    }
    await pool.query(
      "UPDATE player_social_profiles SET display_name=$2, bio=$3, social_eligible=true WHERE user_id=$1",
      [moderated.id, "хуй", "био хуй"],
    );
    const beforeModerated = await read(moderated);
    expect(beforeModerated.directoryVisible).toBe(false);
    expect(beforeModerated.displayName).toBe("хуй");
    expect(beforeModerated.bio).toBe("био хуй");
    const moderatedOn = await app.inject({
      method: "PUT", url, headers: bearer(moderated),
      payload: { directoryVisible: true, expectedVersion: beforeModerated.version },
    });
    expect(moderatedOn.statusCode).toBe(422);
    expect(moderatedOn.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    const afterModerated = await read(moderated);
    expect(afterModerated.directoryVisible).toBe(false);
    expect(afterModerated.version).toBe(beforeModerated.version);
    expect(afterModerated.displayName).toBe(beforeModerated.displayName);
    expect(afterModerated.bio).toBe(beforeModerated.bio);
    expect(afterModerated.contactPolicy).toBe(beforeModerated.contactPolicy);
    for (const authorization of ["", "Basic invalid", "Bearer invalid", `Bearer ${"x".repeat(43)}`]) {
      expect((await app.inject({
        method: "PUT", url, headers: { authorization, "idempotency-key": randomUUID() },
        payload: { directoryVisible: false, expectedVersion: 1 },
      })).statusCode).toBe(401);
    }
    expect((await app.inject({
      method: "PUT", url,
      headers: { Authorization: [`Bearer ${a.accessToken}`, `Bearer ${a.accessToken}`], "idempotency-key": randomUUID() },
      payload: { directoryVisible: false, expectedVersion: 1 },
    })).statusCode).toBe(401);
    expect((await app.inject({
      method: "PUT", url, headers: { ...bearer(a), cookie: a.cookie },
      payload: { directoryVisible: false, expectedVersion: 1 },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "PUT", url, headers: { "idempotency-key": randomUUID() },
      payload: { directoryVisible: false, expectedVersion: 1 },
    })).statusCode).toBe(403);
    expect((await disabledApp.inject({
      method: "PUT", url, headers: bearer(a),
      payload: { directoryVisible: false, expectedVersion: 1 },
    })).statusCode).toBe(404);
    expect((await app.inject({
      method: "PUT", url, headers: { ...browser(a), origin: "https://outside.example.test" },
      payload: { directoryVisible: false, expectedVersion: 1 },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "PUT", url, headers: { origin, cookie: a.cookie, "idempotency-key": randomUUID() },
      payload: { directoryVisible: false, expectedVersion: 1 },
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: "PUT", url, headers: { ...browser(a), "x-csrf-token": "invalid" },
      payload: { directoryVisible: false, expectedVersion: 1 },
    })).statusCode).toBe(403);
    const cookieActor = await actor();
    await profile(cookieActor, "Cookie Vis");
    const cookieOwn = await app.inject({ url: socialUrl, headers: { cookie: cookieActor.cookie } });
    const cookieHide = await disabledApp.inject({
      method: "PUT", url, headers: browser(cookieActor),
      payload: { directoryVisible: false, expectedVersion: cookieOwn.json().version },
    });
    expect(cookieHide.statusCode).toBe(200);
    expect(cookieHide.json().directoryVisible).toBe(false);
    // Unadmitted neighbor remains closed.
    expect((await app.inject({ url: "/v1/me/discovery-preference", headers: bearer(a) })).statusCode).toBe(401);
    await app.get(SessionService).revokeSession(a.sessionId);
    expect((await app.inject({
      method: "PUT", url, headers: bearer(a),
      payload: { directoryVisible: true, expectedVersion: 1 },
    })).statusCode).toBe(401);
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [inactive.id]);
    expect((await app.inject({
      method: "PUT", url, headers: bearer(inactive),
      payload: { directoryVisible: true, expectedVersion: 1 },
    })).statusCode).toBe(401);
  });

  it("looking PUT rejects no-profile/ineligible/invalid city without inventing eligibility", async () => {
    const bare = await actor();
    const lookingUrl = "/v1/me/looking-for-game";
    // actor() + /v1/me provisions a default social row; wipe it for a true missing-profile case.
    const wiped = await pool.query(
      "DELETE FROM player_social_profiles WHERE user_id=$1 RETURNING user_id",
      [bare.id],
    );
    expect(wiped.rowCount).toBe(1);
    const missingRow = await pool.query(
      "SELECT 1 FROM player_social_profiles WHERE user_id=$1",
      [bare.id],
    );
    expect(missingRow.rowCount).toBe(0);
    const missing = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(bare),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: null, ttlMinutes: 60 },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe("SOCIAL_PROFILE_REQUIRED");
    const eligible = await actor();
    await profile(eligible, "Eligible Looking");
    const own = await app.inject({ url: "/v1/me/social-profile", headers: bearer(eligible) });
    expect(own.statusCode).toBe(200);
    const close = await app.inject({
      method: "PATCH", url: "/v1/me/social-profile", headers: bearer(eligible),
      payload: { expectedVersion: own.json().version, socialEligible: false },
    });
    expect(close.statusCode).toBe(200);
    expect(close.json().socialEligible).toBe(false);
    const refused = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(eligible),
      payload: { cityId: MOSCOW_CITY_ID, areaKey: null, ttlMinutes: 180 },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe("SOCIAL_INELIGIBLE");
    const after = await app.inject({ url: "/v1/me/social-profile", headers: bearer(eligible) });
    expect(after.json().socialEligible).toBe(false);
    expect(after.json().lookingForGame).toBeNull();
    // putLooking asserts city before eligibility — invalid city while ineligible is still CITY_ID_INVALID.
    const badCity = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(eligible),
      payload: { cityId: randomUUID(), areaKey: null, ttlMinutes: 60 },
    });
    expect(badCity.statusCode).toBe(422);
    expect(badCity.json().code).toBe("CITY_ID_INVALID");
    const reopen = await app.inject({
      method: "PATCH", url: "/v1/me/social-profile", headers: bearer(eligible),
      payload: { expectedVersion: after.json().version, socialEligible: true },
    });
    expect(reopen.statusCode).toBe(200);
    const invalidCity = await app.inject({
      method: "PUT", url: lookingUrl, headers: bearer(eligible),
      payload: { cityId: randomUUID(), areaKey: null, ttlMinutes: 60 },
    });
    expect(invalidCity.statusCode).toBe(422);
    expect(invalidCity.json().code).toBe("CITY_ID_INVALID");
  });

});
