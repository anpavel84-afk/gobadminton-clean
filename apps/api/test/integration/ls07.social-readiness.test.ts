/**
 * LS-07 social/backend readiness — cross-slice synthetic E2E.
 * Technical proof only; not Legal/OAuth/real-user readiness.
 */
import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { GameChatModule } from "../../src/game-chat/game-chat.module";
import { GamesModule } from "../../src/games/games.module";
import { InboxModule } from "../../src/inbox/inbox.module";
import {
  buildInboxCountSql,
  buildInboxPageSql,
} from "../../src/inbox/inbox-compose-sql";
import { InvitationsModule } from "../../src/invitations/invitations.module";
import {
  SocialExpiryCleanupCommand,
  sqlExecutorFromPg,
} from "../../src/jobs/social-expiry-cleanup.command";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { RADAR_PREVIEW_PER_MINUTE } from "../../src/radar/constants";
import {
  RADAR_PG_DUMP_EXCLUDE_ARGS,
  resetRadarPresenceBeforeServingTraffic,
} from "../../src/radar/radar-recovery";
import { RadarModule } from "../../src/radar/radar.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton_ls07";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const pgDump =
  process.env.PG_DUMP_PATH ??
  "/home/agentagency-dev/.local/micromamba/envs/pgis/bin/pg_dump";

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

describeIntegration("LS-07 social readiness", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:ls07",
    subject: uniqueSuffix("ls07-a"),
    email: "ls07-a@example.com",
    displayName: "LS07 Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:ls07",
    subject: uniqueSuffix("ls07-b"),
    email: "ls07-b@example.com",
    displayName: "LS07 Player B",
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
    process.env.GIT_SHA = "integration-ls07";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_DM_ENABLED = "1";
    process.env.SOCIAL_INVITATIONS_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";
    process.env.SOCIAL_INBOX_ENABLED = "1";
    process.env.SOCIAL_RADAR_ENABLED = "1";
    process.env.SOCIAL_DM_REQUEST_TTL_SECONDS = "604800";
    process.env.SOCIAL_DM_MESSAGE_RETENTION_SECONDS = "60";
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
        RadarModule,
        MessagingModule,
        InvitationsModule,
        GameChatModule,
        InboxModule,
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
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM radar_presences");
    await pool.query("DELETE FROM radar_rate_budgets");
    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM participation_transitions");
    await pool.query("DELETE FROM participations");
    await pool.query("DELETE FROM abuse_reports");
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

  function mutationHeaders(session: Session, key: string) {
    return {
      cookie: session.cookie,
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  function deleteHeaders(session: Session, key: string, activationId: string) {
    return {
      ...mutationHeaders(session, key),
      "x-radar-activation-id": activationId,
    };
  }

  function freshFix(lat = 55.7558, lon = 37.6173) {
    return {
      latitude: lat,
      longitude: lon,
      accuracyMeters: 25,
      capturedAt: new Date().toISOString(),
    };
  }

  async function ensureSocialAndRadar(session: Session, name: string) {
    const current = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    const cur = current.json() as { version: number };
    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(session, `prof-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: cur.version,
        displayName: name,
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        bio: "LS07",
        contactPolicy: "requests",
        socialEligible: true,
        radarConsented: true,
        radarConsentPolicyVersion: "radar-mvp-v1",
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
        headers: mutationHeaders(session, `vis-${uniqueSuffix("k")}`),
        payload: {
          directoryVisible: true,
          consentPolicyVersion: "directory-mvp-v1",
          expectedVersion: body.version,
        },
      });
      expect(vis.statusCode).toBe(200);
      body = vis.json() as typeof body;
    }
    return body;
  }

  async function startRadar(session: Session, fix = freshFix(), key?: string) {
    return app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: mutationHeaders(session, key ?? `start-${uniqueSuffix("k")}`),
      payload: {
        location: fix,
        radiusBucketKm: 10,
        ttlMinutes: 15,
        consentPolicyVersion: "radar-mvp-v1",
      },
    });
  }

  async function activateRadar(session: Session, fix = freshFix(), startKey?: string) {
    const current = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: session.cookies,
    });
    const body = current.json() as {
      state?: string;
      activationId?: string;
      version?: number;
    };
    if (body.state === "owned_elsewhere" && body.activationId) {
      const takeover = await app.inject({
        method: "POST",
        url: "/v1/me/radar/activations/current/takeover",
        headers: mutationHeaders(session, `take-${uniqueSuffix("k")}`),
        payload: {
          activationId: body.activationId,
          expectedVersion: body.version ?? 1,
          confirm: true,
          location: fix,
          radiusBucketKm: 10,
        },
      });
      expect(takeover.statusCode).toBe(200);
      return takeover;
    }
    if (body.state === "active" && body.activationId) {
      await app.inject({
        method: "DELETE",
        url: "/v1/me/radar/activations/current",
        headers: deleteHeaders(
          session,
          `stop-pre-${uniqueSuffix("k")}`,
          body.activationId,
        ),
        payload: {},
      });
    }
    const started = await startRadar(session, fix, startKey);
    expect(started.statusCode).toBe(201);
    return started;
  }

  async function insertSyntheticPeer(opts: {
    displayName: string;
    lon: number;
    lat: number;
  }) {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const activationId = randomUUID();
    const publicPlayerId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, status, display_name) VALUES ($1, 'active', $2)`,
      [userId, opts.displayName],
    );
    await pool.query(
      `INSERT INTO app_sessions
         (id, user_id, audience, session_hash, csrf_ciphertext, expires_at)
       VALUES ($1, $2, 'consumer_browser', $3, $4, now() + interval '1 day')`,
      [sessionId, userId, `hash-${userId}`, `csrf-${userId}`],
    );
    await pool.query(
      `INSERT INTO player_social_profiles (
         user_id, public_player_id, display_name, city_id,
         radar_consented, radar_consent_policy_version, radar_consented_at,
         social_eligible, version
       ) VALUES ($1,$2,$3,$4,true,'radar-mvp-v1',now(),true,1)`,
      [userId, publicPlayerId, opts.displayName, MOSCOW_CITY_ID],
    );
    const cell = await pool.query<{
      cell_i: number;
      cell_j: number;
      lon: number;
      lat: number;
    }>(
      `WITH raw AS (
         SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326) AS g
       ),
       metric AS (SELECT ST_Transform(g, 32637) AS g FROM raw),
       cell AS (
         SELECT floor(ST_X(g)/1000)::int AS cell_i, floor(ST_Y(g)/1000)::int AS cell_j
         FROM metric
       ),
       center_metric AS (
         SELECT ST_SetSRID(
           ST_MakePoint((cell_i+0.5)*1000,(cell_j+0.5)*1000), 32637
         ) AS g, cell_i, cell_j FROM cell
       )
       SELECT cell_i, cell_j, ST_X(ST_Transform(g,4326)) AS lon, ST_Y(ST_Transform(g,4326)) AS lat
       FROM center_metric`,
      [opts.lon, opts.lat],
    );
    const c = cell.rows[0]!;
    await pool.query(
      `INSERT INTO radar_presences (
         user_id, activation_id, owner_session_id, version, policy_version, region_id,
         started_at, expires_at, hard_expires_at, foreground_until, location_valid_until,
         next_location_update_at, next_radius_change_at, radius_changes_window_started_at,
         radius_changes_in_window, cell_i, cell_j, coarse_center, radius_bucket_km
       ) VALUES (
         $1,$2,$3,1,'radar-mvp-v1','moscow-mvp',
         now(), now()+interval '15 minutes', now()+interval '30 minutes',
         now()+interval '90 seconds', now()+interval '6 minutes',
         now()+interval '5 minutes', now(), now(),
         0, $4, $5,
         ST_SetSRID(ST_MakePoint($6::float8,$7::float8),4326)::geography,
         5
       )`,
      [userId, activationId, sessionId, c.cell_i, c.cell_j, c.lon, c.lat],
    );
    return { userId, publicPlayerId };
  }

  async function publishGame(owner: Session, title = "LS07 game") {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "LS07 Court",
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
        hostDisplayName: `Host LS07 ${suffix}`,
        hostPublicContact: "telegram:@ls07",
        venueId: venue.id,
        title,
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
    const publishedRes = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-${suffix}-abcdefgh`),
      payload: { expectedVersion: draft.version },
    });
    expect(publishedRes.statusCode).toBe(200);
    return publishedRes.json() as { id: string; version: number };
  }

  async function seedRadarProof() {
    await pool.query(
      `UPDATE radar_rate_budgets
       SET count = 0, window_started_at = now() - interval '2 hours', next_allowed_at = NULL`,
    );
    const viewer = await login("vk");
    const target = await login("yandex");
    const viewerProfile = await ensureSocialAndRadar(viewer, "Viewer LS07");
    const targetProfile = await ensureSocialAndRadar(target, "Target LS07");
    const viewerFix = freshFix();
    const viewerStartKey = `start-v-${uniqueSuffix("k")}-xxxxxxxx`;
    const startedV = await activateRadar(viewer, viewerFix, viewerStartKey);
    const startedT = await activateRadar(target, freshFix(55.756, 37.62));
    expect([200, 201]).toContain(startedV.statusCode);
    expect([200, 201]).toContain(startedT.statusCode);
    const viewerAct = startedV.json() as { activationId: string; version: number };
    await insertSyntheticPeer({ displayName: "Peer1", lon: 37.621, lat: 55.757 });
    await insertSyntheticPeer({ displayName: "Peer2", lon: 37.622, lat: 55.758 });
    await pool.query(
      `UPDATE radar_rate_budgets
       SET next_allowed_at = now() - interval '1 second', count = 0
       WHERE user_id = $1`,
      [viewer.userId],
    );
    const nearby = await app.inject({
      method: "GET",
      url: "/v1/me/radar/nearby",
      headers: {
        cookie: viewer.cookie,
        "x-radar-activation-id": viewerAct.activationId,
      },
    });
    expect(nearby.statusCode).toBe(200);
    const body = nearby.json() as {
      state: string;
      items: Array<{ resultRef: string; player: { publicPlayerId: string } }>;
    };
    expect(body.state).toBe("results");
    const item = body.items.find(
      (row) => row.player.publicPlayerId === targetProfile.publicPlayerId,
    );
    expect(item).toBeTruthy();
    await pool.query(
      `UPDATE radar_rate_budgets SET count = 0 WHERE user_id = $1 AND bucket = 'preview'`,
      [viewer.userId],
    );
    return {
      viewer,
      target,
      viewerProfile,
      targetProfile,
      viewerAct,
      resultRef: item!.resultRef,
      viewerStartKey,
      viewerFix,
    };
  }

  it("E2E Games→Players→Radar contact→DM→invite→chat→Inbox; stop retains established resources", async () => {
    const seeded = await seedRadarProof();

    const directory = await app.inject({
      method: "GET",
      url: `/v1/players/${seeded.targetProfile.publicPlayerId}`,
      cookies: seeded.viewer.cookies,
    });
    expect(directory.statusCode).toBe(200);
    expect(directory.json()).toMatchObject({
      publicPlayerId: seeded.targetProfile.publicPlayerId,
    });

    const games = await app.inject({
      method: "GET",
      url: "/v1/games?limit=10",
      cookies: seeded.viewer.cookies,
    });
    expect(games.statusCode).toBe(200);

    const dm = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(seeded.viewer, `dm-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: seeded.targetProfile.publicPlayerId,
        text: "Привет с Radar LS07",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
        discoveryProof: seeded.resultRef,
      },
    });
    expect(dm.statusCode).toBe(201);
    const dmCreated = dm.json() as {
      conversation: { id: string; version: number };
    };
    const accept = await app.inject({
      method: "POST",
      url: `/v1/conversations/${dmCreated.conversation.id}/accept`,
      headers: mutationHeaders(seeded.target, `acc-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: dmCreated.conversation.version },
    });
    expect(accept.statusCode).toBe(200);

    const game = await publishGame(seeded.viewer, "LS07 invite+chat");
    const invite = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/invitations`,
      headers: mutationHeaders(seeded.viewer, `inv-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: seeded.targetProfile.publicPlayerId,
        expectedGameVersion: game.version,
        discoveryProof: seeded.resultRef,
      },
    });
    expect(invite.statusCode).toBe(201);
    const invitation = invite.json() as { id: string; status: string };
    expect(invitation.status).toBe("pending");
    const inviteRow = await pool.query<{ version: number }>(
      `SELECT version FROM game_invitations WHERE id = $1`,
      [invitation.id],
    );
    const gameRow = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    const acceptInv = await app.inject({
      method: "POST",
      url: `/v1/invitations/${invitation.id}/accept`,
      headers: mutationHeaders(seeded.target, `inva-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        expectedVersion: inviteRow.rows[0]!.version,
        expectedGameVersion: gameRow.rows[0]!.version,
      },
    });
    expect(acceptInv.statusCode).toBe(200);

    const chatSend = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(seeded.viewer, `chs-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        kind: "text",
        text: "Сбор LS07",
        clientMessageId: `cmsg-${uniqueSuffix("m3")}`,
      },
    });
    expect(chatSend.statusCode).toBe(201);

    const inbox = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?limit=50",
      cookies: seeded.target.cookies,
    });
    expect(inbox.statusCode).toBe(200);
    const page = inbox.json() as {
      items: Array<{ kind: string; gameId?: string }>;
      counts: { dmUnread: number; gameChatUnread: number };
    };
    const kinds = page.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["dm", "game_chat"]));
    expect(page.counts.gameChatUnread).toBeGreaterThanOrEqual(1);

    await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: deleteHeaders(
        seeded.viewer,
        `stop-v-${uniqueSuffix("k")}`,
        seeded.viewerAct.activationId,
      ),
      payload: {},
    });
    const dmLeft = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM conversations WHERE id = $1`,
      [dmCreated.conversation.id],
    );
    expect(dmLeft.rows[0]?.n).toBe(1);
    const invLeft = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_invitations WHERE id = $1 AND status = 'accepted'`,
      [invitation.id],
    );
    expect(invLeft.rows[0]?.n).toBe(1);
    const stalePreview = await app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: mutationHeaders(seeded.viewer, `prev-stale-${uniqueSuffix("k")}`),
      payload: { resultRef: seeded.resultRef },
    });
    expect(stalePreview.statusCode).toBe(404);
  });

  it("retention purge clears DM and Game Chat bodies via cleanup job", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    const ownerProfile = await ensureSocialAndRadar(owner, "Owner purge");
    const peer = await ensureSocialAndRadar(player, "Player purge");
    void ownerProfile;

    const dmReq = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(owner, `dmr-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "purge-dm-body",
        clientMessageId: `cmsg-${uniqueSuffix("m1")}`,
      },
    });
    expect(dmReq.statusCode).toBe(201);
    const dmCreated = dmReq.json() as {
      conversation: { id: string; version: number };
    };
    const accept = await app.inject({
      method: "POST",
      url: `/v1/conversations/${dmCreated.conversation.id}/accept`,
      headers: mutationHeaders(player, `acc-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: dmCreated.conversation.version },
    });
    expect(accept.statusCode).toBe(200);

    const game = await publishGame(owner, "Purge chat");
    const gameVersion = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [game.id],
    );
    const apply = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/participations`,
      headers: mutationHeaders(player, `app-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedGameVersion: gameVersion.rows[0]!.version },
    });
    expect([200, 201]).toContain(apply.statusCode);
    const application = apply.json() as { id: string; version: number };
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${application.id}/confirm`,
      headers: mutationHeaders(owner, `cfm-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: application.version },
    });
    expect(confirm.statusCode).toBe(200);
    const chatSend = await app.inject({
      method: "POST",
      url: `/v1/games/${game.id}/chat/messages`,
      headers: mutationHeaders(owner, `chs-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        kind: "text",
        text: "purge-chat-body",
        clientMessageId: `cmsg-${uniqueSuffix("m3")}`,
      },
    });
    expect(chatSend.statusCode).toBe(201);

    await pool.query(
      `UPDATE messages SET purge_eligible_at = now() - interval '1 second'
       WHERE content_state = 'live'`,
    );
    const cleanupCmd = new SocialExpiryCleanupCommand();
    const purged = await cleanupCmd.execute(sqlExecutorFromPg(pool), {
      kind: "sweep",
    });
    expect(purged.dmMessagesPurged).toBeGreaterThanOrEqual(2);

    const bodies = await pool.query<{
      body_text: string | null;
      content_state: string;
    }>(
      `SELECT body_text, content_state FROM messages
       WHERE content_state = 'purged'`,
    );
    expect(bodies.rowCount).toBeGreaterThanOrEqual(2);
    for (const row of bodies.rows) {
      expect(row.body_text).toBeNull();
      expect(row.content_state).toBe("purged");
    }
  });

  it("backup exclude + restore reset does not resurrect presence or proofs", async () => {
    const seeded = await seedRadarProof();

    const included = execFileSync(
      pgDump,
      ["--dbname", databaseUrl, "--table=radar_presences", "--data-only"],
      { encoding: "utf8" },
    );
    expect(included.includes("COPY public.radar_presences")).toBe(true);

    const excluded = execFileSync(
      pgDump,
      [
        "--dbname",
        databaseUrl,
        "--table=radar_presences",
        "--data-only",
        ...RADAR_PG_DUMP_EXCLUDE_ARGS,
      ],
      { encoding: "utf8" },
    );
    expect(excluded.includes("COPY public.radar_presences")).toBe(false);

    const reset = await resetRadarPresenceBeforeServingTraffic(
      sqlExecutorFromPg(pool),
    );
    expect(reset.deleted).toBeGreaterThan(0);
    const empty = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM radar_presences`,
    );
    expect(empty.rows[0]?.n).toBe(0);

    await pool.query(
      `UPDATE radar_rate_budgets SET count = 0 WHERE user_id = $1 AND bucket = 'preview'`,
      [seeded.viewer.userId],
    );
    const preview = await app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: mutationHeaders(seeded.viewer, `prev-rst-${uniqueSuffix("k")}`),
      payload: { resultRef: seeded.resultRef },
    });
    expect(preview.statusCode).toBe(404);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: mutationHeaders(seeded.viewer, seeded.viewerStartKey),
      payload: {
        location: seeded.viewerFix,
        radiusBucketKm: 10,
        ttlMinutes: 15,
        consentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ code: "RADAR_NOT_ACTIVE" });
  });

  it("Radar preview rate budget returns RATE_LIMITED after window exhaustion", async () => {
    const seeded = await seedRadarProof();
    await pool.query(
      `INSERT INTO radar_rate_budgets (user_id, bucket, window_started_at, count, next_allowed_at)
       VALUES ($1, 'preview', now(), 0, NULL)
       ON CONFLICT (user_id, bucket) DO UPDATE
       SET window_started_at = EXCLUDED.window_started_at,
           count = 0,
           next_allowed_at = NULL,
           updated_at = now()`,
      [seeded.viewer.userId],
    );

    let lastStatus = 0;
    let lastBody: unknown = null;
    for (let i = 0; i < RADAR_PREVIEW_PER_MINUTE + 2; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/radar/results/preview",
        headers: mutationHeaders(seeded.viewer, `prev-rl-${i}-${uniqueSuffix("k")}`),
        payload: { resultRef: seeded.resultRef },
      });
      lastStatus = res.statusCode;
      lastBody = res.json();
      if (res.statusCode === 429) break;
    }
    expect(lastStatus).toBe(429);
    expect(lastBody).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("block fences directory contact and Radar proof; Game Chat remains for current members", async () => {
    const seeded = await seedRadarProof();
    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${seeded.targetProfile.publicPlayerId}`,
      headers: mutationHeaders(seeded.viewer, `blk-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {},
    });
    expect(block.statusCode).toBe(200);

    const dm = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(seeded.viewer, `dm-b-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: seeded.targetProfile.publicPlayerId,
        text: "blocked",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
        discoveryProof: seeded.resultRef,
      },
    });
    expect(dm.statusCode).toBeGreaterThanOrEqual(400);

    await pool.query(
      `UPDATE radar_rate_budgets SET count = 0 WHERE user_id = $1 AND bucket = 'preview'`,
      [seeded.viewer.userId],
    );
    const preview = await app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: mutationHeaders(seeded.viewer, `prev-b-${uniqueSuffix("k")}`),
      payload: { resultRef: seeded.resultRef },
    });
    expect(preview.statusCode).toBe(404);
  });

  it("Inbox compose SQL stays Limit-bounded (query budget)", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    await ensureSocialAndRadar(owner, "Owner budget");
    const peer = await ensureSocialAndRadar(player, "Player budget");

    const dmReq = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(owner, `dmr-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "budget",
        clientMessageId: `cmsg-${uniqueSuffix("m1")}`,
      },
    });
    expect(dmReq.statusCode).toBe(201);

    const inbox = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?limit=20",
      cookies: player.cookies,
    });
    expect(inbox.statusCode).toBe(200);
    const page = inbox.json() as {
      items: Array<{ id: string; kind: string; lastActivityAt: string }>;
    };
    expect(page.items.length).toBeGreaterThanOrEqual(1);

    const pageBuilt = buildInboxPageSql(
      { dmEnabled: true, invitationsEnabled: true, gameChatEnabled: true },
      "all",
      {
        at: page.items[0]!.lastActivityAt,
        kind: page.items[0]!.kind as "dm" | "dm_request" | "game_invitation" | "game_chat",
        id: page.items[0]!.id,
      },
      20,
    );
    const pageExplain = await pool.query(
      `EXPLAIN (FORMAT JSON, ANALYZE false) ${pageBuilt.sql}`,
      [player.userId, ...pageBuilt.params],
    );
    const pagePlan = pageExplain.rows[0]["QUERY PLAN"][0]["Plan"] as {
      "Node Type": string;
      "Plan Rows": number;
    };
    expect(pagePlan["Node Type"]).toBe("Limit");
    expect(pagePlan["Plan Rows"]).toBeLessThanOrEqual(21);

    for (const countKind of [
      "pending_request",
      "dm_unread",
      "pending_invitation",
      "game_chat_unread",
    ] as const) {
      const countSql = buildInboxCountSql(countKind);
      const countExplain = await pool.query(`EXPLAIN (FORMAT JSON) ${countSql}`, [
        player.userId,
      ]);
      expect(JSON.stringify(countExplain.rows[0]).length).toBeGreaterThan(20);
    }
  });
});
