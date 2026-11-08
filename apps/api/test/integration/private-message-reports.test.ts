/**
 * #506 MOD-V2-C2 — focused synthetic HTTP coverage for exact-message reports + Cases source.
 * Skips when RUN_DB_INTEGRATION≠1. No live provider egress / private body logs.
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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { uniqueSuffix } from "./unique";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import { GameChatModule } from "../../src/game-chat/game-chat.module";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { TrainersModule } from "../../src/trainers/trainers.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const adminOrigin = "http://localhost:18980";
const webOrigin = "http://127.0.0.1:3001";
const adminPepper = "c2-message-report-admin-pepper-at-least-32";

function parseSetCookie(header: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const out: Record<string, string> = {};
  for (const item of values) {
    const pair = item.split(";")[0] ?? "";
    const idx = pair.indexOf("=");
    if (idx > 0) out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
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

type AdminActor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

describeIntegration("MOD-V2-C2 private message reports", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];
  let fetchSpy: { mock: { calls: unknown[] }; mockRestore: () => void } | undefined;

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:c2",
    subject: uniqueSuffix("c2-a"),
    email: "c2-a@example.com",
    displayName: "C2 Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:c2",
    subject: uniqueSuffix("c2-b"),
    email: "c2-b@example.com",
    displayName: "C2 Player B",
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_ENV = "local";
    process.env.DATABASE_URL = databaseUrl;
    process.env.PUBLIC_API_ORIGIN = "http://127.0.0.1:3000";
    process.env.PUBLIC_WEB_ORIGIN = webOrigin;
    process.env.ALLOWED_WEB_ORIGINS = webOrigin;
    process.env.AUTH_PEPPER = "integration-c2-auth-pepper-32chars!!";
    process.env.COOKIE_SECURE = "false";
    process.env.VK_CLIENT_ID = "vk-test";
    process.env.VK_CLIENT_SECRET = "vk-secret";
    process.env.VK_REDIRECT_URI = "http://127.0.0.1:3000/v1/auth/vk/callback";
    process.env.YANDEX_CLIENT_ID = "ya-test";
    process.env.YANDEX_CLIENT_SECRET = "ya-secret";
    process.env.YANDEX_REDIRECT_URI =
      "http://127.0.0.1:3000/v1/auth/yandex/callback";
    process.env.GIT_SHA = "integration-c2-message-reports";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_DM_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";
    process.env.SOCIAL_DM_REQUEST_TTL_SECONDS = "604800";
    process.env.SOCIAL_DM_MESSAGE_RETENTION_SECONDS = "86400";
    process.env.ADMIN_INTERNAL_ENABLED = "1";
    process.env.CASES_INTERNAL_ENABLED = "1";
    process.env.ADMIN_ORIGIN = adminOrigin;
    process.env.ADMIN_AUTH_PEPPER = adminPepper;
    process.env.CONTENT_MODERATION_FINGERPRINT_SECRET =
      "c2-message-report-fingerprint-secret-32";

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
        AdminModule,
        OrganizersModule,
        VenuesModule,
        TrainersModule,
        GamesModule,
        ParticipationsModule,
        ProfilesModule,
        SafetyModule,
        MessagingModule,
        GameChatModule,
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
    fetchSpy?.mockRestore();
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    fetchSpy?.mockRestore();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    await pool.query("DELETE FROM message_report_bindings").catch(() => undefined);
    await pool.query("DELETE FROM support_case_actions").catch(() => undefined);
    await pool.query("DELETE FROM support_case_links").catch(() => undefined);
    await pool.query("DELETE FROM support_cases").catch(() => undefined);
    await pool.query("DELETE FROM abuse_reports");
    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
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
    return {
      cookies: sessionCookies,
      csrfToken: (me.json() as { csrfToken: string }).csrfToken,
      userId: (me.json() as { id: string }).id,
      cookie: cookieHeader(sessionCookies),
    };
  }

  function mutationHeaders(session: Session, key: string) {
    return {
      cookie: session.cookie,
      origin: webOrigin,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  async function ensureProfile(session: Session, name: string): Promise<{ publicPlayerId: string }> {
    const current = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    expect(current.statusCode).toBe(200);
    const cur = current.json() as { version: number };
    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(session, randomUUID()),
      payload: {
        expectedVersion: cur.version,
        displayName: name,
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        bio: "C2 report",
        contactPolicy: "requests",
        socialEligible: true,
      },
    });
    expect([200, 201], patch.body).toContain(patch.statusCode);
    let body = patch.json() as {
      publicPlayerId: string;
      version: number;
      directoryVisible: boolean;
    };
    if (!body.directoryVisible) {
      const vis = await app.inject({
        method: "PUT",
        url: "/v1/me/social-profile/visibility",
        headers: mutationHeaders(session, randomUUID()),
        payload: {
          directoryVisible: true,
          consentPolicyVersion: "directory-mvp-v1",
          expectedVersion: body.version,
        },
      });
      expect(vis.statusCode).toBe(200);
      body = vis.json() as typeof body;
    }
    return { publicPlayerId: body.publicPlayerId };
  }

  async function adminActor(role: AdminRole): Promise<AdminActor> {
    const userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users(display_name) VALUES($1) RETURNING id`,
        [`admin-${role}-${uniqueSuffix("u")}`],
      )
    ).rows[0]!.id;
    const principalId = (
      await pool.query<{ id: string }>(
        `INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id`,
        [userId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')`,
      [principalId, role],
    );
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      `INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)`,
      [credentialId, principalId, Buffer.from("synthetic-c2-fixture")],
    );
    const sessionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext,step_up_at)
         VALUES($1,$2,$3,$4,now()) RETURNING id`,
        [principalId, credentialId, hashSecret(adminPepper, token), sealSecret(adminPepper, csrf)],
      )
    ).rows[0]!.id;
    return { id: principalId, userId, token, csrf, sessionId };
  }

  function adminHeaders(actor: AdminActor, key?: string) {
    return {
      origin: adminOrigin,
      cookie: `${ADMIN_COOKIE}=${encodeURIComponent(actor.token)}`,
      "x-csrf-token": actor.csrf,
      ...(key ? { "idempotency-key": key } : {}),
      "content-type": "application/json",
    };
  }

  it("requires consent, exact selected incoming message, idempotency, block-history and Cases source gates", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const profileA = await ensureProfile(a, "C2 Peer A");
    const profileB = await ensureProfile(b, "C2 Peer B");

    const request = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, randomUUID()),
      payload: {
        targetPublicPlayerId: profileB.publicPlayerId,
        text: "EXACT_SELECTED_MESSAGE_BODY",
        clientMessageId: randomUUID(),
      },
    });
    expect(request.statusCode, request.body).toBe(201);
    const conversationId = request.json().conversation.id as string;
    const messageId = request.json().receipt.messageId as string;

    const noConsent = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(b, randomUUID()),
      payload: {
        targetKind: "message",
        messageId,
        conversationId,
        reasonCode: "harassment",
        shareMessageWithSupport: false,
      },
    });
    expect(noConsent.statusCode).toBe(422);

    const own = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(a, randomUUID()),
      payload: {
        targetKind: "message",
        messageId,
        conversationId,
        reasonCode: "harassment",
        shareMessageWithSupport: true,
      },
    });
    expect(own.statusCode).toBe(404);

    const foreign = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(b, randomUUID()),
      payload: {
        targetKind: "message",
        messageId: randomUUID(),
        conversationId,
        reasonCode: "harassment",
        shareMessageWithSupport: true,
      },
    });
    expect(foreign.statusCode).toBe(404);

    await pool.query(
      `INSERT INTO message_hidden_for(message_id,user_id) VALUES($1,$2)`,
      [messageId, b.userId],
    );
    const hidden = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(b, randomUUID()),
      payload: {
        targetKind: "message",
        messageId,
        conversationId,
        reasonCode: "harassment",
        shareMessageWithSupport: true,
      },
    });
    expect(hidden.statusCode).toBe(404);
    await pool.query(`DELETE FROM message_hidden_for WHERE message_id=$1`, [messageId]);

    const key = randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(b, key),
      payload: {
        targetKind: "message",
        messageId,
        conversationId,
        reasonCode: "harassment",
        detail: "private reporter detail must not leak",
        shareMessageWithSupport: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const reportId = created.json().reportId as string;

    const replay = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(b, key),
      payload: {
        targetKind: "message",
        messageId,
        conversationId,
        reasonCode: "harassment",
        detail: "private reporter detail must not leak",
        shareMessageWithSupport: true,
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().reportId).toBe(reportId);

    const bindingCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM message_report_bindings WHERE report_id=$1`,
      [reportId],
    );
    expect(bindingCount.rows[0].n).toBe(1);

    // Historical DM readability after block still allows exact selected report.
    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${encodeURIComponent(profileA.publicPlayerId)}`,
      headers: mutationHeaders(b, randomUUID()),
      payload: {},
    });
    expect(block.statusCode).toBe(200);
    const afterBlockKey = randomUUID();
    const afterBlock = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(b, afterBlockKey),
      payload: {
        targetKind: "message",
        messageId,
        conversationId,
        reasonCode: "spam",
        shareMessageWithSupport: true,
      },
    });
    // Same reporter+message+fingerprint binding is unique → returns existing report.
    expect(afterBlock.statusCode).toBe(200);
    expect(afterBlock.json().reportId).toBe(reportId);

    const moderator = await adminActor("moderator");
    const support = await adminActor("support");
    const createdCase = await app.inject({
      method: "POST",
      url: "/v1/admin/cases",
      headers: adminHeaders(moderator, randomUUID()),
      payload: { reportId, reasonCode: "synthetic_message" },
    });
    expect(createdCase.statusCode).toBe(200);
    const caseId = createdCase.json().id as string;

    const queue = await app.inject({
      method: "GET",
      url: `/v1/admin/reports?reportId=${reportId}`,
      headers: adminHeaders(moderator),
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items[0]).toMatchObject({
      id: reportId,
      targetKind: "message",
      reasonCode: "harassment",
    });
    expect(JSON.stringify(queue.json())).not.toMatch(/private reporter detail|EXACT_SELECTED_MESSAGE_BODY/i);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${caseId}/message-reports/${reportId}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(404);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}`,
      headers: adminHeaders(moderator),
    });
    const assign = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      headers: adminHeaders(moderator, randomUUID()),
      payload: {
        action: "assign",
        expectedVersion: detail.json().version,
        reasonCode: "synthetic_message",
        principalId: support.id,
      },
    });
    expect(assign.statusCode).toBe(200);

    await pool.query(
      `UPDATE messages SET purge_eligible_at = now() + interval '7 days' WHERE id=$1`,
      [messageId],
    );
    const read = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/message-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      caseId,
      reportId,
      messageId,
      sourceAvailable: true,
      text: "EXACT_SELECTED_MESSAGE_BODY",
    });
    expect(JSON.stringify(read.json())).not.toMatch(/private reporter detail/i);

    await pool.query(`UPDATE messages SET purge_eligible_at = NULL WHERE id=$1`, [messageId]);
    const nullExpiry = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/message-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(nullExpiry.statusCode).toBe(200);
    expect(nullExpiry.json()).toMatchObject({
      sourceAvailable: false,
      unavailableReason: "null_expiry",
      text: null,
    });

    await pool.query(
      `UPDATE messages SET purge_eligible_at = now() - interval '1 minute' WHERE id=$1`,
      [messageId],
    );
    const expired = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/message-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(expired.json()).toMatchObject({
      sourceAvailable: false,
      unavailableReason: "expired",
      text: null,
    });

    await pool.query(
      `UPDATE messages SET content_state='purged', body_text=NULL, purge_eligible_at=now()-interval '1 day' WHERE id=$1`,
      [messageId],
    );
    const purged = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/message-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(purged.json()).toMatchObject({
      sourceAvailable: false,
      unavailableReason: "purged",
      text: null,
    });

    const reassigned = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      headers: adminHeaders(moderator, randomUUID()),
      payload: {
        action: "assign",
        expectedVersion: (
          await app.inject({
            method: "GET",
            url: `/v1/admin/cases/${caseId}`,
            headers: adminHeaders(moderator),
          })
        ).json().version,
        reasonCode: "synthetic_message",
        principalId: null,
      },
    });
    expect(reassigned.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${caseId}/message-reports/${reportId}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(404);

    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });
});
