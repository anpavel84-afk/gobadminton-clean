import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
import { AuthModule } from "../../src/auth/auth.module";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GameAuthorityService } from "../../src/games/game-authority.service";
import { GamesModule } from "../../src/games/games.module";
import { GamesService } from "../../src/games/games.service";
import { OrganizersModule } from "../../src/organizers/organizers.module";
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

describeIntegration("F-03 organizer/venue/game discovery", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let gameAuthority: GameAuthorityService;
  let gamesService: GamesService;

  const identityOwner: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:f03",
    subject: uniqueSuffix("owner"),
    email: "owner@example.com",
    displayName: "Owner",
  };
  const identityOther: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:f03",
    subject: uniqueSuffix("other"),
    email: "other@example.com",
    displayName: "Other",
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
    process.env.GIT_SHA = "integration-f03";

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
        GamesModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityOwner), fakeAdapter(identityOther)])
      .compile();

    gameAuthority = moduleRef.get(GameAuthorityService);
    gamesService = moduleRef.get(GamesService);

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

  async function login(provider: "vk" | "yandex") {
    const start = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=/account`,
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
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
    expect(sessionCookies[SESSION_COOKIE]).toBeTruthy();
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

  function mutationHeaders(session: { csrfToken: string; cookie: string }, key: string) {
    return {
      cookie: session.cookie,
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  it("publishes into discovery with capacity/authz/idempotency semantics", async () => {
    const owner = await login("vk");
    const other = await login("yandex");

    const cities = await app.inject({ method: "GET", url: "/v1/cities" });
    expect(cities.statusCode).toBe(200);
    expect(cities.json().items.some((c: { id: string }) => c.id === MOSCOW_CITY_ID)).toBe(
      true,
    );

    // Compatibility organizer endpoints still work but are not required for Create Game.
    const organizerRes = await app.inject({
      method: "POST",
      url: "/v1/organizers",
      headers: mutationHeaders(owner, `idem-org-${Date.now()}-abcdefgh`),
      payload: {
        displayName: "Moscow Open Organizer",
        publicContact: "telegram:@moscow-open",
      },
    });
    expect(organizerRes.statusCode).toBe(201);
    const organizer = organizerRes.json() as { id: string };

    const orgKey = `idem-org-replay-${Date.now()}-abcdefgh`;
    const replayName = `Replay Organizer ${Date.now()}`;
    const org1 = await app.inject({
      method: "POST",
      url: "/v1/organizers",
      headers: mutationHeaders(owner, orgKey),
      payload: {
        displayName: replayName,
        publicContact: "mail@example.com",
      },
    });
    expect(org1.statusCode).toBe(201);
    const org2 = await app.inject({
      method: "POST",
      url: "/v1/organizers",
      headers: mutationHeaders(owner, orgKey),
      payload: {
        displayName: replayName,
        publicContact: "mail@example.com",
      },
    });
    expect(org2.statusCode).toBe(201);
    expect(org2.json().id).toBe(org1.json().id);
    const organizerCount = await pool.query(
      `SELECT count(*)::int AS c FROM organizers WHERE display_name = $1`,
      [replayName],
    );
    expect(organizerCount.rows[0]!.c).toBe(1);

    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${Date.now()}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "Luzhniki Court A",
        address: "Luzhniki, Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.715765,
        longitude: 37.553537,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    const venue = venueRes.json() as {
      id: string;
      latitude: number;
      longitude: number;
    };
    expect(venue.latitude).toBeCloseTo(55.715765, 5);
    expect(venue.longitude).toBeCloseTo(37.553537, 5);

    const rejectedLegacyOrganizerId = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-legacy-${Date.now()}-abcdefgh`),
      payload: {
        ...baseGamePayload(venue.id, {}),
        organizerId: organizer.id,
      },
    });
    expect(rejectedLegacyOrganizerId.statusCode).toBe(422);

    const badCapacity = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-bad-${Date.now()}-abcdefgh`),
      payload: baseGamePayload(venue.id, {
        capacity: 0,
        externalReservedCount: 0,
      }),
    });
    expect(badCapacity.statusCode).toBe(422);

    const overflow = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-ovf-${Date.now()}-abcdefgh`),
      payload: baseGamePayload(venue.id, {
        capacity: 4,
        externalReservedCount: 5,
      }),
    });
    expect(overflow.statusCode).toBe(422);

    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-${Date.now()}-abcdefgh`),
      payload: baseGamePayload(venue.id, {
        capacity: 8,
        externalReservedCount: 2,
        visibility: "public",
        hostDisplayName: "Moscow Open Host",
        hostPublicContact: "telegram:@moscow-open",
      }),
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = draftRes.json() as {
      id: string;
      version: number;
      status: string;
      availablePlaces: number;
      confirmedCount: number;
      organizer: { id: string | null; displayName: string; publicContact: string };
    };
    expect(draft.status).toBe("draft");
    expect(draft.confirmedCount).toBe(1);
    expect(draft.availablePlaces).toBe(5);
    expect(draft.organizer.id).toBeNull();
    expect(draft.organizer.displayName).toBe("Moscow Open Host");

    const ownerRow = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM game_managers
       WHERE game_id = $1 AND user_id = $2 AND role = 'owner' AND status = 'active'`,
      [draft.id, owner.userId],
    );
    expect(ownerRow.rows[0]!.c).toBe(1);

    const discoveryBefore = await app.inject({ method: "GET", url: "/v1/games" });
    expect(discoveryBefore.statusCode).toBe(200);
    expect(
      (discoveryBefore.json().items as Array<{ id: string }>).some(
        (g) => g.id === draft.id,
      ),
    ).toBe(false);

    const unauthorizedPublish = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(other, `idem-pub-other-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: draft.version },
    });
    expect([403, 404]).toContain(unauthorizedPublish.statusCode);

    // Legacy organizer membership alone must not grant cross-game authority.
    const otherOrg = await app.inject({
      method: "POST",
      url: "/v1/organizers",
      headers: mutationHeaders(other, `idem-org-other-${Date.now()}-abcdefgh`),
      payload: {
        displayName: "Other Organizer Persona",
        publicContact: "other@example.com",
      },
    });
    expect(otherOrg.statusCode).toBe(201);
    const otherStillDenied = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(other, `idem-pub-orgpersona-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: draft.version },
    });
    expect([403, 404]).toContain(otherStillDenied.statusCode);

    const publishKey = `idem-pub-${Date.now()}-abcdefgh`;
    const publishedRes = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(owner, publishKey),
      payload: { expectedVersion: draft.version },
    });
    expect(publishedRes.statusCode).toBe(200);
    const published = publishedRes.json() as {
      id: string;
      version: number;
      status: string;
    };
    expect(published.status).toBe("published");
    expect(published.version).toBe(draft.version + 1);

    const publishReplay = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(owner, publishKey),
      payload: { expectedVersion: draft.version },
    });
    expect(publishReplay.statusCode).toBe(200);
    expect(publishReplay.json().version).toBe(published.version);
    const outboxCount = await pool.query(
      `SELECT count(*)::int AS c FROM outbox_events WHERE type = 'game.published' AND aggregate_id = $1`,
      [published.id],
    );
    expect(outboxCount.rows[0]!.c).toBe(1);

    const discovery = await app.inject({
      method: "GET",
      url: `/v1/games?limit=100`,
    });
    expect(discovery.statusCode).toBe(200);
    const found = (discovery.json().items as Array<Record<string, unknown>>).find(
      (g) => g.id === published.id,
    );
    expect(found).toBeTruthy();
    expect(found).not.toHaveProperty("applicants");
    expect(found).not.toHaveProperty("participations");

    const detail = await app.inject({
      method: "GET",
      url: `/v1/games/${published.id}`,
    });
    expect(detail.statusCode).toBe(200);

    const unlistedDraft = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-ul-${Date.now()}-abcdefgh`),
      payload: baseGamePayload(venue.id, {
        capacity: 4,
        externalReservedCount: 0,
        visibility: "unlisted",
        title: "Unlisted draft",
      }),
    });
    expect(unlistedDraft.statusCode).toBe(201);
    const unlistedId = unlistedDraft.json().id as string;
    const anonymousUnlisted = await app.inject({
      method: "GET",
      url: `/v1/games/${unlistedId}`,
    });
    expect(anonymousUnlisted.statusCode).toBe(404);
    const ownerUnlisted = await app.inject({
      method: "GET",
      url: `/v1/games/${unlistedId}`,
      cookies: owner.cookies,
    });
    expect(ownerUnlisted.statusCode).toBe(200);

    await gameAuthority.revokeForTests(published.id, owner.userId);
    const revokedCancel = await app.inject({
      method: "POST",
      url: `/v1/games/${published.id}/cancel`,
      headers: mutationHeaders(owner, `idem-cancel-revoked-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: published.version, reason: "no longer manager" },
    });
    expect(revokedCancel.statusCode).toBe(403);

    await pool.query(
      `UPDATE game_managers
       SET status = 'active', revoked_at = NULL, updated_at = now()
       WHERE game_id = $1 AND user_id = $2`,
      [published.id, owner.userId],
    );

    await gamesService.withGameLockForCapacityWrite(published.id, async (client, locked) => {
      expect(locked.id).toBe(published.id);
      const row = await client.query(
        `SELECT id FROM games WHERE id = $1 FOR UPDATE`,
        [published.id],
      );
      expect(row.rows).toHaveLength(1);
    });

    const cancelRes = await app.inject({
      method: "POST",
      url: `/v1/games/${published.id}/cancel`,
      headers: mutationHeaders(owner, `idem-cancel-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: published.version, reason: "weather" },
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe("cancelled");

    const discoveryAfterCancel = await app.inject({
      method: "GET",
      url: "/v1/games",
    });
    expect(
      (discoveryAfterCancel.json().items as Array<{ id: string }>).some(
        (g) => g.id === published.id,
      ),
    ).toBe(false);
  }, 120_000);
});

function baseGamePayload(venueId: string, overrides: Record<string, unknown>) {
  const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
  const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
  return {
    hostDisplayName: "Friday Host",
    hostPublicContact: "telegram:@friday-host",
    venueId,
    title: "Friday doubles",
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
    timezone: "Europe/Moscow",
    applicationDeadlineAt: deadline.toISOString(),
    capacity: 8,
    externalReservedCount: 0,
    visibility: "public",
    formatKey: "doubles",
    activityKind: "regular",
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
    ...overrides,
  };
}
