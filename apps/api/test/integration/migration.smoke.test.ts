import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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
        "0045_venue_gallery",
        "0046_game_attendance",
        "0047_attendance_dispute_resolution",
        "0048_game_reviews_notes",
        "0049_social_profile_defaults",
        "0050_game_court_booking",
        "0051_entity_comments",
        "0052_attendance_missing_disputes",
        "0053_private_review_reports",
        "0054_role_reputation",
        "0055_role_web_push",
        "0056_postgame_reminders",
        "0057_dev_qa_admin",
        "0058_venue_experience_reviews",
        "0059_regional_discovery_preferences",
        "0060_game_event_push",
        "0061_content_moderation_text",
        "0062_content_moderation_comments",
        "0063_moderation_role_review_bindings",
      ]);
      expect(
        (await pool.query("SELECT to_regclass('public.venue_review_slots')::text AS name")).rows[0]
          ?.name,
      ).toBe("venue_review_slots");
      expect(
        (await pool.query("SELECT to_regclass('public.venue_review_pending_intakes')::text AS name"))
          .rows[0]?.name,
      ).toBe("venue_review_pending_intakes");
      expect(
        (
          await pool.query(
            "SELECT to_regclass('public.game_played_at_venue_attributions')::text AS name",
          )
        ).rows[0]?.name,
      ).toBe("game_played_at_venue_attributions");
      expect(
        (
          await pool.query(
            "SELECT to_regclass('public.venue_review_submit_windows')::text AS name",
          )
        ).rows[0]?.name,
      ).toBe("venue_review_submit_windows");
      expect((await pool.query("SELECT to_regclass('public.game_court_booking')::text AS name")).rows[0]?.name).toBe("game_court_booking");
      expect((await pool.query("SELECT to_regclass('public.entity_comments')::text AS name")).rows[0]?.name).toBe("entity_comments");
      expect((await pool.query("SELECT to_regclass('public.entity_comment_revisions')::text AS name")).rows[0]?.name).toBe("entity_comment_revisions");
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.game_attendance_disputes'::regclass
               AND conname = 'game_attendance_disputes_challenged_version_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/0/);
      // 0047 PG-2 dispute resolution: physical tables beyond ledger filename alone.
      expect((await pool.query("SELECT to_regclass('public.game_attendance_dispute_responses')::text AS name")).rows[0]?.name).toBe("game_attendance_dispute_responses");
      expect((await pool.query("SELECT to_regclass('public.game_attendance_dispute_case_links')::text AS name")).rows[0]?.name).toBe("game_attendance_dispute_case_links");
      expect((await pool.query("SELECT to_regclass('public.game_attendance_dispute_resolutions')::text AS name")).rows[0]?.name).toBe("game_attendance_dispute_resolutions");
      // 0055 #456 web push tables.
      expect((await pool.query("SELECT to_regclass('public.web_push_preferences')::text AS name")).rows[0]?.name).toBe("web_push_preferences");
      expect((await pool.query("SELECT to_regclass('public.web_push_subscriptions')::text AS name")).rows[0]?.name).toBe("web_push_subscriptions");
      expect((await pool.query("SELECT to_regclass('public.web_push_delivery_claims')::text AS name")).rows[0]?.name).toBe("web_push_delivery_claims");
      expect((await pool.query("SELECT to_regclass('public.web_push_delivery_intents')::text AS name")).rows[0]?.name).toBe("web_push_delivery_intents");
      // 0060 #496 game-event push preference columns + cancel snapshot + event_key uniqueness.
      expect((await pool.query("SELECT to_regclass('public.web_push_game_cancel_recipients')::text AS name")).rows[0]?.name).toBe("web_push_game_cancel_recipients");
      // 0061 #506 MOD-V2-A text bindings + expanded approval surface allowlist.
      expect((await pool.query("SELECT to_regclass('public.content_moderation_bindings')::text AS name")).rows[0]?.name).toBe("content_moderation_bindings");
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.content_moderation_approvals'::regclass
               AND conname = 'content_moderation_approvals_surface_key_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/profile_bio/);
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.content_moderation_approvals'::regclass
               AND conname = 'content_moderation_approvals_surface_key_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/organizer_public_contact/);
      // 0062 #506 B1a comment_body + entity_comment binding catalogue (0061 untouched).
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.content_moderation_approvals'::regclass
               AND conname = 'content_moderation_approvals_surface_key_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/comment_body/);
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.content_moderation_bindings'::regclass
               AND conname = 'content_moderation_bindings_entity_kind_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/entity_comment/);
      // 0063 #506 B1b role_review_body / role_reply_body + human decision FK (0061/0062 untouched).
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.content_moderation_approvals'::regclass
               AND conname = 'content_moderation_approvals_surface_key_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/role_review_body/);
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.content_moderation_bindings'::regclass
               AND conname = 'content_moderation_bindings_entity_kind_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/role_review_revision/);
      expect(
        (
          await pool.query<{ column_name: string; is_nullable: string }>(
            `SELECT column_name, is_nullable
             FROM information_schema.columns
             WHERE table_name = 'content_moderation_bindings'
               AND column_name = 'role_reputation_decision_id'`,
          )
        ).rows[0],
      ).toEqual({ column_name: "role_reputation_decision_id", is_nullable: "YES" });
      // 0063 admin external-prepare: reservation_state allows durable known-reject 'error'.
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.admin_command_receipts'::regclass
               AND conname = 'admin_command_receipts_reservation_state_chk'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/error/);
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.admin_command_receipts'::regclass
               AND conname = 'admin_command_receipts_response_state_chk'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/error/);
      // 0062 claim_nonce + unknown reservation for external-prepare fencing.
      expect(
        (
          await pool.query<{ column_name: string; is_nullable: string }>(
            `SELECT column_name, is_nullable
             FROM information_schema.columns
             WHERE table_name = 'idempotency_records' AND column_name = 'claim_nonce'`,
          )
        ).rows[0],
      ).toEqual({ column_name: "claim_nonce", is_nullable: "YES" });
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.idempotency_records'::regclass
               AND conname = 'idempotency_records_reservation_state_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/unknown/);
      const commentSurfacesRollback = await pool.connect();
      try {
        await commentSurfacesRollback.query("BEGIN");
        // Populated B1a history must survive rollback; narrowing CHECKs would fail.
        const actorId = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
        await commentSurfacesRollback.query(
          `INSERT INTO users(id, display_name) VALUES ($1::uuid, 'Synthetic 0062 rollback actor')
           ON CONFLICT (id) DO NOTHING`,
          [actorId],
        );
        const syntheticApproval = await commentSurfacesRollback.query<{ id: string }>(
          `INSERT INTO content_moderation_approvals(
             content_type, surface_key, fingerprint_version, content_fingerprint,
             policy_version, local_policy_version, provider_key, provider_model,
             category_flags, decision, checked_at)
           VALUES (
             'text', 'comment_body', 1, $1,
             'public-text-v1', 'ru-profanity-v1', 'fake', 'synthetic-model',
             '{}'::jsonb, 'allow', now())
           RETURNING id`,
          ["a".repeat(64)],
        );
        const commentEntityId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        await commentSurfacesRollback.query(
          `INSERT INTO content_moderation_bindings(
             entity_kind, entity_id, surface_key, resource_version,
             approval_id, actor_user_id, binding_kind)
           VALUES ('entity_comment', $1::uuid, 'comment_body', 1, $2::uuid, $3::uuid, 'publication')`,
          [commentEntityId, syntheticApproval.rows[0]!.id, actorId],
        );
        await commentSurfacesRollback.query(
          readFileSync(
            path.join(apiRoot, "migrations/rollback/0062_content_moderation_comments.sql"),
            "utf8",
          ),
        );
        // Additive compatibility: expanded allowlists retained with history.
        expect(
          (
            await commentSurfacesRollback.query<{ consrc: string }>(
              `SELECT pg_get_constraintdef(oid) AS consrc
               FROM pg_constraint
               WHERE conrelid = 'public.content_moderation_approvals'::regclass
                 AND conname = 'content_moderation_approvals_surface_key_check'`,
            )
          ).rows[0]?.consrc,
        ).toMatch(/comment_body/);
        expect(
          (
            await commentSurfacesRollback.query<{ consrc: string }>(
              `SELECT pg_get_constraintdef(oid) AS consrc
               FROM pg_constraint
               WHERE conrelid = 'public.content_moderation_bindings'::regclass
                 AND conname = 'content_moderation_bindings_entity_kind_check'`,
            )
          ).rows[0]?.consrc,
        ).toMatch(/entity_comment/);
        expect(
          (
            await commentSurfacesRollback.query(
              `SELECT surface_key FROM content_moderation_approvals WHERE id = $1`,
              [syntheticApproval.rows[0]!.id],
            )
          ).rows[0]?.surface_key,
        ).toBe("comment_body");
        expect(
          (
            await commentSurfacesRollback.query(
              `SELECT entity_kind FROM content_moderation_bindings
               WHERE entity_id = $1::uuid AND surface_key = 'comment_body'`,
              [commentEntityId],
            )
          ).rows[0]?.entity_kind,
        ).toBe("entity_comment");
        expect(
          (await commentSurfacesRollback.query("SELECT to_regclass('public.content_moderation_bindings')::text AS name"))
            .rows[0]?.name,
        ).toBe("content_moderation_bindings");
        expect(
          (await commentSurfacesRollback.query("SELECT 1 FROM schema_migrations WHERE id='0062_content_moderation_comments'"))
            .rowCount,
        ).toBe(0);
        // claim_nonce + unknown allowlist retained (non-destructive rollback).
        expect(
          (
            await commentSurfacesRollback.query<{ column_name: string }>(
              `SELECT column_name
               FROM information_schema.columns
               WHERE table_name = 'idempotency_records' AND column_name = 'claim_nonce'`,
            )
          ).rows[0]?.column_name,
        ).toBe("claim_nonce");
        expect(
          (
            await commentSurfacesRollback.query<{ consrc: string }>(
              `SELECT pg_get_constraintdef(oid) AS consrc
               FROM pg_constraint
               WHERE conrelid = 'public.idempotency_records'::regclass
                 AND conname = 'idempotency_records_reservation_state_check'`,
            )
          ).rows[0]?.consrc,
        ).toMatch(/unknown/);
        // Re-apply forward migration after rollback (idempotent widen).
        await commentSurfacesRollback.query(
          readFileSync(
            path.join(apiRoot, "migrations/0062_content_moderation_comments.sql"),
            "utf8",
          ),
        );
        await commentSurfacesRollback.query(
          `INSERT INTO schema_migrations(id) VALUES ('0062_content_moderation_comments')
           ON CONFLICT DO NOTHING`,
        );
        expect(
          (
            await commentSurfacesRollback.query(
              `SELECT surface_key FROM content_moderation_approvals WHERE id = $1`,
              [syntheticApproval.rows[0]!.id],
            )
          ).rows[0]?.surface_key,
        ).toBe("comment_body");
      } finally {
        await commentSurfacesRollback.query("ROLLBACK");
        commentSurfacesRollback.release();
      }
      // 0063 B1b non-destructive rollback retains role surfaces + human decision column.
      const roleSurfacesRollback = await pool.connect();
      try {
        await roleSurfacesRollback.query("BEGIN");
        await roleSurfacesRollback.query(
          readFileSync(
            path.join(apiRoot, "migrations/rollback/0063_moderation_role_review_bindings.sql"),
            "utf8",
          ),
        );
        expect(
          (
            await roleSurfacesRollback.query<{ consrc: string }>(
              `SELECT pg_get_constraintdef(oid) AS consrc
               FROM pg_constraint
               WHERE conrelid = 'public.content_moderation_approvals'::regclass
                 AND conname = 'content_moderation_approvals_surface_key_check'`,
            )
          ).rows[0]?.consrc,
        ).toMatch(/role_review_body/);
        expect(
          (
            await roleSurfacesRollback.query<{ column_name: string }>(
              `SELECT column_name
               FROM information_schema.columns
               WHERE table_name = 'content_moderation_bindings'
                 AND column_name = 'role_reputation_decision_id'`,
            )
          ).rows[0]?.column_name,
        ).toBe("role_reputation_decision_id");
        expect(
          (
            await roleSurfacesRollback.query(
              "SELECT 1 FROM schema_migrations WHERE id='0063_moderation_role_review_bindings'",
            )
          ).rowCount,
        ).toBe(0);
        // Non-destructive rollback retains admin 'error' allowlist (known moderation reject receipts).
        expect(
          (
            await roleSurfacesRollback.query<{ consrc: string }>(
              `SELECT pg_get_constraintdef(oid) AS consrc
               FROM pg_constraint
               WHERE conrelid = 'public.admin_command_receipts'::regclass
                 AND conname = 'admin_command_receipts_reservation_state_chk'`,
            )
          ).rows[0]?.consrc,
        ).toMatch(/error/);
        await roleSurfacesRollback.query(
          readFileSync(
            path.join(apiRoot, "migrations/0063_moderation_role_review_bindings.sql"),
            "utf8",
          ),
        );
        await roleSurfacesRollback.query(
          `INSERT INTO schema_migrations(id) VALUES ('0063_moderation_role_review_bindings')
           ON CONFLICT DO NOTHING`,
        );
      } finally {
        await roleSurfacesRollback.query("ROLLBACK");
        roleSurfacesRollback.release();
      }
      const bindingsRollback = await pool.connect();
      try {
        await bindingsRollback.query("BEGIN");
        await bindingsRollback.query(
          readFileSync(
            path.join(apiRoot, "migrations/rollback/0061_content_moderation_text.sql"),
            "utf8",
          ),
        );
        expect(
          (await bindingsRollback.query("SELECT to_regclass('public.content_moderation_bindings')::text AS name"))
            .rows[0]?.name,
        ).toBeNull();
        expect(
          (await bindingsRollback.query("SELECT 1 FROM schema_migrations WHERE id='0061_content_moderation_text'"))
            .rowCount,
        ).toBe(0);
        expect(
          (
            await bindingsRollback.query<{ consrc: string }>(
              `SELECT pg_get_constraintdef(oid) AS consrc
               FROM pg_constraint
               WHERE conrelid = 'public.content_moderation_approvals'::regclass
                 AND conname = 'content_moderation_approvals_surface_key_check'`,
            )
          ).rows[0]?.consrc,
        ).not.toMatch(/organizer_public_contact/);
      } finally {
        await bindingsRollback.query("ROLLBACK");
        bindingsRollback.release();
      }
      const pushPrefCols = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name='web_push_preferences'
           AND column_name = ANY($1::text[])
         ORDER BY column_name`,
        [[
          "notify_application_decisions",
          "notify_game_changes",
          "notify_invites",
          "notify_new_applications",
          "notify_outcome_reminders",
        ]],
      );
      expect(pushPrefCols.rows.map((r) => r.column_name)).toEqual([
        "notify_application_decisions",
        "notify_game_changes",
        "notify_invites",
        "notify_new_applications",
        "notify_outcome_reminders",
      ]);
      expect(
        (
          await pool.query(
            `SELECT 1 FROM pg_indexes
             WHERE tablename = 'web_push_delivery_intents'
               AND indexname = 'web_push_delivery_intents_event_recipient_uidx'`,
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await pool.query(
            `SELECT 1 FROM pg_indexes
             WHERE tablename = 'web_push_delivery_claims'
               AND indexname = 'web_push_delivery_claims_event_sub_uidx'`,
          )
        ).rows,
      ).toHaveLength(1);
      // 0056 #457 postgame organizer reminders.
      expect((await pool.query("SELECT to_regclass('public.game_outcome_reminders')::text AS name")).rows[0]?.name).toBe("game_outcome_reminders");
      expect((await pool.query("SELECT to_regclass('public.game_outcome_reminder_events')::text AS name")).rows[0]?.name).toBe("game_outcome_reminder_events");
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.game_outcome_reminders'::regclass
               AND conname = 'game_outcome_reminders_game_org_ordinal_uidx'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/UNIQUE/i);
      // 0048 PG-3 reviews/notes: physical tables beyond ledger filename alone.
      expect((await pool.query("SELECT to_regclass('public.game_reviews')::text AS name")).rows[0]?.name).toBe("game_reviews");
      expect((await pool.query("SELECT to_regclass('public.game_review_revisions')::text AS name")).rows[0]?.name).toBe("game_review_revisions");
      expect((await pool.query("SELECT to_regclass('public.game_review_replies')::text AS name")).rows[0]?.name).toBe("game_review_replies");
      expect((await pool.query("SELECT to_regclass('public.game_personal_notes')::text AS name")).rows[0]?.name).toBe("game_personal_notes");
      expect((await pool.query("SELECT to_regclass('public.game_personal_note_revisions')::text AS name")).rows[0]?.name).toBe("game_personal_note_revisions");
      expect((await pool.query("SELECT to_regclass('public.game_review_report_bindings')::text AS name")).rows[0]?.name).toBe("game_review_report_bindings");
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.abuse_reports'::regclass
               AND conname = 'abuse_reports_target_kind_check'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/game_review/);
      // 0053 exact revision tuple FK (not fake CHECK TRUE) + immutable trigger.
      expect(
        (
          await pool.query<{ consrc: string }>(
            `SELECT pg_get_constraintdef(oid) AS consrc
             FROM pg_constraint
             WHERE conrelid = 'public.game_review_report_bindings'::regclass
               AND conname = 'game_review_report_bindings_revision_tuple_fkey'`,
          )
        ).rows[0]?.consrc,
      ).toMatch(/FOREIGN KEY.+game_review_revisions/i);
      expect(
        (
          await pool.query(
            `SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.game_review_report_bindings'::regclass
               AND conname = 'game_review_report_bindings_revision_match_chk'`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await pool.query(
            `SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.game_review_revisions'::regclass
               AND conname = 'game_review_revisions_report_binding_tuple_uidx'`,
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await pool.query(
            `SELECT tgname FROM pg_trigger
             WHERE tgrelid = 'public.game_review_report_bindings'::regclass
               AND tgname = 'game_review_report_bindings_immutable'
               AND NOT tgisinternal`,
          )
        ).rows,
      ).toHaveLength(1);
      // Second-schema apply (same fixture pattern as url-storage dual search_path): 0047
      // local constraints + 6 history immutability triggers must exist on side OIDs so
      // public catalog rows cannot mask a missing side protection.
      const migrationsDir = path.resolve(apiRoot, "migrations");
      const migrationFiles = readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const sideClient = await pool.connect();
      try {
        await sideClient.query("DROP SCHEMA IF EXISTS side CASCADE");
        await sideClient.query("CREATE SCHEMA side");
        await sideClient.query("SET search_path TO side, public");
        for (const file of migrationFiles) {
          await sideClient.query(readFileSync(path.join(migrationsDir, file), "utf8"));
        }
        const sideConstraints = await sideClient.query<{ conname: string }>(
          `SELECT conname
           FROM pg_constraint
           WHERE (conrelid = 'side.game_attendance'::regclass
                  AND conname IN (
                    'game_attendance_value_check',
                    'game_attendance_source_check',
                    'game_attendance_late_value_check'
                  ))
              OR (conrelid = 'side.game_attendance_revisions'::regclass
                  AND conname IN (
                    'game_attendance_revisions_before_value_check',
                    'game_attendance_revisions_after_value_check',
                    'game_attendance_revisions_source_check',
                    'game_attendance_revisions_late_value_check'
                  ))
              OR (conrelid = 'side.game_attendance_notices'::regclass
                  AND conname IN (
                    'game_attendance_notices_value_check',
                    'game_attendance_notices_source_check',
                    'game_attendance_notices_late_value_check',
                    'game_attendance_notices_unknown_no_ack_check'
                  ))
              OR (conrelid = 'side.game_attendance_disputes'::regclass
                  AND conname IN (
                    'game_attendance_disputes_resolution_kind_check',
                    'game_attendance_disputes_response_bounds_check',
                    'game_attendance_disputes_help_progress_check',
                    'game_attendance_disputes_status_check',
                    'game_attendance_disputes_lifecycle_check'
                  ))
              OR (conrelid = 'side.game_attendance_dispute_revisions'::regclass
                  AND conname = 'game_attendance_dispute_revisions_action_check')
           ORDER BY conname`,
        );
        expect(sideConstraints.rows.map((row) => row.conname)).toEqual([
          "game_attendance_dispute_revisions_action_check",
          "game_attendance_disputes_help_progress_check",
          "game_attendance_disputes_lifecycle_check",
          "game_attendance_disputes_resolution_kind_check",
          "game_attendance_disputes_response_bounds_check",
          "game_attendance_disputes_status_check",
          "game_attendance_late_value_check",
          "game_attendance_notices_late_value_check",
          "game_attendance_notices_source_check",
          "game_attendance_notices_unknown_no_ack_check",
          "game_attendance_notices_value_check",
          "game_attendance_revisions_after_value_check",
          "game_attendance_revisions_before_value_check",
          "game_attendance_revisions_late_value_check",
          "game_attendance_revisions_source_check",
          "game_attendance_source_check",
          "game_attendance_value_check",
        ]);
        const sideTriggers = await sideClient.query<{ tgname: string }>(
          `SELECT tgname
           FROM pg_trigger
           WHERE NOT tgisinternal
             AND (
               (tgrelid = 'side.game_attendance_dispute_responses'::regclass
                AND tgname IN (
                  'game_attendance_dispute_responses_immutable',
                  'game_attendance_dispute_responses_deny_truncate'
                ))
               OR (tgrelid = 'side.game_attendance_dispute_case_links'::regclass
                   AND tgname IN (
                     'game_attendance_dispute_case_links_immutable',
                     'game_attendance_dispute_case_links_deny_truncate'
                   ))
               OR (tgrelid = 'side.game_attendance_dispute_resolutions'::regclass
                   AND tgname IN (
                     'game_attendance_dispute_resolutions_immutable',
                     'game_attendance_dispute_resolutions_deny_truncate'
                   ))
             )
           ORDER BY tgname`,
        );
        expect(sideTriggers.rows.map((row) => row.tgname)).toEqual([
          "game_attendance_dispute_case_links_deny_truncate",
          "game_attendance_dispute_case_links_immutable",
          "game_attendance_dispute_resolutions_deny_truncate",
          "game_attendance_dispute_resolutions_immutable",
          "game_attendance_dispute_responses_deny_truncate",
          "game_attendance_dispute_responses_immutable",
        ]);
        // 0046 snapshot/reason guard must survive 0047 on the side relation OID
        // (catalog def match; not global conname / migration SQL text alone).
        const sideRevisionSnapshotGuard = await sideClient.query<{ n: string }>(
          `SELECT count(*)::text AS n
           FROM pg_constraint con
           WHERE con.conrelid = 'side.game_attendance_revisions'::regclass
             AND con.contype = 'c'
             AND pg_get_constraintdef(con.oid) ILIKE '%resource_version = 1%'
             AND pg_get_constraintdef(con.oid) ILIKE '%before_value IS NULL%'
             AND pg_get_constraintdef(con.oid) ILIKE '%before_late IS NULL%'
             AND pg_get_constraintdef(con.oid) ILIKE '%before_correction_reason IS NULL%'
             AND pg_get_constraintdef(con.oid) ILIKE '%resource_version > 1%'
             AND pg_get_constraintdef(con.oid) ILIKE '%before_value IS NOT NULL%'
             AND pg_get_constraintdef(con.oid) ILIKE '%before_late IS NOT NULL%'
             AND pg_get_constraintdef(con.oid) ILIKE '%reason IS NOT NULL%'`,
        );
        expect(sideRevisionSnapshotGuard.rows[0]?.n).toBe("1");
      } finally {
        await sideClient.query("RESET search_path");
        await sideClient.query("DROP SCHEMA IF EXISTS side CASCADE");
        sideClient.release();
      }
      const profileColumns = await pool.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='venues' AND column_name IN ('court_count','amenity_parking','amenity_showers','public_description','public_profile_updated_at') ORDER BY column_name");
      expect(profileColumns.rows).toEqual([
        {column_name:"amenity_parking",data_type:"boolean",is_nullable:"YES",column_default:null},
        {column_name:"amenity_showers",data_type:"boolean",is_nullable:"YES",column_default:null},
        {column_name:"court_count",data_type:"integer",is_nullable:"YES",column_default:null},
        {column_name:"public_description",data_type:"text",is_nullable:"YES",column_default:null},
        {column_name:"public_profile_updated_at",data_type:"timestamp with time zone",is_nullable:"YES",column_default:null},
      ]);
      expect((await pool.query("SELECT conname FROM pg_constraint WHERE conrelid='venues'::regclass AND conname='venues_court_count_check'")).rows).toHaveLength(1);
      expect((await pool.query("SELECT tgname FROM pg_trigger WHERE tgrelid='venues'::regclass AND tgname='venue_public_profile_change' AND NOT tgisinternal AND tgenabled='O'")).rows).toHaveLength(1);
      // 0045 additive gallery: physical table + URL helper, beyond ledger filename alone.
      expect((await pool.query("SELECT to_regclass('public.venue_gallery_items')::text AS name")).rows[0]?.name).toBe("venue_gallery_items");
      expect((await pool.query("SELECT to_regprocedure('public.venue_gallery_item_url(uuid)') IS NOT NULL AS ok")).rows[0]?.ok).toBe(true);
      // 0046 attendance: physical tables beyond ledger filename alone.
      expect((await pool.query("SELECT to_regclass('public.game_attendance')::text AS name")).rows[0]?.name).toBe("game_attendance");
      expect((await pool.query("SELECT to_regclass('public.game_attendance_notices')::text AS name")).rows[0]?.name).toBe("game_attendance_notices");
      expect((await pool.query("SELECT to_regclass('public.game_attendance_disputes')::text AS name")).rows[0]?.name).toBe("game_attendance_disputes");
      // 0046 revision snapshot/reason guard remains on public OID after 0047 (catalog, not conname).
      const publicRevisionSnapshotGuard = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
         FROM pg_constraint con
         WHERE con.conrelid = 'public.game_attendance_revisions'::regclass
           AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) ILIKE '%resource_version = 1%'
           AND pg_get_constraintdef(con.oid) ILIKE '%before_value IS NULL%'
           AND pg_get_constraintdef(con.oid) ILIKE '%before_late IS NULL%'
           AND pg_get_constraintdef(con.oid) ILIKE '%before_correction_reason IS NULL%'
           AND pg_get_constraintdef(con.oid) ILIKE '%resource_version > 1%'
           AND pg_get_constraintdef(con.oid) ILIKE '%before_value IS NOT NULL%'
           AND pg_get_constraintdef(con.oid) ILIKE '%before_late IS NOT NULL%'
           AND pg_get_constraintdef(con.oid) ILIKE '%reason IS NOT NULL%'`,
      );
      expect(publicRevisionSnapshotGuard.rows[0]?.n).toBe("1");
      const galleryIndexes = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename='venue_gallery_items'
           AND indexname IN ('venue_gallery_active_position','venue_gallery_one_main','venue_gallery_venue_active')
         ORDER BY indexname`,
      );
      expect(galleryIndexes.rows.map((r) => r.indexname)).toEqual([
        "venue_gallery_active_position",
        "venue_gallery_one_main",
        "venue_gallery_venue_active",
      ]);
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
  }, 180_000);
});
