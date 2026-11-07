import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import {
  SOCIAL_EXPIRY_CLEANUP_QUEUE,
  SOCIAL_EXPIRY_SWEEP_SINGLETON_KEY,
  WEB_PUSH_DELIVER_QUEUE,
} from "./constants";
import { fromPoolClient } from "./from-pool-client";
import type {
  SocialExpiryCleanupPayload,
  WebPushGameEventDeliverPayload,
  WebPushMessageDeliverPayload,
} from "./payloads";
import {
  createPgBoss,
  ensureSocialExpiryQueues,
  ensureWebPushQueues,
} from "./pg-boss.factory";
import {
  persistGameEventPushIntentOptional,
  type GamePushIntentInput,
} from "../push/game-push-intents";

/** Persist durable push intent in the caller's message transaction. */
export async function persistWebPushDeliveryIntent(
  client: PoolClient,
  payload: WebPushMessageDeliverPayload,
): Promise<void> {
  await client.query(
    `INSERT INTO web_push_delivery_intents (
       message_id, conversation_id, recipient_user_id, author_user_id, kind, game_id, status
     ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (message_id, recipient_user_id) WHERE message_id IS NOT NULL DO NOTHING`,
    [
      payload.messageId,
      payload.conversationId,
      payload.recipientUserId,
      payload.authorUserId,
      payload.kind,
      payload.kind === "game_chat_message" ? payload.gameId : null,
    ],
  );
}

@Injectable()
export class JobEnqueueService implements OnModuleDestroy {
  private boss: PgBoss | null = null;
  private started = false;
  private startPromise: Promise<PgBoss> | null = null;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.boss || !this.started) return;
    await this.boss.stop({ graceful: true, timeout: 15_000, close: true });
    this.started = false;
    this.boss = null;
  }

  /** Test/helper access to the started boss instance. */
  getBoss(): PgBoss {
    if (!this.boss || !this.started) {
      throw new Error("pg-boss enqueue service is not started");
    }
    return this.boss;
  }

  async ensureStarted(): Promise<PgBoss> {
    if (this.boss && this.started) return this.boss;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      const boss = createPgBoss({
        connectionString: this.env.DATABASE_URL,
        role: "api",
        max: 2,
      });
      await boss.start();
      await ensureSocialExpiryQueues(boss);
      if (this.env.WEB_PUSH_ENABLED) {
        await ensureWebPushQueues(boss);
      }
      this.boss = boss;
      this.started = true;
      return boss;
    })();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Enqueue looking-intent expiry cleanup in the same physical transaction
   * as the domain write. Rollback removes the job; commit makes it durable.
   */
  async enqueueLookingIntentExpiry(
    client: PoolClient,
    input: {
      userId: string;
      version: number;
      expiresAt: Date;
    },
  ): Promise<string | null> {
    const boss = await this.ensureStarted();
    const payload: SocialExpiryCleanupPayload = {
      kind: "looking_intent",
      userId: input.userId,
      version: input.version,
    };
    return boss.send(SOCIAL_EXPIRY_CLEANUP_QUEUE, payload, {
      db: fromPoolClient(client),
      startAfter: input.expiresAt,
      // One deferred expiry job per user; later renewals replace the slot.
      singletonKey: `looking:${input.userId}`,
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      expireInSeconds: 120,
    });
  }

  /**
   * Enqueue pending DM request expiry in the same physical transaction
   * as first-contact creation. On-read expiry remains correct if worker is down.
   */
  async enqueueDmRequestExpiry(
    client: PoolClient,
    input: {
      conversationId: string;
      version: number;
      expiresAt: Date;
    },
  ): Promise<string | null> {
    const boss = await this.ensureStarted();
    const payload: SocialExpiryCleanupPayload = {
      kind: "dm_request",
      conversationId: input.conversationId,
      version: input.version,
    };
    return boss.send(SOCIAL_EXPIRY_CLEANUP_QUEUE, payload, {
      db: fromPoolClient(client),
      startAfter: input.expiresAt,
      singletonKey: `dm-request:${input.conversationId}`,
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      expireInSeconds: 120,
    });
  }

  /**
   * Enqueue pending GameInvitation expiry in the same physical transaction
   * as invitation create. On-read expiry remains correct if worker is down.
   */
  async enqueueInvitationExpiry(
    client: PoolClient,
    input: {
      invitationId: string;
      version: number;
      expiresAt: Date;
    },
  ): Promise<string | null> {
    const boss = await this.ensureStarted();
    const payload: SocialExpiryCleanupPayload = {
      kind: "invitation",
      invitationId: input.invitationId,
      version: input.version,
    };
    return boss.send(SOCIAL_EXPIRY_CLEANUP_QUEUE, payload, {
      db: fromPoolClient(client),
      startAfter: input.expiresAt,
      singletonKey: `invitation:${input.invitationId}`,
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      expireInSeconds: 120,
    });
  }

  /**
   * Optional same-TX enqueue of an immediate sweep (used by tests / ops hooks).
   * Production worker also schedules a recurring cron independently.
   */
  async enqueueSweep(
    client: PoolClient,
    options?: {
      startAfter?: Date | number | string;
      singletonKey?: string;
      singletonSeconds?: number;
    },
  ): Promise<string | null> {
    const boss = await this.ensureStarted();
    const payload: SocialExpiryCleanupPayload = { kind: "sweep" };
    return boss.send(SOCIAL_EXPIRY_CLEANUP_QUEUE, payload, {
      db: fromPoolClient(client),
      startAfter: options?.startAfter ?? 0,
      singletonKey: options?.singletonKey ?? SOCIAL_EXPIRY_SWEEP_SINGLETON_KEY,
      singletonSeconds: options?.singletonSeconds ?? 30,
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      expireInSeconds: 120,
    });
  }

  /**
   * Same physical TX as message commit: durable intent always lands with the
   * message. PgBoss enqueue is isolated via SAVEPOINT — queue/provider outage
   * must not roll back a valid message. Pending intents are recovered by the
   * existing worker schedule (not a new service). Never carries message text/secrets.
   */
  async enqueueWebPushDeliver(
    client: PoolClient,
    payload: WebPushMessageDeliverPayload,
  ): Promise<string | null> {
    if (!this.env.WEB_PUSH_ENABLED) return null;
    if (payload.recipientUserId === payload.authorUserId) return null;
    await persistWebPushDeliveryIntent(client, payload);
    return this.tryEnqueueWebPushJob(client, payload);
  }

  /**
   * Same physical TX as business mutation: durable game-event intent lands when
   * possible (isolated via SAVEPOINT so a failed INSERT cannot abort domain).
   * PgBoss enqueue isolated via its own SAVEPOINT. Excludes actor/self.
   * Never throws into the caller business TX.
   */
  async enqueueGameEventWebPush(
    client: PoolClient,
    input: GamePushIntentInput,
  ): Promise<string | null> {
    try {
      if (!this.env.WEB_PUSH_ENABLED) return null;
      if (input.actorUserId && input.recipientUserId === input.actorUserId) {
        return null;
      }
      const persisted = await persistGameEventPushIntentOptional(client, input);
      if (!persisted) return null;
      const payload: WebPushGameEventDeliverPayload = {
        kind: input.kind,
        eventKey: input.eventKey,
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId ?? null,
        gameId: input.gameId,
        gameVersion: input.gameVersion,
        invitationId: input.invitationId ?? null,
        participationId: input.participationId ?? null,
        reminderId: input.reminderId ?? null,
        reminderOrdinal: input.reminderOrdinal ?? null,
      };
      return await this.tryEnqueueGameEventWebPushJob(client, payload);
    } catch {
      return null;
    }
  }

  /**
   * Attempt same-TX pg-boss send. On queue SQL / boss failure, rolls back only
   * the savepoint and leaves the durable intent pending for worker recovery.
   */
  async tryEnqueueWebPushJob(
    client: PoolClient,
    payload: WebPushMessageDeliverPayload,
  ): Promise<string | null> {
    if (!this.env.WEB_PUSH_ENABLED) return null;
    if (payload.recipientUserId === payload.authorUserId) return null;
    let boss: PgBoss;
    try {
      boss = await this.ensureStarted();
    } catch {
      return null;
    }
    await client.query("SAVEPOINT web_push_enqueue");
    try {
      const jobId = await boss.send(WEB_PUSH_DELIVER_QUEUE, payload, {
        db: fromPoolClient(client),
        singletonKey: `push:${payload.messageId}:${payload.recipientUserId}`,
        retryLimit: 5,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 600,
      });
      await client.query(
        `UPDATE web_push_delivery_intents
         SET status = 'queued', updated_at = now()
         WHERE message_id = $1
           AND recipient_user_id = $2
           AND status = 'pending'`,
        [payload.messageId, payload.recipientUserId],
      );
      await client.query("RELEASE SAVEPOINT web_push_enqueue");
      return jobId;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT web_push_enqueue");
      return null;
    }
  }

  async tryEnqueueGameEventWebPushJob(
    client: PoolClient,
    payload: WebPushGameEventDeliverPayload,
  ): Promise<string | null> {
    if (!this.env.WEB_PUSH_ENABLED) return null;
    if (payload.actorUserId && payload.recipientUserId === payload.actorUserId) {
      return null;
    }
    let boss: PgBoss;
    try {
      boss = await this.ensureStarted();
    } catch {
      return null;
    }
    await client.query("SAVEPOINT web_push_game_enqueue");
    try {
      const jobId = await boss.send(WEB_PUSH_DELIVER_QUEUE, payload, {
        db: fromPoolClient(client),
        singletonKey: `push-game:${payload.eventKey}:${payload.recipientUserId}`,
        retryLimit: 5,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 600,
      });
      await client.query(
        `UPDATE web_push_delivery_intents
         SET status = 'queued', updated_at = now()
         WHERE event_key = $1
           AND recipient_user_id = $2
           AND status = 'pending'`,
        [payload.eventKey, payload.recipientUserId],
      );
      await client.query("RELEASE SAVEPOINT web_push_game_enqueue");
      return jobId;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT web_push_game_enqueue");
      return null;
    }
  }

  /** Enqueue outside a message TX (worker intent recovery). */
  async enqueueWebPushDeliverOutsideTx(
    payload: WebPushMessageDeliverPayload,
  ): Promise<string | null> {
    if (!this.env.WEB_PUSH_ENABLED) return null;
    if (payload.recipientUserId === payload.authorUserId) return null;
    const boss = await this.ensureStarted();
    return boss.send(WEB_PUSH_DELIVER_QUEUE, payload, {
      singletonKey: `push:${payload.messageId}:${payload.recipientUserId}`,
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 600,
    });
  }
}
