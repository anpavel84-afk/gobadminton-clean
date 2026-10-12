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
import { InvitationsModule } from "../../src/invitations/invitations.module";
import {
  SocialExpiryCleanupCommand,
  sqlExecutorFromPg,
} from "../../src/jobs/social-expiry-cleanup.command";
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

describeIntegration("LS-04 GameInvitation", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let gameAuthority: GameAuthorityService;

  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:ls04",
    subject: uniqueSuffix("ls04-owner"),
    email: "ls04-owner@example.com",
    displayName: "LS04 Owner",
  };
  const yandexIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:ls04",
    subject: uniqueSuffix("ls04-a"),
    email: "ls04-a@example.com",
    displayName: "LS04 Player A",
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
    process.env.GIT_SHA = "integration-ls04";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_INVITATIONS_ENABLED = "1";
    process.env.SOCIAL_INVITATION_TTL_SECONDS = "604800";

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
        InvitationsModule,
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
        bio: "Invite test",
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
    opts: { capacity: number; title?: string },
  ) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "LS04 Court",
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
        hostDisplayName: `Host ${opts.title ?? "LS04"} ${suffix}`,
        hostPublicContact: "telegram:@ls04",
        venueId: venue.id,
        title: opts.title ?? "LS04 game",
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
    return publishedRes.json() as {
      id: string;
      version: number;
      availablePlaces: number;
      confirmedCount: number;
    };
  }

  it("covers create/list, capacity, block, revoke, expiry, replay, accept-vs-cancel", async () => {
    const owner = await login("vk");
    const playerA = await loginYandexAs({
      subject: uniqueSuffix("ls04-a"),
      issuerNamespace: "yandex:oauth:ls04a",
      email: "ls04-a@example.com",
      displayName: "Player A",
    });
    const playerB = await loginYandexAs({
      subject: uniqueSuffix("ls04-b"),
      issuerNamespace: "yandex:oauth:ls04b",
      email: "ls04-b@example.com",
      displayName: "Player B",
    });
    await ensureOpenProfile(owner, "Owner LS04", "own");
    const peerA = await ensureOpenProfile(playerA, "Alpha Invite", "a");
    const peerB = await ensureOpenProfile(playerB, "Beta Invite", "b");

    const game = await publishGame(owner, { capacity: 2, title: "Invite loop" });
    const createKey = `inv-${uniqueSuffix("idem")}-xxxxxxxx`;
    const createPayload = {
      inviteePublicPlayerId: peerA.publicPlayerId,
      expectedGameVersion: game.version,
    };
    const created = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(owner, createKey),
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    const invitation = created.json() as {
      id: string;
      status: string;
      version: number;
      participationId: string | null;
    };
    expect(invitation.status).toBe("pending");
    expect(invitation.participationId).toBeNull();

    const replay = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(owner, createKey),
      payload: createPayload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());

    const afterPending = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}`,
    });
    expect(afterPending.json().confirmedCount).toBe(0);
    expect(afterPending.json().availablePlaces).toBe(2);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}/invitations`,
      cookies: owner.cookies,
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { items: unknown[] }).items).toHaveLength(1);

    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/invitations",
      cookies: playerA.cookies,
    });
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as { items: { id: string }[] }).items[0]?.id).toBe(
      invitation.id,
    );

    const stranger = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(playerA, `stranger-${uniqueSuffix("k")}-xxxx`),
      payload: {
        inviteePublicPlayerId: peerB.publicPlayerId,
        expectedGameVersion: game.version,
      },
    });
    expect(stranger.statusCode).toBe(404);

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/invitations/${invitation.id}/accept`,
      headers: mutationHeaders(playerA, `acc-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        expectedVersion: invitation.version,
        expectedGameVersion: game.version,
      },
    });
    expect(accepted.statusCode).toBe(200);
    const acceptBody = accepted.json() as {
      invitation: { status: string; participationId: string };
      participation: { status: string; userId: string };
    };
    expect(acceptBody.invitation.status).toBe("accepted");
    expect(acceptBody.participation.status).toBe("confirmed");
    expect(acceptBody.participation.userId).toBe(playerA.userId);

    const afterAccept = await app.inject({
      method: "GET",
      url: `/v1/games/${game.id}`,
    });
    expect(afterAccept.json().confirmedCount).toBe(1);
    expect(afterAccept.json().availablePlaces).toBe(1);

    const race = await publishGame(owner, { capacity: 1, title: "Last seat invite" });
    const invA = await app.inject({
      method: "POST",
      url: `/v1/games/${race.id}/invitations`,
      headers: mutationHeaders(owner, `race-a-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerA.publicPlayerId,
        expectedGameVersion: race.version,
      },
    });
    const invB = await app.inject({
      method: "POST",
      url: `/v1/games/${race.id}/invitations`,
      headers: mutationHeaders(owner, `race-b-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerB.publicPlayerId,
        expectedGameVersion: race.version,
      },
    });
    expect(invA.statusCode).toBe(201);
    expect(invB.statusCode).toBe(201);
    const aBody = invA.json() as { id: string; version: number };
    const bBody = invB.json() as { id: string; version: number };
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/invitations/${aBody.id}/accept`,
        headers: mutationHeaders(playerA, `race-acc-a-${uniqueSuffix("k")}-xx`),
        payload: {
          expectedVersion: aBody.version,
          expectedGameVersion: race.version,
        },
      }),
      app.inject({
        method: "POST",
        url: `/v1/invitations/${bBody.id}/accept`,
        headers: mutationHeaders(playerB, `race-acc-b-${uniqueSuffix("k")}-xx`),
        payload: {
          expectedVersion: bBody.version,
          expectedGameVersion: race.version,
        },
      }),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json()).toMatchObject({ code: "GAME_FULL" });
    const loserId = first.statusCode === 409 ? aBody.id : bBody.id;
    const loserGet = await app.inject({
      method: "GET",
      url: `/v1/invitations/${loserId}`,
      cookies: first.statusCode === 409 ? playerA.cookies : playerB.cookies,
    });
    expect(loserGet.json().status).toBe("pending");

    const blockedGame = await publishGame(owner, { capacity: 2, title: "Block" });
    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${peerB.publicPlayerId}`,
      headers: mutationHeaders(owner, `block-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {},
    });
    expect(block.statusCode).toBe(200);
    const blockedInvite = await app.inject({
      method: "POST",
      url: `/v1/games/${blockedGame.id}/invitations`,
      headers: mutationHeaders(owner, `blocked-${uniqueSuffix("k")}-xxxxxx`),
      payload: {
        inviteePublicPlayerId: peerB.publicPlayerId,
        expectedGameVersion: blockedGame.version,
      },
    });
    expect(blockedInvite.statusCode).toBe(404);
    await pool.query("DELETE FROM user_blocks");

    const revokeGame = await publishGame(owner, { capacity: 2, title: "Revoke mgr" });
    await gameAuthority.revokeForTests(revokeGame.id, owner.userId);
    const revokedMgr = await app.inject({
      method: "POST",
      url: `/v1/games/${revokeGame.id}/invitations`,
      headers: mutationHeaders(owner, `revmgr-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerA.publicPlayerId,
        expectedGameVersion: revokeGame.version,
      },
    });
    expect([403, 404]).toContain(revokedMgr.statusCode);

    const cancelGame = await publishGame(owner, { capacity: 2, title: "Cancel barrier" });
    const pendingInv = await app.inject({
      method: "POST",
      url: `/v1/games/${cancelGame.id}/invitations`,
      headers: mutationHeaders(owner, `caninv-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerA.publicPlayerId,
        expectedGameVersion: cancelGame.version,
      },
    });
    expect(pendingInv.statusCode).toBe(201);
    const pendingBody = pendingInv.json() as { id: string; version: number };
    const [acceptRace, cancelRace] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/invitations/${pendingBody.id}/accept`,
        headers: mutationHeaders(playerA, `canacc-${uniqueSuffix("k")}-xxxxxx`),
        payload: {
          expectedVersion: pendingBody.version,
          expectedGameVersion: cancelGame.version,
        },
      }),
      app.inject({
        method: "POST",
        url: `/v1/games/${cancelGame.id}/cancel`,
        headers: mutationHeaders(owner, `cancg-${uniqueSuffix("k")}-xxxxxxxx`),
        payload: { expectedVersion: cancelGame.version, reason: "weather" },
      }),
    ]);
    const raceCodes = [acceptRace.statusCode, cancelRace.statusCode];
    expect(raceCodes).toContain(200);
    expect(raceCodes.some((code) => code === 200 || code === 409)).toBe(true);
    const afterCancel = await app.inject({
      method: "GET",
      url: `/v1/invitations/${pendingBody.id}`,
      cookies: playerA.cookies,
    });
    expect(["accepted", "cancelled_by_game", "pending"]).toContain(
      afterCancel.json().status,
    );
    if (cancelRace.statusCode === 200 && acceptRace.statusCode !== 200) {
      expect(afterCancel.json().status).toBe("cancelled_by_game");
    }

    const expireGame = await publishGame(owner, { capacity: 2, title: "Expire" });
    const toExpire = await app.inject({
      method: "POST",
      url: `/v1/games/${expireGame.id}/invitations`,
      headers: mutationHeaders(owner, `exp-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerA.publicPlayerId,
        expectedGameVersion: expireGame.version,
      },
    });
    expect(toExpire.statusCode).toBe(201);
    const expBody = toExpire.json() as { id: string; version: number };
    await pool.query(
      `UPDATE game_invitations
       SET expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [expBody.id],
    );
    const expiredRead = await app.inject({
      method: "GET",
      url: `/v1/invitations/${expBody.id}`,
      cookies: playerA.cookies,
    });
    expect(expiredRead.statusCode).toBe(200);
    expect(expiredRead.json().status).toBe("expired");

    const workerExpireGame = await publishGame(owner, { capacity: 2, title: "Worker expire" });
    const workerInv = await app.inject({
      method: "POST",
      url: `/v1/games/${workerExpireGame.id}/invitations`,
      headers: mutationHeaders(owner, `wexp-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerB.publicPlayerId,
        expectedGameVersion: workerExpireGame.version,
      },
    });
    expect(workerInv.statusCode).toBe(201);
    const workerBody = workerInv.json() as { id: string; version: number };
    await pool.query(
      `UPDATE game_invitations
       SET expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [workerBody.id],
    );
    const cleanup = new SocialExpiryCleanupCommand();
    const result = await cleanup.execute(sqlExecutorFromPg(pool), {
      kind: "invitation",
      invitationId: workerBody.id,
      version: workerBody.version,
    });
    expect(result.invitationsExpired).toBeGreaterThanOrEqual(1);

    const proofGame = await publishGame(owner, { capacity: 2, title: "Proof" });
    const badProof = await app.inject({
      method: "POST",
      url: `/v1/games/${proofGame.id}/invitations`,
      headers: mutationHeaders(owner, `proof-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerA.publicPlayerId,
        expectedGameVersion: proofGame.version,
        discoveryProof: "not-a-valid-result-ref",
      },
    });
    expect(badProof.statusCode).toBe(404);

    const declineGame = await publishGame(owner, { capacity: 2, title: "Decline" });
    const declineInv = await app.inject({
      method: "POST",
      url: `/v1/games/${declineGame.id}/invitations`,
      headers: mutationHeaders(owner, `dec-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerA.publicPlayerId,
        expectedGameVersion: declineGame.version,
      },
    });
    const declineBody = declineInv.json() as { id: string; version: number };
    const declined = await app.inject({
      method: "POST",
      url: `/v1/invitations/${declineBody.id}/decline`,
      headers: mutationHeaders(playerA, `decl-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: declineBody.version },
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json().status).toBe("declined");

    const revokeInvGame = await publishGame(owner, { capacity: 2, title: "Revoke inv" });
    const revokeInv = await app.inject({
      method: "POST",
      url: `/v1/games/${revokeInvGame.id}/invitations`,
      headers: mutationHeaders(owner, `rinv-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peerA.publicPlayerId,
        expectedGameVersion: revokeInvGame.version,
      },
    });
    const revokeBody = revokeInv.json() as { id: string; version: number };
    const revoked = await app.inject({
      method: "POST",
      url: `/v1/invitations/${revokeBody.id}/revoke`,
      headers: mutationHeaders(owner, `revk-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: revokeBody.version },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe("revoked");
  });

  it("expires elapsed pending rows on create without worker or GET, and keeps unexpired uniqueness", async () => {
    const owner = await login("vk");
    const playerA = await loginYandexAs({
      subject: uniqueSuffix("ls04-exp-a"),
      issuerNamespace: "yandex:oauth:ls04expa",
      email: "ls04-exp-a@example.com",
      displayName: "Player A Expiry",
    });
    await ensureOpenProfile(owner, "Owner LS04 expiry", "own-exp");
    const peerA = await ensureOpenProfile(playerA, "Alpha Expiry", "a-exp");
    const game = await publishGame(owner, { capacity: 2, title: "Create after expiry" });
    const payload = {
      inviteePublicPlayerId: peerA.publicPlayerId,
      expectedGameVersion: game.version,
    };

    const first = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(owner, `expc-${uniqueSuffix("k")}-xxxxxxxx`),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { id: string; status: string };
    expect(firstBody.status).toBe("pending");

    const stillPending = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(owner, `expc-dup-${uniqueSuffix("k")}-xxxx`),
      payload,
    });
    expect(stillPending.statusCode).toBe(409);
    expect(stillPending.json()).toMatchObject({ code: "INVITATION_PENDING" });

    await pool.query(
      `UPDATE game_invitations
       SET expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [firstBody.id],
    );

    const afterExpiry = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(owner, `expc-new-${uniqueSuffix("k")}-xxxx`),
      payload,
    });
    expect(afterExpiry.statusCode).toBe(201);
    const nextBody = afterExpiry.json() as { id: string; status: string };
    expect(nextBody.status).toBe("pending");
    expect(nextBody.id).not.toBe(firstBody.id);

    const previous = await pool.query<{ status: string }>(
      `SELECT status FROM game_invitations WHERE id = $1`,
      [firstBody.id],
    );
    expect(previous.rows[0]?.status).toBe("expired");

    const stillUnique = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(owner, `expc-uniq-${uniqueSuffix("k")}-xxx`),
      payload,
    });
    expect(stillUnique.statusCode).toBe(409);
    expect(stillUnique.json()).toMatchObject({ code: "INVITATION_PENDING" });
  });
});
