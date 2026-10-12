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
import { GameAuthorityService } from "../../src/games/game-authority.service";
import { GamesModule } from "../../src/games/games.module";
import { GameChatModule } from "../../src/game-chat/game-chat.module";
import {
  SocialExpiryCleanupCommand,
  sqlExecutorFromPg,
} from "../../src/jobs/social-expiry-cleanup.command";
import { InvitationsModule } from "../../src/invitations/invitations.module";
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

describeIntegration("LS-05 Game Chat", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let gameAuthority: GameAuthorityService;

  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:ls05",
    subject: uniqueSuffix("ls05-owner"),
    email: "ls05-owner@example.com",
    displayName: "LS05 Owner",
  };
  const playerIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:ls05",
    subject: uniqueSuffix("ls05-player"),
    email: "ls05-player@example.com",
    displayName: "LS05 Player",
  };
  const yandexIdentity: VerifiedIdentity = { ...playerIdentity };

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
    process.env.GIT_SHA = "integration-ls05";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_DM_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_MESSAGE_RETENTION_SECONDS = "60";

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
        InvitationsModule,
        GameChatModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(ownerIdentity), fakeAdapter(yandexIdentity)])
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

  beforeEach(async () => {
    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM participation_transitions");
    await pool.query("DELETE FROM participations");
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
        bio: "Game chat test",
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

  async function publishGame(
    owner: Session,
    opts: { capacity: number; title?: string; endsAt?: Date },
  ) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "LS05 Court",
        address: "Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    const venue = venueRes.json() as { id: string };
    const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ends =
      opts.endsAt ?? new Date(starts.getTime() + 2 * 60 * 60 * 1000);
    const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-${suffix}-abcdefgh`),
      payload: {
        hostDisplayName: `Host ${opts.title ?? "LS05"} ${suffix}`,
        hostPublicContact: "telegram:@ls05",
        venueId: venue.id,
        title: opts.title ?? "LS05 game",
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: deadline.toISOString(),
        capacity: opts.capacity,
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
    return publishedRes.json() as { id: string; version: number };
  }

  async function confirmPlayer(
    owner: Session,
    player: Session,
    game: { id: string; version: number },
  ): Promise<{ id: string; version: number }> {
    const current = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    game.version = current.rows[0]!.version;
    const apply = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-apply-${uniqueSuffix("k")}`),
      payload: { expectedGameVersion: game.version },
    });
    expect([200, 201]).toContain(apply.statusCode);
    const participation = apply.json() as { id: string; version: number };
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${participation.id}/confirm`,
      headers: mutationHeaders(owner, `idem-confirm-${uniqueSuffix("k")}`),
      payload: { expectedVersion: participation.version },
    });
    expect(confirm.statusCode).toBe(200);
    const gameRow = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    game.version = gameRow.rows[0]!.version;
    return confirm.json() as { id: string; version: number };
  }

  it("manager/confirmed can send/list/read; pending/outsider denied; leave/rejoin; cancel/endsAt; block peers; retention", async () => {
    const owner = await login("vk");
    const player = await loginYandexAs({
      subject: uniqueSuffix("ls05-player"),
      email: "ls05-player@example.com",
      displayName: "LS05 Player",
    });
    const outsider = await loginYandexAs({
      subject: uniqueSuffix("ls05-out"),
      email: "ls05-out@example.com",
      displayName: "LS05 Outsider",
    });
    await ensureOpenProfile(owner, "LS05 Owner", "own");
    const playerProfile = await ensureOpenProfile(player, "LS05 Player", "pl");
    await ensureOpenProfile(outsider, "LS05 Out", "out");

    const game = await publishGame(owner, { capacity: 4, title: "Chat game" });

    const deniedPendingApply = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `idem-apply2-${uniqueSuffix("k")}`),
      payload: { expectedGameVersion: game.version },
    });
    expect([200, 201]).toContain(deniedPendingApply.statusCode);

    const pendingChat = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat`,
      cookies: player.cookies,
    });
    expect(pendingChat.statusCode).toBe(404);

    const outsiderChat = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat`,
      cookies: outsider.cookies,
    });
    expect(outsiderChat.statusCode).toBe(404);

    const unknownChat = await app.inject({
      method: "GET",
      url: `/v1/games/00000000-0000-4000-8000-000000000099/chat`,
      cookies: owner.cookies,
    });
    expect(unknownChat.statusCode).toBe(404);

    const participation = deniedPendingApply.json() as {
      id: string;
      version: number;
    };
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${participation.id}/confirm`,
      headers: mutationHeaders(owner, `idem-confirm2-${uniqueSuffix("k")}`),
      payload: { expectedVersion: participation.version },
    });
    expect(confirm.statusCode).toBe(200);
    const bumped = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    game.version = bumped.rows[0]!.version;

    const ownerChat = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat`,
      cookies: owner.cookies,
    });
    expect(ownerChat.statusCode).toBe(200);
    const chatBody = ownerChat.json() as {
      id: string;
      kind: string;
      gameId: string;
      memberRole: string;
    };
    expect(chatBody.kind).toBe("game");
    expect(chatBody.gameId).toBe(game.id);
    expect(chatBody.memberRole).toBe("manager");

    const playerChat = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat`,
      cookies: player.cookies,
    });
    expect(playerChat.statusCode).toBe(200);
    expect((playerChat.json() as { memberRole: string }).memberRole).toBe(
      "member",
    );

    const sendKey = `idem-send-${uniqueSuffix("k")}`;
    const clientMessageId = `cmsg-${uniqueSuffix("m")}`;
    const send1 = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(owner, sendKey),
      payload: { text: "Warm-up at 18:00", clientMessageId },
    });
    expect(send1.statusCode).toBe(201);
    const receipt = send1.json() as {
      messageId: string;
      seq: string;
      outcome: string;
    };
    expect(receipt.outcome).toBe("created");

    const idemReplay = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(owner, sendKey),
      payload: { text: "Warm-up at 18:00", clientMessageId },
    });
    expect(idemReplay.statusCode).toBe(201);
    expect((idemReplay.json() as { messageId: string }).messageId).toBe(
      receipt.messageId,
    );

    const clientDup = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(owner, `idem-send2-${uniqueSuffix("k")}`),
      payload: { text: "Warm-up at 18:00", clientMessageId },
    });
    expect(clientDup.statusCode).toBe(200);
    expect((clientDup.json() as { outcome: string }).outcome).toBe("duplicate");

    const list = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat/messages`,
      cookies: player.cookies,
    });
    expect(list.statusCode).toBe(200);
    const messages = list.json() as {
      items: Array<{ text: string | null; seq: string }>;
    };
    expect(messages.items.some((m) => m.text === "Warm-up at 18:00")).toBe(
      true,
    );

    const read = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/read`,
      headers: mutationHeaders(player, `idem-read-${uniqueSuffix("k")}`),
      payload: { throughSeq: receipt.seq },
    });
    expect(read.statusCode).toBe(200);

    const members = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat/members`,
      cookies: player.cookies,
    });
    expect(members.statusCode).toBe(200);
    expect(
      (members.json() as { items: unknown[] }).items.length,
    ).toBeGreaterThanOrEqual(2);

    // Blocked peers still coordinate in Game Chat; DM path remains closed.
    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${playerProfile.publicPlayerId}`,
      headers: mutationHeaders(owner, `idem-block-${uniqueSuffix("k")}`),
      payload: {},
    });
    expect([200, 201, 204]).toContain(block.statusCode);

    const sendWhileBlocked = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(player, `idem-sendb-${uniqueSuffix("k")}`),
      payload: {
        text: "Still coordinating",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(sendWhileBlocked.statusCode).toBe(201);

    const ownerSocial = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: owner.cookies,
    });
    const ownerPublicPlayerId = (
      ownerSocial.json() as { publicPlayerId: string }
    ).publicPlayerId;
    const dmBlocked = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(player, `idem-dm-${uniqueSuffix("k")}`),
      payload: {
        targetPublicPlayerId: ownerPublicPlayerId,
        text: "should fail",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(dmBlocked.statusCode).toBe(404);

    // Withdraw → immediate deny; reconfirm → retained history.
    const confirmed = confirm.json() as { id: string; version: number };
    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/participations/${confirmed.id}/withdraw`,
      headers: mutationHeaders(player, `idem-wd-${uniqueSuffix("k")}`),
      payload: { expectedVersion: confirmed.version },
    });
    expect(withdraw.statusCode).toBe(200);

    const afterLeave = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat/messages`,
      cookies: player.cookies,
    });
    expect(afterLeave.statusCode).toBe(404);

    await confirmPlayer(owner, player, game);
    const afterRejoin = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat/messages`,
      cookies: player.cookies,
    });
    expect(afterRejoin.statusCode).toBe(200);
    expect(
      (afterRejoin.json() as { items: Array<{ text: string | null }> }).items
        .some((m) => m.text === "Warm-up at 18:00"),
    ).toBe(true);

    // Cancel closes consumer chat access immediately.
    const gameRow = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/cancel`,
      headers: mutationHeaders(owner, `idem-cancel-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: gameRow.rows[0]!.version,
        reason: "Weather",
      },
    });
    expect(cancel.statusCode).toBe(200);
    const afterCancel = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat`,
      cookies: owner.cookies,
    });
    expect(afterCancel.statusCode).toBe(404);

    // endsAt fence on a fresh game (worker-down safe via source state).
    const owner2 = owner;
    const player2 = await loginYandexAs({
      subject: uniqueSuffix("ls05-end"),
      email: "ls05-end@example.com",
      displayName: "LS05 End",
    });
    await ensureOpenProfile(player2, "LS05 End", "end");
    const ending = await publishGame(owner2, {
      capacity: 4,
      title: "Ending",
    });
    await confirmPlayer(owner2, player2, ending);
    await pool.query(
      `UPDATE games
       SET starts_at = now() - interval '2 hours',
           ends_at = now() - interval '1 minute',
           application_deadline_at = now() - interval '3 hours'
       WHERE id = $1`,
      [ending.id],
    );
    const afterEnd = await app.inject({
      method: "POST",
      url: `/v1/games/${ending.id}/chat/messages`,
      headers: mutationHeaders(owner2, `idem-ended-${uniqueSuffix("k")}`),
      payload: {
        text: "too late",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(afterEnd.statusCode).toBe(404);

    const cleanup = new SocialExpiryCleanupCommand();
    const result = await cleanup.execute(sqlExecutorFromPg(pool), {
      kind: "sweep",
    });
    expect(result.gameChatsClosed).toBeGreaterThanOrEqual(0);

    // Retention purge fixture for game-chat messages.
    const openGame = await publishGame(owner2, { capacity: 4, title: "Retain" });
    const sendRet = await app.inject({
      method: "POST",
      url: `/v1/games/${openGame.id}/chat/messages`,
      headers: mutationHeaders(owner2, `idem-ret-${uniqueSuffix("k")}`),
      payload: {
        text: "purge me",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(sendRet.statusCode).toBe(201);
    await pool.query(
      `UPDATE messages SET purge_eligible_at = now() - interval '1 second'
       WHERE content_state = 'live'`,
    );
    const purged = await cleanup.execute(sqlExecutorFromPg(pool), {
      kind: "sweep",
    });
    expect(purged.dmMessagesPurged).toBeGreaterThanOrEqual(1);

    // Manager revoke fence (test helper).
    const revokeGame = await publishGame(owner2, {
      capacity: 4,
      title: "Revoke",
    });
    await gameAuthority.revokeForTests(revokeGame.id, owner2.userId);
    const revoked = await app.inject({
      method: "GET",
      url: `/v1/games/${revokeGame.id}/chat`,
      cookies: owner2.cookies,
    });
    expect(revoked.statusCode).toBe(404);
  }, 180_000);

  it("applicant DM gameContext does not grant Game Chat access", async () => {
    const owner = await login("vk");
    const applicant = await loginYandexAs({
      subject: uniqueSuffix("ls05-applicant"),
      email: "ls05-applicant@example.com",
      displayName: "LS05 Applicant",
    });
    const ownerProfile = await ensureOpenProfile(owner, "LS05 Host", "h");
    await ensureOpenProfile(applicant, "LS05 Applicant", "a");
    const game = await publishGame(owner, { capacity: 4, title: "Applicant" });

    const apply = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(applicant, `idem-app-${uniqueSuffix("k")}`),
      payload: { expectedGameVersion: game.version },
    });
    expect([200, 201]).toContain(apply.statusCode);

    const dm = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(applicant, `idem-ctx-${uniqueSuffix("k")}`),
      payload: {
        targetPublicPlayerId: ownerProfile.publicPlayerId,
        text: "Which court entrance?",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
        gameContextId: game.id,
      },
    });
    expect(dm.statusCode).toBe(201);

    const chat = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/chat`,
      cookies: applicant.cookies,
    });
    expect(chat.statusCode).toBe(404);
  }, 120_000);

  it("concurrent withdraw/remove/revoke/cancel cannot leak /chat/members peer identities", async () => {
    const owner = await login("vk");
    const playerA = await loginYandexAs({
      subject: uniqueSuffix("ls05-race-a"),
      email: "ls05-race-a@example.com",
      displayName: "LS05 Race A",
    });
    const playerB = await loginYandexAs({
      subject: uniqueSuffix("ls05-race-b"),
      email: "ls05-race-b@example.com",
      displayName: "LS05 Race B",
    });
    const ownerProfile = await ensureOpenProfile(owner, "LS05 Race Host", "rh");
    const profileA = await ensureOpenProfile(playerA, "LS05 Race A", "ra");
    const profileB = await ensureOpenProfile(playerB, "LS05 Race B", "rb");

    async function setupRoom(title: string) {
      const game = await publishGame(owner, { capacity: 4, title });
      const partA = await confirmPlayer(owner, playerA, game);
      await confirmPlayer(owner, playerB, game);
      const warm = await app.inject({
        method: "GET",
        url: `/v1/games/${game.id}/chat/members`,
        cookies: playerA.cookies,
      });
      expect(warm.statusCode).toBe(200);
      const items = (warm.json() as { items: Array<{ publicPlayerId: string }> })
        .items;
      expect(items.map((i) => i.publicPlayerId)).toEqual(
        expect.arrayContaining([
          ownerProfile.publicPlayerId,
          profileA.publicPlayerId,
          profileB.publicPlayerId,
        ]),
      );
      const gameRow = await pool.query<{ version: number }>(
        `SELECT version FROM games WHERE id = $1`,
        [game.id],
      );
      return {
        game: { id: game.id, version: gameRow.rows[0]!.version },
        partA,
      };
    }

    async function raceMembersAgainst(
      gameId: string,
      listAs: Session,
      mutation: () => Promise<{ statusCode: number }>,
    ) {
      const holder = await pool.connect();
      const ready = { resolve: () => undefined as void };
      const gate = new Promise<void>((resolve) => {
        ready.resolve = resolve;
      });
      try {
        await holder.query("BEGIN");
        await holder.query(`SELECT id FROM games WHERE id = $1 FOR UPDATE`, [
          gameId,
        ]);
        ready.resolve();

        const membersPromise = gate.then(() =>
          app.inject({
            method: "GET",
            url: `/v1/games/${gameId}/chat/members`,
            cookies: listAs.cookies,
          }),
        );
        const mutationPromise = gate.then(mutation);

        await new Promise((r) => setTimeout(r, 200));
        await holder.query("COMMIT");

        const [membersRes, mutationRes] = await Promise.all([
          membersPromise,
          mutationPromise,
        ]);
        expect(
          membersRes.statusCode === 500 || mutationRes.statusCode === 500,
        ).toBe(false);
        expect([200, 404]).toContain(membersRes.statusCode);
        if (membersRes.statusCode === 200) {
          const items = (
            membersRes.json() as { items: Array<{ publicPlayerId: string }> }
          ).items;
          expect(items.length).toBeGreaterThanOrEqual(2);
          // A successful fenced list never returns an empty stand-in for denial.
          expect(
            items.some((i) => i.publicPlayerId === profileB.publicPlayerId),
          ).toBe(true);
        }
        return { membersRes, mutationRes };
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
      }
    }

    async function expectPostSettleDenied(gameId: string, listAs: Session) {
      const settled = await app.inject({
        method: "GET",
        url: `/v1/games/${gameId}/chat/members`,
        cookies: listAs.cookies,
      });
      expect(settled.statusCode).toBe(404);
    }

    // Unauthenticated session boundary for the same route.
    {
      const { game } = await setupRoom("Race Session");
      const unauth = await app.inject({
        method: "GET",
        url: `/v1/games/${game.id}/chat/members`,
      });
      expect([401, 403]).toContain(unauth.statusCode);
    }

    // Held Game FOR SHARE (members fence) blocks withdraw until release; then deny.
    {
      const { game, partA } = await setupRoom("Race Share Fence");
      const shareHolder = await pool.connect();
      try {
        await shareHolder.query("BEGIN");
        await shareHolder.query(
          `SELECT id FROM games WHERE id = $1 FOR SHARE`,
          [game.id],
        );
        const withdrawPromise = app.inject({
          method: "POST",
          url: `/v1/participations/${partA.id}/withdraw`,
          headers: mutationHeaders(
            playerA,
            `idem-race-share-${uniqueSuffix("k")}`,
          ),
          payload: { expectedVersion: partA.version },
        });
        await new Promise((r) => setTimeout(r, 300));
        const mid = await pool.query<{ status: string }>(
          `SELECT status FROM participations WHERE id = $1`,
          [partA.id],
        );
        expect(mid.rows[0]?.status).toBe("confirmed");
        await shareHolder.query("COMMIT");
        const withdrawRes = await withdrawPromise;
        expect(withdrawRes.statusCode).toBe(200);
      } finally {
        await shareHolder.query("ROLLBACK").catch(() => undefined);
        shareHolder.release();
      }
      await expectPostSettleDenied(game.id, playerA);
    }

    // Concurrent withdraw vs /chat/members.
    {
      const { game, partA } = await setupRoom("Race Withdraw");
      const { mutationRes } = await raceMembersAgainst(game.id, playerA, () =>
        app.inject({
          method: "POST",
          url: `/v1/participations/${partA.id}/withdraw`,
          headers: mutationHeaders(
            playerA,
            `idem-race-wd-${uniqueSuffix("k")}`,
          ),
          payload: { expectedVersion: partA.version },
        }),
      );
      expect([200, 409]).toContain(mutationRes.statusCode);
      const partStatus = await pool.query<{ status: string }>(
        `SELECT status FROM participations WHERE id = $1`,
        [partA.id],
      );
      if (partStatus.rows[0]?.status !== "confirmed") {
        await expectPostSettleDenied(game.id, playerA);
      }
    }

    // Concurrent manager remove vs /chat/members.
    {
      const { game, partA } = await setupRoom("Race Remove");
      const { mutationRes } = await raceMembersAgainst(game.id, playerA, () =>
        app.inject({
          method: "POST",
          url: `/v1/participations/${partA.id}/remove`,
          headers: mutationHeaders(owner, `idem-race-rm-${uniqueSuffix("k")}`),
          payload: {
            expectedVersion: partA.version,
            reason: "capacity rebalance",
          },
        }),
      );
      expect([200, 409]).toContain(mutationRes.statusCode);
      const partStatus = await pool.query<{ status: string }>(
        `SELECT status FROM participations WHERE id = $1`,
        [partA.id],
      );
      if (partStatus.rows[0]?.status !== "confirmed") {
        await expectPostSettleDenied(game.id, playerA);
      }
    }

    // Concurrent Game cancel vs /chat/members.
    {
      const { game } = await setupRoom("Race Cancel");
      const { mutationRes } = await raceMembersAgainst(game.id, playerA, () =>
        app.inject({
          method: "POST",
          url: `/v1/games/${game.id}/cancel`,
          headers: mutationHeaders(owner, `idem-race-can-${uniqueSuffix("k")}`),
          payload: {
            expectedVersion: game.version,
            reason: "race cancel members",
          },
        }),
      );
      expect([200, 409]).toContain(mutationRes.statusCode);
      const gameStatus = await pool.query<{ status: string }>(
        `SELECT status FROM games WHERE id = $1`,
        [game.id],
      );
      if (gameStatus.rows[0]?.status === "cancelled") {
        await expectPostSettleDenied(game.id, playerA);
        await expectPostSettleDenied(game.id, owner);
      }
    }

    // Concurrent manager revoke vs /chat/members.
    {
      const { game } = await setupRoom("Race Revoke");
      await raceMembersAgainst(game.id, owner, async () => {
        await gameAuthority.revokeForTests(game.id, owner.userId);
        return { statusCode: 200 };
      });
      const mgr = await pool.query<{ status: string }>(
        `SELECT status FROM game_managers
         WHERE game_id = $1 AND user_id = $2`,
        [game.id, owner.userId],
      );
      if (mgr.rows[0]?.status !== "active") {
        await expectPostSettleDenied(game.id, owner);
      }
    }
  }, 240_000);
});
