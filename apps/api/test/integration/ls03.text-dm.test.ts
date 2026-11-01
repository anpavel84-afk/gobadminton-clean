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
import { APP_ENV } from "../../src/tokens";
import { loadEnv } from "../../src/config/env";
import { createDatabase } from "../../src/database/client";
import { GamesModule } from "../../src/games/games.module";
import {
  SocialExpiryCleanupCommand,
  sqlExecutorFromPg,
} from "../../src/jobs/social-expiry-cleanup.command";
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

describeIntegration("LS-03 text DM", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  let app: NestFastifyApplication;
  let pool: ReturnType<typeof createDatabase>["pool"];

  const identityA: VerifiedIdentity = {
    provider: "vk",
    issuerNamespace: "vkid:app:ls03",
    subject: uniqueSuffix("ls03-a"),
    email: "ls03-a@example.com",
    displayName: "LS03 Player A",
  };
  const identityB: VerifiedIdentity = {
    provider: "yandex",
    issuerNamespace: "yandex:oauth:ls03",
    subject: uniqueSuffix("ls03-b"),
    email: "ls03-b@example.com",
    displayName: "LS03 Player B",
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
    process.env.GIT_SHA = "integration-ls03";
    process.env.SOCIAL_DIRECTORY_ENABLED = "1";
    process.env.SOCIAL_DM_ENABLED = "1";
    process.env.SOCIAL_DM_REQUEST_TTL_SECONDS = "604800";
    process.env.SOCIAL_DM_MESSAGE_RETENTION_SECONDS = "60";

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
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM abuse_reports");
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
      "x-csrf-token": session.csrfToken,
      origin: "http://127.0.0.1:3001",
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
    const cur = current.json() as { version: number; directoryVisible: boolean };

    const patch = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(session, `${keyPrefix}-patch-${uniqueSuffix("k")}`),
      payload: {
        expectedVersion: cur.version,
        displayName,
        cityId: MOSCOW_CITY_ID,
        areaKey: "sokol",
        bio: "DM test",
        contactPolicy: "requests",
        socialEligible: true,
      },
    });
    expect([200, 201]).toContain(patch.statusCode);
    let body = patch.json() as {
      publicPlayerId: string;
      version: number;
      directoryVisible: boolean;
      contactPolicy: string;
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
    expect(body.contactPolicy).toBe("requests");
    return { publicPlayerId: body.publicPlayerId, version: body.version };
  }

  it("resolves private none/pending/accepted/archived/terminal without GET mutations or leaks", async () => {
    const a = await login("vk"), b = await login("yandex");
    const self = await ensureOpenProfile(a, "Resolver A", "resolver-a"), peer = await ensureOpenProfile(b, "Resolver B", "resolver-b");
    const read = (session = a, target = peer.publicPlayerId) => app.inject({ method: "GET", url: `/v1/me/contact-state?targetPublicPlayerId=${target}`, cookies: session.cookies });
    const before = await pool.query("SELECT count(*) FROM social_pairs");
    const none = await read();
    expect(none.statusCode).toBe(200); expect(none.headers["cache-control"]).toBe("no-store");
    expect(none.json()).toEqual({ state: "none", targetPublicPlayerId: peer.publicPlayerId, canRequestContact: true });
    expect((await pool.query("SELECT count(*) FROM social_pairs")).rows).toEqual(before.rows);
    expect((await read(a, self.publicPlayerId)).json().state).toBe("unavailable");
    expect((await app.inject({ method: "GET", url: `/v1/me/contact-state?targetPublicPlayerId=${peer.publicPlayerId}` })).statusCode).toBe(401);
    expect((await read(a, "invalid")).statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/v1/conversations/requests", headers: mutationHeaders(a, uniqueSuffix("resolver")), payload: { targetPublicPlayerId: peer.publicPlayerId, text: "Request", clientMessageId: uniqueSuffix("resolver-msg") } });
    expect(created.statusCode).toBe(201);
    const conv = created.json().conversation as { id: string; version: number; requestState: string; requestExpiresAt: string | null };
    expect(conv.requestState).toBe("accepted");
    expect(conv.requestExpiresAt).toBeNull();
    expect((await read()).json()).toEqual({ state: "accepted", targetPublicPlayerId: peer.publicPlayerId, conversationId: conv.id, version: conv.version });
    expect((await read(b, self.publicPlayerId)).json().state).toBe("accepted");
    // Legacy pending expiry projection: seed explicit pending fixture (API no longer creates pending).
    await pool.query(
      `UPDATE conversations
       SET request_state = 'pending', request_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [conv.id],
    );
    expect((await read()).json().state).toBe("terminal");
    expect((await pool.query("SELECT request_state FROM conversations WHERE id = $1", [conv.id])).rows[0].request_state).toBe("pending");
    await pool.query("UPDATE conversations SET request_state = 'accepted', request_expires_at = NULL WHERE id = $1", [conv.id]);
    await pool.query("UPDATE conversation_members SET archived = true WHERE conversation_id = $1 AND user_id = $2", [conv.id, a.userId]);
    expect((await read()).json()).toEqual({ state: "accepted", targetPublicPlayerId: peer.publicPlayerId, conversationId: conv.id, version: conv.version });
    expect((await pool.query("SELECT archived FROM conversation_members WHERE conversation_id = $1 AND user_id = $2", [conv.id, a.userId])).rows[0].archived).toBe(true);
    await pool.query("UPDATE player_social_profiles SET contact_policy = 'closed' WHERE user_id = $1", [b.userId]);
    expect((await read()).json()).toEqual({ state: "unavailable", targetPublicPlayerId: peer.publicPlayerId });
    const historyWhileClosed = await app.inject({
      method: "GET",
      url: `/v1/conversations/${conv.id}/messages`,
      cookies: a.cookies,
    });
    expect(historyWhileClosed.statusCode).toBe(200);
    expect((historyWhileClosed.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);
    await pool.query("UPDATE player_social_profiles SET contact_policy = 'requests' WHERE user_id = $1", [b.userId]);
    for (const terminal of ["declined", "expired", "closed"]) {
      await pool.query("UPDATE conversations SET request_state = $2 WHERE id = $1", [conv.id, terminal]);
      expect((await read()).json()).toEqual({ state: "terminal", targetPublicPlayerId: peer.publicPlayerId });
    }
    await pool.query("UPDATE conversations SET request_state = 'accepted' WHERE id = $1", [conv.id]);
    await app.inject({ method: "PUT", url: `/v1/me/blocks/${self.publicPlayerId}`, headers: mutationHeaders(b, uniqueSuffix("resolver-block")), payload: {} });
    expect((await read()).json()).toEqual({ state: "unavailable", targetPublicPlayerId: peer.publicPlayerId });
    expect((await read(b, self.publicPlayerId)).json()).toEqual({ state: "unavailable", targetPublicPlayerId: self.publicPlayerId });
    const featureEnv = app.get<ReturnType<typeof loadEnv>>(APP_ENV);
    featureEnv.SOCIAL_DM_ENABLED = false;
    try { expect((await read()).json()).toEqual({ state: "unavailable", targetPublicPlayerId: peer.publicPlayerId }); }
    finally { featureEnv.SOCIAL_DM_ENABLED = true; }
  });

  it("uses the lowest descending page edge for older history, with ascending afterSeq complete", async () => {
    const a = await login("vk"), b = await login("yandex");
    await ensureOpenProfile(a, "Paging A", "paging-a"); const peer = await ensureOpenProfile(b, "Paging B", "paging-b");
    const id = await requestAndAccept(a, b, peer.publicPlayerId, "resolver-paging");
    await pool.query(`INSERT INTO messages (conversation_id, seq, author_user_id, client_message_id, kind, body_text, content_state, purge_eligible_at)
      SELECT $1, seq, $2, 'paging-' || seq, 'text', 'Synthetic paging', 'live', now() + interval '1 day' FROM generate_series(2, 125) seq`, [id, b.userId]);
    await pool.query("UPDATE conversations SET last_message_seq = 125, next_message_seq = 126 WHERE id = $1", [id]);
    const page = (query = "") => app.inject({ method: "GET", url: `/v1/conversations/${id}/messages?limit=50${query}`, cookies: a.cookies });
    const latest = (await page()).json(); expect(latest.nextCursor).toBe("76");
    const older = (await page("&beforeSeq=76")).json(); expect(older.items.map((m: {seq: string}) => m.seq)).toEqual(Array.from({length:50}, (_,n) => String(n+26))); expect(older.nextCursor).toBe("26");
    const first = (await page("&beforeSeq=26")).json(); expect(first.items.length).toBe(25); expect(first.nextCursor).toBeNull();
    const delta = (await page("&afterSeq=1")).json(); expect(delta.items[0].seq).toBe("2"); expect(delta.nextCursor).toBe("51");
  });

  it("projects contactability without private data and revalidates every target matrix fence", async () => {
    const a = await login("vk"), b = await login("yandex");
    const self = await ensureOpenProfile(a, "Contact Actor", "ca");
    const target = await ensureOpenProfile(b, "Contact Target", "ct");
    const read = (id = target.publicPlayerId, cookies = a.cookies) => app.inject({ method: "GET", url: `/v1/players/${id}`, cookies });
    const send = (id = target.publicPlayerId) => app.inject({ method: "POST", url: "/v1/conversations/requests", headers: mutationHeaders(a, uniqueSuffix("matrix-key")), payload: { targetPublicPlayerId: id, text: "Matrix", clientMessageId: uniqueSuffix("matrix-message") } });
    const assertNoPersist = async () => {
      expect((await pool.query("SELECT count(*)::int n FROM conversations")).rows[0].n).toBe(0);
      expect((await pool.query("SELECT count(*)::int n FROM messages")).rows[0].n).toBe(0);
    };
    const ready = await read();
    expect(ready.statusCode).toBe(200); expect(ready.json().canRequestContact).toBe(true);
    for (const key of ["contactPolicy", "contact_policy", "userId", "user_id", "email", "radarConsented", "regionId", "latitude", "longitude"]) expect(ready.json()).not.toHaveProperty(key);
    expect((await read(target.publicPlayerId, {})).json().canRequestContact).toBe(false);
    expect((await read(self.publicPlayerId)).json().canRequestContact).toBe(false);
    expect((await send(self.publicPlayerId)).statusCode).toBe(404);
    for (const contact of ["requests", "closed"]) for (const visible of [true, false]) for (const eligible of [true, false]) {
      await pool.query("UPDATE player_social_profiles SET contact_policy=$2,directory_visible=$3,social_eligible=$4 WHERE user_id=$1", [b.userId,contact,visible,eligible]);
      const projection = await read();
      if (visible && eligible) { expect(projection.statusCode).toBe(200); expect(projection.json().canRequestContact).toBe(contact === "requests"); }
      else expect(projection.statusCode).toBe(404);
      if (!(contact === "requests" && visible && eligible)) { expect((await send()).statusCode).toBe(404); await assertNoPersist(); }
    }
    await pool.query("UPDATE player_social_profiles SET contact_policy='requests',directory_visible=true,social_eligible=true WHERE user_id=$1", [b.userId]);
    for (const column of ["contact_policy='closed'", "directory_visible=false", "social_eligible=false"]) {
      expect((await read()).json().canRequestContact).toBe(true);
      await pool.query(`UPDATE player_social_profiles SET ${column} WHERE user_id=$1`, [b.userId]);
      expect((await send()).statusCode).toBe(404); await assertNoPersist();
      await pool.query("UPDATE player_social_profiles SET contact_policy='requests',directory_visible=true,social_eligible=true WHERE user_id=$1", [b.userId]);
    }
    for (const [session,playerId] of [[a,target.publicPlayerId],[b,self.publicPlayerId]] as const) {
      expect((await read()).json().canRequestContact).toBe(true);
      const block = await app.inject({method:"PUT",url:`/v1/me/blocks/${playerId}`,headers:mutationHeaders(session,uniqueSuffix("matrix-block")),payload:{}});
      expect(block.statusCode).toBe(200);
      expect((await read()).statusCode).toBe(404); expect((await send()).statusCode).toBe(404); await assertNoPersist();
      await pool.query("DELETE FROM user_blocks");
    }
    await pool.query("UPDATE player_social_profiles SET social_eligible=false WHERE user_id=$1", [a.userId]);
    expect((await read()).json().canRequestContact).toBe(false); expect((await send()).statusCode).toBe(404);
    await pool.query("UPDATE player_social_profiles SET social_eligible=true WHERE user_id=$1", [a.userId]);
    const env = app.get<ReturnType<typeof loadEnv>>(APP_ENV);
    env.SOCIAL_DM_ENABLED = false;
    try { expect((await read()).json().canRequestContact).toBe(false); expect((await send()).statusCode).toBe(404); }
    finally { env.SOCIAL_DM_ENABLED = true; }
    for (const id of ["malformed", "00000000-0000-4000-8000-000000000000"]) { expect((await read(id)).statusCode).toBe(404); expect([404,422]).toContain((await send(id)).statusCode); }
    await assertNoPersist();
    const directory = await app.inject({method:"GET",url:"/v1/players",cookies:a.cookies});
    expect(directory.json().items.find((p: {publicPlayerId:string}) => p.publicPlayerId === target.publicPlayerId).canRequestContact).toBe(true);
    const created = await send(); expect(created.statusCode).toBe(201);
    expect((await read()).json().canRequestContact).toBe(false);
  });

  it("revoked and expired sessions lose read eligibility and cannot create contact after a true read", async () => {
    const b = await login("yandex");
    const target = await ensureOpenProfile(b, "Session Target", "session-target");
    for (const update of ["revoked_at=now()", "expires_at=now()-interval '1 second'"]) {
      const a = await login("vk"); await ensureOpenProfile(a, "Session Actor", "session-actor");
      const read = () => app.inject({method:"GET",url:`/v1/players/${target.publicPlayerId}`,cookies:a.cookies});
      expect((await read()).json().canRequestContact).toBe(true);
      await pool.query(`UPDATE app_sessions SET ${update} WHERE user_id=$1`, [a.userId]);
      expect((await read()).json().canRequestContact).toBe(false);
      const denied = await app.inject({method:"POST",url:"/v1/conversations/requests",headers:mutationHeaders(a,uniqueSuffix("session-deny")),payload:{targetPublicPlayerId:target.publicPlayerId,text:"Denied",clientMessageId:uniqueSuffix("session-message")}});
      expect(denied.statusCode).toBe(401);
      expect((await pool.query("SELECT count(*)::int n FROM conversations")).rows[0].n).toBe(0);
    }
  });

  it("immediate accepted first contact → both reply; closed recipient blocks inbound only", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Alpha DM", "a");
    const peer = await ensureOpenProfile(b, "Beta DM", "b");

    const key = `req-${uniqueSuffix("idem")}-xxxxxxxx`;
    const clientMessageId = `cmsg-${uniqueSuffix("m1")}`;
    const payload = {
      targetPublicPlayerId: peer.publicPlayerId,
      text: "Привет, сыграем?",
      clientMessageId,
    };
    const create1 = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, key),
      payload,
    });
    expect(create1.statusCode).toBe(201);
    const created = create1.json() as {
      conversation: {
        id: string;
        requestState: string;
        requestExpiresAt: string | null;
        version: number;
        role: string;
      };
      receipt: { seq: string; outcome: string; messageId: string };
    };
    expect(created.conversation.requestState).toBe("accepted");
    expect(created.conversation.requestExpiresAt).toBeNull();
    expect(created.conversation.role).toBe("initiator");
    expect(created.receipt.seq).toBe("1");
    expect(created.receipt.outcome).toBe("created");
    expect(
      (
        await pool.query<{ request_state: string; request_expires_at: Date | null }>(
          `SELECT request_state, request_expires_at FROM conversations WHERE id = $1`,
          [created.conversation.id],
        )
      ).rows[0],
    ).toMatchObject({ request_state: "accepted", request_expires_at: null });

    const createReplay = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, key),
      payload,
    });
    expect(createReplay.statusCode).toBe(201);
    expect(createReplay.json()).toEqual(create1.json());

    const convId = created.conversation.id;
    const version = created.conversation.version;

    const openForB = await app.inject({
      method: "GET",
      url: `/v1/conversations/${convId}`,
      cookies: b.cookies,
    });
    expect(openForB.statusCode).toBe(200);
    expect(openForB.json()).toMatchObject({
      requestState: "accepted",
      requestExpiresAt: null,
      role: "recipient",
      unreadCount: 1,
    });

    // Legacy accept remains idempotent on already-accepted chats.
    const accept = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/accept`,
      headers: mutationHeaders(b, `acc-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: version },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json()).toMatchObject({ requestState: "accepted" });

    const sendKey = `send-${uniqueSuffix("k")}-xxxxxxxx`;
    const sendPayload = {
      kind: "text",
      text: "Отлично, завтра?",
      clientMessageId: `send-${uniqueSuffix("s1")}`,
    };
    const send1 = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(b, sendKey),
      payload: sendPayload,
    });
    expect(send1.statusCode).toBe(201);
    expect(send1.json()).toMatchObject({ seq: "2", outcome: "created" });

    const sendReplay = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(b, sendKey),
      payload: sendPayload,
    });
    expect(sendReplay.statusCode).toBe(201);
    expect(sendReplay.json()).toEqual(send1.json());

    const clientDup = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(b, `send2-${uniqueSuffix("k")}-xxxxxxx`),
      payload: sendPayload,
    });
    expect(clientDup.statusCode).toBe(200);
    expect(clientDup.json()).toMatchObject({
      outcome: "duplicate",
      seq: "2",
    });

    const msgs = await app.inject({
      method: "GET",
      url: `/v1/conversations/${convId}/messages?limit=10`,
      cookies: a.cookies,
    });
    expect(msgs.statusCode).toBe(200);
    const page = msgs.json() as {
      items: Array<{ seq: string; text: string | null }>;
    };
    expect(page.items.map((m) => m.seq)).toEqual(["1", "2"]);
    expect(page.items[1]?.text).toBe("Отлично, завтра?");

    const read = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/read`,
      headers: mutationHeaders(a, `read-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { throughSeq: "2" },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ readThroughSeq: "2" });

    const header = await app.inject({
      method: "GET",
      url: `/v1/conversations/${convId}`,
      cookies: a.cookies,
    });
    expect(header.json()).toMatchObject({
      unreadCount: 0,
      lastMessageSeq: "2",
    });

    const list = await app.inject({
      method: "GET",
      url: "/v1/conversations",
      cookies: a.cookies,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBe(1);

    // Recipient closed: inbound to them denied; their outbound still allowed; history readable.
    const own = await app.inject({ method: "GET", url: "/v1/me/social-profile", cookies: b.cookies });
    const close = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(b, uniqueSuffix("accepted-close")),
      payload: { expectedVersion: own.json().version, contactPolicy: "closed" },
    });
    expect(close.statusCode).toBe(200);
    const projection = await app.inject({
      method: "GET",
      url: `/v1/players/${peer.publicPlayerId}`,
      cookies: a.cookies,
    });
    expect(projection.json().canRequestContact).toBe(false);
    expect(
      (
        await pool.query<{ request_state: string; request_expires_at: Date | null }>(
          `SELECT request_state, request_expires_at FROM conversations WHERE id = $1`,
          [convId],
        )
      ).rows[0],
    ).toMatchObject({ request_state: "accepted", request_expires_at: null });

    const deniedToClosed = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, `send-closed-${uniqueSuffix("k")}-xxxxx`),
      payload: {
        kind: "text",
        text: "should not deliver to closed recipient",
        clientMessageId: `send-closed-${uniqueSuffix("s")}`,
      },
    });
    expect(deniedToClosed.statusCode).toBe(404);

    const outboundFromClosed = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(b, `send-out-${uniqueSuffix("k")}-xxxxxx`),
      payload: {
        kind: "text",
        text: "closed sender may still write outbound",
        clientMessageId: `send-out-${uniqueSuffix("s")}`,
      },
    });
    expect(outboundFromClosed.statusCode).toBe(201);

    const history = await app.inject({
      method: "GET",
      url: `/v1/conversations/${convId}/messages?limit=10`,
      cookies: a.cookies,
    });
    expect(history.statusCode).toBe(200);
    expect((history.json() as { items: unknown[] }).items.length).toBe(3);
  });

  it("block closes open request and blocks send on accepted thread", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    const peerA = await ensureOpenProfile(a, "Alpha Block", "ab");
    const peerB = await ensureOpenProfile(b, "Beta Block", "bb");

    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `reqb-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "open then block",
        clientMessageId: `cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const convId = (created.json() as { conversation: { id: string } }).conversation
      .id;
    expect(
      (created.json() as { conversation: { requestState: string } }).conversation
        .requestState,
    ).toBe("accepted");
    // Explicit legacy pending fixture — API create is accepted by default.
    // First half keeps pending→closed-on-block coverage; do not relax to accepted.
    await pool.query(
      `UPDATE conversations
       SET request_state = 'pending',
           request_expires_at = now() + interval '1 day'
       WHERE id = $1`,
      [convId],
    );

    const block = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${peerA.publicPlayerId}`,
      headers: mutationHeaders(b, `blk-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {},
    });
    expect(block.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: `/v1/conversations/${convId}`,
      cookies: a.cookies,
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ requestState: "closed" });

    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM user_blocks");
    await pool.query("DELETE FROM social_pairs");

    const open = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `reqo-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "open then block send",
        clientMessageId: `cmsg-${uniqueSuffix("m2")}`,
      },
    });
    expect(open.statusCode).toBe(201);
    const openBody = open.json() as {
      conversation: { id: string; version: number; requestState: string };
    };
    expect(openBody.conversation.requestState).toBe("accepted");
    const accept = await app.inject({
      method: "POST",
      url: `/v1/conversations/${openBody.conversation.id}/accept`,
      headers: mutationHeaders(b, `acco-${uniqueSuffix("k")}-xxxxxxx`),
      payload: { expectedVersion: openBody.conversation.version },
    });
    expect(accept.statusCode).toBe(200);

    const block2 = await app.inject({
      method: "PUT",
      url: `/v1/me/blocks/${peerA.publicPlayerId}`,
      headers: mutationHeaders(b, `blk2-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {},
    });
    expect(block2.statusCode).toBe(200);

    const denied = await app.inject({
      method: "POST",
      url: `/v1/conversations/${openBody.conversation.id}/messages`,
      headers: mutationHeaders(a, `sendb-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        text: "should fail",
        clientMessageId: `cmsg-${uniqueSuffix("m3")}`,
      },
    });
    expect(denied.statusCode).toBe(404);

    const history = await app.inject({
      method: "GET",
      url: `/v1/conversations/${openBody.conversation.id}/messages`,
      cookies: a.cookies,
    });
    expect(history.statusCode).toBe(200);
    expect(
      (history.json() as { items: unknown[] }).items.length,
    ).toBeGreaterThan(0);
  });

  it("legacy decline/expiry fixtures remain terminal; retention purge job", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Alpha Decline", "ad");
    const peerB = await ensureOpenProfile(b, "Beta Decline", "bd");

    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `reqd-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "please decline",
        clientMessageId: `cmsg-${uniqueSuffix("md")}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      conversation: { id: string; version: number };
    };
    // Explicit legacy pending fixture — API create is accepted by default.
    await pool.query(
      `UPDATE conversations
       SET request_state = 'pending',
           request_expires_at = now() + interval '1 day'
       WHERE id = $1`,
      [body.conversation.id],
    );
    const decline = await app.inject({
      method: "POST",
      url: `/v1/conversations/${body.conversation.id}/decline`,
      headers: mutationHeaders(b, `dec-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: { expectedVersion: body.conversation.version },
    });
    expect(decline.statusCode).toBe(200);
    expect(decline.json()).toMatchObject({ requestState: "declined" });

    const reopen = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `reopen-${uniqueSuffix("k")}-xxxxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "try again",
        clientMessageId: `cmsg-${uniqueSuffix("md2")}`,
      },
    });
    expect(reopen.statusCode).toBe(404);

    await pool.query("DELETE FROM message_hidden_for");
    await pool.query("DELETE FROM messages");
    await pool.query("DELETE FROM conversation_members");
    await pool.query("DELETE FROM conversations");
    await pool.query("DELETE FROM game_invitations");
    await pool.query("DELETE FROM user_blocks");
    await pool.query("DELETE FROM social_pairs");

    const opened = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `reqe-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "will expire",
        clientMessageId: `cmsg-${uniqueSuffix("me")}`,
      },
    });
    expect(opened.statusCode).toBe(201);
    const pendingBody = opened.json() as {
      conversation: { id: string; version: number };
    };
    await pool.query(
      `UPDATE conversations
       SET request_state = 'pending',
           request_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [pendingBody.conversation.id],
    );
    const expiredRead = await app.inject({
      method: "GET",
      url: `/v1/conversations/${pendingBody.conversation.id}`,
      cookies: b.cookies,
    });
    expect(expiredRead.statusCode).toBe(200);
    expect(expiredRead.json()).toMatchObject({ requestState: "expired" });

    await pool.query(
      `UPDATE messages
       SET purge_eligible_at = now() - interval '1 second'
       WHERE conversation_id = $1`,
      [pendingBody.conversation.id],
    );
    const cleanup = new SocialExpiryCleanupCommand();
    const result = await cleanup.execute(sqlExecutorFromPg(pool), {
      kind: "sweep",
    });
    expect(result.dmMessagesPurged).toBeGreaterThanOrEqual(1);
    const purged = await pool.query<{
      content_state: string;
      body_text: string | null;
    }>(`SELECT content_state, body_text FROM messages WHERE conversation_id = $1`, [
      pendingBody.conversation.id,
    ]);
    expect(purged.rows[0]?.content_state).toBe("purged");
    expect(purged.rows[0]?.body_text).toBeNull();

    const msgs = await app.inject({
      method: "GET",
      url: `/v1/conversations/${pendingBody.conversation.id}/messages`,
      cookies: a.cookies,
    });
    expect(msgs.statusCode).toBe(200);
    const item = (msgs.json() as { items: Array<{ text: string | null; contentState: string }> })
      .items[0];
    expect(item?.contentState).toBe("purged");
    expect(item?.text).toBeNull();
  });

  it("rejects unauthenticated mutation and closed contact policy", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Alpha Closed", "ac");
    const peerB = await ensureOpenProfile(b, "Beta Closed", "bc");

    const cur = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: b.cookies,
    });
    const version = (cur.json() as { version: number }).version;
    const closed = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(b, `close-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        expectedVersion: version,
        contactPolicy: "closed",
      },
    });
    expect([200, 201]).toContain(closed.statusCode);

    const denied = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `deny-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "nope",
        clientMessageId: `cmsg-${uniqueSuffix("x")}`,
      },
    });
    expect(denied.statusCode).toBe(404);

    const unauth = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `unauth-${uniqueSuffix("k")}-xxxxxx`,
      },
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "no auth",
        clientMessageId: `cmsg-${uniqueSuffix("y")}`,
      },
    });
    // Cookie-mutation path may fail closed as 401 (no session) or 403 (CSRF/origin).
    expect([401, 403]).toContain(unauth.statusCode);
  });

  async function requestAndAccept(
    initiator: Session,
    recipient: Session,
    recipientPublicPlayerId: string,
    label: string,
  ): Promise<string> {
    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(initiator, `req-${label}-${uniqueSuffix("k")}`),
      payload: {
        targetPublicPlayerId: recipientPublicPlayerId,
        text: `first contact ${label}`,
        clientMessageId: `cmsg-${label}-${uniqueSuffix("m")}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const conversation = (
      created.json() as { conversation: { id: string; version: number } }
    ).conversation;
    const accept = await app.inject({
      method: "POST",
      url: `/v1/conversations/${conversation.id}/accept`,
      headers: mutationHeaders(recipient, `acc-${label}-${uniqueSuffix("k")}`),
      payload: { expectedVersion: conversation.version },
    });
    expect(accept.statusCode).toBe(200);
    return conversation.id;
  }

  async function optOutSocialEligible(session: Session, label: string): Promise<void> {
    const profile = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: session.cookies,
    });
    expect(profile.statusCode).toBe(200);
    const version = (profile.json() as { version: number }).version;
    const revoked = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(session, `opt-${label}-${uniqueSuffix("k")}`),
      payload: { expectedVersion: version, socialEligible: false },
    });
    expect(revoked.statusCode).toBe(200);
    expect((revoked.json() as { socialEligible: boolean }).socialEligible).toBe(
      false,
    );
  }

  it("denies initiator send after recipient opts out of socialEligible", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Alpha Recipient OptOut", "aro");
    const peerB = await ensureOpenProfile(b, "Beta Recipient OptOut", "bro");
    const convId = await requestAndAccept(a, b, peerB.publicPlayerId, "rcp");

    const before = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM messages WHERE conversation_id = $1`,
      [convId],
    );
    const beforeCount = Number(before.rows[0]?.c ?? 0);

    await optOutSocialEligible(b, "rcp");

    const denied = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, `send-rcp-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        text: "after recipient opt-out",
        clientMessageId: `cmsg-rcp-${uniqueSuffix("m")}`,
      },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });

    const after = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM messages WHERE conversation_id = $1`,
      [convId],
    );
    expect(Number(after.rows[0]?.c ?? 0)).toBe(beforeCount);

    const history = await app.inject({
      method: "GET",
      url: `/v1/conversations/${convId}/messages`,
      cookies: a.cookies,
    });
    expect(history.statusCode).toBe(200);
    expect(
      (history.json() as { items: unknown[] }).items.length,
    ).toBeGreaterThan(0);
  });

  it("denies sender send after the sender opts out of socialEligible", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Alpha Sender OptOut", "aso");
    const peerB = await ensureOpenProfile(b, "Beta Sender OptOut", "bso");
    const convId = await requestAndAccept(a, b, peerB.publicPlayerId, "snd");

    const before = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM messages WHERE conversation_id = $1`,
      [convId],
    );
    const beforeCount = Number(before.rows[0]?.c ?? 0);

    await optOutSocialEligible(a, "snd");

    const denied = await app.inject({
      method: "POST",
      url: `/v1/conversations/${convId}/messages`,
      headers: mutationHeaders(a, `send-snd-${uniqueSuffix("k")}-xxxxxxx`),
      payload: {
        text: "after sender opt-out",
        clientMessageId: `cmsg-snd-${uniqueSuffix("m")}`,
      },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toMatchObject({ code: "RESOURCE_UNAVAILABLE" });

    const after = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM messages WHERE conversation_id = $1`,
      [convId],
    );
    expect(Number(after.rows[0]?.c ?? 0)).toBe(beforeCount);
  });

  it("0044 promotion predicate accepts eligible pending and preserves closed/expired", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Mig Actor", "mig-a");
    const peerB = await ensureOpenProfile(b, "Mig Peer", "mig-b");

    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `mig-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "migration fixture",
        clientMessageId: `mig-${uniqueSuffix("m")}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const conv = created.json() as { conversation: { id: string; version: number } };
    const convId = conv.conversation.id;
    const baseVersion = conv.conversation.version;

    const promoteSql = `
UPDATE conversations AS c
SET request_state = 'accepted',
    request_expires_at = NULL,
    version = c.version + 1,
    updated_at = clock_timestamp()
FROM users AS ui,
     users AS ur,
     player_social_profiles AS pi,
     player_social_profiles AS pr
WHERE c.id = $1
  AND c.kind = 'direct'
  AND c.request_state = 'pending'
  AND c.initiator_user_id = ui.id
  AND c.recipient_user_id = ur.id
  AND pi.user_id = ui.id
  AND pr.user_id = ur.id
  AND (c.request_expires_at IS NULL OR c.request_expires_at > clock_timestamp())
  AND ui.status = 'active'
  AND ur.status = 'active'
  AND pr.directory_visible IS TRUE
  AND pr.social_eligible IS TRUE
  AND pr.contact_policy = 'requests'
  AND pi.social_eligible IS TRUE
  AND NOT EXISTS (
    SELECT 1 FROM user_blocks ub
    WHERE (ub.blocker_user_id = c.initiator_user_id AND ub.blocked_user_id = c.recipient_user_id)
       OR (ub.blocker_user_id = c.recipient_user_id AND ub.blocked_user_id = c.initiator_user_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM user_restrictions urx
    WHERE urx.user_id IN (c.initiator_user_id, c.recipient_user_id)
      AND urx.capability IN ('account.access', 'profile.public', 'social.directory', 'social.dm_send')
      AND urx.revoked_at IS NULL
      AND urx.starts_at <= clock_timestamp()
      AND urx.expires_at > clock_timestamp()
  )`;

    const client = await pool.connect();
    const readConv = async () =>
      (
        await client.query<{
          request_state: string;
          request_expires_at: Date | null;
          version: number;
        }>(
          `SELECT request_state, request_expires_at, version FROM conversations WHERE id = $1`,
          [convId],
        )
      ).rows[0]!;

    try {
      await client.query(
        `UPDATE conversations
         SET request_state = 'pending',
             request_expires_at = now() + interval '2 days',
             version = $2
         WHERE id = $1`,
        [convId, baseVersion],
      );
      await client.query("BEGIN");
      try {
        await client.query(promoteSql, [convId]);
        const promoted = await readConv();
        expect(promoted.request_state).toBe("accepted");
        expect(promoted.request_expires_at).toBeNull();
        expect(promoted.version).toBe(baseVersion + 1);
      } finally {
        await client.query("ROLLBACK");
      }

      await client.query(
        `UPDATE conversations
         SET request_state = 'pending',
             request_expires_at = now() + interval '2 days',
             version = $2
         WHERE id = $1`,
        [convId, baseVersion],
      );
      await client.query(
        `UPDATE player_social_profiles SET contact_policy = 'closed' WHERE user_id = $1`,
        [b.userId],
      );
      await client.query("BEGIN");
      try {
        await client.query(promoteSql, [convId]);
        const closedPreserved = await readConv();
        expect(closedPreserved.request_state).toBe("pending");
        expect(closedPreserved.version).toBe(baseVersion);
      } finally {
        await client.query("ROLLBACK");
      }
      await client.query(
        `UPDATE player_social_profiles SET contact_policy = 'requests' WHERE user_id = $1`,
        [b.userId],
      );

      await client.query(
        `UPDATE conversations
         SET request_state = 'pending',
             request_expires_at = now() - interval '1 minute',
             version = $2
         WHERE id = $1`,
        [convId, baseVersion],
      );
      await client.query("BEGIN");
      try {
        await client.query(promoteSql, [convId]);
        const expiredPreserved = await readConv();
        expect(expiredPreserved.request_state).toBe("pending");
        expect(expiredPreserved.version).toBe(baseVersion);
      } finally {
        await client.query("ROLLBACK");
      }

      await client.query(
        `UPDATE conversations
         SET request_state = 'declined',
             request_expires_at = now() + interval '2 days',
             version = $2
         WHERE id = $1`,
        [convId, baseVersion],
      );
      await client.query("BEGIN");
      try {
        await client.query(promoteSql, [convId]);
        const declinedPreserved = await readConv();
        expect(declinedPreserved.request_state).toBe("declined");
        expect(declinedPreserved.version).toBe(baseVersion);
      } finally {
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });

  it("DM contact_policy opt-out denies incoming without bumping shared social epoch", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Epoch Actor", "epoch-a");
    const peerB = await ensureOpenProfile(b, "Epoch Peer", "epoch-b");

    const epochBefore = await pool.query<{ social_action_epoch: string }>(
      `SELECT social_action_epoch::text AS social_action_epoch
       FROM player_social_profiles WHERE user_id = $1`,
      [b.userId],
    );
    const beforeEpoch = epochBefore.rows[0]!.social_action_epoch;

    const cur = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: b.cookies,
    });
    expect(cur.statusCode).toBe(200);
    const version = (cur.json() as { version: number }).version;
    const closed = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(b, `epoch-dm-${uniqueSuffix("k")}-xxxxx`),
      payload: { expectedVersion: version, contactPolicy: "closed" },
    });
    expect(closed.statusCode).toBe(200);
    expect((closed.json() as { contactPolicy: string }).contactPolicy).toBe(
      "closed",
    );

    const epochAfterDm = await pool.query<{ social_action_epoch: string }>(
      `SELECT social_action_epoch::text AS social_action_epoch
       FROM player_social_profiles WHERE user_id = $1`,
      [b.userId],
    );
    expect(epochAfterDm.rows[0]!.social_action_epoch).toBe(beforeEpoch);

    const denied = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `epoch-deny-${uniqueSuffix("k")}-xxxx`),
      payload: {
        targetPublicPlayerId: peerB.publicPlayerId,
        text: "dm opt-out must deny",
        clientMessageId: `epoch-${uniqueSuffix("m")}`,
      },
    });
    expect(denied.statusCode).toBe(404);

    const hide = await app.inject({
      method: "PUT",
      url: "/v1/me/social-profile/visibility",
      headers: mutationHeaders(b, `epoch-hide-${uniqueSuffix("k")}-xxxx`),
      payload: {
        directoryVisible: false,
        expectedVersion: (closed.json() as { version: number }).version,
      },
    });
    expect(hide.statusCode).toBe(200);
    const epochAfterHide = await pool.query<{ social_action_epoch: string }>(
      `SELECT social_action_epoch::text AS social_action_epoch
       FROM player_social_profiles WHERE user_id = $1`,
      [b.userId],
    );
    expect(Number(epochAfterHide.rows[0]!.social_action_epoch)).toBe(
      Number(beforeEpoch) + 1,
    );

    // Direct restore after API opt-out must set truthful provenance (not leave user_opt_out).
    await pool.query(
      `UPDATE player_social_profiles
       SET directory_visible = true,
           contact_policy = 'requests',
           directory_visibility_provenance = 'owner_default'
       WHERE user_id = $1`,
      [b.userId],
    );
    const epochMid = await pool.query<{ social_action_epoch: string }>(
      `SELECT social_action_epoch::text AS social_action_epoch
       FROM player_social_profiles WHERE user_id = $1`,
      [b.userId],
    );
    const midEpoch = epochMid.rows[0]!.social_action_epoch;
    await optOutSocialEligible(b, "epoch-revoke");
    const epochAfterRevoke = await pool.query<{ social_action_epoch: string }>(
      `SELECT social_action_epoch::text AS social_action_epoch
       FROM player_social_profiles WHERE user_id = $1`,
      [b.userId],
    );
    expect(Number(epochAfterRevoke.rows[0]!.social_action_epoch)).toBe(
      Number(midEpoch) + 1,
    );
  });

  it("new profile upsert defaults contact_policy to requests without overwriting closed", async () => {
    const a = await login("vk");
    const fresh = await app.inject({
      method: "GET",
      url: "/v1/me/social-profile",
      cookies: a.cookies,
    });
    expect(fresh.statusCode).toBe(200);
    // Owner #448: getOwn materializes physical profile ON at version 1.
    expect(fresh.json()).toMatchObject({
      version: 1,
      contactPolicy: "requests",
      directoryVisible: true,
    });
    const created = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(a, `def-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        expectedVersion: (fresh.json() as { version: number }).version,
        displayName: "Default Policy",
        cityId: MOSCOW_CITY_ID,
      },
    });
    expect([200, 201]).toContain(created.statusCode);
    expect(created.json()).toMatchObject({ contactPolicy: "requests" });
    const closed = await app.inject({
      method: "PATCH",
      url: "/v1/me/social-profile",
      headers: mutationHeaders(a, `def-close-${uniqueSuffix("k")}-xxxx`),
      payload: {
        expectedVersion: (created.json() as { version: number }).version,
        contactPolicy: "closed",
      },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ contactPolicy: "closed" });
    // Closing DM contact must not flip directory / shared social epoch by itself.
    expect(closed.json()).toMatchObject({
      directoryVisible: true,
      version: (created.json() as { version: number }).version + 1,
    });
    const dbDefault = await pool.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'player_social_profiles' AND column_name = 'contact_policy'`,
    );
    expect(dbDefault.rows[0]?.column_default ?? "").toMatch(/requests/);
  });

  it("conversation DTO peer displayName scrubs email-shaped legacy storage (#450 QA1)", async () => {
    const a = await login("vk");
    const b = await login("yandex");
    await ensureOpenProfile(a, "Alpha Safe Peer", "safe-a");
    const peer = await ensureOpenProfile(b, "Beta Safe Peer", "safe-b");
    const emailShaped = "legacy.dm.peer@mail.example";
    await pool.query(
      `UPDATE player_social_profiles SET display_name = $2 WHERE user_id = $1`,
      [b.userId, emailShaped],
    );

    const created = await app.inject({
      method: "POST",
      url: "/v1/conversations/requests",
      headers: mutationHeaders(a, `safe-dmr-${uniqueSuffix("k")}-xxxxxxxx`),
      payload: {
        targetPublicPlayerId: peer.publicPlayerId,
        text: "Привет, сыграем?",
        clientMessageId: `safe-cmsg-${uniqueSuffix("m")}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as {
      conversation: {
        id: string;
        peer: { publicPlayerId: string; displayName: string };
      };
      receipt: { messageId: string };
    };
    expect(createdBody.conversation.peer.displayName).toBe("Игрок");
    expect(JSON.stringify(createdBody)).not.toContain(emailShaped);

    const header = await app.inject({
      method: "GET",
      url: `/v1/conversations/${createdBody.conversation.id}`,
      cookies: a.cookies,
    });
    expect(header.statusCode).toBe(200);
    const headerBody = header.json() as {
      peer: { displayName: string };
    };
    expect(headerBody.peer.displayName).toBe("Игрок");
    expect(JSON.stringify(headerBody)).not.toContain(emailShaped);

    const list = await app.inject({
      method: "GET",
      url: "/v1/conversations",
      cookies: a.cookies,
    });
    expect(list.statusCode).toBe(200);
    const listItem = (
      list.json() as {
        items: Array<{ id: string; peer: { displayName: string } }>;
      }
    ).items.find((row) => row.id === createdBody.conversation.id);
    expect(listItem?.peer.displayName).toBe("Игрок");
    expect(JSON.stringify(listItem)).not.toContain(emailShaped);

    const msgs = await app.inject({
      method: "GET",
      url: `/v1/conversations/${createdBody.conversation.id}/messages?limit=10`,
      cookies: a.cookies,
    });
    expect(msgs.statusCode).toBe(200);
    const page = msgs.json() as {
      items: Array<{ text: string | null }>;
    };
    expect(page.items[0]?.text).toBe("Привет, сыграем?");
    expect(JSON.stringify(page)).not.toContain(emailShaped);

    await pool.query(
      `UPDATE player_social_profiles SET display_name = $2 WHERE user_id = $1`,
      [b.userId, "Анна Смирнова"],
    );
    const ordinary = await app.inject({
      method: "GET",
      url: `/v1/conversations/${createdBody.conversation.id}`,
      cookies: a.cookies,
    });
    expect(ordinary.statusCode).toBe(200);
    expect(
      (ordinary.json() as { peer: { displayName: string } }).peer.displayName,
    ).toBe("Анна Смирнова");

    const guest = await app.inject({
      method: "GET",
      url: `/v1/conversations/${createdBody.conversation.id}`,
    });
    expect(guest.statusCode).toBe(401);
  });
});
