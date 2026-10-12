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
import {
  cleanupDemoData,
  countDemoRows,
  seedDemoFoundation,
  withDemoTransaction,
} from "../../src/database/demo-seed-ops";
import {
  DEMO_ISSUER_NAMESPACE,
  DEMO_USER_IDS,
  demoIdentityId,
  demoUserId,
} from "../../src/database/demo-ids";
import { GamesModule } from "../../src/games/games.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
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

describeIntegration("demo foundation seed", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const observer: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:demo-seed-observer",
    subject: uniqueSuffix("demo-observer"),
    email: "demo-observer@example.com",
    displayName: "Demo Observer",
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
    process.env.GIT_SHA = "integration-demo-seed";
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
      .useValue([fakeAdapter(observer)])
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    await withDemoTransaction(pool, async (client) => {
      await cleanupDemoData(client);
    });
  }, 120_000);

  afterAll(async () => {
    await withDemoTransaction(pool, async (client) => {
      await cleanupDemoData(client);
    }).catch(() => undefined);
    await app?.close();
    await pool?.end();
  });

  async function loginObserver() {
    const start = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/account",
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=ok&state=${encodeURIComponent(state!)}&device_id=vk-device-test`,
      cookies,
    });
    expect(callback.statusCode).toBe(302);
    const sessionCookies = {
      ...cookies,
      ...parseSetCookie(callback.headers["set-cookie"]),
    };
    return {
      cookies: sessionCookies,
      cookie: cookieHeader(sessionCookies),
    };
  }

  it("seeds twice, cleans up, reseeds with exact counts and API browse", async () => {
    const first = await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "foundation"),
    );
    expect(first.users).toBe(20);
    expect(first.profiles).toBe(20);
    expect(first.games).toBe(20);
    expect(first.lookingActive).toBeGreaterThanOrEqual(6);
    expect(first.avatars).toBe("omitted_no_contract_field");

    const afterFirst = await countDemoRows(pool);
    expect(afterFirst.users).toBe(20);
    expect(afterFirst.profiles).toBe(20);
    expect(afterFirst.games).toBe(20);
    expect(afterFirst.venues).toBe(6);

    const second = await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "foundation"),
    );
    expect(second.users).toBe(20);
    expect(second.profiles).toBe(20);
    const afterSecond = await countDemoRows(pool);
    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond.profiles).toBe(20);

    // Non-demo user row must survive cleanup.
    const survivor = await pool.query<{ id: string }>(
      `INSERT INTO users (display_name) VALUES ('non-demo survivor') RETURNING id`,
    );
    const survivorId = survivor.rows[0]!.id;
    expect(DEMO_USER_IDS.includes(survivorId as (typeof DEMO_USER_IDS)[number])).toBe(
      false,
    );

    // Adversarial QA-DEMO-02: non-demo game linked to a demo creator must not be
    // deleted; cleanup refuses instead of silently removing out-of-namespace rows.
    const sentinelGameId = "e0000000-0000-4000-8000-000000000001";
    const scratchVenue = await pool.query<{ id: string }>(
      `INSERT INTO venues (
         city_id, name, address, timezone, location, data_status, lifecycle_state, normalized_name, normalized_address, provenance, created_by_user_id
       ) VALUES (
         'a0000000-0000-4000-8000-000000000001',
         'Scratch venue for sentinel',
         'Synthetic',
         'Europe/Moscow',
         ST_SetSRID(ST_MakePoint(37.6, 55.75), 4326)::geography,
         'unverified',
         'unverified',
         'scratch venue for sentinel',
         'synthetic',
         'operator_seeded',
         $1
       ) RETURNING id`,
      [survivorId],
    );
    const starts = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
    const deadline = new Date(starts.getTime() - 12 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO games (
         id, organizer_id, host_display_name, host_public_contact,
         venue_id, title, status, visibility,
         starts_at, ends_at, timezone, application_deadline_at,
         capacity, external_reserved_count, format_key,
         level_scale_id, level_scale_version, allowed_level_ids,
         activity_kind, settlement_mode, settlement_purpose, price_status,
         settlement_terms, version, created_by_user_id, published_at
       ) VALUES (
         $1, NULL, 'Sentinel Host', 'demo-contact:sentinel',
         $2, 'Non-demo sentinel game', 'published', 'public',
         $3, $4, 'Europe/Moscow', $5,
         4, 0, 'doubles',
         'ntrp', 1, '["3.0"]'::jsonb,
         'regular', 'external', 'no_trainer_fee', NULL,
         'Adversarial non-demo row for cleanup isolation.', 1, $6, now()
       )`,
      [
        sentinelGameId,
        scratchVenue.rows[0]!.id,
        starts.toISOString(),
        ends.toISOString(),
        deadline.toISOString(),
        demoUserId(1),
      ],
    );

    await expect(
      withDemoTransaction(pool, async (client) => {
        await cleanupDemoData(client);
      }),
    ).rejects.toThrow(/Demo cleanup refused: out-of-namespace rows/);

    const sentinelStill = await pool.query(
      `SELECT id, created_by_user_id FROM games WHERE id = $1`,
      [sentinelGameId],
    );
    expect(sentinelStill.rowCount).toBe(1);
    expect(sentinelStill.rows[0]!.created_by_user_id).toBe(demoUserId(1));
    const demoStillPresent = await countDemoRows(pool);
    expect(demoStillPresent.users).toBe(20);
    expect(demoStillPresent.profiles).toBe(20);

    // Remove adversarial dependents, then cleanup + reseed restore exact population.
    await pool.query(`DELETE FROM games WHERE id = $1`, [sentinelGameId]);
    await pool.query(`DELETE FROM venues WHERE id = $1`, [
      scratchVenue.rows[0]!.id,
    ]);

    await withDemoTransaction(pool, async (client) => {
      await cleanupDemoData(client);
    });
    const afterCleanup = await countDemoRows(pool);
    expect(afterCleanup.users).toBe(0);
    expect(afterCleanup.profiles).toBe(0);
    expect(afterCleanup.games).toBe(0);
    const survivorStill = await pool.query(
      `SELECT id FROM users WHERE id = $1`,
      [survivorId],
    );
    expect(survivorStill.rowCount).toBe(1);

    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    const afterReseed = await countDemoRows(pool);
    expect(afterReseed.users).toBe(20);
    expect(afterReseed.profiles).toBe(20);
    expect(afterReseed.games).toBe(20);
    expect(afterReseed.lookingActive).toBeGreaterThanOrEqual(6);

    const capacity = await pool.query<{ ok: boolean }>(
      `SELECT bool_and(
         (
           SELECT count(*)::int FROM participations p
           WHERE p.game_id = g.id AND p.status = 'confirmed'
         ) + g.external_reserved_count <= g.capacity
       ) AS ok
       FROM games g
       WHERE g.id::text LIKE 'd0f00020-%'`,
    );
    expect(capacity.rows[0]?.ok).toBe(true);

    const citySplit = await pool.query<{ city_id: string; c: number }>(
      `SELECT v.city_id::text AS city_id, count(*)::int AS c
       FROM games g
       INNER JOIN venues v ON v.id = g.venue_id
       WHERE g.id::text LIKE 'd0f00020-%'
       GROUP BY v.city_id
       ORDER BY v.city_id`,
    );
    const byCity = Object.fromEntries(
      citySplit.rows.map((r) => [r.city_id, r.c]),
    );
    expect(byCity["a0000000-0000-4000-8000-000000000001"]).toBeGreaterThan(0);
    expect(byCity["a0000000-0000-4000-8000-000000000002"]).toBeGreaterThan(0);
    expect(
      (byCity["a0000000-0000-4000-8000-000000000001"] ?? 0) +
        (byCity["a0000000-0000-4000-8000-000000000002"] ?? 0),
    ).toBe(20);

    const cities = await app.inject({ method: "GET", url: "/v1/cities" });
    expect(cities.statusCode).toBe(200);
    const cityItems = (
      cities.json() as { items: Array<{ id: string; nameRu: string }> }
    ).items;
    expect(
      cityItems.some(
        (c) =>
          c.id === "a0000000-0000-4000-8000-000000000001" &&
          c.nameRu === "Москва",
      ),
    ).toBe(true);
    expect(
      cityItems.some(
        (c) =>
          c.id === "a0000000-0000-4000-8000-000000000002" &&
          c.nameRu === "Санкт-Петербург",
      ),
    ).toBe(true);

    // Demo games are scheduled 21+ days out so shared-DB near-term fixtures
    // cannot crowd them out of the default discovery page.
    const startsFrom = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const gamesBrowse = await app.inject({
      method: "GET",
      url: `/v1/games?limit=50&startsFrom=${encodeURIComponent(startsFrom)}`,
    });
    expect(gamesBrowse.statusCode).toBe(200);
    const gameItems = (gamesBrowse.json() as { items: Array<{ id: string; title: string }> })
      .items;
    const demoGames = gameItems.filter((g) => g.id.startsWith("d0f00020-"));
    expect(demoGames.length).toBeGreaterThanOrEqual(10);
    expect(demoGames.some((g) => g.title.includes("Demo"))).toBe(true);

    const moscowBrowse = await app.inject({
      method: "GET",
      url: `/v1/games?limit=50&cityId=a0000000-0000-4000-8000-000000000001&startsFrom=${encodeURIComponent(startsFrom)}`,
    });
    expect(moscowBrowse.statusCode).toBe(200);
    const moscowDemo = (
      moscowBrowse.json() as { items: Array<{ id: string }> }
    ).items.filter((g) => g.id.startsWith("d0f00020-"));
    expect(moscowDemo.length).toBeGreaterThan(0);

    const spbBrowse = await app.inject({
      method: "GET",
      url: `/v1/games?limit=50&cityId=a0000000-0000-4000-8000-000000000002&startsFrom=${encodeURIComponent(startsFrom)}`,
    });
    expect(spbBrowse.statusCode).toBe(200);
    const spbDemo = (
      spbBrowse.json() as { items: Array<{ id: string; title: string }> }
    ).items.filter((g) => g.id.startsWith("d0f00020-"));
    expect(spbDemo.length).toBeGreaterThan(0);
    expect(spbDemo.some((g) => g.title.includes("SPB"))).toBe(true);

    const session = await loginObserver();
    const players = await app.inject({
      method: "GET",
      url: "/v1/players?limit=50",
      cookies: session.cookies,
    });
    expect(players.statusCode).toBe(200);
    const playerItems = (
      players.json() as { items: Array<{ publicPlayerId: string; displayName: string }> }
    ).items;
    const demoPlayers = playerItems.filter((p) =>
      p.publicPlayerId.startsWith("d0f00003-"),
    );
    expect(demoPlayers.length).toBeGreaterThanOrEqual(10);

    const profile = await app.inject({
      method: "GET",
      url: `/v1/players/${demoPlayers[0]!.publicPlayerId}`,
      cookies: session.cookies,
    });
    expect(profile.statusCode).toBe(200);
    const body = profile.json() as Record<string, unknown>;
    expect(body.displayName).toBeTruthy();
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("avatarUrl");
    expect(JSON.stringify(body)).not.toContain(demoUserId(1));

    await pool.query(`DELETE FROM users WHERE id = $1`, [survivorId]);

    const radar = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM radar_presences
       WHERE user_id = ANY($1::uuid[])`,
      [DEMO_USER_IDS],
    );
    expect(radar.rows[0]!.c).toBe(0);
  }, 120_000);

  it("refuses cleanup atomically when non-demo participation/transition/manager attach to a demo game", async () => {
    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "foundation"),
    );
    const before = await countDemoRows(pool);
    expect(before.users).toBe(20);
    expect(before.profiles).toBe(20);
    expect(before.games).toBe(20);

    // Exact QA-DEMO-02 retry-3 adversarial IDs (non-demo namespace e000...).
    const foreignUserId = "e0000000-0000-4000-8000-000000000002";
    const foreignParticipationId = "e0000000-0000-4000-8000-000000000003";
    const foreignTransitionId = "e0000000-0000-4000-8000-000000000004";
    const foreignManagerId = "e0000000-0000-4000-8000-000000000005";
    const demoGameId = "d0f00020-0000-4000-8000-000000000001";

    await pool.query(
      `INSERT INTO users (id, display_name)
       VALUES ($1, 'QA non-demo participant')`,
      [foreignUserId],
    );
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status)
       VALUES ($1, $2, $3, 'pending')`,
      [foreignParticipationId, demoGameId, foreignUserId],
    );
    await pool.query(
      `INSERT INTO participation_transitions
         (id, participation_id, to_status, actor_id, aggregate_version, game_version)
       VALUES ($1, $2, 'pending', $3, 1, 1)`,
      [foreignTransitionId, foreignParticipationId, foreignUserId],
    );
    await pool.query(
      `INSERT INTO game_managers (id, game_id, user_id, role)
       VALUES ($1, $2, $3, 'manager')`,
      [foreignManagerId, demoGameId, foreignUserId],
    );

    const beforeSentinels = await pool.query<{
      user_c: number;
      participation_c: number;
      transition_c: number;
      manager_c: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE id = $1) AS user_c,
         (SELECT count(*)::int FROM participations WHERE id = $2) AS participation_c,
         (SELECT count(*)::int FROM participation_transitions WHERE id = $3) AS transition_c,
         (SELECT count(*)::int FROM game_managers WHERE id = $4) AS manager_c`,
      [
        foreignUserId,
        foreignParticipationId,
        foreignTransitionId,
        foreignManagerId,
      ],
    );
    expect(beforeSentinels.rows[0]).toEqual({
      user_c: 1,
      participation_c: 1,
      transition_c: 1,
      manager_c: 1,
    });

    await expect(
      withDemoTransaction(pool, async (client) => {
        await cleanupDemoData(client);
      }),
    ).rejects.toThrow(/Demo cleanup refused: out-of-namespace rows/);

    const afterRefuse = await pool.query<{
      user_c: number;
      participation_c: number;
      transition_c: number;
      manager_c: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE id = $1) AS user_c,
         (SELECT count(*)::int FROM participations WHERE id = $2) AS participation_c,
         (SELECT count(*)::int FROM participation_transitions WHERE id = $3) AS transition_c,
         (SELECT count(*)::int FROM game_managers WHERE id = $4) AS manager_c`,
      [
        foreignUserId,
        foreignParticipationId,
        foreignTransitionId,
        foreignManagerId,
      ],
    );
    // No partial deletion: every foreign sentinel survives atomic refuse.
    expect(afterRefuse.rows[0]).toEqual({
      user_c: 1,
      participation_c: 1,
      transition_c: 1,
      manager_c: 1,
    });
    const demoStillPresent = await countDemoRows(pool);
    expect(demoStillPresent).toEqual(before);

    // Remove adversarial mixed-provenance rows, then cleanup + reseed succeed.
    await pool.query(`DELETE FROM participation_transitions WHERE id = $1`, [
      foreignTransitionId,
    ]);
    await pool.query(`DELETE FROM participations WHERE id = $1`, [
      foreignParticipationId,
    ]);
    await pool.query(`DELETE FROM game_managers WHERE id = $1`, [
      foreignManagerId,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [foreignUserId]);

    await withDemoTransaction(pool, async (client) => {
      await cleanupDemoData(client);
    });
    const afterCleanup = await countDemoRows(pool);
    expect(afterCleanup.users).toBe(0);
    expect(afterCleanup.profiles).toBe(0);
    expect(afterCleanup.games).toBe(0);

    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    const afterReseed = await countDemoRows(pool);
    expect(afterReseed.users).toBe(20);
    expect(afterReseed.profiles).toBe(20);
    expect(afterReseed.games).toBe(20);
  }, 120_000);

  it("refuses cleanup atomically when a foreign user holds a demo-issuer external identity", async () => {
    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    const before = await countDemoRows(pool);
    expect(before.users).toBe(20);
    expect(before.profiles).toBe(20);
    expect(before.games).toBe(20);

    // Exact independent-QA counterexample IDs from repair-02 FAIL handoff.
    const foreignUserId = "e2000000-0000-4000-8000-000000000001";
    const foreignIdentityId = "e2000000-0000-4000-8000-000000000007";
    const demoUser = demoUserId(1);
    const demoIdentity = demoIdentityId(1);

    await pool.query(
      `INSERT INTO users (id, display_name)
       VALUES ($1, 'QA foreign identity owner')`,
      [foreignUserId],
    );
    await pool.query(
      `INSERT INTO external_identities (
         id, user_id, provider_key, issuer_namespace, subject,
         email, display_name, avatar_url
       ) VALUES ($1, $2, 'vk', $3, $4, NULL, 'Foreign demo-issuer identity', NULL)`,
      [
        foreignIdentityId,
        foreignUserId,
        DEMO_ISSUER_NAMESPACE,
        "qa-foreign-demo-issuer-subject",
      ],
    );

    const beforeIdentityMatrix = await pool.query<{
      foreign_user_c: number;
      foreign_identity_c: number;
      demo_identity_c: number;
      demo_user_identity_issuer: string | null;
    }>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE id = $1) AS foreign_user_c,
         (SELECT count(*)::int FROM external_identities WHERE id = $2) AS foreign_identity_c,
         (SELECT count(*)::int FROM external_identities
           WHERE id = $3 AND user_id = $4 AND issuer_namespace = $5) AS demo_identity_c,
         (SELECT issuer_namespace FROM external_identities
           WHERE id = $3 AND user_id = $4) AS demo_user_identity_issuer`,
      [
        foreignUserId,
        foreignIdentityId,
        demoIdentity,
        demoUser,
        DEMO_ISSUER_NAMESPACE,
      ],
    );
    expect(beforeIdentityMatrix.rows[0]).toEqual({
      foreign_user_c: 1,
      foreign_identity_c: 1,
      demo_identity_c: 1,
      demo_user_identity_issuer: DEMO_ISSUER_NAMESPACE,
    });

    await expect(
      withDemoTransaction(pool, async (client) => {
        await cleanupDemoData(client);
      }),
    ).rejects.toThrow(
      /Demo cleanup refused: out-of-namespace rows.*external_identities\.demo_issuer\.non_demo_user/,
    );

    const afterRefuse = await pool.query<{
      foreign_user_c: number;
      foreign_identity_c: number;
      demo_identity_c: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM users WHERE id = $1) AS foreign_user_c,
         (SELECT count(*)::int FROM external_identities WHERE id = $2) AS foreign_identity_c,
         (SELECT count(*)::int FROM external_identities
           WHERE id = $3 AND user_id = $4 AND issuer_namespace = $5) AS demo_identity_c`,
      [
        foreignUserId,
        foreignIdentityId,
        demoIdentity,
        demoUser,
        DEMO_ISSUER_NAMESPACE,
      ],
    );
    // Atomic refuse: foreign identity survives; demo population untouched.
    expect(afterRefuse.rows[0]).toEqual({
      foreign_user_c: 1,
      foreign_identity_c: 1,
      demo_identity_c: 1,
    });
    expect(await countDemoRows(pool)).toEqual(before);

    // Comparable combo: demo user + non-demo issuer must also refuse.
    const demoForeignIssuerIdentityId = "e2000000-0000-4000-8000-000000000008";
    await pool.query(`DELETE FROM external_identities WHERE id = $1`, [
      foreignIdentityId,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [foreignUserId]);
    await pool.query(
      `INSERT INTO external_identities (
         id, user_id, provider_key, issuer_namespace, subject,
         email, display_name, avatar_url
       ) VALUES ($1, $2, 'yandex', $3, $4, NULL, 'Demo user foreign issuer', NULL)`,
      [
        demoForeignIssuerIdentityId,
        demoUser,
        "vkid:app:non-demo-adversarial",
        "qa-demo-user-foreign-issuer",
      ],
    );

    await expect(
      withDemoTransaction(pool, async (client) => {
        await cleanupDemoData(client);
      }),
    ).rejects.toThrow(
      /Demo cleanup refused: out-of-namespace rows.*external_identities\.demo_user\.non_demo_issuer/,
    );
    const mixedIssuerStill = await pool.query(
      `SELECT id FROM external_identities WHERE id = $1`,
      [demoForeignIssuerIdentityId],
    );
    expect(mixedIssuerStill.rowCount).toBe(1);
    expect(await countDemoRows(pool)).toEqual(before);

    // Remove adversarial identities, then pure-demo cleanup + reseed succeed.
    await pool.query(`DELETE FROM external_identities WHERE id = $1`, [
      demoForeignIssuerIdentityId,
    ]);
    await withDemoTransaction(pool, async (client) => {
      await cleanupDemoData(client);
    });
    const afterCleanup = await countDemoRows(pool);
    expect(afterCleanup.users).toBe(0);
    expect(afterCleanup.profiles).toBe(0);
    expect(afterCleanup.games).toBe(0);
    const demoIdentitiesGone = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM external_identities
       WHERE issuer_namespace = $1 OR user_id = ANY($2::uuid[])`,
      [DEMO_ISSUER_NAMESPACE, DEMO_USER_IDS],
    );
    expect(demoIdentitiesGone.rows[0]!.c).toBe(0);

    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    const afterReseed = await countDemoRows(pool);
    expect(afterReseed.users).toBe(20);
    expect(afterReseed.profiles).toBe(20);
    expect(afterReseed.games).toBe(20);
    const demoIdentityRestored = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM external_identities
       WHERE user_id = ANY($1::uuid[]) AND issuer_namespace = $2`,
      [DEMO_USER_IDS, DEMO_ISSUER_NAMESPACE],
    );
    expect(demoIdentityRestored.rows[0]!.c).toBe(20);
    const radar = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM radar_presences
       WHERE user_id = ANY($1::uuid[])`,
      [DEMO_USER_IDS],
    );
    expect(radar.rows[0]!.c).toBe(0);
  }, 120_000);
});
