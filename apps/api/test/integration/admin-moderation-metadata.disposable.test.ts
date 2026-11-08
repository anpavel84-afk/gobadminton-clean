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

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18990";
const pepper = "moderation-d2-admin-pepper-at-least-32chars!!";

type AdminActor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

run("Admin D2 moderation metadata · disposable", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let superadmin: AdminActor;
  let moderator: AdminActor;
  let support: AdminActor;
  let pilot: AdminActor;
  let content: AdminActor;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "moderation-d2-consumer-pepper-at-least-32",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18991",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:18992",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:18992",
    });
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname)) {
      throw new Error("D2 fixtures require disposable loopback PostgreSQL");
    }
    databaseAdmin = new Pool({ connectionString: sourceUrl.toString() });
    fixtureDatabase = "d2_moderation_meta_" + randomUUID().replaceAll("-", "");
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
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
      COOKIE_SECURE: "false",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "d2-moderation-fingerprint-fixture!!!!!",
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
    superadmin = await adminActor("superadmin");
    moderator = await adminActor("moderator");
    support = await adminActor("support");
    pilot = await adminActor("pilot_viewer");
    content = await adminActor("content_manager");
  }, 180000);

  beforeEach(async () => {
    await pool.query("DELETE FROM admin_rate_windows");
    await pool.query("UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE id=ANY($1::uuid[])", [
      [superadmin.sessionId, moderator.sessionId, support.sessionId, pilot.sessionId, content.sessionId],
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (fixtureDatabase) await databaseAdmin.query("DROP DATABASE " + fixtureDatabase);
    await databaseAdmin?.end();
  });

  async function adminActor(role: AdminRole): Promise<AdminActor> {
    const userId = (
      await pool.query("INSERT INTO users(display_name) VALUES($1) RETURNING id", ["d2-" + role])
    ).rows[0].id as string;
    const id = (
      await pool.query(
        "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
        [userId],
      )
    ).rows[0].id as string;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
      [id, role],
    );
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [credentialId, id, Buffer.from("synthetic-d2-fixture")],
    );
    const sessionId = (
      await pool.query(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [id, credentialId, hashSecret(pepper, token), sealSecret(pepper, csrf)],
      )
    ).rows[0].id as string;
    return { id, userId, token, csrf, sessionId };
  }

  function get(qs = "", a: AdminActor = superadmin) {
    return app.inject({
      method: "GET",
      url: "/v1/admin/audit/moderation" + qs,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin },
    });
  }

  async function seedApproval(surface: string, decision: "allow" | "review", model = "omni-moderation-2024-09-26") {
    const fingerprint = "fp_" + randomUUID().replaceAll("-", "");
    return (
      await pool.query<{ id: string; checked_at: Date }>(
        `INSERT INTO content_moderation_approvals(
           content_type, surface_key, fingerprint_version, content_fingerprint,
           policy_version, local_policy_version, provider_key, provider_model,
           category_flags, decision, checked_at
         ) VALUES (
           'text', $1, 1, $2, 'public-text-v1', 'local-text-v1', 'openai', $3,
           '{}'::jsonb, $4, clock_timestamp()
         ) RETURNING id, checked_at`,
        [surface, fingerprint, model, decision],
      )
    ).rows[0]!;
  }

  it("allows superadmin with fresh step-up; denies other roles and stale step-up", async () => {
    const allowed = await get("?limit=5");
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.headers["cache-control"]).toBe("no-store");
    expect(allowed.json().historyScope).toBe("saved_allow_review_only");
    expect(JSON.stringify(allowed.json())).not.toMatch(
      /content_fingerprint|category_flags|provider_response|base64|avatar_url|body_text|email/,
    );

    for (const actor of [moderator, support, pilot, content]) {
      expect((await get("", actor)).statusCode).toBe(403);
    }

    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1", [
      superadmin.sessionId,
    ]);
    expect((await get()).statusCode).toBe(403);
    await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE id=$1", [superadmin.sessionId]);
  });

  it("returns bounded keyset pages, stable filters, and nested bindings without sensitive columns", async () => {
    const a1 = await seedApproval("comment_body", "allow");
    const a2 = await seedApproval("comment_body", "review", "omni-moderation-fixture");
    const a3 = await seedApproval("venue_description", "allow");
    const entityId = randomUUID();
    await pool.query(
      `INSERT INTO content_moderation_bindings(
         entity_kind, entity_id, surface_key, resource_version, approval_id,
         actor_user_id, binding_kind
       ) VALUES ('entity_comment',$1,'comment_body',1,$2,$3,'publication')`,
      [entityId, a1.id, superadmin.userId],
    );

    const filtered = await get("?surface=comment_body&decision=allow&limit=10");
    expect(filtered.statusCode).toBe(200);
    const body = filtered.json();
    expect(body.items.every((i: { surface: string; decision: string }) => i.surface === "comment_body" && i.decision === "allow")).toBe(true);
    const hit = body.items.find((i: { approvalId: string }) => i.approvalId === a1.id);
    expect(hit?.bindingStatus).toBe("bound");
    expect(hit?.bindings[0]).toMatchObject({
      entityKind: "entity_comment",
      entityId,
      resourceVersion: 1,
      bindingKind: "publication",
    });
    expect(JSON.stringify(body)).not.toContain(a2.id);
    expect(body.items.some((i: { approvalId: string }) => i.approvalId === a3.id)).toBe(false);

    const page1 = await get("?limit=1");
    expect(page1.json().items).toHaveLength(1);
    expect(page1.json().nextBeforeId).toBeTruthy();
    const page2 = await get(
      `?limit=1&beforeCheckedAt=${encodeURIComponent(page1.json().nextBeforeCheckedAt)}&beforeId=${page1.json().nextBeforeId}`,
    );
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items[0]?.approvalId).not.toBe(page1.json().items[0]?.approvalId);

    const modelFilter = await get("?model=omni-moderation-fixture&limit=10");
    expect(modelFilter.json().items.every((i: { providerModel: string }) => i.providerModel === "omni-moderation-fixture")).toBe(true);
    expect(modelFilter.json().items.some((i: { approvalId: string }) => i.approvalId === a2.id)).toBe(true);
  });

  it("does not invent reject history and leaves Cases source permissions unchanged", async () => {
    const before = await get("?limit=50");
    expect(before.json().items.every((i: { decision: string }) => ["allow", "review"].includes(i.decision))).toBe(true);
    // Metadata permission is not raw case source permission — support still cannot open unassigned case queues via this route.
    expect((await get("", support)).statusCode).toBe(403);
    expect((await get("", moderator)).statusCode).toBe(403);
  });
});
