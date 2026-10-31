import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkDatabase, createDatabase } from "../../src/database/client";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://gobadminton:gobadminton@127.0.0.1:15432/gobadminton";

const requiredEnv = {
  ...process.env,
  NODE_ENV: "test",
  APP_ENV: "local",
  DATABASE_URL: databaseUrl,
  PUBLIC_API_ORIGIN: process.env.PUBLIC_API_ORIGIN ?? "http://127.0.0.1:3000",
  GIT_SHA: "integration-test",
};

const describeIntegration =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeIntegration("PostgreSQL/PostGIS migration smoke", () => {
  const apiRoot = path.resolve(__dirname, "../..");

  beforeAll(() => {
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: apiRoot,
      env: requiredEnv,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }, 60_000);

  it("applies PostGIS + identity + organizer/venue/game + participation + game_managers + trainer migrations", async () => {
    const { pool } = createDatabase(databaseUrl);
    try {
      const result = await checkDatabase(pool);
      expect(result.ok).toBe(true);
      expect(result.postgresVersion.toLowerCase()).toContain("postgresql");
      expect(result.postgisVersion).toBeTruthy();
      expect(String(result.postgisVersion)).toMatch(/^3\./);

      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [[
          "users",
          "external_identities",
          "auth_transactions",
          "app_sessions",
          "organizers",
          "organizer_memberships",
          "cities",
          "venues",
          "games",
          "game_managers",
          "trainer_profiles",
          "participations",
          "participation_transitions",
          "outbox_events",
          "idempotency_records",
        ]],
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "app_sessions",
        "auth_transactions",
        "cities",
        "external_identities",
        "game_managers",
        "games",
        "idempotency_records",
        "organizer_memberships",
        "organizers",
        "outbox_events",
        "participation_transitions",
        "participations",
        "trainer_profiles",
        "users",
        "venues",
      ]);

      // FR-3A additive schema: private references and own-list indexes only.
      const recommendations = await pool.query<{table_name:string}>(`SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('game_recommendations','game_recommendation_actions') ORDER BY table_name`);
      expect(recommendations.rows.map(r=>r.table_name)).toEqual(["game_recommendation_actions","game_recommendations"]);
      const recommendationFks=await pool.query<{target:string}>(`SELECT confrelid::regclass::text AS target
        FROM pg_constraint WHERE conrelid='game_recommendations'::regclass AND contype='f' ORDER BY target`);
      expect(recommendationFks.rows.map(r=>r.target)).toEqual(["friendships","games","users","users"]);
      const recommendationIndexes=await pool.query<{indexname:string}>(`SELECT indexname FROM pg_indexes
        WHERE tablename='game_recommendations' ORDER BY indexname`);
      expect(recommendationIndexes.rows.map(r=>r.indexname)).toEqual(expect.arrayContaining([
        "game_recommendations_direction_idx","game_recommendations_received_idx","game_recommendations_sent_idx"]));
      const recommendationColumns=await pool.query<{column_name:string}>(`SELECT column_name FROM information_schema.columns
        WHERE table_name='game_recommendations' ORDER BY column_name`);
      expect(recommendationColumns.rows.map(r=>r.column_name).join(",")).not.toMatch(/contact|message|bio|seat|participation|invitation|latitude|longitude/);

      const hostCols = await pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'games'
           AND column_name = ANY($1::text[])
         ORDER BY column_name`,
        [[
          "activity_kind",
          "host_display_name",
          "host_public_contact",
          "organizer_id",
          "settlement_purpose",
          "trainer_profile_id",
        ]],
      );
      expect(hostCols.rows).toEqual([
        { column_name: "activity_kind", is_nullable: "YES" },
        { column_name: "host_display_name", is_nullable: "NO" },
        { column_name: "host_public_contact", is_nullable: "NO" },
        { column_name: "organizer_id", is_nullable: "YES" },
        { column_name: "settlement_purpose", is_nullable: "YES" },
        { column_name: "trainer_profile_id", is_nullable: "YES" },
      ]);

      const moscow = await pool.query<{ id: string }>(
        `SELECT id FROM cities WHERE id = $1`,
        ["a0000000-0000-4000-8000-000000000001"],
      );
      expect(moscow.rows).toHaveLength(1);
      const spb = await pool.query<{ id: string; name_ru: string }>(
        `SELECT id, name_ru FROM cities WHERE id = $1`,
        ["a0000000-0000-4000-8000-000000000002"],
      );
      expect(spb.rows).toHaveLength(1);
      expect(spb.rows[0]!.name_ru).toBe("Санкт-Петербург");

      const applied = await pool.query<{ id: string }>(
        `SELECT id FROM schema_migrations ORDER BY id`,
      );
      expect(applied.rows.map((r) => r.id)).toEqual([
        "0001_enable_postgis",
        "0002_identity_session",
        "0003_organizer_venue_game",
        "0004_participation_loop",
        "0005_game_scoped_authority",
        "0006_regular_vs_trainer_game",
        "0007_idempotency_reservation",
        "0008_profiles_safety_directory",
        "0009_radar_presence_matching",
        "0010_durable_jobs_pgboss",
        "0011_text_dm",
        "0012_game_invitations",
        "0013_game_chat",
        "0014_composed_inbox",
        "0015_account_security_controls",
        "0016_city_saint_petersburg",
        "0017_owned_avatar",
        "0018_venue_catalog_dedupe",
        "0019_venue_legacy_identity_extract",
        "0020_avatar_moderation",
        "0021_radar_geographic_consent",
        "0022_players_unified_radar",
        "0023_user_game_preferences",
        "0024_user_discovery_preferences",
        "0025_email_auth_foundation",
        "0026_email_auth_method_changes",
        "0027_admin_identity_rbac_audit",
        "0028_admin_venue_lifecycle",
        "0029_game_moderation",
        "0030_user_capability_restrictions",
        "0031_support_cases",
        "0032_friendship_core",
        "0033_owned_cover",
        "0034_venue_cover",
        "0035_game_cover",
        "0036_venue_contacts",
        "0037_venue_cover_credit",
        "0038_public_venue_contacts",
        "0039_venue_public_profile",
        "0040_external_http_url_storage",
        "0041_game_recommendations",
        "0042_game_outcomes",
        "0043_play_interests",
        "0044_direct_messages_immediate",
      ]);
      const profileColumns = await pool.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='venues' AND column_name IN ('court_count','amenity_parking','amenity_showers','public_profile_updated_at') ORDER BY column_name");
      expect(profileColumns.rows).toEqual([
        {column_name:"amenity_parking",data_type:"boolean",is_nullable:"YES",column_default:null},
        {column_name:"amenity_showers",data_type:"boolean",is_nullable:"YES",column_default:null},
        {column_name:"court_count",data_type:"integer",is_nullable:"YES",column_default:null},
        {column_name:"public_profile_updated_at",data_type:"timestamp with time zone",is_nullable:"YES",column_default:null},
      ]);
      expect((await pool.query("SELECT conname FROM pg_constraint WHERE conrelid='venues'::regclass AND conname='venues_court_count_check'")).rows).toHaveLength(1);
      expect((await pool.query("SELECT tgname FROM pg_trigger WHERE tgrelid='venues'::regclass AND tgname='venue_public_profile_change' AND NOT tgisinternal AND tgenabled='O'")).rows).toHaveLength(1);
      const publicContactsColumn = await pool.query<{data_type:string;is_nullable:string;column_default:string|null}>(
        "SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_name='venues' AND column_name='public_contacts'",
      );
      expect(publicContactsColumn.rows).toEqual([{data_type:"jsonb",is_nullable:"YES",column_default:null}]);
      const publicCheck = await pool.query("SELECT conname FROM pg_constraint WHERE conrelid='venues'::regclass AND conname='venues_public_contacts_check'");
      expect(publicCheck.rows).toHaveLength(1);
      // Verify the additive game slot exists, beyond its migration record.
      const gameCoverColumns = await pool.query<{
        column_name: string; data_type: string; is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'games'
           AND column_name IN ('cover_key', 'cover_moderation_approval_id', 'cover_actor_id')
         ORDER BY column_name`,
      );
      expect(gameCoverColumns.rows).toEqual([
        { column_name: "cover_actor_id", data_type: "uuid", is_nullable: "YES" },
        { column_name: "cover_key", data_type: "text", is_nullable: "YES" },
        { column_name: "cover_moderation_approval_id", data_type: "uuid", is_nullable: "YES" },
      ]);
      const gameCoverConstraints = await pool.query<{ conname: string; contype: string }>(
        `SELECT conname, contype::text
         FROM pg_constraint
         WHERE conrelid = 'public.games'::regclass
           AND conname IN ('game_cover_binding', 'games_cover_key_check',
             'games_cover_key_key', 'games_cover_actor_id_fkey',
             'games_cover_moderation_approval_id_fkey')
         ORDER BY conname`,
      );
      expect(gameCoverConstraints.rows).toEqual([
        { conname: "game_cover_binding", contype: "c" },
        { conname: "games_cover_actor_id_fkey", contype: "f" },
        { conname: "games_cover_key_check", contype: "c" },
        { conname: "games_cover_key_key", contype: "u" },
        { conname: "games_cover_moderation_approval_id_fkey", contype: "f" },
      ]);
      const gameCoverFunctions = await pool.query<{ own: boolean; effective: boolean; retire: boolean }>(
        `SELECT to_regprocedure('public.game_own_cover_url(uuid)') IS NOT NULL AS own,
           to_regprocedure('public.game_effective_cover_url(uuid)') IS NOT NULL AS effective,
           to_regprocedure('public.retire_inactive_game_cover()') IS NOT NULL AS retire`,
      );
      expect(gameCoverFunctions.rows).toEqual([{ own: true, effective: true, retire: true }]);
      const gameCoverTriggers = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
         WHERE NOT tgisinternal AND tgenabled = 'O'
           AND ((tgrelid = 'public.games'::regclass AND tgname = 'game_cover_cleanup')
             OR (tgrelid = 'public.users'::regclass AND tgname = 'inactive_game_cover'))
         ORDER BY tgname`,
      );
      expect(gameCoverTriggers.rows).toEqual([
        { tgname: "game_cover_cleanup" },
        { tgname: "inactive_game_cover" },
      ]);
      // Additive Friends S1 upgrade must be physically present in the
      // migration smoke; merely recording the filename is insufficient.
      const friendships = await pool.query<{ name: string | null }>(
        "SELECT to_regclass('public.friendships')::text AS name",
      );
      expect(friendships.rows[0]?.name).toBe("friendships");
      const attempts = await pool.query<{ name: string | null }>(
        "SELECT to_regclass('public.friendship_request_attempts')::text AS name",
      );
      expect(attempts.rows[0]?.name).toBe("friendship_request_attempts");
      const epoch = await pool.query<{column_name: string}>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='player_social_profiles' AND column_name='social_action_epoch'",
      );
      expect(epoch.rows).toHaveLength(1);

      const ls02Indexes = await pool.query<{ indexname: string }>(
        `SELECT indexname
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = ANY($1::text[])
         ORDER BY indexname`,
        [[
          "player_looking_intents_expired_active_idx",
          "radar_presences_cleanup_idx",
        ]],
      );
      expect(ls02Indexes.rows.map((r) => r.indexname)).toEqual([
        "player_looking_intents_expired_active_idx",
        "radar_presences_cleanup_idx",
      ]);

      const idemCols = await pool.query<{
        column_name: string;
        is_nullable: string;
      }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'idempotency_records'
           AND column_name IN ('reservation_state', 'status_code', 'response_body')
         ORDER BY column_name`,
      );
      expect(idemCols.rows).toEqual([
        { column_name: "reservation_state", is_nullable: "NO" },
        { column_name: "response_body", is_nullable: "YES" },
        { column_name: "status_code", is_nullable: "YES" },
      ]);

      const socialTables = await pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN (
             'player_social_profiles',
             'player_looking_intents',
             'social_pairs',
             'user_blocks',
             'abuse_reports',
             'conversations',
             'conversation_members',
             'messages',
             'message_hidden_for',
             'game_invitations'
           )
         ORDER BY table_name`,
      );
      expect(socialTables.rows.map((r) => r.table_name)).toEqual([
        "abuse_reports",
        "conversation_members",
        "conversations",
        "game_invitations",
        "message_hidden_for",
        "messages",
        "player_looking_intents",
        "player_social_profiles",
        "social_pairs",
        "user_blocks",
      ]);

      const radar = await pool.query<{
        table_name: string;
        relpersistence: string;
      }>(
        `SELECT c.relname AS table_name, c.relpersistence
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname IN ('radar_presences', 'radar_rate_budgets')
         ORDER BY c.relname`,
      );
      expect(radar.rows).toEqual([
        { table_name: "radar_presences", relpersistence: "u" },
        { table_name: "radar_rate_budgets", relpersistence: "p" },
      ]);

      const geographic = await pool.query<{table_name:string;relpersistence:string}>(
        `SELECT relname AS table_name,relpersistence FROM pg_class WHERE relname IN ('radar_disclosures','radar_consent_events') ORDER BY relname`);
      expect(geographic.rows).toEqual([
        {table_name:"radar_consent_events",relpersistence:"p"},
        {table_name:"radar_disclosures",relpersistence:"p"},
      ]);
      const auditColumns=await pool.query<{column_name:string}>(`SELECT column_name FROM information_schema.columns WHERE table_name='radar_consent_events' ORDER BY column_name`);
      expect(auditColumns.rows.map(r=>r.column_name).join(",")).not.toMatch(/latitude|longitude|city|cell|accuracy|result_ref|origin_ref/);

      const venueA1a = await pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
         ORDER BY table_name`,
        [[
          "venue_duplicate_candidates",
          "venue_identity_keys",
          "venue_merge_history",
          "venue_proposal_confirm_tokens",
        ]],
      );
      expect(venueA1a.rows.map((row) => row.table_name)).toEqual([
        "venue_duplicate_candidates",
        "venue_identity_keys",
        "venue_merge_history",
        "venue_proposal_confirm_tokens",
      ]);
      const lifecycle = await pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'venues'
           AND column_name IN ('lifecycle_state', 'normalized_name', 'normalized_address')
         ORDER BY column_name`,
      );
      expect(lifecycle.rows).toEqual([
        { column_name: "lifecycle_state", is_nullable: "NO" },
        { column_name: "normalized_address", is_nullable: "NO" },
        { column_name: "normalized_name", is_nullable: "NO" },
      ]);
      const extracted = await pool.query<{ d: string }>(
        `SELECT venue_extract_identity_discriminator_v1($1, $2) AS d`,
        ["QA Спортзал зал 2", "QA Avenue"],
      );
      expect(extracted.rows[0]!.d).toBe("hall:2");
    } finally {
      await pool.end();
    }
  });
});
