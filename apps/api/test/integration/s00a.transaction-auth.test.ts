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
import { GameAuthorityService } from "../../src/games/game-authority.service";
import { GamesModule } from "../../src/games/games.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
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

describeIntegration("S-00A transaction/auth reconciliation", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let gameAuthority: GameAuthorityService;

  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:s00a",
    subject: uniqueSuffix("owner"),
    email: "owner-s00a@example.com",
    displayName: "Owner S00A",
  };
  const playerIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:s00a",
    subject: uniqueSuffix("player"),
    email: "player-s00a@example.com",
    displayName: "Player S00A",
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.DATABASE_POOL_MAX = "20";
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
    process.env.GIT_SHA = "integration-s00a";

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
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(ownerIdentity), fakeAdapter(playerIdentity)])
      .compile();

    gameAuthority = moduleRef.get(GameAuthorityService);

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

  async function login(provider: "vk" | "yandex"): Promise<Session> {
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
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  async function publishGame(owner: Session, capacity = 2) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: `Fixture ${suffix}`,
        address: `Fictional ${suffix}`,
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    const venue = venueRes.json() as { id: string };
    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000).toISOString();
    const deadline = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-${suffix}-abcdefgh`),
      payload: {
        activityKind: "regular",
        venueId: venue.id,
        title: `S00A ${suffix}`,
        hostDisplayName: `Host ${suffix}`,
        hostPublicContact: "telegram:@s00a",
        visibility: "public",
        startsAt,
        endsAt,
        timezone: "Europe/Moscow",
        applicationDeadlineAt: deadline,
        capacity,
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
    expect(draftRes.statusCode).toBe(201);
    const draft = draftRes.json() as { id: string; version: number };
    const publishedRes = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-${suffix}-abcdefgh`),
      payload: { expectedVersion: draft.version },
    });
    expect(publishedRes.statusCode).toBe(200);
    return publishedRes.json() as {
      id: string;
      version: number;
      confirmedCount: number;
      availablePlaces: number;
    };
  }

  it("bumps Game.version on seat changes and not on pending-only reject", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    const game = await publishGame(owner, 2);
    const v0 = game.version;

    const req = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-req-${Date.now()}-abcdefghij`),
      payload: { expectedGameVersion: v0 },
    });
    expect(req.statusCode).toBe(201);
    const part = req.json() as { id: string; version: number; status: string };
    expect(part.status).toBe("pending");

    const afterRequest = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    expect(afterRequest.rows[0]!.version).toBe(v0);

    const confirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${part.id}/confirm`,
      headers: mutationHeaders(owner, `idem-conf-${Date.now()}-abcdefghij`),
      payload: { expectedVersion: part.version },
    });
    expect(confirm.statusCode).toBe(200);
    const afterConfirm = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    expect(afterConfirm.rows[0]!.version).toBe(v0 + 1);

    const confirmed = confirm.json() as { version: number };
    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/participations/${part.id}/withdraw`,
      headers: mutationHeaders(player, `idem-wd-${Date.now()}-abcdefghij`),
      payload: { expectedVersion: confirmed.version },
    });
    expect(withdraw.statusCode).toBe(200);
    const afterWithdraw = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    expect(afterWithdraw.rows[0]!.version).toBe(v0 + 2);

    const reapplyGameVersion = afterWithdraw.rows[0]!.version;
    const reapply = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-reapp-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: reapplyGameVersion },
    });
    expect(reapply.statusCode).toBe(201);
    const pending2 = reapply.json() as { id: string; version: number };
    const reject = await app.inject({
      method: "POST",
      url: `/v1/participations/${pending2.id}/reject`,
      headers: mutationHeaders(owner, `idem-rej-${Date.now()}-abcdefghij`),
      payload: { expectedVersion: pending2.version, reason: "not a fit" },
    });
    expect(reject.statusCode).toBe(200);
    const afterReject = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    expect(afterReject.rows[0]!.version).toBe(reapplyGameVersion);
  });

  it("replays confirm after manager revoke without cached success", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    const game = await publishGame(owner, 2);
    const req = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-req2-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: game.version },
    });
    expect(req.statusCode).toBe(201);
    const part = req.json() as { id: string; version: number };
    const key = `idem-conf-replay-${Date.now()}-abcdefgh`;
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${part.id}/confirm`,
      headers: mutationHeaders(owner, key),
      payload: { expectedVersion: part.version },
    });
    expect(confirm.statusCode).toBe(200);

    await gameAuthority.revokeForTests(game.id, owner.userId);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/participations/${part.id}/confirm`,
      headers: mutationHeaders(owner, key),
      payload: { expectedVersion: part.version },
    });
    expect([403, 404]).toContain(replay.statusCode);
    const body = replay.json() as { code?: string };
    expect(body.code).not.toBeUndefined();
    expect(body.code).not.toBe("GAME_FULL");
  });

  async function createVenue(owner: Session) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-cr-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: `Fixture ${suffix}`,
        address: `Fictional ${suffix}`,
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    return venueRes.json() as { id: string };
  }

  function draftPayload(venueId: string, title: string) {
    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const endsAt = new Date(
      Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000,
    ).toISOString();
    const deadline = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    return {
      activityKind: "regular" as const,
      venueId,
      title,
      hostDisplayName: `Host ${title}`,
      hostPublicContact: "telegram:@s00a-create",
      visibility: "public" as const,
      startsAt,
      endsAt,
      timezone: "Europe/Moscow",
      applicationDeadlineAt: deadline,
      capacity: 4,
      externalReservedCount: 0,
      formatKey: "doubles",
      levelRule: {
        scaleId: "ntrp",
        scaleVersion: 1,
        allowedLevelIds: ["3.0", "3.5"],
      },
      settlement: {
        mode: "external" as const,
        purpose: "no_trainer_fee" as const,
        priceMinor: null,
        currency: null,
        terms: "Court terms arranged outside the platform",
      },
    };
  }

  async function effectCounts(gameId: string, ownerUserId: string) {
    const games = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM games WHERE id = $1`,
      [gameId],
    );
    const managers = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM game_managers
       WHERE game_id = $1 AND user_id = $2 AND status = 'active'`,
      [gameId, ownerUserId],
    );
    const outbox = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM outbox_events
       WHERE aggregate_type = 'game' AND aggregate_id = $1`,
      [gameId],
    );
    const receipts = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM idempotency_records
       WHERE actor_id = $1 AND operation = 'games.create'`,
      [ownerUserId],
    );
    return {
      games: Number(games.rows[0]!.c),
      activeManagers: Number(managers.rows[0]!.c),
      outbox: Number(outbox.rows[0]!.c),
      createReceipts: Number(receipts.rows[0]!.c),
    };
  }

  it("replays games.create after manager revoke without cached private body", async () => {
    const owner = await login("vk");
    const venue = await createVenue(owner);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const key = `idem-create-revoke-${suffix}-abcdefgh`;
    const payload = draftPayload(venue.id, `Create revoke ${suffix}`);

    const first = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, key),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const created = first.json() as { id: string; title: string };
    expect(created.id).toBeTruthy();
    const before = await effectCounts(created.id, owner.userId);
    expect(before.games).toBe(1);
    expect(before.activeManagers).toBe(1);

    await gameAuthority.revokeForTests(created.id, owner.userId);
    const afterRevoke = await effectCounts(created.id, owner.userId);
    expect(afterRevoke.activeManagers).toBe(0);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, key),
      payload,
    });
    expect([403, 404]).toContain(replay.statusCode);
    const replayBody = replay.json() as { id?: string; code?: string };
    expect(replayBody.id).toBeUndefined();
    expect(replayBody.code).toBeTruthy();
    expect(replayBody.code).not.toBe("IDEMPOTENCY_KEY_REUSED");

    const after = await effectCounts(created.id, owner.userId);
    expect(after.games).toBe(before.games);
    expect(after.outbox).toBe(before.outbox);
    expect(after.createReceipts).toBe(before.createReceipts);
    expect(after.activeManagers).toBe(0);
  });

  it("replays games.create with retained authority as original 201 without duplicate", async () => {
    const owner = await login("vk");
    const venue = await createVenue(owner);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const key = `idem-create-ok-${suffix}-abcdefghij`;
    const payload = draftPayload(venue.id, `Create ok ${suffix}`);

    const first = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, key),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const created = first.json() as { id: string; title: string; version: number };
    const before = await effectCounts(created.id, owner.userId);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, key),
      payload,
    });
    expect(replay.statusCode).toBe(201);
    const replayed = replay.json() as { id: string; title: string; version: number };
    expect(replayed.id).toBe(created.id);
    expect(replayed.title).toBe(created.title);
    expect(replayed.version).toBe(created.version);

    const after = await effectCounts(created.id, owner.userId);
    expect(after.games).toBe(before.games);
    expect(after.activeManagers).toBe(before.activeManagers);
    expect(after.outbox).toBe(before.outbox);
    expect(after.createReceipts).toBe(before.createReceipts);
  });

  it("rejects games.create same key with different payload", async () => {
    const owner = await login("vk");
    const venue = await createVenue(owner);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const key = `idem-create-reuse-${suffix}-abcdefgh`;
    const payload = draftPayload(venue.id, `Create reuse ${suffix}`);

    const first = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, key),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const created = first.json() as { id: string };
    const before = await effectCounts(created.id, owner.userId);

    const second = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, key),
      payload: { ...payload, title: `Create reuse changed ${suffix}` },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { code: string }).code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );

    const after = await effectCounts(created.id, owner.userId);
    expect(after.games).toBe(before.games);
    expect(after.createReceipts).toBe(before.createReceipts);
  });

  it("rejects same key with different payload without extra effect", async () => {
    const owner = await login("vk");
    const game = await publishGame(owner, 2);
    const key = `idem-pub-reuse-${Date.now()}-abcdefgh`;
    const first = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/cancel`,
      headers: mutationHeaders(owner, key),
      payload: { expectedVersion: game.version, reason: "weather" },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/cancel`,
      headers: mutationHeaders(owner, key),
      payload: { expectedVersion: game.version, reason: "other reason" },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { code: string }).code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("barrier confirm-vs-cancel never leaves confirmed in cancelled game", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    const game = await publishGame(owner, 2);
    const req = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-req3-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: game.version },
    });
    expect(req.statusCode).toBe(201);
    const part = req.json() as { id: string; version: number };

    // Explicit two-connection barrier: hold Game lock, then race confirm/cancel.
    const holder = await pool.connect();
    const waiterReady = { resolve: () => undefined as void };
    const ready = new Promise<void>((resolve) => {
      waiterReady.resolve = resolve;
    });
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM games WHERE id = $1 FOR UPDATE`, [
        game.id,
      ]);
      waiterReady.resolve();

      const confirmPromise = ready.then(() =>
        app.inject({
          method: "POST",
          url: `/v1/participations/${part.id}/confirm`,
          headers: mutationHeaders(
            owner,
            `idem-race-conf-${Date.now()}-abcdefgh`,
          ),
          payload: { expectedVersion: part.version },
        }),
      );
      const cancelPromise = ready.then(() =>
        app.inject({
          method: "POST",
          url: `/v1/games/${game.id}/cancel`,
          headers: mutationHeaders(
            owner,
            `idem-race-can-${Date.now()}-abcdefgh`,
          ),
          payload: { expectedVersion: game.version, reason: "race cancel" },
        }),
      );

      // Let both HTTP handlers block on Game lock, then release.
      await new Promise((r) => setTimeout(r, 200));
      await holder.query("COMMIT");

      const [confirmRes, cancelRes] = await Promise.all([
        confirmPromise,
        cancelPromise,
      ]);
      expect([200, 409]).toContain(confirmRes.statusCode);
      expect([200, 409]).toContain(cancelRes.statusCode);
      expect(confirmRes.statusCode === 500 || cancelRes.statusCode === 500).toBe(
        false,
      );

      const final = await pool.query<{
        game_status: string;
        part_status: string;
      }>(
        `SELECT g.status AS game_status, p.status AS part_status
         FROM games g
         JOIN participations p ON p.game_id = g.id
         WHERE g.id = $1 AND p.id = $2`,
        [game.id, part.id],
      );
      const row = final.rows[0]!;
      if (row.game_status === "cancelled") {
        expect(row.part_status).not.toBe("confirmed");
        expect(["cancelled_by_game", "pending", "withdrawn", "rejected"]).toContain(
          row.part_status,
        );
      }
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });

  it("parallel first use of same unused confirm key yields one effect", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    const game = await publishGame(owner, 2);
    const req = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-req4-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: game.version },
    });
    const part = req.json() as { id: string; version: number };
    const key = `idem-parallel-conf-${Date.now()}-abcdefgh`;
    const payload = { expectedVersion: part.version };
    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/participations/${part.id}/confirm`,
        headers: mutationHeaders(owner, key),
        payload,
      }),
      app.inject({
        method: "POST",
        url: `/v1/participations/${part.id}/confirm`,
        headers: mutationHeaders(owner, key),
        payload,
      }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]!);
    const transitions = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM participation_transitions
       WHERE participation_id = $1 AND to_status = 'confirmed'`,
      [part.id],
    );
    expect(transitions.rows[0]!.c).toBe(1);
    const receipts = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM idempotency_records
       WHERE actor_id = $1 AND operation = 'participations.confirm'
         AND reservation_state = 'completed'`,
      [owner.userId],
    );
    expect(receipts.rows[0]!.c).toBeGreaterThanOrEqual(1);
  });

  it("disabled user fails /me and business write", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    const game = await publishGame(owner, 2);

    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [
      player.userId,
    ]);

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      cookies: player.cookies,
    });
    expect(me.statusCode).toBe(401);

    const req = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-disabled-${Date.now()}-abcdef`),
      payload: { expectedGameVersion: game.version },
    });
    expect(req.statusCode).toBe(401);

    await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [
      player.userId,
    ]);
  });

  it("leaves no orphan processing rows after rollback", async () => {
    const before = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM idempotency_records
       WHERE reservation_state = 'processing'`,
    );
    expect(before.rows[0]!.c).toBe(0);

    const owner = await login("vk");
    const bad = await app.inject({
      method: "POST",
      url: `/v1/games/${"00000000-0000-4000-8000-000000000099"}/publish`,
      headers: mutationHeaders(owner, `idem-orphan-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: 1 },
    });
    expect([404, 409]).toContain(bad.statusCode);

    const after = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM idempotency_records
       WHERE reservation_state = 'processing'`,
    );
    expect(after.rows[0]!.c).toBe(0);
  });
});
