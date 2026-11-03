import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { projectionHash } from "../../src/games/role-reputation.policy";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { MOSCOW_CITY_ID } from "../../src/venues/venues.service";
import { buildTestCoreModule } from "./test-core.module";

/**
 * Bounded admin role-reputation intake checks. Skipped unless RUN_DB_INTEGRATION=1.
 * Never creates live credentials/sessions outside the disposable fixture.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18990";
const webOrigin = "http://127.0.0.1:18992";
const pepper = "role-rep-admin-pepper-at-least-32chars!!";
const DEDICATED_DB = "/gobadminton_admin_role_reputation_disposable";

const openapiContract = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../packages/contracts/openapi.json"), "utf8"),
);
const contractAjv = new Ajv2020({ strict: false, allErrors: true });
addFormats(contractAjv);
const contractValidators = new Map<string, ReturnType<typeof contractAjv.compile>>();
function assertContract(schemaName: string, value: unknown) {
  let validate = contractValidators.get(schemaName);
  if (!validate) {
    validate = contractAjv.compile({
      components: openapiContract.components,
      $ref: `#/components/schemas/${schemaName}`,
    });
    contractValidators.set(schemaName, validate);
  }
  const wire = JSON.parse(JSON.stringify(value));
  expect(validate(wire), JSON.stringify(validate.errors)).toBe(true);
}

type Actor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};
type Consumer = { userId: string; sessionId: string; csrfToken: string; cookie: string };

function assertDisposableAdminTarget(url: URL) {
  const dedicated = decodeURIComponent(url.pathname) === DEDICATED_DB;
  const hosted =
    url.pathname === "/gobadminton" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GMAP1_DISPOSABLE_DB === "1" &&
    /^gb-ci-\d+-\d+-\d+$/.test(process.env.PG_CONTAINER ?? "") &&
    url.port === process.env.CI_DB_PORT;
  if (
    process.env.NODE_ENV !== "test" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !(dedicated || hosted)
  ) {
    throw new Error(
      "Admin role-reputation fixtures require dedicated disposable or hosted CI PostgreSQL contract",
    );
  }
}

run("#394 admin role reputation — disposable", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let moderator: Actor;
  let otherModerator: Actor;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "role-rep-admin-consumer-pepper-at-least-32",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18991",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
    });
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    assertDisposableAdminTarget(sourceUrl);
    databaseAdmin = new Pool({ connectionString: sourceUrl.toString() });
    fixtureDatabase = "rr_adm_" + randomUUID().replaceAll("-", "");
    await databaseAdmin.query("CREATE DATABASE " + fixtureDatabase);
    sourceUrl.pathname = "/" + fixtureDatabase;
    process.env.DATABASE_URL = sourceUrl.toString();
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: "inherit",
    });
    env = loadEnv({
      ...process.env,
      ADMIN_INTERNAL_ENABLED: "1",
      CASES_INTERNAL_ENABLED: "1",
      POST_GAME_INTERNAL_ENABLED: "1",
      SOCIAL_DIRECTORY_ENABLED: "1",
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
      COOKIE_SECURE: "false",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "role-rep-admin-fingerprint-fixture!!!!",
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const mod = await Test.createTestingModule({
      imports: [
        buildTestCoreModule(env, pool),
        AdminModule,
        GamesModule,
        VenuesModule,
        ProfilesModule,
      ],
    }).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new ProblemExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = mod.get(SessionService);
    moderator = await actor("moderator");
    otherModerator = await actor("moderator");
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (fixtureDatabase) await databaseAdmin.query("DROP DATABASE " + fixtureDatabase);
    await databaseAdmin?.end();
  });

  async function user(name = "RR admin synthetic") {
    return (await pool.query("INSERT INTO users(display_name) VALUES($1) RETURNING id", [name])).rows[0]
      .id as string;
  }

  async function actor(role: AdminRole): Promise<Actor> {
    const userId = await user();
    const id = (
      await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [
        userId,
      ])
    ).rows[0].id;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')",
      [id, role],
    );
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    const sessionId = (
      await pool.query(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [
          id,
          (
            await pool.query(
              "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3) RETURNING credential_id",
              [credentialId, id, Buffer.from("synthetic-role-rep-fixture")],
            )
          ).rows[0].credential_id,
          hashSecret(pepper, token),
          sealSecret(pepper, csrf),
        ],
      )
    ).rows[0].id;
    await pool.query("UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE id=$1", [sessionId]);
    return { id, userId, token, csrf, sessionId };
  }

  async function consumer(name: string): Promise<Consumer> {
    const userId = await user(name);
    await pool.query(
      `INSERT INTO player_social_profiles
         (user_id, public_player_id, display_name, directory_visible, social_eligible,
          contact_policy, directory_visibility_provenance, consent_policy_version)
       VALUES ($1, $2, $3, true, true, 'closed', 'owner_default', 'v1')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, randomUUID(), name],
    );
    const issued = await sessions.createConsumerSession(userId);
    return {
      userId,
      sessionId: issued.session.id,
      csrfToken: issued.csrfToken,
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`,
    };
  }

  function adminGet(route: string, a = moderator) {
    return app.inject({
      method: "GET",
      url: "/v1/admin/" + route,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin },
    });
  }
  function adminPost(route: string, body: object, a = moderator, key: string = randomUUID()) {
    return app.inject({
      method: "POST",
      url: "/v1/admin/" + route,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin, "x-csrf-token": a.csrf, "idempotency-key": key },
      payload: body,
    });
  }

  async function seedHeldGame(organizerId: string, participantId: string) {
    const venue = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(
           city_id,name,address,timezone,location,created_by_user_id,
           lifecycle_state,normalized_name,normalized_address
         ) VALUES (
           $1,'RR admin venue','addr','Europe/Moscow',
           ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$2,
           'unverified','rr admin venue','addr'
         ) RETURNING id`,
        [MOSCOW_CITY_ID, organizerId],
      )
    ).rows[0]!;
    const endsAt = new Date("2026-10-01T18:00:00.000Z");
    const starts = new Date(endsAt.getTime() - 3600_000);
    const gameId = (
      await pool.query<{ id: string }>(
        `INSERT INTO games(
           venue_id,title,status,visibility,starts_at,ends_at,timezone,application_deadline_at,
           capacity,external_reserved_count,format_key,level_scale_id,level_scale_version,allowed_level_ids,
           settlement_mode,settlement_purpose,settlement_terms,created_by_user_id,host_display_name,
           host_public_contact,activity_kind,published_at
         ) VALUES (
           $1,'RR admin game','completed','public',$2,$3,'Europe/Moscow',$4,
           4,0,'doubles','ntrp',1,'["3.0"]'::jsonb,
           'external','no_trainer_fee','terms',$5,'Host','contact','regular',clock_timestamp()
         ) RETURNING id`,
        [
          venue.id,
          starts.toISOString(),
          endsAt.toISOString(),
          new Date(starts.getTime() - 3600_000).toISOString(),
          organizerId,
        ],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO game_managers(game_id,user_id,role,status) VALUES ($1,$2,'owner','active')`,
      [gameId, organizerId],
    );
    const partId = (
      await pool.query<{ id: string }>(
        `INSERT INTO participations(game_id,user_id,status,confirmed_at)
         VALUES ($1,$2,'confirmed',$3) RETURNING id`,
        [gameId, participantId, starts.toISOString()],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id,from_status,to_status,actor_id,reason_code,aggregate_version,game_version,at)
       VALUES ($1,NULL,'confirmed',$2,'test',1,1,$3)`,
      [partId, participantId, starts.toISOString()],
    );
    await pool.query(
      `INSERT INTO game_outcomes(game_id,value,version,source,actor_user_id)
       VALUES ($1,'held',1,'manager_explicit',$2)`,
      [gameId, organizerId],
    );
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id,game_id,user_id,value,version,late,source,actor_user_id)
       VALUES ($1,$2,$3,'present',1,false,'manager_explicit',$4)`,
      [partId, gameId, participantId, organizerId],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id,game_id,user_id,resource_version,actor_user_id,source,recorded_at,
          before_value,after_value,before_late,after_late,before_correction_reason,after_correction_reason)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',$5,NULL,'present',NULL,false,NULL,NULL)`,
      [partId, gameId, participantId, organizerId, starts.toISOString()],
    );
    const rev1 = randomUUID();
    await pool.query(
      `INSERT INTO game_role_proof_revisions
         (id,game_id,role,resource_version,subject_user_id,phase,binding_kind,
          provenance_source,accepted_for_count,actor_user_id)
       VALUES ($1,$2,'organization',1,$3,'planned','publish_freeze','publish_manager',false,$3)`,
      [rev1, gameId, organizerId],
    );
    await pool.query(
      `INSERT INTO game_role_proofs
         (game_id,role,version,subject_user_id,phase,accepted_for_count,open_dispute,latest_revision_id)
       VALUES ($1,'organization',1,$2,'planned',false,false,$3)`,
      [gameId, organizerId, rev1],
    );
    const rev2 = randomUUID();
    await pool.query(
      `INSERT INTO game_role_proof_revisions
         (id,game_id,role,resource_version,subject_user_id,phase,binding_kind,
          provenance_source,accepted_for_count,actor_user_id,outcome_version)
       VALUES ($1,$2,'organization',2,$3,'performed','held_confirm','manager_explicit',true,$3,1)`,
      [rev2, gameId, organizerId],
    );
    await pool.query(
      `UPDATE game_role_proofs
       SET version=2, phase='performed', accepted_for_count=true, latest_revision_id=$2
       WHERE game_id=$1 AND role='organization'`,
      [gameId, rev2],
    );
    const roleHandle = (
      await pool.query<{ public_handle: string }>(
        `INSERT INTO role_reputation_subjects
           (subject_user_id, role, public_handle, version)
         VALUES ($1,'organization',$2,1)
         ON CONFLICT (subject_user_id, role) DO UPDATE SET updated_at=clock_timestamp()
         RETURNING public_handle`,
        [organizerId, randomUUID().replaceAll("-", "")],
      )
    ).rows[0]!.public_handle;
    return { gameId, roleHandle };
  }

  it("pending queue shows waiting intake without body; generic resolved case does not approve", async () => {
    const author = await user("author");
    const subject = await user("subject");
    const slotId = randomUUID();
    const handle = randomUUID().replaceAll("-", "");
    await pool.query(
      `INSERT INTO role_review_slots
         (id, author_user_id, subject_user_id, role, public_handle, status, version)
       VALUES ($1,$2,$3,'organization',$4,'submitted',1)`,
      [slotId, author, subject, handle],
    );
    const pendingId = randomUUID();
    const receipt = randomUUID().replaceAll("-", "");
    await pool.query(
      `INSERT INTO role_reputation_pending_intakes
         (id, kind, slot_id, receipt_token, status, submitted_by_user_id, subject_user_id, role, version)
       VALUES ($1,'review_submit',$2,$3,'waiting_intake',$4,$5,'organization',1)`,
      [pendingId, slotId, receipt, author, subject],
    );

    const list = await app.inject({
      method: "GET",
      url: "/v1/admin/role-reputation/pending-intakes",
      cookies: { [ADMIN_COOKIE]: moderator.token },
      headers: { origin },
    });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().items.some((i: { pendingIntakeId: string }) => i.pendingIntakeId === pendingId),
    ).toBe(true);
    expect(list.json().items[0]).not.toHaveProperty("text");
    expect(list.json().items[0].hasAssignee).toBe(false);
    expect(list.json().items[0].caseId).toBeNull();

    const caze = (
      await pool.query<{ id: string }>(
        `INSERT INTO support_cases (created_by, assigned_to, status)
         VALUES ($1,$1,'open') RETURNING id`,
        [moderator.id],
      )
    ).rows[0]!;
    await pool.query(`UPDATE support_cases SET status='resolved', version=2 WHERE id=$1`, [caze.id]);
    const slot = (
      await pool.query<{ status: string }>(`SELECT status FROM role_review_slots WHERE id=$1`, [slotId])
    ).rows[0]!;
    expect(slot.status).toBe("submitted");
  });

  it("HTTP e2e: submit → intake → source → approve → public → report → remove/restore → withdraw; key negatives", async () => {
    const organizer = await consumer("Organizer subject");
    const participant = await consumer("Participant author");
    const outsider = await consumer("Outsider reader");
    const { gameId, roleHandle } = await seedHeldGame(organizer.userId, participant.userId);

    const text = "Слабая организация\nНарушение договорённостей";
    const hash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text,
      topics: ["agreements"],
    });
    const submit = await app.inject({
      method: "POST",
      url: "/v1/me/role-reviews",
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin: webOrigin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        gameId,
        role: "organization",
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: 1,
          attendanceVersion: 1,
        },
        text,
        topics: ["agreements"],
        consentProjectionHash: hash,
      },
    });
    expect(submit.statusCode).toBe(200);
    expect(submit.json().pendingIntakeStatus).toBe("waiting_intake");
    const slotId = submit.json().id as string;
    const reviewHandle = submit.json().reviewHandle as string;

    const pendingList = await adminGet("role-reputation/pending-intakes");
    expect(pendingList.statusCode).toBe(200);
    const pending = pendingList
      .json()
      .items.find((i: { kind: string }) => i.kind === "review_submit");
    expect(pending).toBeTruthy();
    expect(pending).not.toHaveProperty("text");

    const pendingRow = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND status='waiting_intake'`,
        [slotId],
      )
    ).rows[0]!;

    // Subject cannot resolve own case via intake (COI).
    const subjectAdminUser = organizer.userId;
    const subjectPrincipal = (
      await pool.query(
        "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
        [subjectAdminUser],
      )
    ).rows[0].id as string;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'moderator','synthetic_fixture')",
      [subjectPrincipal],
    );
    const subjectToken = randomUUID() + randomUUID();
    const subjectCsrf = randomUUID();
    const subjectCred = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [subjectCred, subjectPrincipal, Buffer.from("subject-coi")],
    );
    const subjectSession = (
      await pool.query(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [
          subjectPrincipal,
          subjectCred,
          hashSecret(pepper, subjectToken),
          sealSecret(pepper, subjectCsrf),
        ],
      )
    ).rows[0].id as string;
    await pool.query("UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE id=$1", [
      subjectSession,
    ]);
    const subjectIntake = await app.inject({
      method: "POST",
      url: "/v1/admin/cases/role-reputation-intake",
      cookies: { [ADMIN_COOKIE]: subjectToken },
      headers: {
        origin,
        "x-csrf-token": subjectCsrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        pendingIntakeId: pendingRow.id,
        expectedIntakeVersion: pendingRow.version,
        reasonCode: "synthetic_review",
        assignToSelf: true,
      },
    });
    expect(subjectIntake.statusCode).toBeGreaterThanOrEqual(400);

    const intake = await adminPost("cases/role-reputation-intake", {
      pendingIntakeId: pendingRow.id,
      expectedIntakeVersion: pendingRow.version,
      reasonCode: "synthetic_review",
      assignToSelf: true,
    });
    expect(intake.statusCode).toBe(200);
    assertContract("AdminRoleReputationIntakeRequest", {
      pendingIntakeId: pendingRow.id,
      expectedIntakeVersion: pendingRow.version,
      reasonCode: "synthetic_review",
      assignToSelf: true,
    });
    const caseId = intake.json().caseId as string;
    const caseVersion = intake.json().caseVersion as number;

    // Unassigned other moderator cannot read source.
    const unassignedSource = await adminGet(`cases/${caseId}/role-review-source`, otherModerator);
    expect(unassignedSource.statusCode).toBeGreaterThanOrEqual(400);

    const source = await adminGet(`cases/${caseId}/role-review-source`);
    expect(source.statusCode).toBe(200);
    expect(source.json().reviewRevision.text).toBe(text);
    expect(source.json().slot.reviewHandle).toBe(reviewHandle);
    const revisionId = source.json().reviewRevision.id as string;
    const resourceVersion = source.json().reviewRevision.resourceVersion as number;

    // Stale revision reject.
    const stale = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: caseVersion,
      expectedResourceVersion: resourceVersion + 99,
      targetKind: "review",
      exactRevisionId: revisionId,
      decision: "approve",
      rationale: "stale attempt",
      reasonCode: "synthetic_review",
    });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);

    // Generic status=resolved does not publish.
    const generic = await adminPost(`cases/${caseId}/commands`, {
      action: "status",
      expectedVersion: caseVersion,
      status: "resolved",
      reasonCode: "synthetic_review",
    });
    expect(generic.statusCode).toBe(200);
    const stillPending = (
      await pool.query<{ status: string }>(`SELECT status FROM role_review_slots WHERE id=$1`, [
        slotId,
      ])
    ).rows[0]!;
    expect(stillPending.status).toBe("submitted");

    // Explicit decide still works after generic resolve — publication is decide-only.
    const decideCaseVersion = (
      await pool.query<{ version: number }>(`SELECT version FROM support_cases WHERE id=$1`, [
        caseId,
      ])
    ).rows[0]!.version;

    // Pending created while eligible must not publish after basis/admission reversed.
    await pool.query(`UPDATE game_outcomes SET value='not_held', version=version+1 WHERE game_id=$1`, [
      gameId,
    ]);
    const deniedBasis = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: decideCaseVersion,
      expectedResourceVersion: resourceVersion,
      targetKind: "review",
      exactRevisionId: revisionId,
      decision: "approve",
      rationale: "Should deny — held reversed",
      reasonCode: "synthetic_review",
    });
    expect(deniedBasis.statusCode).toBeGreaterThanOrEqual(400);
    await pool.query(`UPDATE game_outcomes SET value='held', version=version+1 WHERE game_id=$1`, [
      gameId,
    ]);

    const approve = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: decideCaseVersion,
      expectedResourceVersion: resourceVersion,
      targetKind: "review",
      exactRevisionId: revisionId,
      decision: "approve",
      rationale: "Approve negative public role review",
      reasonCode: "synthetic_review",
    });
    expect(approve.statusCode).toBe(200);

    const publicRead = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${roleHandle}`,
      headers: { cookie: outsider.cookie },
    });
    expect(publicRead.statusCode).toBe(200);
    assertContract("RoleReputationSummary", publicRead.json());
    expect(publicRead.json().publishedReviewCount).toBe(1);
    const item = publicRead.json().items[0];
    assertContract("PublicRoleReviewItem", item);
    expect(item.reviewHandle).toBe(reviewHandle);
    expect(item.publishedRevision).toBe(resourceVersion);
    expect(item.text).toBe(text);

    const report = await app.inject({
      method: "POST",
      url: `/v1/role-reviews/${reviewHandle}/reports`,
      headers: {
        cookie: outsider.cookie,
        "x-csrf-token": outsider.csrfToken,
        origin: webOrigin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        targetKind: "review",
        expectedRevision: item.publishedRevision,
        reasonCode: "spam",
      },
    });
    expect(report.statusCode).toBe(200);

    // Report does not hide — still visible.
    const stillVisible = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${roleHandle}`,
    });
    expect(stillVisible.json().publishedReviewCount).toBe(1);

    const afterApproveVersion = (
      await pool.query<{ version: number }>(`SELECT version FROM support_cases WHERE id=$1`, [caseId])
    ).rows[0]!.version;

    const remove = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: afterApproveVersion,
      expectedResourceVersion: resourceVersion,
      targetKind: "review",
      exactRevisionId: revisionId,
      decision: "remove",
      rationale: "Human remove after report",
      reasonCode: "synthetic_review",
    });
    expect(remove.statusCode).toBe(200);
    const removedPublic = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${roleHandle}`,
    });
    expect(removedPublic.json().publishedReviewCount).toBe(0);

    const afterRemoveVersion = (
      await pool.query<{ version: number }>(`SELECT version FROM support_cases WHERE id=$1`, [caseId])
    ).rows[0]!.version;
    const restore = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: afterRemoveVersion,
      expectedResourceVersion: resourceVersion,
      targetKind: "review",
      exactRevisionId: revisionId,
      decision: "restore",
      rationale: "Human restore",
      reasonCode: "synthetic_review",
    });
    expect(restore.statusCode).toBe(200);
    const restoredPublic = await app.inject({
      method: "GET",
      url: `/v1/role-reputations/${roleHandle}`,
    });
    expect(restoredPublic.json().publishedReviewCount).toBe(1);

    const mine = await app.inject({
      method: "GET",
      url: "/v1/me/role-reviews",
      headers: { cookie: participant.cookie },
    });
    expect(mine.statusCode).toBe(200);
    const own = mine.json().items.find((i: { id: string }) => i.id === slotId);
    expect(own.pendingIntakeStatus).toBe("linked");
    expect(own.receiptToken).toBeTruthy();
    expect(own.roleHandle).toBe(roleHandle);
    // Foreign report waiting_intake must not replace author's linked receipt/status.
    expect(own.receiptToken).not.toBe(report.json().receiptToken);

    // Reporter after reassignment cannot decide the report-bound case.
    const reportPending = (
      await pool.query<{ id: string; version: number }>(
        `SELECT id, version FROM role_reputation_pending_intakes
         WHERE slot_id=$1 AND kind='report' AND status='waiting_intake'
         ORDER BY created_at DESC LIMIT 1`,
        [slotId],
      )
    ).rows[0]!;
    const reportIntake = await adminPost("cases/role-reputation-intake", {
      pendingIntakeId: reportPending.id,
      expectedIntakeVersion: reportPending.version,
      reasonCode: "synthetic_review",
      assignToSelf: true,
    });
    expect(reportIntake.statusCode).toBe(200);
    const reportCaseId = reportIntake.json().caseId as string;
    const reporterPrincipal = (
      await pool.query(
        "INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id",
        [outsider.userId],
      )
    ).rows[0].id as string;
    await pool.query(
      "INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,'moderator','synthetic_fixture')",
      [reporterPrincipal],
    );
    const reporterToken = randomUUID() + randomUUID();
    const reporterCsrf = randomUUID();
    const reporterCred = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [reporterCred, reporterPrincipal, Buffer.from("reporter-coi")],
    );
    const reporterSession = (
      await pool.query(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [
          reporterPrincipal,
          reporterCred,
          hashSecret(pepper, reporterToken),
          sealSecret(pepper, reporterCsrf),
        ],
      )
    ).rows[0].id as string;
    await pool.query("UPDATE admin_sessions SET step_up_at=clock_timestamp() WHERE id=$1", [
      reporterSession,
    ]);
    await pool.query(`UPDATE support_cases SET assigned_to=$2 WHERE id=$1`, [
      reportCaseId,
      reporterPrincipal,
    ]);
    const reporterDecide = await app.inject({
      method: "POST",
      url: `/v1/admin/cases/${reportCaseId}/commands`,
      cookies: { [ADMIN_COOKIE]: reporterToken },
      headers: {
        origin,
        "x-csrf-token": reporterCsrf,
        "idempotency-key": randomUUID(),
      },
      payload: {
        action: "role_review_decide",
        expectedCaseVersion: reportIntake.json().caseVersion,
        expectedResourceVersion: resourceVersion,
        targetKind: "review",
        exactRevisionId: revisionId,
        decision: "retain",
        rationale: "Reporter must not decide own report case",
        reasonCode: "synthetic_review",
      },
    });
    expect(reporterDecide.statusCode).toBeGreaterThanOrEqual(400);

    // Old case cannot action a newer unbound revision — human must intake the new source.
    const newText = "Слабая организация\nПовтор после публикации";
    const newHash = projectionHash({
      subjectUserId: organizer.userId,
      role: "organization",
      audience: "public",
      text: newText,
      topics: ["agreements"],
    });
    const resubmit = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${slotId}/commands`,
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin: webOrigin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "submit_revision",
        expectedVersion: own.version,
        gameId,
        expectedBasisVersions: {
          proofVersion: 2,
          outcomeVersion: (
            await pool.query<{ version: number }>(
              `SELECT version FROM game_outcomes WHERE game_id=$1`,
              [gameId],
            )
          ).rows[0]!.version,
          attendanceVersion: 1,
        },
        text: newText,
        topics: ["agreements"],
        consentProjectionHash: newHash,
      },
    });
    expect(resubmit.statusCode).toBe(200);
    const newRevisionId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM role_review_revisions
         WHERE slot_id=$1 ORDER BY resource_version DESC LIMIT 1`,
        [slotId],
      )
    ).rows[0]!.id;
    expect(newRevisionId).not.toBe(revisionId);
    const afterResubmitCaseVersion = (
      await pool.query<{ version: number }>(`SELECT version FROM support_cases WHERE id=$1`, [
        caseId,
      ])
    ).rows[0]!.version;
    const foreignRevision = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: afterResubmitCaseVersion,
      expectedResourceVersion: resourceVersion + 1,
      targetKind: "review",
      exactRevisionId: newRevisionId,
      decision: "approve",
      rationale: "Old case must not approve unbound new revision",
      reasonCode: "synthetic_review",
    });
    expect(foreignRevision.statusCode).toBeGreaterThanOrEqual(400);

    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/me/role-reviews/${slotId}/commands`,
      headers: {
        cookie: participant.cookie,
        "x-csrf-token": participant.csrfToken,
        origin: webOrigin,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: {
        action: "withdraw",
        expectedVersion: resubmit.json().version,
      },
    });
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json().status).toBe("withdrawn");

    // Restore cannot resurrect author-withdrawn text.
    const restoreWithdrawn = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: (
        await pool.query<{ version: number }>(`SELECT version FROM support_cases WHERE id=$1`, [
          caseId,
        ])
      ).rows[0]!.version,
      expectedResourceVersion: resourceVersion,
      targetKind: "review",
      exactRevisionId: revisionId,
      decision: "restore",
      rationale: "Must deny restore after author withdraw",
      reasonCode: "synthetic_review",
    });
    expect(restoreWithdrawn.statusCode).toBeGreaterThanOrEqual(400);

    // Stale step-up cannot decide.
    await pool.query(
      `UPDATE admin_sessions SET step_up_at = clock_timestamp() - interval '2 days' WHERE id=$1`,
      [moderator.sessionId],
    );
    const staleStepUp = await adminPost(`cases/${caseId}/commands`, {
      action: "role_review_decide",
      expectedCaseVersion: (
        await pool.query<{ version: number }>(`SELECT version FROM support_cases WHERE id=$1`, [
          caseId,
        ])
      ).rows[0]!.version,
      expectedResourceVersion: resourceVersion,
      targetKind: "review",
      exactRevisionId: revisionId,
      decision: "retain",
      rationale: "stale stepup",
      reasonCode: "synthetic_review",
    });
    expect(staleStepUp.statusCode).toBeGreaterThanOrEqual(400);
  });
});
