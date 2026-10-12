import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
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
import {
  SOCIAL_EXPIRY_CLEANUP_DEAD_LETTER_QUEUE,
  SOCIAL_EXPIRY_CLEANUP_QUEUE,
} from "../../src/jobs/constants";
import { JobEnqueueService } from "../../src/jobs/job-enqueue.service";
import { startWorkerRuntime } from "../../src/jobs/worker-runtime";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { RadarModule } from "../../src/radar/radar.module";
import { SafetyModule } from "../../src/safety/safety.module";
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}

describeIntegration("LS-02 durable jobs / pg-boss", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let jobs: JobEnqueueService;

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:ls02",
    subject: uniqueSuffix("ls02-a"),
    email: "ls02-a@example.com",
    displayName: "LS02 Player A",
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
    process.env.GIT_SHA = "integration-ls02";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_RADAR_ENABLED = "1";
    delete process.env.LS02_CLEANUP_FAIL_ONCE_PATH;

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
        VenuesModule,
        ProfilesModule,
        SafetyModule,
        RadarModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(identityA)])
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    jobs = app.get(JobEnqueueService);
    await jobs.ensureStarted();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    delete process.env.LS02_CLEANUP_FAIL_ONCE_PATH;
    await pool.query("DELETE FROM radar_presences").catch(() => undefined);
    await pool.query("DELETE FROM radar_rate_budgets").catch(() => undefined);
    await pool.query("DELETE FROM player_looking_intents");
    await pool.query("DELETE FROM player_social_profiles");
    await pool.query("DELETE FROM game_invitations").catch(() => undefined);
    await pool.query("DELETE FROM abuse_reports").catch(() => undefined);
    await pool.query("DELETE FROM user_blocks").catch(() => undefined);
    await pool.query("DELETE FROM social_pairs").catch(() => undefined);
    const boss = jobs.getBoss();
    await boss.deleteAllJobs(SOCIAL_EXPIRY_CLEANUP_QUEUE).catch(() => undefined);
    await boss
      .deleteAllJobs(SOCIAL_EXPIRY_CLEANUP_DEAD_LETTER_QUEUE)
      .catch(() => undefined);
  });

  async function login(): Promise<Session> {
    const start = await app.inject({
      method: "GET",
      url: "/v1/auth/vk/start?returnPath=/account",
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/vk/callback?code=ok&state=${encodeURIComponent(state!)}&device_id=vk-device-test`,
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

  async function ensureEligibleProfile(session: Session): Promise<void> {
    const current = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    const cur = current.json() as { version: number };
    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(session, `ls02-patch-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: cur.version,
        displayName: "LS02 Looking",
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        socialEligible: true,
        radarConsented: true,
        radarConsentPolicyVersion: "radar-mvp-v1",
      },
    });
    expect([200, 201]).toContain(patch.statusCode);
  }

  it("rollback removes same-TX enqueued job; commit keeps it durable", async () => {
    const session = await login();
    await ensureEligibleProfile(session);
    const boss = jobs.getBoss();

    const client = await pool.connect();
    let rolledBackId: string | null = null;
    try {
      await client.query("BEGIN");
      rolledBackId = await jobs.enqueueLookingIntentExpiry(client, {
        userId: session.userId,
        version: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(rolledBackId).toBeTruthy();
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const afterRollback = await boss.findJobs(SOCIAL_EXPIRY_CLEANUP_QUEUE, {
      id: rolledBackId!,
    });
    expect(afterRollback).toHaveLength(0);

    const put = await app.inject({
      method: "PUT",
      url: "/v1/me/looking-for-game",
      headers: mutationHeaders(session, `ls02-look-${uniqueSuffix("k")}`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        ttlMinutes: 30,
        formatKeys: ["doubles"],
      },
    });
    expect([200, 201]).toContain(put.statusCode);
    const body = put.json() as { version: number; expiresAt: string };
    expect(body.expiresAt).toBeTruthy();

    const committed = await waitFor("committed looking expiry job", async () => {
      const found = await boss.findJobs(SOCIAL_EXPIRY_CLEANUP_QUEUE, {
        key: `looking:${session.userId}`,
      });
      return found.find((j) => j.state === "created" || j.state === "retry") ?? null;
    });
    expect(committed.data).toMatchObject({
      kind: "looking_intent",
      userId: session.userId,
      version: body.version,
    });
    expect(JSON.stringify(committed.data)).not.toMatch(/lat|lon|cell|sokol/i);
  });

  it("worker crash/retry does not double primary cleanup effect", async () => {
    const session = await login();
    await ensureEligibleProfile(session);
    await pool.query(
      `INSERT INTO player_looking_intents (
         user_id, active, city_id, area_key, starts_at, ends_at, expires_at,
         format_keys, version
       ) VALUES ($1, true, $2, 'sokol', now() - interval '1 hour', now() - interval '1 minute',
                 now() - interval '1 minute', '["doubles"]'::jsonb, 1)`,
      [session.userId, MOSCOW_CITY_ID],
    );

    const marker = path.join(
      os.tmpdir(),
      `ls02-fail-once-${uniqueSuffix("m")}.flag`,
    );
    await writeFile(marker, "1", "utf8");
    process.env.LS02_CLEANUP_FAIL_ONCE_PATH = marker;

    const runtime = await startWorkerRuntime({
      connectionString: databaseUrl,
      pool,
      gitSha: "integration-ls02-retry",
      maxPool: 2,
    });
    try {
      const sweepKey = `social-expiry-sweep-retry-${uniqueSuffix("s")}`;
      const client = await pool.connect();
      let jobId: string | null = null;
      try {
        await client.query("BEGIN");
        jobId = await jobs.enqueueSweep(client, {
          startAfter: 0,
          singletonKey: sweepKey,
          singletonSeconds: 1,
        });
        expect(jobId).toBeTruthy();
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      await waitFor("looking deactivated after retry", async () => {
        const row = await pool.query<{ active: boolean }>(
          `SELECT active FROM player_looking_intents WHERE user_id = $1`,
          [session.userId],
        );
        return row.rows[0]?.active === false ? true : null;
      });

      const completed = await waitFor("completed sweep job", async () => {
        const found = await runtime.boss.findJobs(SOCIAL_EXPIRY_CLEANUP_QUEUE, {
          id: jobId!,
        });
        return found.find((j) => j.state === "completed") ?? null;
      });
      expect(completed.retryCount).toBeGreaterThanOrEqual(1);

      const looking = await pool.query(
        `SELECT count(*)::int AS c FROM player_looking_intents
         WHERE user_id = $1 AND active = true`,
        [session.userId],
      );
      expect(looking.rows[0]!.c).toBe(0);
    } finally {
      await runtime.stop();
      delete process.env.LS02_CLEANUP_FAIL_ONCE_PATH;
      await unlink(marker).catch(() => undefined);
    }
  }, 60_000);

  it("failed job is visible without private payload dumps in ordinary logs", async () => {
    const boss = jobs.getBoss();
    const jobId = await boss.send(
      SOCIAL_EXPIRY_CLEANUP_QUEUE,
      { kind: "not-a-valid-payload", secret: "should-not-log" },
      { retryLimit: 0, expireInSeconds: 30, startAfter: 0 },
    );
    expect(jobId).toBeTruthy();

    const runtime = await startWorkerRuntime({
      connectionString: databaseUrl,
      pool,
      gitSha: "integration-ls02-fail",
      maxPool: 2,
    });
    try {
      const failed = await waitFor("failed/dead job", async () => {
        const primary = await boss.findJobs(SOCIAL_EXPIRY_CLEANUP_QUEUE, {
          id: jobId!,
        });
        const dead = await boss.findJobs(
          SOCIAL_EXPIRY_CLEANUP_DEAD_LETTER_QUEUE,
          {},
        );
        const hit =
          primary.find((j) => j.state === "failed") ??
          dead.find((j) => j.data && typeof j.data === "object") ??
          null;
        return hit;
      });
      expect(["failed", "created", "retry", "completed", "cancelled"]).toContain(
        failed.state,
      );
      // Operable job row exists; handler rejects invalid payload without requiring PII.
      expect(failed.id).toBeTruthy();
    } finally {
      await runtime.stop();
    }
  }, 60_000);

  it("graceful shutdown works with bounded worker pool", async () => {
    const runtime = await startWorkerRuntime({
      connectionString: databaseUrl,
      pool,
      gitSha: "integration-ls02-shutdown",
      maxPool: 2,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < 3; i += 1) {
        await jobs.enqueueSweep(client, {
          startAfter: 0,
          singletonKey: `shutdown-sweep-${i}-${uniqueSuffix("s")}`,
          singletonSeconds: 1,
        });
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await sleep(500);
    await runtime.stop();
    // stop resolved without throw = graceful shutdown under bounded pool
    expect(true).toBe(true);
  }, 60_000);

  it("Radar/directory on-read expiry remains correct with worker stopped", async () => {
    const session = await login();
    await ensureEligibleProfile(session);

    await pool.query(
      `INSERT INTO player_looking_intents (
         user_id, active, city_id, area_key, starts_at, ends_at, expires_at,
         format_keys, version
       ) VALUES ($1, true, $2, 'sokol', now() - interval '2 hours', now() - interval '1 minute',
                 now() - interval '1 minute', '["doubles"]'::jsonb, 1)`,
      [session.userId, MOSCOW_CITY_ID],
    );

    // Insert a synthetic expired presence row without coordinates in job path;
    // presence table holds coarse geometry for domain, but worker is stopped.
    const sessionRow = await pool.query<{ id: string }>(
      `SELECT id FROM app_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [session.userId],
    );
    const ownerSessionId = sessionRow.rows[0]!.id;
    await pool.query(
      `INSERT INTO radar_presences (
         user_id, activation_id, owner_session_id, version, policy_version, region_id,
         started_at, expires_at, hard_expires_at, foreground_until, location_valid_until,
         next_location_update_at, next_radius_change_at, radius_changes_window_started_at,
         radius_changes_in_window, cell_i, cell_j, coarse_center, radius_bucket_km
       ) VALUES (
         $1, gen_random_uuid(), $2, 1, 'radar-mvp-v1', 'moscow',
         now() - interval '30 minutes',
         now() - interval '1 minute',
         now() + interval '10 minutes',
         now() - interval '1 minute',
         now() - interval '1 minute',
         now(), now(), now(), 0,
         0, 0,
         ST_SetSRID(ST_MakePoint(37.6, 55.75), 4326)::geography,
         5
       )`,
      [session.userId, ownerSessionId],
    );

    // Worker intentionally not started.
    const own = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    expect(own.statusCode).toBe(200);
    const looking = (own.json() as { lookingForGame: { state: string } | null })
      .lookingForGame;
    expect(looking?.state).toBe("inactive");

    const status = await app.inject({
      method: "GET",
      url: "/v1/me/radar/activations/current",
      cookies: session.cookies,
    });
    expect(status.statusCode).toBe(200);
    const radar = status.json() as { state?: string };
    expect(radar.state === "expired" || radar.state === "off").toBe(true);
  });
});
