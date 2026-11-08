import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_venue_community_disposable";
  const hosted = url.pathname === "/gobadminton" && process.env.GITHUB_ACTIONS === "true"
    && process.env.GMAP1_DISPOSABLE_DB === "1" && /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "")
    && url.port === process.env.CI_DB_PORT;
  if (process.env.NODE_ENV !== "test" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.search || url.hash || !(dedicated || hosted)) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };

run("#507 I1 venue community ratings — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let actorA: Actor;
  let actorB: Actor;
  let venueId: string;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "venue-community-synthetic",
    });
    const existing = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'",
    );
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await migrate(file);
    }
    // Local Admin simulation required for USER_RESTRICTIONS_INTERNAL_ENABLED (no public rollout).
    const adminOrigin = "http://localhost:19495";
    const adminPepper = "venue-community-synthetic-admin-pepper!!";
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "venue-community-synthetic-pepper!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-community-fingerprint-fixture",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: adminPepper,
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
    });
    const ref = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), VenuesModule, ProfilesModule, SafetyModule],
    }).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);
  }, 120000);

  async function migrate(file: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    actorA = await actor("Rater A");
    actorB = await actor("Rater B");
    const created = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: {
        origin,
        cookie: actorA.cookie,
        "x-csrf-token": actorA.csrfToken,
        "content-type": "application/json",
        "idempotency-key": key(),
      },
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: `Community Hall ${randomUUID()}`,
        address: "Synthetic Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(created.statusCode);
    venueId = created.json().id as string;
  });

  async function actor(name: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, name]);
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, display_name, directory_visible, contact_policy, directory_visibility_provenance, social_eligible, version)
       VALUES ($1, $2, true, 'requests', 'owner_default', true, 1)`,
      [userId, name],
    );
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  function key() {
    return randomUUID();
  }

  async function put(actor: Actor, url: string, body: Record<string, unknown>, idem = key()) {
    return app.inject({
      method: "PUT",
      url,
      headers: {
        origin,
        cookie: actor.cookie,
        "x-csrf-token": actor.csrfToken,
        "content-type": "application/json",
        "idempotency-key": idem,
      },
      payload: body,
    });
  }

  async function del(actor: Actor, url: string, body: Record<string, unknown>, idem = key()) {
    return app.inject({
      method: "DELETE",
      url,
      headers: {
        origin,
        cookie: actor.cookie,
        "x-csrf-token": actor.csrfToken,
        "content-type": "application/json",
        "idempotency-key": idem,
      },
      payload: body,
    });
  }

  it("supports standalone votes, rounding, withdraw, batch, and withheld exclusion", async () => {
    const guestBatch = await app.inject({
      method: "GET",
      url: `/v1/venue-community-summaries?venueIds=${venueId}`,
    });
    expect(guestBatch.statusCode).toBe(200);
    expect(guestBatch.json().items[0]).toMatchObject({
      venueId,
      average: null,
      count: 0,
      state: "empty",
    });

    const a1 = await put(actorA, `/v1/venues/${venueId}/community-rating`, {
      value: 5,
      expectedVersion: 0,
    });
    expect(a1.statusCode).toBe(201);
    expect(a1.json().summary).toMatchObject({ average: 5, count: 1, state: "available" });
    expect(a1.json().own.value).toBe(5);

    const b1 = await put(actorB, `/v1/venues/${venueId}/community-rating`, {
      value: 3,
      expectedVersion: 0,
    });
    expect(b1.statusCode).toBe(201);
    expect(b1.json().summary.average).toBe(4);
    expect(b1.json().summary.count).toBe(2);

    const a2 = await put(actorA, `/v1/venues/${venueId}/community-rating`, {
      value: 4,
      expectedVersion: 1,
    });
    expect(a2.statusCode).toBe(200);
    expect(a2.json().summary.average).toBe(3.5);
    expect(a2.json().summary.count).toBe(2);

    const stale = await put(actorA, `/v1/venues/${venueId}/community-rating`, {
      value: 2,
      expectedVersion: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("RATING_VERSION_CONFLICT");

    const bad = await put(actorA, `/v1/venues/${venueId}/community-rating`, {
      value: 6,
      expectedVersion: 2,
    });
    expect(bad.statusCode).toBe(422);

    const withdraw = await del(actorB, `/v1/venues/${venueId}/community-rating`, {
      expectedVersion: 1,
    });
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json().summary).toMatchObject({ average: 4, count: 1, state: "available" });
    expect(withdraw.json().own.withdrawn).toBe(true);
    expect(withdraw.json().own.value).toBeNull();

    await pool.query(
      `UPDATE venue_community_votes SET moderation_state='withheld'
       WHERE canonical_venue_id=$1 AND user_id=$2 AND merged_into_vote_id IS NULL`,
      [venueId, actorA.userId],
    );
    const afterWithhold = await app.inject({
      method: "GET",
      url: `/v1/venue-community-summaries?venueIds=${venueId}`,
    });
    expect(afterWithhold.json().items[0]).toMatchObject({
      average: null,
      count: 0,
      state: "empty",
    });

    const own = await app.inject({
      method: "GET",
      url: `/v1/venues/${venueId}/community-rating/me`,
      headers: { cookie: actorA.cookie },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().own.moderationState).toBe("withheld");
    expect(own.headers["cache-control"]).toMatch(/no-store/i);

    const guestOwn = await app.inject({
      method: "GET",
      url: `/v1/venues/${venueId}/community-rating/me`,
    });
    expect([401, 403]).toContain(guestOwn.statusCode);
  });
});
