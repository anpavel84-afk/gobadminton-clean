import cookie from "@fastify/cookie";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestCoreModule } from "./test-core.module";
import { AuthModule } from "../../src/auth/auth.module";
import { AUTH_PROVIDER_OVERRIDES } from "../../src/auth/providers/registry";
import type {
  AuthProviderAdapter,
  VerifiedIdentity,
} from "../../src/auth/providers/types";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import {
  cleanupDemoData,
  countDemoRows,
  seedDemoFoundation,
  withDemoTransaction,
} from "../../src/database/demo-seed-ops";
import {
  DEMO_DM_CONVERSATION_IDS,
  DEMO_GAME_INVITATION_IDS,
  DEMO_ISSUER_NAMESPACE,
  DEMO_USER_IDS,
  demoDmConversationId,
  demoGameId,
  demoUserId,
} from "../../src/database/demo-ids";
import { buildDemoSocialPopulation } from "../../src/database/demo-social-population";
import { GameChatModule } from "../../src/game-chat/game-chat.module";
import { GamesModule } from "../../src/games/games.module";
import { InboxModule } from "../../src/inbox/inbox.module";
import {
  buildInboxCountSql,
  buildInboxPageSql,
} from "../../src/inbox/inbox-compose-sql";
import { InvitationsModule } from "../../src/invitations/invitations.module";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { OrganizersModule } from "../../src/organizers/organizers.module";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
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

describeIntegration("demo social backfill", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  // Login as foundation demo person 2 (Maria / yandex).
  const maria: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: DEMO_ISSUER_NAMESPACE,
    subject: "demo-person-02",
    email: "demo.person02@synthetic.gobadminton.local",
    displayName: "Maria Kovaleva",
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
    process.env.GIT_SHA = "integration-demo-social";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_DM_ENABLED = "1";
    process.env.SOCIAL_INVITATIONS_ENABLED = "1";
    process.env.SOCIAL_GAME_CHAT_ENABLED = "1";
    process.env.SOCIAL_INBOX_ENABLED = "1";

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
        MessagingModule,
        InvitationsModule,
        GameChatModule,
        InboxModule,
      ],
    })
      .overrideProvider(AUTH_PROVIDER_OVERRIDES)
      .useValue([fakeAdapter(maria)])
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

  async function loginMaria(): Promise<Record<string, string>> {
    const start = await app.inject({
      method: "GET",
      url: "/v1/auth/yandex/start?returnPath=/inbox",
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json() as { authorizationUrl: string };
    const state = new URL(startBody.authorizationUrl).searchParams.get("state");
    const cookies = parseSetCookie(start.headers["set-cookie"]);
    const callback = await app.inject({
      method: "GET",
      url: `/v1/auth/yandex/callback?code=ok&state=${encodeURIComponent(state!)}`,
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
    expect((me.json() as { id: string }).id).toBe(demoUserId(2));
    return sessionCookies;
  }

  it("binds the same 20 IDs and seeds idempotent social backfill with Inbox consistency", async () => {
    const planned = buildDemoSocialPopulation();
    expect(planned.dmThreads).toHaveLength(10);
    expect(planned.invitations).toHaveLength(8);
    expect(planned.gameChats.length).toBeGreaterThanOrEqual(12);
    expect(planned.messageCount).toBeGreaterThan(20);

    const report1 = await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    expect(report1.users).toBe(20);
    expect(report1.profiles).toBe(20);
    expect(report1.games).toBe(20);
    expect(report1.fullModeExtras).toBe("social_dm_invites_gamechat");
    expect(report1.dmConversations).toBe(10);
    expect(report1.gameInvitations).toBe(8);
    expect(report1.gameConversations).toBe(planned.gameChats.length);
    expect(report1.messages).toBe(planned.messageCount);

    const counts1 = await countDemoRows(pool);
    expect(counts1.users).toBe(20);
    expect(counts1.profiles).toBe(20);
    expect(counts1.games).toBe(20);
    expect(counts1.dmConversations).toBe(10);
    expect(counts1.gameInvitations).toBe(8);
    expect(counts1.gameConversations).toBe(planned.gameChats.length);
    expect(counts1.socialMessages).toBe(planned.messageCount);
    expect(counts1.radarPresences).toBe(0);

    // Idempotent reseed
    const report2 = await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    expect(report2.dmConversations).toBe(report1.dmConversations);
    expect(report2.gameInvitations).toBe(report1.gameInvitations);
    expect(report2.messages).toBe(report1.messages);
    expect(await countDemoRows(pool)).toEqual(counts1);

    // Referential integrity: invitation participations exist; DM pairs are demo-demo.
    const orphanInvites = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM game_invitations i
       WHERE i.id = ANY($1::uuid[])
         AND i.status = 'accepted'
         AND NOT EXISTS (
           SELECT 1 FROM participations p WHERE p.id = i.participation_id
         )`,
      [DEMO_GAME_INVITATION_IDS],
    );
    expect(orphanInvites.rows[0]!.c).toBe(0);

    const mixedDm = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM conversations c
       WHERE c.id = ANY($1::uuid[])
         AND (
           NOT (c.initiator_user_id = ANY($2::uuid[]))
           OR NOT (c.recipient_user_id = ANY($2::uuid[]))
         )`,
      [DEMO_DM_CONVERSATION_IDS, DEMO_USER_IDS],
    );
    expect(mixedDm.rows[0]!.c).toBe(0);

    // Compose SQL counts for Maria match API Inbox.
    const mariaId = demoUserId(2);
    const pageSql = buildInboxPageSql(
      {
        dmEnabled: true,
        invitationsEnabled: true,
        gameChatEnabled: true,
      },
      "all",
      null,
      50,
    );
    const composed = await pool.query<{
      kind: string;
      id: string;
      unread_count: string | number;
      attention: boolean;
    }>(pageSql.sql, [mariaId, ...pageSql.params]);
    const kinds = new Set(composed.rows.map((r) => r.kind));
    expect(kinds.has("dm")).toBe(true);
    expect(kinds.has("game_chat")).toBe(true);
    // Maria is invitee of invitation #2 (pending) — may appear as game_invitation
    expect(
      composed.rows.some((r) => r.kind === "dm" || r.kind === "dm_request"),
    ).toBe(true);

    const unreadSql = buildInboxCountSql("dm_unread");
    const unread = await pool.query<{ count: string }>(unreadSql, [mariaId]);
    expect(Number(unread.rows[0]!.count)).toBeGreaterThanOrEqual(1);

    const cookies = await loginMaria();
    const inbox = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?limit=50",
      cookies,
    });
    expect(inbox.statusCode).toBe(200);
    const body = inbox.json() as {
      items: Array<{ kind: string; id: string; unreadCount: number }>;
      counts: {
        dmUnread: number;
        pendingRequestCount: number;
        pendingInvitationCount: number;
        gameChatUnread: number;
      };
    };
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(body.counts.dmUnread).toBe(Number(unread.rows[0]!.count));
    expect(body.items.some((i) => i.kind === "dm" || i.kind === "dm_request")).toBe(
      true,
    );
    expect(body.items.some((i) => i.kind === "game_chat")).toBe(true);
    // Seeded unread DM 1 for Maria
    expect(
      body.items.some(
        (i) => i.id === demoDmConversationId(1) && i.unreadCount > 0,
      ),
    ).toBe(true);

    // No fake radar
    const radar = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM radar_presences WHERE user_id = ANY($1::uuid[])`,
      [DEMO_USER_IDS],
    );
    expect(radar.rows[0]!.c).toBe(0);
  }, 180_000);

  it("refuses cleanup when a non-demo member attaches to a demo game chat", async () => {
    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    const before = await countDemoRows(pool);
    expect(before.dmConversations).toBe(10);

    const foreignUserId = "e3000000-0000-4000-8000-000000000001";
    await pool.query(
      `INSERT INTO users (id, display_name) VALUES ($1, 'QA foreign chat member')`,
      [foreignUserId],
    );
    await pool.query(
      `INSERT INTO conversation_members (
         conversation_id, user_id, role, membership_state, send_allowed,
         read_through_seq, hidden_through_seq
       ) VALUES (
         $1, $2, 'member', 'active', true, 0, 0
       )`,
      [
        // game conversation for demo game 1
        (
          await pool.query<{ id: string }>(
            `SELECT id FROM conversations WHERE kind = 'game' AND game_id = $1`,
            [demoGameId(1)],
          )
        ).rows[0]!.id,
        foreignUserId,
      ],
    );

    await expect(
      withDemoTransaction(pool, async (client) => {
        await cleanupDemoData(client);
      }),
    ).rejects.toThrow(
      /Demo cleanup refused: out-of-namespace rows.*conversations\.game\.mixed_member/,
    );
    expect(await countDemoRows(pool)).toEqual(before);

    await pool.query(`DELETE FROM conversation_members WHERE user_id = $1`, [
      foreignUserId,
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [foreignUserId]);

    await withDemoTransaction(pool, async (client) => {
      await cleanupDemoData(client);
    });
    const after = await countDemoRows(pool);
    expect(after.users).toBe(0);
    expect(after.dmConversations).toBe(0);
    expect(after.gameConversations).toBe(0);
    expect(after.gameInvitations).toBe(0);
    expect(after.socialMessages).toBe(0);

    await withDemoTransaction(pool, (client) =>
      seedDemoFoundation(client, "full"),
    );
    const reseeded = await countDemoRows(pool);
    expect(reseeded.users).toBe(20);
    expect(reseeded.dmConversations).toBe(10);
    expect(reseeded.radarPresences).toBe(0);
  }, 180_000);
});
