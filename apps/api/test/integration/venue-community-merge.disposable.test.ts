/**
 * #507 I1 — Admin exclusive merge fence reconciles community votes on isolated PostGIS.
 * Skips unless RUN_DB_INTEGRATION=1 + dedicated disposable DB. No production credentials.
 */
import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { SessionService } from "../../src/auth/session.service";
import { AuthModule } from "../../src/auth/auth.module";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const adminOrigin = "http://localhost:19496";
const webOrigin = "http://127.0.0.1:3001";
const adminPepper = "venue-community-merge-synthetic-admin-pepper!!";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_venue_community_merge_disposable";
  const hosted = url.pathname === "/gobadminton" && process.env.GITHUB_ACTIONS === "true"
    && process.env.GMAP1_DISPOSABLE_DB === "1" && /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "")
    && url.port === process.env.CI_DB_PORT;
  if (process.env.NODE_ENV !== "test" || !["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.search || url.hash || !(dedicated || hosted)) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}

type AdminActor = { id: string; token: string; csrf: string };
type Consumer = { userId: string; cookie: string; csrfToken: string };

run("#507 I1 venue community merge reconciliation — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let admin: AdminActor;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "venue-community-merge-synthetic",
    });
    const existing = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'spatial_ref_sys'",
    );
    if (existing.rows.length) throw new Error("Requires EMPTY disposable application schema");
    await pool.query(
      "CREATE TABLE schema_migrations(id text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith(".sql")).sort()) {
      await migrate(file);
    }
    env = loadEnv({
      NODE_ENV: "test",
      APP_ENV: "local",
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      PUBLIC_API_ORIGIN: "http://127.0.0.1:3000",
      PUBLIC_WEB_ORIGIN: webOrigin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "venue-community-merge-synthetic-pepper!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-community-merge-fingerprint-fixture",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: adminPepper,
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
    });
    const ref = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        AdminModule,
        AuthModule,
        VenuesModule,
        ProfilesModule,
        SafetyModule,
      ],
    }).compile();
    app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);
    admin = await adminActor("content_manager");
  }, 120000);

  async function migrate(file: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [file.replace(/\.sql$/, "")]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM admin_rate_windows");
    await pool.query("DELETE FROM content_moderation_rate_budgets");
  });

  async function adminActor(role: AdminRole): Promise<AdminActor> {
    const uid = (await pool.query<{ id: string }>(
      "INSERT INTO users(display_name) VALUES('Merge admin') RETURNING id",
    )).rows[0]!.id;
    const id = (await pool.query<{ id: string }>(
      "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
      [uid],
    )).rows[0]!.id;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
      [id, role],
    );
    const credential = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [credential, id, Buffer.from("synthetic-merge-fixture")],
    );
    await pool.query(
      "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4)",
      [id, credential, hashSecret(adminPepper, token), sealSecret(adminPepper, csrf)],
    );
    return { id, token, csrf };
  }

  async function consumer(name: string): Promise<Consumer> {
    const userId = randomUUID();
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,$2)", [userId, name]);
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, display_name, directory_visible, contact_policy, directory_visibility_provenance, social_eligible, version)
       VALUES ($1, $2, true, 'requests', 'owner_default', true, 1)`,
      [userId, name],
    );
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  function adminPost(url: string, payload: Record<string, unknown>, key = randomUUID()) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/venues${url}`,
      headers: { origin: adminOrigin, "x-csrf-token": admin.csrf, "idempotency-key": key },
      cookies: { [ADMIN_COOKIE]: admin.token },
      payload,
    });
  }

  async function createVenue(extra: Record<string, unknown> = {}) {
    const r = await adminPost("", {
      cityId: MOSCOW_CITY_ID,
      // Avoid "Hall <token>" — extractIdentityDiscriminator would invent distinct hall: units.
      name: `Synthetic merge venue ${randomUUID()}`,
      address: `Synthetic address ${randomUUID()}`,
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
      reasonCode: "synthetic_review",
      ...extra,
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as { id: string; version: number };
  }

  /**
   * Same-physical legacy duplicates: Admin create owns one identity key; a second
   * row is SQL-cloned (create dedupe would conflict / consumer path returns same id).
   * Compatible empty discriminator so real Admin merge is allowed; distinct halls stay separate.
   */
  async function createLegacyDuplicatePair() {
    const token = randomUUID();
    const target = await createVenue({
      name: `Synthetic merge twin ${token}`,
      address: `Synthetic twin address ${token}`,
    });
    // Exact Admin recreate of the same identity is rejected — prove and keep one catalog id.
    const dedup = await adminPost("", {
      cityId: MOSCOW_CITY_ID,
      name: `Synthetic merge twin ${token}`,
      address: `Synthetic twin address ${token}`,
      timezone: "Europe/Moscow",
      latitude: 55.75,
      longitude: 37.62,
      reasonCode: "synthetic_review",
    });
    expect(dedup.statusCode).toBe(409);
    expect(dedup.json().code).toBe("VENUE_IDENTITY_CONFLICT");

    const source = (
      await pool.query<{ id: string; version: number }>(
        `INSERT INTO venues (
           city_id, name, address, timezone, location,
           data_status, provenance, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address,
           normalization_version, identity_discriminator
         )
         SELECT
           city_id, name, address, timezone, location,
           'unverified', 'legacy', created_by_user_id,
           lifecycle_state, normalized_name, normalized_address,
           normalization_version, identity_discriminator
         FROM venues WHERE id = $1
         RETURNING id, version`,
        [target.id],
      )
    ).rows[0]!;
    expect(source.id).not.toBe(target.id);

    const identity = await pool.query<{ d: string }>(
      `SELECT identity_discriminator AS d FROM venues WHERE id = ANY($1::uuid[])`,
      [[source.id, target.id]],
    );
    expect(identity.rows.map((r) => r.d)).toEqual(["", ""]);
    return { source, target };
  }

  function merge(sourceId: string, targetId: string, expectedTargetVersion = 1, expectedVersion = 1) {
    return adminPost(`/${sourceId}/commands`, {
      action: "merge",
      targetId,
      expectedVersion,
      expectedTargetVersion,
      reasonCode: "synthetic_review",
    });
  }

  async function putVote(who: Consumer, venueId: string, body: Record<string, unknown>) {
    return app.inject({
      method: "PUT",
      url: `/v1/venues/${venueId}/community-rating`,
      headers: {
        origin: webOrigin,
        cookie: who.cookie,
        "x-csrf-token": who.csrfToken,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      payload: body,
    });
  }

  async function delVote(who: Consumer, venueId: string, expectedVersion: number) {
    return app.inject({
      method: "DELETE",
      url: `/v1/venues/${venueId}/community-rating`,
      headers: {
        origin: webOrigin,
        cookie: who.cookie,
        "x-csrf-token": who.csrfToken,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      payload: { expectedVersion },
    });
  }

  async function summary(venueId: string) {
    const r = await app.inject({
      method: "GET",
      url: `/v1/venue-community-summaries?venueIds=${venueId}`,
    });
    expect(r.statusCode).toBe(200);
    return r.json().items[0] as {
      venueId: string;
      average: number | null;
      count: number;
      state: string;
    };
  }

  it("same-user conflict prefers recent withdrawal; withhold retained; single eligible aggregate; aliases/history; no cross-branch bleed", async () => {
    const { source, target } = await createLegacyDuplicatePair();
    const otherBranch = await createVenue({ identityDiscriminator: "hall:other" });
    const shared = await consumer("Shared voter");
    const onlySource = await consumer("Source-only voter");
    const onlyTarget = await consumer("Target-only voter");
    const branchVoter = await consumer("Branch voter");

    // Shared user: older live vote on target, newer withdrawal on source → withdrawal wins.
    const targetVote = await putVote(shared, target.id, { value: 5, expectedVersion: 0 });
    expect(targetVote.statusCode).toBe(201);
    const sourceVote = await putVote(shared, source.id, { value: 2, expectedVersion: 0 });
    expect(sourceVote.statusCode).toBe(201);
    const withdrawn = await delVote(shared, source.id, 1);
    expect(withdrawn.statusCode).toBe(200);

    // Force chronological order: source withdrawal is strictly later than target vote.
    await pool.query(
      `UPDATE venue_community_votes
       SET user_action_at = clock_timestamp() - interval '2 minutes'
       WHERE canonical_venue_id = $1 AND user_id = $2 AND merged_into_vote_id IS NULL`,
      [target.id, shared.userId],
    );
    await pool.query(
      `UPDATE venue_community_votes
       SET user_action_at = clock_timestamp()
       WHERE canonical_venue_id = $1 AND user_id = $2 AND merged_into_vote_id IS NULL`,
      [source.id, shared.userId],
    );

    // Source-only live vote that will be withheld; target-only clear vote.
    expect((await putVote(onlySource, source.id, { value: 4, expectedVersion: 0 })).statusCode).toBe(201);
    await pool.query(
      `UPDATE venue_community_votes SET moderation_state = 'withheld'
       WHERE canonical_venue_id = $1 AND user_id = $2 AND merged_into_vote_id IS NULL`,
      [source.id, onlySource.userId],
    );
    expect((await putVote(onlyTarget, target.id, { value: 3, expectedVersion: 0 })).statusCode).toBe(201);

    // Distinct physical branch must keep its own vote after merge of unrelated pair.
    expect((await putVote(branchVoter, otherBranch.id, { value: 5, expectedVersion: 0 })).statusCode).toBe(201);

    const preMergeCurrents = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM venue_community_votes
       WHERE canonical_venue_id = ANY($1::uuid[]) AND user_id = $2 AND merged_into_vote_id IS NULL`,
      [[source.id, target.id], shared.userId],
    );
    expect(preMergeCurrents.rows[0]!.c).toBe("2");

    const merged = await merge(source.id, target.id, target.version, source.version);
    expect(merged.statusCode, merged.body).toBe(201);

    const history = await pool.query(
      `SELECT source_venue_id, target_venue_id, reason FROM venue_merge_history
       WHERE source_venue_id = $1 AND target_venue_id = $2`,
      [source.id, target.id],
    );
    expect(history.rowCount).toBe(1);

    // Source resolves as alias of target; target version advanced by merge fence.
    const alias = await app.inject({ method: "GET", url: `/v1/venues/${source.id}` });
    expect(alias.statusCode).toBe(200);
    expect(alias.json().id).toBe(target.id);

    const current = await pool.query<{
      id: string;
      user_id: string;
      value: number | null;
      moderation_state: string;
      withdrawn_at: Date | null;
      merged_into_vote_id: string | null;
      version: number;
      user_action_at: Date;
    }>(
      `SELECT id, user_id, value, moderation_state, withdrawn_at, merged_into_vote_id, version, user_action_at
       FROM venue_community_votes
       WHERE canonical_venue_id = $1
       ORDER BY user_id, merged_into_vote_id NULLS FIRST, id`,
      [target.id],
    );
    const live = current.rows.filter((r) => r.merged_into_vote_id === null);
    expect(live).toHaveLength(3);

    const sharedLive = live.find((r) => r.user_id === shared.userId)!;
    expect(sharedLive.withdrawn_at).not.toBeNull();
    expect(sharedLive.value).toBeNull();

    // Real PostGIS unique index: source-winner path left exactly one current (venue,user).
    const currentDupes = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM (
         SELECT canonical_venue_id, user_id
         FROM venue_community_votes
         WHERE merged_into_vote_id IS NULL
         GROUP BY canonical_venue_id, user_id
         HAVING count(*) > 1
       ) d`,
    );
    expect(currentDupes.rows[0]!.c).toBe("0");
    const sharedCurrentOnTarget = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM venue_community_votes
       WHERE canonical_venue_id = $1 AND user_id = $2 AND merged_into_vote_id IS NULL`,
      [target.id, shared.userId],
    );
    expect(sharedCurrentOnTarget.rows[0]!.c).toBe("1");
    const sharedSuperseded = current.rows.filter(
      (r) => r.user_id === shared.userId && r.merged_into_vote_id !== null,
    );
    expect(sharedSuperseded).toHaveLength(1);
    expect(sharedSuperseded[0]!.merged_into_vote_id).toBe(sharedLive.id);
    await expect(
      pool.query(
        `INSERT INTO venue_community_votes
           (canonical_venue_id, user_id, value, version, moderation_state, user_action_at)
         VALUES ($1, $2, 1, 1, 'clear', clock_timestamp())`,
        [target.id, shared.userId],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const withheldLive = live.find((r) => r.user_id === onlySource.userId)!;
    expect(withheldLive.moderation_state).toBe("withheld");
    expect(withheldLive.value).toBe(4);
    // Source-only rehome must advance version past the upsert revision (v1 → v2)
    // and append a distinct merge_survive row; never reuse resource_version=1.
    expect(withheldLive.version).toBe(2);
    expect(withheldLive.withdrawn_at).toBeNull();
    const sourceOnlyRevisions = await pool.query<{
      action: string;
      resource_version: number;
      after_value: number | null;
      after_moderation_state: string;
      after_withdrawn: boolean | null;
    }>(
      `SELECT action, resource_version, after_value, after_moderation_state, after_withdrawn
       FROM venue_community_vote_revisions
       WHERE vote_id = $1
       ORDER BY resource_version ASC`,
      [withheldLive.id],
    );
    expect(sourceOnlyRevisions.rows).toEqual([
      expect.objectContaining({
        action: "upsert",
        resource_version: 1,
        after_value: 4,
        after_moderation_state: "clear",
        after_withdrawn: false,
      }),
      expect.objectContaining({
        action: "merge_survive",
        resource_version: 2,
        after_value: 4,
        after_moderation_state: "withheld",
        after_withdrawn: false,
      }),
    ]);

    const targetOnlyLive = live.find((r) => r.user_id === onlyTarget.userId)!;
    expect(targetOnlyLive).toMatchObject({ value: 3, moderation_state: "clear", withdrawn_at: null });

    // Superseded rows remain for history / version bookkeeping.
    expect(current.rows.some((r) => r.merged_into_vote_id !== null)).toBe(true);
    const revisions = await pool.query(
      `SELECT action FROM venue_community_vote_revisions
       WHERE action IN ('merge_survive', 'merge_supersede')`,
    );
    expect(revisions.rowCount).toBeGreaterThanOrEqual(2);

    // Aggregate: only clear non-withdrawn eligible vote (target-only = 3).
    const targetSummary = await summary(target.id);
    expect(targetSummary).toMatchObject({ average: 3, count: 1, state: "available" });
    const sourceSummary = await summary(source.id);
    expect(sourceSummary).toMatchObject({ average: 3, count: 1, state: "available" });

    // Distinct hall never received merge contamination.
    const branchVotes = await pool.query(
      `SELECT user_id, value, merged_into_vote_id FROM venue_community_votes
       WHERE canonical_venue_id = $1 AND merged_into_vote_id IS NULL`,
      [otherBranch.id],
    );
    expect(branchVotes.rows).toEqual([
      expect.objectContaining({ user_id: branchVoter.userId, value: 5, merged_into_vote_id: null }),
    ]);
    expect(await summary(otherBranch.id)).toMatchObject({ average: 5, count: 1, state: "available" });

    // Distinct units still cannot merge — fence preserves separate physical branches.
    const targetAfter = await pool.query<{ version: number }>(
      "SELECT version FROM venues WHERE id = $1",
      [target.id],
    );
    const distinct = await merge(
      otherBranch.id,
      target.id,
      targetAfter.rows[0]!.version,
      otherBranch.version,
    );
    expect(distinct.statusCode).toBe(409);
    expect(distinct.json().code).toBe("VENUE_DISTINCT_UNIT");
    const branchUnchanged = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM venue_community_votes
       WHERE canonical_venue_id = $1 AND merged_into_vote_id IS NULL`,
      [otherBranch.id],
    );
    expect(branchUnchanged.rows[0]!.c).toBe("1");
  });
});
