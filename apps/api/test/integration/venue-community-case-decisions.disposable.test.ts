/**
 * #507 I1 F3 — disposable PostGIS coverage for assigned Cases venue_community_decide.
 * Skips unless RUN_DB_INTEGRATION=1 and isolated disposable DATABASE_URL.
 * Synthetic Admin/consumer fixtures only; fake provider; no live OAuth/provider.
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
import { CommentsModule } from "../../src/comments/comments.module";
import { FakeModerationProvider } from "../../src/moderation/fake-provider";
import {
  MODERATION_MODEL,
  MODERATION_PROVIDER,
  ModerationProviderError,
  TEXT_CATEGORIES,
  safeTextBatchDecision,
} from "../../src/moderation/provider";

function flaggedTextBatch(count: number, category: (typeof TEXT_CATEGORIES)[number] = "harassment") {
  return {
    model: MODERATION_MODEL,
    responseId: "synthetic-flagged-community-decide",
    results: Array.from({ length: count }, () => ({
      flagged: true,
      categories: Object.fromEntries(
        TEXT_CATEGORIES.map((key) => [key, key === category]),
      ) as Record<(typeof TEXT_CATEGORIES)[number], boolean>,
    })),
  };
}
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { SafetyModule } from "../../src/safety/safety.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://127.0.0.1:3001";
const adminOrigin = "http://localhost:19509";
const adminPepper = "venue-community-case-decide-admin-pepper!";

function disposableUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("Explicit disposable DATABASE_URL required");
  const url = new URL(raw);
  const dedicated = url.pathname === "/gobadminton_venue_community_case_decisions_disposable";
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

run("#507 I1 F3 venue-community Cases decisions — disposable", () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let fake: FakeModerationProvider;
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
      application_name: "venue-community-case-decisions-synthetic",
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
      AUTH_PEPPER: "venue-community-case-decide-pepper!!!!!!!",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "venue-community-case-decide-fingerprint!",
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
        CommentsModule,
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
    fake = app.get<FakeModerationProvider>(MODERATION_PROVIDER);
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
    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    actorA = await actor("Reporter A");
    actorB = await actor("Author B");
    venueId = await createVenue(actorA, `Case Decide Hall ${randomUUID()}`);
    otherVenueId = await createVenue(actorB, `Other Decide Hall ${randomUUID()}`);
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
      [credentialId, principalId, Buffer.from("synthetic-vc-case-decide")],
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
    return { caseId, version: assign.json().version as number, moderator };
  }

  async function decide(
    support: AdminActor,
    caseId: string,
    payload: Record<string, unknown>,
    idem = key(),
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/cases/${caseId}/commands`,
      headers: adminHeaders(support, idem),
      payload,
    });
  }

  async function publicSummary(venue: string) {
    const res = await app.inject({
      method: "GET",
      url: `/v1/venue-community-summaries?venueIds=${venue}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json().items[0] as { count: number | null; average: number | null; state: string };
  }

  it("withholds/restores/retains votes and comments; public counts and own withheld view", async () => {
    const support = await adminActor("support");
    const voteRes = await upsertVote(actorA, venueId, 5, 0);
    expect(voteRes.statusCode).toBe(201);
    await upsertVote(actorB, venueId, 4, 0);
    const voteId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venue_community_votes WHERE canonical_venue_id=$1 AND user_id=$2`,
        [venueId, actorA.userId],
      )
    ).rows[0]!.id;

    const agg = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
      detail: "PRIVATE_AGG_DETAIL",
    });
    const { caseId, version } = await openAssignedCase(agg.json().reportId, support);
    const source = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${caseId}/community-reports/${agg.json().reportId}`,
      headers: adminHeaders(support),
    });
    expect(source.statusCode).toBe(200);
    expect(source.json().decisionCapability).toMatchObject({
      action: "venue_community_decide",
      requiresExactVoteId: true,
      resourceKind: "vote",
    });

    const before = await publicSummary(venueId);
    expect(before.count).toBe(2);

    const withhold = await decide(support, caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: version,
      expectedResourceVersion: 1,
      reportId: agg.json().reportId,
      resourceKind: "vote",
      voteId,
      decision: "withhold",
      rationale: "Synthetic withhold for aggregate vote",
      reasonCode: "synthetic_community",
    });
    expect(withhold.statusCode, withhold.body).toBe(200);
    expect(withhold.json()).toMatchObject({
      decision: "withhold",
      resourceKind: "vote",
      voteId,
      resourceVersion: 2,
    });
    const afterWithhold = await publicSummary(venueId);
    expect(afterWithhold.count).toBe(1);

    const own = await app.inject({
      method: "GET",
      url: `/v1/venues/${venueId}/community-rating/me`,
      headers: {
        origin,
        cookie: actorA.cookie,
      },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().own).toMatchObject({
      moderationState: "withheld",
      value: 5,
      version: 2,
    });

    const restore = await decide(support, caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: withhold.json().caseVersion,
      expectedResourceVersion: 2,
      reportId: agg.json().reportId,
      resourceKind: "vote",
      voteId,
      decision: "restore",
      rationale: "Synthetic restore for aggregate vote",
      reasonCode: "synthetic_community",
    });
    expect(restore.statusCode, restore.body).toBe(200);
    expect((await publicSummary(venueId)).count).toBe(2);

    const retain = await decide(support, caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: restore.json().caseVersion,
      expectedResourceVersion: 3,
      reportId: agg.json().reportId,
      resourceKind: "vote",
      voteId,
      decision: "retain",
      rationale: "Synthetic retain metadata only",
      reasonCode: "synthetic_community",
    });
    expect(retain.statusCode, retain.body).toBe(200);
    expect(retain.json().resourceVersion).toBe(3);
    const voteRow = (
      await pool.query<{ version: number; moderation_state: string }>(
        `SELECT version, moderation_state FROM venue_community_votes WHERE id=$1`,
        [voteId],
      )
    ).rows[0]!;
    expect(voteRow).toEqual({ version: 3, moderation_state: "clear" });

    const comment = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "PUBLIC_COMMENT_BODY_FOR_DECISION",
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
    const commentCase = await openAssignedCase(commentReport.json().reportId, support);
    const commentWithhold = await decide(support, commentCase.caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: commentCase.version,
      expectedResourceVersion: 1,
      reportId: commentReport.json().reportId,
      resourceKind: "comment",
      commentId: comment.id,
      decision: "withhold",
      rationale: "Hide venue comment",
      reasonCode: "synthetic_community",
    });
    expect(commentWithhold.statusCode, commentWithhold.body).toBe(200);
    const guestList = await app.inject({
      method: "GET",
      url: `/v1/venues/${venueId}/comments`,
    });
    expect(guestList.statusCode).toBe(200);
    expect(
      (guestList.json().items as Array<{ id: string }>).some((c) => c.id === comment.id),
    ).toBe(false);
    const authorList = await app.inject({
      method: "GET",
      url: `/v1/venues/${venueId}/comments`,
      headers: { origin, cookie: actorB.cookie },
    });
    expect(
      (authorList.json().items as Array<{ id: string }>).some((c) => c.id === comment.id),
    ).toBe(true);

    const commentRestore = await decide(support, commentCase.caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: commentWithhold.json().caseVersion,
      expectedResourceVersion: 2,
      reportId: commentReport.json().reportId,
      resourceKind: "comment",
      commentId: comment.id,
      decision: "restore",
      rationale: "Restore venue comment after gate",
      reasonCode: "synthetic_community",
    });
    expect(commentRestore.statusCode, commentRestore.body).toBe(200);
    expect(commentRestore.json().resourceVersion).toBe(3);
    const guestAfter = await app.inject({
      method: "GET",
      url: `/v1/venues/${venueId}/comments`,
    });
    expect(
      (guestAfter.json().items as Array<{ id: string }>).some((c) => c.id === comment.id),
    ).toBe(true);

    const history = await app.inject({
      method: "GET",
      url: `/v1/admin/cases/${commentCase.caseId}`,
      headers: adminHeaders(support),
    });
    expect(history.statusCode).toBe(200);
    const histDump = JSON.stringify(history.json());
    expect(histDump).not.toMatch(/PUBLIC_COMMENT_BODY_FOR_DECISION|PRIVATE_COMMENT_DETAIL/);
    expect(histDump).not.toMatch(/fingerprint|@|phone/i);
  });

  it("denies wrong role/unassigned/expired step-up/COI/cross-case/cross-venue and stale versions", async () => {
    const support = await adminActor("support");
    const otherSupport = await adminActor("support");
    const pilot = await adminActor("pilot_viewer");
    await upsertVote(actorA, venueId, 5, 0);
    const voteId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venue_community_votes WHERE canonical_venue_id=$1 AND user_id=$2`,
        [venueId, actorA.userId],
      )
    ).rows[0]!.id;
    const own = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId,
      expectedVersion: 1,
      reasonCode: "other",
    });
    const { caseId, version } = await openAssignedCase(own.json().reportId, support);
    const base = {
      action: "venue_community_decide",
      expectedCaseVersion: version,
      expectedResourceVersion: 1,
      reportId: own.json().reportId,
      resourceKind: "vote",
      voteId,
      decision: "withhold",
      rationale: "deny checks",
      reasonCode: "synthetic_community",
    };

    expect((await decide(pilot, caseId, base)).statusCode).toBeGreaterThanOrEqual(403);
    expect((await decide(otherSupport, caseId, base)).statusCode).toBe(404);

    await pool.query(
      `UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1`,
      [support.sessionId],
    );
    expect((await decide(support, caseId, base)).statusCode).toBe(403);
    await pool.query(`UPDATE admin_sessions SET step_up_at=now() WHERE id=$1`, [
      support.sessionId,
    ]);

    // Fresh allowed report — same reportId is already linked (409), which must not mask COI 403.
    const coiReport = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
    });
    expect(coiReport.statusCode, coiReport.body).toBe(201);
    const asReporter = await adminActor("support");
    await pool.query(`UPDATE admin_principals SET user_id=$2 WHERE id=$1`, [
      asReporter.id,
      actorB.userId,
    ]);
    const coiCase = await openAssignedCase(coiReport.json().reportId, asReporter);
    const coiDenied = await decide(asReporter, coiCase.caseId, {
      ...base,
      expectedCaseVersion: coiCase.version,
      reportId: coiReport.json().reportId,
    });
    expect(coiDenied.statusCode).toBe(403);
    expect(coiDenied.json().code).toBe("REVIEWER_SUBJECT_CONFLICT");

    const otherVote = await upsertVote(actorB, otherVenueId, 3, 0);
    expect(otherVote.statusCode).toBe(201);
    const foreignVoteId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venue_community_votes WHERE canonical_venue_id=$1 AND user_id=$2`,
        [otherVenueId, actorB.userId],
      )
    ).rows[0]!.id;
    expect(
      (
        await decide(support, caseId, {
          ...base,
          voteId: foreignVoteId,
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(404);

    const otherAgg = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId: otherVenueId,
      reasonCode: "spam",
    });
    expect(
      (
        await decide(support, caseId, {
          ...base,
          reportId: otherAgg.json().reportId,
          voteId: foreignVoteId,
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await decide(support, caseId, {
          ...base,
          expectedCaseVersion: version + 99,
        })
      ).json().code,
    ).toBe("CASE_VERSION_CONFLICT");
    expect(
      (
        await decide(support, caseId, {
          ...base,
          expectedResourceVersion: 99,
        })
      ).json().code,
    ).toBe("VERSION_CONFLICT");
  });

  it("shared catalog fence blocks decide across concurrent merge affiliation change", async () => {
    const support = await adminActor("support");
    const content = await adminActor("content_manager");
    await upsertVote(actorA, venueId, 5, 0);
    const voteId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venue_community_votes WHERE canonical_venue_id=$1 AND user_id=$2`,
        [venueId, actorA.userId],
      )
    ).rows[0]!.id;
    const agg = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
    });
    expect(agg.statusCode, agg.body).toBe(201);
    const { caseId, version } = await openAssignedCase(agg.json().reportId, support);

    // Legacy duplicate twin owned by the assigned reviewer — Admin merge brings COI into family.
    const affiliate = (
      await pool.query<{ id: string; version: number }>(
        `INSERT INTO venues (
           city_id, name, address, timezone, location,
           data_status, provenance, created_by_user_id,
           lifecycle_state, normalized_name, normalized_address,
           normalization_version, identity_discriminator
         )
         SELECT
           city_id, name, address, timezone, location,
           'unverified', 'legacy', $2,
           lifecycle_state, normalized_name, normalized_address,
           normalization_version, identity_discriminator
         FROM venues WHERE id = $1
         RETURNING id, version`,
        [venueId, support.userId],
      )
    ).rows[0]!;
    expect(affiliate.id).not.toBe(venueId);

    const payload = {
      action: "venue_community_decide",
      expectedCaseVersion: version,
      expectedResourceVersion: 1,
      reportId: agg.json().reportId,
      resourceKind: "vote",
      voteId,
      decision: "withhold",
      rationale: "must not decide after merge affiliation",
      reasonCode: "synthetic_community",
    };

    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query(
        "SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))",
      );
      const pendingDecide = decide(support, caseId, payload);
      let blocked = false;
      for (let i = 0; i < 80; i++) {
        const waiting = await locker.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM pg_locks
           WHERE locktype = 'advisory' AND NOT granted AND pid <> pg_backend_pid()`,
        );
        if ((waiting.rows[0]?.n ?? 0) > 0) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(true);

      // Queue real Admin merge behind the exclusive catalog fence (do not await — would deadlock).
      const pendingMerge = app.inject({
        method: "POST",
        url: `/v1/admin/venues/${affiliate.id}/commands`,
        headers: adminHeaders(content, key()),
        payload: {
          action: "merge",
          targetId: venueId,
          expectedVersion: affiliate.version,
          expectedTargetVersion: 1,
          reasonCode: "synthetic_review",
        },
      });
      let mergeQueued = false;
      for (let i = 0; i < 80; i++) {
        const waiting = await locker.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM pg_locks
           WHERE locktype = 'advisory' AND NOT granted AND pid <> pg_backend_pid()`,
        );
        if ((waiting.rows[0]?.n ?? 0) >= 2) {
          mergeQueued = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(mergeQueued).toBe(true);

      // Affiliation change under exclusive fence before decide/shared proceeds (AdminVenues.merge shape).
      await locker.query(
        `UPDATE venues
         SET lifecycle_state = 'merged',
             canonical_venue_id = $2,
             version = version + 1,
             updated_at = now()
         WHERE id = $1`,
        [affiliate.id, venueId],
      );
      await locker.query(
        `UPDATE venues SET version = version + 1, updated_at = now() WHERE id = $1`,
        [venueId],
      );
      await locker.query(
        `INSERT INTO venue_merge_history(source_venue_id, target_venue_id, reason)
         VALUES ($1, $2, 'synthetic_review')`,
        [affiliate.id, venueId],
      );
      await locker.query("COMMIT");

      const [decided, merged] = await Promise.all([pendingDecide, pendingMerge]);
      expect(decided.statusCode).toBe(403);
      expect(decided.json().code).toBe("REVIEWER_VENUE_CONFLICT");
      // HTTP merge observes already-merged source after our fence mutation, or completes harmlessly.
      expect([201, 409]).toContain(merged.statusCode);
      const decisions = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM venue_community_decisions WHERE case_id=$1`,
        [caseId],
      );
      expect(decisions.rows[0]!.n).toBe(0);
      const family = await pool.query<{ id: string }>(
        `WITH RECURSIVE family AS (
           SELECT id FROM venues WHERE id = $1
           UNION
           SELECT v.id FROM venues v
           JOIN family f ON v.canonical_venue_id = f.id
           WHERE v.lifecycle_state = 'merged'
         )
         SELECT id FROM family`,
        [venueId],
      );
      expect(family.rows.map((r) => r.id)).toContain(affiliate.id);
    } finally {
      try {
        await locker.query("ROLLBACK");
      } catch {
        /* already committed/released */
      }
      locker.release();
    }
  });

  it("never resurrects withdrawn/deleted resources; fake provider reject/unavailable keeps withheld", async () => {
    const support = await adminActor("support");
    await upsertVote(actorA, venueId, 5, 0);
    const withdraw = await app.inject({
      method: "DELETE",
      url: `/v1/venues/${venueId}/community-rating`,
      headers: mutationHeaders(actorA, key()),
      payload: { expectedVersion: 1 },
    });
    expect(withdraw.statusCode).toBe(200);
    const voteId = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM venue_community_votes WHERE canonical_venue_id=$1 AND user_id=$2`,
        [venueId, actorA.userId],
      )
    ).rows[0]!;
    await pool.query(
      `UPDATE venue_community_votes SET moderation_state='withheld' WHERE id=$1`,
      [voteId.id],
    );
    const own = await report(actorA, {
      targetKind: "venue_community",
      subjectKind: "own_vote",
      venueId,
      expectedVersion: voteId.version,
      reasonCode: "other",
    });
    expect(own.statusCode, own.body).toBe(201);
    // Current vote is withdrawn+withheld — restore must not resurrect.
    const { caseId, version } = await openAssignedCase(own.json().reportId, support);
    const restoreWithdrawn = await decide(support, caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: version,
      expectedResourceVersion: voteId.version,
      reportId: own.json().reportId,
      resourceKind: "vote",
      voteId: voteId.id,
      decision: "restore",
      rationale: "must not resurrect withdrawn",
      reasonCode: "synthetic_community",
    });
    expect([409, 404, 422]).toContain(restoreWithdrawn.statusCode);

    const comment = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "TOMBSTONE_COMMENT",
      moderationState: "withheld",
    });
    // Author may report own withheld tip, then tombstone before staff restore.
    const cReport = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: comment.id,
      expectedVersion: 1,
      reasonCode: "spam",
    });
    expect(cReport.statusCode, cReport.body).toBe(201);
    await pool.query(
      `UPDATE entity_comments SET deleted_at=clock_timestamp(), body=NULL, version=2 WHERE id=$1`,
      [comment.id],
    );
    await pool.query(
      `INSERT INTO entity_comment_revisions
         (comment_id, entity_kind, entity_id, resource_version, actor_user_id, before_body, after_body, tombstone)
       VALUES ($1,'venue',$2,2,$3,'TOMBSTONE_COMMENT',NULL,true)`,
      [comment.id, venueId, actorB.userId],
    );
    const cCase = await openAssignedCase(cReport.json().reportId, support);
    const resurrect = await decide(support, cCase.caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: cCase.version,
      expectedResourceVersion: 2,
      reportId: cReport.json().reportId,
      resourceKind: "comment",
      commentId: comment.id,
      decision: "restore",
      rationale: "must not resurrect deleted",
      reasonCode: "synthetic_community",
    });
    expect([409, 404, 422]).toContain(resurrect.statusCode);

    const live = await insertVenueComment({
      venueId,
      authorUserId: actorB.userId,
      body: "RESTORE_PROVIDER_TEXT",
      moderationState: "withheld",
    });
    // Author may report own withheld tip; foreign withheld stays unavailable (would 404 → missing reportId).
    const liveReport = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "venue_comment",
      venueId,
      commentId: live.id,
      expectedVersion: 1,
      reasonCode: "inappropriate",
    });
    expect(liveReport.statusCode, liveReport.body).toBe(201);
    const liveCase = await openAssignedCase(liveReport.json().reportId, support);

    fake.textFixture = async (input) => flaggedTextBatch(input.texts.length, "harassment");
    const rejectRestore = await decide(support, liveCase.caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: liveCase.version,
      expectedResourceVersion: 1,
      reportId: liveReport.json().reportId,
      resourceKind: "comment",
      commentId: live.id,
      decision: "restore",
      rationale: "provider reject must keep withheld",
      reasonCode: "synthetic_community",
    });
    expect(rejectRestore.statusCode).toBe(422);
    expect(
      (
        await pool.query<{ moderation_state: string; version: number }>(
          `SELECT moderation_state, version FROM entity_comments WHERE id=$1`,
          [live.id],
        )
      ).rows[0],
    ).toEqual({ moderation_state: "withheld", version: 1 });

    fake.textFixture = async () => {
      throw new ModerationProviderError("unavailable", 3);
    };
    const unavailableRestore = await decide(support, liveCase.caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: liveCase.version,
      expectedResourceVersion: 1,
      reportId: liveReport.json().reportId,
      resourceKind: "comment",
      commentId: live.id,
      decision: "restore",
      rationale: "provider unavailable must keep withheld",
      reasonCode: "synthetic_community",
    });
    expect([422, 503]).toContain(unavailableRestore.statusCode);
    expect(
      (
        await pool.query<{ moderation_state: string; version: number }>(
          `SELECT moderation_state, version FROM entity_comments WHERE id=$1`,
          [live.id],
        )
      ).rows[0],
    ).toEqual({ moderation_state: "withheld", version: 1 });

    fake.textFixture = async (input) => safeTextBatchDecision(input.texts.length);
    const okRestore = await decide(support, liveCase.caseId, {
      action: "venue_community_decide",
      expectedCaseVersion: liveCase.version,
      expectedResourceVersion: 1,
      reportId: liveReport.json().reportId,
      resourceKind: "comment",
      commentId: live.id,
      decision: "restore",
      rationale: "provider allow binds actual version",
      reasonCode: "synthetic_community",
    });
    expect(okRestore.statusCode, okRestore.body).toBe(200);
    expect(okRestore.json().resourceVersion).toBe(2);
    const binding = await pool.query(
      `SELECT resource_version, binding_kind FROM content_moderation_bindings
       WHERE entity_kind='entity_comment' AND entity_id=$1 AND binding_kind='publication'`,
      [live.id],
    );
    expect(binding.rows.some((r) => Number(r.resource_version) === 2)).toBe(true);
  });

  it("idempotent duplicate key once, payload conflict 409, replay after revoke denied", async () => {
    const support = await adminActor("support");
    await upsertVote(actorA, venueId, 5, 0);
    const voteId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM venue_community_votes WHERE canonical_venue_id=$1 AND user_id=$2`,
        [venueId, actorA.userId],
      )
    ).rows[0]!.id;
    const agg = await report(actorB, {
      targetKind: "venue_community",
      subjectKind: "aggregate",
      venueId,
      reasonCode: "spam",
    });
    const { caseId, version } = await openAssignedCase(agg.json().reportId, support);
    const idem = key();
    const payload = {
      action: "venue_community_decide",
      expectedCaseVersion: version,
      expectedResourceVersion: 1,
      reportId: agg.json().reportId,
      resourceKind: "vote",
      voteId,
      decision: "withhold",
      rationale: "idempotent withhold",
      reasonCode: "synthetic_community",
    };
    const first = await decide(support, caseId, payload, idem);
    expect(first.statusCode, first.body).toBe(200);
    const replay = await decide(support, caseId, payload, idem);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const revisions = await pool.query(
      `SELECT count(*)::int AS n FROM venue_community_vote_revisions
       WHERE vote_id=$1 AND action='moderation_withhold'`,
      [voteId],
    );
    expect(revisions.rows[0]!.n).toBe(1);
    const decisions = await pool.query(
      `SELECT count(*)::int AS n FROM venue_community_decisions WHERE case_id=$1`,
      [caseId],
    );
    expect(decisions.rows[0]!.n).toBe(1);

    const conflicted = await decide(support, caseId, { ...payload, decision: "retain" }, idem);
    expect(conflicted.statusCode).toBe(409);
    expect(conflicted.json().code).toBe("IDEMPOTENCY_KEY_REUSED");

    await pool.query(`UPDATE support_cases SET assigned_to=NULL WHERE id=$1`, [caseId]);
    const afterRevoke = await decide(support, caseId, payload, idem);
    expect(afterRevoke.statusCode).toBeGreaterThanOrEqual(403);
  });
});
