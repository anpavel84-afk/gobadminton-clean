import { Pool } from "pg";
import { z } from "zod";
import { loadEnv } from "../config/env";
import { bootstrapFirstAdmin } from "./admin-db";
async function main() {
  // Never reads production credential files, creates users, selects real staff or prints token bytes.
  const env = loadEnv();
  if (
    !env.ADMIN_INTERNAL_ENABLED ||
    env.NODE_ENV !== "test" ||
    env.APP_ENV !== "local" ||
    process.env.ADMIN_BOOTSTRAP_SOURCE_TEST !== "1"
  )
    throw new Error("Bootstrap is source/disposable-test only");
  const input = z
    .object({
      userId: z.string().uuid(),
      operationId: z.string().uuid(),
      activationToken: z.string().min(32).max(256),
    })
    .parse({
      userId: process.env.ADMIN_BOOTSTRAP_USER_ID,
      operationId: process.env.ADMIN_BOOTSTRAP_OPERATION_ID,
      activationToken: process.env.ADMIN_BOOTSTRAP_ACTIVATION_TOKEN,
    });
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    console.info(
      JSON.stringify(
        await bootstrapFirstAdmin(pool, env.ADMIN_AUTH_PEPPER!, input),
      ),
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error("Admin bootstrap refused or failed; no credential output");
  process.exitCode = 1;
});
