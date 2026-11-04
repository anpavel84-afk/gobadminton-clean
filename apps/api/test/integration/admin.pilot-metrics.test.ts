import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { assertNoPiiKeys } from "../../src/admin/pilot-metrics.policy";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import {
  DEMO_ISSUER_NAMESPACE,
  demoGameId,
  demoUserId,
  demoVenueId,
} from "../../src/database/demo-ids";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18640";
const pepper = "pilot460-synthetic-admin-pepper-32chars!!";

type Actor = {
  id: string;
  userId: string;
  sessionId: string;
  token: string;
  csrf: string;
};

run("Admin pilot metrics isolated aggregates", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let superadmin: Actor;
  let moderator: Actor;
  let support: Actor;
  let content: Actor;
  let cityId: string;
  let otherCityId: string;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "pilot460-consumer-pepper-32chars!!!!",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18641",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:18642",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:18642",
    });
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: "inherit",
    });
    env = loadEnv({
      ...process.env,
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const mod = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AdminModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    superadmin = await actor("superadmin");
    moderator = await actor("moderator");
    support = await actor("support");
    content = await actor("content_manager");
    const cities = (
      await pool.query<{ id: string }>("SELECT id FROM cities ORDER BY name_ru ASC LIMIT 2")
    ).rows;
    cityId = cities[0]!.id;
    otherCityId = cities[1]?.id ?? cities[0]!.id;
  }, 120_000);

  beforeEach(async () => {
    await pool.query("DELETE FROM admin_rate_windows");
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function user(name = "pilot460 synthetic") {
    return (
      await pool.query<{ id: string }>(
        "INSERT INTO users(display_name) VALUES($1) RETURNING id",
        [name],
      )
    ).rows[0]!.id;
  }

  async function actor(role: AdminRole): Promise<Actor> {
    const userId = await user(`pilot460 ${role}`);
    const id = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
        [userId],
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
      [id, role],
    );
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [credentialId, id, Buffer.from("pilot460-fixture")],
    );
    const sessionId = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [id, credentialId, hashSecret(pepper, token), sealSecret(pepper, csrf)],
      )
    ).rows[0]!.id;
    return { id, userId, sessionId, token, csrf };
  }

  async function venue(ownerId: string, city = cityId) {
    return (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
         VALUES($1,'Pilot460 venue','Synthetic','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$2,'verified','pilot460 venue','synthetic')
         RETURNING id`,
        [city, ownerId],
      )
    ).rows[0]!.id;
  }

  async function game(input: {
    ownerId: string;
    venueId: string;
    startsAt: Date;
    status?: string;
    id?: string;
  }) {
    const ends = new Date(input.startsAt.getTime() + 3_600_000);
    const status = input.status ?? "published";
    return (
      await pool.query<{ id: string }>(
        `INSERT INTO games(
           id, venue_id, title, status, visibility, starts_at, ends_at, timezone,
           application_deadline_at, capacity, external_reserved_count, format_key,
           level_scale_id, level_scale_version, allowed_level_ids, settlement_mode,
           settlement_purpose, settlement_terms, version, created_by_user_id, published_at,
           host_display_name, host_public_contact, activity_kind
         ) VALUES (
           COALESCE($1::uuid, gen_random_uuid()), $2, 'Pilot460 game', $3, 'public', $4, $5, 'Europe/Moscow',
           $4::timestamptz - interval '1 day', 8, 0, 'doubles',
           'test', 1, '["test"]'::jsonb, 'external',
           'no_trainer_fee', 'Synthetic terms', 1, $6,
           CASE WHEN $3 IN ('published','completed','cancelled') THEN $4::timestamptz - interval '2 days' ELSE NULL END,
           'Host', 'contact-synthetic', 'regular'
         ) RETURNING id`,
        [
          input.id ?? null,
          input.venueId,
          status,
          input.startsAt.toISOString(),
          ends.toISOString(),
          input.ownerId,
        ],
      )
    ).rows[0]!.id;
  }

  async function applyAttempt(input: {
    gameId: string;
    userId: string;
    attempt?: number;
    via?: "fresh" | "reapply";
  }) {
    const attempt = input.attempt ?? 1;
    if (input.via === "reapply") {
      const row = (
        await pool.query<{ id: string; version: number }>(
          `UPDATE participations
           SET status='pending', attempt_number=attempt_number+1, version=version+1,
               requested_at=now(), confirmed_at=NULL, updated_at=now()
           WHERE game_id=$1 AND user_id=$2
           RETURNING id, version`,
          [input.gameId, input.userId],
        )
      ).rows[0]!;
      await pool.query(
        `INSERT INTO participation_transitions
           (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version)
         VALUES ($1,'withdrawn','pending',$2,'reapplied',$3,1)`,
        [row.id, input.userId, row.version],
      );
      return row;
    }
    const row = (
      await pool.query<{ id: string; version: number }>(
        `INSERT INTO participations (game_id, user_id, status, attempt_number, version, requested_at)
         VALUES ($1,$2,'pending',$3,1,now())
         RETURNING id, version`,
        [input.gameId, input.userId, attempt],
      )
    ).rows[0]!;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version)
       VALUES ($1,NULL,'pending',$2,'requested',1,1)`,
      [row.id, input.userId],
    );
    return row;
  }

  async function confirm(participationId: string, userId: string, fromVersion: number) {
    const row = (
      await pool.query<{ id: string; version: number }>(
        `UPDATE participations
         SET status='confirmed', version=version+1, confirmed_at=now(), updated_at=now()
         WHERE id=$1 RETURNING id, version`,
        [participationId],
      )
    ).rows[0]!;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version)
       VALUES ($1,'pending','confirmed',$2,'confirmed',$3,1)`,
      [participationId, userId, row.version],
    );
    // Duplicate transition insert would be a bug; retries of same command do not rewrite transitions.
    return row;
  }

  async function withdraw(participationId: string, userId: string) {
    const row = (
      await pool.query<{ version: number }>(
        `UPDATE participations
         SET status='withdrawn', version=version+1, updated_at=now()
         WHERE id=$1 RETURNING version`,
        [participationId],
      )
    ).rows[0]!;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code, aggregate_version, game_version)
       VALUES ($1,'confirmed','withdrawn',$2,'withdrawn',$3,1)`,
      [participationId, userId, row.version],
    );
  }

  async function outcome(gameId: string, value: "held" | "not_held", actor: string) {
    const existing = (
      await pool.query<{ version: number; value: string; reason: string | null }>(
        `SELECT version, value, reason FROM game_outcomes WHERE game_id=$1`,
        [gameId],
      )
    ).rows[0];
    const reason = value === "not_held" ? "weather" : existing ? "late_correction" : null;
    if (!existing) {
      await pool.query(
        `INSERT INTO game_outcomes(game_id, value, version, reason, source, actor_user_id)
         VALUES ($1,$2,1,$3,'manager_explicit',$4)`,
        [gameId, value, reason, actor],
      );
      await pool.query(
        `INSERT INTO game_outcome_revisions
           (game_id, resource_version, actor_user_id, source, before_value, after_value, before_reason, after_reason, reason)
         VALUES ($1,1,$2,'manager_explicit',NULL,$3,NULL,$4,$5)`,
        [gameId, actor, value, reason, reason],
      );
      return;
    }
    const next = existing.version + 1;
    await pool.query(
      `UPDATE game_outcomes
       SET value=$2, version=$3, reason=$4, actor_user_id=$5, updated_at=clock_timestamp()
       WHERE game_id=$1`,
      [gameId, value, next, reason, actor],
    );
    await pool.query(
      `INSERT INTO game_outcome_revisions
         (game_id, resource_version, actor_user_id, source, before_value, after_value, before_reason, after_reason, reason)
       VALUES ($1,$2,$3,'manager_explicit',$4,$5,$6,$7,$8)`,
      [gameId, next, actor, existing.value, value, existing.reason, reason, "late_correction"],
    );
  }

  async function attendance(input: {
    participationId: string;
    gameId: string;
    userId: string;
    value: "present" | "absent";
    actor: string;
  }) {
    await pool.query(
      `INSERT INTO game_attendance(participation_id, game_id, user_id, value, version, late, source, actor_user_id)
       VALUES ($1,$2,$3,$4,1,false,'manager_explicit',$5)`,
      [input.participationId, input.gameId, input.userId, input.value, input.actor],
    );
  }

  function get(qs: string, a: Actor = superadmin) {
    return app.inject({
      method: "GET",
      url: "/v1/admin/pilot-metrics?" + qs,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin },
    });
  }

  it("denies anonymous, consumer cookie, and non-superadmin roles", async () => {
    const qs = `cityId=${cityId}`;
    expect((await app.inject({ method: "GET", url: "/v1/admin/pilot-metrics?" + qs, headers: { origin } })).statusCode).toBe(401);
    const consumer = await user();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/pilot-metrics?" + qs,
          cookies: { [SESSION_COOKIE]: "not-an-admin" },
          headers: { origin },
        })
      ).statusCode,
    ).toBe(401);
    void consumer;
    for (const a of [moderator, support, content]) {
      expect((await get(qs, a)).statusCode).toBe(403);
    }
  });

  it("aggregates attempts, retries, withdraw→reapply, outcomes, attendance, demo exclusion, boundaries", async () => {
    const owner = await user("pilot460 owner");
    const player = await user("pilot460 player");
    const player2 = await user("pilot460 player2");
    const venueId = await venue(owner);
    const from = new Date("2026-10-01T00:00:00.000Z");
    const to = new Date("2026-11-01T00:00:00.000Z");
    const inWindow = new Date("2026-10-15T12:00:00.000Z");
    const inWindow2 = new Date("2026-10-20T12:00:00.000Z");
    const outside = new Date("2026-09-01T12:00:00.000Z");

    const g1 = await game({ ownerId: owner, venueId, startsAt: inWindow });
    const g2 = await game({ ownerId: owner, venueId, startsAt: inWindow2 });
    const gOutside = await game({ ownerId: owner, venueId, startsAt: outside });
    const gCancelled = await game({
      ownerId: owner,
      venueId,
      startsAt: new Date("2026-10-18T12:00:00.000Z"),
      status: "cancelled",
    });
    await pool.query("UPDATE games SET cancelled_at=now() WHERE id=$1", [gCancelled]);
    const gDraft = await game({
      ownerId: owner,
      venueId,
      startsAt: new Date("2026-10-19T12:00:00.000Z"),
      status: "draft",
    });

    // Real funnel: request → confirm → withdraw → new attempt → confirm
    const a1 = await applyAttempt({ gameId: g1, userId: player });
    await confirm(a1.id, owner, a1.version);
    await withdraw(a1.id, player);
    const a1b = await applyAttempt({ gameId: g1, userId: player, via: "reapply" });
    await confirm(a1b.id, owner, a1b.version);
    // Duplicate outbox/retry must not insert another transition — already one confirm row per action.

    const a2 = await applyAttempt({ gameId: g2, userId: player });
    await confirm(a2.id, owner, a2.version);
    const a3 = await applyAttempt({ gameId: g2, userId: player2 });
    await confirm(a3.id, owner, a3.version);

    await outcome(g1, "held", owner);
    await outcome(g2, "held", owner);
    // Late correction: g2 was held; correct to not_held then back — current facts win.
    await outcome(g2, "not_held", owner);
    await outcome(g2, "held", owner);

    await attendance({
      participationId: a1b.id,
      gameId: g1,
      userId: player,
      value: "present",
      actor: owner,
    });
    await attendance({
      participationId: a2.id,
      gameId: g2,
      userId: player,
      value: "present",
      actor: owner,
    });
    await attendance({
      participationId: a3.id,
      gameId: g2,
      userId: player2,
      value: "absent",
      actor: owner,
    });

    // Outside window participation must not inflate.
    const outPart = await applyAttempt({ gameId: gOutside, userId: player });
    await confirm(outPart.id, owner, outPart.version);

    // Demo namespace exclusion
    const demoOwner = demoUserId(1);
    await pool.query(
      `INSERT INTO users(id, display_name) VALUES ($1,'demo')
       ON CONFLICT (id) DO NOTHING`,
      [demoOwner],
    );
    await pool.query(
      `INSERT INTO external_identities(user_id,provider_key,issuer_namespace,subject)
       SELECT $1,'vk',$2,$3
       WHERE NOT EXISTS (
         SELECT 1 FROM external_identities WHERE issuer_namespace=$2 AND subject=$3
       )`,
      [demoOwner, DEMO_ISSUER_NAMESPACE, "demo-subject-pilot460"],
    );
    const demoVenue = demoVenueId(99);
    await pool.query(
      `INSERT INTO venues(id,city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
       VALUES ($1,$2,'Demo venue','x','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$3,'verified','demo venue','x')
       ON CONFLICT (id) DO NOTHING`,
      [demoVenue, cityId, demoOwner],
    );
    const demoGame = demoGameId(99);
    await game({
      ownerId: demoOwner,
      venueId: demoVenue,
      startsAt: inWindow,
      id: demoGame,
    });

    // Other city boundary
    if (otherCityId !== cityId) {
      const otherVenue = await venue(owner, otherCityId);
      await game({ ownerId: owner, venueId: otherVenue, startsAt: inWindow });
    }

    // Join multiplicity: extra managers must not multiply organizer counts
    await pool.query(
      `INSERT INTO game_managers(game_id,user_id,role,status)
       VALUES ($1,$2,'owner','active')
       ON CONFLICT (game_id,user_id) DO UPDATE SET status='active', role='owner'`,
      [g1, owner],
    );
    await pool.query(
      `INSERT INTO game_managers(game_id,user_id,role,status)
       VALUES ($1,$2,'manager','active')
       ON CONFLICT (game_id,user_id) DO UPDATE SET status='active', role='manager'`,
      [g1, player],
    );

    const res = await get(
      `cityId=${cityId}&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(assertNoPiiKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/@|phone|\+7|contact-synthetic/i);
    expect(body.city.id).toBe(cityId);
    expect(body.applications.count).toBeGreaterThanOrEqual(4); // 2 apps on g1 (fresh+reapply) + 2 on g2
    expect(body.applications.confirmations).toBeGreaterThanOrEqual(4); // confirm, confirm after reapply, two on g2
    expect(body.applications.confirmationRate).not.toBeNull();
    expect(body.games.held).toBeGreaterThanOrEqual(2);
    expect(body.games.heldRate).toBe(1);
    expect(body.games.cancelledDisclosed).toBeGreaterThanOrEqual(1);
    expect(body.games.draftExcluded).toBeGreaterThanOrEqual(1);
    expect(body.games.demoExcluded).toBeGreaterThanOrEqual(1);
    expect(body.attendance.present).toBeGreaterThanOrEqual(2);
    expect(body.attendance.absent).toBeGreaterThanOrEqual(1);
    expect(body.repeatAttendance.usersWithRepeatPresent).toBeGreaterThanOrEqual(1);
    expect(body.organizers.withEligiblePublishedGames).toBeGreaterThanOrEqual(1);
    expect(body.organizers.withRepeatEligibleGames).toBeGreaterThanOrEqual(1);
    expect(body.cities.length).toBeGreaterThan(0);
    expect(body.formulas.applications).toMatch(/попыт/i);
    void gDraft;
  });

  it("returns null rates and insufficient coverage for empty window", async () => {
    const res = await get(
      `cityId=${cityId}&from=${encodeURIComponent("2020-01-01T00:00:00.000Z")}&to=${encodeURIComponent("2020-01-02T00:00:00.000Z")}`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.games.dueInWindow).toBe(0);
    expect(body.applications.confirmationRate).toBeNull();
    expect(body.games.heldRate).toBeNull();
    expect(body.coverage.sufficient).toBe(false);
  });

  it("validates city and rejects unknown city", async () => {
    expect((await get("cityId=not-a-uuid")).statusCode).toBe(400);
    expect((await get(`cityId=${randomUUID()}`)).statusCode).toBe(404);
  });
});
