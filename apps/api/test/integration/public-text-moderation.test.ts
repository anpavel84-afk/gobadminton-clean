/**
 * MOD-V2-A public text moderation — isolated PostgreSQL + fake provider.
 * Skips when RUN_DB_INTEGRATION≠1 or dependencies/database unavailable (author sandbox).
 * Parent supplies pinned ephemeral PostGIS; never points at live DB.
 */
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
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import { ModerationModule } from "../../src/moderation/moderation.module";
import {
  MODERATION_MODEL,
  MODERATION_PROVIDER,
  ModerationProviderError,
  safeTextBatchDecision,
  TEXT_CATEGORIES,
} from "../../src/moderation/provider";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const webOrigin = "http://127.0.0.1:3011";

function assertDisposableDatabase(url: string): void {
  if (process.env.RUN_DB_INTEGRATION !== "1") {
    throw new Error("RUN_DB_INTEGRATION=1 required before migrate");
  }
  if (process.env.GMAP1_DISPOSABLE_DB !== "1") {
    throw new Error("GMAP1_DISPOSABLE_DB=1 required before migrate");
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Loopback disposable PostgreSQL required");
  }
}

function parseSetCookie(header: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const item of values) {
    const pair = item.split(";")[0] ?? "";
    const idx = pair.indexOf("=");
    if (idx > 0) out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
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

function flaggedTextBatch(count: number, flaggedIndex = 0) {
  return {
    model: MODERATION_MODEL,
    responseId: "synthetic-flagged-text",
    results: Array.from({ length: count }, (_, i) => ({
      flagged: i === flaggedIndex,
      categories: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, i === flaggedIndex && key === "harassment"]),
      ) as Record<(typeof TEXT_CATEGORIES)[number], boolean>,
    })),
  };
}

describeIntegration("MOD-V2-A public text moderation", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let fake: FakeModerationProvider;
  let owner: { cookies: Record<string, string>; csrf: string; cookie: string };

  const identity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:modtext",
    subject: uniqueSuffix("modtext-owner"),
    email: "modtext-owner@example.com",
    displayName: "Account Name Must Stay Private",
  };

  beforeAll(async () => {
    assertDisposableDatabase(databaseUrl);
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3011",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "modtext-synthetic-fingerprint-secret!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      VK_CLIENT_ID: "vk-test",
      VK_CLIENT_SECRET: "vk-secret",
      VK_REDIRECT_URI: "http://127.0.0.1:3011/v1/auth/vk/callback",
      YANDEX_CLIENT_ID: "ya-test",
      YANDEX_CLIENT_SECRET: "ya-secret",
      YANDEX_REDIRECT_URI: "http://127.0.0.1:3011/v1/auth/yandex/callback",
      COOKIE_SECURE: "false",
    });
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    const db = createDatabase(databaseUrl);
    pool = db.pool;
    const env = loadEnv(process.env);
    fake = new FakeModerationProvider(env);
    const moduleRef = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        AuthModule,
        ProfilesModule,
        TrainersModule,
        OrganizersModule,
        GamesModule,
        VenuesModule,
        ModerationModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identity), fakeAdapter({ ...identity, provider: "yandex" })])
      .overrideProvider(MODERATION_PROVIDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const start = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/",
    });
    expect(start.statusCode).toBe(200);
    const authorizationUrl = String(start.json().authorizationUrl);
    const state = new URL(authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();
    const startCookies = parseSetCookie(start.headers["set-cookie"]);
    const cb = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=x&state=${encodeURIComponent(state!)}&device_id=modtext`,
      cookies: startCookies,
    });
    expect(cb.statusCode).toBe(302);
    expect(typeof cb.headers.location).toBe("string");
    expect(String(cb.headers.location).length).toBeGreaterThan(0);
    const cookies = {
      ...startCookies,
      ...parseSetCookie(cb.headers["set-cookie"]),
    };
    const me = await app.inject({ method: "GET", url: "/v1/me", cookies });
    expect(me.statusCode).toBe(200);
    owner = {
      cookies,
      csrf: me.json().csrfToken,
      cookie: cookieHeader(cookies),
    };
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  function headers(key: string) {
    return {
      cookie: owner.cookie,
      "x-csrf-token": owner.csrf,
      "idempotency-key": key,
      origin: webOrigin,
      "content-type": "application/json",
    };
  }

  function gamePayload(venueId: string, overrides: Record<string, unknown> = {}) {
    const starts = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
    const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
    return {
      hostDisplayName: "Синтетический организатор",
      hostPublicContact: "telegram:@modtext-host",
      venueId,
      title: "Синтетическая игра модерации",
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
        allowedLevelIds: ["3.0"],
      },
      settlement: {
        mode: "external",
        purpose: "no_trainer_fee",
        priceMinor: null,
        currency: null,
        terms: "Синтетические условия оплаты вне платформы",
      },
      ...overrides,
    };
  }

  async function createVenue(): Promise<string> {
    const venue = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: headers(uniqueSuffix("modtext-venue")),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "ModText Synthetic Hall",
        address: "Synthetic Moscow address",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venue.statusCode);
    return venue.json().id as string;
  }

  it("rejects profane profile name and preserves prior; trusted Игрок on defaults", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: owner.cookies,
    });
    expect(before.statusCode).toBe(200);
    expect(before.json().displayName).toBe("Игрок");
    const version = before.json().version;
    const rejected = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: headers(uniqueSuffix("patch-bad")),
      payload: { expectedVersion: version, displayName: "хуй" },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");
    expect(rejected.json().fields?.displayName).toBeTruthy();
    const after = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: owner.cookies,
    });
    expect(after.json().displayName).toBe("Игрок");
    expect(after.json().version).toBe(version);
  });

  it("accepts ordinary name via fake provider and binds approval", async () => {
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    const before = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: owner.cookies,
    });
    const ok = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: headers(uniqueSuffix("patch-ok")),
      payload: {
        expectedVersion: before.json().version,
        displayName: "Анна Смирнова",
        bio: "Играю в бадминтон по вечерам",
        cityId: MOSCOW_CITY_ID,
      },
    });
    expect(ok.statusCode).toBeLessThan(300);
    expect(ok.json().displayName).toBe("Анна Смирнова");
    expect(fake.textCalls).toBeGreaterThan(0);
    const bindings = await pool.query(
      `SELECT binding_kind FROM content_moderation_bindings
       WHERE entity_kind='player_social_profile' AND surface_key='profile_display_name'`,
    );
    expect(bindings.rowCount).toBeGreaterThan(0);
  });

  it("covers draft create, unlisted publish, reject/version/idempotent, visibility promotion and trainer reactivation", async () => {
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    const venueId = await createVenue();

    const badCreate = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: headers(uniqueSuffix("game-bad")),
      payload: gamePayload(venueId, { title: "хуй" }),
    });
    expect(badCreate.statusCode).toBe(422);
    expect(badCreate.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");

    const draft = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: headers(uniqueSuffix("game-draft")),
      payload: gamePayload(venueId, {
        visibility: "unlisted",
        title: "Черновик без каталога",
      }),
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().status).toBe("draft");
    expect(draft.json().visibility).toBe("unlisted");
    const gameId = draft.json().id as string;
    const version = draft.json().version as number;

    const stale = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/publish`,
      headers: headers(uniqueSuffix("pub-stale")),
      payload: { expectedVersion: version + 99 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");

    const publishKey = uniqueSuffix("pub-ok");
    const published = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/publish`,
      headers: headers(publishKey),
      payload: { expectedVersion: version },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().status).toBe("published");
    expect(published.json().visibility).toBe("unlisted");
    const pubBindings = await pool.query(
      `SELECT binding_kind FROM content_moderation_bindings
       WHERE entity_kind='game' AND entity_id=$1 AND binding_kind='publication'`,
      [gameId],
    );
    expect(pubBindings.rowCount).toBeGreaterThan(0);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/publish`,
      headers: headers(publishKey),
      payload: { expectedVersion: version },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(published.json());

    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, 0);
    const providerReject = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: headers(uniqueSuffix("game-flag")),
      payload: gamePayload(venueId, { title: "Обычный заголовок флага" }),
    });
    expect(providerReject.statusCode).toBe(422);
    expect(providerReject.json().code).toBe("PUBLIC_TEXT_CONTENT_REJECTED");

    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable");
    };
    const unavailable = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: headers(uniqueSuffix("game-503")),
      payload: gamePayload(venueId, { title: "Временная недоступность" }),
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().code).toBe("MODERATION_TEMPORARILY_UNAVAILABLE");

    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    const profile = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: owner.cookies,
    });
    expect(profile.statusCode).toBe(200);
    const visibility = await app.inject({
      method: "PUT",
      url: "/v1/me/social-profile/visibility",
      headers: headers(uniqueSuffix("vis-on")),
      payload: {
        directoryVisible: true,
        expectedVersion: profile.json().version,
        consentPolicyVersion: "directory-mvp-v1",
      },
    });
    expect(visibility.statusCode).toBeLessThan(300);
    expect(visibility.json().directoryVisible).toBe(true);

    const trainer = await app.inject({
      method: "PUT",
      url: "/v1/me/trainer-profile",
      headers: headers(uniqueSuffix("trainer-on")),
      payload: {
        selfDeclared: true,
        displayName: "Тренер МодТекст",
        bio: "Синтетическое описание тренера",
      },
    });
    expect(trainer.statusCode).toBe(201);
    expect(trainer.json().status).toBe("active");
    const deactivated = await app.inject({
      method: "POST",
      url: "/v1/me/trainer-profile/deactivate",
      headers: headers(uniqueSuffix("trainer-off")),
      payload: { expectedVersion: trainer.json().version },
    });
    expect(deactivated.statusCode).toBeLessThan(300);
    expect(deactivated.json().status).toBe("inactive");
    const reactivated = await app.inject({
      method: "PUT",
      url: "/v1/me/trainer-profile",
      headers: headers(uniqueSuffix("trainer-re")),
      payload: {
        selfDeclared: true,
        displayName: "Тренер МодТекст",
        bio: "Синтетическое описание тренера",
        expectedVersion: deactivated.json().version,
      },
    });
    expect(reactivated.statusCode).toBeLessThan(300);
    expect(reactivated.json().status).toBe("active");
  });
});

describe("MOD-V2-A public-text-moderation author sandbox gate", () => {
  it("records NOTRUN when isolated DB integration is not enabled", () => {
    if (process.env.RUN_DB_INTEGRATION === "1") return;
    expect(process.env.RUN_DB_INTEGRATION ?? "0").not.toBe("1");
  });
});
