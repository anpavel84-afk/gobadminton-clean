import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export type DatabaseBundle = {
  pool: Pool;
  db: ReturnType<typeof drizzle>;
};

export function createDatabase(databaseUrl: string): DatabaseBundle {
  const maxRaw = process.env.DATABASE_POOL_MAX;
  const maxParsed = maxRaw ? Number.parseInt(maxRaw, 10) : 5;
  const max =
    Number.isInteger(maxParsed) && maxParsed >= 1 && maxParsed <= 50
      ? maxParsed
      : 5;
  const pool = new Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 30_000,
  });
  return { pool, db: drizzle(pool) };
}

export async function checkDatabase(pool: Pool): Promise<{
  ok: boolean;
  postgresVersion: string;
  postgisVersion: string | null;
  error?: string;
}> {
  try {
    const client = await pool.connect();
    try {
      const versionResult = await client.query<{ version: string }>(
        "select version() as version",
      );
      const postgresVersion = versionResult.rows[0]?.version ?? "unknown";
      let postgisVersion: string | null = null;
      try {
        const postgisResult = await client.query<{ postgis: string }>(
          "select PostGIS_Version() as postgis",
        );
        postgisVersion = postgisResult.rows[0]?.postgis ?? null;
      } catch {
        postgisVersion = null;
      }

      return {
        ok: postgisVersion !== null,
        postgresVersion,
        postgisVersion,
        ...(postgisVersion === null
          ? { error: "PostGIS extension is not available" }
          : {}),
      };
    } finally {
      client.release();
    }
  } catch (error) {
    return {
      ok: false,
      postgresVersion: "unavailable",
      postgisVersion: null,
      error: error instanceof Error ? error.message : "database check failed",
    };
  }
}
