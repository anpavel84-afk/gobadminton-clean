import { PgBoss } from "pg-boss";
import {
  SOCIAL_EXPIRY_CLEANUP_DEAD_LETTER_QUEUE,
  SOCIAL_EXPIRY_CLEANUP_QUEUE,
} from "./constants";

export type PgBossRole = "api" | "worker";

export function createPgBoss(input: {
  connectionString: string;
  role: PgBossRole;
  max?: number;
  applicationName?: string;
}): PgBoss {
  const max = input.max ?? (input.role === "worker" ? 4 : 2);
  return new PgBoss({
    connectionString: input.connectionString,
    application_name:
      input.applicationName ??
      (input.role === "worker" ? "gobadminton-worker" : "gobadminton-api-jobs"),
    max,
    // API only enqueues inside business transactions; worker owns schedule/supervise.
    schedule: input.role === "worker",
    supervise: input.role === "worker",
    migrate: true,
    createSchema: true,
    // Keep API maintenance off so the worker owns vacuum/supervise.
    monitorVacuum: input.role === "worker",
    reindex: input.role === "worker",
    connectionTimeoutMillis: 30_000,
  });
}

export async function ensureSocialExpiryQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(SOCIAL_EXPIRY_CLEANUP_DEAD_LETTER_QUEUE, {
    retryLimit: 0,
    expireInSeconds: 300,
    retentionSeconds: 14 * 24 * 3600,
    deleteAfterSeconds: 14 * 24 * 3600,
  });
  await boss.createQueue(SOCIAL_EXPIRY_CLEANUP_QUEUE, {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
    retryDelayMax: 60,
    expireInSeconds: 120,
    retentionSeconds: 7 * 24 * 3600,
    deleteAfterSeconds: 7 * 24 * 3600,
    deadLetter: SOCIAL_EXPIRY_CLEANUP_DEAD_LETTER_QUEUE,
  });
}
