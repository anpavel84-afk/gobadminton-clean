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

describeIntegration("Checkpoint B trainer profile + activity kinds", () => {
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

  async function login(provider: "vk" | "yandex") {
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

  function mutationHeaders(session: { csrfToken: string; cookie: string }, key: string) {
    return {
      cookie: session.cookie,
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  it("supports self-declared trainer profile, regular vs trainer-led create, and deactivate/publish race", async () => {
    const owner = await login("vk");
    const other = await login("yandex");

    const missing = await app.inject({
      method: "GET",
      url: "/v1/me/trainer-profile",
      cookies: owner.cookies,
    });
    expect(missing.statusCode).toBe(404);

    const createKey = `idem-tp-${Date.now()}-abcdefgh`;
    const created = await app.inject({
      method: "PUT",
      url: "/v1/me/trainer-profile",
      headers: mutationHeaders(owner, createKey),
      payload: {
        selfDeclared: true,
        displayName: "Coach Anna",
        bio: "Footwork & defense",
      },
    });
    expect(created.statusCode).toBe(201);
    const profile = created.json() as {
      id: string;
      version: number;
      status: string;
      declarationSource: string;
    };
    expect(profile.status).toBe("active");
    expect(profile.declarationSource).toBe("self_declared");

    const replay = await app.inject({
      method: "PUT",
      url: "/v1/me/trainer-profile",
      headers: mutationHeaders(owner, createKey),
      payload: {
        selfDeclared: true,
        displayName: "Coach Anna",
        bio: "Footwork & defense",
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(profile.id);

    const foreignProfile = await app.inject({
      method: "GET",
      url: "/v1/me/trainer-profile",
      cookies: other.cookies,
    });
    expect(foreignProfile.statusCode).toBe(404);

    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-rtg-${Date.now()}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "RTG Court",
        address: "Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    const venueId = (venueRes.json() as { id: string }).id;

    // Owner defaults: exercise actual HTTP, persistence and normalization.
    for (const [title, expected] of [[undefined, "Игра"], ["  ", "Игра"], ["  Custom title  ", "Custom title"], ["x".repeat(160), "x".repeat(160)]] as const) {
      const response = await app.inject({ method: "POST", url: "/v1/games",
        headers: mutationHeaders(owner, uniqueSuffix("gdef-title")),
        payload: baseGamePayload(venueId, { title }) });
      expect(response.statusCode).toBe(201);
      expect(response.json().title).toBe(expected);
      expect((await pool.query("SELECT title FROM games WHERE id=$1", [response.json().id])).rows[0].title).toBe(expected);
    }
    for (const title of ["x".repeat(161), 42, null]) {
      const response = await app.inject({ method: "POST", url: "/v1/games",
        headers: mutationHeaders(owner, uniqueSuffix("gdef-invalid-title")),
        payload: baseGamePayload(venueId, { title }) });
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("GAME_TITLE_INVALID");
    }
    const defaultTrainer = await app.inject({ method: "POST", url: "/v1/games",
      headers: mutationHeaders(owner, uniqueSuffix("gdef-trainer-title")),
      payload: baseGamePayload(venueId, { title: "  ", activityKind: "trainer_led",
        settlement: { mode: "external", purpose: "trainer_fee", priceStatus: "by_agreement",
          priceMinor: null, currency: null, terms: "Pay directly" } }) });
    expect(defaultTrainer.statusCode).toBe(201);
    expect(defaultTrainer.json().title).toBe("Игра с тренером");
    expect((await pool.query("SELECT title FROM games WHERE id=$1", [defaultTrainer.json().id])).rows[0].title).toBe("Игра с тренером");

    const regular = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-reg-${Date.now()}-abcdefgh`),
      payload: baseGamePayload(venueId, {
        title: "Regular open play",
        activityKind: "regular",
      }),
    });
    expect(regular.statusCode).toBe(201);
    const regularBody = regular.json() as {
      id: string;
      activityKind: string;
      trainer: unknown;
      settlement: { purpose: string; priceMinor: string | null };
    };
    expect(regularBody.activityKind).toBe("regular");
    expect(regularBody.trainer).toBeNull();
    expect(regularBody.settlement.purpose).toBe("no_trainer_fee");
    expect(regularBody.settlement.priceMinor).toBeNull();

    const spoofTrainer = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-spoof-${Date.now()}-abcdefgh`),
      payload: {
        ...baseGamePayload(venueId, {
          activityKind: "trainer_led",
          trainingDescription: "Technique block",
          settlement: {
            mode: "external",
            purpose: "trainer_fee",
            priceStatus: "fixed",
            priceUnit: "per_player_per_session",
            priceMinor: "150000",
            currency: "RUB",
            terms: "Pay trainer directly",
          },
        }),
        trainerProfileId: profile.id,
      },
    });
    expect(spoofTrainer.statusCode).toBe(422);

    const trainerLed = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-tl-${Date.now()}-abcdefgh`),
      payload: baseGamePayload(venueId, {
        title: "Trainer session",
        activityKind: "trainer_led",
        trainingDescription: "Technique block",
        settlement: {
          mode: "external",
          purpose: "trainer_fee",
          priceStatus: "fixed",
          priceUnit: "per_player_per_session",
          priceMinor: "150000",
          currency: "RUB",
          terms: "Pay trainer directly",
        },
      }),
    });
    expect(trainerLed.statusCode).toBe(201);
    const trainerBody = trainerLed.json() as {
      id: string;
      version: number;
      activityKind: string;
      trainer: { profileId: string; displayName: string; declarationSource: string };
      settlement: { purpose: string; priceStatus: string; priceMinor: string };
    };
    expect(trainerBody.activityKind).toBe("trainer_led");
    expect(trainerBody.trainer.profileId).toBe(profile.id);
    expect(trainerBody.trainer.displayName).toBe("Coach Anna");
    expect(trainerBody.trainer.declarationSource).toBe("self_declared");
    expect(trainerBody.settlement.purpose).toBe("trainer_fee");
    expect(trainerBody.settlement.priceMinor).toBe("150000");

    const noProfileOther = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(other, `idem-other-tl-${Date.now()}-abcdefgh`),
      payload: baseGamePayload(venueId, {
        title: "Other trainer attempt",
        activityKind: "trainer_led",
        settlement: {
          mode: "external",
          purpose: "trainer_fee",
          priceStatus: "by_agreement",
          priceMinor: null,
          currency: null,
          terms: "Agree in chat",
        },
      }),
    });
    expect(noProfileOther.statusCode).toBe(422);

    const publishedRegular = await app.inject({
      method: "POST",
      url: `/v1/games/${regularBody.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-reg-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: 1 },
    });
    expect(publishedRegular.statusCode).toBe(200);

    const deactivate = await app.inject({
      method: "POST",
      url: "/v1/me/trainer-profile/deactivate",
      headers: mutationHeaders(owner, `idem-deact-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: profile.version },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().status).toBe("inactive");

    const publishAfterDeactivate = await app.inject({
      method: "POST",
      url: `/v1/games/${trainerBody.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-tl-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: trainerBody.version },
    });
    expect(publishAfterDeactivate.statusCode).toBe(409);

    const reactivate = await app.inject({
      method: "PUT",
      url: "/v1/me/trainer-profile",
      headers: mutationHeaders(owner, `idem-react-${Date.now()}-abcdefgh`),
      payload: {
        selfDeclared: true,
        displayName: "Coach Anna",
        bio: "Footwork & defense",
        expectedVersion: deactivate.json().version,
      },
    });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json().status).toBe("active");
    expect(reactivate.json().id).toBe(profile.id);

    const publishedTrainer = await app.inject({
      method: "POST",
      url: `/v1/games/${trainerBody.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-tl2-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: trainerBody.version },
    });
    expect(publishedTrainer.statusCode).toBe(200);

    const mixed = await app.inject({ method: "GET", url: "/v1/games?limit=100" });
    expect(mixed.statusCode).toBe(200);
    const mixedItems = mixed.json().items as Array<{ id: string; activityKind: string }>;
    expect(mixedItems.some((g) => g.id === regularBody.id && g.activityKind === "regular")).toBe(
      true,
    );
    expect(
      mixedItems.some((g) => g.id === trainerBody.id && g.activityKind === "trainer_led"),
    ).toBe(true);

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/games?activityKind=trainer_led&limit=100",
    });
    const filteredItems = filtered.json().items as Array<{ id: string; activityKind: string }>;
    expect(filteredItems.every((g) => g.activityKind === "trainer_led")).toBe(true);
    expect(filteredItems.some((g) => g.id === trainerBody.id)).toBe(true);
    expect(filteredItems.some((g) => g.id === regularBody.id)).toBe(false);

    // Deactivate after publish must not reclassify or cancel the published game.
    const deactivateAfterPublish = await app.inject({
      method: "POST",
      url: "/v1/me/trainer-profile/deactivate",
      headers: mutationHeaders(owner, `idem-deact2-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: reactivate.json().version },
    });
    expect(deactivateAfterPublish.statusCode).toBe(200);
    const detail = await app.inject({
      method: "GET",
      url: `/v1/games/${trainerBody.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().activityKind).toBe("trainer_led");
    expect(detail.json().status).toBe("published");
  }, 180_000);
});

function baseGamePayload(venueId: string, overrides: Record<string, unknown>) {
  const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
  const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
  return {
    hostDisplayName: "RTG Host",
    hostPublicContact: "telegram:@rtg",
    venueId,
    title: "RTG game",
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
      terms: "Court terms outside platform",
    },
    ...overrides,
  };
}
