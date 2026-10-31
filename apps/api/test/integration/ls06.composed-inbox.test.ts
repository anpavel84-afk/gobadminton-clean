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
import { GameChatModule } from "../../src/game-chat/game-chat.module";
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

type InboxItem = {
  kind: string;
  id: string;
  lastActivityAt: string;
  unreadCount: number;
  attention: boolean;
  conversationId: string | null;
  invitationId: string | null;
  gameId: string | null;
};

describeIntegration("LS-06 Composed Inbox", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const ownerIdentity: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:ls06",
    subject: uniqueSuffix("ls06-owner"),
    email: "ls06-owner@example.com",
    displayName: "LS06 Owner",
  };
  const playerIdentity: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:ls06",
    subject: uniqueSuffix("ls06-player"),
    email: "ls06-player@example.com",
    displayName: "LS06 Player",
  };
  const yandexIdentity: VerifiedIdentity = { ...playerIdentity };

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
    process.env.GIT_SHA = "integration-ls06";
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
      .useValue([fakeAdapter(ownerIdentity), fakeAdapter(yandexIdentity)])
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
    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM participation_transitions");
    await pool.query("DELETE FROM participations");
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
      origin: "http://127.0.0.1:3001",
      "x-csrf-token": session.csrfToken,
      "idempotency-key": key,
      "content-type": "application/json",
    };
  }

  async function ensureOpenProfile(
    session: Session,
    displayName: string,
    keyPrefix: string,
  ): Promise<{ publicPlayerId: string; version: number }> {
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
      headers: mutationHeaders(session, `${keyPrefix}-patch-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: cur.version,
        displayName,
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        bio: "Inbox test",
        contactPolicy: "requests",
        socialEligible: true,
      },
    });
    expect([200, 201]).toContain(patch.statusCode);
    let body = patch.json() as {
      publicPlayerId: string;
      version: number;
      directoryVisible: boolean;
    };
    if (!body.directoryVisible) {
      const vis = await app.inject({
        method: "PUT",
        url: "/v1/me/social-profile/visibility",
        headers: mutationHeaders(session, `${keyPrefix}-vis-${uniqueSuffix("k")}`),
        payload: {
          directoryVisible: true,
          consentPolicyVersion: "directory-mvp-v1",
          expectedVersion: body.version,
        },
      });
      expect(vis.statusCode).toBe(200);
      body = vis.json() as typeof body;
    }
    return { publicPlayerId: body.publicPlayerId, version: body.version };
  }

  async function publishGame(owner: Session, title: string) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const venueRes = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: mutationHeaders(owner, `idem-venue-${suffix}-abcdefgh`),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: "LS06 Court",
        address: "Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venueRes.statusCode);
    const venue = venueRes.json() as { id: string };
    const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
    const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: mutationHeaders(owner, `idem-game-${suffix}-abcdefgh`),
      payload: {
        hostDisplayName: `Host ${title} ${suffix}`,
        hostPublicContact: "telegram:@ls06",
        venueId: venue.id,
        title,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: deadline.toISOString(),
        capacity: 4,
        externalReservedCount: 0,
        visibility: "public",
        formatKey: "doubles",
        activityKind: "regular",
        levelRule: {
          scaleId: "ntrp",
          scaleVersion: 1,
          allowedLevelIds: ["3.0", "3.5"],
        },
        settlement: {
          mode: "external",
          purpose: "no_trainer_fee",
          priceMinor: null,
          currency: null,
          terms: "Court terms arranged outside the platform",
        },
      },
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = draftRes.json() as { id: string; version: number };
    const pub = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.id}/publish`,
      headers: mutationHeaders(owner, `idem-pub-${suffix}-abcdefgh`),
      payload: { expectedVersion: draft.version },
    });
    expect(pub.statusCode).toBe(200);
    return pub.json() as { id: string; version: number; title: string };
  }

  it("composes mixed sources with stable order, unread, pagination and source fences", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    await ensureOpenProfile(owner, "Owner Inbox", "own");
    const peer = await ensureOpenProfile(player, "Player Inbox", "pl");

    // Pending invitation (attention, not unread)
    const gameInvite = await publishGame(owner, "Invite Game");
    const inviteRes = await app.inject({
      method: "POST",
      url: `/v1/games/${gameInvite.id}/invitations`,
      headers: mutationHeaders(owner, `inv-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        inviteePublicPlayerId: peer.publicPlayerId,
        expectedGameVersion: gameInvite.version,
      },
    });
    expect(inviteRes.statusCode).toBe(201);
    const invitation = inviteRes.json() as { id: string };

    // Accepted DM with unread for player
    const dmReq = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(owner, `dmr-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "Привет",
        clientMessageId: `cmsg-${uniqueSuffix("m1")}`,
      },
    });
    expect(dmReq.statusCode).toBe(201);
    const dmCreated = dmReq.json() as {
      conversation: { id: string; version: number };
    };
    const accept = await app.inject({
      method: "POST",
      url: `/v1/conversations/${dmCreated.conversation.id}/accept`,
      headers: mutationHeaders(player, `acc-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: dmCreated.conversation.version },
    });
    expect(accept.statusCode).toBe(200);
    const send = await app.inject({
      method: "POST",
      url: `/v1/conversations/${dmCreated.conversation.id}/messages`,
      headers: mutationHeaders(owner, `snd-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        kind: "text",
        text: "Ещё сообщение",
        clientMessageId: `cmsg-${uniqueSuffix("m2")}`,
      },
    });
    expect(send.statusCode).toBe(201);

    // Confirmed player + game chat unread
    const chatGame = await publishGame(owner, "Chat Game");
    const chatGameVersion = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [chatGame.id],
    );
    const apply = await app.inject({
      method: "POST",
      url: `/v1/games/${chatGame.id}/participations`,
      headers: mutationHeaders(player, `app-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedGameVersion: chatGameVersion.rows[0]!.version },
    });
    expect([200, 201]).toContain(apply.statusCode);
    const application = apply.json() as { id: string; version: number };
    const confirm = await app.inject({
      method: "POST",
      url: `/v1/participations/${application.id}/confirm`,
      headers: mutationHeaders(owner, `cfm-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: application.version },
    });
    expect(confirm.statusCode).toBe(200);
    const chatSend = await app.inject({
      method: "POST",
      url: `/v1/games/${chatGame.id}/chat/messages`,
      headers: mutationHeaders(owner, `chs-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        kind: "text",
        text: "Сбор в 19:00",
        clientMessageId: `cmsg-${uniqueSuffix("m3")}`,
      },
    });
    expect(chatSend.statusCode).toBe(201);

    const inbox = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?limit=50",
      cookies: player.cookies,
    });
    expect(inbox.statusCode).toBe(200);
    const page = inbox.json() as {
      items: InboxItem[];
      nextCursor: string | null;
      counts: {
        pendingRequestCount: number;
        pendingInvitationCount: number;
        dmUnread: number;
        gameChatUnread: number;
      };
    };
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    const kinds = page.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["dm", "game_invitation", "game_chat"]));

    // Stable descending activity order
    for (let i = 1; i < page.items.length; i += 1) {
      const prev = page.items[i - 1]!;
      const cur = page.items[i]!;
      const cmp = cur.lastActivityAt.localeCompare(prev.lastActivityAt);
      expect(cmp).toBeLessThanOrEqual(0);
    }

    expect(page.counts.pendingInvitationCount).toBe(1);
    expect(page.counts.pendingRequestCount).toBe(0);
    expect(page.counts.dmUnread).toBe(1);
    expect(page.counts.gameChatUnread).toBe(1);

    const dmRow = page.items.find((i) => i.kind === "dm")!;
    expect(dmRow.unreadCount).toBeGreaterThan(0);
    const inviteRow = page.items.find((i) => i.kind === "game_invitation")!;
    expect(inviteRow.attention).toBe(true);
    expect(inviteRow.unreadCount).toBe(0);
    expect(inviteRow.id).toBe(invitation.id);

    // Pagination stability: limit=1 then cursor continues without dupes
    const first = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?limit=1",
      cookies: player.cookies,
    });
    expect(first.statusCode).toBe(200);
    const firstPage = first.json() as {
      items: InboxItem[];
      nextCursor: string | null;
    };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/v1/me/inbox?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      cookies: player.cookies,
    });
    expect(second.statusCode).toBe(200);
    const secondPage = second.json() as { items: InboxItem[] };
    expect(secondPage.items).toHaveLength(1);
    expect(
      `${secondPage.items[0]!.kind}:${secondPage.items[0]!.id}`,
    ).not.toBe(`${firstPage.items[0]!.kind}:${firstPage.items[0]!.id}`);

    // Unread → mark-read delegates to DM write ownership
    const markDm = await app.inject({
      method: "POST",
      url: `/v1/me/inbox/items/dm/${dmRow.conversationId}/read`,
      headers: mutationHeaders(player, `rd-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { throughSeq: String(2) },
    });
    expect(markDm.statusCode).toBe(200);
    const afterRead = await app.inject({
      method: "GET",
      url: "/v1/me/inbox/counts",
      cookies: player.cookies,
    });
    expect(afterRead.statusCode).toBe(200);
    expect(afterRead.json()).toMatchObject({
      dmUnread: 0,
      gameChatUnread: 1,
      pendingInvitationCount: 1,
    });

    // Cancel game → game chat disappears from Inbox (source fence / retention)
    const gameVersion = await pool.query<{ version: number }>(
      `SELECT version FROM games WHERE id = $1`,
      [chatGame.id],
    );
    const cancel = await app.inject({
      method: "POST",
      url: `/v1/games/${chatGame.id}/cancel`,
      headers: mutationHeaders(owner, `can-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        expectedVersion: gameVersion.rows[0]!.version,
        reason: "Test cancel",
      },
    });
    expect(cancel.statusCode).toBe(200);
    const afterCancel = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?limit=50",
      cookies: player.cookies,
    });
    expect(afterCancel.statusCode).toBe(200);
    const afterItems = (afterCancel.json() as { items: InboxItem[] }).items;
    expect(afterItems.some((i) => i.kind === "game_chat" && i.gameId === chatGame.id)).toBe(
      false,
    );
    const countsAfterCancel = (
      afterCancel.json() as { counts: { gameChatUnread: number } }
    ).counts;
    expect(countsAfterCancel.gameChatUnread).toBe(0);

    // Query budget: EXPLAIN the actual composed page SQL (ordering, cursor, unread
    // correlated counts) plus representative count queries — not a simplified ID union.
    const pageBuilt = buildInboxPageSql(
      { dmEnabled: true, invitationsEnabled: true, gameChatEnabled: true },
      "all",
      {
        at: page.items[0]!.lastActivityAt,
        kind: page.items[0]!.kind as "dm" | "dm_request" | "game_invitation" | "game_chat",
        id: page.items[0]!.id,
      },
      20,
    );
    expect(pageBuilt.sql).toMatch(/ORDER BY last_activity_at DESC, kind DESC, id DESC/);
    expect(pageBuilt.sql).toMatch(/LIMIT \$/);
    expect(pageBuilt.sql).toMatch(/UNION ALL/);
    expect(pageBuilt.sql).toMatch(/read_through_seq/);

    const pageExplain = await pool.query(
      `EXPLAIN (FORMAT JSON, ANALYZE false) ${pageBuilt.sql}`,
      [player.userId, ...pageBuilt.params],
    );
    const pagePlan = pageExplain.rows[0]["QUERY PLAN"][0]["Plan"] as {
      "Node Type": string;
      "Plan Rows": number;
      Plans?: Array<{ "Node Type": string; "Plan Rows": number }>;
    };
    expect(pagePlan["Node Type"]).toBe("Limit");
    expect(pagePlan["Plan Rows"]).toBeLessThanOrEqual(21);

    function collectNodeTypes(node: {
      "Node Type": string;
      Plans?: Array<{ "Node Type": string; Plans?: unknown[] }>;
    }): string[] {
      const out = [node["Node Type"]];
      for (const child of node.Plans ?? []) {
        out.push(...collectNodeTypes(child as typeof node));
      }
      return out;
    }
    const nodeTypes = collectNodeTypes(pagePlan as never);
    expect(nodeTypes.some((t) => t.includes("Sort") || t.includes("Append") || t.includes("Limit"))).toBe(
      true,
    );

    for (const countKind of [
      "pending_request",
      "dm_unread",
      "pending_invitation",
      "game_chat_unread",
    ] as const) {
      const countSql = buildInboxCountSql(countKind);
      const countExplain = await pool.query(
        `EXPLAIN (FORMAT JSON) ${countSql}`,
        [player.userId],
      );
      const countPlanText = JSON.stringify(countExplain.rows[0]);
      expect(countPlanText.length).toBeGreaterThan(20);
      const countRoot = countExplain.rows[0]["QUERY PLAN"][0]["Plan"] as {
        "Plan Rows": number;
      };
      expect(countRoot["Plan Rows"]).toBeGreaterThanOrEqual(0);
      expect(countRoot["Plan Rows"]).toBeLessThanOrEqual(1_000_000);
    }
  }, 120_000);

  it("rejects malformed paging input and enforces guest access", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    await ensureOpenProfile(owner, "QA Inbox Owner", "qa-own");
    const peer = await ensureOpenProfile(player, "QA Inbox Player", "qa-pl");
    const request = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(owner, `qa-dmr-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "Private QA message",
        clientMessageId: `qa-cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(request.statusCode).toBe(201);
    const conversationId = (request.json() as { conversation: { id: string } })
      .conversation.id;

    const guest = await app.inject({ method: "GET", url: "/v1/me/inbox" });
    expect(guest.statusCode).toBe(401);
    const other = await app.inject({
      method: "GET",
      url: "/v1/me/inbox",
      cookies: player.cookies,
    });
    expect(other.statusCode).toBe(200);
    expect(
      (other.json() as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === conversationId,
      ),
    ).toBe(true);

    const malformedStatuses: number[] = [];
    for (const url of [
      "/v1/me/inbox?limit=1junk",
      "/v1/me/inbox?cursor=eyJhdCI6Im5vdC1hLWRhdGUiLCJraW5kIjoiZG0iLCJpZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSJ9",
    ]) {
      const response = await app.inject({
        method: "GET",
        url,
        cookies: player.cookies,
      });
      malformedStatuses.push(response.statusCode);
    }
    expect(malformedStatuses).toEqual([400, 400]);
  });

  it("projects overdue source expiry without Inbox-owned UPDATEs", async () => {
    const owner = await login("vk");
    const player = await login("yandex");
    await ensureOpenProfile(owner, "Expire Owner", "ex-own");
    const peer = await ensureOpenProfile(player, "Expire Player", "ex-pl");

    const request = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(owner, `exp-dmr-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "Will expire",
        clientMessageId: `exp-cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(request.statusCode).toBe(201);
    const conversationId = (request.json() as { conversation: { id: string } })
      .conversation.id;
    // Current API accepts first contact immediately; isolate a legacy pending row
    // before expiry so Inbox can still project pending→effective expired without UPDATEs.
    await pool.query(
      `UPDATE conversations
       SET request_state = 'pending',
           request_expires_at = now() - interval '1 minute'
       WHERE id = $1`,
      [conversationId],
    );
    const before = await pool.query<{
      request_state: string;
      version: number;
      updated_at: Date;
    }>(
      `SELECT request_state, version, updated_at FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(before.rows[0]!.request_state).toBe("pending");

    const inbox = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?filter=attention",
      cookies: player.cookies,
    });
    expect(inbox.statusCode).toBe(200);
    const body = inbox.json() as {
      items: InboxItem[];
      counts: { pendingRequestCount: number };
    };
    expect(body.items.some((i) => i.id === conversationId)).toBe(false);
    expect(body.counts.pendingRequestCount).toBe(0);

    const after = await pool.query<{
      request_state: string;
      version: number;
      updated_at: Date;
    }>(
      `SELECT request_state, version, updated_at FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(after.rows[0]!.request_state).toBe("pending");
    expect(after.rows[0]!.version).toBe(before.rows[0]!.version);
    expect(after.rows[0]!.updated_at.getTime()).toBe(
      before.rows[0]!.updated_at.getTime(),
    );

    const allPage = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?limit=50",
      cookies: player.cookies,
    });
    expect(allPage.statusCode).toBe(200);
    const expiredRow = (
      allPage.json() as {
        items: Array<{
          id: string;
          kind: string;
          attention: boolean;
          requestState: string | null;
        }>;
      }
    ).items.find((i) => i.id === conversationId);
    expect(expiredRow).toBeDefined();
    expect(expiredRow!.kind).toBe("dm");
    expect(expiredRow!.attention).toBe(false);
    expect(expiredRow!.requestState).toBe("expired");
  });

  it("returns empty attention page when actor has no pending sources", async () => {
    const owner = await login("vk");
    await ensureOpenProfile(owner, "Flag Owner", "fo");
    const empty = await app.inject({
      method: "GET",
      url: "/v1/me/inbox?filter=attention",
      cookies: owner.cookies,
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      items: [],
      counts: {
        pendingRequestCount: 0,
        pendingInvitationCount: 0,
        dmUnread: 0,
        gameChatUnread: 0,
      },
    });
  });
});
