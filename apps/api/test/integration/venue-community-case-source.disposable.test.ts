/**
 * #507 I1 F3 — disposable PostGIS coverage for assigned Cases venue-community exact source read.
 * Skips unless RUN_DB_INTEGRATION=1 and isolated disposable DATABASE_URL.
 * Synthetic Admin/consumer fixtures only; no live OAuth; no provider calls.
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
const adminOrigin = "http://localhost:19508";
const adminPepper = "venue-community-case-source-admin-pepper!";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_venue_community_case_source_disposable";
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

run("#507 I1 F3 venue-community Cases source — disposable", () => {
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
      application_name: "venue-community-case-source-synthetic",
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
      AUTH_PEPPER: "venue-community-case-source-pepper!!!!!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-community-case-source-fingerprint!",
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
    venueId = await createVenue(actorA, `Case Source Hall ${randomUUID()}`);
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

  function mutationHeaders(a: Actor, idem: string) {
    return {
      origin,
      cookie: a.cookie,
      "x-csrf-token": a.csrfToken,
      "content-type": "application/json",
      "idempotency-key": idem,
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
    await pool.query(
      `INSERT INTO entity_comments
         (id, entity_kind, entity_id, parent_comment_id, author_user_id, body, version, moderation_state)
       VALUES ($1, 'venue', $2, NULL, $3, $4, 1, $5)`,
      [id, input.venueId, input.authorUserId, input.body, input.moderationState ?? "clear"],
    );
    await pool.query(
      `INSERT INTO entity_comment_revisions
         (comment_id, entity_kind, entity_id, resource_version, actor_user_id, after_body, tombstone)
       VALUES ($1, 'venue', $2, 1, $3, $4, false)`,
      [id, input.venueId, input.authorUserId, input.body],
    );
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
      [credentialId, principalId, Buffer.from("synthetic-vc-case-source")],
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

  function adminHeaders(a: AdminActor, idem?: string) {
    const headers: Record<string, string> = {
      origin: adminOrigin,
      cookie: `${ADMIN_COOKIE}=${encodeURIComponent(a.token)}`,
    };
    if (idem) {
      headers["x-csrf-token"] = a.csrf;
      headers["idempotency-key"] = idem;
      headers["content-type"] = "application/json";
    }
    return headers;
  }

  async function openAssignedCase(reportId: string, assignee: AdminActor) {
    const moderator = await adminActor("moderator");
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/cases",
      headers: adminHeaders(moderator, key()),
      payload: { reportId, reasonCode: "synthetic_community" },
    });
    expect(created.statusCode, created.body).toBe(200);
    const caseId = created.json().id as string;
    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}`,
      headers: adminHeaders(moderator),
    });
    const assign = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      headers: adminHeaders(moderator, key()),
      payload: {
        action: "assign",
        expectedVersion: detail.json().version,
        reasonCode: "synthetic_community",
        principalId: assignee.id,
      },
    });
    expect(assign.statusCode, assign.body).toBe(200);
    return { caseId, moderator };
  }

  it("reads aggregate/own_vote/comment sources with access fences and honest edit availability", async () => {
    const support = await adminActor("support");
    const pilot = await adminActor("pilot_viewer");
    const content = await adminActor("content_manager");
    const globalMod = await adminActor("moderator");

    await upsertVote(actorA, venueId, 5, 0);
    await upsertVote(actorB, venueId, 3, 0);
    const withheldVoter = await actor("Withheld Voter");
    const withheldVote = await upsertVote(withheldVoter, venueId, 2, 0);
    expect(withheldVote.statusCode).toBe(201);
    await pool.query(
      `UPDATE venue_community_votes SET moderation_state='withheld' WHERE canonical_venue_id=$1 AND user_id=$2`,
      [venueId, withheldVoter.userId],
    );

    const agg = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
      detail: "PRIVATE_AGGREGATE_DETAIL_MUST_STAY_SCOPED",
    });
    expect(agg.statusCode).toBe(201);
    const aggReportId = agg.json().reportId as string;

    const own = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId,
      expectedVersion: 1,
      reasonCode: "other",
      detail: "PRIVATE_OWN_VOTE_DETAIL",
    });
    expect(own.statusCode).toBe(201);
    const ownReportId = own.json().reportId as string;

    const comment = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "EXACT_REPORTED_COMMENT_BODY",
    });
    const commentReport = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: comment.id,
      expectedVersion: 1,
      reasonCode: "harassment",
      detail: "PRIVATE_COMMENT_DETAIL",
    });
    expect(commentReport.statusCode).toBe(201);
    const commentReportId = commentReport.json().reportId as string;

    // Edit after report must not silently replace reported body.
    await pool.query(
      `UPDATE entity_comments SET body=$2, version=2, updated_at=clock_timestamp() WHERE id=$1`,
      [comment.id, "EDITED_CURRENT_BODY_MUST_NOT_LEAK"],
    );
    await pool.query(
      `INSERT INTO entity_comment_revisions
         (comment_id, entity_kind, entity_id, resource_version, actor_user_id, before_body, after_body, tombstone)
       VALUES ($1, 'venue', $2, 2, $3, $4, $5, false)`,
      [
        comment.id,
        venueId,
        actorB.userId,
        "EXACT_REPORTED_COMMENT_BODY",
        "EDITED_CURRENT_BODY_MUST_NOT_LEAK",
      ],
    );

    const { caseId: aggCaseId } = await openAssignedCase(aggReportId, support);
    const { caseId: ownCaseId } = await openAssignedCase(ownReportId, support);
    const { caseId: commentCaseId, moderator } = await openAssignedCase(commentReportId, support);

    const queue = await app.inject({
      method: "GET",
      url: `/v1/admin/reports?reportId=${commentReportId}`,
      headers: adminHeaders(moderator),
    });
    expect(queue.statusCode).toBe(200);
    expect(JSON.stringify(queue.json())).not.toMatch(/PRIVATE_COMMENT_DETAIL|EXACT_REPORTED_COMMENT_BODY/i);

    for (const roleActor of [pilot, content, globalMod]) {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/v1/admin/cases/${commentCaseId}/community-reports/${commentReportId}`,
            headers: adminHeaders(roleActor),
          })
        ).statusCode,
      ).toBeGreaterThanOrEqual(403);
    }

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${commentCaseId}/community-reports/${commentReportId}`,
          headers: adminHeaders(await adminActor("support")),
        })
      ).statusCode,
    ).toBe(404);

    await pool.query(
      `UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1`,
      [support.sessionId],
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${commentCaseId}/community-reports/${commentReportId}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(403);
    await pool.query(`UPDATE admin_sessions SET step_up_at=now() WHERE id=$1`, [
      support.sessionId,
    ]);

    const aggRead = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${aggCaseId}/community-reports/${aggReportId}?limit=50`,
      headers: adminHeaders(support),
    });
    expect(aggRead.statusCode, aggRead.body).toBe(200);
    expect(aggRead.headers["cache-control"]).toMatch(/no-store/i);
    expect(aggRead.json()).toMatchObject({
      caseId: aggCaseId,
      reportId: aggReportId,
      subjectKind: "aggregate",
      detail: "PRIVATE_AGGREGATE_DETAIL_MUST_STAY_SCOPED",
      sourceAvailable: true,
    });
    expect(aggRead.json().votes.items.length).toBeGreaterThanOrEqual(3);
    expect(aggRead.json().votes.items.every((v: { eligibleForPublicCount: boolean; moderationState: string }) =>
      v.moderationState === "withheld" ? v.eligibleForPublicCount === false : true,
    )).toBe(true);
    expect(JSON.stringify(aggRead.json())).not.toMatch(/userId|email|phone|@/i);

    // Raw UUID / legacy beforeId is rejected — cursor must be HMAC-bound to this case/report/venue.
    const rawUuidCursor = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${aggCaseId}/community-reports/${aggReportId}?cursor=${randomUUID()}`,
      headers: adminHeaders(support),
    });
    expect(rawUuidCursor.statusCode).toBe(400);
    expect(rawUuidCursor.json().code).toBe("CURSOR_INVALID");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${aggCaseId}/community-reports/${aggReportId}?beforeId=${randomUUID()}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(400);

    const pageLimit = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${aggCaseId}/community-reports/${aggReportId}?limit=1`,
      headers: adminHeaders(support),
    });
    expect(pageLimit.statusCode, pageLimit.body).toBe(200);
    expect(pageLimit.json().votes.items).toHaveLength(1);
    const nextCursor = pageLimit.json().votes.nextCursor as string | null;
    expect(typeof nextCursor).toBe("string");
    expect(nextCursor!.includes(".")).toBe(true);
    const page2 = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${aggCaseId}/community-reports/${aggReportId}?cursor=${encodeURIComponent(nextCursor!)}&limit=1`,
      headers: adminHeaders(support),
    });
    expect(page2.statusCode, page2.body).toBe(200);
    expect(page2.json().votes.items[0].voteId).not.toBe(
      pageLimit.json().votes.items[0].voteId,
    );

    const ownRead = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${ownCaseId}/community-reports/${ownReportId}`,
      headers: adminHeaders(support),
    });
    expect(ownRead.statusCode, ownRead.body).toBe(200);
    expect(ownRead.json()).toMatchObject({
      subjectKind: "own_vote",
      sourceAvailable: true,
      reportedVersion: 1,
      reportedValue: 5,
      detail: "PRIVATE_OWN_VOTE_DETAIL",
    });

    const commentRead = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${commentCaseId}/community-reports/${commentReportId}`,
      headers: adminHeaders(support),
    });
    expect(commentRead.statusCode, commentRead.body).toBe(200);
    expect(commentRead.json()).toMatchObject({
      subjectKind: "venue_comment",
      sourceAvailable: true,
      text: "EXACT_REPORTED_COMMENT_BODY",
      currentPublication: "edited",
      reportedVersion: 1,
      currentVersion: 2,
      detail: "PRIVATE_COMMENT_DETAIL",
    });
    expect(JSON.stringify(commentRead.json())).not.toMatch(/EDITED_CURRENT_BODY_MUST_NOT_LEAK/);

    // Cross-case / wrong report isolation.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${aggCaseId}/community-reports/${commentReportId}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${commentCaseId}/community-reports/${aggReportId}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(404);

    // Other venue report cannot be read through this case.
    const otherAgg = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId: otherVenueId,
      reasonCode: "other",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${aggCaseId}/community-reports/${otherAgg.json().reportId}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(404);

    // Reporter independence — linked human identity, not role name.
    const asReporter = await adminActor("support");
    await pool.query(`UPDATE admin_principals SET user_id=$2 WHERE id=$1`, [
      asReporter.id,
      actorA.userId,
    ]);
    const coiFresh = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
      detail: "reporter-coi",
    });
    expect(coiFresh.statusCode).toBe(201);
    const { caseId: reporterCase } = await openAssignedCase(coiFresh.json().reportId, asReporter);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${reporterCase}/community-reports/${coiFresh.json().reportId}`,
          headers: adminHeaders(asReporter),
        })
      ).statusCode,
    ).toBe(403);

    // Revoke assignment clears access.
    const d1 = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${commentCaseId}`,
      headers: adminHeaders(moderator),
    });
    await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${commentCaseId}/commands`,
      headers: adminHeaders(moderator, key()),
      payload: {
        action: "assign",
        expectedVersion: d1.json().version,
        reasonCode: "synthetic_community",
        principalId: null,
      },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${commentCaseId}/community-reports/${commentReportId}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(404);

    const audits = await pool.query<{ after_diff: Record<string, unknown> }>(
      `SELECT after_diff FROM privileged_audit_events
       WHERE action_key='admin.case.community_report_read'
       ORDER BY created_at DESC LIMIT 20`,
    );
    for (const row of audits.rows) {
      const blob = JSON.stringify(row.after_diff ?? {});
      expect(blob).not.toMatch(/PRIVATE_|EXACT_REPORTED|fingerprint|bodyText|detail/i);
    }
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("preserves withheld comment for qualified staff and rejects deleted silent current substitution", async () => {
    const support = await adminActor("support");
    const withheld = await insertVenueComment({
      venueId,
      authorUserId: actorA.userId,
      body: "OWN_WITHHELD_EXACT_BODY",
      moderationState: "withheld",
    });
    const submitted = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: withheld.id,
      expectedVersion: 1,
      reasonCode: "inappropriate",
      detail: "PRIVATE_WITHHELD_DETAIL",
    });
    expect(submitted.statusCode).toBe(201);
    const reportId = submitted.json().reportId as string;
    const { caseId } = await openAssignedCase(reportId, support);
    const read = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      sourceAvailable: true,
      text: "OWN_WITHHELD_EXACT_BODY",
      currentPublication: "withheld",
      detail: "PRIVATE_WITHHELD_DETAIL",
    });

    await pool.query(
      `UPDATE entity_comments SET body=NULL, deleted_at=now(), version=2 WHERE id=$1`,
      [withheld.id],
    );
    await pool.query(
      `INSERT INTO entity_comment_revisions
         (comment_id, entity_kind, entity_id, resource_version, actor_user_id, before_body, after_body, tombstone)
       VALUES ($1, 'venue', $2, 2, $3, $4, NULL, true)`,
      [withheld.id, venueId, actorA.userId, "OWN_WITHHELD_EXACT_BODY"],
    );
    const afterDelete = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(afterDelete.json()).toMatchObject({
      sourceAvailable: true,
      text: "OWN_WITHHELD_EXACT_BODY",
      currentPublication: "deleted",
      reportedVersion: 1,
    });
    expect(JSON.stringify(afterDelete.json())).not.toMatch(/userId|email/i);
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("fail-closes conflicted reporter/subject on unavailable venue without leaking private detail", async () => {
    const support = await adminActor("support");
    // QA8 gap1: reviewer who voted on the aggregate must not receive private detail when venue is unavailable.
    const voterSession = await actor("Unavailable Voter Reviewer");
    const voterReviewer = await adminActor("support");
    expect((await upsertVote(voterSession, venueId, 4, 0)).statusCode).toBe(201);
    await pool.query(`UPDATE admin_principals SET user_id=$2 WHERE id=$1`, [
      voterReviewer.id,
      voterSession.userId,
    ]);

    const submitted = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
      detail: "PRIVATE_UNAVAILABLE_VENUE_DETAIL",
    });
    expect(submitted.statusCode).toBe(201);
    const reportId = submitted.json().reportId as string;
    const { caseId } = await openAssignedCase(reportId, support);

    // Retire venue so canonical resolution fails closed as unavailable.
    await pool.query(
      `UPDATE venues SET lifecycle_state='retired', version=version+1, updated_at=now() WHERE id=$1`,
      [venueId],
    );

    // Linked human reporter conflict must 403 before any private detail.
    await pool.query(`UPDATE admin_principals SET user_id=$2 WHERE id=$1`, [
      support.id,
      actorA.userId,
    ]);
    const asReporter = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(asReporter.statusCode).toBe(403);
    expect(JSON.stringify(asReporter.json())).not.toMatch(/PRIVATE_UNAVAILABLE_VENUE_DETAIL/);

    // Independent assignee: unresolvable venue → safe 404, zero private body/detail (not 200 DTO).
    const independent = await adminActor("support");
    await pool.query(`UPDATE support_cases SET assigned_to=$2 WHERE id=$1`, [
      caseId,
      independent.id,
    ]);
    const independentRead = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${reportId}`,
      headers: adminHeaders(independent),
    });
    expect(independentRead.statusCode, independentRead.body).toBe(404);
    expect(JSON.stringify(independentRead.json())).not.toMatch(
      /PRIVATE_UNAVAILABLE_VENUE_DETAIL/,
    );
    expect(independentRead.json()).not.toMatchObject({
      sourceAvailable: false,
      unavailableReason: "venue_unavailable",
    });

    // Same safe 404 for the voter-reviewer (own-vote conflict cannot be ruled out on unavailable family).
    await pool.query(`UPDATE support_cases SET assigned_to=$2 WHERE id=$1`, [
      caseId,
      voterReviewer.id,
    ]);
    const voterRead = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${reportId}`,
      headers: adminHeaders(voterReviewer),
    });
    expect(voterRead.statusCode, voterRead.body).toBe(404);
    expect(JSON.stringify(voterRead.json())).not.toMatch(/PRIVATE_UNAVAILABLE_VENUE_DETAIL/);

    // QA8 gap2: seed alias → terminal unavailable; terminal creator must not receive private detail.
    const terminalCreator = await actor("Terminal Creator Unavailable");
    const terminalId = await createVenue(terminalCreator, `Terminal ${randomUUID()}`);
    const seedAliasId = randomUUID();
    await pool.query(
      `INSERT INTO venues(
         id, city_id, name, address, timezone, location,
         data_status, provenance, lifecycle_state, canonical_venue_id,
         created_by_user_id, normalized_name, normalized_address, identity_discriminator
       )
       SELECT $1, city_id, $2, address, timezone, location,
              'unverified', 'legacy', 'merged', $3,
              $4, normalized_name || '-seed-alias', normalized_address,
              COALESCE(NULLIF(identity_discriminator,''),'base') || '-seed-alias'
       FROM venues WHERE id=$3`,
      [
        seedAliasId,
        `Seed Alias ${seedAliasId.slice(0, 8)}`,
        terminalId,
        actorB.userId,
      ],
    );
    const seedReportId = (
      await pool.query<{ id: string }>(
        `INSERT INTO abuse_reports(
           reporter_user_id, target_kind, target_user_id, target_public_player_id,
           reason_code, detail, evidence_refs, state
         ) VALUES ($1,'venue_community',$1,NULL,'spam',$2,'[]'::jsonb,'submitted')
         RETURNING id`,
        [actorA.userId, "PRIVATE_SEED_ALIAS_UNAVAILABLE_DETAIL"],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO venue_community_report_bindings(
         report_id, reporter_user_id, canonical_venue_id, subject_kind,
         vote_id, comment_id, reported_resource_version, content_fingerprint
       ) VALUES ($1,$2,$3,'aggregate',NULL,NULL,NULL,NULL)`,
      [seedReportId, actorA.userId, seedAliasId],
    );
    const seedSupport = await adminActor("support");
    const { caseId: seedCaseId } = await openAssignedCase(seedReportId, seedSupport);
    await pool.query(
      `UPDATE venues SET lifecycle_state='retired', version=version+1, updated_at=now() WHERE id=$1`,
      [terminalId],
    );
    const creatorReviewer = await adminActor("support");
    await pool.query(`UPDATE admin_principals SET user_id=$2 WHERE id=$1`, [
      creatorReviewer.id,
      terminalCreator.userId,
    ]);
    await pool.query(`UPDATE support_cases SET assigned_to=$2 WHERE id=$1`, [
      seedCaseId,
      creatorReviewer.id,
    ]);
    const creatorRead = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${seedCaseId}/community-reports/${seedReportId}`,
      headers: adminHeaders(creatorReviewer),
    });
    expect(creatorRead.statusCode, creatorRead.body).toBe(404);
    expect(JSON.stringify(creatorRead.json())).not.toMatch(
      /PRIVATE_SEED_ALIAS_UNAVAILABLE_DETAIL/,
    );
    expect(creatorRead.json()).not.toMatchObject({
      sourceAvailable: false,
      unavailableReason: "venue_unavailable",
    });
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("checks creator and historic admin-action affiliation across merged alias family", async () => {
    const support = await adminActor("support");
    const aliasCreator = await actor("Alias Creator");
    const aliasId = randomUUID();
    // Alias merged into terminal venueId; creator affiliation on alias must block review.
    await pool.query(
      `INSERT INTO venues(
         id, city_id, name, address, timezone, location,
         data_status, provenance, lifecycle_state, canonical_venue_id,
         created_by_user_id, normalized_name, normalized_address, identity_discriminator
       )
       SELECT $1, city_id, $2, address, timezone, location,
              'unverified', 'legacy', 'merged', $3,
              $4, normalized_name || '-alias', normalized_address,
              COALESCE(NULLIF(identity_discriminator,''),'base') || '-alias'
       FROM venues WHERE id=$3`,
      [aliasId, `Merged Alias ${aliasId.slice(0, 8)}`, venueId, aliasCreator.userId],
    );

    const submitted = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
      detail: "PRIVATE_ALIAS_CREATOR_DETAIL",
    });
    expect(submitted.statusCode).toBe(201);
    const reportId = submitted.json().reportId as string;
    const { caseId } = await openAssignedCase(reportId, support);

    await pool.query(`UPDATE admin_principals SET user_id=$2 WHERE id=$1`, [
      support.id,
      aliasCreator.userId,
    ]);
    const blocked = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${reportId}`,
      headers: adminHeaders(support),
    });
    expect(blocked.statusCode).toBe(403);
    expect(JSON.stringify(blocked.json())).not.toMatch(/PRIVATE_ALIAS_CREATOR_DETAIL/);

    // Historic admin action on the merged alias also blocks (not only terminal venue).
    const actionReviewer = await adminActor("support");
    const auditId = (
      await pool.query<{ id: string }>(
        `INSERT INTO privileged_audit_events(
           system_actor, roles_snapshot, permission_key, action_key,
           target_type, target_id, reason_code, request_id
         ) VALUES (
           'system_bootstrap', '[]', 'venue.manage', 'venue.verify',
           'venue', $1, 'synthetic_alias_admin', gen_random_uuid()
         ) RETURNING id`,
        [aliasId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO venue_admin_actions(venue_id, venue_version, action, actor_id, audit_id)
       VALUES ($1, 1, 'verify', $2, $3)`,
      [aliasId, actionReviewer.id, auditId],
    );
    await pool.query(`UPDATE support_cases SET assigned_to=$2 WHERE id=$1`, [
      caseId,
      actionReviewer.id,
    ]);
    const adminBlocked = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${reportId}`,
      headers: adminHeaders(actionReviewer),
    });
    expect(adminBlocked.statusCode).toBe(403);
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });

  it("redacts own_vote values on HMAC mismatch and rejects cross-report/venue cursors", async () => {
    const support = await adminActor("support");
    expect((await upsertVote(actorA, venueId, 4, 0)).statusCode).toBe(201);
    const voteRow = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM venue_community_votes
         WHERE canonical_venue_id=$1 AND user_id=$2 AND merged_into_vote_id IS NULL`,
        [venueId, actorA.userId],
      )
    ).rows[0]!;
    // Fresh isolated report+binding with intentionally mismatched fingerprint AT INSERT
    // (bindings are immutable — do not UPDATE existing binding / disable triggers).
    const ownReportId = (
      await pool.query<{ id: string }>(
        `INSERT INTO abuse_reports(
           reporter_user_id, target_kind, target_user_id, target_public_player_id,
           reason_code, detail, evidence_refs, state
         ) VALUES ($1,'venue_community',$1,NULL,'other',$2,'[]'::jsonb,'submitted')
         RETURNING id`,
        [actorA.userId, "PRIVATE_HMAC_DETAIL"],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO venue_community_report_bindings(
         report_id, reporter_user_id, canonical_venue_id, subject_kind,
         vote_id, comment_id, reported_resource_version, content_fingerprint
       ) VALUES ($1,$2,$3,'own_vote',$4,NULL,$5,$6)`,
      [
        ownReportId,
        actorA.userId,
        venueId,
        voteRow.id,
        voteRow.version,
        "0".repeat(64),
      ],
    );
    const { caseId: ownCaseId } = await openAssignedCase(ownReportId, support);

    const mismatched = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${ownCaseId}/community-reports/${ownReportId}`,
      headers: adminHeaders(support),
    });
    expect(mismatched.statusCode, mismatched.body).toBe(200);
    expect(mismatched.json()).toMatchObject({
      sourceAvailable: false,
      unavailableReason: "fingerprint_mismatch",
      detail: "PRIVATE_HMAC_DETAIL",
      reportedValue: null,
      reportedModerationState: null,
      reportedWithdrawn: null,
      currentValue: null,
      currentModerationState: null,
      currentWithdrawn: null,
      currentVersion: null,
    });

    await upsertVote(actorB, venueId, 5, 0);
    await upsertVote(await actor("Pager C"), venueId, 3, 0);
    const agg = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
    });
    expect(agg.statusCode).toBe(201);
    const aggReportId = agg.json().reportId as string;
    const { caseId: aggCaseId } = await openAssignedCase(aggReportId, support);
    const first = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${aggCaseId}/community-reports/${aggReportId}?limit=1`,
      headers: adminHeaders(support),
    });
    expect(first.statusCode).toBe(200);
    const goodCursor = first.json().votes.nextCursor as string;
    expect(typeof goodCursor).toBe("string");

    // Cross-report: cursor from this aggregate used on a different report/case.
    const otherAgg = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId: otherVenueId,
      reasonCode: "other",
    });
    expect(otherAgg.statusCode).toBe(201);
    const otherReportId = otherAgg.json().reportId as string;
    const { caseId: otherCaseId } = await openAssignedCase(otherReportId, support);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${otherCaseId}/community-reports/${otherReportId}?cursor=${encodeURIComponent(goodCursor)}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(400);

    // Tampered signature
    const [body] = goodCursor.split(".");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/admin/cases/${aggCaseId}/community-reports/${aggReportId}?cursor=${encodeURIComponent(`${body}.tampered`)}`,
          headers: adminHeaders(support),
        })
      ).statusCode,
    ).toBe(400);
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });
});
