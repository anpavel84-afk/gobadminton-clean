import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function applyMigrationFiles(
  client: Client,
  migrationsDir: string,
  ids: string[],
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const id of ids) {
    const sql = readFileSync(path.join(migrationsDir, `${id}.sql`), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
        [id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

describeIntegration("game-scoped authority upgrade from schema through 0004", () => {
  const apiRoot = path.resolve(__dirname, "../..");
  const migrationsDir = path.join(apiRoot, "migrations");
  const upgradeDb = `gobadminton_qa_gsa_upg_${Date.now()}`;
  let adminPool: Pool;
  let upgradeUrl = "";

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: baseDatabaseUrl });
    await adminPool.query(`CREATE DATABASE "${upgradeDb}"`);
    upgradeUrl = withDatabase(baseDatabaseUrl, upgradeDb);

    const client = new Client({ connectionString: upgradeUrl });
    await client.connect();
    try {
      await applyMigrationFiles(client, migrationsDir, [
        "0001_enable_postgis",
        "0002_identity_session",
        "0003_organizer_venue_game",
        "0004_participation_loop",
      ]);

      const user = await client.query<{ id: string }>(
        `INSERT INTO users (display_name) VALUES ('Upgrade Owner') RETURNING id`,
      );
      const organizer = await client.query<{ id: string }>(
        `INSERT INTO organizers (display_name, public_contact, created_by_user_id)
         VALUES ('Legacy Host', 'legacy@example.com', $1)
         RETURNING id`,
        [user.rows[0]!.id],
      );
      await client.query(
        `INSERT INTO organizer_memberships (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')`,
        [organizer.rows[0]!.id, user.rows[0]!.id],
      );
      const venue = await client.query<{ id: string }>(
        `INSERT INTO venues (
           city_id, name, address, timezone, location, created_by_user_id
         ) VALUES (
           'a0000000-0000-4000-8000-000000000001',
           'Upgrade Court',
           'Moscow',
           'Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.62, 55.75), 4326)::geography,
           $1
         )
         RETURNING id`,
        [user.rows[0]!.id],
      );
      const starts = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const ends = new Date(starts.getTime() + 2 * 60 * 60 * 1000);
      const deadline = new Date(starts.getTime() - 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO games (
           organizer_id, venue_id, title, status, visibility,
           starts_at, ends_at, timezone, application_deadline_at,
           capacity, external_reserved_count, format_key,
           level_scale_id, level_scale_version, allowed_level_ids,
           settlement_mode, settlement_terms, version, created_by_user_id
         ) VALUES (
           $1, $2, 'Legacy Game', 'published', 'public',
           $3, $4, 'Europe/Moscow', $5,
           4, 0, 'doubles',
           'ntrp', 1, '["3.0"]'::jsonb,
           'external', 'Pay desk', 1, $6
         )`,
        [
          organizer.rows[0]!.id,
          venue.rows[0]!.id,
          starts.toISOString(),
          ends.toISOString(),
          deadline.toISOString(),
          user.rows[0]!.id,
        ],
      );

      const beforeHost = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'games' AND column_name = 'host_display_name'`,
      );
      expect(beforeHost.rows).toHaveLength(0);

      await applyMigrationFiles(client, migrationsDir, [
        "0005_game_scoped_authority",
      ]);
    } finally {
      await client.end();
    }
  }, 120_000);

  afterAll(async () => {
    if (adminPool) {
      await adminPool.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [upgradeDb]).catch(() => undefined);
      await adminPool.query(`DROP DATABASE IF EXISTS "${upgradeDb}"`);
      await adminPool.end();
    }
  });

  it("backfills host snapshot and active owner for pre-0005 games", async () => {
    const pool = new Pool({ connectionString: upgradeUrl });
    try {
      const game = await pool.query<{
        host_display_name: string;
        host_public_contact: string;
        created_by_user_id: string;
        organizer_id: string;
      }>(
        `SELECT host_display_name, host_public_contact, created_by_user_id, organizer_id
         FROM games
         LIMIT 1`,
      );
      expect(game.rows).toHaveLength(1);
      expect(game.rows[0]!.host_display_name).toBe("Legacy Host");
      expect(game.rows[0]!.host_public_contact).toBe("legacy@example.com");
      expect(game.rows[0]!.organizer_id).toBeTruthy();

      const managers = await pool.query<{ user_id: string; role: string; status: string }>(
        `SELECT user_id, role, status FROM game_managers`,
      );
      expect(managers.rows).toHaveLength(1);
      expect(managers.rows[0]!.role).toBe("owner");
      expect(managers.rows[0]!.status).toBe("active");
      expect(managers.rows[0]!.user_id).toBe(game.rows[0]!.created_by_user_id);

      const nullable = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'games' AND column_name = 'organizer_id'`,
      );
      expect(nullable.rows[0]!.is_nullable).toBe("YES");

      // Fresh migrate path on the same tree remains consistent.
      const files = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort();
      expect(files).toContain("0005_game_scoped_authority.sql");
      expect(files).toContain("0006_regular_vs_trainer_game.sql");
      execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
        cwd: apiRoot,
        env: {
          ...process.env,
          NODE_ENV: "test",
          APP_ENV: "local",
          DATABASE_URL: upgradeUrl,
          PUBLIC_API_ORIGIN: process.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000",
          PUBLIC_WEB_ORIGIN: process.env.PUBLIC_WEB_ORIGIN ?? "http://127.0.0.1:3001",
          ALLOWED_WEB_ORIGINS:
            process.env.ALLOWED_WEB_ORIGINS ?? "http://127.0.0.1:3001",
          AUTH_PEPPER: process.env.AUTH_PEPPER ?? "integration-auth-pepper-32chars!!",
          COOKIE_SECURE: "false",
          GIT_SHA: "integration-gsa-upgrade",
        },
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      const applied = await pool.query<{ id: string }>(
        `SELECT id FROM schema_migrations ORDER BY id`,
      );
      expect(applied.rows.map((r) => r.id)).toContain("0005_game_scoped_authority");
      expect(applied.rows.map((r) => r.id)).toContain("0006_regular_vs_trainer_game");

      const activity = await pool.query<{
        activity_kind: string | null;
        settlement_purpose: string | null;
      }>(`SELECT activity_kind, settlement_purpose FROM games LIMIT 1`);
      expect(activity.rows[0]!.activity_kind).toBeNull();
      expect(activity.rows[0]!.settlement_purpose).toBeNull();
    } finally {
      await pool.end();
    }
  }, 120_000);
});
