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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminModule } from "../../src/admin/admin.module";
import { ADMIN_COOKIE, type AdminRole } from "../../src/admin/rbac";
import { SESSION_COOKIE } from "../../src/auth/constants";
import { hashSecret, sealSecret } from "../../src/auth/crypto";
import { SessionService } from "../../src/auth/session.service";
import { ProblemExceptionFilter } from "../../src/common/problem.filter";
import { loadEnv, type AppEnv } from "../../src/config/env";
import { GamesModule } from "../../src/games/games.module";
import { ProfilesModule } from "../../src/profiles/profiles.module";
import { VenuesModule } from "../../src/venues/venues.module";
import { buildTestCoreModule } from "./test-core.module";

const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18980";
const webOrigin = "http://127.0.0.1:18982";
const pepper = "a3-review-report-admin-pepper-at-least-32chars";

/** Local AJV2020 guard against CURRENT openapi.json (no new deps/files). */
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

type AdminActor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};
type Consumer = { userId: string; sessionId: string; csrfToken: string; cookie: string };

run("Admin Cases · private peer review report source read", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let moderator: AdminActor;
  let support: AdminActor;
  let otherSupport: AdminActor;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "a3-review-report-consumer-pepper-at-least-32",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18981",
      PUBLIC_WEB_ORIGIN: webOrigin,
      ALLOWED_WEB_ORIGINS: webOrigin,
    });
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname)) {
      throw new Error("Review-report fixtures require disposable loopback PostgreSQL");
    }
    databaseAdmin = new Pool({ connectionString: sourceUrl.toString() });
    fixtureDatabase = "a3_review_reports_" + randomUUID().replaceAll("-", "");
    await databaseAdmin.query("CREATE DATABASE " + fixtureDatabase);
    sourceUrl.pathname = "/" + fixtureDatabase;
    process.env.DATABASE_URL = sourceUrl.toString();
    execFileSync("pnpm", ["exec", "tsx", "src/database/migrate.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: "inherit",
    });
    // Primary typed source-read E2E: synthetic TTL unset like actual DEV.
    // Generic A3 synthetic-evidence tests retain their own TTL policy separately.
    const envInput: NodeJS.ProcessEnv = {
      ...process.env,
      ADMIN_INTERNAL_ENABLED: "1",
      CASES_INTERNAL_ENABLED: "1",
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
      POST_GAME_INTERNAL_ENABLED: "1",
      COOKIE_SECURE: "false",
      CONTENT_MODERATION_PROVIDER: "fake",
      CONTENT_MODERATION_FINGERPRINT_SECRET: "a3-review-report-fingerprint-fixture!!",
    };
    delete envInput.CASE_EVIDENCE_SYNTHETIC_TTL_SECONDS;
    env = loadEnv(envInput);
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
    moderator = await adminActor("moderator");
    support = await adminActor("support");
    otherSupport = await adminActor("support");
  }, 180000);

  beforeEach(async () => {
    await pool.query("DELETE FROM admin_rate_windows");
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (fixtureDatabase) await databaseAdmin.query("DROP DATABASE " + fixtureDatabase);
    await databaseAdmin?.end();
  });

  async function user(name = "A3 review") {
    return (await pool.query("INSERT INTO users(display_name) VALUES($1) RETURNING id", [name])).rows[0]
      .id as string;
  }

  async function adminActor(role: AdminRole): Promise<AdminActor> {
    const userId = await user("admin-" + role);
    const id = (
      await pool.query("INSERT INTO admin_principals(user_id,status) VALUES($1,'active') RETURNING id", [
        userId,
      ])
    ).rows[0].id;
    await pool.query("INSERT INTO admin_role_grants(principal_id,role,reason_code) VALUES($1,$2,'synthetic_fixture')", [
      id,
      role,
    ]);
    const credentialId = randomUUID();
    const token = randomUUID() + randomUUID();
    const csrf = randomUUID();
    await pool.query(
      "INSERT INTO admin_webauthn_credentials(credential_id,principal_id,public_key) VALUES($1,$2,$3)",
      [credentialId, id, Buffer.from("synthetic-command-fixture")],
    );
    const sessionId = (
      await pool.query(
        "INSERT INTO admin_sessions(principal_id,credential_id,token_hash,csrf_ciphertext) VALUES($1,$2,$3,$4) RETURNING id",
        [id, credentialId, hashSecret(pepper, token), sealSecret(pepper, csrf)],
      )
    ).rows[0].id;
    return { id, userId, token, csrf, sessionId };
  }

  async function consumer(name: string): Promise<Consumer> {
    const userId = await user(name);
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

  it("recipient report → case create/assign → assigned read exact old revision → resolution", async () => {
    const manager = await consumer("Manager nonplaying");
    const author = await consumer("Author peer");
    const recipient = await consumer("Recipient peer");
    const city = (await pool.query("SELECT id FROM cities LIMIT 1")).rows[0]?.id;
    expect(city).toBeTruthy();
    const venue = (
      await pool.query(
        `INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
         SELECT $1,'RR venue','addr','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$2,'unverified','rr venue','addr'
         RETURNING id`,
        [city, manager.userId],
      )
    ).rows[0].id as string;
    const gameId = (
      await pool.query(
        `INSERT INTO games(
           venue_id,title,status,visibility,starts_at,ends_at,timezone,application_deadline_at,
           capacity,external_reserved_count,format_key,level_scale_id,level_scale_version,allowed_level_ids,
           settlement_mode,settlement_purpose,settlement_terms,created_by_user_id,host_display_name,host_public_contact,activity_kind
         ) VALUES (
           $1,'RR game','completed','public',
           clock_timestamp()-interval '3 hours',clock_timestamp()-interval '1 hour','Europe/Moscow',
           clock_timestamp()-interval '4 hours',4,0,'doubles','test',1,'["test"]',
           'external','no_trainer_fee','terms',$2,'Host','contact','regular'
         ) RETURNING id`,
        [venue, manager.userId],
      )
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO game_managers(game_id,user_id,role,status) VALUES ($1,$2,'owner','active')`,
      [gameId, manager.userId],
    );
    await pool.query(
      `INSERT INTO game_outcomes(game_id,value,version,source,actor_user_id)
       VALUES ($1,'held',1,'manager_explicit',$2)`,
      [gameId, manager.userId],
    );

    async function confirm(userId: string) {
      const part = (
        await pool.query(
          `INSERT INTO participations(game_id,user_id,status,confirmed_at)
           VALUES ($1,$2,'confirmed',clock_timestamp()-interval '4 hours') RETURNING id`,
          [gameId, userId],
        )
      ).rows[0].id as string;
      await pool.query(
        `INSERT INTO participation_transitions
           (participation_id,from_status,to_status,actor_id,reason_code,aggregate_version,game_version,at)
         VALUES ($1,NULL,'confirmed',$2,'test',1,1,clock_timestamp()-interval '4 hours')`,
        [part, userId],
      );
      // Non-playing manager marks present (actor ≠ subject).
      await pool.query(
        `INSERT INTO game_attendance
           (participation_id,game_id,user_id,value,version,late,source,actor_user_id,recorded_at,updated_at)
         VALUES ($1,$2,$3,'present',1,false,'manager_explicit',$4,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours')`,
        [part, gameId, userId, manager.userId],
      );
      await pool.query(
        `INSERT INTO game_attendance_revisions
           (participation_id,game_id,user_id,resource_version,actor_user_id,source,recorded_at,
            before_value,after_value,before_late,after_late,before_correction_reason,after_correction_reason)
         VALUES ($1,$2,$3,1,$4,'manager_explicit',clock_timestamp()-interval '2 hours',
            NULL,'present',NULL,false,NULL,NULL)`,
        [part, gameId, userId, manager.userId],
      );
      return part;
    }
    await confirm(author.userId);
    const recipientPart = await confirm(recipient.userId);

    const create = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/reviews`,
      cookies: {},
      headers: {
        cookie: author.cookie,
        origin: webOrigin,
        "x-csrf-token": author.csrfToken,
        "idempotency-key": randomUUID(),
      },
      payload: {
        kind: "peer",
        subjectContextId: recipientPart,
        peerRating: "difficulties",
        comment: "EXACT_OLD_REVISION_TEXT",
        experienceAssertion: "i_experienced_this_game",
      },
    });
    expect([200, 201], create.body).toContain(create.statusCode);
    const reviewId = create.json().id as string;
    const v1 = create.json().version as number;

    const report = await app.inject({
      method: "POST",
      url: `/v1/reviews/${reviewId}/report`,
      headers: {
        cookie: recipient.cookie,
        origin: webOrigin,
        "x-csrf-token": recipient.csrfToken,
        "idempotency-key": randomUUID(),
      },
      payload: {
        expectedVersion: v1,
        reasonCode: "harassment",
        shareReviewWithSupport: true,
        gameId,
      },
    });
    expect(report.statusCode, report.body).toBe(201);
    const reportId = report.json().reportId as string;
    assertContract("GameReviewReportReceipt", report.json());

    const reportsQueue = await adminGet(`reports?reportId=${reportId}`);
    expect(reportsQueue.statusCode, reportsQueue.body).toBe(200);
    assertContract("AdminReportList", reportsQueue.json());
    expect(reportsQueue.json().items).toHaveLength(1);
    expect(reportsQueue.json().items[0]).toMatchObject({
      id: reportId,
      targetKind: "game_review",
      reasonCode: "harassment",
      caseId: null,
    });
    expect(reportsQueue.json().items[0]).not.toHaveProperty("targetPublicPlayerId");

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/reviews/${reviewId}`,
      headers: {
        cookie: author.cookie,
        origin: webOrigin,
        "x-csrf-token": author.csrfToken,
        "idempotency-key": randomUUID(),
      },
      payload: { expectedVersion: v1, comment: "EDITED_AFTER_REPORT_MUST_NOT_LEAK" },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    const createdCase = await adminPost("cases", { reportId, reasonCode: "synthetic_review" }, moderator);
    expect(createdCase.statusCode, createdCase.body).toBe(200);
    const caseId = createdCase.json().id as string;

    // Unassigned support / case.manage without assignment cannot read private source.
    expect((await adminGet(`cases/${caseId}/review-reports/${reportId}`, support)).statusCode).toBe(404);
    expect((await adminGet(`cases/${caseId}/review-reports/${reportId}`, moderator)).statusCode).toBe(
      403,
    );

    const d0 = await adminGet(`cases/${caseId}`, moderator);
    expect(d0.statusCode).toBe(200);
    assertContract("AdminCaseDetail", d0.json());
    expect(d0.json().links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "report",
          sourceId: reportId,
          targetKind: "game_review",
        }),
      ]),
    );
    const reportsAfterLink = await adminGet(`reports?reportId=${reportId}`);
    expect(reportsAfterLink.statusCode, reportsAfterLink.body).toBe(200);
    assertContract("AdminReportList", reportsAfterLink.json());
    expect(reportsAfterLink.json().items[0]).toMatchObject({
      id: reportId,
      targetKind: "game_review",
      caseId,
    });
    const assign = await adminPost(
      `cases/${caseId}/commands`,
      {
        action: "assign",
        expectedVersion: d0.json().version,
        reasonCode: "synthetic_review",
        principalId: support.id,
      },
      moderator,
    );
    expect(assign.statusCode, assign.body).toBe(200);
    const afterAssign = await adminGet(`cases/${caseId}`, support);
    expect(afterAssign.statusCode, afterAssign.body).toBe(200);
    assertContract("AdminCaseDetail", afterAssign.json());
    expect(afterAssign.json().links.find((l: { sourceKind: string }) => l.sourceKind === "report")).toMatchObject({
      sourceId: reportId,
      targetKind: "game_review",
    });

    // Stale step-up denies.
    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1", [
      support.sessionId,
    ]);
    expect((await adminGet(`cases/${caseId}/review-reports/${reportId}`, support)).statusCode).toBe(403);
    await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE id=$1", [support.sessionId]);

    const read = await adminGet(`cases/${caseId}/review-reports/${reportId}`, support);
    expect(read.statusCode, read.body).toBe(200);
    assertContract("AdminCaseReviewReportSource", read.json());
    expect(read.json()).toMatchObject({
      caseId,
      reportId,
      reviewId,
      gameId,
      version: v1,
      kind: "peer",
      peerRating: "difficulties",
      comment: "EXACT_OLD_REVISION_TEXT",
    });
    expect(JSON.stringify(read.json())).not.toMatch(/EDITED_AFTER_REPORT|author_user|recipient_user|userId/i);

    // Cross-case / wrong report id safe.
    const otherReport = (
      await pool.query(
        `INSERT INTO abuse_reports(reporter_user_id,target_kind,target_user_id,target_public_player_id,reason_code,state)
         VALUES ($1,'player',$2,$3,'spam','submitted') RETURNING id`,
        [recipient.userId, author.userId, randomUUID()],
      )
    ).rows[0].id as string;
    expect((await adminGet(`cases/${caseId}/review-reports/${otherReport}`, support)).statusCode).toBe(404);

    // Reassignment clears access.
    const d1 = await adminGet(`cases/${caseId}`, moderator);
    await adminPost(
      `cases/${caseId}/commands`,
      {
        action: "assign",
        expectedVersion: d1.json().version,
        reasonCode: "synthetic_review",
        principalId: otherSupport.id,
      },
      moderator,
    );
    expect((await adminGet(`cases/${caseId}/review-reports/${reportId}`, support)).statusCode).toBe(404);

    await adminPost(
      `cases/${caseId}/commands`,
      {
        action: "assign",
        expectedVersion: (await adminGet(`cases/${caseId}`, moderator)).json().version,
        reasonCode: "synthetic_review",
        principalId: support.id,
      },
      moderator,
    );
    // Synthetic TTL unset like DEV: capture_evidence correctly denied; no evidence copy.
    const detail = await adminGet(`cases/${caseId}`, support);
    const versionBeforeCapture = detail.json().version as number;
    const linkId = detail.json().links.find((l: { sourceKind: string }) => l.sourceKind === "report").id;
    const capture = await adminPost(
      `cases/${caseId}/commands`,
      {
        action: "capture_evidence",
        expectedVersion: versionBeforeCapture,
        reasonCode: "synthetic_review",
        linkId,
      },
      support,
    );
    expect(capture.statusCode, capture.body).toBe(422);
    expect(capture.json().code).toBe("CASE_EVIDENCE_POLICY_DISABLED");
    expect(
      (await pool.query("SELECT 1 FROM case_evidence_items WHERE case_id=$1", [caseId])).rowCount,
    ).toBe(0);
    const afterFailedCapture = await adminGet(`cases/${caseId}`, support);
    expect(afterFailedCapture.statusCode).toBe(200);
    expect(afterFailedCapture.json().version).toBe(versionBeforeCapture);

    // Versioned resolution note without mutating private review.
    const beforeReview = (
      await pool.query(`SELECT version, comment FROM game_reviews WHERE id=$1`, [reviewId])
    ).rows[0];
    const resolve = await adminPost(
      `cases/${caseId}/commands`,
      {
        action: "note",
        expectedVersion: versionBeforeCapture,
        reasonCode: "synthetic_review",
        noteCode: "resolution_recorded",
      },
      support,
    );
    expect(resolve.statusCode, resolve.body).toBe(200);
    const afterReview = (
      await pool.query(`SELECT version, comment FROM game_reviews WHERE id=$1`, [reviewId])
    ).rows[0];
    expect(afterReview).toEqual(beforeReview);

    // COI: assign recipient's consumer user as support principal must deny read.
    const coiSupport = await adminActor("support");
    await pool.query("UPDATE admin_principals SET user_id=$2 WHERE id=$1", [
      coiSupport.id,
      recipient.userId,
    ]);
    const d2 = await adminGet(`cases/${caseId}`, moderator);
    await adminPost(
      `cases/${caseId}/commands`,
      {
        action: "assign",
        expectedVersion: d2.json().version,
        reasonCode: "synthetic_review",
        principalId: coiSupport.id,
      },
      moderator,
    );
    await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE id=$1", [coiSupport.sessionId]);
    expect((await adminGet(`cases/${caseId}/review-reports/${reportId}`, coiSupport)).statusCode).toBe(403);
  });
});
