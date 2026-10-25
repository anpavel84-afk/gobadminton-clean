import { Pool } from "pg";
import { z } from "zod";
import { loadEnv } from "../config/env";
import { bootstrapFirstAdmin, provisionAdmin, operatorProvisionSchema } from "./admin-db";
async function main() {
  // Never reads production credential files, creates users, selects real staff or prints token bytes.
  const env = loadEnv();
  const local = env.NODE_ENV === "test" && env.APP_ENV === "local" && process.env.ADMIN_BOOTSTRAP_SOURCE_TEST === "1";
  const dev = env.ADMIN_DEV_ENABLED && process.env.ADMIN_DEV_OPERATOR_PROVISION === "1";
  if (!env.ADMIN_INTERNAL_ENABLED || (!local && !dev))
    throw new Error("Explicit trusted operator or disposable test required");
  const mode = z.enum(["first", "enroll"]).parse(process.env.ADMIN_BOOTSTRAP_MODE ?? "first");
  const input = operatorProvisionSchema.parse({
    userId: process.env.ADMIN_BOOTSTRAP_USER_ID,
    operationId: process.env.ADMIN_BOOTSTRAP_OPERATION_ID,
    activationToken: process.env.ADMIN_BOOTSTRAP_ACTIVATION_TOKEN,
    reasonCode: process.env.ADMIN_BOOTSTRAP_REASON ?? (local ? "first_bootstrap" : undefined),
    role: process.env.ADMIN_BOOTSTRAP_ROLE ?? (mode === "first" ? "superadmin" : undefined),
  });
  if (mode === "first" && input.role !== "superadmin") throw new Error("First role must be superadmin");
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    console.info(
      JSON.stringify(
        await (mode === "first" ? bootstrapFirstAdmin : provisionAdmin)(pool, env.ADMIN_AUTH_PEPPER!, input),
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
