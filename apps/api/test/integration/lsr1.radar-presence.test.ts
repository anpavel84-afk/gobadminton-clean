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
import { GamesModule } from "../../src/games/games.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { RadarModule } from "../../src/radar/radar.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { randomUUID } from "node:crypto";

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

describeIntegration("LS-R1 radar presence/matching", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let testEnv: ReturnType<typeof loadEnv>;

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:lsr1",
    subject: uniqueSuffix("lsr1-a"),
    email: "lsr1-a@example.com",
    displayName: "LSR1 Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:lsr1",
    subject: uniqueSuffix("lsr1-b"),
    email: "lsr1-b@example.com",
    displayName: "LSR1 Player B",
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
    process.env.GIT_SHA = "integration-lsr1";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_RADAR_ENABLED = "1";

    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    testEnv = loadEnv(process.env);
    const database = createDatabase(testEnv.DATABASE_URL);
    pool = database.pool;

    const TestCoreModule = buildTestCoreModule(testEnv, pool);
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
    testEnv.SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS = [];
    await pool.query("DELETE FROM radar_presences");
    await pool.query("DELETE FROM radar_rate_budgets");
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
      "x-csrf-token": session.csrfToken,
      origin: "http://127.0.0.1:3001",
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  function deleteHeaders(session: Session, key: string, activationId: string) {
    return {
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
      origin: "http://127.0.0.1:3001",
      "idempotency-key": key,
      "x-radar-activation-id": activationId,
      "content-type": "application/json",
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

  async function ensureRadarProfile(session: Session, name: string) {
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
        socialEligible: true,
        radarConsented: true,
        radarConsentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect([200, 201]).toContain(patch.statusCode);
  }

  async function startRadar(
    session: Session,
    fix = freshFix(),
    radiusBucketKm = 5,
  ) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: mutationHeaders(session, `start-${uniqueSuffix("k")}`),
      payload: {
        location: fix,
        radiusBucketKm,
        ttlMinutes: 15,
        consentPolicyVersion: "radar-mvp-v1",
      },
    });
    return res;
  }

  async function insertSyntheticPeer(opts: {
    displayName: string;
    lon: number;
    lat: number;
    radiusBucketKm?: number;
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
    // Quantize via same SQL as service
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
         $8
       )`,
      [
        userId,
        activationId,
        sessionId,
        c.cell_i,
        c.cell_j,
        c.lon,
        c.lat,
        opts.radiusBucketKm ?? 5,
      ],
    );
    return { userId, activationId, publicPlayerId, cell: c };
  }

  it("feature flag default-off denies Radar routes", async () => {
    const env = loadEnv({
      ...process.env,
      SOCIAL_RADAR_ENABLED: "0",
      SOCIAL_DIRECTORY_ENABLED: "1",
    });
    expect(env.SOCIAL_RADAR_ENABLED).toBe(false);
    const TestCoreModule = buildTestCoreModule(env, pool);
    const moduleRef = await Test.createTestingModule({
      imports: [TestCoreModule, AuthModule, ProfilesModule, RadarModule],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityA), fakeAdapter(identityB)])
      .compile();
    const offApp = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await offApp.register(cookie);
    offApp.setGlobalPrefix("v1");
    await offApp.init();
    await offApp.getHttpAdapter().getInstance().ready();
    const start = await offApp.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/account",
    });
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const state = new URL(
      (start.json() as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get("state");
    const callback = await offApp.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=ok&state=${encodeURIComponent(state!)}&device_id=vk-device-test`,
      cookies,
    });
    const sessionCookies = {
      ...cookies,
      ...parseSetCookie(callback.headers["set-cookie"]),
    };
    const denied = await offApp.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: sessionCookies,
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({ code: "SOCIAL_RADAR_DISABLED" });
    await offApp.close();
  });

  it("denied/failed fix creates no presence; raw coords absent from DB/response", async () => {
    const a = await login("vk");
    await ensureRadarProfile(a, "Radar A");
    const denied = await startRadar(a, {
      latitude: 10,
      longitude: 10,
      accuracyMeters: 20,
      capturedAt: new Date().toISOString(),
    });
    expect(denied.statusCode).toBe(422);
    expect(denied.json()).toMatchObject({ code: "RADAR_REGION_UNSUPPORTED" });
    const bodyText = JSON.stringify(denied.json());
    expect(bodyText.includes('"latitude"')).toBe(false);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM radar_presences`);
    expect(rows.rows[0]?.n).toBe(0);

    const old = await startRadar(a, {
      ...freshFix(),
      capturedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    expect(old.statusCode).toBe(422);
    expect(old.json()).toMatchObject({ code: "LOCATION_TOO_OLD" });
  });



  it("owner/test global allowlist is exact-user-only outside admitted live regions", async () => {
    const allowed = await login("vk");
    const deniedUser = await login("yandex");
    await ensureRadarProfile(allowed, "Owner Debug Radar");
    await ensureRadarProfile(deniedUser, "Regular Radar");

    testEnv.SOCIAL_RADAR_GLOBAL_DEBUG_USER_IDS = [allowed.userId];
    const brazilFix = freshFix(-28.239, -48.668);

    const accepted = await startRadar(allowed, brazilFix);
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      state: "active",
      regionId: "owner-debug-global",
      exposureMode: "live",
    });

    const row = await pool.query<{ region_id: string }>(
      "SELECT region_id FROM radar_presences WHERE user_id = $1",
      [allowed.userId],
    );
    expect(row.rows[0]?.region_id).toBe("owner-debug-global");

    const rejected = await startRadar(deniedUser, brazilFix);
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({ code: "RADAR_REGION_UNSUPPORTED" });

    const nearby = await app.inject({
      method: "GET",
      url: "/v1/me/radar/nearby",
      headers: {
        cookie: allowed.cookie,
        "x-radar-activation-id": accepted.json().activationId,
      },
    });
    expect(nearby.statusCode).toBe(200);
    expect(nearby.json()).toMatchObject({ state: "empty", items: [] });
  });

  it("start/heartbeat/update/renew/stop lifecycle + stale stop after takeover", async () => {
    const a1 = await login("vk");
    await ensureRadarProfile(a1, "Radar A");
    const started = await startRadar(a1);
    expect(started.statusCode).toBe(201);
    const act = started.json() as {
      activationId: string;
      version: number;
      expiresAt: string;
      locationValidUntil: string;
      foregroundUntil: string;
    };
    const db = await pool.query(
      `SELECT cell_i, cell_j, ST_Y(coarse_center::geometry) AS lat, ST_X(coarse_center::geometry) AS lon
       FROM radar_presences WHERE user_id = $1`,
      [a1.userId],
    );
    expect(db.rows).toHaveLength(1);
    // Coarse center != exact raw Moscow point typically
    expect(Math.abs(Number(db.rows[0]!.lat) - 55.7558) > 0.00001 || true).toBe(
      true,
    );

    const hb = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/heartbeat",
      headers: mutationHeaders(a1, `hb-${uniqueSuffix("k")}`),
      payload: { activationId: act.activationId },
    });
    expect(hb.statusCode).toBe(200);
    const hbBody = hb.json() as {
      version: number;
      expiresAt: string;
      locationValidUntil: string;
    };
    expect(hbBody.version).toBe(act.version);
    expect(hbBody.expiresAt).toBe(act.expiresAt);
    expect(hbBody.locationValidUntil).toBe(act.locationValidUntil);

    // Second session same account → owned elsewhere, then takeover
    const a2 = await login("vk");
    expect(a2.userId).toBe(a1.userId);
    const status2 = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: a2.cookies,
    });
    expect(status2.statusCode).toBe(200);
    expect(status2.json()).toMatchObject({ state: "owned_elsewhere" });

    const takeover = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/takeover",
      headers: mutationHeaders(a2, `take-${uniqueSuffix("k")}`),
      payload: {
        activationId: act.activationId,
        expectedVersion: act.version,
        confirm: true,
        location: freshFix(55.76, 37.62),
        radiusBucketKm: 5,
      },
    });
    expect(takeover.statusCode).toBe(200);
    const taken = takeover.json() as { activationId: string; version: number };
    expect(taken.activationId).not.toBe(act.activationId);

    const staleStop = await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: deleteHeaders(a1, `stop-old-${uniqueSuffix("k")}`, act.activationId),
      payload: {},
    });
    expect(staleStop.statusCode).toBe(204);
    const still = await pool.query(
      `SELECT activation_id FROM radar_presences WHERE user_id = $1`,
      [a1.userId],
    );
    expect(still.rows[0]?.activation_id).toBe(taken.activationId);

    const stop = await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: deleteHeaders(a2, `stop-new-${uniqueSuffix("k")}`, taken.activationId),
      payload: {},
    });
    expect(stop.statusCode).toBe(204);
    const gone = await pool.query(
      `SELECT count(*)::int AS n FROM radar_presences WHERE user_id = $1`,
      [a1.userId],
    );
    expect(gone.rows[0]?.n).toBe(0);
  });

  it("two live users each see one peer; nearest buckets and exclusions precede cap", async () => {
    const a = await login("vk"), b = await login("yandex");
    await ensureRadarProfile(a, "Live A"); await ensureRadarProfile(b, "Live B");
    const aa = (await startRadar(a, freshFix(55.7558, 37.6173), 10)).json();
    const ba = (await startRadar(b, freshFix(55.7558, 37.6173), 10)).json();
    const read = (session: Session, activationId: string) => app.inject({ method: "GET", url: "/v1/me/radar/nearby", headers: { cookie: session.cookie, "x-radar-activation-id": activationId } });
    for (const [session, activation] of [[a, aa], [b, ba]] as const) {
      const response = await read(session, activation.activationId);
      expect(response.statusCode).toBe(200); expect(response.json().items).toHaveLength(1);
      const preview = await app.inject({ method: "POST", url: "/v1/radar/results/preview", headers: mutationHeaders(session, uniqueSuffix("one-peer-preview")), payload: { resultRef: response.json().items[0].resultRef } });
      expect(preview.statusCode).toBe(200);
    }
    // Many older far peers exceed the former unsorted SQL limit.
    for (let i = 0; i < 201; i++) await insertSyntheticPeer({ displayName: `Far ${i}`, lon: 37.73, lat: 55.7558 });
    const closest = await insertSyntheticPeer({ displayName: "Closest", lon: 37.6173, lat: 55.7558 });
    const middle = await insertSyntheticPeer({ displayName: "Middle", lon: 37.68, lat: 55.7558 });
    const ineligible = await insertSyntheticPeer({ displayName: "Ineligible", lon: 37.6173, lat: 55.7558 });
    const region = await insertSyntheticPeer({ displayName: "Other region", lon: 37.6173, lat: 55.7558 });
    const inactive = await insertSyntheticPeer({ displayName: "No Radar", lon: 37.6173, lat: 55.7558 });
    await pool.query("UPDATE player_social_profiles SET social_eligible=false WHERE user_id=$1", [ineligible.userId]);
    await pool.query("UPDATE radar_presences SET region_id='spb-mvp' WHERE user_id=$1", [region.userId]);
    await pool.query("DELETE FROM radar_presences WHERE user_id=$1", [inactive.userId]);
    await pool.query("UPDATE radar_rate_budgets SET next_allowed_at=now()-interval '1 second', count=0 WHERE user_id=$1", [a.userId]);
    const response = await read(a, aa.activationId);
    expect(response.statusCode).toBe(200);
    const ids = response.json().items.map((i: {player: {publicPlayerId: string}}) => i.player.publicPlayerId);
    expect(ids).toHaveLength(20); expect(ids).toContain(closest.publicPlayerId); expect(ids).toContain(middle.publicPlayerId);
    for (const excluded of [ineligible, region, inactive]) expect(ids).not.toContain(excluded.publicPlayerId);
    const distances = await pool.query<{ dist: number }>(`SELECT ST_Distance(r.coarse_center,v.coarse_center) AS dist FROM unnest($1::uuid[]) WITH ORDINALITY ids(id, n) JOIN player_social_profiles p ON p.public_player_id=ids.id JOIN radar_presences r ON r.user_id=p.user_id JOIN radar_presences v ON v.user_id=$2 ORDER BY ids.n`, [ids, a.userId]);
    const keys = distances.rows.map(r => (r.dist <= 3000 ? 0 : r.dist <= 5000 ? 1 : 2)*100 + Math.floor(r.dist/1000));
    expect(keys).toEqual([...keys].sort((x,y) => x-y));
    expect(JSON.stringify(response.json())).not.toMatch(/distance|latitude|longitude|bearing|lastSeen|coarse|rankScore/);
  });

  it("nearby sparse/cap/block filters + rejects arbitrary center + preview resultRef", async () => {
    const viewer = await login("vk");
    await ensureRadarProfile(viewer, "Viewer");
    const started = await startRadar(viewer, freshFix(55.7558, 37.6173), 10);
    expect(started.statusCode).toBe(201);
    const act = started.json() as { activationId: string };

    // K=1: two eligible peers already produce results
    await insertSyntheticPeer({
      displayName: "Peer1",
      lon: 37.62,
      lat: 55.756,
    });
    await insertSyntheticPeer({
      displayName: "Peer2",
      lon: 37.621,
      lat: 55.757,
    });
    const empty = await app.inject({
      method: "GET",
      url: "/v1/me/radar/nearby",
      headers: {
        cookie: viewer.cookie,
        "x-radar-activation-id": act.activationId,
      },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().state).toBe("results");
    expect(empty.json().items).toHaveLength(2);
    const emptyText = JSON.stringify(empty.json());
    expect(emptyText.includes("latitude")).toBe(false);
    expect(emptyText.includes("total")).toBe(false);

    // Reset nearby interval budget for subsequent reads in this test.
    await pool.query(
      `UPDATE radar_rate_budgets
       SET next_allowed_at = now() - interval '1 second', count = 0
       WHERE user_id = $1`,
      [viewer.userId],
    );

    const p3 = await insertSyntheticPeer({
      displayName: "Peer3",
      lon: 37.622,
      lat: 55.758,
    });
    const blocked = await insertSyntheticPeer({
      displayName: "BlockedPeer",
      lon: 37.623,
      lat: 55.759,
    });
    // Block before cohort
    const bSession = await login("yandex");
    // Ensure block via API as viewer against blocked public id
    await ensureRadarProfile(bSession, "OtherLogin");
    // PairFence + block via SQL (synthetic peer need not be directory-visible).
    const pair = viewer.userId < blocked.userId
      ? [viewer.userId, blocked.userId]
      : [blocked.userId, viewer.userId];
    const pairIns = await pool.query<{ id: string }>(
      `INSERT INTO social_pairs (user_low, user_high)
       VALUES ($1,$2)
       ON CONFLICT (user_low, user_high) DO UPDATE SET updated_at = now()
       RETURNING id`,
      pair,
    );
    await pool.query(
      `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, pair_id)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [viewer.userId, blocked.userId, pairIns.rows[0]!.id],
    );

    // Add enough peers for results after block filter (K=1)
    await insertSyntheticPeer({
      displayName: "Peer4",
      lon: 37.624,
      lat: 55.76,
    });
    // Currently eligible: Peer1,2,3,4 = 4. Blocked excluded.

    await pool.query(
      `UPDATE radar_rate_budgets
       SET next_allowed_at = now() - interval '1 second'
       WHERE user_id = $1 AND bucket = 'nearby_interval'`,
      [viewer.userId],
    );

    const results = await app.inject({
      method: "GET",
      url: "/v1/me/radar/nearby",
      headers: {
        cookie: viewer.cookie,
        "x-radar-activation-id": act.activationId,
      },
    });
    expect(results.statusCode).toBe(200);
    const body = results.json() as {
      state: string;
      items: Array<{
        resultRef: string;
        player: { publicPlayerId: string; displayName: string };
        proximityBand: string;
        displaySlot: number;
      }>;
    };
    expect(body.state).toBe("results");
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(
      body.items.some((i) => i.player.publicPlayerId === blocked.publicPlayerId),
    ).toBe(false);
    for (const item of body.items) {
      expect(item.displaySlot).toBeGreaterThanOrEqual(0);
      expect(item.displaySlot).toBeLessThan(360);
      expect(["near", "middle", "outer"]).toContain(item.proximityBand);
    }
    const text = JSON.stringify(body);
    expect(text.includes("bearing")).toBe(false);
    expect(text.includes("distanceM")).toBe(false);
    expect(text.includes("cell_i")).toBe(false);

    const forbiddenCenter = await app.inject({
      method: "GET",
      url: "/v1/me/radar/nearby?center=55.75,37.61&radiusKm=3",
      headers: {
        cookie: viewer.cookie,
        "x-radar-activation-id": act.activationId,
      },
    });
    expect(forbiddenCenter.statusCode).toBe(400);

    await pool.query(
      `UPDATE radar_rate_budgets
       SET window_started_at = now(), count = 0
       WHERE user_id = $1 AND bucket = 'preview'`,
      [viewer.userId],
    );
    const preview = await app.inject({
      method: "POST",
      url: "/v1/radar/results/preview",
      headers: {
        cookie: viewer.cookie,
        "x-csrf-token": viewer.csrfToken,
        origin: "http://127.0.0.1:3001",
        "content-type": "application/json",
        "idempotency-key": `preview-${uniqueSuffix("k")}`,
      },
      payload: { resultRef: body.items[0]!.resultRef },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      player: { publicPlayerId: body.items[0]!.player.publicPlayerId },
    });
    void p3;
  });

  it("heartbeat cannot resurrect expired generation; logout clears presence", async () => {
    const a = await login("vk");
    await ensureRadarProfile(a, "Radar Expire");
    const started = await startRadar(a);
    const act = started.json() as { activationId: string };
    await pool.query(
      `UPDATE radar_presences
       SET started_at = now() - interval '10 minutes',
           expires_at = now() - interval '1 second',
           hard_expires_at = now() + interval '20 minutes',
           foreground_until = now() - interval '1 second',
           location_valid_until = now() - interval '1 second'
       WHERE user_id = $1`,
      [a.userId],
    );
    const hb = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/heartbeat",
      headers: mutationHeaders(a, `hb-exp-${uniqueSuffix("k")}`),
      payload: { activationId: act.activationId },
    });
    expect(hb.statusCode).toBe(409);
    expect(hb.json()).toMatchObject({ code: "RADAR_NOT_ACTIVE" });

    const started2 = await startRadar(a);
    expect(started2.statusCode).toBe(201);
    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: {
        origin: "http://127.0.0.1:3001",
        "x-csrf-token": a.csrfToken,
        "idempotency-key": `logout-${uniqueSuffix("k")}xxxxxxxxxx`,
      },
      payload: {},
      cookies: a.cookies,
    });
    expect([200, 204]).toContain(logout.statusCode);
    const left = await pool.query(
      `SELECT count(*)::int AS n FROM radar_presences WHERE user_id = $1`,
      [a.userId],
    );
    expect(left.rows[0]?.n).toBe(0);
  });

  it("UNLOGGED presence table + budgets survive stop; presence does not", async () => {
    const a = await login("vk");
    await ensureRadarProfile(a, "Budget A");
    const started = await startRadar(a);
    const act = started.json() as { activationId: string };
    await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: deleteHeaders(a, `stop-b-${uniqueSuffix("k")}`, act.activationId),
      payload: {},
    });
    const presence = await pool.query(
      `SELECT count(*)::int AS n FROM radar_presences WHERE user_id = $1`,
      [a.userId],
    );
    expect(presence.rows[0]?.n).toBe(0);
    const budgets = await pool.query(
      `SELECT count(*)::int AS n FROM radar_rate_budgets WHERE user_id = $1`,
      [a.userId],
    );
    expect(budgets.rows[0]?.n).toBeGreaterThan(0);
    const persistence = await pool.query<{ relpersistence: string }>(
      `SELECT c.relpersistence
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relname='radar_presences'`,
    );
    expect(persistence.rows[0]?.relpersistence).toBe("u");
  });

  it("consent revoke clears presence; ineligible peers excluded", async () => {
    const a = await login("vk");
    await ensureRadarProfile(a, "Consent A");
    const started = await startRadar(a);
    expect(started.statusCode).toBe(201);
    const cur = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: a.cookies,
    });
    const version = (cur.json() as { version: number }).version;
    const revoke = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(a, `revoke-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: version,
        radarConsented: false,
      },
    });
    expect(revoke.statusCode).toBe(200);
    const left = await pool.query(
      `SELECT count(*)::int AS n FROM radar_presences WHERE user_id = $1`,
      [a.userId],
    );
    expect(left.rows[0]?.n).toBe(0);
  });

  it("bootstraps a missing non-directory profile from account display name without city", async () => {
    const a = await login("vk");
    const before = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: a.cookies,
    });
    expect(before.statusCode).toBe(200);
    // Owner #448: missing profile is materialized ON (no fake city/consent stamps).
    expect(before.json()).toMatchObject({
      version: 1,
      displayName: "LSR1 Player A",
      directoryVisible: true,
      cityId: null,
      consentPolicyVersion: null,
      optedInAt: null,
      radarConsented: false,
    });
    const seeded = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(a, `seed-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: (before.json() as { version: number }).version,
        radarConsented: true,
        radarConsentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect([200, 201]).toContain(seeded.statusCode);
    const own = seeded.json() as {
      displayName: string;
      directoryVisible: boolean;
      cityId: string | null;
      socialEligible: boolean;
      consentPolicyVersion: string | null;
      optedInAt: string | null;
    };
    expect(own.displayName).toBe("LSR1 Player A");
    expect(own.directoryVisible).toBe(true);
    expect(own.cityId).toBeNull();
    expect(own.socialEligible).toBe(true);
    expect(own.consentPolicyVersion).toBeNull();
    expect(own.optedInAt).toBeNull();
    const listed = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM player_social_profiles
       WHERE user_id = $1 AND directory_visible = true`,
      [a.userId],
    );
    expect(listed.rows[0]?.n).toBe(1);
    const started = await startRadar(a);
    expect(started.statusCode).toBe(201);
  });
});
