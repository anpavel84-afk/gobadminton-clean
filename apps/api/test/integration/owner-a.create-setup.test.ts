import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SessionService } from "../../src/auth/session.service";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

function parseSetCookie(header: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const item of values) {
    const pair = item.split(";")[0] ?? "";
    const idx = pair.indexOf("=");
    if (idx > 0) {
      out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
    }
  }
  return out;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

function fakeAdapter(identity: VerifiedIdentity): AuthProviderAdapter {
  return {
    key: identity.provider,
    configured: true,
    async startAuthorization(input) {
      return {
        authorizationUrl: `https://provider.test/authorize?state=${encodeURIComponent(input.state)}`,
      };
    },
    async exchangeCode() {
      return { accessToken: "test-access" };
    },
    async fetchVerifiedIdentity() {
      return identity;
    },
  };
}

describeIntegration("Owner A actual API city/near-future/time/idempotency", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityOwner: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:rtg",
    subject: uniqueSuffix("owner-rtg"),
    email: "owner-rtg@example.com",
    displayName: "Owner RTG",
  };
  const identityOther: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:rtg",
    subject: uniqueSuffix("other-rtg"),
    email: "other-rtg@example.com",
    displayName: "Other RTG",
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PUBLIC_API_ORIGIN = "http://127.0.0.1:3000";
    process.env.PUBLIC_WEB_ORIGIN = "http://127.0.0.1:3001";
    process.env.ALLOWED_WEB_ORIGINS = "http://127.0.0.1:3001";
    process.env.AUTH_PEPPER = "integration-auth-pepper-32chars!!";
    process.env.COOKIE_SECURE = "false";
    process.env.VK_CLIENT_ID = "vk-test";
    process.env.VK_CLIENT_SECRET = "vk-secret";
    process.env.VK_REDIRECT_URI = "http://127.0.0.1:3000/v1/auth/vk/callback";
    process.env.YANDEX_CLIENT_ID = "ya-test";
    process.env.YANDEX_CLIENT_SECRET = "ya-secret";
    process.env.YANDEX_REDIRECT_URI =
      "http://127.0.0.1:3000/v1/auth/yandex/callback";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.GIT_SHA = "integration-rtg";

    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    const env = loadEnv(process.env);
    const database = createDatabase(env.DATABASE_URL);
    pool = database.pool;

    const TestCoreModule = buildTestCoreModule(env, pool);

    const moduleRef = await Test.createTestingModule({
      imports: [
        TestCoreModule,
        AuthModule,
        OrganizersModule,
        VenuesModule,
        TrainersModule,
        GamesModule,
        ProfilesModule,
        ParticipationsModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityOwner), fakeAdapter(identityOther)])
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function login(provider: "vk" | "yandex", returnPath = "/profile/setup?returnTo=%2Fgames%2Fcreate") {
    const start = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=${encodeURIComponent(returnPath)}`,
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/callback?code=ok&state=${encodeURIComponent(state!)}${provider === "vk" ? "&device_id=vk-device-test" : ""}`,
      cookies,
    });
    expect(callback.statusCode).toBe(302);
    const sessionCookies = {
      ...cookies,
      ...parseSetCookie(callback.headers["set-cookie"]),
    };
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: sessionCookies,
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { id: string; csrfToken: string };
    return {
      cookies: sessionCookies,
      csrfToken: meBody.csrfToken,
      userId: meBody.id,
      cookie: cookieHeader(sessionCookies),
      callbackLocation: callback.headers.location,
    };
  }

  function mutationHeaders(session: { csrfToken: string; cookie: string }, key: string) {
    return {
      cookie: session.cookie,
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  type Session = Awaited<ReturnType<typeof login>>;
  let owner: Session;
  let other: Session;
  let venueId: string;
  const key = () => uniqueSuffix("owner-a-idempotency");
  function payload(minutes: number, overrides = {}) {
    const startsAt = new Date(Date.now() + minutes * 60000).toISOString();
    return { hostDisplayName: "Fictional Organizer", hostPublicContact: "fictional contact", venueId, title: "Owner A fictional game", startsAt, endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(), timezone: "Europe/Moscow", applicationDeadlineAt: startsAt, capacity: 8, externalReservedCount: 0, visibility: "public", formatKey: "doubles", activityKind: "regular", levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0"] }, settlement: { mode: "external", purpose: "no_trainer_fee", priceMinor: null, currency: null, terms: "Fictional external terms" }, ...overrides };
  }
  async function create(input = payload(30), idempotencyKey = key()) {
    return app.inject({ method: "POST", url: "/v1/games", headers: mutationHeaders(owner, idempotencyKey), payload: input });
  }
  async function publish(id: string, version: number, idempotencyKey = key()) {
    return app.inject({ method: "POST", url: `/v1/games/${id}/publish`, headers: mutationHeaders(owner, idempotencyKey), payload: { expectedVersion: version } });
  }

  // Each regression owns a fresh synthetic identity; no fixture deletion/reset.
  async function freshProfileSession() {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'OA2 Fictional Player')", [userId]);
    const issued = await new SessionService(pool, loadEnv(process.env)).createConsumerSession(userId);
    return { userId, sessionId: issued.session.id, csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${issued.sessionToken}` };
  }
  type ProfileSession = Awaited<ReturnType<typeof freshProfileSession>>;
  async function patchProfile(session: ProfileSession, input: Record<string, unknown>, idempotencyKey = key()) {
    return app.inject({ method: "PATCH", url: "/v1/me/social-profile", headers: mutationHeaders(session, idempotencyKey), payload: input });
  }
  async function profileState(session: ProfileSession) {
    return {
      profiles: (await pool.query("SELECT * FROM player_social_profiles WHERE user_id=$1", [session.userId])).rows,
      receipts: (await pool.query("SELECT * FROM idempotency_records WHERE actor_id=$1", [session.userId])).rows,
    };
  }
  function safeCityError(response: Awaited<ReturnType<typeof patchProfile>>) {
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "CITY_ID_INVALID" });
    expect(response.body).not.toMatch(/23503|SQL|constraint|INSERT|stack/i);
  }

  it("Q-OA-01 unknown catalog city rolls back bootstrap and receipt; same-key error retry and valid save stay safe", async () => {
    const session = await freshProfileSession(); const saveKey = key(); const missing = randomUUID();
    const invalid = { expectedVersion: 0, cityId: missing, radarConsented: true };
    safeCityError(await patchProfile(session, invalid, saveKey));
    expect(await profileState(session)).toEqual({ profiles: [], receipts: [] });
    safeCityError(await patchProfile(session, invalid, saveKey));
    expect(await profileState(session)).toEqual({ profiles: [], receipts: [] });
    // Failed transactions reserve no key; a corrected save may reuse it.
    const valid = { expectedVersion: 0, cityId: MOSCOW_CITY_ID };
    const saved = await patchProfile(session, valid, saveKey);
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ version: 1, cityId: MOSCOW_CITY_ID, directoryVisible: false,
      contactPolicy: "closed", radarConsented: false, consentPolicyVersion: null, optedInAt: null,
      radarConsentPolicyVersion: null, radarConsentedAt: null, level: null, bio: null });
    expect(saved.json().displayName).toBe("OA2 Fictional Player");
    const replay = await patchProfile(session, valid, saveKey);
    expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(saved.json());
    const changed = await patchProfile(session, { ...valid, cityId: missing }, saveKey);
    expect(changed.statusCode).toBe(409); expect(changed.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
    const state = await profileState(session);
    expect(state.profiles).toHaveLength(1); expect(state.profiles[0].version).toBe(1);
    expect(state.receipts).toHaveLength(1); expect(state.receipts[0].reservation_state).toBe("completed");
  });

  it("malformed city retains safe CITY_ID_INVALID without effects", async () => {
    const session = await freshProfileSession();
    safeCityError(await patchProfile(session, { expectedVersion: 0, cityId: "invalid-uuid" }));
    expect(await profileState(session)).toEqual({ profiles: [], receipts: [] });
  });

  it("unknown-city existing update preserves version/content/consent and leaves no failed receipt; valid update works", async () => {
    const session = await freshProfileSession();
    const created = await patchProfile(session, { expectedVersion: 0, cityId: MOSCOW_CITY_ID, radarConsented: true, bio: "Fictional bio" });
    expect(created.statusCode).toBe(201);
    const before = await profileState(session);
    safeCityError(await patchProfile(session, { expectedVersion: 1, cityId: randomUUID(), bio: "Changed", radarConsented: false }));
    expect(await profileState(session)).toEqual(before);
    const updated = await patchProfile(session, { expectedVersion: 1, cityId: MOSCOW_CITY_ID, bio: "Changed" });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ version: 2, bio: "Changed", radarConsented: true,
      radarConsentedAt: created.json().radarConsentedAt, directoryVisible: false, contactPolicy: "closed" });
  });

  it.each([undefined, null])("optional city %s remains compatible at bootstrap and update", async cityId => {
    const session = await freshProfileSession();
    const created = await patchProfile(session, { expectedVersion: 0, ...(cityId === undefined ? {} : { cityId }) });
    expect(created.statusCode).toBe(201); expect(created.json().cityId).toBeNull();
    const updated = await patchProfile(session, { expectedVersion: 1, ...(cityId === undefined ? {} : { cityId }), bio: "Optional city" });
    expect(updated.statusCode).toBe(200); expect(updated.json()).toMatchObject({ cityId: null, version: 2, directoryVisible: false, radarConsented: false, contactPolicy: "closed" });
  });

  it("version conflicts precede catalog lookup and roll back reservations", async () => {
    const session = await freshProfileSession();
    const absent = await patchProfile(session, { expectedVersion: 2, cityId: randomUUID() });
    expect(absent.statusCode).toBe(409); expect(absent.json().code).toBe("VERSION_CONFLICT");
    expect(await profileState(session)).toEqual({ profiles: [], receipts: [] });
    // Existing API also supports absent expectedVersion for the first save.
    expect((await patchProfile(session, { cityId: MOSCOW_CITY_ID })).statusCode).toBe(201);
    const before = await profileState(session);
    for (const input of [{ cityId: randomUUID() }, { expectedVersion: 0, cityId: randomUUID() }]) {
      const stale = await patchProfile(session, input);
      expect(stale.statusCode).toBe(409); expect(stale.json().code).toBe("VERSION_CONFLICT");
      expect(await profileState(session)).toEqual(before);
    }
  });

  it("concurrent bootstrap same-key replays and distinct-key loser conflicts with one committed profile", async () => {
    const input = { expectedVersion: 0, cityId: MOSCOW_CITY_ID };
    const same = await freshProfileSession(); const sameKey = key();
    const replays = await Promise.all([patchProfile(same, input, sameKey), patchProfile(same, input, sameKey)]);
    expect(replays.map(r => r.statusCode)).toEqual([201, 201]);
    expect(replays[0].json()).toEqual(replays[1].json());
    expect((await profileState(same)).profiles).toHaveLength(1); expect((await profileState(same)).receipts).toHaveLength(1);
    const different = await freshProfileSession();
    const competing = await Promise.all([patchProfile(different, input), patchProfile(different, input)]);
    expect(competing.map(r => r.statusCode).sort()).toEqual([201, 409]);
    expect(competing.find(r => r.statusCode === 409)!.json().code).toBe("VERSION_CONFLICT");
    const state = await profileState(different);
    expect(state.profiles).toHaveLength(1); expect(state.profiles[0].version).toBe(1); expect(state.receipts).toHaveLength(1);
  });

  it("unauthenticated, missing CSRF and revoked-session replay fail closed without effects", async () => {
    const session = await freshProfileSession(); const input = { expectedVersion: 0, cityId: MOSCOW_CITY_ID }; const saveKey = key();
    const anonymous = await app.inject({ method: "PATCH", url: "/v1/me/social-profile", headers: { origin: "http://127.0.0.1:3001", "x-csrf-token": "fictional-no-session", "idempotency-key": key() }, payload: input });
    expect(anonymous.statusCode).toBe(401);
    const headers = mutationHeaders(session, key()); delete (headers as Partial<typeof headers>)["x-csrf-token"];
    expect((await app.inject({ method: "PATCH", url: "/v1/me/social-profile", headers, payload: input })).statusCode).toBe(403);
    expect(await profileState(session)).toEqual({ profiles: [], receipts: [] });
    expect((await patchProfile(session, input, saveKey)).statusCode).toBe(201);
    const before = await profileState(session);
    await pool.query("UPDATE app_sessions SET revoked_at=now() WHERE id=$1", [session.sessionId]);
    expect((await patchProfile(session, input, saveKey)).statusCode).toBe(401);
    expect(await profileState(session)).toEqual(before);
  });

  it("stub OAuth preserves encoded create return; missing profile bootstraps city with closed/private defaults", async () => {
    owner = await login("vk"); other = await login("yandex");
    const destination = new URL(owner.callbackLocation!);
    expect(destination.pathname).toBe("/profile/setup");
    expect(destination.searchParams.get("returnTo")).toBe("/games/create");
    const own = await app.inject({ method: "GET", url: "/v1/me/social-profile", cookies: owner.cookies });
    expect(own.statusCode).toBe(200); expect(own.json().version).toBe(0); expect(own.json().cityId).toBeNull();
    const saveKey = key();
    const saved = await app.inject({ method: "PATCH", url: "/v1/me/social-profile", headers: mutationHeaders(owner, saveKey), payload: { expectedVersion: 0, cityId: MOSCOW_CITY_ID } });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ cityId: MOSCOW_CITY_ID, directoryVisible: false, contactPolicy: "closed", radarConsented: false, level: null, bio: null, version: 1 });
    expect(saved.json().displayName).toBeTruthy();
    const reread = await app.inject({ method: "GET", url: "/v1/me/social-profile", cookies: owner.cookies });
    expect(reread.json().cityId).toBe(MOSCOW_CITY_ID);
    const replay = await app.inject({ method: "PATCH", url: "/v1/me/social-profile", headers: mutationHeaders(owner, saveKey), payload: { expectedVersion: 0, cityId: MOSCOW_CITY_ID } });
    expect(replay.json()).toEqual(saved.json());
    const venue = await app.inject({ method: "POST", url: "/v1/venues", headers: mutationHeaders(owner, key()), payload: { cityId: MOSCOW_CITY_ID, name: "Owner A Fictional Hall", address: "Fictional Moscow address", timezone: "Europe/Moscow", latitude: 55.75, longitude: 37.62 } });
    expect([200, 201]).toContain(venue.statusCode); venueId = venue.json().id;
    const games = await app.inject({ method: "GET", url: "/v1/me/games", cookies: owner.cookies });
    expect(games.json().items).toEqual([]); // Callback/setup never create or publish.
  });

  it.each([0, -1])("rejects start %i minutes relative to server now", async minutes => {
    const response = await create(payload(minutes));
    expect(response.statusCode).toBe(422); expect(response.json().code).toBe("GAME_START_NOT_FUTURE");
  });
  it.each([1, 5, 30, 59])("creates/publishes +%i minutes with deadline equal to start", async minutes => {
    const response = await create(payload(minutes)); expect(response.statusCode).toBe(201);
    const game = response.json(); expect(game.applicationDeadlineAt).toBe(game.startsAt); expect(game.trainer).toBeNull();
    const pub = await publish(game.id, game.version); expect(pub.statusCode).toBe(200); expect(pub.json().status).toBe("published");
  });

  it("closes requests at start and rejects a draft whose start elapsed before publish", async () => {
    const draft = (await create(payload(1))).json();
    await pool.query("UPDATE games SET starts_at=now()-interval '1 second',application_deadline_at=now()-interval '1 second' WHERE id=$1", [draft.id]);
    const rejected = await publish(draft.id, draft.version); expect(rejected.statusCode).toBe(422); expect(rejected.json().code).toBe("GAME_START_NOT_FUTURE");
    const second = (await create(payload(1))).json(); const pub = (await publish(second.id, second.version)).json();
    const request = await app.inject({ method: "POST", url: `/v1/games/${pub.id}/participations`, headers: mutationHeaders(other, key()), payload: { expectedGameVersion: pub.version } });
    expect(request.statusCode).toBe(201); expect(request.json().status).toBe("pending");
    await pool.query("UPDATE games SET starts_at=now()-interval '1 second',application_deadline_at=now()-interval '1 second' WHERE id=$1", [pub.id]);
    const closed = await app.inject({ method: "POST", url: `/v1/games/${pub.id}/participations`, headers: mutationHeaders(other, key()), payload: { expectedGameVersion: pub.version } });
    expect(closed.statusCode).toBe(409); expect(["APPLICATION_CLOSED"]).toContain(closed.json().code);
  });

  it("lost-response create/publish retries replay authorized receipts even after start", async () => {
    const input = payload(1); const createKey = key(); const publishKey = key();
    const first = (await create(input, createKey)).json();
    expect((await create(input, createKey)).json()).toEqual(first);
    const pub = (await publish(first.id, first.version, publishKey)).json();
    await pool.query("UPDATE games SET starts_at=now()-interval '1 second',application_deadline_at=now()-interval '1 second' WHERE id=$1", [first.id]);
    expect((await create(input, createKey)).json()).toEqual(first);
    expect((await publish(first.id, first.version, publishKey)).json()).toEqual(pub);
    expect((await pool.query("SELECT count(*)::int AS n FROM games WHERE id=$1", [first.id])).rows[0].n).toBe(1);
  });

  it("preserves active/inactive trainer checks and permits regular games without trainer or directory", async () => {
    const trainerInput = { activityKind: "trainer_led", settlement: { mode: "external", purpose: "trainer_fee", priceStatus: "by_agreement", priceMinor: null, currency: null, terms: "fictional training terms" } };
    const missingTrainer = await create(payload(30, trainerInput));
    expect(missingTrainer.statusCode).toBe(422); expect(missingTrainer.json().code).toBe("TRAINER_PROFILE_REQUIRED");
    const trainer = await app.inject({ method: "PUT", url: "/v1/me/trainer-profile", headers: mutationHeaders(owner, key()), payload: { selfDeclared: true, displayName: "Fictional Trainer" } });
    expect(trainer.statusCode).toBe(201);
    const game = (await create(payload(30, trainerInput))).json();
    expect(game.trainer.profileId).toBe(trainer.json().id);
    const off = await app.inject({ method: "POST", url: "/v1/me/trainer-profile/deactivate", headers: mutationHeaders(owner, key()), payload: { expectedVersion: trainer.json().version } });
    expect(off.statusCode).toBe(200); const inactiveTrainer = await publish(game.id, game.version);
    expect(inactiveTrainer.statusCode).toBe(409); expect(inactiveTrainer.json().code).toBe("TRAINER_PROFILE_INACTIVE");
    expect((await create(payload(30))).statusCode).toBe(201);
    const own = await app.inject({ method: "GET", url: "/v1/me/social-profile", cookies: owner.cookies });
    expect(own.json()).toMatchObject({ directoryVisible: false, contactPolicy: "closed", radarConsented: false });
  });

  it("future bound and cursor advance exclude started games while managed history remains readable", async () => {
    const from = new Date().toISOString();
    const q = new URLSearchParams({ cityId: MOSCOW_CITY_ID, startsFrom: from, startsBefore: new Date(Date.now() + 3600000).toISOString(), limit: "2" });
    const first = (await app.inject({ method: "GET", url: `/v1/games?${q}` })).json();
    expect(first.items.length).toBe(2); expect(first.nextCursor).toBeTruthy();
    await pool.query("UPDATE games SET starts_at=now()-interval '1 second',application_deadline_at=now()-interval '1 second' WHERE id=$1", [first.items[0].id]);
    q.set("startsFrom", new Date().toISOString()); q.set("cursor", first.nextCursor);
    const second = (await app.inject({ method: "GET", url: `/v1/games?${q}` })).json();
    expect(second.items.every((g: { startsAt: string }) => Date.parse(g.startsAt) > Date.now())).toBe(true);
    expect(second.items.some((g: { id: string }) => first.items.some((f: { id: string }) => f.id === g.id))).toBe(false);
    const own = (await app.inject({ method: "GET", url: "/v1/me/games", cookies: owner.cookies })).json();
    expect(own.items.some((g: { id: string }) => g.id === first.items[0].id)).toBe(true);
  });

  it("rejects invalid duration-equivalent range/deadline and CSRF/session failures without new side effects", async () => {
    const input = payload(30);
    expect((await create({ ...input, endsAt: input.startsAt })).statusCode).toBe(422);
    expect((await create({ ...input, applicationDeadlineAt: input.endsAt })).statusCode).toBe(422);
    const headers = mutationHeaders(owner, key()); delete (headers as Partial<typeof headers>)["x-csrf-token"];
    expect((await app.inject({ method: "POST", url: "/v1/games", headers, payload: input })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/games", headers: { origin: "http://127.0.0.1:3001", "x-csrf-token": "fictional-expired", "idempotency-key": key() }, payload: input })).statusCode).toBe(401);
    const save = await app.inject({ method: "PATCH", url: "/v1/me/social-profile", headers: mutationHeaders(owner, key()), payload: { expectedVersion: 0, cityId: MOSCOW_CITY_ID } });
    expect(save.statusCode).toBe(409);
    await pool.query("UPDATE app_sessions SET expires_at=created_at+interval '1 millisecond' WHERE user_id=$1", [other.userId]);
    const expiredRead = await app.inject({ method: "GET", url: "/v1/me", cookies: other.cookies });
    expect(expiredRead.statusCode).toBe(401);
    const expiredWrite = await app.inject({ method: "POST", url: "/v1/games", headers: mutationHeaders(other, key()), payload: input });
    expect(expiredWrite.statusCode).toBe(401);
    const malicious = await app.inject({ method: "GET", url: "/v1/auth/vk/start?returnPath=https%3A%2F%2Fevil.test" });
    expect(malicious.statusCode).toBe(400);
  });
});
