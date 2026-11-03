import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import webpush from "web-push";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { MessagingModule } from "../../src/messaging/messaging.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import {
  JobEnqueueService,
  persistWebPushDeliveryIntent,
} from "../../src/jobs/job-enqueue.service";
import {
  deliverWebPushJob,
  recoverPendingWebPushIntents,
  type WebPushTransport,
} from "../../src/push/push-delivery";
import { hashPushEndpoint } from "../../src/push/push.policy";
import { PushModule } from "../../src/push/push.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { buildTestCoreModule } from "./test-core.module";

/**
 * Bounded #456 Web Push HTTP + injectable transport checks on disposable PostGIS.
 * Skipped unless RUN_DB_INTEGRATION=1. Never talks to live push providers.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
const DB_NAME = "gobadminton_web_push_disposable";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  if (
    process.env.NODE_ENV !== "test" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    decodeURIComponent(url.pathname) !== `/${DB_NAME}`
  ) {
    throw new Error("Refusing nonlocal/non-test/nonisolated web-push DB");
  }
  return raw;
}

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };

run("#456 web push — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let author: Actor;
  let foreign: Actor;
  const vapid = webpush.generateVAPIDKeys();
  const sent: Array<{ endpoint: string; payload: string }> = [];
  const transport: WebPushTransport = {
    async send(input) {
      sent.push({ endpoint: input.endpoint, payload: input.payload });
      return { statusCode: 201, permanent: false };
    },
  };
  const failingTransport: WebPushTransport = {
    async send() {
      return { statusCode: 503, permanent: false };
    },
  };
  const goneTransport: WebPushTransport = {
    async send() {
      return { statusCode: 410, permanent: true };
    },
  };

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "web-push-synthetic",
    });
    const existing = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'",
    );
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const migrations = path.resolve(__dirname, "../../migrations");
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(await readFile(path.join(migrations, file), "utf8"));
        await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [
          file.replace(/\.sql$/, ""),
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "web-push-synthetic-fixture-pepper!!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "web-push-synthetic-fingerprint!!!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      SOCIAL_DM_ENABLED: "1",
      WEB_PUSH_ENABLED: "1",
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:push-test@gobadminton.invalid",
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        ProfilesModule,
        SafetyModule,
        MessagingModule,
        PushModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(SessionService);
    author = await mintActor("Author");
    foreign = await mintActor("Foreign");
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function mintActor(name: string): Promise<Actor> {
    const userId = randomUUID();
    await pool.query(`INSERT INTO users (id, status, display_name) VALUES ($1, 'active', $2)`, [
      userId,
      name,
    ]);
    await pool.query(
      `INSERT INTO player_social_profiles (user_id, display_name, directory_visible, contact_policy, version)
       VALUES ($1, $2, true, 'requests', 1)`,
      [userId, name],
    );
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${issued.sessionToken}`,
    };
  }

  function headers(actor: Actor, key?: string) {
    return {
      cookie: actor.cookie,
      origin,
      "content-type": "application/json",
      "x-csrf-token": actor.csrfToken,
      ...(key ? { "idempotency-key": key } : {}),
    };
  }

  async function ensurePair(a: string, b: string): Promise<string> {
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM social_pairs WHERE user_low = $1 AND user_high = $2`,
      [low, high],
    );
    if (existing.rows[0]) return existing.rows[0].id;
    const id = randomUUID();
    await pool.query(
      `INSERT INTO social_pairs (id, user_low, user_high, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [id, low, high],
    );
    return id;
  }

  async function seedSubscription(actor: Actor, endpointPath: string) {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${endpointPath}`;
    const endpointHash = hashPushEndpoint(endpoint);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO web_push_subscriptions (
         id, user_id, session_id, endpoint_hash, endpoint_sealed,
         p256dh_sealed, auth_sealed, endpoint_host
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'fcm.googleapis.com')`,
      [
        id,
        actor.userId,
        actor.sessionId,
        endpointHash,
        sealSecret(env.AUTH_PEPPER, endpoint),
        sealSecret(env.AUTH_PEPPER, vapid.publicKey),
        sealSecret(env.AUTH_PEPPER, Buffer.from("auth-secret").toString("base64url")),
      ],
    );
    await pool.query(
      `INSERT INTO web_push_preferences (user_id, enabled, version)
       VALUES ($1, true, 1)
       ON CONFLICT (user_id) DO UPDATE SET enabled = true, version = web_push_preferences.version`,
      [actor.userId],
    );
    return { id, endpoint };
  }

  it("registers own device, rejects foreign claim, unbinds on logout", async () => {
    const stateOff = await app.inject({
      method: "GET",
      url: "/v1/me/push",
      headers: { cookie: author.cookie },
    });
    expect(stateOff.statusCode).toBe(200);
    expect(stateOff.json().featureAvailable).toBe(true);
    expect(stateOff.json().preferenceEnabled).toBe(false);

    const pref = await app.inject({
      method: "PUT",
      url: "/v1/me/push/preference",
      headers: headers(author, randomUUID().replace(/-/g, "").slice(0, 24)),
      payload: { enabled: true, expectedVersion: 0 },
    });
    expect(pref.statusCode).toBe(200);
    expect(pref.json().preferenceEnabled).toBe(true);

    const endpoint = "https://fcm.googleapis.com/fcm/send/own-device-token-aaaa";
    const reg = await app.inject({
      method: "POST",
      url: "/v1/me/push/subscriptions",
      headers: headers(author, randomUUID().replace(/-/g, "").slice(0, 24)),
      payload: {
        endpoint,
        keys: {
          p256dh: vapid.publicKey,
          auth: Buffer.from("device-auth").toString("base64url"),
        },
      },
    });
    expect([200, 201]).toContain(reg.statusCode);
    const subId = reg.json().id as string;

    const foreignClaim = await app.inject({
      method: "POST",
      url: "/v1/me/push/subscriptions",
      headers: headers(foreign, randomUUID().replace(/-/g, "").slice(0, 24)),
      payload: {
        endpoint,
        keys: {
          p256dh: vapid.publicKey,
          auth: Buffer.from("other-auth").toString("base64url"),
        },
      },
    });
    expect(foreignClaim.statusCode).toBe(409);

    await sessions.revokeSession(author.sessionId);
    const after = await pool.query<{ unbound_at: Date | null }>(
      `SELECT unbound_at FROM web_push_subscriptions WHERE id = $1`,
      [subId],
    );
    expect(after.rows[0]?.unbound_at).toBeTruthy();
  });

  /** Distinct direct pair per scenario — conversations_pair_direct_uidx is real. */
  async function mintDirectConversation(label: string) {
    const from = await mintActor(`${label}-From`);
    const to = await mintActor(`${label}-To`);
    const pairId = await ensurePair(from.userId, to.userId);
    const conversationId = randomUUID();
    await pool.query(
      `INSERT INTO conversations (
         id, pair_id, kind, request_state, initiator_user_id, recipient_user_id,
         next_message_seq, last_message_seq, last_message_at, version, created_at, updated_at
       ) VALUES (
         $1, $2, 'direct', 'accepted', $3, $4, 2, 1, now(), 1, now(), now()
       )`,
      [conversationId, pairId, from.userId, to.userId],
    );
    await pool.query(
      `INSERT INTO conversation_members (
         conversation_id, user_id, read_through_seq, hidden_through_seq, muted
       ) VALUES
         ($1, $2, 1, 0, false),
         ($1, $3, 0, 0, false)`,
      [conversationId, from.userId, to.userId],
    );
    return { from, to, conversationId };
  }

  it("delivers to recipient, skips muted/read, cleans 410, preserves message on transport fail", async () => {
    const { from, to, conversationId } = await mintDirectConversation("deliver");
    const messageId = randomUUID();
    await pool.query(
      `INSERT INTO messages (
         id, conversation_id, seq, author_user_id, client_message_id,
         kind, body_text, content_state, purge_eligible_at, created_at
       ) VALUES (
         $1, $2, 1, $3, $4, 'text', 'secret private body', 'live', now() + interval '90 days', now()
       )`,
      [messageId, conversationId, from.userId, randomUUID()],
    );

    const sub = await seedSubscription(to, "recipient-device-bbbb");
    sent.length = 0;
    const delivered = await deliverWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "dm_message",
        messageId,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(delivered.delivered).toBe(1);
    expect(sent[0]?.endpoint).toBe(sub.endpoint);
    expect(sent[0]?.payload).toContain("Новое сообщение");
    expect(sent[0]?.payload).not.toContain("secret private body");

    await pool.query(
      `UPDATE conversation_members SET read_through_seq = 1
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, to.userId],
    );
    const skippedRead = await deliverWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "dm_message",
        messageId,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(skippedRead.skipped).toBeGreaterThan(0);

    const mutedMsg = randomUUID();
    await pool.query(
      `UPDATE conversation_members SET read_through_seq = 0, muted = true
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, to.userId],
    );
    await pool.query(
      `INSERT INTO messages (
         id, conversation_id, seq, author_user_id, client_message_id,
         kind, body_text, content_state, purge_eligible_at, created_at
       ) VALUES ($1,$2,2,$3,$4,'text','muted','live', now() + interval '90 days', now())`,
      [mutedMsg, conversationId, from.userId, randomUUID()],
    );
    const muted = await deliverWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "dm_message",
        messageId: mutedMsg,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(muted.skipped).toBeGreaterThan(0);

    await pool.query(
      `UPDATE conversation_members SET muted = false, read_through_seq = 0
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, to.userId],
    );
    const goneMsg = randomUUID();
    await pool.query(
      `INSERT INTO messages (
         id, conversation_id, seq, author_user_id, client_message_id,
         kind, body_text, content_state, purge_eligible_at, created_at
       ) VALUES ($1,$2,3,$3,$4,'text','gone','live', now() + interval '90 days', now())`,
      [goneMsg, conversationId, from.userId, randomUUID()],
    );
    const cleaned = await deliverWebPushJob({
      pool,
      env,
      transport: goneTransport,
      payload: {
        kind: "dm_message",
        messageId: goneMsg,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(cleaned.cleaned).toBeGreaterThan(0);

    await seedSubscription(to, "recipient-device-cccc");
    const failMsg = randomUUID();
    await pool.query(
      `INSERT INTO messages (
         id, conversation_id, seq, author_user_id, client_message_id,
         kind, body_text, content_state, purge_eligible_at, created_at
       ) VALUES ($1,$2,4,$3,$4,'text','keep','live', now() + interval '90 days', now())`,
      [failMsg, conversationId, from.userId, randomUUID()],
    );
    const failed = await deliverWebPushJob({
      pool,
      env,
      transport: failingTransport,
      payload: {
        kind: "dm_message",
        messageId: failMsg,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(failed.failedTransient).toBeGreaterThan(0);
    const still = await pool.query(`SELECT body_text FROM messages WHERE id = $1`, [failMsg]);
    expect(still.rows[0]?.body_text).toBe("keep");
  });

  it("mixedSuccessRetry: transient on one device retries; sent device is not re-sent", async () => {
    const { from, to, conversationId } = await mintDirectConversation("mixed");
    const messageId = randomUUID();
    await pool.query(
      `INSERT INTO messages (
         id, conversation_id, seq, author_user_id, client_message_id,
         kind, body_text, content_state, purge_eligible_at, created_at
       ) VALUES (
         $1, $2, 1, $3, $4, 'text', 'mixed', 'live', now() + interval '90 days', now()
       )`,
      [messageId, conversationId, from.userId, randomUUID()],
    );

    const okSub = await seedSubscription(to, "mixed-ok-device");
    const failSub = await seedSubscription(to, "mixed-fail-device");
    const calls: string[] = [];
    const mixedTransport: WebPushTransport = {
      async send(input) {
        calls.push(input.endpoint);
        if (input.endpoint === failSub.endpoint) {
          return { statusCode: 503, permanent: false };
        }
        return { statusCode: 201, permanent: false };
      },
    };

    const first = await deliverWebPushJob({
      pool,
      env,
      transport: mixedTransport,
      payload: {
        kind: "dm_message",
        messageId,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(first.delivered).toBe(1);
    expect(first.failedTransient).toBe(1);
    // Worker must throw on any transient (simulated here by assertion).
    expect(first.failedTransient > 0).toBe(true);

    const secondCallsBefore = calls.length;
    const retry = await deliverWebPushJob({
      pool,
      env,
      transport: mixedTransport,
      payload: {
        kind: "dm_message",
        messageId,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(retry.delivered).toBe(0);
    expect(retry.failedTransient).toBe(1);
    expect(retry.skipped).toBeGreaterThanOrEqual(1);
    const newEndpoints = calls.slice(secondCallsBefore);
    expect(newEndpoints).not.toContain(okSub.endpoint);
    expect(newEndpoints).toContain(failSub.endpoint);
  });

  it("accessRestriction: inactive recipient skips delivery", async () => {
    const { from, to, conversationId } = await mintDirectConversation("access");
    const messageId = randomUUID();
    await pool.query(
      `INSERT INTO messages (
         id, conversation_id, seq, author_user_id, client_message_id,
         kind, body_text, content_state, purge_eligible_at, created_at
       ) VALUES (
         $1, $2, 1, $3, $4, 'text', 'inactive', 'live', now() + interval '90 days', now()
       )`,
      [messageId, conversationId, from.userId, randomUUID()],
    );
    await seedSubscription(to, "inactive-device");
    await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [to.userId]);
    sent.length = 0;
    const skipped = await deliverWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "dm_message",
        messageId,
        conversationId,
        recipientUserId: to.userId,
        authorUserId: from.userId,
      },
    });
    expect(skipped.delivered).toBe(0);
    expect(skipped.skipped).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);
  });

  it("queueFailureIsolated: intent survives enqueue failure; recover dispatches delivery", async () => {
    const { from, to, conversationId } = await mintDirectConversation("queue");
    const messageId = randomUUID();
    const payload = {
      kind: "dm_message" as const,
      messageId,
      conversationId,
      recipientUserId: to.userId,
      authorUserId: from.userId,
    };
    const jobs = new JobEnqueueService(env);
    // Injected queue/boss unavailability (not a core DB failure).
    jobs.ensureStarted = async () => {
      throw new Error("injected_pgboss_unavailable");
    };

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO messages (
           id, conversation_id, seq, author_user_id, client_message_id,
           kind, body_text, content_state, purge_eligible_at, created_at
         ) VALUES (
           $1, $2, 1, $3, $4, 'text', 'intent-keep', 'live', now() + interval '90 days', now()
         )`,
        [messageId, conversationId, from.userId, randomUUID()],
      );
      await persistWebPushDeliveryIntent(client, payload);
      const jobId = await jobs.tryEnqueueWebPushJob(client, payload);
      expect(jobId).toBeNull();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const msg = await pool.query(`SELECT body_text FROM messages WHERE id = $1`, [
      messageId,
    ]);
    expect(msg.rows[0]?.body_text).toBe("intent-keep");
    const intent = await pool.query<{ status: string }>(
      `SELECT status FROM web_push_delivery_intents
       WHERE message_id = $1 AND recipient_user_id = $2`,
      [messageId, to.userId],
    );
    expect(intent.rows[0]?.status).toBe("pending");

    await seedSubscription(to, "recover-device");
    sent.length = 0;
    const enqueued: typeof payload[] = [];
    const recovered = await recoverPendingWebPushIntents({
      pool,
      enqueueInTx: async (_client, deliverPayload) => {
        // Same-TX enqueue success simulated; deliver after recover commits.
        enqueued.push(deliverPayload as typeof payload);
        return true;
      },
    });
    expect(recovered.recovered).toBeGreaterThanOrEqual(1);
    const queued = await pool.query<{ status: string }>(
      `SELECT status FROM web_push_delivery_intents
       WHERE message_id = $1 AND recipient_user_id = $2`,
      [messageId, to.userId],
    );
    expect(queued.rows[0]?.status).toBe("queued");
    expect(enqueued.length).toBeGreaterThanOrEqual(1);

    const outcome = await deliverWebPushJob({
      pool,
      env,
      transport,
      payload: enqueued[0]!,
    });
    expect(outcome.delivered).toBeGreaterThanOrEqual(1);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const after = await pool.query<{ status: string }>(
      `SELECT status FROM web_push_delivery_intents
       WHERE message_id = $1 AND recipient_user_id = $2`,
      [messageId, to.userId],
    );
    expect(after.rows[0]?.status).toBe("consumed");
  });
});
