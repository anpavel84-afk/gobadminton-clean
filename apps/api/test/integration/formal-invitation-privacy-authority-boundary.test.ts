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
import { InvitationsModule } from "../../src/invitations/invitations.module";
import { GameChatModule } from "../../src/game-chat/game-chat.module";
import type { GameInvitationDto } from "../../src/invitations/invitations.service";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";

const databaseUrl = process.env.DATABASE_URL;

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

describeIntegration("Formal invitation privacy/authority boundaries", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let gameAuthority: GameAuthorityService;

  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:formal-boundary",
    subject: uniqueSuffix("formal-boundary-owner"),
    email: "formal-boundary-owner@example.com",
    displayName: "Formal Boundary Owner",
  };
  const yandexIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:formal-boundary",
    subject: uniqueSuffix("formal-boundary-a"),
    email: "formal-boundary-a@example.com",
    displayName: "Formal Boundary Player A",
  };

  beforeAll(async () => {
    // This suite must never migrate a shared/default/live database.
    if (!databaseUrl) throw new Error("Explicit task-owned DATABASE_URL required");
    const target = new URL(databaseUrl);
    if (target.hostname !== "127.0.0.1" || !target.port ||
        !target.pathname.startsWith("/formal_invite_")) {
      throw new Error("Use task-owned loopback port and formal_invite_* database");
    }
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
    process.env.GIT_SHA = "integration-formal-boundary";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_INVITATIONS_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";
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
    opts: { capacity: number; title?: string; visibility?: "public" | "unlisted"; address?: string },
  ) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venuePayload = {
      cityId: MOSCOW_CITY_ID,
      name: `Formal Boundary Court ${suffix}`,
      address: opts.address ?? "Moscow",
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
    };
    let venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: venuePayload,
    });
    if (venueRes.statusCode === 409) {
      expect(venueRes.json().code).toBe("VENUE_POSSIBLE_DUPLICATE");
      // Follow the existing distinct-venue confirmation protocol for synthetic
      // colocated fixtures; never weaken the production dedupe policy.
      venueRes = await app.inject({
        method: "POST", url: "/v1/venues",
        headers: mutationHeaders(owner, uniqueSuffix("venue-distinct")),
        payload: { ...venuePayload, confirmDistinctToken: venueRes.json().confirmationToken },
      });
    }
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
        hostDisplayName: `Host ${opts.title ?? "Formal Boundary"} ${suffix}`,
        hostPublicContact: "telegram:@formal-boundary-contact",
        venueId: venue.id,
        title: opts.title ?? "Formal Boundary game",
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: deadline.toISOString(),
        capacity: opts.capacity,
        externalReservedCount: 0,
        visibility: opts.visibility ?? "public",
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
    // Keep the real FB01 creator seat: formal offers reserve none of the
    // remaining places, and acceptance must share the Participation fence.
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

  async function actors() {
    const owner = await login("vk");
    const a = await loginYandexAs({ subject: uniqueSuffix("formal-a") });
    const b = await loginYandexAs({ subject: uniqueSuffix("formal-b") });
    await ensureOpenProfile(owner, "Formal Owner", "owner");
    const peerA = await ensureOpenProfile(a, "Formal A", "a");
    const peerB = await ensureOpenProfile(b, "Formal B", "b");
    return { owner, a, b, peerA, peerB };
  }

  function post(session: Session, url: string, payload: object, key = uniqueSuffix("formal-write")) {
    return app.inject({ method: "POST", url, headers: mutationHeaders(session, key), payload });
  }

  function get(session: Session, url: string) {
    return app.inject({ method: "GET", url, cookies: session.cookies });
  }

  async function invite(owner: Session, game: { id: string; version: number }, publicPlayerId: string) {
    const response = await post(owner, `/v1/games/${game.id}/invitations`, {
      inviteePublicPlayerId: publicPlayerId, expectedGameVersion: game.version,
    });
    expect(response.statusCode).toBe(201);
    return response.json() as GameInvitationDto;
  }

  function accept(session: Session, invitation: GameInvitationDto, gameVersion: number, key?: string) {
    return post(session, `/v1/invitations/${invitation.id}/accept`, {
      expectedVersion: invitation.version, expectedGameVersion: gameVersion,
    }, key);
  }

  function expectPrivateDto(dto: GameInvitationDto) {
    // A closed key set catches contact, roster and geographic payload additions,
    // including nested objects, without granting any new Game preview authority.
    expect(Object.keys(dto).sort()).toEqual([
      "id", "gameId", "status", "version", "inviterPublicPlayerId",
      "inviteePublicPlayerId", "expiresAt", "decidedAt", "participationId", "createdAt",
    ].sort());
    expect(JSON.stringify(dto)).not.toMatch(/example\.com|telegram:|private-title|private-address/);
  }

  async function expectOnlyCreator(gameId: string, owner: Session) {
    const rows = await pool.query<{ user_id: string; status: string }>(
      "SELECT user_id, status FROM participations WHERE game_id=$1", [gameId]);
    expect(rows.rows).toEqual([{ user_id: owner.userId, status: "confirmed" }]);
  }

  async function expectFullWithCreator(gameId: string, owner: Session) {
    const rows = await pool.query<{ user_id: string; status: string }>(
      "SELECT user_id, status FROM participations WHERE game_id=$1 AND status='confirmed'", [gameId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.filter(row => row.user_id === owner.userId)).toHaveLength(1);
    const detail = await get(owner, `/v1/games/${gameId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ capacity: 2, confirmedCount: 2, availablePlaces: 0 });
  }

  async function raceOnGame<T>(gameId: string, launch: () => Promise<T>[]) {
    const fence = await pool.connect();
    let requests: Promise<T>[] = [];
    try {
      await fence.query("BEGIN");
      await fence.query("SELECT id FROM games WHERE id=$1 FOR UPDATE", [gameId]);
      requests = launch();
      // Prove both API transactions reached the real SQL Game fence before
      // releasing it. This avoids presenting two sequential calls as a race.
      await expect.poll(async () => {
        const waiters = await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query ILIKE '%FROM games%' AND query ILIKE '%FOR UPDATE%'`);
        return waiters.rows[0]!.count;
      }, { timeout: 5_000, interval: 20 }).toBeGreaterThanOrEqual(2);
    } finally {
      await fence.query("ROLLBACK");
      fence.release();
      // Always settle HTTP calls before a failed barrier assertion can end a test.
      await Promise.allSettled(requests);
    }
    return Promise.all(requests);
  }

  it("fences ordinary players and forged actors; management is per Game, not player identity", async () => {
    const { owner, a, b, peerA, peerB } = await actors();
    const game = await publishGame(owner, { capacity: 2 });
    const invitation = await invite(owner, game, peerA.publicPlayerId);
    for (const actor of [a, b]) {
      const denied = await post(actor, `/v1/games/${game.id}/invitations`, {
        inviteePublicPlayerId: peerB.publicPlayerId, expectedGameVersion: game.version,
        actorId: owner.userId, userId: owner.userId, inviterUserId: owner.userId,
      });
      expect(denied.statusCode).toBe(404);
      expect(denied.json().code).toBe("GAME_NOT_FOUND");
      expect((await post(actor, `/v1/invitations/${invitation.id}/revoke`, {
        expectedVersion: invitation.version, actorId: owner.userId,
      })).statusCode).toBe(404);
    }
    await pool.query("INSERT INTO game_managers(game_id,user_id,role) VALUES($1,$2,'manager')", [game.id, b.userId]);
    const duplicate = await post(b, `/v1/games/${game.id}/invitations`, {
      inviteePublicPlayerId: peerA.publicPlayerId, expectedGameVersion: game.version,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("INVITATION_PENDING");
    const revoked = await post(b, `/v1/invitations/${invitation.id}/revoke`, { expectedVersion: invitation.version });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe("revoked");
    const fromManager = await invite(b, game, peerA.publicPlayerId);
    const record = await pool.query<{ inviter_user_id: string }>("SELECT inviter_user_id FROM game_invitations WHERE id=$1", [fromManager.id]);
    expect(record.rows[0]!.inviter_user_id).toBe(b.userId);
    const otherGame = await publishGame(owner, { capacity: 2 });
    expect((await post(b, `/v1/games/${otherGame.id}/invitations`, {
      inviteePublicPlayerId: peerA.publicPlayerId, expectedGameVersion: otherGame.version,
    })).statusCode).toBe(404);
    await expectOnlyCreator(game.id, owner);
  });

  it("G-05 observation: role loss preserves issued pending offers but denies create/revoke and their replay", async () => {
    const { owner, a, b, peerA, peerB } = await actors();
    const game = await publishGame(owner, { capacity: 2 });
    await pool.query("INSERT INTO game_managers(game_id,user_id,role) VALUES($1,$2,'manager')", [game.id, b.userId]);
    const createKey = uniqueSuffix("manager-create");
    const payload = { inviteePublicPlayerId: peerA.publicPlayerId, expectedGameVersion: game.version };
    const created = await post(b, `/v1/games/${game.id}/invitations`, payload, createKey);
    expect(created.statusCode).toBe(201);
    const issued = created.json() as GameInvitationDto;
    const revokeTarget = await invite(owner, game, peerB.publicPlayerId);
    const revokeKey = uniqueSuffix("manager-revoke");
    const revokePayload = { expectedVersion: revokeTarget.version };
    const revoked = await post(b, `/v1/invitations/${revokeTarget.id}/revoke`, revokePayload, revokeKey);
    expect(revoked.statusCode).toBe(200);
    const replay = await post(b, `/v1/invitations/${revokeTarget.id}/revoke`, revokePayload, revokeKey);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(revoked.json());
    await gameAuthority.revokeForTests(game.id, b.userId);
    for (const request of [
      () => post(b, `/v1/games/${game.id}/invitations`, payload, createKey),
      () => post(b, `/v1/games/${game.id}/invitations`, payload),
      () => post(b, `/v1/invitations/${revokeTarget.id}/revoke`, revokePayload, revokeKey),
      () => post(b, `/v1/invitations/${issued.id}/revoke`, { expectedVersion: issued.version }),
    ]) {
      const denied = await request();
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe("GAME_MANAGER_REVOKED");
    }
    const pending = await get(a, `/v1/invitations/${issued.id}`);
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toMatchObject({ status: "pending", version: issued.version });
    // Existing issuer read access also survives role loss; this is observation,
    // not an Owner decision about the future G-05 policy.
    expect((await get(b, `/v1/invitations/${issued.id}`)).statusCode).toBe(200);
    const accepted = await accept(a, issued, game.version);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().participation).toMatchObject({ userId: a.userId, status: "confirmed" });
    await expectFullWithCreator(game.id, owner);
  });

  it("G-06 observation: unlisted invitation records reveal no Game detail, roster, contact or Radar payload", async () => {
    const { owner, a, b, peerA } = await actors();
    const game = await publishGame(owner, {
      capacity: 2, visibility: "unlisted", title: "private-title-sentinel", address: "private-address-sentinel",
    });
    const invitation = await invite(owner, game, peerA.publicPlayerId);
    expectPrivateDto(invitation);
    const ownerDetail = await get(owner, `/v1/games/${game.id}`);
    expect(ownerDetail.statusCode).toBe(200);
    expect(ownerDetail.json().title).toBe("private-title-sentinel");
    expect(ownerDetail.body).toContain("private-address-sentinel");
    const catalog = await get(a, `/v1/games?venueId=${ownerDetail.json().venue.id}`);
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().items).toEqual([]);
    for (const response of [
      await get(a, `/v1/invitations/${invitation.id}`),
      await get(owner, `/v1/invitations/${invitation.id}`),
    ]) {
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expectPrivateDto(response.json() as GameInvitationDto);
    }
    for (const [actor, url] of [
      [a, "/v1/me/invitations"], [owner, `/v1/games/${game.id}/invitations`],
    ] as const) {
      const response = await get(actor, url);
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().items).toHaveLength(1);
      response.json().items.forEach(expectPrivateDto);
    }
    for (const actor of [a, b]) {
      for (const url of [
        `/v1/games/${game.id}`, `/v1/games/${game.id}/participations`,
        `/v1/games/${game.id}/invitations`, `/v1/games/${game.id}/chat/members`,
      ]) {
        const denied = await get(actor, url);
        expect(denied.statusCode).toBe(404);
        expect(denied.body).not.toMatch(/private-title|private-address|telegram:|example\.com/);
      }
    }
    expect((await app.inject({ method: "GET", url: `/v1/games/${game.id}` })).statusCode).toBe(404);
    const foreign = await get(b, `/v1/invitations/${invitation.id}`);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe("INVITATION_NOT_FOUND");
    const foreignMine = await get(b, "/v1/me/invitations");
    expect(foreignMine.json().items).toEqual([]);
    await expectOnlyCreator(game.id, owner);
    // No Accept presentation/policy for inaccessible details is invented here.
  });

  it("pending offers create neither seats nor chat membership; two offers race for the creator's last seat", async () => {
    const { owner, a, b, peerA, peerB } = await actors();
    const game = await publishGame(owner, { capacity: 2 });
    expect(game).toMatchObject({ confirmedCount: 1, availablePlaces: 1 });
    const invA = await invite(owner, game, peerA.publicPlayerId);
    const invB = await invite(owner, game, peerB.publicPlayerId);
    await expectOnlyCreator(game.id, owner);
    expect((await get(owner, `/v1/games/${game.id}/chat`)).statusCode).toBe(200);
    for (const actor of [a, b]) {
      expect((await get(actor, `/v1/games/${game.id}/chat`)).statusCode).toBe(404);
    }
    const membership = await pool.query(
      `SELECT m.user_id FROM conversation_members m JOIN conversations c ON c.id=m.conversation_id
       WHERE c.game_id=$1 AND m.user_id IN ($2,$3)`, [game.id, a.userId, b.userId]);
    expect(membership.rows).toEqual([]);
    const results = await raceOnGame(game.id, () => [
      accept(a, invA, game.version), accept(b, invB, game.version),
    ]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const loserIndex = results[0]!.statusCode === 409 ? 0 : 1;
    expect(results[loserIndex]!.json().code).toBe("GAME_FULL");
    const loser = loserIndex === 0 ? { actor: a, inv: invA } : { actor: b, inv: invB };
    expect((await get(loser.actor, `/v1/invitations/${loser.inv.id}`)).json().status).toBe("pending");
    await expectFullWithCreator(game.id, owner);
  });

  it("formal acceptance and ordinary Participation confirmation share the last-seat SQL fence", async () => {
    const { owner, a, b, peerA } = await actors();
    const game = await publishGame(owner, { capacity: 2 });
    const invitation = await invite(owner, game, peerA.publicPlayerId);
    const requested = await post(b, `/v1/games/${game.id}/participations`, { expectedGameVersion: game.version });
    expect(requested.statusCode).toBe(201);
    const participation = requested.json() as { id: string; version: number };
    const fresh = await get(owner, `/v1/games/${game.id}`);
    expect(fresh.json()).toMatchObject({ confirmedCount: 1, availablePlaces: 1 });
    const results = await raceOnGame(game.id, () => [
      accept(a, invitation, fresh.json().version),
      post(owner, `/v1/participations/${participation.id}/confirm`, { expectedVersion: participation.version }),
    ]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find(r => r.statusCode === 409)!.json().code).toBe("GAME_FULL");
    const invitationState = await get(a, `/v1/invitations/${invitation.id}`);
    expect(invitationState.json().status).toBe(results[0]!.statusCode === 200 ? "accepted" : "pending");
    await expectFullWithCreator(game.id, owner);
  });

  it("accept replay remains actor-scoped and same-key concurrent calls create one seat/transition", async () => {
    const { owner, a, b, peerA } = await actors();
    const game = await publishGame(owner, { capacity: 2 });
    const invitation = await invite(owner, game, peerA.publicPlayerId);
    const key = uniqueSuffix("same-accept");
    const anonymous = await app.inject({ method: "POST", url: `/v1/invitations/${invitation.id}/accept`,
      headers: { "idempotency-key": key, origin: "http://127.0.0.1:3001", "x-csrf-token": a.csrfToken },
      payload: { expectedVersion: invitation.version, expectedGameVersion: game.version, userId: a.userId } });
    expect(anonymous.statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/invitations/${invitation.id}` })).statusCode).toBe(401);
    const responses = await Promise.all([accept(a, invitation, game.version, key), accept(a, invitation, game.version, key)]);
    expect(responses.map(r => r.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    const replay = await accept(a, invitation, game.version, key);
    expect(replay.json()).toEqual(responses[0]!.json());
    for (const command of ["accept", "decline", "revoke"]) {
      const denied = await post(b, `/v1/invitations/${invitation.id}/${command}`, {
        expectedVersion: invitation.version, expectedGameVersion: game.version, userId: a.userId,
      }, key);
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain(a.userId);
    }
    const participationId = responses[0]!.json().participation.id as string;
    const transitions = await pool.query(
      "SELECT id FROM participation_transitions WHERE participation_id=$1 AND to_status='confirmed'", [participationId]);
    expect(transitions.rows).toHaveLength(1);
    const events = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND type='invitation.accepted'", [invitation.id]);
    expect(events.rows).toHaveLength(1);
    expect(Object.keys(events.rows[0]!.payload).sort()).toEqual(["gameId", "invitationId", "participationId", "status"].sort());
    expectPrivateDto(responses[0]!.json().invitation as GameInvitationDto);
    await expectFullWithCreator(game.id, owner);
  });

  it("expired offers deny stale Accept and cross-session reads without materializing a seat", async () => {
    const { owner, a, b, peerA } = await actors();
    const game = await publishGame(owner, { capacity: 2 });
    const invitation = await invite(owner, game, peerA.publicPlayerId);
    await pool.query("UPDATE game_invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [invitation.id]);
    const expired = await get(a, `/v1/invitations/${invitation.id}`);
    expect(expired.statusCode).toBe(200);
    expect(expired.json()).toMatchObject({ status: "expired", version: invitation.version + 1 });
    expectPrivateDto(expired.json() as GameInvitationDto);
    const denied = await accept(a, invitation, game.version);
    expect(denied.statusCode).toBe(409);
    expect(denied.json().code).toBe("INVITATION_NOT_PENDING");
    expect((await get(b, `/v1/invitations/${invitation.id}`)).statusCode).toBe(404);
    await expectOnlyCreator(game.id, owner);
  });

  it.each(["inviter", "invitee"] as const)("%s bilateral block fences Accept of an already issued offer", async blocker => {
    const { owner, a, b, peerA } = await actors();
    const ownerProfile = await ensureOpenProfile(owner, "Formal Owner", "block-owner");
    const game = await publishGame(owner, { capacity: 2 });
    const invitation = await invite(owner, game, peerA.publicPlayerId);
    const session = blocker === "inviter" ? owner : a;
    const target = blocker === "inviter" ? peerA.publicPlayerId : ownerProfile.publicPlayerId;
    const blocked = await app.inject({ method: "PUT", url: `/v1/me/blocks/${target}`,
      headers: mutationHeaders(session, uniqueSuffix("formal-block")), payload: {} });
    expect(blocked.statusCode).toBe(200);
    const denied = await accept(a, invitation, game.version);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().code).toBe("RESOURCE_UNAVAILABLE");
    expect((await accept(b, invitation, game.version)).statusCode).toBe(404);
    await expectOnlyCreator(game.id, owner);
  });

  it("accept-vs-cancel settles without confirmed seats in a cancelled Game, including the creator", async () => {
    const { owner, a, peerA } = await actors();
    const game = await publishGame(owner, { capacity: 2 });
    const invitation = await invite(owner, game, peerA.publicPlayerId);
    const [accepted, cancelled] = await raceOnGame(game.id, () => [
      accept(a, invitation, game.version),
      post(owner, `/v1/games/${game.id}/cancel`, { expectedVersion: game.version, reason: "formal race" }),
    ]);
    expect([accepted!.statusCode, cancelled!.statusCode].sort()).toEqual([200, 409]);
    if (cancelled!.statusCode === 409) {
      expect(cancelled!.json().code).toBe("VERSION_CONFLICT");
      const current = await get(owner, `/v1/games/${game.id}`);
      expect((await post(owner, `/v1/games/${game.id}/cancel`, {
        expectedVersion: current.json().version, reason: "settle formal race",
      })).statusCode).toBe(200);
    } else {
      expect(accepted!.json().code).toBe("INVITATION_NOT_PENDING");
    }
    const active = await pool.query(
      "SELECT id FROM participations WHERE game_id=$1 AND status IN ('pending','confirmed')", [game.id]);
    expect(active.rows).toEqual([]);
    const current = await get(owner, `/v1/games/${game.id}`);
    expect(current.json()).toMatchObject({ status: "cancelled", confirmedCount: 0 });
    expect((await get(a, `/v1/games/${game.id}/chat/members`)).statusCode).toBe(404);
    const offer = await get(a, `/v1/invitations/${invitation.id}`);
    expect(offer.json().status).toBe(accepted!.statusCode === 200 ? "accepted" : "cancelled_by_game");
    expectPrivateDto(offer.json() as GameInvitationDto);
  });
});
