/**
 * Fixed runtime demo seed entrypoint.
 * Build output must resolve to apps/api/dist/database/seed-demo.js
 *
 * Usage:
 *   node dist/database/seed-demo.js --mode foundation
 *   node dist/database/seed-demo.js --mode full
 *   node dist/database/seed-demo.js --cleanup
 */
import { createDatabase } from "./client";
import { loadEnv } from "../config/env";
import {
  cleanupDemoData,
  countDemoRows,
  seedDemoFoundation,
  withDemoTransaction,
  type DemoSeedReport,
} from "./demo-seed-ops";
import type { DemoSeedMode } from "./demo-population";

type CliArgs = {
  mode: DemoSeedMode | null;
  cleanupOnly: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let mode: DemoSeedMode | null = null;
  let cleanupOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      continue;
    }
    if (arg === "--cleanup") {
      cleanupOnly = true;
      continue;
    }
    if (arg === "--mode") {
      const value = argv[i + 1];
      i += 1;
      if (value !== "foundation" && value !== "full") {
        throw new Error(`Invalid --mode ${value ?? "(missing)"}; use foundation|full`);
      }
      mode = value;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value !== "foundation" && value !== "full") {
        throw new Error(`Invalid --mode ${value}; use foundation|full`);
      }
      mode = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!cleanupOnly && mode === null) {
    throw new Error("Required: --mode foundation|full  (or --cleanup)");
  }
  return { mode, cleanupOnly };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv(process.env);
  const { pool } = createDatabase(env.DATABASE_URL);

  try {
    if (args.cleanupOnly && args.mode === null) {
      await withDemoTransaction(pool, async (client) => {
        await cleanupDemoData(client);
      });
      const counts = await countDemoRows(pool);
      const report = {
        mode: "cleanup" as const,
        ok: true,
        remaining: counts,
      };
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const mode = args.mode ?? "foundation";
    const report: DemoSeedReport = await withDemoTransaction(
      pool,
      async (client) => {
        if (args.cleanupOnly) {
          await cleanupDemoData(client);
        }
        return seedDemoFoundation(client, mode);
      },
    );
    const counts = await countDemoRows(pool);
    console.log(
      JSON.stringify(
        {
          ok: true,
          report,
          verifiedCounts: counts,
        },
        null,
        2,
      ),
    );

    if (
      counts.users !== 20 ||
      counts.profiles !== 20 ||
      counts.games < 12 ||
      counts.lookingActive < 6
    ) {
      throw new Error(
        `Post-seed verification failed: users=${counts.users} profiles=${counts.profiles} games=${counts.games} looking=${counts.lookingActive}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
