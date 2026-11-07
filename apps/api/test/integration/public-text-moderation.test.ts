/**
 * MOD-V2-A public text moderation — isolated PostgreSQL + fake provider.
 * Skips when RUN_DB_INTEGRATION≠1 or dependencies/database unavailable (author sandbox).
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
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import { ModerationModule } from "../../src/moderation/moderation.module";
import { MODERATION_PROVIDER } from "../../src/moderation/provider";
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

describeIntegration("MOD-V2-A public text moderation", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let fake: FakeModerationProvider;
  let owner: { cookies: Record<string, string>; csrf: string };

  const identity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:modtext",
    subject: uniqueSuffix("modtext-owner"),
    email: "modtext-owner@example.com",
    displayName: "Account Name Must Stay Private",
  };

  beforeAll(async () => {
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    const db = createDatabase(databaseUrl);
    pool = db.pool;
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3011",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:3011",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "modtext-synthetic-fingerprint-secret!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
    } as never);
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
      .useValue({ vk: fakeAdapter(identity), yandex: fakeAdapter({ ...identity, provider: "yandex" }) })
      .overrideProvider(MODERATION_PROVIDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const start = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnTo=/",
    });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const cb = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=x&state=${encodeURIComponent(state)}`,
      cookies: parseSetCookie(start.headers["set-cookie"]),
    });
    const cookies = { ...parseSetCookie(start.headers["set-cookie"]), ...parseSetCookie(cb.headers["set-cookie"]) };
    const me = await app.inject({ method: "GET", url: "/v1/me", cookies });
    owner = { cookies, csrf: me.json().csrfToken };
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  function headers(key: string) {
    return {
      cookie: cookieHeader(owner.cookies),
      "x-csrf-token": owner.csrf,
      "idempotency-key": key,
      origin: "http://127.0.0.1:3011",
    };
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
});

describe("MOD-V2-A public-text-moderation author sandbox gate", () => {
  it("records NOTRUN when isolated DB integration is not enabled", () => {
    if (process.env.RUN_DB_INTEGRATION === "1") return;
    expect(process.env.RUN_DB_INTEGRATION ?? "0").not.toBe("1");
  });
});
