import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { PgBoss } from "pg-boss";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import {
  SOCIAL_EXPIRY_CLEANUP_QUEUE,
  SOCIAL_EXPIRY_SWEEP_SINGLETON_KEY,
} from "./constants";
import { fromPoolClient } from "./from-pool-client";
import type { SocialExpiryCleanupPayload } from "./payloads";
import { createPgBoss, ensureSocialExpiryQueues } from "./pg-boss.factory";

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
}
