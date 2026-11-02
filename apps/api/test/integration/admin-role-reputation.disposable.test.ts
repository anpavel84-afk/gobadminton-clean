import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { buildTestCoreModule } from "./test-core.module";

/**
 * Bounded admin role-reputation intake checks. Skipped unless RUN_DB_INTEGRATION=1.
 * Never creates live credentials/sessions outside the disposable fixture.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18990";
const pepper = "role-rep-admin-pepper-at-least-32chars!!";
const DEDICATED_DB = "/gobadminton_admin_role_reputation_disposable";

type Actor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

function assertDisposableAdminTarget(url: URL) {
  const dedicated = decodeURIComponent(url.pathname) === DEDICATED_DB;
  const hosted =
    url.pathname === "/gobadminton" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GMAP1_DISPOSABLE_DB === "1" &&
    /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "") &&
    url.port === process.env.CI_DB_PORT;
  if (
    process.env.NODE_ENV !== "test" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !(dedicated || hosted)
  ) {
    throw new Error(
      "Admin role-reputation fixtures require dedicated disposable or hosted CI PostgreSQL contract",
    );
  }
}

run("#394 admin role reputation — disposable", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let moderator: Actor;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "role-rep-admin-consumer-pepper-at-least-32",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18991",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:18992",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:18992",
    });
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    assertDisposableAdminTarget(sourceUrl);
    databaseAdmin = new Pool({ connectionString: sourceUrl.toString() });
    fixtureDatabase = "rr_adm_" + randomUUID().replaceAll("-", "");
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
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (fixtureDatabase) await databaseAdmin.query("DROP DATABASE " + fixtureDatabase);
    await databaseAdmin?.end();
  });

  async function user(name = "RR admin synthetic") {
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
              [credentialId, id, Buffer.from("synthetic-role-rep-fixture")],
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

  it("pending queue shows waiting intake without body; generic resolved case does not approve", async () => {
    const author = await user("author");
    const subject = await user("subject");
    const slotId = randomUUID();
    const handle = randomUUID().replaceAll("-", "");
    await pool.query(
      `INSERT INTO role_review_slots
         (id, author_user_id, subject_user_id, role, public_handle, status, version)
       VALUES ($1,$2,$3,'organization',$4,'submitted',1)`,
      [slotId, author, subject, handle],
    );
    const pendingId = randomUUID();
    const receipt = randomUUID().replaceAll("-", "");
    await pool.query(
      `INSERT INTO role_reputation_pending_intakes
         (id, kind, slot_id, receipt_token, status, submitted_by_user_id, subject_user_id, role, version)
       VALUES ($1,'review_submit',$2,$3,'waiting_intake',$4,$5,'organization',1)`,
      [pendingId, slotId, receipt, author, subject],
    );

    const list = await app.inject({
      method: "GET",
      url: "/v1/admin/role-reputation/pending-intakes",
      cookies: { [ADMIN_COOKIE]: moderator.token },
      headers: { origin },
    });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().items.some((i: { pendingIntakeId: string }) => i.pendingIntakeId === pendingId),
    ).toBe(true);
    expect(list.json().items[0]).not.toHaveProperty("text");
    expect(list.json().items[0].hasAssignee).toBe(false);
    expect(list.json().items[0].caseId).toBeNull();

    const caze = (
      await pool.query<{ id: string }>(
        `INSERT INTO support_cases (created_by, assigned_to, status)
         VALUES ($1,$1,'open') RETURNING id`,
        [moderator.id],
      )
    ).rows[0]!;
    await pool.query(`UPDATE support_cases SET status='resolved', version=2 WHERE id=$1`, [caze.id]);
    const slot = (
      await pool.query<{ status: string }>(`SELECT status FROM role_review_slots WHERE id=$1`, [slotId])
    ).rows[0]!;
    expect(slot.status).toBe("submitted");
  });
});
