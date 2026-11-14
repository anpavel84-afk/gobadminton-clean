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

// Existing disposable PostGIS harness must migrate through 0072 first. Never run against DEV.
// No migration, SMTP, real OAuth, network provider, or deployment is invoked by this suite.
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("bounded native participation principal opt-in", () => {
  let app: NestFastifyApplication, disabledApp: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  const origin = "https://localhost:3001";
  const env = loadEnv({ NODE_ENV: "test", APP_ENV: "local", DATABASE_URL: process.env.DATABASE_URL ?? "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton",
    PUBLIC_API_ORIGIN: "https://localhost:3000", PUBLIC_WEB_ORIGIN: origin, ALLOWED_WEB_ORIGINS: origin,
    COOKIE_SECURE: "true", VK_CLIENT_ID: "vk-fixture", VK_CLIENT_SECRET: "vk-fixture-secret", VK_REDIRECT_URI: "https://localhost:3000/v1/auth/vk/callback", AUTH_PEPPER: "native-participation-test-pepper-32chars", NATIVE_AUTH_ENABLED: "1",
    CONTENT_MODERATION_PROVIDER: "fake",
    CONTENT_MODERATION_FINGERPRINT_SECRET: "native-participation-synthetic-fingerprint-only",
    NATIVE_AUTH_CLIENTS_JSON: JSON.stringify([{ clientId: "native.fixture", redirectUris: ["https://app.example.test/auth/callback"] }]) });
  const fake: AuthProviderAdapter = {
    key: "vk", configured: true,
    async startAuthorization(input) { return { authorizationUrl: `https://provider.test/authorize?state=${input.state}` }; },
    async exchangeCode() { return { accessToken: "fake-provider-access" }; },
    async fetchVerifiedIdentity() { return { provider: "vk", issuerNamespace: "vkid:app:native-participation", subject: randomUUID(), displayName: "Fixture" }; },
  };
  async function build(enabled: boolean) {
    const module = await Test.createTestingModule({ imports: [buildTestCoreModule({ ...env, NATIVE_AUTH_ENABLED: enabled }, pool), AuthModule,
      OrganizersModule, VenuesModule, GamesModule, ParticipationsModule] })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES).useValue([fake]).compile();
    const instance = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await instance.register(cookie); instance.setGlobalPrefix("v1"); await instance.init(); await instance.getHttpAdapter().getInstance().ready();
    return instance;
  }
  beforeAll(async () => {
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
  it("bearer reads/request/withdraw retain ownership, idempotency, version/capacity and cookie-only manager boundaries", async () => {
    const owner = await actor(), player = await actor(), stranger = await actor(), g = await game(owner, 1);
    const managed = await app.inject({ url: "/v1/me/games", headers: bearer(owner) });
    expect(managed.statusCode).toBe(200); expect(managed.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ id: g.id, management: { role: "owner", createdByMe: true } })]));
    expect((await app.inject({ url: "/v1/me/games", headers: bearer(player) })).json().items.some((row: { id: string }) => row.id === g.id)).toBe(false);
    const url = `/v1/games/${g.id}/participations`, key = randomUUID(), payload = { expectedGameVersion: g.version };
    const requested = await app.inject({ method: "POST", url, headers: bearer(player, key), payload });
    expect(requested.statusCode).toBe(201); const part = requested.json(); expect(part.status).toBe("pending");
    expect((await app.inject({ url: `/v1/games/${g.id}` })).json().availablePlaces).toBe(1);
    expect((await app.inject({ method: "POST", url, headers: bearer(player, key), payload })).json()).toEqual(part);
    expect((await app.inject({ method: "POST", url, headers: bearer(player, key), payload: { expectedGameVersion: g.version + 1 } })).statusCode).toBe(409);
    expect((await app.inject({ url: "/v1/me/participations?limit=1", headers: bearer(player) })).json().items).toContainEqual(part);
    expect((await app.inject({ url: `/v1/games/${g.id}/participations`, headers: bearer(owner) })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/v1/participations/${part.id}/confirm`, headers: bearer(owner), payload: { expectedVersion: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/participations/${part.id}/withdraw`, headers: bearer(stranger), payload: { expectedVersion: 1 } })).statusCode).toBe(404);
    const confirmed = await app.inject({ method: "POST", url: `/v1/participations/${part.id}/confirm`, headers: browser(owner), payload: { expectedVersion: part.version } });
    expect(confirmed.statusCode).toBe(200);
    const current = (await app.inject({ url: `/v1/games/${g.id}` })).json(); expect(current.availablePlaces).toBe(0);
    const full = await app.inject({ method: "POST", url, headers: bearer(stranger), payload: { expectedGameVersion: current.version } });
    expect(full.statusCode).toBe(409); expect(full.json().code).toBe("GAME_FULL");
    expect((await app.inject({ method: "POST", url, headers: bearer(stranger), payload: { expectedGameVersion: g.version } })).json().code).toBe("VERSION_CONFLICT");
    const withdraw = `/v1/participations/${part.id}/withdraw`;
    expect((await app.inject({ method: "POST", url: withdraw, headers: bearer(player), payload: { expectedVersion: 1 } })).statusCode).toBe(409);
    const withdrawn = await app.inject({ method: "POST", url: withdraw, headers: bearer(player), payload: { expectedVersion: confirmed.json().version } });
    expect(withdrawn.statusCode).toBe(200); expect(withdrawn.json().status).toBe("withdrawn");
    const fresh = (await app.inject({ url: `/v1/games/${g.id}` })).json();
    const pending = await app.inject({ method: "POST", url, headers: bearer(player), payload: { expectedGameVersion: fresh.version } }); expect(pending.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: withdraw, headers: bearer(player), payload: { expectedVersion: pending.json().version } })).json().status).toBe("withdrawn");
  });
  it("authorizes own draft and unlisted participation detail without exposing private games to outsiders or removed participants", async () => {
    const owner = await actor(), player = await actor(), outsider = await actor();
    const draft = await game(owner, 2, { draft: true });
    const draftUrl = `/v1/games/${draft.id}`;
    expect((await app.inject({ url: draftUrl, headers: bearer(owner) })).statusCode).toBe(200);
    expect((await app.inject({ url: draftUrl, headers: { cookie: owner.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: draftUrl, headers: bearer(outsider) })).statusCode).toBe(404);
    expect((await app.inject({ url: draftUrl })).statusCode).toBe(404);
    const g = await game(owner, 2, { visibility: "unlisted" }), url = `/v1/games/${g.id}`;
    expect((await app.inject({ url })).statusCode).toBe(404);
    expect((await app.inject({ url, headers: bearer(outsider) })).statusCode).toBe(404);
    const requested = await app.inject({ method: "POST", url: `${url}/participations`, headers: bearer(player), payload: { expectedGameVersion: g.version } });
    expect(requested.statusCode).toBe(201); const part = requested.json();
    expect((await app.inject({ url, headers: bearer(player) })).statusCode).toBe(200);
    const confirmed = await app.inject({ method: "POST", url: `/v1/participations/${part.id}/confirm`, headers: browser(owner), payload: { expectedVersion: part.version } });
    expect(confirmed.statusCode).toBe(200);
    expect((await app.inject({ url, headers: bearer(player) })).statusCode).toBe(200);
    const withdrawn = await app.inject({ method: "POST", url: `/v1/participations/${part.id}/withdraw`, headers: bearer(player), payload: { expectedVersion: confirmed.json().version } });
    expect(withdrawn.statusCode).toBe(200);
    expect((await app.inject({ url, headers: bearer(player) })).statusCode).toBe(200);
    const current = (await app.inject({ url, headers: bearer(owner) })).json();
    const again = await app.inject({ method: "POST", url: `${url}/participations`, headers: bearer(player), payload: { expectedGameVersion: current.version } });
    expect(again.statusCode).toBe(201);
    const confirmedAgain = await app.inject({ method: "POST", url: `/v1/participations/${again.json().id}/confirm`, headers: browser(owner), payload: { expectedVersion: again.json().version } });
    expect(confirmedAgain.statusCode).toBe(200);
    const removed = await app.inject({ method: "POST", url: `/v1/participations/${again.json().id}/remove`, headers: browser(owner), payload: { expectedVersion: confirmedAgain.json().version, reason: "Fixture removal" } });
    expect(removed.statusCode).toBe(200);
    expect((await app.inject({ url, headers: bearer(player) })).statusCode).toBe(404);
    expect((await app.inject({ url, headers: bearer(owner) })).statusCode).toBe(200);
  });
  it("preserves browser CSRF/Origin and rejects invalid/mixed/revoked/disabled native authority without public credential fallback", async () => {
    const owner = await actor(), player = await actor(), g = await game(owner);
    const url = `/v1/games/${g.id}/participations`, payload = { expectedGameVersion: g.version };
    const noCsrf = { cookie: player.cookie, origin, "idempotency-key": randomUUID() };
    expect((await app.inject({ method: "POST", url, headers: noCsrf, payload })).json().code).toBe("CSRF_REQUIRED");
    expect((await app.inject({ method: "POST", url, headers: { ...browser(player), origin: "https://evil.test" }, payload })).json().code).toBe("ORIGIN_REJECTED");
    const browserPart = await app.inject({ method: "POST", url, headers: browser(player), payload }); expect(browserPart.statusCode).toBe(201);
    expect((await app.inject({ url: "/v1/me/participations", headers: { cookie: player.cookie } })).json().items).toContainEqual(browserPart.json());
    expect((await app.inject({ method: "POST", url: `/v1/participations/${browserPart.json().id}/withdraw`, headers: browser(player), payload: { expectedVersion: browserPart.json().version } })).statusCode).toBe(200);
    for (const route of ["/v1/me/participations", "/v1/me/games"]) {
      expect((await app.inject({ url: route, headers: { authorization: "Bearer invalid" } })).statusCode).toBe(401);
      expect((await app.inject({ url: route, headers: { ...bearer(player), cookie: player.cookie } })).statusCode).toBe(403);
      expect((await disabledApp.inject({ url: route, headers: bearer(player) })).statusCode).toBe(404);
    }
    expect((await app.inject({ url: `/v1/games/${g.id}`, headers: bearer(player) })).statusCode).toBe(200);
    expect((await app.inject({ url: `/v1/games/${g.id}` })).statusCode).toBe(200);
    for (const authorization of ["", "Basic invalid", "Bearer invalid", `Bearer ${"x".repeat(43)}`]) {
      expect((await app.inject({ url: `/v1/games/${g.id}`, headers: { authorization } })).statusCode).toBe(401);
    }
    expect((await app.inject({ url: `/v1/games/${g.id}`, headers: { ...bearer(player), cookie: player.cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/v1/games/${g.id}`, headers: { authorization: [`Bearer ${player.accessToken}`, `Bearer ${player.accessToken}`] } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/games", headers: bearer(player) })).statusCode).toBe(401);
    expect((await app.inject({ url: `/v1/games/map?cityId=${MOSCOW_CITY_ID}`, headers: bearer(player) })).statusCode).toBe(401);
    expect((await disabledApp.inject({ url: `/v1/games/${g.id}`, headers: bearer(player) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers: { authorization: "Bearer invalid", "idempotency-key": randomUUID() }, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: { ...bearer(player), cookie: player.cookie }, payload })).statusCode).toBe(403);
    expect((await disabledApp.inject({ method: "POST", url, headers: bearer(player), payload })).statusCode).toBe(404);
    await app.get(SessionService).revokeSession(player.sessionId);
    expect((await app.inject({ url: `/v1/games/${g.id}`, headers: bearer(player) })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/me/participations", headers: bearer(player) })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, headers: bearer(player), payload })).statusCode).toBe(401);
    const inactive = await actor(); await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [inactive.id]);
    expect((await app.inject({ url: "/v1/me/games", headers: bearer(inactive) })).statusCode).toBe(401);
  });
});
