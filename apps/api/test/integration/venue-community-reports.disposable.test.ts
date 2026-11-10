/**
 * #507 I1 F3 — disposable PostGIS coverage for venue-community report intake + bindings.
 * Skips unless RUN_DB_INTEGRATION=1 and isolated disposable DATABASE_URL.
 * Fake providers only; no live fixtures; complaint detail never hits fetch/queue metadata.
 */
import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
const adminOrigin = "http://localhost:19507";
const adminPepper = "venue-community-reports-admin-pepper!!!!";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_venue_community_reports_disposable";
  const hosted =
    url.pathname === "/gobadminton" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GMAP1_DISPOSABLE_DB === "1" &&
    /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "") &&
    url.port === process.env.CI_DB_PORT;
  if (
    process.env.NODE_ENV !== "test" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !(dedicated || hosted)
  ) {
    throw new Error("Refusing nonlocal/non-test/nonisolated DB before Pool construction");
  }
  return raw;
}

type Actor = { userId: string; sessionId: string; csrfToken: string; cookie: string };
type AdminActor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

run("#507 I1 F3 venue-community reports — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let actorA: Actor;
  let actorB: Actor;
  let venueId: string;
  let otherVenueId: string;
  let fetchSpy: { mock: { calls: unknown[] }; mockRestore: () => void } | undefined;
  const migrations = path.resolve(__dirname, "../../migrations");

  beforeAll(async () => {
    const databaseUrl = disposableUrl();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 12,
      connectionTimeoutMillis: 5000,
      application_name: "venue-community-reports-synthetic",
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
      PUBLIC_WEB_ORIGIN: origin,
      COOKIE_SECURE: "false",
      AUTH_PEPPER: "venue-community-reports-pepper!!!!!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-community-reports-fingerprint-fix",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_AUTH_PEPPER: adminPepper,
      CASES_INTERNAL_ENABLED: "1",
      USER_RESTRICTIONS_INTERNAL_ENABLED: "1",
    });
    const ref = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        VenuesModule,
        ProfilesModule,
        SafetyModule,
        AdminModule,
      ],
    }).compile();
    app = ref.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = ref.get(SessionService);
  }, 120000);

  async function migrate(file: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(path.join(migrations, file), "utf8"));
      await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [
        file.replace(/\.sql$/, ""),
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  afterAll(async () => {
    fetchSpy?.mockRestore();
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    fetchSpy?.mockRestore();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    actorA = await actor("Reporter A");
    actorB = await actor("Author B");
    venueId = await createVenue(actorA, `Report Hall ${randomUUID()}`);
    otherVenueId = await createVenue(actorB, `Other Hall ${randomUUID()}`);
  });

  async function actor(name: string): Promise<Actor> {
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
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  function key() {
    return randomUUID();
  }

  async function createVenue(owner: Actor, name: string): Promise<string> {
    const created = await app.inject({
      method: "POST",
      url: "/v1/venues",
      headers: {
        origin,
        cookie: owner.cookie,
        "x-csrf-token": owner.csrfToken,
        "content-type": "application/json",
        "idempotency-key": key(),
      },
      payload: {
        cityId: MOSCOW_CITY_ID,
        name,
        address: "Synthetic Moscow",
        timezone: "Europe/Moscow",
        latitude: 55.75,
        longitude: 37.62,
      },
    });
    expect([200, 201]).toContain(created.statusCode);
    return created.json().id as string;
  }

  function mutationHeaders(a: Actor, idem: string, extra: Record<string, string> = {}) {
    return {
      origin,
      cookie: a.cookie,
      "x-csrf-token": a.csrfToken,
      "content-type": "application/json",
      "idempotency-key": idem,
      ...extra,
    };
  }

  async function report(a: Actor, body: Record<string, unknown>, idem = key()) {
    return app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(a, idem),
      payload: body,
    });
  }

  async function upsertVote(a: Actor, venue: string, value: number, expectedVersion: number) {
    return app.inject({
      method: "PUT",
      url: `/v1/venues/${venue}/community-rating`,
      headers: mutationHeaders(a, key()),
      payload: { value, expectedVersion },
    });
  }

  async function insertVenueComment(input: {
    venueId: string;
    authorUserId: string;
    body: string;
    moderationState?: "clear" | "withheld";
  }): Promise<{ id: string; version: number }> {
    const id = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO entity_comments
           (id, entity_kind, entity_id, parent_comment_id, author_user_id, body, version, moderation_state)
         VALUES ($1, 'venue', $2, NULL, $3, $4, 1, $5)`,
        [
          id,
          input.venueId,
          input.authorUserId,
          input.body,
          input.moderationState ?? "clear",
        ],
      );
      await client.query(
        `INSERT INTO entity_comment_revisions
           (comment_id, entity_kind, entity_id, resource_version, actor_user_id, after_body, tombstone)
         VALUES ($1, 'venue', $2, 1, $3, $4, false)`,
        [id, input.venueId, input.authorUserId, input.body],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { id, version: 1 };
  }

  async function adminActor(role: AdminRole): Promise<AdminActor> {
    const userId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users(display_name) VALUES($1) RETURNING id`,
        [`admin-${role}-${randomUUID()}`],
      )
    ).rows[0]!.id;
    const principalId = (
      await pool.query<{ id: string }>(
        `INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id`,
        [userId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')`,
      [principalId, role],
    );
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      `INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)`,
      [credentialId, principalId, Buffer.from("synthetic-vc-report-fixture")],
    );
    const sessionId = (
      await pool.query<{ id: string }>(
        `INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext,step_up_at)
         VALUES($1,$2,$3,$4,now()) RETURNING id`,
        [principalId, credentialId, hashSecret(adminPepper, token), sealSecret(adminPepper, csrf)],
      )
    ).rows[0]!.id;
    return { id: principalId, userId, token, csrf, sessionId };
  }

  it("denies guest/CSRF/Origin/revoked session; accepts aggregate without attendance", async () => {
    const guest = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: {
        origin,
        "content-type": "application/json",
        "idempotency-key": key(),
      },
      payload: {
        targetKind: "venue_community",
        subjectKind: "aggregate",
        venueId,
        reasonCode: "other",
      },
    });
    expect([401, 403]).toContain(guest.statusCode);

    const noCsrf = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: {
        origin,
        cookie: actorA.cookie,
        "content-type": "application/json",
        "idempotency-key": key(),
      },
      payload: {
        targetKind: "venue_community",
        subjectKind: "aggregate",
        venueId,
        reasonCode: "other",
      },
    });
    expect([401, 403]).toContain(noCsrf.statusCode);

    const badOrigin = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: mutationHeaders(actorA, key(), { origin: "http://evil.example" }),
      payload: {
        targetKind: "venue_community",
        subjectKind: "aggregate",
        venueId,
        reasonCode: "other",
      },
    });
    expect([401, 403]).toContain(badOrigin.statusCode);

    await pool.query(`UPDATE app_sessions SET revoked_at = now() WHERE id = $1`, [
      actorA.sessionId,
    ]);
    const revoked = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "other",
    });
    expect([401, 403]).toContain(revoked.statusCode);

    actorA = await actor("Reporter A2");
    const ok = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "other",
      detail: "aggregate manipulation quote with forbidden-looking spam http://x.test",
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: "submitted" });
    expect(ok.json().reportId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(ok.headers["cache-control"]).toMatch(/no-store/i);
    const binding = await pool.query(
      `SELECT subject_kind, vote_id, comment_id, reported_resource_version, content_fingerprint, canonical_venue_id
       FROM venue_community_report_bindings WHERE report_id = $1`,
      [ok.json().reportId],
    );
    expect(binding.rows[0]).toMatchObject({
      subject_kind: "aggregate",
      vote_id: null,
      comment_id: null,
      reported_resource_version: null,
      content_fingerprint: null,
      canonical_venue_id: venueId,
    });
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("reports own vote and public comment; own withheld safe; block does not evade public report", async () => {
    const vote = await upsertVote(actorA, venueId, 4, 0);
    expect(vote.statusCode).toBe(201);
    const ownVoteReport = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId,
      expectedVersion: 1,
      reasonCode: "inappropriate",
    });
    expect(ownVoteReport.statusCode).toBe(201);
    const voteBind = await pool.query(
      `SELECT subject_kind, vote_id, reported_resource_version, content_fingerprint, reporter_user_id
       FROM venue_community_report_bindings WHERE report_id = $1`,
      [ownVoteReport.json().reportId],
    );
    expect(voteBind.rows[0]?.subject_kind).toBe("own_vote");
    expect(voteBind.rows[0]?.reporter_user_id).toBe(actorA.userId);
    expect(voteBind.rows[0]?.reported_resource_version).toBe(1);
    expect(voteBind.rows[0]?.content_fingerprint).toHaveLength(64);

    const publicComment = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "public venue note",
    });
    {
      const low = actorA.userId < actorB.userId ? actorA.userId : actorB.userId;
      const high = actorA.userId < actorB.userId ? actorB.userId : actorA.userId;
      await pool.query(
        `INSERT INTO social_pairs (user_low, user_high)
         VALUES ($1, $2)
         ON CONFLICT (user_low, user_high) DO NOTHING`,
        [low, high],
      );
      const pairId = (
        await pool.query<{ id: string }>(
          `SELECT id FROM social_pairs WHERE user_low = $1 AND user_high = $2`,
          [low, high],
        )
      ).rows[0]!.id;
      await pool.query(
        `INSERT INTO user_blocks (blocker_user_id, blocked_user_id, pair_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [actorB.userId, actorA.userId, pairId],
      );
    }

    const publicReport = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: publicComment.id,
      expectedVersion: 1,
      reasonCode: "harassment",
      detail: "quoted kill yourself scam language still private complainant input",
    });
    expect(publicReport.statusCode).toBe(201);

    const withheld = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "hidden foreign",
      moderationState: "withheld",
    });
    const foreignWithheld = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: withheld.id,
      expectedVersion: 1,
      reasonCode: "spam",
    });
    expect(foreignWithheld.statusCode).toBe(404);

    const ownWithheld = await insertVenueComment({
      venueId,
      authorUserId: actorA.userId,
      body: "my withheld appeal",
      moderationState: "withheld",
    });
    const ownAppeal = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: ownWithheld.id,
      expectedVersion: 1,
      reasonCode: "other",
    });
    expect(ownAppeal.statusCode).toBe(201);
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("denies cross-venue/stale/retired/malformed; preserves binding immutability and idempotency", async () => {
    const comment = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "cross check",
    });
    const cross = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId: otherVenueId,
      commentId: comment.id,
      expectedVersion: 1,
      reasonCode: "spam",
    });
    expect(cross.statusCode).toBe(404);

    await upsertVote(actorA, venueId, 5, 0);
    const staleVote = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId,
      expectedVersion: 99,
      reasonCode: "other",
    });
    expect(staleVote.statusCode).toBe(409);

    const malformed = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId,
      expectedVersion: 1,
      reasonCode: "other",
      voteId: randomUUID(),
    });
    expect(malformed.statusCode).toBe(422);

    await pool.query(
      `UPDATE venues SET lifecycle_state = 'retired', updated_at = clock_timestamp() WHERE id = $1`,
      [venueId],
    );
    const retired = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "other",
    });
    expect(retired.statusCode).toBe(404);

    const freshVenue = await createVenue(actorA, `Idem Hall ${randomUUID()}`);
    const idem = key();
    const payload = {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId: freshVenue,
      reasonCode: "other",
      detail: "once",
    };
    const first = await report(actorA, payload, idem);
    expect(first.statusCode).toBe(201);
    const replay = await report(actorA, payload, idem);
    // Same key + same normalized request returns the original sealed 201 receipt.
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const count = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM venue_community_report_bindings
       WHERE reporter_user_id = $1 AND canonical_venue_id = $2 AND subject_kind = 'aggregate'`,
      [actorA.userId, freshVenue],
    );
    expect(count.rows[0]?.n).toBe(1);

    const mismatch = await report(
      actorA,
      { ...payload, detail: "different hash" },
      idem,
    );
    expect(mismatch.statusCode).toBe(409);

    const reportId = first.json().reportId as string;
    await expect(
      pool.query(
        `UPDATE venue_community_report_bindings SET subject_kind = 'own_vote' WHERE report_id = $1`,
        [reportId],
      ),
    ).rejects.toThrow();

    // Close the linked Case; a new key + different detail must not reuse the old receipt.
    const staff = await adminActor("superadmin");
    const closedCase = (
      await pool.query<{ id: string }>(
        `INSERT INTO support_cases (created_by, assigned_to, status)
         VALUES ($1, $1, 'open') RETURNING id`,
        [staff.id],
      )
    ).rows[0]!;
    await pool.query(
      `INSERT INTO support_case_links (case_id, source_kind, report_id)
       VALUES ($1, 'report', $2)`,
      [closedCase.id, reportId],
    );
    await pool.query(
      `UPDATE support_cases SET status = 'closed', version = 2, updated_at = clock_timestamp()
       WHERE id = $1`,
      [closedCase.id],
    );

    const idem2 = key();
    const secondPayload = { ...payload, detail: "second signal after close" };
    const second = await report(actorA, secondPayload, idem2);
    expect(second.statusCode).toBe(201);
    expect(second.json().reportId).not.toBe(reportId);
    const afterCount = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM venue_community_report_bindings
       WHERE reporter_user_id = $1 AND canonical_venue_id = $2 AND subject_kind = 'aggregate'`,
      [actorA.userId, freshVenue],
    );
    expect(afterCount.rows[0]?.n).toBe(2);
    const details = await pool.query<{ id: string; detail: string | null }>(
      `SELECT id, detail FROM abuse_reports
       WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [[reportId, second.json().reportId as string]],
    );
    expect(details.rows.map((r) => r.detail)).toEqual([
      "once",
      "second signal after close",
    ]);

    const replayFirst = await report(actorA, payload, idem);
    expect(replayFirst.statusCode).toBe(201);
    expect(replayFirst.json()).toEqual(first.json());
    const replaySecond = await report(actorA, secondPayload, idem2);
    expect(replaySecond.statusCode).toBe(201);
    expect(replaySecond.json()).toEqual(second.json());
    const finalCount = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM venue_community_report_bindings
       WHERE reporter_user_id = $1 AND canonical_venue_id = $2 AND subject_kind = 'aggregate'`,
      [actorA.userId, freshVenue],
    );
    expect(finalCount.rows[0]?.n).toBe(2);

    const queue = await app.inject({
      method: "GET",
      url: `/v1/admin/reports?reportId=${reportId}`,
      headers: {
        origin: adminOrigin,
        cookie: `${ADMIN_COOKIE}=${encodeURIComponent(staff.token)}`,
        "x-csrf-token": staff.csrf,
      },
    });
    expect(queue.statusCode).toBe(200);
    const item = queue.json().items[0] as Record<string, unknown>;
    expect(item.targetKind).toBe("venue_community");
    expect(item).not.toHaveProperty("detail");
    expect(item).not.toHaveProperty("targetPublicPlayerId");
    expect(item).not.toHaveProperty("contentFingerprint");
    expect(JSON.stringify(item)).not.toMatch(
      /once|different hash|second signal after close/i,
    );

    const stored = await pool.query<{ detail: string | null }>(
      `SELECT detail FROM abuse_reports WHERE id = $1`,
      [reportId],
    );
    expect(stored.rows[0]?.detail).toBe("once");
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("source edit race: stale comment version denied; same-key replay does not re-charge rate", async () => {
    const comment = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "v1 body",
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE entity_comments
         SET body = 'v2 body', version = 2, updated_at = clock_timestamp()
         WHERE id = $1`,
        [comment.id],
      );
      await client.query(
        `INSERT INTO entity_comment_revisions
           (comment_id, entity_kind, entity_id, resource_version, actor_user_id, before_body, after_body, tombstone)
         VALUES ($1, 'venue', $2, 2, $3, 'v1 body', 'v2 body', false)`,
        [comment.id, venueId, actorB.userId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const stale = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: comment.id,
      expectedVersion: 1,
      reasonCode: "spam",
    });
    expect(stale.statusCode).toBe(409);

    const commentIdem = key();
    const commentPayload = {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: comment.id,
      expectedVersion: 2,
      reasonCode: "spam",
      detail: "comment signal",
    };
    const current = await report(actorA, commentPayload, commentIdem);
    expect(current.statusCode).toBe(201);

    await pool.query(
      `UPDATE venue_community_report_rate_budgets
       SET count = 30, day_count = 100, window_started_at = now(), day_started_at = now()
       WHERE user_id = $1`,
      [actorA.userId],
    );
    // Same key + same normalized request: original 201, zero extra binding/rate.
    const again = await report(actorA, commentPayload, commentIdem);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(current.json());
    const bindingCount = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM venue_community_report_bindings
       WHERE reporter_user_id = $1 AND comment_id = $2`,
      [actorA.userId, comment.id],
    );
    expect(bindingCount.rows[0]?.n).toBe(1);

    // New/different key must charge rate — no source-dedupe bypass at 200/201.
    const limitedSameSource = await report(actorA, commentPayload, key());
    expect(limitedSameSource.statusCode).toBe(429);
    const limited = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "other",
    });
    expect(limited.statusCode).toBe(429);
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });
});
