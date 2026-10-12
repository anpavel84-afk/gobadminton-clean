import { checkDatabase, createDatabase } from "./client";
import { loadEnv } from "../config/env";

async function smoke(): Promise<void> {
  const env = loadEnv();
  const { pool } = createDatabase(env.DATABASE_URL);
  try {
    const result = await checkDatabase(pool);
    if (!result.ok || !result.postgisVersion) {
      throw new Error(
        `Database smoke failed: ok=${result.ok} postgis=${result.postgisVersion} error=${result.error ?? "none"}`,
      );
    }

    const markers = await pool.query<{ count: string }>(
      "select count(*)::text as count from foundation_markers",
    );

    console.info(
      JSON.stringify({
        status: "ok",
        postgresVersion: result.postgresVersion,
        postgisVersion: result.postgisVersion,
        foundationMarkers: Number(markers.rows[0]?.count ?? "0"),
      }),
    );
  } finally {
    await pool.end();
  }
}

smoke().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
