import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { loadEnv } from "../config/env";

async function connectWithRetry(pool: Pool, attempts = 20): Promise<PoolClient> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to connect to database for migrations");
}

async function migrate(): Promise<void> {
  const env = loadEnv();
  const migrationsDir = path.resolve(__dirname, "../../migrations");
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsDir}`);
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  // Fresh PostGIS containers can flap during initdb final restart; retry briefly.
  const client = await connectWithRetry(pool);
  try {
    // Serialize concurrent migrate processes (e.g. parallel Vitest files on one DB).
    await client.query("SELECT pg_advisory_lock(hashtext('gobadminton_migrate'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM schema_migrations WHERE id = $1",
        [id],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        console.info(`skip ${id}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
          [id],
        );
        await client.query("COMMIT");
        console.info(`applied ${id}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const postgis = await client.query<{ postgis: string }>(
      "SELECT PostGIS_Version() AS postgis",
    );
    console.info(`PostGIS_Version=${postgis.rows[0]?.postgis ?? "missing"}`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('gobadminton_migrate'))").catch(
      () => undefined,
    );
    client.release();
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
