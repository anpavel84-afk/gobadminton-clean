/**
 * #506 MOD-V2-C1 — focused synthetic HTTP coverage for three private send paths.
 * Skips when RUN_DB_INTEGRATION≠1. Explicit NODE_ENV=test / local APP_ENV.
 * No live provider egress; no PROD / liveDB outside the synthetic fixture DB.
 */
import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { GameChatModule } from "../../src/game-chat/game-chat.module";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
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

describeIntegration("MOD-V2-C1 private message local safety", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let fetchSpy: { mock: { calls: unknown[] }; mockRestore: () => void } | undefined;

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:c1",
    subject: uniqueSuffix("c1-a"),
    email: "c1-a@example.com",
    displayName: "C1 Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:c1",
    subject: uniqueSuffix("c1-b"),
    email: "c1-b@example.com",
    displayName: "C1 Player B",
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
    process.env.GIT_SHA = "integration-c1-private-safety";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_DM_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_MESSAGE_RETENTION_SECONDS = "60";
    process.env.SOCIAL_DM_REQUEST_TTL_SECONDS = "604800";
    process.env.SOCIAL_DM_MESSAGE_RETENTION_SECONDS = "60";

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
        MessagingModule,
        GameChatModule,
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
    fetchSpy?.mockRestore();
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    fetchSpy?.mockRestore();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    await pool.query("DELETE FROM web_push_delivery_intents").catch(() => undefined);
    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM abuse_reports");
    await pool.query("DELETE FROM user_blocks");
    await pool.query("DELETE FROM social_pairs");
    await pool.query("DELETE FROM player_looking_intents");
    await pool.query("DELETE FROM player_social_profiles");
    await pool.query("DELETE FROM content_moderation_rate_budgets");
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

  async function ensureOpenProfile(
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
    const cur = current.json() as { version: number };
    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(session, `${keyPrefix}-patch-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: cur.version,
        displayName,
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        bio: "C1 safety",
        contactPolicy: "requests",
        socialEligible: true,
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

  async function publishGame(owner: Session) {
    await pool.query(
      "DELETE FROM content_moderation_rate_budgets WHERE user_id=$1",
      [owner.userId],
    );
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "C1 Court",
        address: "Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    const venue = venueRes.json() as { id: string };
    const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
    const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-${suffix}-abcdefgh`),
      payload: {
        hostDisplayName: `Host C1 ${suffix}`,
        hostPublicContact: "telegram:@c1",
        venueId: venue.id,
        title: "C1 game chat",
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: deadline.toISOString(),
        capacity: 4,
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
      },
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = draftRes.json() as { id: string; version: number };
    const creatorSeat = await pool.query<{ id: string }>(
      "SELECT id FROM participations WHERE game_id=$1 AND user_id=$2",
      [draft.id, owner.userId],
    );
    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/participations/${creatorSeat.rows[0]!.id}/withdraw`,
      headers: mutationHeaders(owner, uniqueSuffix("fixture-owner-withdraw")),
      payload: { expectedVersion: 1 },
    });
    expect(withdrawn.statusCode).toBe(200);
    draft.version += 1;
    const publishedRes = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-${suffix}-abcdefgh`),
      payload: { expectedVersion: draft.version },
    });
    expect(publishedRes.statusCode).toBe(200);
    return publishedRes.json() as { id: string; version: number };
  }

  it("rejects unsafe first DM without conversation/message/push; allows criticism", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "C1 Alpha", "a");
    const peer = await ensureOpenProfile(b, "C1 Beta", "b");

    const beforeConv = await pool.query(`SELECT COUNT(*)::int AS c FROM conversations`);
    const beforeMsg = await pool.query(`SELECT COUNT(*)::int AS c FROM messages`);
    const beforePush = await pool.query(
      `SELECT COUNT(*)::int AS c FROM web_push_delivery_intents`,
    );

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, uniqueSuffix("c1-reject-key")),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "javascript:alert(1)",
        clientMessageId: uniqueSuffix("c1-reject-msg"),
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      code: "PRIVATE_TEXT_CONTENT_REJECTED",
    });
    expect(
      (await pool.query(`SELECT COUNT(*)::int AS c FROM conversations`)).rows[0],
    ).toEqual(beforeConv.rows[0]);
    expect(
      (await pool.query(`SELECT COUNT(*)::int AS c FROM messages`)).rows[0],
    ).toEqual(beforeMsg.rows[0]);
    expect(
      (await pool.query(`SELECT COUNT(*)::int AS c FROM web_push_delivery_intents`))
        .rows[0],
    ).toEqual(beforePush.rows[0]);

    const ok = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, uniqueSuffix("c1-ok-key")),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "Слабая подача вчера, давай реванш на корте",
        clientMessageId: uniqueSuffix("c1-ok-msg"),
      },
    });
    expect(ok.statusCode).toBe(201);

    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("subsequent DM reject keeps seq/preview; exact duplicate vs changed body; purged unavailable", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "C1 Alpha2", "a2");
    const peer = await ensureOpenProfile(b, "C1 Beta2", "b2");

    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, uniqueSuffix("c1-open")),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "Привет, сыграем?",
        clientMessageId: uniqueSuffix("c1-open-msg"),
      },
    });
    expect(created.statusCode).toBe(201);
    const convId = (created.json() as { conversation: { id: string } })
      .conversation.id;

    const snap = await pool.query<{
      next_message_seq: string;
      last_message_seq: string;
      last_message_at: Date | null;
    }>(
      `SELECT next_message_seq::text, last_message_seq::text, last_message_at
       FROM conversations WHERE id = $1`,
      [convId],
    );
    const pushBefore = await pool.query(
      `SELECT COUNT(*)::int AS c FROM web_push_delivery_intents`,
    );

    const threat = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-threat")),
      payload: {
        text: "Я тебя убью",
        clientMessageId: uniqueSuffix("c1-threat-msg"),
      },
    });
    expect(threat.statusCode).toBe(422);
    expect(threat.json()).toMatchObject({ code: "PRIVATE_TEXT_CONTENT_REJECTED" });
    const after = await pool.query<{
      next_message_seq: string;
      last_message_seq: string;
      last_message_at: Date | null;
    }>(
      `SELECT next_message_seq::text, last_message_seq::text, last_message_at
       FROM conversations WHERE id = $1`,
      [convId],
    );
    expect(after.rows[0]).toEqual(snap.rows[0]);
    expect(
      (await pool.query(`SELECT COUNT(*)::int AS c FROM web_push_delivery_intents`))
        .rows[0],
    ).toEqual(pushBefore.rows[0]);

    const clientMessageId = uniqueSuffix("c1-dup");
    const send = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-send")),
      payload: { text: "До встречи на корте", clientMessageId },
    });
    expect(send.statusCode).toBe(201);

    const dup = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-dup-key")),
      payload: { text: "До встречи на корте", clientMessageId },
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.json()).toMatchObject({ outcome: "duplicate" });

    const changed = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-changed")),
      payload: { text: "Другой текст с тем же id", clientMessageId },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ code: "CLIENT_MESSAGE_ID_REUSED" });

    await pool.query(
      `UPDATE messages SET content_state = 'purged', body_text = NULL
       WHERE author_user_id = $1 AND client_message_id = $2`,
      [a.userId, clientMessageId],
    );
    const purged = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-purged")),
      payload: { text: "До встречи на корте", clientMessageId },
    });
    expect(purged.statusCode).toBe(409);
    expect(purged.json()).toMatchObject({
      code: "CLIENT_MESSAGE_ID_UNAVAILABLE",
    });

    const aProfile = await pool.query<{ public_player_id: string }>(
      `SELECT public_player_id FROM player_social_profiles WHERE user_id = $1`,
      [a.userId],
    );
    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${aProfile.rows[0]!.public_player_id}`,
      headers: mutationHeaders(b, uniqueSuffix("c1-block")),
      payload: {},
    });
    expect(block.statusCode).toBe(200);

    const blockedSend = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-blocked-send")),
      payload: {
        text: "Ещё раз после блока",
        clientMessageId: uniqueSuffix("c1-blocked-msg"),
      },
    });
    expect(blockedSend.statusCode).toBe(404);

    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("game chat local reject rolls back; cross-context clientMessageId conflicts", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "C1 Host", "host");
    await ensureOpenProfile(b, "C1 Player", "player");
    const game = await publishGame(a);

    const before = await pool.query<{
      next_message_seq: string | null;
    }>(
      `SELECT next_message_seq::text FROM conversations WHERE game_id = $1`,
      [game.id],
    );

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-gc-reject")),
      payload: {
        text: "data:text/html,hi",
        clientMessageId: uniqueSuffix("c1-gc-reject-msg"),
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({
      code: "PRIVATE_TEXT_CONTENT_REJECTED",
    });
    const afterReject = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.game_id = $1`,
      [game.id],
    );
    expect(afterReject.rows[0]!.c).toBe(0);
    if (before.rows[0]) {
      const afterConv = await pool.query<{ next_message_seq: string }>(
        `SELECT next_message_seq::text FROM conversations WHERE game_id = $1`,
        [game.id],
      );
      expect(afterConv.rows[0]!.next_message_seq).toBe(
        before.rows[0].next_message_seq,
      );
    }

    const sharedId = uniqueSuffix("c1-cross");
    const okGame = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(a, uniqueSuffix("c1-gc-ok")),
      payload: { text: "Разминка в 18:00", clientMessageId: sharedId },
    });
    expect(okGame.statusCode).toBe(201);

    const peer = await pool.query<{ public_player_id: string }>(
      `SELECT public_player_id FROM player_social_profiles WHERE user_id = $1`,
      [b.userId],
    );
    const cross = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, uniqueSuffix("c1-cross-dm")),
      payload: {
        targetPublicPlayerId: peer.rows[0]!.public_player_id,
        text: "Разминка в 18:00",
        clientMessageId: sharedId,
      },
    });
    expect(cross.statusCode).toBe(409);
    expect(cross.json()).toMatchObject({ code: "CLIENT_MESSAGE_ID_REUSED" });

    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });
});
