import cookie from "@fastify/cookie";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { buildTestCoreModule } from "./test-core.module";

/**
 * Bounded PG-2 admin resolution checks. Skipped unless RUN_DB_INTEGRATION=1
 * against dedicated disposable or hosted CI PostGIS. Never creates live sessions.
 */
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
const origin = "http://localhost:18990";
const pepper = "pg2-admin-disputes-pepper-at-least-32chars";
const DEDICATED_DB = "/gobadminton_admin_attendance_disputes_disposable";

type Actor = {
  id: string;
  userId: string;
  token: string;
  csrf: string;
  sessionId: string;
};

/** Guard before Pool / CREATE DATABASE — dedicated name or exact hosted CI contract. */
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
      "PG-2 admin fixtures require dedicated disposable or hosted CI PostgreSQL contract before Pool",
    );
  }
}

run("PG-2 admin attendance disputes — disposable", () => {
  let databaseAdmin: Pool;
  let fixtureDatabase: string;
  let app: NestFastifyApplication;
  let pool: Pool;
  let env: AppEnv;
  let sessions: SessionService;
  let moderator: Actor;
  let otherModerator: Actor;
  let support: Actor;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      APP_ENV: "local",
      AUTH_PEPPER: "pg2-admin-consumer-pepper-at-least-32",
      PUBLIC_API_ORIGIN: "http://127.0.0.1:18991",
      PUBLIC_WEB_ORIGIN: "http://127.0.0.1:18992",
      ALLOWED_WEB_ORIGINS: "http://127.0.0.1:18992",
    });
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    assertDisposableAdminTarget(sourceUrl);
    databaseAdmin = new Pool({ connectionString: sourceUrl.toString() });
    fixtureDatabase = "pg2_adm_" + randomUUID().replaceAll("-", "");
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
      ADMIN_ORIGIN: origin,
      ADMIN_AUTH_PEPPER: pepper,
    });
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    const mod = await Test.createTestingModule({
      imports: [buildTestCoreModule(env, pool), AdminModule],
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
    support = await actor("support");
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

  async function user(name = "PG2 admin synthetic") {
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
              [credentialId, id, Buffer.from("synthetic-command-fixture")],
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

  function post(route: string, body: object, a = moderator, key: string = randomUUID()) {
    return app.inject({
      method: "POST",
      url: "/v1/admin/" + route,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin, "x-csrf-token": a.csrf, "idempotency-key": key },
      payload: body,
    });
  }

  function get(route: string, a = moderator) {
    return app.inject({
      method: "GET",
      url: "/v1/admin/" + route,
      cookies: { [ADMIN_COOKIE]: a.token },
      headers: { origin },
    });
  }

  /** Ended game + manager + participant + attendance/revisions/notice + open dispute + help. */
  async function seedOpenDispute(opts?: {
    formerManagerAsAdmin?: Actor;
    participantUserId?: string;
    managerUserId?: string;
  }) {
    const managerUserId = opts?.managerUserId ?? (await user("PG2 game manager"));
    const participantUserId = opts?.participantUserId ?? (await user("PG2 participant subject"));
    const venueId = (
      await pool.query<{ id: string }>(
        `INSERT INTO venues(city_id,name,address,timezone,location,created_by_user_id,lifecycle_state,normalized_name,normalized_address)
         SELECT id,'PG2 admin venue','Synthetic','Europe/Moscow',ST_SetSRID(ST_MakePoint(37.6,55.7),4326)::geography,$1,'unverified','pg2 admin venue','pg2 admin address'
         FROM cities LIMIT 1 RETURNING id`,
        [managerUserId],
      )
    ).rows[0]!.id;
    const gameId = (
      await pool.query<{ id: string }>(
        `INSERT INTO games(
           venue_id,title,status,visibility,starts_at,ends_at,timezone,application_deadline_at,
           capacity,external_reserved_count,format_key,level_scale_id,level_scale_version,allowed_level_ids,
           settlement_mode,settlement_purpose,settlement_terms,created_by_user_id,host_display_name,
           host_public_contact,activity_kind,published_at
         ) VALUES (
           $1,'PG2 admin ended game','published','public',
           clock_timestamp()-interval '3 hours',clock_timestamp()-interval '1 hour','Europe/Moscow',
           clock_timestamp()-interval '4 hours',4,0,'doubles','test',1,'["test"]',
           'external','no_trainer_fee','Synthetic terms',$2,'Host','contact','regular',
           clock_timestamp()-interval '5 hours'
         ) RETURNING id`,
        [venueId, managerUserId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO game_managers(game_id,user_id,role,status) VALUES ($1,$2,'owner','active')
       ON CONFLICT (game_id,user_id) DO UPDATE SET status='active', role='owner'`,
      [gameId, managerUserId],
    );
    if (opts?.formerManagerAsAdmin) {
      await pool.query(
        `INSERT INTO game_managers(game_id,user_id,role,status)
         VALUES ($1,$2,'manager','revoked')
         ON CONFLICT (game_id,user_id) DO UPDATE SET status='revoked', role='manager'`,
        [gameId, opts.formerManagerAsAdmin.userId],
      );
    }
    const participationId = (
      await pool.query<{ id: string }>(
        `INSERT INTO participations(game_id,user_id,status,confirmed_at)
         VALUES ($1,$2,'confirmed',clock_timestamp()-interval '4 hours') RETURNING id`,
        [gameId, participantUserId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO participation_transitions
         (participation_id,from_status,to_status,actor_id,reason_code,aggregate_version,game_version,at)
       VALUES ($1,NULL,'confirmed',$2,'test_confirm',1,1,clock_timestamp()-interval '4 hours')`,
      [participationId, participantUserId],
    );
    const now = (await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    await pool.query(
      `INSERT INTO game_attendance
         (participation_id,game_id,user_id,value,version,late,source,actor_user_id,recorded_at,updated_at)
       VALUES ($1,$2,$3,'absent',1,false,'manager_explicit',$4,$5,$5)`,
      [participationId, gameId, participantUserId, managerUserId, now],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id,game_id,user_id,resource_version,actor_user_id,source,
          before_value,after_value,before_late,after_late,before_correction_reason,after_correction_reason,reason,recorded_at)
       VALUES ($1,$2,$3,1,$4,'manager_explicit',NULL,'absent',NULL,false,NULL,NULL,NULL,$5)`,
      [participationId, gameId, participantUserId, managerUserId, now],
    );
    await pool.query(
      `INSERT INTO game_attendance_notices
         (participation_id,game_id,user_id,attendance_version,value,late,source,actor_user_id,actor_display,created_at)
       VALUES ($1,$2,$3,1,'absent',false,'manager_explicit',$4,'Manager',$5)`,
      [participationId, gameId, participantUserId, managerUserId, now],
    );
    const disputeId = (
      await pool.query<{ id: string }>(
        `INSERT INTO game_attendance_disputes
           (participation_id,game_id,user_id,challenged_version,explanation,status,version,help_progress,help_requested_at)
         VALUES ($1,$2,$3,1,'Я была на втором корте','open',2,'requested',clock_timestamp())
         RETURNING id`,
        [participationId, gameId, participantUserId],
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO game_attendance_dispute_revisions
         (dispute_id,resource_version,actor_user_id,action,explanation)
       VALUES ($1,1,$2,'opened','Я была на втором корте'),
              ($1,2,$2,'help_requested','Нужна помощь по уточнению')`,
      [disputeId, participantUserId],
    );
    return {
      gameId,
      participationId,
      disputeId,
      managerUserId,
      participantUserId,
      attendanceVersion: 1,
      disputeVersion: 2,
    };
  }

  it("consumer path 404 and support cannot intake; missing dispute 404; stale step-up 403", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/cases/attendance-dispute-intake",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);

    const missingId = randomUUID();
    expect(
      (
        await post("cases/attendance-dispute-intake", {
          disputeId: missingId,
          expectedDisputeVersion: 1,
          reasonCode: "attendance_intake",
          assignToSelf: true,
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await post(
          "cases/attendance-dispute-intake",
          {
            disputeId: missingId,
            expectedDisputeVersion: 1,
            reasonCode: "attendance_intake",
            assignToSelf: true,
          },
          support,
        )
      ).statusCode,
    ).toBe(403);

    await pool.query("UPDATE admin_sessions SET step_up_at=now()-interval '11 minutes' WHERE id=$1", [
      moderator.sessionId,
    ]);
    expect(
      (
        await post("cases/attendance-dispute-intake", {
          disputeId: missingId,
          expectedDisputeVersion: 1,
          reasonCode: "attendance_intake",
          assignToSelf: true,
        })
      ).statusCode,
    ).toBe(403);
    await pool.query("UPDATE admin_sessions SET step_up_at=now() WHERE id=$1", [moderator.sessionId]);
  });

  it("intake→assigned read→insufficient evidence OPEN→correct_present resolve→history/audit/notice; same-key replay", async () => {
    const seed = await seedOpenDispute();
    const intakeKey = randomUUID();
    const intake = await post(
      "cases/attendance-dispute-intake",
      {
        disputeId: seed.disputeId,
        expectedDisputeVersion: seed.disputeVersion,
        reasonCode: "attendance_intake",
        assignToSelf: true,
      },
      moderator,
      intakeKey,
    );
    expect(intake.statusCode, intake.body).toBe(200);
    const caseId = intake.json().caseId as string;
    expect(intake.json()).toMatchObject({
      disputeId: seed.disputeId,
      assignedTo: moderator.id,
      disputeVersion: seed.disputeVersion + 1,
      caseVersion: 1,
    });
    const intakeReplay = await post(
      "cases/attendance-dispute-intake",
      {
        disputeId: seed.disputeId,
        expectedDisputeVersion: seed.disputeVersion,
        reasonCode: "attendance_intake",
        assignToSelf: true,
      },
      moderator,
      intakeKey,
    );
    expect(intakeReplay.statusCode).toBe(200);
    expect(intakeReplay.json()).toEqual(intake.json());
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM game_attendance_dispute_case_links WHERE dispute_id=$1`,
          [seed.disputeId],
        )
      ).rows[0].n,
    ).toBe(1);

    const read = await get(`cases/${caseId}/attendance-disputes/${seed.disputeId}`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      caseId,
      assignedTo: moderator.id,
      dispute: {
        id: seed.disputeId,
        status: "open",
        helpProgress: "case_opened",
        currentAssertion: { value: "absent", version: 1 },
      },
      allowedActions: { canResolve: true },
    });

    const leaveOpen = await post(`cases/${caseId}/attendance-disputes/${seed.disputeId}`, {
      expectedCaseVersion: 1,
      expectedDisputeVersion: seed.disputeVersion + 1,
      expectedAttendanceVersion: 1,
      resolution: "insufficient_evidence",
      reason: "Недостаточно независимых сведений",
      reasonCode: "attendance_resolve",
    });
    expect(leaveOpen.statusCode, leaveOpen.body).toBe(200);
    expect(leaveOpen.json()).toMatchObject({
      leavesOpen: true,
      independentlyVerified: false,
      resolution: "insufficient_evidence",
    });
    expect(
      (await pool.query(`SELECT status, help_progress FROM game_attendance_disputes WHERE id=$1`, [seed.disputeId]))
        .rows[0],
    ).toMatchObject({ status: "open", help_progress: "left_open_insufficient_evidence" });

    const afterLeave = await get(`cases/${caseId}/attendance-disputes/${seed.disputeId}`);
    const disputeVersion = afterLeave.json().dispute.version as number;
    const caseVersion = afterLeave.json().caseVersion as number;
    const resolveKey = randomUUID();
    const resolve = await post(
      `cases/${caseId}/attendance-disputes/${seed.disputeId}`,
      {
        expectedCaseVersion: caseVersion,
        expectedDisputeVersion: disputeVersion,
        expectedAttendanceVersion: 1,
        resolution: "correct_present",
        reason: "Независимо подтверждено присутствие",
        reasonCode: "attendance_resolve",
      },
      moderator,
      resolveKey,
    );
    expect(resolve.statusCode, resolve.body).toBe(200);
    expect(resolve.json()).toMatchObject({
      leavesOpen: false,
      independentlyVerified: true,
      resolution: "correct_present",
      attendanceVersion: 2,
    });
    const resolveReplay = await post(
      `cases/${caseId}/attendance-disputes/${seed.disputeId}`,
      {
        expectedCaseVersion: caseVersion,
        expectedDisputeVersion: disputeVersion,
        expectedAttendanceVersion: 1,
        resolution: "correct_present",
        reason: "Независимо подтверждено присутствие",
        reasonCode: "attendance_resolve",
      },
      moderator,
      resolveKey,
    );
    expect(resolveReplay.statusCode).toBe(200);
    expect(resolveReplay.json()).toEqual(resolve.json());

    const attendance = await pool.query(
      `SELECT value, version, source FROM game_attendance WHERE participation_id=$1`,
      [seed.participationId],
    );
    expect(attendance.rows[0]).toMatchObject({ value: "present", version: 2, source: "case_reviewer" });
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM game_attendance_notices WHERE participation_id=$1 AND attendance_version=2`,
          [seed.participationId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM game_attendance_dispute_resolutions WHERE dispute_id=$1 AND leaves_open=false`,
          [seed.disputeId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM privileged_audit_events WHERE target_id=$1 AND action_key='admin.attendance_dispute.resolve'`,
          [caseId],
        )
      ).rowCount,
    ).toBeGreaterThan(0);

    const finalRead = await get(`cases/${caseId}/attendance-disputes/${seed.disputeId}`);
    expect(finalRead.statusCode).toBe(200);
    expect(finalRead.json().dispute.status).toBe("resolved");
    expect(finalRead.json().allowedActions.canResolve).toBe(false);
    expect(finalRead.json().dispute.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(["opened", "help_requested", "case_linked", "left_open_insufficient_evidence", "reviewer_resolved"]),
    );
  });

  it("wrong case/dispute, stale versions, unassigned and party/former-manager reviewer denials; replay after assignment loss", async () => {
    const seed = await seedOpenDispute({ formerManagerAsAdmin: otherModerator });
    const intake = await post("cases/attendance-dispute-intake", {
      disputeId: seed.disputeId,
      expectedDisputeVersion: seed.disputeVersion,
      reasonCode: "attendance_intake",
      assignToSelf: true,
    });
    expect(intake.statusCode, intake.body).toBe(200);
    const caseId = intake.json().caseId as string;
    const disputeVersion = intake.json().disputeVersion as number;

    expect((await get(`cases/${caseId}/attendance-disputes/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(`cases/${randomUUID()}/attendance-disputes/${seed.disputeId}`)).statusCode).toBe(404);
    expect((await get(`cases/${caseId}/attendance-disputes/${seed.disputeId}`, otherModerator)).statusCode).toBe(
      404,
    );

    expect(
      (
        await post(`cases/${caseId}/attendance-disputes/${seed.disputeId}`, {
          expectedCaseVersion: 99,
          expectedDisputeVersion: disputeVersion,
          expectedAttendanceVersion: 1,
          resolution: "clear_unknown",
          reason: "stale case",
          reasonCode: "attendance_resolve",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(`cases/${caseId}/attendance-disputes/${seed.disputeId}`, {
          expectedCaseVersion: 1,
          expectedDisputeVersion: 1,
          expectedAttendanceVersion: 1,
          resolution: "clear_unknown",
          reason: "stale dispute",
          reasonCode: "attendance_resolve",
        })
      ).statusCode,
    ).toBe(409);

    const formerSeed = await seedOpenDispute({ formerManagerAsAdmin: otherModerator });
    const formerIntake = await post(
      "cases/attendance-dispute-intake",
      {
        disputeId: formerSeed.disputeId,
        expectedDisputeVersion: formerSeed.disputeVersion,
        reasonCode: "attendance_intake",
        assignToSelf: true,
      },
      otherModerator,
    );
    expect(formerIntake.statusCode).toBe(403);
    expect(formerIntake.json().code).toBe("REVIEWER_MANAGER_CONFLICT");

    const subjectPrincipal = await actor("moderator");
    const subjectSeed = await seedOpenDispute({ participantUserId: subjectPrincipal.userId });
    const subjectIntake = await post(
      "cases/attendance-dispute-intake",
      {
        disputeId: subjectSeed.disputeId,
        expectedDisputeVersion: subjectSeed.disputeVersion,
        reasonCode: "attendance_intake",
        assignToSelf: true,
      },
      subjectPrincipal,
    );
    expect(subjectIntake.statusCode).toBe(403);
    expect(subjectIntake.json().code).toBe("REVIEWER_SUBJECT_CONFLICT");

    const resolveKey = randomUUID();
    const resolveBody = {
      expectedCaseVersion: 1,
      expectedDisputeVersion: disputeVersion,
      expectedAttendanceVersion: 1,
      resolution: "clear_unknown" as const,
      reason: "Сброс до неизвестно",
      reasonCode: "attendance_resolve",
    };
    const resolved = await post(
      `cases/${caseId}/attendance-disputes/${seed.disputeId}`,
      resolveBody,
      moderator,
      resolveKey,
    );
    expect(resolved.statusCode, resolved.body).toBe(200);
    const replayOk = await post(
      `cases/${caseId}/attendance-disputes/${seed.disputeId}`,
      resolveBody,
      moderator,
      resolveKey,
    );
    expect(replayOk.statusCode).toBe(200);
    expect(replayOk.json()).toEqual(resolved.json());

    await pool.query(`UPDATE support_cases SET assigned_to=$1 WHERE id=$2`, [otherModerator.id, caseId]);
    expect(
      (
        await post(
          `cases/${caseId}/attendance-disputes/${seed.disputeId}`,
          resolveBody,
          moderator,
          resolveKey,
        )
      ).statusCode,
    ).toBe(404);
    expect((await get(`cases/${caseId}/attendance-disputes/${seed.disputeId}`)).statusCode).toBe(404);
  });

  it("audit INSERT failure rolls back privileged resolution attendance/dispute/case/history/notice", async () => {
    const seed = await seedOpenDispute();
    const intake = await post("cases/attendance-dispute-intake", {
      disputeId: seed.disputeId,
      expectedDisputeVersion: seed.disputeVersion,
      reasonCode: "attendance_intake",
      assignToSelf: true,
    });
    expect(intake.statusCode, intake.body).toBe(200);
    const caseId = intake.json().caseId as string;
    const disputeVersion = intake.json().disputeVersion as number;
    const beforeAttendance = (
      await pool.query(`SELECT value, version FROM game_attendance WHERE participation_id=$1`, [
        seed.participationId,
      ])
    ).rows[0];
    const beforeDispute = (
      await pool.query(`SELECT status, version, help_progress FROM game_attendance_disputes WHERE id=$1`, [
        seed.disputeId,
      ])
    ).rows[0];
    const beforeCase = (
      await pool.query(`SELECT status, version FROM support_cases WHERE id=$1`, [caseId])
    ).rows[0];
    const beforeNotices = (
      await pool.query(
        `SELECT count(*)::int n FROM game_attendance_notices WHERE participation_id=$1`,
        [seed.participationId],
      )
    ).rows[0].n;
    const beforeResolutions = (
      await pool.query(
        `SELECT count(*)::int n FROM game_attendance_dispute_resolutions WHERE dispute_id=$1`,
        [seed.disputeId],
      )
    ).rows[0].n;
    const beforeHistory = (
      await pool.query(
        `SELECT count(*)::int n FROM game_attendance_dispute_revisions WHERE dispute_id=$1`,
        [seed.disputeId],
      )
    ).rows[0].n;

    await pool.query(
      `CREATE FUNCTION pg2_reject_resolve_audit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.action_key='admin.attendance_dispute.resolve' THEN
           RAISE EXCEPTION 'synthetic audit failure';
         END IF;
         RETURN NEW;
       END $$`,
    );
    await pool.query(
      `CREATE TRIGGER pg2_fail_resolve_audit BEFORE INSERT ON privileged_audit_events
       FOR EACH ROW EXECUTE FUNCTION pg2_reject_resolve_audit()`,
    );
    const key = randomUUID();
    try {
      expect(
        (
          await post(
            `cases/${caseId}/attendance-disputes/${seed.disputeId}`,
            {
              expectedCaseVersion: 1,
              expectedDisputeVersion: disputeVersion,
              expectedAttendanceVersion: 1,
              resolution: "correct_present",
              reason: "should roll back",
              reasonCode: "attendance_resolve",
            },
            moderator,
            key,
          )
        ).statusCode,
      ).toBe(500);
    } finally {
      await pool.query("DROP TRIGGER pg2_fail_resolve_audit ON privileged_audit_events");
      await pool.query("DROP FUNCTION pg2_reject_resolve_audit()");
    }

    expect(
      (await pool.query(`SELECT value, version FROM game_attendance WHERE participation_id=$1`, [
        seed.participationId,
      ])).rows[0],
    ).toEqual(beforeAttendance);
    expect(
      (await pool.query(`SELECT status, version, help_progress FROM game_attendance_disputes WHERE id=$1`, [
        seed.disputeId,
      ])).rows[0],
    ).toEqual(beforeDispute);
    expect(
      (await pool.query(`SELECT status, version FROM support_cases WHERE id=$1`, [caseId])).rows[0],
    ).toEqual(beforeCase);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM game_attendance_notices WHERE participation_id=$1`,
          [seed.participationId],
        )
      ).rows[0].n,
    ).toBe(beforeNotices);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM game_attendance_dispute_resolutions WHERE dispute_id=$1`,
          [seed.disputeId],
        )
      ).rows[0].n,
    ).toBe(beforeResolutions);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM game_attendance_dispute_revisions WHERE dispute_id=$1`,
          [seed.disputeId],
        )
      ).rows[0].n,
    ).toBe(beforeHistory);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM admin_command_receipts WHERE actor_id=$1 AND key_hash=$2`,
          [moderator.id, hashSecret(pepper, key)],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("ACK consent vs admin resolve on same game: one success/authorized conflict, never deadlock 500", async () => {
    const seed = await seedOpenDispute();
    await pool.query(
      `UPDATE game_attendance SET value='present', version=2, updated_at=clock_timestamp()
       WHERE participation_id=$1`,
      [seed.participationId],
    );
    await pool.query(
      `INSERT INTO game_attendance_revisions
         (participation_id,game_id,user_id,resource_version,actor_user_id,source,
          before_value,after_value,before_late,after_late,before_correction_reason,after_correction_reason,reason,recorded_at)
       VALUES ($1,$2,$3,2,$4,'manager_explicit','absent','present',false,false,NULL,'corr','corr',clock_timestamp())`,
      [seed.participationId, seed.gameId, seed.participantUserId, seed.managerUserId],
    );
    await pool.query(
      `INSERT INTO game_attendance_notices
         (participation_id,game_id,user_id,attendance_version,value,late,source,actor_user_id,actor_display,created_at)
       VALUES ($1,$2,$3,2,'present',false,'manager_explicit',$4,'Manager',clock_timestamp())`,
      [seed.participationId, seed.gameId, seed.participantUserId, seed.managerUserId],
    );
    const intake = await post("cases/attendance-dispute-intake", {
      disputeId: seed.disputeId,
      expectedDisputeVersion: seed.disputeVersion,
      reasonCode: "attendance_intake",
      assignToSelf: true,
    });
    expect(intake.statusCode, intake.body).toBe(200);
    const caseId = intake.json().caseId as string;
    const disputeVersion = intake.json().disputeVersion as number;
    const issued = await sessions.createConsumerSession(seed.participantUserId);
    const participantCookie = `${SESSION_COOKIE}=${encodeURIComponent(issued.sessionToken)}`;

    const holder = await pool.connect();
    const timeoutMs = 15000;
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT id FROM games WHERE id=$1 FOR UPDATE`, [seed.gameId]);

      const ackPromise = app.inject({
        method: "POST",
        url: `/v1/games/${seed.gameId}/attendance/${seed.participationId}/acknowledgements`,
        headers: {
          cookie: participantCookie,
          origin: "http://127.0.0.1:18992",
          "x-csrf-token": issued.csrfToken,
          "idempotency-key": `pg2-ack-${randomUUID()}`,
        },
        payload: {
          attendanceVersion: 2,
          resolvingDisputeId: seed.disputeId,
          expectedDisputeVersion: disputeVersion,
        },
      });
      const resolvePromise = post(`cases/${caseId}/attendance-disputes/${seed.disputeId}`, {
        expectedCaseVersion: 1,
        expectedDisputeVersion: disputeVersion,
        expectedAttendanceVersion: 2,
        resolution: "correct_absent",
        reason: "concurrent admin resolve",
        reasonCode: "attendance_resolve",
      });

      await new Promise((r) => setTimeout(r, 250));
      await holder.query("COMMIT");

      const settled = Promise.all([ackPromise, resolvePromise]);
      const timed = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("PG2 concurrency barrier timed out")), timeoutMs),
      );
      const [ackRes, resolveRes] = await Promise.race([settled, timed]);

      expect(ackRes.statusCode).not.toBe(500);
      expect(resolveRes.statusCode).not.toBe(500);
      const ok = [ackRes, resolveRes].filter((r) => r.statusCode === 200);
      const conflicted = [ackRes, resolveRes].filter((r) => r.statusCode === 409);
      expect(ok.length).toBe(1);
      expect(conflicted.length).toBe(1);

      const dispute = (
        await pool.query<{ status: string; resolution_kind: string | null }>(
          `SELECT status, resolution_kind FROM game_attendance_disputes WHERE id=$1`,
          [seed.disputeId],
        )
      ).rows[0]!;
      expect(dispute.status).toBe("resolved");
      expect(["party_acknowledged", "reviewer_correct_absent"]).toContain(dispute.resolution_kind);
    } finally {
      try {
        await holder.query("ROLLBACK");
      } catch {
        /* released */
      }
      holder.release();
    }
  }, 30000);
});
