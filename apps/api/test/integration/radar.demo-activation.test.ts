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
import { loadEnv, type AppEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import {
  seedDemoFoundation,
  withDemoTransaction,
} from "../../src/database/demo-seed-ops";
import {
  DEMO_ISSUER_NAMESPACE,
  DEMO_MOSCOW_CITY_ID,
  DEMO_SPB_CITY_ID,
  demoUserId,
} from "../../src/database/demo-ids";
import { GamesModule } from "../../src/games/games.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { DEMO_ALLOWED_RADAR_REGIONS, quantizeFix } from "../../src/radar/coarse-location";
import { orderingEpoch, signResultRef } from "../../src/radar/result-ref";
import { selectEligibleNearbyCandidates } from "../../src/radar/radar-matching";
import { RadarProofService } from "../../src/radar/radar-proof.service";
import { RadarModule } from "../../src/radar/radar.module";
import { RadarDemoService, syntheticDemoFix } from "../../src/radar/radar-demo";
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

type Session = {
  cookies: Record<string, string>;
  csrfToken: string;
  userId: string;
  cookie: string;
};

describeIntegration("Radar demo activation privacy/demo matrix", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let env: AppEnv;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const alexey: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: DEMO_ISSUER_NAMESPACE,
    subject: "demo-person-01",
    email: "demo.person01@synthetic.gobadminton.local",
    displayName: "Alexey Demo",
  };
  const maria: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: DEMO_ISSUER_NAMESPACE,
    subject: "demo-person-02",
    email: "demo.person02@synthetic.gobadminton.local",
    displayName: "Maria Kovaleva",
  };
  const publicUser: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:radar-demo-public",
    subject: uniqueSuffix("public-radar"),
    email: "public.radar@example.com",
    displayName: "Public User",
  };
  /** Yandex adapter identity is switched between publicUser and maria (one key slot). */
  const yandexIdentity: { current: VerifiedIdentity } = { current: publicUser };

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
    process.env.GIT_SHA = "integration-radar-demo";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_RADAR_ENABLED = "0";
    process.env.SOCIAL_RADAR_DEMO_ENABLED = "1";

    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    env = loadEnv(process.env);
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
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([
        fakeAdapter(alexey),
        {
          key: "yandex" as const,
          configured: true,
          async startAuthorization(input: { state: string }) {
            return {
              authorizationUrl: `https://provider.test/authorize?state=${encodeURIComponent(input.state)}`,
            };
          },
          async exchangeCode() {
            return { accessToken: "test-access" };
          },
          async fetchVerifiedIdentity() {
            return { ...yandexIdentity.current };
          },
        },
      ])
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "foundation"),
    );

    const consented = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM player_social_profiles
       WHERE user_id = ANY($1::uuid[]) AND radar_consented = true`,
      [[demoUserId(1), demoUserId(2), demoUserId(11)]],
    );
    expect(consented.rows[0]!.c).toBe(3);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    env.SOCIAL_RADAR_ENABLED = false;
    env.SOCIAL_RADAR_DEMO_ENABLED = true;
    await pool.query("DELETE FROM radar_presences");
    await pool.query("DELETE FROM radar_rate_budgets");
  });

  async function login(
    provider: "vk" | "yandex",
    expectedUserId?: string,
  ): Promise<Session> {
    const start = await app.inject({
      method: "GET",
      url: `/v1/auth/${provider}/start?returnPath=/players/radar`,
    });
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const state = new URL(
      (start.json() as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get("state");
    const callback = await app.inject({
      method: "GET",
      url:
        provider === "vk"
          ? `/v1/auth/vk/callback?code=ok&state=${encodeURIComponent(state!)}&device_id=vk-device-test`
          : `/v1/auth/yandex/callback?code=ok&state=${encodeURIComponent(state!)}`,
      cookies,
    });
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
    if (expectedUserId) expect(meBody.id).toBe(expectedUserId);
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

  it("fail-closes live/public Radar and admits city-scoped synthetic demo for demo identities", async () => {
    yandexIdentity.current = publicUser;
    const deniedPublic = await login("yandex");
    const blocked = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: deniedPublic.cookies,
    });
    expect(blocked.statusCode).toBe(404);
    expect(blocked.json()).toMatchObject({ code: "SOCIAL_RADAR_DISABLED" });

    const demo = await login("vk", demoUserId(1));
    const status = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: demo.cookies,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      state: "off",
      exposureMode: "synthetic_demo",
    });

    const fix = syntheticDemoFix(DEMO_MOSCOW_CITY_ID, 1);
    const started = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: mutationHeaders(demo, `start-${uniqueSuffix("k")}`),
      payload: {
        location: fix,
        radiusBucketKm: 5,
        ttlMinutes: 15,
        consentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect(started.statusCode).toBe(201);
    const body = started.json() as {
      activationId: string;
      exposureMode: string;
      regionId: string;
    };
    expect(body.exposureMode).toBe("synthetic_demo");
    expect(body.regionId).toBe("moscow-mvp");

    const nearby = await app.inject({
      method: "GET",
      url: "/v1/me/radar/nearby",
      cookies: demo.cookies,
      headers: { "x-radar-activation-id": body.activationId },
    });
    expect(nearby.statusCode).toBe(200);
    const nearbyBody = nearby.json() as {
      state: string;
      exposureMode: string;
      items: unknown[];
    };
    expect(nearbyBody.exposureMode).toBe("synthetic_demo");
    expect(nearbyBody.state).toBe("results");
    expect(nearbyBody.items.length).toBeGreaterThanOrEqual(3);

    const regions = await pool.query<{ region_id: string }>(
      `SELECT DISTINCT region_id FROM radar_presences`,
    );
    expect(regions.rows.map((r) => r.region_id)).toEqual(["moscow-mvp"]);

    const stopped = await app.inject({
      method: "DELETE",
      url: "/v1/me/radar/activations/current",
      headers: {
        ...mutationHeaders(demo, `stop-${uniqueSuffix("k")}`),
        "x-radar-activation-id": body.activationId,
      },
      payload: {},
    });
    expect([204, 200]).toContain(stopped.statusCode);

    const abroad = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: mutationHeaders(demo, `bad-${uniqueSuffix("k")}`),
      payload: {
        location: {
          latitude: 48.85,
          longitude: 2.35,
          accuracyMeters: 20,
          capturedAt: new Date().toISOString(),
        },
        consentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect(abroad.statusCode).toBe(422);

    const mismatch = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: mutationHeaders(demo, `spb-${uniqueSuffix("k")}`),
      payload: {
        location: syntheticDemoFix(DEMO_SPB_CITY_ID, 11),
        consentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toMatchObject({ code: "RADAR_DEMO_CITY_MISMATCH" });
  });

  it("both flags isolate cohorts/proofs; rollback denies live proof but permits Stop", async () => {
    env.SOCIAL_RADAR_ENABLED = true;
    yandexIdentity.current = publicUser;
    const live = await login("yandex");
    const demo = await login("vk", demoUserId(1));
    const patch = await app.inject({ method: "PATCH", url: "/v1/me/social-profile",
      headers: mutationHeaders(live, `consent-${uniqueSuffix("k")}`),
      payload: { displayName: "Internal synthetic live-path tester", radarConsented: true, radarConsentPolicyVersion: "radar-mvp-v1" } });
    expect(patch.statusCode).toBeLessThan(300);
    const start = async (session: Session) => {
      const r = await app.inject({ method: "POST", url: "/v1/me/radar/activations",
        headers: mutationHeaders(session, `live-start-${uniqueSuffix("k")}`),
        payload: { location: syntheticDemoFix(DEMO_MOSCOW_CITY_ID, 1), consentPolicyVersion: "radar-mvp-v1" } });
      expect(r.statusCode).toBe(201); return r.json();
    };
    const d = await start(demo), l = await start(live);
    expect(d.exposureMode).toBe("synthetic_demo"); expect(l.exposureMode).toBe("live");
    const read = async (session: Session, activationId: string) => app.inject({ method: "GET", url: "/v1/me/radar/nearby", cookies: session.cookies, headers: { "x-radar-activation-id": activationId } });
    const liveNearby = await read(live, l.activationId);
    expect(liveNearby.statusCode).toBe(200);
    // Many co-located demo presences must not satisfy k=3 for a lone live viewer.
    expect(liveNearby.json()).toMatchObject({ state: "empty", items: [], exposureMode: "live" });
    const demoNearby = await read(demo, d.activationId);
    expect(demoNearby.json().state).toBe("results");
    expect(JSON.stringify(demoNearby.json())).not.toMatch(/latitude|longitude|dist_m|cell_i|lastSeen|bearing/);
    const client = await pool.connect();
    try {
      const liveCandidates = await selectEligibleNearbyCandidates(client, live.userId, new Date());
      const demoCandidates = await selectEligibleNearbyCandidates(client, demo.userId, new Date());
      expect(liveCandidates).toEqual([]);
      expect(demoCandidates.some(r => r.user_id === live.userId)).toBe(false);
      const rows = await pool.query("SELECT user_id, owner_session_id, activation_id, version FROM radar_presences WHERE user_id = ANY($1::uuid[])", [[live.userId, demo.userId]]);
      const viewer = rows.rows.find(r => r.user_id === live.userId)!;
      const target = rows.rows.find(r => r.user_id === demo.userId)!;
      const proof = signResultRef(env.AUTH_PEPPER, { viewerUserId: live.userId, viewerSessionId: viewer.owner_session_id, viewerActivationId: viewer.activation_id, viewerVersion: Number(viewer.version), targetUserId: demo.userId, targetActivationId: target.activation_id, targetVersion: Number(target.version), epoch: orderingEpoch(new Date()), now: new Date() });
      const proofs = app.get(RadarProofService);
      await expect(proofs.redeem(client, { actorId: live.userId, sessionId: viewer.owner_session_id, proof })).rejects.toThrow();
      // All first-contact proof consumers use this hook; even a signed cross-mode proof fails.
      await expect(proofs.assertOptionalDiscoveryProof(client, { actorId: live.userId, sessionId: viewer.owner_session_id, targetUserId: demo.userId, discoveryProof: proof })).rejects.toThrow();
      env.SOCIAL_RADAR_ENABLED = false;
      await expect(proofs.redeem(client, { actorId: live.userId, sessionId: viewer.owner_session_id, proof })).rejects.toThrow();
    } finally { client.release(); }
    const unavailable = await app.inject({ method: "GET", url: "/v1/me/radar/activations/current", cookies: live.cookies });
    expect(unavailable.statusCode).toBe(404);
    const stop = await app.inject({ method: "DELETE", url: "/v1/me/radar/activations/current", headers: { ...mutationHeaders(live, `rollback-stop-${uniqueSuffix("k")}`), "x-radar-activation-id": l.activationId }, payload: {} });
    expect(stop.statusCode).toBe(204);
    expect((await pool.query("SELECT 1 FROM radar_presences WHERE user_id=$1", [live.userId])).rowCount).toBe(0);
  });

  it("quantizes SPB synthetic anchors into spb-mvp without enabling live Moscow-only geo for that city", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const coarse = await quantizeFix(
        client,
        syntheticDemoFix(DEMO_SPB_CITY_ID, 11),
        new Date(),
        DEMO_ALLOWED_RADAR_REGIONS,
      );
      expect(coarse.regionId).toBe("spb-mvp");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("QRDA-F01: cohort refresh cannot steal interactive ownership; two demo users stay concurrent", async () => {
    const person1 = await login("vk", demoUserId(1));
    const start1 = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations",
      headers: mutationHeaders(person1, `p1-start-${uniqueSuffix("k")}`),
      payload: {
        location: syntheticDemoFix(DEMO_MOSCOW_CITY_ID, 1),
        radiusBucketKm: 5,
        ttlMinutes: 15,
        consentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect(start1.statusCode).toBe(201);
    const body1 = start1.json() as {
      activationId: string;
      version: number;
    };

    const before = await pool.query<{
      owner_session_id: string;
      activation_id: string;
      version: number;
      expires_at: Date;
    }>(
      `SELECT owner_session_id, activation_id, version, expires_at
       FROM radar_presences WHERE user_id = $1`,
      [person1.userId],
    );
    expect(before.rows[0]!.activation_id).toBe(body1.activationId);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await new RadarDemoService().ensureCityCohort(
        client,
        demoUserId(2),
        DEMO_MOSCOW_CITY_ID,
        new Date(),
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const afterPeerRefresh = await pool.query<{
      owner_session_id: string;
      activation_id: string;
      version: number;
      expires_at: Date;
    }>(
      `SELECT owner_session_id, activation_id, version, expires_at
       FROM radar_presences WHERE user_id = $1`,
      [person1.userId],
    );
    expect(afterPeerRefresh.rows[0]!.owner_session_id).toBe(
      before.rows[0]!.owner_session_id,
    );
    expect(afterPeerRefresh.rows[0]!.activation_id).toBe(
      before.rows[0]!.activation_id,
    );
    expect(Number(afterPeerRefresh.rows[0]!.version)).toBe(
      Number(before.rows[0]!.version),
    );
    expect(afterPeerRefresh.rows[0]!.expires_at.getTime()).toBe(
      before.rows[0]!.expires_at.getTime(),
    );

    const status1 = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: person1.cookies,
    });
    expect(status1.statusCode).toBe(200);
    expect(status1.json()).toMatchObject({
      state: "active",
      activationId: body1.activationId,
      ownerHere: true,
    });

    yandexIdentity.current = maria;
    const person2 = await login("yandex", demoUserId(2));
    // Person 1's start/nearby already materialised a synthetic fixture for person 2.
    // Interactive concurrency uses deliberate takeover (R1), not silent overwrite.
    const status2Before = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: person2.cookies,
    });
    expect(status2Before.statusCode).toBe(200);
    expect(status2Before.json()).toMatchObject({ state: "owned_elsewhere" });
    const owned = status2Before.json() as {
      activationId: string;
      version: number;
    };
    const start2 = await app.inject({
      method: "POST",
      url: "/v1/me/radar/activations/current/takeover",
      headers: mutationHeaders(person2, `p2-takeover-${uniqueSuffix("k")}`),
      payload: {
        location: syntheticDemoFix(DEMO_MOSCOW_CITY_ID, 2),
        radiusBucketKm: 5,
        ttlMinutes: 15,
        consentPolicyVersion: "radar-mvp-v1",
        activationId: owned.activationId,
        expectedVersion: owned.version,
        confirm: true,
      },
    });
    expect(start2.statusCode).toBe(200);
    const body2 = start2.json() as { activationId: string };
    expect(body2.activationId).not.toBe(owned.activationId);

    const nearby1 = await app.inject({
      method: "GET",
      url: "/v1/me/radar/nearby",
      cookies: person1.cookies,
      headers: { "x-radar-activation-id": body1.activationId },
    });
    expect(nearby1.statusCode).toBe(200);

    const status1AfterNearby = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: person1.cookies,
    });
    const status2AfterNearby = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: person2.cookies,
    });
    expect(status1AfterNearby.json()).toMatchObject({
      state: "active",
      activationId: body1.activationId,
      ownerHere: true,
    });
    expect(status2AfterNearby.json()).toMatchObject({
      state: "active",
      activationId: body2.activationId,
      ownerHere: true,
    });

    const ownership = await pool.query<{
      user_id: string;
      activation_id: string;
    }>(
      `SELECT user_id, activation_id FROM radar_presences
       WHERE user_id = ANY($1::uuid[])`,
      [[demoUserId(1), demoUserId(2)]],
    );
    const byUser = Object.fromEntries(
      ownership.rows.map((r) => [r.user_id, r.activation_id]),
    );
    expect(byUser[demoUserId(1)]).toBe(body1.activationId);
    expect(byUser[demoUserId(2)]).toBe(body2.activationId);
  });
});
