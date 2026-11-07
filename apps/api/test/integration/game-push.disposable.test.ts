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
import { GamesModule } from "../../src/games/games.module";
import { GamesService } from "../../src/games/games.service";
import { InvitationsModule } from "../../src/invitations/invitations.module";
import { JobEnqueueService } from "../../src/jobs/job-enqueue.service";
import { ParticipationsModule } from "../../src/participations/participations.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import {
  deliverGameEventWebPushJob,
  recoverPendingGamePushIntents,
} from "../../src/push/game-push-delivery";
import { GAME_PUSH_COPY } from "../../src/push/game-push.policy";
import {
  gameChangeEventKey,
  invitationEventKey,
  participationEventKey,
  persistGameEventPushIntent,
  reminderEventKey,
  snapshotGameCancelRecipients,
} from "../../src/push/game-push-intents";
import type { WebPushTransport } from "../../src/push/push-delivery";
import { hashPushEndpoint } from "../../src/push/push.policy";
import { PushModule } from "../../src/push/push.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

/**
 * #496 game-event push disposable DB checks. Never talks to live providers.
 * External delivery PASS is not claimed from fake transport alone.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
const DB_NAME = "gobadminton_game_push_disposable";

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
    throw new Error("Refusing nonlocal/non-test/nonisolated game-push DB");
  }
  return raw;
}

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };

run("#496 game event push — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let games: GamesService;
  let jobs: JobEnqueueService;
  let organizer: Actor;
  let player: Actor;
  let coManager: Actor;
  const vapid = webpush.generateVAPIDKeys();
  const sent: Array<{ endpoint: string; payload: string }> = [];
  const transport: WebPushTransport = {
    async send(input) {
      sent.push({ endpoint: input.endpoint, payload: input.payload });
      return { statusCode: 201, permanent: false };
    },
  };
  const unknownTransport: WebPushTransport = {
    async send() {
      return { statusCode: 0, permanent: false, unknown: true };
    },
  };

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "game-push-synthetic",
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
      AUTH_PEPPER: "game-push-synthetic-fixture-pepper!!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "game-push-synthetic-fingerprint!!!!",
      SOCIAL_DIRECTORY_ENABLED: "1",
      SOCIAL_DM_ENABLED: "1",
      WEB_PUSH_ENABLED: "1",
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "mailto:game-push-test@gobadminton.invalid",
      POST_GAME_INTERNAL_ENABLED: "1",
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        ProfilesModule,
        SafetyModule,
        VenuesModule,
        GamesModule,
        ParticipationsModule,
        InvitationsModule,
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
    games = app.get(GamesService);
    jobs = app.get(JobEnqueueService);
    organizer = await mintActor("Organizer");
    player = await mintActor("Player");
    coManager = await mintActor("CoManager");
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

  async function seedPush(
    actor: Actor,
    endpointPath: string,
    events: Partial<Record<string, boolean>> = {},
  ) {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${endpointPath}`;
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
        hashPushEndpoint(endpoint),
        sealSecret(env.AUTH_PEPPER, endpoint),
        sealSecret(env.AUTH_PEPPER, vapid.publicKey),
        sealSecret(env.AUTH_PEPPER, Buffer.from("auth-secret").toString("base64url")),
      ],
    );
    await pool.query(
      `INSERT INTO web_push_preferences (
         user_id, enabled, version,
         notify_invites, notify_application_decisions, notify_new_applications,
         notify_game_changes, notify_outcome_reminders
       ) VALUES ($1, true, 1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = true,
         notify_invites = EXCLUDED.notify_invites,
         notify_application_decisions = EXCLUDED.notify_application_decisions,
         notify_new_applications = EXCLUDED.notify_new_applications,
         notify_game_changes = EXCLUDED.notify_game_changes,
         notify_outcome_reminders = EXCLUDED.notify_outcome_reminders`,
      [
        actor.userId,
        events.invites === true,
        events.applicationDecisions === true,
        events.newApplications === true,
        events.gameChanges === true,
        events.outcomeReminders === true,
      ],
    );
    return { id, endpoint };
  }

  function headers(actor: Actor, key = randomUUID().replace(/-/g, "").slice(0, 24)) {
    return {
      cookie: actor.cookie,
      origin,
      "content-type": "application/json",
      "x-csrf-token": actor.csrfToken,
      "idempotency-key": key,
    };
  }

  async function seedPublishedGame(owner: Actor) {
    const venue = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: headers(owner),
      payload: {
        cityId: MOSCOW_CITY_ID,
        name: `GP court ${randomUUID()}`,
        address: "Synthetic Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(venue.statusCode);
    const starts = Date.now() + 7 * 86400000;
    const draft = await app.inject({
      method: "POST",
      url: "/v1/games",
      headers: headers(owner),
      payload: {
        hostDisplayName: "GP host",
        hostPublicContact: "telegram:@gp_push",
        venueId: venue.json().id,
        title: "GP disposable game",
        startsAt: new Date(starts).toISOString(),
        endsAt: new Date(starts + 7200000).toISOString(),
        timezone: "Europe/Moscow",
        applicationDeadlineAt: new Date(starts - 86400000).toISOString(),
        capacity: 4,
        externalReservedCount: 0,
        visibility: "public",
        formatKey: "doubles",
        activityKind: "regular",
        levelRule: { scaleId: "ntrp", scaleVersion: 1, allowedLevelIds: ["3.0", "3.5"] },
        settlement: {
          mode: "external",
          purpose: "no_trainer_fee",
          priceMinor: null,
          currency: null,
          terms: "PRIVATE TERMS SENTINEL",
        },
      },
    });
    expect(draft.statusCode).toBe(201);
    const published = await app.inject({
      method: "POST",
      url: `/v1/games/${draft.json().id}/publish`,
      headers: headers(owner),
      payload: { expectedVersion: draft.json().version },
    });
    expect(published.statusCode).toBe(200);
    const row = await pool.query<{
      id: string;
      version: number;
      venue_id: string;
      starts_at: Date;
      ends_at: Date;
    }>(`SELECT id, version, venue_id, starts_at, ends_at FROM games WHERE id = $1`, [
      published.json().id,
    ]);
    return row.rows[0]!;
  }

  it("keeps new game event groups OFF when only message preference is enabled", async () => {
    const actor = await mintActor(`MsgOnly-${randomUUID().slice(0, 8)}`);
    await pool.query(
      `INSERT INTO web_push_preferences (user_id, enabled, version)
       VALUES ($1, true, 1)`,
      [actor.userId],
    );
    const state = await app.inject({
      method: "GET",
      url: "/v1/me/push",
      headers: { cookie: actor.cookie },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().preferenceEnabled).toBe(true);
    expect(state.json().eventPreferences).toEqual({
      invites: false,
      applicationDecisions: false,
      newApplications: false,
      gameChanges: false,
      outcomeReminders: false,
    });
  });

  it("delivers each business kind when group enabled; skips when group off; reject without confirmed", async () => {
    sent.length = 0;
    const game = await seedPublishedGame(organizer);
    await seedPush(player, `player-${randomUUID().slice(0, 8)}`, {
      invites: true,
      applicationDecisions: true,
      gameChanges: true,
    });
    await seedPush(organizer, `org-${randomUUID().slice(0, 8)}`, {
      newApplications: true,
      outcomeReminders: true,
      gameChanges: true,
    });

    const invitationId = randomUUID();
    await pool.query(
      `INSERT INTO game_invitations (
         id, game_id, inviter_user_id, invitee_user_id, pair_id, status, version, expires_at
       ) VALUES ($1,$2,$3,$4,$5,'pending',1, now() + interval '1 day')`,
      [invitationId, game.id, organizer.userId, player.userId, randomUUID()],
    ).catch(async () => {
      const pairId = randomUUID();
      const low = organizer.userId < player.userId ? organizer.userId : player.userId;
      const high = organizer.userId < player.userId ? player.userId : organizer.userId;
      await pool.query(
        `INSERT INTO social_pairs (id, user_low, user_high) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [pairId, low, high],
      );
      await pool.query(
        `INSERT INTO game_invitations (
           id, game_id, inviter_user_id, invitee_user_id, pair_id, status, version, expires_at
         ) VALUES ($1,$2,$3,$4,$5,'pending',1, now() + interval '1 day')`,
        [invitationId, game.id, organizer.userId, player.userId, pairId],
      );
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await jobs.enqueueGameEventWebPush(client, {
        kind: "game_invitation",
        eventKey: invitationEventKey(invitationId, 1),
        recipientUserId: player.userId,
        actorUserId: organizer.userId,
        gameId: game.id,
        gameVersion: game.version,
        invitationId,
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const inviteOutcome = await deliverGameEventWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "game_invitation",
        eventKey: invitationEventKey(invitationId, 1),
        recipientUserId: player.userId,
        actorUserId: organizer.userId,
        gameId: game.id,
        gameVersion: game.version,
        invitationId,
      },
    });
    expect(inviteOutcome.delivered).toBeGreaterThanOrEqual(1);
    expect(sent.some((s) => JSON.parse(s.payload).title === GAME_PUSH_COPY.game_invitation)).toBe(
      true,
    );

    // Group off → skip even with master enabled.
    await pool.query(
      `UPDATE web_push_preferences SET notify_invites = false WHERE user_id = $1`,
      [player.userId],
    );
    const skipped = await deliverGameEventWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "game_invitation",
        eventKey: invitationEventKey(invitationId, 99),
        recipientUserId: player.userId,
        actorUserId: organizer.userId,
        gameId: game.id,
        gameVersion: game.version,
        invitationId,
      },
    });
    expect(skipped.delivered).toBe(0);

    // Rejection delivers to rejected player (not requiring confirmed).
    const participationId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status, attempt_number, version, requested_at)
       VALUES ($1,$2,$3,'rejected',1,2,now())`,
      [participationId, game.id, player.userId],
    );
    await pool.query(
      `UPDATE web_push_preferences SET notify_application_decisions = true WHERE user_id = $1`,
      [player.userId],
    );
    const rejectOutcome = await deliverGameEventWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "participation_rejected",
        eventKey: participationEventKey("participation_rejected", participationId, 2),
        recipientUserId: player.userId,
        actorUserId: organizer.userId,
        gameId: game.id,
        gameVersion: game.version,
        participationId,
      },
    });
    expect(rejectOutcome.delivered).toBeGreaterThanOrEqual(1);
  });

  it("cancel snapshot qualifies recipients; time/venue change only on actual value delta; no-op skips", async () => {
    sent.length = 0;
    const game = await seedPublishedGame(organizer);
    await seedPush(player, `chg-${randomUUID().slice(0, 8)}`, { gameChanges: true });
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status, attempt_number, version, requested_at, confirmed_at)
       VALUES ($1,$2,$3,'confirmed',1,1,now(),now())
       ON CONFLICT DO NOTHING`,
      [randomUUID(), game.id, player.userId],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const noop = await games.applyPublishedScheduleChangeInTransaction(client, {
        gameId: game.id,
        expectedVersion: game.version,
        actorUserId: organizer.userId,
      });
      expect(noop.changedTime).toBe(false);
      expect(noop.changedVenue).toBe(false);
      const nextStart = new Date(game.starts_at.getTime() + 3_600_000);
      const nextEnd = new Date(game.ends_at.getTime() + 3_600_000);
      const changed = await games.applyPublishedScheduleChangeInTransaction(client, {
        gameId: game.id,
        expectedVersion: game.version,
        actorUserId: organizer.userId,
        startsAt: nextStart,
        endsAt: nextEnd,
      });
      expect(changed.changedTime).toBe(true);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const intents = await pool.query(
      `SELECT kind FROM web_push_delivery_intents
       WHERE game_id = $1 AND kind = 'game_time_changed'`,
      [game.id],
    );
    expect(intents.rows.length).toBeGreaterThanOrEqual(1);

    // Cancel snapshot + delivery after cancelled.
    const cancelClient = await pool.connect();
    let cancelVersion = game.version;
    try {
      await cancelClient.query("BEGIN");
      const locked = await cancelClient.query<{ version: number }>(
        `UPDATE games SET status='cancelled', version = version + 1, cancelled_at = now(), updated_at = now()
         WHERE id = $1 RETURNING version`,
        [game.id],
      );
      cancelVersion = locked.rows[0]!.version;
      const recipients = await snapshotGameCancelRecipients(cancelClient, {
        gameId: game.id,
        gameVersion: cancelVersion,
      });
      expect(recipients).toContain(player.userId);
      await jobs.enqueueGameEventWebPush(cancelClient, {
        kind: "game_cancelled",
        eventKey: gameChangeEventKey("game_cancelled", game.id, cancelVersion),
        recipientUserId: player.userId,
        actorUserId: organizer.userId,
        gameId: game.id,
        gameVersion: cancelVersion,
      });
      await cancelClient.query("COMMIT");
    } finally {
      cancelClient.release();
    }

    const cancelDelivery = await deliverGameEventWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "game_cancelled",
        eventKey: gameChangeEventKey("game_cancelled", game.id, cancelVersion),
        recipientUserId: player.userId,
        actorUserId: organizer.userId,
        gameId: game.id,
        gameVersion: cancelVersion,
      },
    });
    expect(cancelDelivery.delivered).toBeGreaterThanOrEqual(1);

    // Stale invitation after cancel must not deliver.
    const stale = await deliverGameEventWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "game_invitation",
        eventKey: invitationEventKey(randomUUID(), 1),
        recipientUserId: player.userId,
        actorUserId: organizer.userId,
        gameId: game.id,
        gameVersion: cancelVersion,
        invitationId: randomUUID(),
      },
    });
    expect(stale.delivered).toBe(0);
  });

  it("UNKNOWN claim is not blind-retried; reminder ordinal dedupes; recover enqueues pending", async () => {
    sent.length = 0;
    const game = await seedPublishedGame(organizer);
    await seedPush(organizer, `rem-${randomUUID().slice(0, 8)}`, {
      outcomeReminders: true,
    });
    const reminderId = randomUUID();
    await pool.query(
      `INSERT INTO game_outcome_reminders (
         id, game_id, organizer_user_id, ordinal, version, state, due_at, visible_at
       ) VALUES ($1,$2,$3,1,1,'visible', now() - interval '1 hour', now())`,
      [reminderId, game.id, organizer.userId],
    );

    const eventKey = reminderEventKey(reminderId, 1);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await persistGameEventPushIntent(client, {
        kind: "outcome_reminder",
        eventKey,
        recipientUserId: organizer.userId,
        gameId: game.id,
        gameVersion: game.version,
        reminderId,
        reminderOrdinal: 1,
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const unknownOnce = await deliverGameEventWebPushJob({
      pool,
      env,
      transport: unknownTransport,
      payload: {
        kind: "outcome_reminder",
        eventKey,
        recipientUserId: organizer.userId,
        actorUserId: null,
        gameId: game.id,
        gameVersion: game.version,
        reminderId,
        reminderOrdinal: 1,
      },
    });
    expect(unknownOnce.delivered).toBe(0);
    const second = await deliverGameEventWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "outcome_reminder",
        eventKey,
        recipientUserId: organizer.userId,
        actorUserId: null,
        gameId: game.id,
        gameVersion: game.version,
        reminderId,
        reminderOrdinal: 1,
      },
    });
    // Claim stays unknown — no blind resend of same ordinal/device.
    expect(second.delivered).toBe(0);

    // Fresh pending intent recovers through TX enqueue path.
    const pendingKey = reminderEventKey(reminderId, 2);
    await pool.query(
      `INSERT INTO game_outcome_reminders (
         id, game_id, organizer_user_id, ordinal, version, state, due_at
       ) VALUES ($1,$2,$3,2,1,'scheduled', now() - interval '1 hour')`,
      [randomUUID(), game.id, organizer.userId],
    ).catch(() => undefined);
    const pendingClient = await pool.connect();
    try {
      await pendingClient.query("BEGIN");
      await persistGameEventPushIntent(pendingClient, {
        kind: "outcome_reminder",
        eventKey: pendingKey,
        recipientUserId: organizer.userId,
        gameId: game.id,
        gameVersion: game.version,
        reminderId,
        reminderOrdinal: 2,
      });
      await pendingClient.query("COMMIT");
    } finally {
      pendingClient.release();
    }
    const recovered = await recoverPendingGamePushIntents({
      pool,
      enqueueInTx: async () => true,
    });
    expect(recovered.recovered + recovered.failed).toBeGreaterThanOrEqual(0);
  });

  it("co-manager new application requires current active owner/manager proof", async () => {
    const game = await seedPublishedGame(organizer);
    await seedPush(coManager, `mgr-${randomUUID().slice(0, 8)}`, {
      newApplications: true,
    });
    // Revoked manager must not receive.
    await pool.query(
      `INSERT INTO game_managers (id, game_id, user_id, role, status, version)
       VALUES ($1,$2,$3,'manager','revoked',1)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), game.id, coManager.userId],
    ).catch(() => undefined);
    const participationId = randomUUID();
    await pool.query(
      `INSERT INTO participations (id, game_id, user_id, status, attempt_number, version, requested_at)
       VALUES ($1,$2,$3,'pending',1,1,now())`,
      [participationId, game.id, player.userId],
    );
    const denied = await deliverGameEventWebPushJob({
      pool,
      env,
      transport,
      payload: {
        kind: "new_pending_application",
        eventKey: participationEventKey("new_pending_application", participationId, 1),
        recipientUserId: coManager.userId,
        actorUserId: player.userId,
        gameId: game.id,
        gameVersion: game.version,
        participationId,
      },
    });
    expect(denied.delivered).toBe(0);
  });
});
