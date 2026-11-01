import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
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
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
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
      return { ...identity };
    },
  };
}

type Session = {
  cookies: Record<string, string>;
  csrfToken: string;
  userId: string;
  cookie: string;
};

describeIntegration("LS-01 profiles/safety/directory", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:ls01",
    subject: uniqueSuffix("ls01-a"),
    email: "ls01-a@example.com",
    displayName: "LS01 Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:ls01",
    subject: uniqueSuffix("ls01-b"),
    email: "ls01-b@example.com",
    displayName: "LS01 Player B",
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
    process.env.GIT_SHA = "integration-ls01";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";

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
        ParticipationsModule,
        ProfilesModule,
        SafetyModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityA), fakeAdapter(identityB)])
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

  beforeEach(async () => {
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM abuse_reports");
    await pool.query("DELETE FROM user_blocks");
    await pool.query("DELETE FROM social_pairs");
    await pool.query("DELETE FROM player_looking_intents");
    await pool.query("DELETE FROM player_social_profiles");
  });

  async function login(provider: "vk" | "yandex"): Promise<Session> {
    const start = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=/account`,
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
    };
  }

  function mutationHeaders(session: Session, key: string) {
    return {
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
      origin: "http://127.0.0.1:3001",
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  async function ensureVisibleProfile(
    session: Session,
    displayName: string,
    keyPrefix: string,
  ): Promise<{ publicPlayerId: string; version: number }> {
    const current = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    expect(current.statusCode).toBe(200);
    const cur = current.json() as {
      version: number;
      directoryVisible: boolean;
      publicPlayerId: string | null;
      socialEligible: boolean;
      radarConsented: boolean;
    };

    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(session, `${keyPrefix}-patch-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: cur.version,
        displayName,
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        bio: "Ищу партнёров",
        socialEligible: true,
        radarConsented: true,
        radarConsentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect([200, 201]).toContain(patch.statusCode);
    let body = patch.json() as {
      publicPlayerId: string;
      version: number;
      directoryVisible: boolean;
    };
    if (!body.directoryVisible) {
      const vis = await app.inject({
        method: "PUT",
        url: "/v1/me/social-profile/visibility",
        headers: mutationHeaders(session, `${keyPrefix}-vis-${uniqueSuffix("k")}`),
        payload: {
          directoryVisible: true,
          consentPolicyVersion: "directory-mvp-v1",
          expectedVersion: body.version,
        },
      });
      expect(vis.statusCode).toBe(200);
      body = vis.json() as typeof body;
    }
    return { publicPlayerId: body.publicPlayerId, version: body.version };
  }

  it("Owner #448 default materializes directory ON; projection omits private IDs", async () => {
    const a = await login("vk");
    const b = await login("yandex");

    const own = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: a.cookies,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({
      directoryVisible: true,
      contactPolicy: "requests",
      consentPolicyVersion: null,
      optedInAt: null,
    });
    expect((own.json() as { version: number }).version).toBeGreaterThanOrEqual(1);
    expect((own.json() as { publicPlayerId: string | null }).publicPlayerId).toBeTruthy();

    const list = await app.inject({
      method: "GET",
      url: "/v1/players",
      cookies: b.cookies,
    });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray((list.json() as { items: unknown[] }).items)).toBe(true);

    const profile = await ensureVisibleProfile(a, "Alpha LS01", "a1");
    const detail = await app.inject({
      method: "GET",
      url: `/v1/players/${profile.publicPlayerId}`,
      cookies: b.cookies,
    });
    expect(detail.statusCode).toBe(200);
    const publicBody = detail.json() as Record<string, unknown>;
    expect(publicBody.publicPlayerId).toBe(profile.publicPlayerId);
    expect(publicBody.displayName).toBe("Alpha LS01");
    expect(publicBody).not.toHaveProperty("email");
    expect(publicBody).not.toHaveProperty("phone");
    expect(publicBody).not.toHaveProperty("userId");
    expect(publicBody).not.toHaveProperty("providerId");
    expect(JSON.stringify(publicBody)).not.toContain(a.userId);
    expect(JSON.stringify(publicBody)).not.toContain("ls01-a@example.com");
  });

  it("opt-out and eligibility revoke hide immediately; radar consent distinct", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const profile = await ensureVisibleProfile(a, "Alpha Visible", "a2");

    const own = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: a.cookies,
    });
    const ownBody = own.json() as {
      version: number;
      radarConsented: boolean;
      directoryVisible: boolean;
    };
    expect(ownBody.radarConsented).toBe(true);
    expect(ownBody.directoryVisible).toBe(true);

    const hide = await app.inject({
      method: "PUT",
      url: "/v1/me/social-profile/visibility",
      headers: mutationHeaders(a, `hide-${uniqueSuffix("k")}`),
      payload: {
        directoryVisible: false,
        expectedVersion: ownBody.version,
      },
    });
    expect(hide.statusCode).toBe(200);
    const hideBody = hide.json() as {
      directoryVisible: boolean;
      radarConsented: boolean;
      version: number;
    };
    expect(hideBody.directoryVisible).toBe(false);
    expect(hideBody.radarConsented).toBe(true);

    const detailHidden = await app.inject({
      method: "GET",
      url: `/v1/players/${profile.publicPlayerId}`,
      cookies: b.cookies,
    });
    expect(detailHidden.statusCode).toBe(404);
    expect(detailHidden.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });

    // Re-opt-in then revoke eligibility — clears radar consent.
    const show = await app.inject({
      method: "PUT",
      url: "/v1/me/social-profile/visibility",
      headers: mutationHeaders(a, `show-${uniqueSuffix("k")}`),
      payload: {
        directoryVisible: true,
        consentPolicyVersion: "directory-mvp-v1",
        expectedVersion: hideBody.version,
      },
    });
    expect(show.statusCode).toBe(200);
    const showBody = show.json() as { version: number };

    const revoke = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(a, `revoke-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: showBody.version,
        socialEligible: false,
      },
    });
    expect(revoke.statusCode).toBe(200);
    const revokeBody = revoke.json() as {
      socialEligible: boolean;
      directoryVisible: boolean;
      radarConsented: boolean;
    };
    expect(revokeBody.socialEligible).toBe(false);
    expect(revokeBody.directoryVisible).toBe(false);
    expect(revokeBody.radarConsented).toBe(false);

    const detailRevoked = await app.inject({
      method: "GET",
      url: `/v1/players/${profile.publicPlayerId}`,
      cookies: b.cookies,
    });
    expect(detailRevoked.statusCode).toBe(404);
  });

  it("block filters directory both ways and does not alter participations", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const aProfile = await ensureVisibleProfile(a, "Blocker Alpha", "blk-a");
    const bProfile = await ensureVisibleProfile(b, "Blocked Beta", "blk-b");

    // Create a game + participation owned by A with B confirmed — then block.
    const venue = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(a, `venue-${uniqueSuffix("k")}`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: `LS01 Venue ${uniqueSuffix("v")}`,
        address: "Test address",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.61,
      },
    });
    expect([200, 201]).toContain(venue.statusCode);
    const venueId = (venue.json() as { id: string }).id;
    const starts = new Date(Date.now() + 3 * 24 * 3600_000);
    const ends = new Date(starts.getTime() + 2 * 3600_000);
    const deadline = new Date(starts.getTime() - 3600_000);
    const createGame = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(a, `game-${uniqueSuffix("k")}`),
      payload: {
        activityKind: "regular",
        venueId,
        title: `LS01 Game ${uniqueSuffix("g")}`,
        hostDisplayName: "Host A",
        hostPublicContact: "telegram:@ls01-host",
        visibility: "public",
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: deadline.toISOString(),
        capacity: 4,
        externalReservedCount: 0,
        formatKey: "doubles",
        levelRule: {
          scaleId: "ntrp",
          scaleVersion: 1,
          allowedLevelIds: ["3.0", "3.5"],
        },
        settlement: {
          mode: "external",
          purpose: "no_trainer_fee",
          priceMinor: null,
          currency: null,
          terms: "Court terms arranged outside the platform",
        },
      },
    });
    expect([200, 201]).toContain(createGame.statusCode);
    const game = createGame.json() as { id: string; version: number };
    const publish = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/publish`,
      headers: mutationHeaders(a, `pub-${uniqueSuffix("k")}`),
      payload: { expectedVersion: game.version },
    });
    expect(publish.statusCode).toBe(200);
    const published = publish.json() as { id: string; version: number };

    const request = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(b, `part-${uniqueSuffix("k")}`),
      payload: { expectedGameVersion: published.version },
    });
    expect([200, 201]).toContain(request.statusCode);
    const participation = request.json() as { id: string; version: number; status: string };
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${participation.id}/confirm`,
      headers: mutationHeaders(a, `conf-${uniqueSuffix("k")}`),
      payload: { expectedVersion: participation.version },
    });
    expect(confirm.statusCode).toBe(200);
    expect((confirm.json() as { status: string }).status).toBe("confirmed");

    const beforePart = await pool.query(
      `SELECT status FROM participations WHERE id = $1`,
      [participation.id],
    );
    expect(beforePart.rows[0]?.status).toBe("confirmed");

    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${bProfile.publicPlayerId}`,
      headers: mutationHeaders(a, `block-${uniqueSuffix("k")}`),
      payload: {},
    });
    expect(block.statusCode).toBe(200);
    expect(block.json()).toMatchObject({
      publicPlayerId: bProfile.publicPlayerId,
      blocked: true,
    });

    const listFromA = await app.inject({
      method: "GET",
      url: "/v1/players",
      cookies: a.cookies,
    });
    const idsA = (
      listFromA.json() as { items: { publicPlayerId: string }[] }
    ).items.map((i) => i.publicPlayerId);
    expect(idsA).not.toContain(bProfile.publicPlayerId);

    const listFromB = await app.inject({
      method: "GET",
      url: "/v1/players",
      cookies: b.cookies,
    });
    const idsB = (
      listFromB.json() as { items: { publicPlayerId: string }[] }
    ).items.map((i) => i.publicPlayerId);
    expect(idsB).not.toContain(aProfile.publicPlayerId);

    const detailBlocked = await app.inject({
      method: "GET",
      url: `/v1/players/${bProfile.publicPlayerId}`,
      cookies: a.cookies,
    });
    expect(detailBlocked.statusCode).toBe(404);

    const afterPart = await pool.query(
      `SELECT status FROM participations WHERE id = $1`,
      [participation.id],
    );
    expect(afterPart.rows[0]?.status).toBe("confirmed");

    const unblock = await app.inject({
      method: "DELETE",
      url: `/v1/me/blocks/${bProfile.publicPlayerId}`,
      headers: mutationHeaders(a, `unblock-${uniqueSuffix("k")}`),
      payload: {},
    });
    expect(unblock.statusCode).toBe(200);
    expect(unblock.json()).toMatchObject({ blocked: false });
  });

  it("looking-for-game TTL expiry removes intent from search", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureVisibleProfile(a, "Looking Alpha", "look-a");

    const put = await app.inject({
      method: "PUT",
      url: "/v1/me/looking-for-game",
      headers: mutationHeaders(a, `look-${uniqueSuffix("k")}`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        areaKey: "dynamo",
        ttlMinutes: 30,
        formatKeys: ["doubles"],
      },
    });
    expect([200, 201]).toContain(put.statusCode);
    expect(put.json()).toMatchObject({ state: "active", cityId: MOSCOW_CITY_ID });

    const listLooking = await app.inject({
      method: "GET",
      url: "/v1/players?looking=true",
      cookies: b.cookies,
    });
    expect(listLooking.statusCode).toBe(200);
    expect(
      (listLooking.json() as { items: { displayName: string }[] }).items.some(
        (i) => i.displayName === "Looking Alpha",
      ),
    ).toBe(true);

    // Force expiry in DB then read/search.
    await pool.query(
      `UPDATE player_looking_intents
       SET starts_at = now() - interval '2 minutes',
           ends_at = now() - interval '1 minute',
           expires_at = now() - interval '1 minute'
       WHERE user_id = $1`,
      [a.userId],
    );

    const own = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: a.cookies,
    });
    const looking = (own.json() as { lookingForGame: { state: string } | null })
      .lookingForGame;
    expect(looking?.state).toBe("inactive");

    const listAfter = await app.inject({
      method: "GET",
      url: "/v1/players?looking=true",
      cookies: b.cookies,
    });
    expect(
      (listAfter.json() as { items: { displayName: string }[] }).items.some(
        (i) => i.displayName === "Looking Alpha",
      ),
    ).toBe(false);
  });

  it("report create is bounded; unauthorized session cannot mutate", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const target = await ensureVisibleProfile(b, "Report Target", "rep-b");

    const report = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(a, `rep-${uniqueSuffix("k")}`),
      payload: {
        targetKind: "player",
        targetPublicPlayerId: target.publicPlayerId,
        reasonCode: "harassment",
        detail: "spam messages in social context",
        evidenceRefs: ["ref-1"],
      },
    });
    expect(report.statusCode).toBe(201);
    expect(report.json()).toMatchObject({ status: "submitted" });

    const oversize = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(a, `rep-bad-${uniqueSuffix("k")}`),
      payload: {
        targetKind: "player",
        targetPublicPlayerId: target.publicPlayerId,
        reasonCode: "other",
        evidenceRefs: Array.from({ length: 11 }, (_, i) => `r${i}`),
      },
    });
    expect(oversize.statusCode).toBe(422);

    const noAuth = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: {
        "idempotency-key": `noauth-${uniqueSuffix("k")}`,
        "content-type": "application/json",
      },
      payload: { expectedVersion: 0, displayName: "X", cityId: MOSCOW_CITY_ID },
    });
    // No cookie session / rejected mutation credentials.
    expect([401, 403]).toContain(noAuth.statusCode);

    await pool.query(
      `UPDATE app_sessions SET revoked_at = now() WHERE user_id = $1`,
      [a.userId],
    );
    const revoked = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${target.publicPlayerId}`,
      headers: mutationHeaders(a, `revoked-${uniqueSuffix("k")}`),
      payload: {},
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("feature flag default-off denies social routes", async () => {
    // Rebuild a tiny request against disabled flag by temporarily patching env provider
    // is awkward; instead assert loadEnv default and a fresh inject with process env off
    // via direct SocialFeatureService semantics already covered in unit env test.
    // Here: disable on running pool-backed app by mutating env object used by provider.
    const env = loadEnv({
      ...process.env,
      SOCIAL_DIRECTORY_ENABLED: "0",
    });
    expect(env.SOCIAL_DIRECTORY_ENABLED).toBe(false);

    // Spin a second app with flag off.
    const TestCoreModule = buildTestCoreModule(env, pool);
    const moduleRef = await Test.createTestingModule({
      imports: [
        TestCoreModule,
        AuthModule,
        ProfilesModule,
        SafetyModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityA), fakeAdapter(identityB)])
      .compile();
    const offApp = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await offApp.register(cookie);
    offApp.setGlobalPrefix("v1");
    await offApp.init();
    await offApp.getHttpAdapter().getInstance().ready();

    const start = await offApp.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/account",
    });
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const state = new URL(
      (start.json() as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get("state");
    const callback = await offApp.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=ok&state=${encodeURIComponent(state!)}&device_id=vk-device-test`,
      cookies,
    });
    const sessionCookies = {
      ...cookies,
      ...parseSetCookie(callback.headers["set-cookie"]),
    };
    const denied = await offApp.inject({
      method: "GET",
      url: "/v1/players",
      cookies: sessionCookies,
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({ code: "SOCIAL_DIRECTORY_DISABLED" });

    await offApp.close();
  });

  it("no Radar matching routes are registered", async () => {
    const a = await login("vk");
    const radar = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: a.cookies,
    });
    expect(radar.statusCode).toBe(404);
  });

  function assertPublicProjection(
    body: Record<string, unknown>,
    forbiddenSubstrings: string[],
    surface: "directory" | "detail" = "directory",
  ) {
    expect(Object.keys(body).sort()).toEqual(
      [
        "canRequestContact",
        "areaKey",
        "avatar",
        "bio",
        "cityId",
        "displayName",
        "level",
        "lookingForGame",
        "publicPlayerId",
        "trainer",
        ...(surface === "detail" ? ["cover"] : []),
      ].sort(),
    );
    if (surface === "detail") {
      // PublicPlayer contracts only a safe derivative reference, never storage/original metadata.
      expect(body.cover).toEqual({ uploadedUrl: null });
    }
    const serialized = JSON.stringify(body);
    for (const fragment of forbiddenSubstrings) {
      expect(serialized).not.toContain(fragment);
    }
  }

  it("anonymous directory lists only visible eligible active projections", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const visible = await ensureVisibleProfile(a, "Anon Visible Alpha", "anon-vis");
    await ensureVisibleProfile(b, "Anon Visible Beta", "anon-vis-b");

    const anonymous = await app.inject({ method: "GET", url: "/v1/players" });
    expect(anonymous.statusCode).toBe(200);
    const page = anonymous.json() as {
      items: Array<Record<string, unknown> & { publicPlayerId: string; displayName: string }>;
      nextCursor: string | null;
    };
    const ids = page.items.map((item) => item.publicPlayerId);
    expect(ids).toContain(visible.publicPlayerId);
    expect(page.items.some((item) => item.displayName === "Anon Visible Alpha")).toBe(
      true,
    );
    expect(page.items.some((item) => item.displayName === "Anon Visible Beta")).toBe(
      true,
    );
    for (const item of page.items) {
      assertPublicProjection(item, [
        a.userId,
        b.userId,
        "ls01-a@example.com",
        "ls01-b@example.com",
        "vkid:app:ls01",
        "yandex:oauth:ls01",
      ]);
    }

    const named = await app.inject({
      method: "GET",
      url: "/v1/players?name=Anon%20Visible%20Al&limit=1",
    });
    expect(named.statusCode).toBe(200);
    const namedPage = named.json() as {
      items: { displayName: string }[];
      nextCursor: string | null;
    };
    expect(namedPage.items.map((item) => item.displayName)).toEqual([
      "Anon Visible Alpha",
    ]);

    const paged = await app.inject({
      method: "GET",
      url: "/v1/players?limit=1",
    });
    expect(paged.statusCode).toBe(200);
    const firstPage = paged.json() as { nextCursor: string | null; items: unknown[] };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/v1/players?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/players/${visible.publicPlayerId}`,
    });
    expect(detail.statusCode).toBe(200);
    assertPublicProjection(detail.json() as Record<string, unknown>, [
      a.userId,
      "ls01-a@example.com",
    ], "detail");
  });

  it("anonymous reads hide hidden, ineligible, disabled, and missing profiles uniformly", async () => {
    const a = await login("vk");
    const hidden = await login("yandex");
    const visible = await ensureVisibleProfile(a, "Matrix Visible", "mx-vis");
    await ensureVisibleProfile(hidden, "Matrix Hidden", "mx-hid");

    const hide = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: hidden.cookies,
    });
    const hideBody = hide.json() as { version: number };
    const optedOut = await app.inject({
      method: "PUT",
      url: "/v1/me/social-profile/visibility",
      headers: mutationHeaders(hidden, `mx-hide-${uniqueSuffix("k")}`),
      payload: { directoryVisible: false, expectedVersion: hideBody.version },
    });
    expect(optedOut.statusCode).toBe(200);
    const hiddenId = (optedOut.json() as { publicPlayerId: string }).publicPlayerId;

    const ineligibleId = visible.publicPlayerId;
    await pool.query(
      `UPDATE player_social_profiles SET social_eligible = false WHERE user_id = $1`,
      [a.userId],
    );

    const disabledUserId = crypto.randomUUID();
    const disabledPublicId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, status, display_name) VALUES ($1, 'disabled', 'Matrix Disabled')`,
      [disabledUserId],
    );
    await pool.query(
      `INSERT INTO player_social_profiles (
         user_id, public_player_id, display_name, city_id, area_key,
         directory_visible, social_eligible, consent_policy_version, opted_in_at
       ) VALUES ($1, $2, 'Matrix Disabled', $3, 'sokol', true, true, 'directory-mvp-v1', now())`,
      [disabledUserId, disabledPublicId, MOSCOW_CITY_ID],
    );

    const list = await app.inject({ method: "GET", url: "/v1/players" });
    expect(list.statusCode).toBe(200);
    const ids = (
      list.json() as { items: { publicPlayerId: string }[] }
    ).items.map((item) => item.publicPlayerId);
    expect(ids).not.toContain(hiddenId);
    expect(ids).not.toContain(ineligibleId);
    expect(ids).not.toContain(disabledPublicId);

    for (const publicPlayerId of [
      hiddenId,
      ineligibleId,
      disabledPublicId,
      "00000000-0000-4000-8000-000000000099",
    ]) {
      const detail = await app.inject({
        method: "GET",
        url: `/v1/players/${publicPlayerId}`,
      });
      expect(detail.statusCode).toBe(404);
      expect(detail.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
    }
  });

  it("invalid or expired session cookies behave as anonymous on public players reads", async () => {
    const owner = await login("vk");
    const viewer = await login("yandex");
    const profile = await ensureVisibleProfile(owner, "Cookie Visible", "ck-vis");

    const authedSelf = await app.inject({
      method: "GET",
      url: "/v1/players",
      cookies: owner.cookies,
    });
    expect(authedSelf.statusCode).toBe(200);
    expect(
      (authedSelf.json() as { items: { publicPlayerId: string }[] }).items.map(
        (item) => item.publicPlayerId,
      ),
    ).not.toContain(profile.publicPlayerId);

    const invalid = await app.inject({
      method: "GET",
      url: "/v1/players",
      cookies: { [SESSION_COOKIE]: "not-a-session" },
    });
    expect(invalid.statusCode).toBe(200);
    expect(
      (invalid.json() as { items: { publicPlayerId: string }[] }).items.map(
        (item) => item.publicPlayerId,
      ),
    ).toContain(profile.publicPlayerId);

    await pool.query(
      `UPDATE app_sessions SET expires_at = now() - interval '1 hour' WHERE user_id = $1`,
      [viewer.userId],
    );
    const expired = await app.inject({
      method: "GET",
      url: "/v1/players",
      cookies: viewer.cookies,
    });
    expect(expired.statusCode).toBe(200);
    expect(
      (expired.json() as { items: { publicPlayerId: string }[] }).items.map(
        (item) => item.publicPlayerId,
      ),
    ).toContain(profile.publicPlayerId);

    const expiredDetail = await app.inject({
      method: "GET",
      url: `/v1/players/${profile.publicPlayerId}`,
      cookies: viewer.cookies,
    });
    expect(expiredDetail.statusCode).toBe(200);
  });

  it("authenticated self-exclusion and own visible detail remain accepted", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const aProfile = await ensureVisibleProfile(a, "Self Alpha", "self-a");
    const bProfile = await ensureVisibleProfile(b, "Self Beta", "self-b");

    const listA = await app.inject({
      method: "GET",
      url: "/v1/players",
      cookies: a.cookies,
    });
    const idsA = (
      listA.json() as { items: { publicPlayerId: string }[] }
    ).items.map((item) => item.publicPlayerId);
    expect(idsA).not.toContain(aProfile.publicPlayerId);
    expect(idsA).toContain(bProfile.publicPlayerId);

    const own = await app.inject({
      method: "GET",
      url: `/v1/players/${aProfile.publicPlayerId}`,
      cookies: a.cookies,
    });
    expect(own.statusCode).toBe(200);
    expect((own.json() as { publicPlayerId: string }).publicPlayerId).toBe(
      aProfile.publicPlayerId,
    );
  });
});
