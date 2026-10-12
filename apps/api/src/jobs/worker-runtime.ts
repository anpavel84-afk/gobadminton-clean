import type { AppEnv } from "../config/env";
import { deliverEmail, cleanupEmail, ensureEmailQueues, isEmailDeliveryPayload } from "../auth/email-delivery";
import { emailAuthEnabled, EMAIL_DELIVERY_QUEUE, EMAIL_CLEANUP_QUEUE } from "../auth/email-security";
import type { MailTransport } from "../auth/mail-transport";
import type { Pool } from "pg";
import type { Db, Job, PgBoss } from "pg-boss";
import {
  SOCIAL_EXPIRY_CLEANUP_QUEUE,
  SOCIAL_EXPIRY_SWEEP_SINGLETON_KEY,
} from "./constants";
import {
  isSocialExpiryCleanupPayload,
  sanitizeJobLogFields,
  type SocialExpiryCleanupPayload,
} from "./payloads";
import { createPgBoss, ensureSocialExpiryQueues } from "./pg-boss.factory";
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
