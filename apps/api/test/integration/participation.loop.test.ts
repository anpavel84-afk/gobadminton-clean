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
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ParticipationsService } from "../../src/participations/participations.service";
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

describeIntegration("F-04 participation loop", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let gameAuthority: GameAuthorityService;
  let participations: ParticipationsService;

  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:f04",
    subject: uniqueSuffix("owner"),
    email: "owner-f04@example.com",
    displayName: "Owner F04",
  };
  const yandexIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:f04",
    subject: uniqueSuffix("player-a"),
    email: "player-a@example.com",
    displayName: "Player A",
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
    process.env.GIT_SHA = "integration-f04";

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
        ParticipationsModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(ownerIdentity), fakeAdapter(yandexIdentity)])
      .compile();

    gameAuthority = moduleRef.get(GameAuthorityService);
    participations = moduleRef.get(ParticipationsService);

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

  async function loginYandexAs(identity: Partial<VerifiedIdentity>): Promise<Session> {
    const previous = { ...yandexIdentity };
    Object.assign(yandexIdentity, identity);
    try {
      return await login("yandex");
    } finally {
      Object.assign(yandexIdentity, previous);
    }
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

  async function publishGame(
    owner: Session,
    opts: { capacity: number; externalReservedCount?: number; title?: string },
  ) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "F04 Court",
        address: "Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    const venue = venueRes.json() as { id: string };

    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-${suffix}-abcdefgh`),
      payload: baseGamePayload(venue.id, {
        capacity: opts.capacity,
        externalReservedCount: opts.externalReservedCount ?? 0,
        title: opts.title ?? "F04 game",
        hostDisplayName: `Host ${opts.title ?? "F04"} ${suffix}`,
        hostPublicContact: "telegram:@f04",
      }),
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = draftRes.json() as {
      id: string;
      version: number;
      organizer: { id: string | null; displayName: string };
    };
    expect(draft.organizer.id).toBeNull();
    expect(draft.organizer.displayName).toContain("Host");

    // FB01: this fixture needs a manager who is not playing. Explicitly release
    // the real initial creator seat before publishing; authority stays active.
    const creatorSeat = await pool.query<{ id: string }>(
      "SELECT id FROM participations WHERE game_id=$1 AND user_id=$2", [draft.id, owner.userId]);
    const withdrawn = await app.inject({ method: "POST",
      url: `/v1/participations/${creatorSeat.rows[0]!.id}/withdraw`,
      headers: mutationHeaders(owner, uniqueSuffix("fixture-owner-withdraw")),
      payload: { expectedVersion: 1 } });
    expect(withdrawn.statusCode).toBe(200);
    draft.version += 1;

    const publishedRes = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-${suffix}-abcdefgh`),
      payload: { expectedVersion: draft.version },
    });
    expect(publishedRes.statusCode).toBe(200);
    return {
      game: publishedRes.json() as {
        id: string;
        version: number;
        availablePlaces: number;
        confirmedCount: number;
      },
    };
  }

  it("covers capacity, race, authz, idempotency, cancel cascade, expire", async () => {
    const owner = await login("vk");
    const playerA = await loginYandexAs({
      subject: uniqueSuffix("player-a"),
      issuerNamespace: "yandex:oauth:f04a",
      email: "player-a@example.com",
      displayName: "Player A",
    });
    const playerB = await loginYandexAs({
      subject: uniqueSuffix("player-b"),
      issuerNamespace: "yandex:oauth:f04b",
      email: "player-b@example.com",
      displayName: "Player B",
    });
    expect(playerA.userId).not.toBe(playerB.userId);

    const { game } = await publishGame(owner, {
      capacity: 2,
      title: "Capacity",
    });
    expect(game.availablePlaces).toBe(2);
    expect(game.confirmedCount).toBe(0);

    const reqA = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(playerA, `idem-req-a-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: game.version },
    });
    expect(reqA.statusCode).toBe(201);
    const partA = reqA.json() as {
      id: string;
      status: string;
      version: number;
      userId: string;
    };
    expect(partA.status).toBe("pending");
    expect(partA.userId).toBe(playerA.userId);

    const afterPending = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}`,
    });
    expect(afterPending.json().confirmedCount).toBe(0);
    expect(afterPending.json().availablePlaces).toBe(2);

    const dup = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(playerA, `idem-req-a2-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: game.version },
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().id).toBe(partA.id);

    const reqB = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(playerB, `idem-req-b-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: game.version },
    });
    expect(reqB.statusCode).toBe(201);
    const partB = reqB.json() as { id: string; version: number };

    // Last-seat race on capacity=1
    const raceSetup = await publishGame(owner, {
      capacity: 1,
      title: "Last seat",
    });
    const rA = await app.inject({
      method: "POST",
      url: `/v1/games/${raceSetup.game.id}/participations`,
      headers: mutationHeaders(playerA, `idem-race-a-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: raceSetup.game.version },
    });
    const rB = await app.inject({
      method: "POST",
      url: `/v1/games/${raceSetup.game.id}/participations`,
      headers: mutationHeaders(playerB, `idem-race-b-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: raceSetup.game.version },
    });
    expect(rA.statusCode).toBe(201);
    expect(rB.statusCode).toBe(201);
    const racePartA = rA.json() as { id: string; version: number };
    const racePartB = rB.json() as { id: string; version: number };

    const [c1, c2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/participations/${racePartA.id}/confirm`,
        headers: mutationHeaders(owner, `idem-race-c1-${Date.now()}-abcdefgh`),
        payload: { expectedVersion: racePartA.version },
      }),
      app.inject({
        method: "POST",
        url: `/v1/participations/${racePartB.id}/confirm`,
        headers: mutationHeaders(owner, `idem-race-c2-${Date.now()}-abcdefgh`),
        payload: { expectedVersion: racePartB.version },
      }),
    ]);
    const codes = [c1.statusCode, c2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = c1.statusCode === 409 ? c1 : c2;
    expect(loser.json().code).toBe("GAME_FULL");

    const raceGame = await app.inject({
      method: "GET",
      url: `/v1/games/${raceSetup.game.id}`,
    });
    expect(raceGame.json().confirmedCount).toBe(1);
    expect(raceGame.json().availablePlaces).toBe(0);

    const confirmA = await app.inject({
      method: "POST",
      url: `/v1/participations/${partA.id}/confirm`,
      headers: mutationHeaders(owner, `idem-conf-a-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: partA.version },
    });
    expect(confirmA.statusCode).toBe(200);

    const confirmKey = `idem-conf-replay-${Date.now()}-abcdefgh`;
    const confirmB1 = await app.inject({
      method: "POST",
      url: `/v1/participations/${partB.id}/confirm`,
      headers: mutationHeaders(owner, confirmKey),
      payload: { expectedVersion: partB.version },
    });
    expect(confirmB1.statusCode).toBe(200);
    const confirmB2 = await app.inject({
      method: "POST",
      url: `/v1/participations/${partB.id}/confirm`,
      headers: mutationHeaders(owner, confirmKey),
      payload: { expectedVersion: partB.version },
    });
    expect(confirmB2.statusCode).toBe(200);
    expect(confirmB2.json().version).toBe(confirmB1.json().version);
    const outboxConfirm = await pool.query(
      `SELECT count(*)::int AS c FROM outbox_events
       WHERE type = 'participation.confirmed' AND aggregate_id = $1`,
      [partB.id],
    );
    expect(outboxConfirm.rows[0]!.c).toBe(1);

    const filled = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}`,
    });
    expect(filled.json().confirmedCount).toBe(2);
    expect(filled.json().availablePlaces).toBe(0);

    const unauth = await app.inject({
      method: "POST",
      url: `/v1/participations/${racePartA.id}/confirm`,
      headers: mutationHeaders(playerA, `idem-unauth-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: 1 },
    });
    expect([403, 404]).toContain(unauth.statusCode);

    const listGame = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/participations`,
      headers: { cookie: owner.cookie },
    });
    expect(listGame.statusCode).toBe(200);
    expect((listGame.json().items as unknown[]).length).toBeGreaterThanOrEqual(2);

    const foreignList = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/participations`,
      headers: { cookie: playerA.cookie },
    });
    expect(foreignList.statusCode).toBe(404);

    const myList = await app.inject({
      method: "GET",
      url: "/v1/me/participations",
      headers: { cookie: playerA.cookie },
    });
    expect(myList.statusCode).toBe(200);
    expect(
      (myList.json().items as Array<{ userId: string }>).every(
        (p) => p.userId === playerA.userId,
      ),
    ).toBe(true);

    const confirmedA = confirmA.json() as { id: string; version: number };
    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/participations/${confirmedA.id}/withdraw`,
      headers: mutationHeaders(playerA, `idem-wd-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: confirmedA.version },
    });
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json().status).toBe("withdrawn");

    // Seat confirm/withdraw advances Game.version; reapply must use the fresh snapshot.
    const gameAfterWithdraw = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}`,
    });
    expect(gameAfterWithdraw.statusCode).toBe(200);
    const freshGameVersion = (gameAfterWithdraw.json() as { version: number })
      .version;

    const reapply = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(playerA, `idem-re-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: freshGameVersion },
    });
    expect(reapply.statusCode).toBe(201);
    expect(reapply.json().status).toBe("pending");
    expect(reapply.json().attemptNumber).toBeGreaterThan(1);

    const pendingAgain = reapply.json() as { id: string; version: number };
    const reject = await app.inject({
      method: "POST",
      url: `/v1/participations/${pendingAgain.id}/reject`,
      headers: mutationHeaders(owner, `idem-rej-${Date.now()}-abcdefgh`),
      payload: {
        expectedVersion: pendingAgain.version,
        reason: "level mismatch",
      },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().status).toBe("rejected");

    const confirmedB = confirmB1.json() as { id: string; version: number };
    const remove = await app.inject({
      method: "POST",
      url: `/v1/participations/${confirmedB.id}/remove`,
      headers: mutationHeaders(owner, `idem-rm-${Date.now()}-abcdefgh`),
      payload: {
        expectedVersion: confirmedB.version,
        reason: "no-show risk",
      },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().status).toBe("removed");

    const cascade = await publishGame(owner, {
      capacity: 4,
      title: "Cancel cascade",
    });
    const p1 = await app.inject({
      method: "POST",
      url: `/v1/games/${cascade.game.id}/participations`,
      headers: mutationHeaders(playerA, `idem-cas-a-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: cascade.game.version },
    });
    const p2 = await app.inject({
      method: "POST",
      url: `/v1/games/${cascade.game.id}/participations`,
      headers: mutationHeaders(playerB, `idem-cas-b-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: cascade.game.version },
    });
    expect(p1.statusCode).toBe(201);
    expect(p2.statusCode).toBe(201);
    const conf = await app.inject({
      method: "POST",
      url: `/v1/participations/${p1.json().id}/confirm`,
      headers: mutationHeaders(owner, `idem-cas-c-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: p1.json().version },
    });
    expect(conf.statusCode).toBe(200);

    const cascadeAfterConfirm = await app.inject({
      method: "GET",
      url: `/v1/games/${cascade.game.id}`,
    });
    expect(cascadeAfterConfirm.statusCode).toBe(200);
    const cascadeVersion = (
      cascadeAfterConfirm.json() as { version: number }
    ).version;

    const cancel = await app.inject({
      method: "POST",
      url: `/v1/games/${cascade.game.id}/cancel`,
      headers: mutationHeaders(owner, `idem-cas-cancel-${Date.now()}-abcdefgh`),
      payload: {
        expectedVersion: cascadeVersion,
        reason: "hall closed",
      },
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("cancelled");
    expect(cancel.json().confirmedCount).toBe(0);

    const statusesAfter = await pool.query<{ status: string; c: number }>(
      `SELECT status, count(*)::int AS c FROM participations
       WHERE game_id = $1 AND user_id <> $2 GROUP BY status`,
      [cascade.game.id, owner.userId],
    );
    expect(
      statusesAfter.rows.every((r) => r.status === "cancelled_by_game"),
    ).toBe(true);
    expect(statusesAfter.rows.reduce((s, r) => s + r.c, 0)).toBe(2);

    const revokeGame = await publishGame(owner, { capacity: 3, title: "Revoke" });
    const pendingR = await app.inject({
      method: "POST",
      url: `/v1/games/${revokeGame.game.id}/participations`,
      headers: mutationHeaders(playerA, `idem-rev-req-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: revokeGame.game.version },
    });
    await gameAuthority.revokeForTests(revokeGame.game.id, owner.userId);
    const revokedConfirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${pendingR.json().id}/confirm`,
      headers: mutationHeaders(owner, `idem-rev-c-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: pendingR.json().version },
    });
    expect(revokedConfirm.statusCode).toBe(403);
    await pool.query(
      `UPDATE game_managers
       SET status = 'active', revoked_at = NULL, updated_at = now()
       WHERE game_id = $1 AND user_id = $2`,
      [revokeGame.game.id, owner.userId],
    );

    const expireSetup = await publishGame(owner, {
      capacity: 4,
      title: "Expire",
    });
    const expPending = await app.inject({
      method: "POST",
      url: `/v1/games/${expireSetup.game.id}/participations`,
      headers: mutationHeaders(playerA, `idem-exp-p-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: expireSetup.game.version },
    });
    const expConfReq = await app.inject({
      method: "POST",
      url: `/v1/games/${expireSetup.game.id}/participations`,
      headers: mutationHeaders(playerB, `idem-exp-c-${Date.now()}-abcdefgh`),
      payload: { expectedGameVersion: expireSetup.game.version },
    });
    const expConf = await app.inject({
      method: "POST",
      url: `/v1/participations/${expConfReq.json().id}/confirm`,
      headers: mutationHeaders(owner, `idem-exp-conf-${Date.now()}-abcdefgh`),
      payload: { expectedVersion: expConfReq.json().version },
    });
    expect(expConf.statusCode).toBe(200);

    await pool.query(
      `UPDATE games
       SET application_deadline_at = now() - interval '1 hour'
       WHERE id = $1`,
      [expireSetup.game.id],
    );
    // Avoid scanning unrelated polluted overdue games from prior suite runs.
    // Keep deadline <= starts_at (games_deadline_chk) for near-term rows.
    await pool.query(
      `UPDATE games
       SET application_deadline_at = LEAST(starts_at - interval '1 hour', now() + interval '7 days')
       WHERE id <> $1
         AND status = 'published'
         AND application_deadline_at < now()
         AND starts_at > now() + interval '1 hour'`,
      [expireSetup.game.id],
    );
    const firstExpire = await participations.expireOverduePending(new Date());
    expect(firstExpire.expired).toBeGreaterThanOrEqual(1);
    const secondExpire = await participations.expireOverduePending(new Date());
    expect(secondExpire.expired).toBe(0);

    const byId = Object.fromEntries(
      (
        await pool.query<{ id: string; status: string }>(
          `SELECT id, status FROM participations WHERE id = ANY($1::uuid[])`,
          [[expPending.json().id, expConf.json().id]],
        )
      ).rows.map((r) => [r.id, r.status]),
    );
    expect(byId[expPending.json().id as string]).toBe("expired");
    expect(byId[expConf.json().id as string]).toBe("confirmed");
  });
});

function baseGamePayload(venueId: string, overrides: Record<string, unknown>) {
  const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
  const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
  return {
    hostDisplayName: "F04 Host",
    hostPublicContact: "telegram:@f04",
    venueId,
    title: "F04 doubles",
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
