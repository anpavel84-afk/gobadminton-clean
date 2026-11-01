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
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { APP_ENV } from "../../src/tokens";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import { InvitationsModule } from "../../src/invitations/invitations.module";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import {
  resetRadarPresenceBeforeServingTraffic,
  sqlExecutorFromPg,
} from "../../src/radar/radar-recovery";
import { RadarModule } from "../../src/radar/radar.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const pgDump =
  process.env.PG_DUMP_PATH ??
  "/home/agentagency-dev/.local/micromamba/envs/pgis/bin/pg_dump";

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

describeIntegration("LS-R2 radar contact/recovery", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:lsr2",
    subject: uniqueSuffix("lsr2-a"),
    email: "lsr2-a@example.com",
    displayName: "LSR2 Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:lsr2",
    subject: uniqueSuffix("lsr2-b"),
    email: "lsr2-b@example.com",
    displayName: "LSR2 Player B",
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
    process.env.GIT_SHA = "integration-lsr2";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_RADAR_ENABLED = "1";
    process.env.SOCIAL_DM_ENABLED = "1";
    process.env.SOCIAL_INVITATIONS_ENABLED = "1";

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
        bio: "LSR2",
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
    // Synthetic peers stay private for contactability proof (Owner #448 DEFAULT is ON).
    await pool.query(
      `INSERT INTO player_social_profiles (
         user_id, public_player_id, display_name, city_id,
         directory_visible, contact_policy, directory_visibility_provenance,
         radar_consented, radar_consent_policy_version, radar_consented_at,
         social_eligible, version
       ) VALUES ($1,$2,$3,$4,false,'closed','user_opt_out',true,'radar-mvp-v1',now(),true,1)`,
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

  async function resetNearbyBudget(userId: string) {
    await pool.query(
      `UPDATE radar_rate_budgets
       SET next_allowed_at = now() - interval '1 second', count = 0
       WHERE user_id = $1`,
      [userId],
    );
  }

  async function seedCohortAndProof() {
    await pool.query(
      `UPDATE radar_rate_budgets
       SET count = 0, window_started_at = now() - interval '2 hours', next_allowed_at = NULL`,
    );
    const viewer = await login("vk");
    const target = await login("yandex");
    const viewerProfile = await ensureSocialAndRadar(viewer, "Viewer R2");
    const targetProfile = await ensureSocialAndRadar(target, "Target R2");
    const viewerFix = freshFix();
    const viewerStartKey = `start-v-${uniqueSuffix("k")}-xxxxxxxx`;
    const startedV = await activateRadar(viewer, viewerFix, viewerStartKey);
    const startedT = await activateRadar(target, freshFix(55.756, 37.62));
    expect([200, 201]).toContain(startedV.statusCode);
    expect([200, 201]).toContain(startedT.statusCode);
    const viewerAct = startedV.json() as { activationId: string; version: number };
    const targetAct = startedT.json() as { activationId: string; version: number };
    await insertSyntheticPeer({ displayName: "Peer1", lon: 37.621, lat: 55.757 });
    await insertSyntheticPeer({ displayName: "Peer2", lon: 37.622, lat: 55.758 });
    await resetNearbyBudget(viewer.userId);
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
      targetAct,
      resultRef: item!.resultRef,
      viewerStartKey,
      viewerFix,
    };
  }

  async function publishGame(owner: Session) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "LSR2 Court",
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
        hostDisplayName: `Host LSR2 ${suffix}`,
        hostPublicContact: "telegram:@lsr2",
        venueId: venue.id,
        title: "LSR2 game",
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

  it("projects Radar contactability without exposing consent or coordinates", async () => {
    const seeded = await seedCohortAndProof();
    const preview = () => app.inject({ method: "POST", url: "/v1/radar/results/preview", headers: mutationHeaders(seeded.viewer, uniqueSuffix("contact-preview")), payload: {resultRef: seeded.resultRef} });
    const reset = () => pool.query("UPDATE radar_rate_budgets SET count=0 WHERE user_id=$1 AND bucket='preview'", [seeded.viewer.userId]);
    let response = await preview(); expect(response.statusCode).toBe(200); expect(response.json().player.canRequestContact).toBe(true);
    const keys = Object.keys(response.json().player).sort();
    expect(keys).toEqual(["avatar","canRequestContact","displayName","level","publicPlayerId","trainer"].sort());
    for (const change of ["contact_policy='closed'", "directory_visible=false"]) {
      await pool.query(`UPDATE player_social_profiles SET ${change} WHERE user_id=$1`, [seeded.target.userId]);
      await reset(); response = await preview(); expect(response.statusCode).toBe(200); expect(response.json().player.canRequestContact).toBe(false);
      // Restore with provenance consistent with Owner-default / consent stamps already present.
      await pool.query(
        `UPDATE player_social_profiles
         SET contact_policy='requests', directory_visible=true,
             directory_visibility_provenance = CASE
               WHEN consent_policy_version IS NOT NULL AND opted_in_at IS NOT NULL THEN 'user_consent'
               ELSE 'owner_default'
             END
         WHERE user_id=$1`,
        [seeded.target.userId],
      );
    }
    await resetNearbyBudget(seeded.viewer.userId);
    const nearby = await app.inject({method:"GET",url:"/v1/me/radar/nearby",headers:{cookie:seeded.viewer.cookie,"x-radar-activation-id":seeded.viewerAct.activationId}});
    expect(nearby.statusCode).toBe(200);
    expect(nearby.json().items.find((item: {player: {publicPlayerId:string}}) => item.player.publicPlayerId === seeded.targetProfile.publicPlayerId).player.canRequestContact).toBe(true);
    expect(nearby.json().items.filter((item: {player: {publicPlayerId:string}}) => item.player.publicPlayerId !== seeded.targetProfile.publicPlayerId).every((item: {player: {canRequestContact:boolean}}) => item.player.canRequestContact === false)).toBe(true);
  });

  it("revalidates preview against current activations/session/expiry/block/cohort", async () => {
    const seeded = await seedCohortAndProof();
    const ok = await app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: mutationHeaders(seeded.viewer, `preview-${uniqueSuffix("k")}`),
      payload: { resultRef: seeded.resultRef },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      player: { publicPlayerId: seeded.targetProfile.publicPlayerId },
    });
    expect(JSON.stringify(ok.json()).includes("latitude")).toBe(false);

    const other = await login("vk");
    await pool.query(
      `UPDATE radar_rate_budgets SET count = 0 WHERE user_id = $1 AND bucket = 'preview'`,
      [seeded.viewer.userId],
    );
    const crossSession = await app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: mutationHeaders(other, `preview-x-${uniqueSuffix("k")}`),
      payload: { resultRef: seeded.resultRef },
    });
    expect(crossSession.statusCode).toBe(404);
    expect(crossSession.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
    void other;

    await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: deleteHeaders(
        seeded.target,
        `stop-${uniqueSuffix("k")}`,
        seeded.targetAct.activationId,
      ),
      payload: {},
    });
    await pool.query(
      `UPDATE radar_rate_budgets SET count = 0 WHERE user_id = $1 AND bucket = 'preview'`,
      [seeded.viewer.userId],
    );
    const afterStop = await app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: mutationHeaders(seeded.viewer, `preview-s-${uniqueSuffix("k")}`),
      payload: { resultRef: seeded.resultRef },
    });
    expect(afterStop.statusCode).toBe(404);
  });

  it("live rollback invalidates an existing valid proof while demo stays enabled", async () => {
    const seeded = await seedCohortAndProof();
    const env = app.get<AppEnv>(APP_ENV);
    const before = { live: env.SOCIAL_RADAR_ENABLED, demo: env.SOCIAL_RADAR_DEMO_ENABLED };
    const preview = () => app.inject({ method: "POST", url: "/v1/radar/results/preview",
      headers: mutationHeaders(seeded.viewer, `rollback-${uniqueSuffix("k")}`), payload: { resultRef: seeded.resultRef } });
    expect((await preview()).statusCode).toBe(200);
    try {
      env.SOCIAL_RADAR_DEMO_ENABLED = true;
      env.SOCIAL_RADAR_ENABLED = false;
      expect((await preview()).statusCode).toBe(404);
      const dm = await app.inject({ method: "POST", url: "/v1/conversations/requests",
        headers: mutationHeaders(seeded.viewer, `rollback-dm-${uniqueSuffix("k")}`),
        payload: { targetPublicPlayerId: seeded.targetProfile.publicPlayerId, clientMessageId: `rollback-${uniqueSuffix("msg")}`, text: "Rollback proof test", discoveryProof: seeded.resultRef } });
      expect(dm.statusCode).toBe(404);
    } finally {
      env.SOCIAL_RADAR_ENABLED = before.live;
      env.SOCIAL_RADAR_DEMO_ENABLED = before.demo;
    }
  });

  it("wires discoveryProof into first DM and invitation; directory contact still works without Radar", async () => {
    const seeded = await seedCohortAndProof();
    const dm = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(seeded.viewer, `dm-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: seeded.targetProfile.publicPlayerId,
        text: "Привет с Radar",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
        discoveryProof: seeded.resultRef,
      },
    });
    expect(dm.statusCode).toBe(201);
    const conv = dm.json() as { conversation: { id: string } };

    const game = await publishGame(seeded.viewer);
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
    const stillThere = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM conversations WHERE id = $1`,
      [conv.conversation.id],
    );
    expect(stillThere.rows[0]?.n).toBe(1);
    const inviteLeft = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_invitations WHERE id = $1 AND status = 'pending'`,
      [invitation.id],
    );
    expect(inviteLeft.rows[0]?.n).toBe(1);
  });

  async function waitForPresenceLockWait(holderPid: number) {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const q = await pool.query<{ n: number }>(
        `SELECT 1 AS n
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query LIKE '%FROM radar_presences%'
           AND pid <> $1
           AND pid <> pg_backend_pid()`,
        [holderPid],
      );
      if (q.rowCount) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(waiting).toBe(true);
  }

  async function contactWithProof(
    surface: "preview" | "dm" | "invitation",
    seeded: Awaited<ReturnType<typeof seedCohortAndProof>>,
    game: { id: string; version: number } | null,
    keyPrefix: string,
  ) {
    const url =
      surface === "preview"
        ? "/v1/radar/results/preview"
        : surface === "dm"
          ? "/v1/conversations/requests"
          : `/v1/games/${game!.id}/invitations`;
    const payload =
      surface === "preview"
        ? { resultRef: seeded.resultRef }
        : surface === "dm"
          ? {
              targetPublicPlayerId: seeded.targetProfile.publicPlayerId,
              text: "LS-R2 proof contact",
              clientMessageId: `cmsg-${uniqueSuffix("m")}`,
              discoveryProof: seeded.resultRef,
            }
          : {
              inviteePublicPlayerId: seeded.targetProfile.publicPlayerId,
              expectedGameVersion: game!.version,
              discoveryProof: seeded.resultRef,
            };
    return app.inject({
      method: "POST",
      url,
      headers: mutationHeaders(seeded.viewer, `${keyPrefix}-${uniqueSuffix("k")}`),
      payload,
    });
  }

  async function stopTarget(
    seeded: Awaited<ReturnType<typeof seedCohortAndProof>>,
  ) {
    const stopped = await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: deleteHeaders(
        seeded.target,
        `stop-${uniqueSuffix("k")}`,
        seeded.targetAct.activationId,
      ),
      payload: {},
    });
    expect([200, 204]).toContain(stopped.statusCode);
  }

  async function revokeTargetRadar(
    seeded: Awaited<ReturnType<typeof seedCohortAndProof>>,
  ) {
    const current = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: seeded.target.cookies,
    });
    expect(current.statusCode).toBe(200);
    const version = (current.json() as { version: number }).version;
    const revoked = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(seeded.target, `revoke-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: version,
        radarConsented: false,
      },
    });
    expect(revoked.statusCode).toBe(200);
  }

  async function takeoverViewer(
    seeded: Awaited<ReturnType<typeof seedCohortAndProof>>,
  ) {
    const second = await login("vk");
    expect(second.userId).toBe(seeded.viewer.userId);
    const takeover = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/takeover",
      headers: mutationHeaders(second, `take-${uniqueSuffix("k")}`),
      payload: {
        activationId: seeded.viewerAct.activationId,
        expectedVersion: seeded.viewerAct.version,
        confirm: true,
        location: freshFix(55.76, 37.62),
        radiusBucketKm: 10,
      },
    });
    expect(takeover.statusCode).toBe(200);
  }

  it.each(["preview", "dm", "invitation"] as const)(
    "denies %s after foreground lease expires behind a real presence lock",
    async (surface) => {
      const seeded = await seedCohortAndProof();
      const game = surface === "invitation" ? await publishGame(seeded.viewer) : null;
      await pool.query(
        `UPDATE radar_presences
         SET foreground_until = now() + interval '1 second'
         WHERE user_id = $1`,
        [seeded.target.userId],
      );
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        const locked = await holder.query<{ pid: number }>(
          `SELECT pg_backend_pid() AS pid, user_id
           FROM radar_presences
           WHERE user_id = $1
           FOR UPDATE`,
          [seeded.target.userId],
        );
        const pending = contactWithProof(
          surface,
          seeded,
          game,
          `expiry-${surface}`,
        );
        await waitForPresenceLockWait(locked.rows[0]!.pid);
        await new Promise((r) => setTimeout(r, 1200));
        await holder.query("COMMIT");
        const result = await pending;
        expect(result.statusCode).toBe(404);
        expect(result.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
        if (surface === "dm") {
          const created = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM conversations`,
          );
          expect(created.rows[0]?.n).toBe(0);
        }
        if (surface === "invitation") {
          const created = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM game_invitations`,
          );
          expect(created.rows[0]?.n).toBe(0);
        }
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
      }
    },
  );

  it.each(
    (
      [
        ["dm", "stop"],
        ["dm", "revoke"],
        ["dm", "takeover"],
        ["invitation", "stop"],
        ["invitation", "revoke"],
        ["invitation", "takeover"],
      ] as const
    ).flatMap(([adapter, invalidation]) => [
      { adapter, invalidation, order: "invalidate-then-contact" as const },
      { adapter, invalidation, order: "contact-then-invalidate" as const },
    ]),
  )(
    "R11 $adapter $invalidation $order",
    async ({ adapter, invalidation, order }) => {
      const seeded = await seedCohortAndProof();
      const game =
        adapter === "invitation" ? await publishGame(seeded.viewer) : null;
      const invalidate = async () => {
        if (invalidation === "stop") await stopTarget(seeded);
        else if (invalidation === "revoke") await revokeTargetRadar(seeded);
        else await takeoverViewer(seeded);
      };

      if (order === "invalidate-then-contact") {
        await invalidate();
        const denied = await contactWithProof(
          adapter,
          seeded,
          game,
          `r11-${adapter}-${invalidation}-after`,
        );
        expect(denied.statusCode).toBe(404);
        expect(denied.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
        if (adapter === "dm") {
          const created = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM conversations`,
          );
          expect(created.rows[0]?.n).toBe(0);
        } else {
          const created = await pool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM game_invitations`,
          );
          expect(created.rows[0]?.n).toBe(0);
        }
        return;
      }

      const created = await contactWithProof(
        adapter,
        seeded,
        game,
        `r11-${adapter}-${invalidation}-first`,
      );
      expect(created.statusCode).toBe(201);
      const resourceId =
        adapter === "dm"
          ? (created.json() as { conversation: { id: string } }).conversation.id
          : (created.json() as { id: string }).id;
      await invalidate();
      await pool.query(
        `UPDATE radar_rate_budgets SET count = 0 WHERE user_id = $1 AND bucket = 'preview'`,
        [seeded.viewer.userId],
      );
      const laterPreview = await contactWithProof(
        "preview",
        seeded,
        null,
        `r11-${adapter}-${invalidation}-preview`,
      );
      expect(laterPreview.statusCode).toBe(404);
      expect(laterPreview.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });
      if (adapter === "invitation") {
        const laterGame = await publishGame(seeded.viewer);
        const laterInvite = await contactWithProof(
          "invitation",
          seeded,
          laterGame,
          `r11-inv-${invalidation}-later`,
        );
        expect(laterInvite.statusCode).toBe(404);
        expect(laterInvite.json()).toMatchObject({
          code: "RESOURCE_UNAVAILABLE",
        });
      }
      if (adapter === "dm") {
        const left = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM conversations WHERE id = $1`,
          [resourceId],
        );
        expect(left.rows[0]?.n).toBe(1);
      } else {
        const left = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM game_invitations
           WHERE id = $1 AND status = 'pending'`,
          [resourceId],
        );
        expect(left.rows[0]?.n).toBe(1);
      }
    },
  );

  it("logical dump excludes presence DATA; restore reset does not resurrect proofs or receipts", async () => {
    const seeded = await seedCohortAndProof();

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
        "--exclude-table-data=radar_presences",
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
    const stillEmpty = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM radar_presences WHERE user_id = $1`,
      [seeded.viewer.userId],
    );
    expect(stillEmpty.rows[0]?.n).toBe(0);
  });
});
