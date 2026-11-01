import { createMailTransport } from "./auth/smtp-mail-transport";
import { emailAuthEnabled } from "./auth/email-security";
import "reflect-metadata";
import { loadEnv } from "./config/env";
import { createDatabase } from "./database/client";
import { startWorkerRuntime } from "./jobs/worker-runtime";

async function bootstrap(): Promise<void> {
  const env = loadEnv({
    ...process.env,
    SERVICE_NAME: process.env.SERVICE_NAME ?? "gobadminton-worker",
  });
  const database = createDatabase(env.DATABASE_URL);
  const runtime = await startWorkerRuntime({
    connectionString: env.DATABASE_URL,
    pool: database.pool,
    gitSha: env.GIT_SHA,
    ...(emailAuthEnabled(env) ? {email: {env, transport: createMailTransport(env)}} : {}),
    maxPool: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "4", 10) || 4,
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(JSON.stringify({ event: "worker_signal", signal }));
    try {
      await runtime.stop();
    } finally {
      await database.pool.end().catch(() => undefined);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
