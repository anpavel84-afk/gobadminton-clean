import type { AppEnv } from "../config/env";
import { deliverEmail, cleanupEmail, ensureEmailQueues, isEmailDeliveryPayload } from "../auth/email-delivery";
import { emailAuthEnabled, EMAIL_DELIVERY_QUEUE, EMAIL_CLEANUP_QUEUE } from "../auth/email-security";
import type { MailTransport } from "../auth/mail-transport";
import type { Pool } from "pg";
import type { Db, Job, PgBoss } from "pg-boss";
import {
  createLibraryWebPushTransport,
  deliverWebPushJob,
  recoverPendingWebPushIntents,
  type WebPushTransport,
} from "../push/push-delivery";
import { GameRemindersCommand } from "../games/game-reminders.command";
import { postGameWritesEnabled } from "../games/game-outcomes.policy";
import {
  POSTGAME_REMINDERS_SWEEP_QUEUE,
  POSTGAME_REMINDERS_SWEEP_SINGLETON_KEY,
  SOCIAL_EXPIRY_CLEANUP_QUEUE,
  SOCIAL_EXPIRY_SWEEP_SINGLETON_KEY,
  WEB_PUSH_DELIVER_QUEUE,
  WEB_PUSH_INTENT_RECOVER_SINGLETON_KEY,
} from "./constants";
import { fromPoolClient } from "./from-pool-client";
import {
  isPostgameRemindersSweepPayload,
  isSocialExpiryCleanupPayload,
  isWebPushDeliverPayload,
  isWebPushMessageDeliverPayload,
  sanitizeJobLogFields,
  type PostgameRemindersSweepPayload,
  type SocialExpiryCleanupPayload,
  type WebPushDeliverPayload,
} from "./payloads";
import {
  createPgBoss,
  ensurePostgameRemindersQueues,
  ensureSocialExpiryQueues,
  ensureWebPushQueues,
} from "./pg-boss.factory";
import {
  SocialExpiryCleanupCommand,
  type SqlExecutor,
} from "./social-expiry-cleanup.command";

export type WorkerRuntime = {
  boss: PgBoss;
  stop: () => Promise<void>;
};

/**
 * Executable worker lifecycle for the same backend release as the API.
 * Registers the narrow social expiry cleanup job + recurring sweep schedule.
 */
export async function startWorkerRuntime(input: {
  connectionString: string;
  pool: Pool;
  gitSha: string;
  maxPool?: number;
  email?: {env: AppEnv; transport: MailTransport};
  /** Optional env for feature gates (WEB_PUSH_ENABLED / VAPID). */
  env?: AppEnv;
  /** Injectable push transport for disposable tests; library default when omitted. */
  pushTransport?: WebPushTransport;
}): Promise<WorkerRuntime> {
  const boss = createPgBoss({
    connectionString: input.connectionString,
    role: "worker",
    max: input.maxPool ?? 4,
  });

  boss.on("error", (error: Error) => {
    console.error(
      JSON.stringify({
        event: "worker_pgboss_error",
        message: error.message,
      }),
    );
  });

  await boss.start();
  await ensureSocialExpiryQueues(boss);

  const cleanup = new SocialExpiryCleanupCommand();

  await boss.work(
    SOCIAL_EXPIRY_CLEANUP_QUEUE,
    {
      batchSize: 1,
      localConcurrency: 1,
      pollingIntervalSeconds: 1,
      transactional: true as const,
      transactionTimeoutSeconds: 60,
    },
    async (jobs: Job<SocialExpiryCleanupPayload>[], tx: Db) => {
      const [job] = jobs;
      if (!job) return;
      if (!isSocialExpiryCleanupPayload(job.data)) {
        console.error(
          JSON.stringify({
            event: "worker_invalid_payload",
            queue: SOCIAL_EXPIRY_CLEANUP_QUEUE,
            jobId: job.id,
          }),
        );
        throw new Error("INVALID_JOB_PAYLOAD");
      }
      const kind = job.data.kind;
      const userId =
        job.data.kind === "looking_intent" ? job.data.userId : undefined;
      const conversationId =
        job.data.kind === "dm_request" ? job.data.conversationId : undefined;
      const invitationId =
        job.data.kind === "invitation" ? job.data.invitationId : undefined;
      console.info(
        JSON.stringify(
          sanitizeJobLogFields({
            queue: SOCIAL_EXPIRY_CLEANUP_QUEUE,
            jobId: job.id,
            kind,
            userId,
            conversationId,
            invitationId,
          }),
        ),
      );

      const exec: SqlExecutor = {
        query: async <T = Record<string, unknown>>(
          text: string,
          values?: unknown[],
        ) => {
          const result = await tx.executeSql(text, values);
          return { rows: result.rows as T[] };
        },
      };
      const result = await cleanup.execute(exec, job.data);

      console.info(
        JSON.stringify({
          event: "job_completed",
          queue: SOCIAL_EXPIRY_CLEANUP_QUEUE,
          jobId: job.id,
          kind,
          lookingDeactivated: result.lookingDeactivated,
          radarDeleted: result.radarDeleted,
          dmRequestsExpired: result.dmRequestsExpired,
          dmMessagesPurged: result.dmMessagesPurged,
          invitationsExpired: result.invitationsExpired,
          gameChatsClosed: result.gameChatsClosed,
        }),
      );
      return result;
    },
  );

  if (input.email && emailAuthEnabled(input.email.env)) {
    await ensureEmailQueues(boss);
    const email = input.email;
    await boss.work(EMAIL_DELIVERY_QUEUE, {batchSize: 10, localConcurrency: 1, pollingIntervalSeconds: 1}, async jobs => {
      for (const job of jobs) {
        if (!isEmailDeliveryPayload(job.data)) throw new Error("INVALID_EMAIL_JOB");
        await deliverEmail({pool: input.pool, env: email.env, transport: email.transport, payload: job.data});
      }
    });
    await boss.work(EMAIL_CLEANUP_QUEUE, {batchSize: 1, pollingIntervalSeconds: 1}, async () => cleanupEmail(input.pool));
    await boss.schedule(EMAIL_CLEANUP_QUEUE, "* * * * *", {}, {tz:"UTC",singletonKey:"email-cleanup"});
  }

  const pushEnv = input.env ?? input.email?.env;
  if (pushEnv?.WEB_PUSH_ENABLED) {
    await ensureWebPushQueues(boss);
    const transport =
      input.pushTransport ??
      createLibraryWebPushTransport({
        VAPID_PUBLIC_KEY: pushEnv.VAPID_PUBLIC_KEY!,
        VAPID_PRIVATE_KEY: pushEnv.VAPID_PRIVATE_KEY!,
        VAPID_SUBJECT: pushEnv.VAPID_SUBJECT!,
      });
    await boss.work(
      WEB_PUSH_DELIVER_QUEUE,
      {
        batchSize: 1,
        localConcurrency: 1,
        pollingIntervalSeconds: 1,
      },
      async (jobs: Job<WebPushDeliverPayload>[]) => {
        for (const job of jobs) {
          if (!isWebPushDeliverPayload(job.data)) {
            console.error(
              JSON.stringify({
                event: "worker_invalid_payload",
                queue: WEB_PUSH_DELIVER_QUEUE,
                jobId: job.id,
              }),
            );
            throw new Error("INVALID_JOB_PAYLOAD");
          }
          if (job.data.kind === "recover_intents") {
            const recovered = await recoverPendingWebPushIntents({
              pool: input.pool,
              enqueueInTx: async (client, payload) => {
                const jobId = await boss.send(WEB_PUSH_DELIVER_QUEUE, payload, {
                  db: fromPoolClient(client),
                  singletonKey: `push:${payload.messageId}:${payload.recipientUserId}`,
                  retryLimit: 5,
                  retryDelay: 5,
                  retryBackoff: true,
                  expireInSeconds: 600,
                });
                return jobId != null;
              },
            });
            console.info(
              JSON.stringify({
                event: "job_completed",
                queue: WEB_PUSH_DELIVER_QUEUE,
                jobId: job.id,
                kind: "recover_intents",
                recovered: recovered.recovered,
                failed: recovered.failed,
              }),
            );
            continue;
          }
          if (!isWebPushMessageDeliverPayload(job.data)) {
            throw new Error("INVALID_JOB_PAYLOAD");
          }
          console.info(
            JSON.stringify(
              sanitizeJobLogFields({
                queue: WEB_PUSH_DELIVER_QUEUE,
                jobId: job.id,
                kind: job.data.kind,
                messageId: job.data.messageId,
                conversationId: job.data.conversationId,
                recipientUserId: job.data.recipientUserId,
              }),
            ),
          );
          const result = await deliverWebPushJob({
            pool: input.pool,
            env: pushEnv,
            payload: job.data,
            transport,
          });
          console.info(
            JSON.stringify({
              event: "job_completed",
              queue: WEB_PUSH_DELIVER_QUEUE,
              jobId: job.id,
              kind: job.data.kind,
              delivered: result.delivered,
              skipped: result.skipped,
              cleaned: result.cleaned,
              failedTransient: result.failedTransient,
            }),
          );
          // Any known transient device failure must retry; sent claims skip on reclaim.
          if (result.failedTransient > 0) {
            throw new Error("PUSH_TRANSPORT_TRANSIENT");
          }
        }
      },
    );

    // Bounded recover of durable intents left pending when same-TX enqueue failed.
    await boss.schedule(
      WEB_PUSH_DELIVER_QUEUE,
      "* * * * *",
      { kind: "recover_intents" } satisfies WebPushDeliverPayload,
      {
        tz: "UTC",
        singletonKey: WEB_PUSH_INTENT_RECOVER_SINGLETON_KEY,
        missed: "once",
        retryLimit: 2,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 120,
      },
    );
  }

  // Recurring bounded sweep (~every minute). Correctness does not depend on it.
  await boss.schedule(
    SOCIAL_EXPIRY_CLEANUP_QUEUE,
    "* * * * *",
    { kind: "sweep" } satisfies SocialExpiryCleanupPayload,
    {
      tz: "UTC",
      singletonKey: SOCIAL_EXPIRY_SWEEP_SINGLETON_KEY,
      missed: "once",
      retryLimit: 3,
      retryDelay: 2,
      retryBackoff: true,
      expireInSeconds: 120,
    },
  );

  // #457 internal post-game reminders — only when POST_GAME_INTERNAL_ENABLED admits writes.
  const remindersEnv = input.env ?? input.email?.env;
  if (remindersEnv && postGameWritesEnabled(remindersEnv)) {
    await ensurePostgameRemindersQueues(boss);
    const reminders = new GameRemindersCommand(remindersEnv);
    await boss.work(
      POSTGAME_REMINDERS_SWEEP_QUEUE,
      {
        batchSize: 1,
        localConcurrency: 1,
        pollingIntervalSeconds: 1,
        transactional: true as const,
        transactionTimeoutSeconds: 60,
      },
      async (jobs: Job<PostgameRemindersSweepPayload>[], tx: Db) => {
        const [job] = jobs;
        if (!job) return;
        if (!isPostgameRemindersSweepPayload(job.data)) {
          console.error(
            JSON.stringify({
              event: "worker_invalid_payload",
              queue: POSTGAME_REMINDERS_SWEEP_QUEUE,
              jobId: job.id,
            }),
          );
          throw new Error("INVALID_JOB_PAYLOAD");
        }
        console.info(
          JSON.stringify(
            sanitizeJobLogFields({
              queue: POSTGAME_REMINDERS_SWEEP_QUEUE,
              jobId: job.id,
              kind: job.data.kind,
            }),
          ),
        );
        const exec: SqlExecutor = {
          query: async <T = Record<string, unknown>>(
            text: string,
            values?: unknown[],
          ) => {
            const result = await tx.executeSql(text, values);
            return { rows: result.rows as T[] };
          },
        };
        // Probe uses same exec; command probes to_regclass before domain work.
        const result = await reminders.execute(exec, job.data);
        console.info(
          JSON.stringify({
            event: "job_completed",
            queue: POSTGAME_REMINDERS_SWEEP_QUEUE,
            jobId: job.id,
            kind: job.data.kind,
            scanned: result.scanned,
            ensured: result.ensured,
            activated: result.activated,
            stopped: result.stopped,
            skipped: result.skipped,
            skipReason: result.skipReason,
          }),
        );
        return result;
      },
    );
    await boss.schedule(
      POSTGAME_REMINDERS_SWEEP_QUEUE,
      "* * * * *",
      { kind: "sweep" } satisfies PostgameRemindersSweepPayload,
      {
        tz: "UTC",
        singletonKey: POSTGAME_REMINDERS_SWEEP_SINGLETON_KEY,
        missed: "once",
        retryLimit: 3,
        retryDelay: 2,
        retryBackoff: true,
        expireInSeconds: 120,
      },
    );
  }

  console.log(
    JSON.stringify({
      event: "worker_started",
      queue: SOCIAL_EXPIRY_CLEANUP_QUEUE,
      gitSha: input.gitSha,
      poolMax: input.maxPool ?? 4,
    }),
  );

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: "worker_stopping" }));
    await boss.stop({ graceful: true, timeout: 30_000, close: true });
    console.log(JSON.stringify({ event: "worker_stopped" }));
  };

  return { boss, stop };
}
