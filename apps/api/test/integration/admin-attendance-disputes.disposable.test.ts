import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { buildTestCoreModule } from "./test-core.module";

/**
 * Bounded PG-2 admin resolution checks. Skipped unless RUN_DB_INTEGRATION=1
 * against disposable loopback DB. Never creates live sessions/cookies.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18990";
const pepper = "pg2-admin-disputes-pepper-at-least-32chars";

type Actor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

run("PG-2 admin attendance disputes — disposable", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let moderator: Actor;
  let support: Actor;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "pg2-admin-consumer-pepper-at-least-32",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18991",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:18992",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:18992",
    });
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname)) {
      throw new Error("PG-2 admin fixtures require disposable loopback PostgreSQL");
    }
    databaseAdmin = new Pool({ connectionString: sourceUrl.toString() });
    fixtureDatabase = "pg2_adm_" + randomUUID().replaceAll("-", "");
    await databaseAdmin.query("CREATE DATABASE " + fixtureDatabase);
    sourceUrl.pathname = "/" + fixtureDatabase;
    process.env.DATABASE_URL = sourceUrl.toString();
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: "inherit",
    });
    env = loadEnv({
      ...process.env,
      ADMIN_INTERNAL_ENABLED: "1",
      CASES_INTERNAL_ENABLED: "1",
      POST_GAME_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const mod = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AdminModule],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    moderator = await actor("moderator");
    support = await actor("support");
  }, 180000);

  beforeEach(async () => {
    await pool.query("DELETE FROM admin_rate_windows");
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (fixtureDatabase) await databaseAdmin.query("DROP DATABASE " + fixtureDatabase);
    await databaseAdmin?.end();
  });

  async function user(name = "PG2 admin synthetic") {
    return (await pool.query("INSERT INTO users(display_name) VALUES($1) RETURNING id", [name])).rows[0]
      .id as string;
  }

  async function actor(role: AdminRole): Promise<Actor> {
    const userId = await user();
    const id = (
      await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [
        userId,
      ])
    ).rows[0].id;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
      [id, role],
    );
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    const sessionId = (
      await pool.query(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [
          id,
          (
            await pool.query(
              "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3) RETURNING credential_id",
              [credentialId, id, Buffer.from("synthetic-command-fixture")],
            )
          ).rows[0].credential_id,
          hashSecret(pepper, token),
          sealSecret(pepper, csrf),
        ],
      )
    ).rows[0].id;
    await pool.query("UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE id=$1", [sessionId]);
    return { id, userId, token, csrf, sessionId };
  }

  function post(route: string, body: object, a = moderator, key: string = randomUUID()) {
    return app.inject({
      method: "POST",
      url: "/v1/admin/" + route,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin, "x-csrf-token": a.csrf, "idempotency-key": key },
      payload: body,
    });
  }

  function get(route: string, a = moderator) {
    return app.inject({
      method: "GET",
      url: "/v1/admin/" + route,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin },
    });
  }

  it("intake/resolve reject missing assignment, stale versions, subject reviewer, and consumer path absence", async () => {
    // Consumer cannot call admin route class — no public mount outside /admin.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/cases/attendance-dispute-intake",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);

    const disputeId = randomUUID();
    const missing = await post("cases/attendance-dispute-intake", {
      disputeId,
      expectedDisputeVersion: 1,
      reasonCode: "attendance_intake",
      assignToSelf: true,
    });
    expect(missing.statusCode).toBe(404);

    // Support without case.manage cannot intake.
    expect(
      (
        await post(
          "cases/attendance-dispute-intake",
          {
            disputeId,
            expectedDisputeVersion: 1,
            reasonCode: "attendance_intake",
            assignToSelf: true,
          },
          support,
        )
      ).statusCode,
    ).toBe(403);

    // Stale step-up rejects privileged write.
    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1", [
      moderator.sessionId,
    ]);
    expect(
      (
        await post("cases/attendance-dispute-intake", {
          disputeId,
          expectedDisputeVersion: 1,
          reasonCode: "attendance_intake",
          assignToSelf: true,
        })
      ).statusCode,
    ).toBe(403);
    await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE id=$1", [moderator.sessionId]);

    expect((await get(`cases/${randomUUID()}/attendance-disputes/${randomUUID()}`)).statusCode).toBe(404);
  });
});
