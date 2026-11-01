import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { conflict, forbidden, notFound, serviceUnavailable } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { postGameWritesEnabled } from "../games/game-outcomes.policy";
import { AdminService, type AdminActor } from "./admin.service";
import { appendAudit } from "./admin-db";
import { hasPermission, type AdminRole } from "./rbac";
import type { AttendanceDisputeIntake, AttendanceDisputeResolve } from "./attendance-disputes.dto";

type CaseRow = {
  id: string;
  status: string;
  version: number;
  assigned_to: string | null;
};

type DisputeRow = {
  id: string;
  game_id: string;
  participation_id: string;
  user_id: string;
  challenged_version: number;
  explanation: string;
  status: string;
  version: number;
  help_progress: string | null;
};

type AttendanceRow = {
  participation_id: string;
  game_id: string;
  user_id: string;
  value: "present" | "absent" | "unknown";
  version: number;
  late: boolean;
  source: string;
  actor_user_id: string;
  correction_reason: string | null;
};

const manages = (actor: AdminActor) => hasPermission(actor.roles as AdminRole[], "case.manage");
const assignedManage = (actor: AdminActor) =>
  hasPermission(actor.roles as AdminRole[], "case.assigned.manage");

@Injectable()
export class AdminAttendanceDisputesService {
  constructor(
    private readonly admin: AdminService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  enabled() {
    this.admin.enabled();
    if (!this.env.CASES_INTERNAL_ENABLED) throw notFound("CASES_DISABLED", "Обращения недоступны");
  }

  private async requirePg2(client: PoolClient) {
    if (!(await client.query("SELECT to_regclass('game_attendance_dispute_case_links') AS name")).rows[0]?.name) {
      throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Разрешение споров недоступно");
    }
  }

  private async scopedCase(client: PoolClient, actor: AdminActor, caseId: string): Promise<CaseRow> {
    const row = (
      await client.query<CaseRow>("SELECT * FROM support_cases WHERE id=$1 FOR UPDATE", [caseId])
    ).rows[0];
    if (
      !row ||
      (!manages(actor) &&
        (!assignedManage(actor) || row.assigned_to !== actor.principalId))
    ) {
      throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
    }
    return row;
  }

  private async assertReviewerEligible(
    client: PoolClient,
    actor: AdminActor,
    dispute: DisputeRow,
  ): Promise<string> {
    const principal = (
      await client.query<{ user_id: string; status: string }>(
        `SELECT user_id, status FROM admin_principals WHERE id=$1 FOR UPDATE`,
        [actor.principalId],
      )
    ).rows[0];
    if (!principal || principal.status !== "active") {
      throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
    }
    const reviewerUserId = principal.user_id;
    if (reviewerUserId === dispute.user_id) {
      throw forbidden("REVIEWER_SUBJECT_CONFLICT", "Проверяющий не может быть предметом спора");
    }
    const manager = await client.query(
      `SELECT 1 FROM game_managers
       WHERE game_id=$1 AND user_id=$2 AND status='active' AND role IN ('owner','manager')
       LIMIT 1`,
      [dispute.game_id, reviewerUserId],
    );
    if (manager.rows[0]) {
      throw forbidden("REVIEWER_MANAGER_CONFLICT", "Организатор игры не может быть независимым проверяющим");
    }
    const participant = await client.query(
      `SELECT 1 FROM participations WHERE game_id=$1 AND user_id=$2 LIMIT 1`,
      [dispute.game_id, reviewerUserId],
    );
    if (participant.rows[0]) {
      throw forbidden("REVIEWER_PARTICIPANT_CONFLICT", "Участник игры не может быть независимым проверяющим");
    }
    return reviewerUserId;
  }

  private async displayName(client: PoolClient, userId: string): Promise<string> {
    const row = (
      await client.query<{ display_name: string }>(
        `SELECT COALESCE(NULLIF(TRIM(p.display_name), ''), NULLIF(TRIM(u.display_name), ''), 'Игрок') AS display_name
         FROM users u
         LEFT JOIN player_social_profiles p ON p.user_id = u.id
         WHERE u.id = $1`,
        [userId],
      )
    ).rows[0];
    return row?.display_name ?? "Игрок";
  }

  private async writeAttendance(
    client: PoolClient,
    args: {
      dispute: DisputeRow;
      expectedVersion: number;
      value: "present" | "absent" | "unknown";
      actorUserId: string;
      reason: string;
      now: Date;
    },
  ): Promise<AttendanceRow> {
    const existing = (
      await client.query<AttendanceRow>(
        `SELECT * FROM game_attendance WHERE participation_id=$1 FOR UPDATE`,
        [args.dispute.participation_id],
      )
    ).rows[0];
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== args.expectedVersion) {
      throw conflict("VERSION_CONFLICT", "Версия посещения устарела");
    }
    const nextVersion = currentVersion + 1;
    const late = false;
    const source = "case_reviewer";
    if (!existing) {
      throw conflict("ATTENDANCE_MISSING", "Нет отметки для решения");
    }
    await client.query(
      `UPDATE game_attendance
       SET value=$2, version=$3, late=$4, source=$5, actor_user_id=$6,
           correction_reason=$7, updated_at=$8
       WHERE participation_id=$1`,
      [
        args.dispute.participation_id,
        args.value,
        nextVersion,
        late,
        source,
        args.actorUserId,
        args.reason,
        args.now,
      ],
    );
    await client.query(
      `INSERT INTO game_attendance_revisions
         (participation_id, game_id, user_id, resource_version, actor_user_id, source,
          before_value, after_value, before_late, after_late,
          before_correction_reason, after_correction_reason, reason, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        args.dispute.participation_id,
        args.dispute.game_id,
        args.dispute.user_id,
        nextVersion,
        args.actorUserId,
        source,
        existing.value,
        args.value,
        existing.late,
        late,
        existing.correction_reason,
        args.reason,
        args.reason,
        args.now,
      ],
    );
    await client.query(
      `INSERT INTO game_attendance_notices
         (participation_id, game_id, user_id, attendance_version, value, late, source,
          actor_user_id, actor_display, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        args.dispute.participation_id,
        args.dispute.game_id,
        args.dispute.user_id,
        nextVersion,
        args.value,
        late,
        source,
        args.actorUserId,
        await this.displayName(client, args.actorUserId),
        args.now,
      ],
    );
    return (await client.query<AttendanceRow>(
      `SELECT * FROM game_attendance WHERE participation_id=$1`,
      [args.dispute.participation_id],
    )).rows[0]!;
  }

  async intake(request: FastifyRequest, key: string | undefined, input: AttendanceDisputeIntake) {
    this.enabled();
    if (!postGameWritesEnabled(this.env)) {
      throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись посещения недоступна");
    }
    return this.admin.privilegedCommand(
      request,
      key,
      "user.lookup",
      true,
      "attendance_dispute.intake",
      input,
      async (client, actor, keyHash) => {
        await this.requirePg2(client);
        if (!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
        // Lock order: case authority advisory (adminTransaction) → dispute → game → participation → case insert.
        const dispute = (
          await client.query<DisputeRow>(
            `SELECT id, game_id, participation_id, user_id, challenged_version, explanation,
                    status, version, help_progress
             FROM game_attendance_disputes WHERE id=$1 FOR UPDATE`,
            [input.disputeId],
          )
        ).rows[0];
        if (!dispute || dispute.status !== "open") {
          throw notFound("DISPUTE_UNAVAILABLE", "Возражение недоступно");
        }
        if (dispute.version !== input.expectedDisputeVersion) {
          throw conflict("VERSION_CONFLICT", "Версия возражения устарела");
        }
        await client.query(`SELECT id FROM games WHERE id=$1 FOR UPDATE`, [dispute.game_id]);
        await client.query(`SELECT id FROM participations WHERE id=$1 FOR UPDATE`, [
          dispute.participation_id,
        ]);
        const existing = (
          await client.query<{ case_id: string }>(
            `SELECT case_id FROM game_attendance_dispute_case_links WHERE dispute_id=$1`,
            [dispute.id],
          )
        ).rows[0];
        if (existing) {
          throw conflict("DISPUTE_CASE_EXISTS", "Обращение по возражению уже создано");
        }
        await this.assertReviewerEligible(client, actor, dispute);
        const created = (
          await client.query<CaseRow>(
            `INSERT INTO support_cases(created_by, assigned_to, status)
             VALUES ($1, $2, 'open') RETURNING *`,
            [actor.principalId, actor.principalId],
          )
        ).rows[0]!;
        if (
          !(
            await client.query(
              `INSERT INTO support_case_links(case_id, source_kind, game_id)
               VALUES ($1, 'game', $2) ON CONFLICT(case_id, game_id) DO NOTHING RETURNING id`,
              [created.id, dispute.game_id],
            )
          ).rowCount
        ) {
          throw conflict("CASE_LINK_EXISTS", "Связь уже существует");
        }
        await client.query(
          `INSERT INTO game_attendance_dispute_case_links
             (dispute_id, case_id, game_id, created_by_principal_id)
           VALUES ($1,$2,$3,$4)`,
          [dispute.id, created.id, dispute.game_id, actor.principalId],
        );
        const nextVersion = dispute.version + 1;
        await client.query(
          `UPDATE game_attendance_disputes
           SET version=$2,
               help_progress='case_opened',
               updated_at=clock_timestamp()
           WHERE id=$1`,
          [dispute.id, nextVersion],
        );
        await client.query(
          `INSERT INTO game_attendance_dispute_revisions
             (dispute_id, resource_version, actor_user_id, action, explanation)
           VALUES ($1,$2,$3,'case_linked',$4)`,
          [dispute.id, nextVersion, actor.principal.user_id, "Создано служебное обращение по возражению"],
        );
        const auditId = await appendAudit(client, {
          actor,
          action: "admin.attendance_dispute.intake",
          targetType: "case",
          targetId: created.id,
          permission: "case.manage",
          reason: input.reasonCode,
          after: { disputeId: dispute.id, gameId: dispute.game_id, assignedTo: actor.principalId },
          keyHash,
        });
        await client.query(
          `INSERT INTO support_case_actions(case_id, case_version, audit_id, action)
           VALUES ($1, 1, $2, 'create')`,
          [created.id, auditId],
        );
        return {
          caseId: created.id,
          disputeId: dispute.id,
          disputeVersion: nextVersion,
          caseVersion: 1,
          auditId,
          assignedTo: actor.principalId,
        };
      },
      async (client, actor) => {
        await this.requirePg2(client);
        if (!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
      },
    );
  }

  async read(request: FastifyRequest, caseId: string, disputeId: string) {
    this.enabled();
    return this.admin.privilegedRead(request, "user.lookup", async (client, actor) => {
      await this.requirePg2(client);
      const caseRow = await this.scopedCase(client, actor, caseId);
      const link = (
        await client.query<{ dispute_id: string; game_id: string }>(
          `SELECT dispute_id, game_id FROM game_attendance_dispute_case_links
           WHERE case_id=$1 AND dispute_id=$2`,
          [caseId, disputeId],
        )
      ).rows[0];
      if (!link) throw notFound("DISPUTE_UNAVAILABLE", "Возражение недоступно");
      const dispute = (
        await client.query<DisputeRow>(
          `SELECT id, game_id, participation_id, user_id, challenged_version, explanation,
                  status, version, help_progress
           FROM game_attendance_disputes WHERE id=$1`,
          [disputeId],
        )
      ).rows[0];
      if (!dispute) throw notFound("DISPUTE_UNAVAILABLE", "Возражение недоступно");
      const attendance = (
        await client.query<AttendanceRow>(
          `SELECT * FROM game_attendance WHERE participation_id=$1`,
          [dispute.participation_id],
        )
      ).rows[0];
      const challenged = (
        await client.query<{
          after_value: string;
          after_late: boolean;
          source: string;
          resource_version: number;
          recorded_at: Date;
        }>(
          `SELECT after_value, after_late, source, resource_version, recorded_at
           FROM game_attendance_revisions
           WHERE participation_id=$1 AND resource_version=$2`,
          [dispute.participation_id, dispute.challenged_version],
        )
      ).rows[0];
      const history = (
        await client.query<{
          resource_version: number;
          action: string;
          explanation: string | null;
          recorded_at: Date;
        }>(
          `SELECT resource_version, action, explanation, recorded_at
           FROM game_attendance_dispute_revisions
           WHERE dispute_id=$1 ORDER BY resource_version ASC`,
          [disputeId],
        )
      ).rows;
      await appendAudit(client, {
        actor,
        action: "admin.attendance_dispute.read",
        targetType: "case",
        targetId: caseId,
        permission: manages(actor) ? "case.manage" : "case.assigned.manage",
        reason: "operations_read",
      });
      return {
        caseId: caseRow.id,
        caseVersion: caseRow.version,
        caseStatus: caseRow.status,
        assignedTo: caseRow.assigned_to,
        dispute: {
          id: dispute.id,
          gameId: dispute.game_id,
          contextId: dispute.participation_id,
          status: dispute.status,
          version: dispute.version,
          challengedVersion: dispute.challenged_version,
          explanation: dispute.explanation,
          helpProgress: dispute.help_progress,
          subjectDisplay: await this.displayName(client, dispute.user_id),
          challengedAssertion: challenged
            ? {
                version: challenged.resource_version,
                value: challenged.after_value,
                late: challenged.after_late,
                source: challenged.source,
                recordedAt: challenged.recorded_at.toISOString(),
              }
            : null,
          currentAssertion: attendance
            ? {
                value: attendance.value,
                version: attendance.version,
                late: attendance.late,
                source: attendance.source,
              }
            : { value: "unknown", version: 0, late: false, source: null },
          history: history.map((item) => ({
            version: item.resource_version,
            action: item.action,
            explanation: item.explanation,
            recordedAt: item.recorded_at.toISOString(),
          })),
        },
        allowedActions: {
          canResolve:
            postGameWritesEnabled(this.env) &&
            caseRow.assigned_to === actor.principalId &&
            dispute.status === "open",
        },
      };
    });
  }

  async resolve(
    request: FastifyRequest,
    caseId: string,
    disputeId: string,
    key: string | undefined,
    input: AttendanceDisputeResolve,
  ) {
    this.enabled();
    if (!postGameWritesEnabled(this.env)) {
      throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись посещения недоступна");
    }
    return this.admin.privilegedCommand(
      request,
      key,
      "user.lookup",
      true,
      "attendance_dispute.resolve",
      { caseId, disputeId, ...input },
      async (client, actor, keyHash) => {
        await this.requirePg2(client);
        // Lock order: advisory → case → dispute → game → participation → attendance.
        const caseRow = await this.scopedCase(client, actor, caseId);
        if (caseRow.assigned_to !== actor.principalId) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно назначение на это обращение");
        }
        if (caseRow.version !== input.expectedCaseVersion) {
          throw conflict("CASE_VERSION_CONFLICT", "Обращение уже изменено");
        }
        const link = (
          await client.query(
            `SELECT 1 FROM game_attendance_dispute_case_links
             WHERE case_id=$1 AND dispute_id=$2`,
            [caseId, disputeId],
          )
        ).rows[0];
        if (!link) throw notFound("DISPUTE_UNAVAILABLE", "Возражение недоступно");
        const dispute = (
          await client.query<DisputeRow>(
            `SELECT id, game_id, participation_id, user_id, challenged_version, explanation,
                    status, version, help_progress
             FROM game_attendance_disputes WHERE id=$1 FOR UPDATE`,
            [disputeId],
          )
        ).rows[0];
        if (!dispute) throw notFound("DISPUTE_UNAVAILABLE", "Возражение недоступно");
        if (dispute.game_id !== (
          await client.query<{ game_id: string }>(
            `SELECT game_id FROM game_attendance_dispute_case_links WHERE case_id=$1 AND dispute_id=$2`,
            [caseId, disputeId],
          )
        ).rows[0]?.game_id) {
          throw notFound("DISPUTE_UNAVAILABLE", "Возражение недоступно");
        }
        if (dispute.status !== "open") {
          throw conflict("DISPUTE_NOT_OPEN", "Возражение уже закрыто");
        }
        if (dispute.version !== input.expectedDisputeVersion) {
          throw conflict("VERSION_CONFLICT", "Версия возражения устарела");
        }
        await client.query(`SELECT id FROM games WHERE id=$1 FOR UPDATE`, [dispute.game_id]);
        await client.query(`SELECT id FROM participations WHERE id=$1 FOR UPDATE`, [
          dispute.participation_id,
        ]);
        const reviewerUserId = await this.assertReviewerEligible(client, actor, dispute);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        const attendance = (
          await client.query<AttendanceRow>(
            `SELECT * FROM game_attendance WHERE participation_id=$1 FOR UPDATE`,
            [dispute.participation_id],
          )
        ).rows[0];
        const currentVersion = attendance?.version ?? 0;
        if (currentVersion !== input.expectedAttendanceVersion) {
          throw conflict("VERSION_CONFLICT", "Версия посещения устарела");
        }

        let independentlyVerified = false;
        let resolutionKind: string | null = null;
        let attendanceAfter = attendance;
        let helpProgress = dispute.help_progress;

        if (input.resolution === "insufficient_evidence") {
          independentlyVerified = false;
          helpProgress = "left_open_insufficient_evidence";
          const nextDisputeVersion = dispute.version + 1;
          const nextCaseVersion = caseRow.version + 1;
          await client.query(
            `UPDATE game_attendance_disputes
             SET version=$2,
                 help_progress=$3,
                 updated_at=clock_timestamp()
             WHERE id=$1`,
            [dispute.id, nextDisputeVersion, helpProgress],
          );
          await client.query(
            `INSERT INTO game_attendance_dispute_revisions
               (dispute_id, resource_version, actor_user_id, action, explanation)
             VALUES ($1,$2,$3,'left_open_insufficient_evidence',$4)`,
            [dispute.id, nextDisputeVersion, reviewerUserId, input.reason],
          );
          await client.query(
            `UPDATE support_cases
             SET version=$2, status='in_review', updated_at=clock_timestamp()
             WHERE id=$1`,
            [caseId, nextCaseVersion],
          );
          const auditId = await appendAudit(client, {
            actor,
            action: "admin.attendance_dispute.resolve",
            targetType: "case",
            targetId: caseId,
            permission: manages(actor) ? "case.manage" : "case.assigned.manage",
            reason: input.reasonCode,
            before: {
              caseVersion: caseRow.version,
              disputeVersion: dispute.version,
              attendanceVersion: currentVersion,
            },
            after: {
              resolution: input.resolution,
              leavesOpen: true,
              independentlyVerified: false,
              disputeVersion: nextDisputeVersion,
              caseVersion: nextCaseVersion,
            },
            keyHash,
          });
          await client.query(
            `INSERT INTO game_attendance_dispute_resolutions
               (dispute_id, dispute_version, case_id, case_version, attendance_version,
                resolution, reason, reviewer_principal_id, reviewer_user_id,
                independently_verified, leaves_open, audit_id, recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,true,$10,$11)`,
            [
              dispute.id,
              nextDisputeVersion,
              caseId,
              nextCaseVersion,
              currentVersion,
              input.resolution,
              input.reason,
              actor.principalId,
              reviewerUserId,
              auditId,
              now,
            ],
          );
          await client.query(
            `INSERT INTO support_case_actions(case_id, case_version, audit_id, action, note_code)
             VALUES ($1,$2,$3,'note','awaiting_information')`,
            [caseId, nextCaseVersion, auditId],
          );
          return {
            caseId,
            disputeId,
            disputeVersion: nextDisputeVersion,
            caseVersion: nextCaseVersion,
            attendanceVersion: currentVersion,
            resolution: input.resolution,
            leavesOpen: true,
            independentlyVerified: false,
            auditId,
          };
        }

        if (input.resolution === "uphold_current") {
          if (!attendance || attendance.value === "unknown") {
            throw conflict("ATTENDANCE_UNKNOWN_NO_UPHOLD", "Нельзя утвердить неизвестную отметку");
          }
          resolutionKind = "reviewer_uphold_current";
          independentlyVerified = true;
        } else if (input.resolution === "correct_present") {
          attendanceAfter = await this.writeAttendance(client, {
            dispute,
            expectedVersion: currentVersion,
            value: "present",
            actorUserId: reviewerUserId,
            reason: input.reason,
            now,
          });
          resolutionKind = "reviewer_correct_present";
          independentlyVerified = true;
        } else if (input.resolution === "correct_absent") {
          attendanceAfter = await this.writeAttendance(client, {
            dispute,
            expectedVersion: currentVersion,
            value: "absent",
            actorUserId: reviewerUserId,
            reason: input.reason,
            now,
          });
          resolutionKind = "reviewer_correct_absent";
          independentlyVerified = true;
        } else if (input.resolution === "clear_unknown") {
          attendanceAfter = await this.writeAttendance(client, {
            dispute,
            expectedVersion: currentVersion,
            value: "unknown",
            actorUserId: reviewerUserId,
            reason: input.reason,
            now,
          });
          resolutionKind = "reviewer_clear_unknown";
          independentlyVerified = true;
        }

        const nextDisputeVersion = dispute.version + 1;
        const nextCaseVersion = caseRow.version + 1;
        helpProgress = "resolved";
        await client.query(
          `UPDATE game_attendance_disputes
           SET status='resolved',
               version=$2,
               resolved_at=$3,
               resolution_kind=$4,
               help_progress=$5,
               updated_at=$3
           WHERE id=$1`,
          [dispute.id, nextDisputeVersion, now, resolutionKind, helpProgress],
        );
        await client.query(
          `INSERT INTO game_attendance_dispute_revisions
             (dispute_id, resource_version, actor_user_id, action, explanation)
           VALUES ($1,$2,$3,'reviewer_resolved',$4)`,
          [dispute.id, nextDisputeVersion, reviewerUserId, input.reason],
        );
        await client.query(
          `UPDATE support_cases
           SET version=$2, status='resolved', updated_at=clock_timestamp()
           WHERE id=$1`,
          [caseId, nextCaseVersion],
        );
        const auditId = await appendAudit(client, {
          actor,
          action: "admin.attendance_dispute.resolve",
          targetType: "case",
          targetId: caseId,
          permission: manages(actor) ? "case.manage" : "case.assigned.manage",
          reason: input.reasonCode,
          before: {
            caseVersion: caseRow.version,
            disputeVersion: dispute.version,
            attendanceVersion: currentVersion,
          },
          after: {
            resolution: input.resolution,
            leavesOpen: false,
            independentlyVerified,
            disputeVersion: nextDisputeVersion,
            caseVersion: nextCaseVersion,
            attendanceVersion: attendanceAfter?.version ?? currentVersion,
            resolutionKind,
          },
          keyHash,
        });
        await client.query(
          `INSERT INTO game_attendance_dispute_resolutions
             (dispute_id, dispute_version, case_id, case_version, attendance_version,
              resolution, reason, reviewer_principal_id, reviewer_user_id,
              independently_verified, leaves_open, audit_id, recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12)`,
          [
            dispute.id,
            nextDisputeVersion,
            caseId,
            nextCaseVersion,
            attendanceAfter?.version ?? currentVersion,
            input.resolution,
            input.reason,
            actor.principalId,
            reviewerUserId,
            independentlyVerified,
            auditId,
            now,
          ],
        );
        await client.query(
          `INSERT INTO support_case_actions(case_id, case_version, audit_id, action, note_code)
           VALUES ($1,$2,$3,'status','resolution_recorded')`,
          [caseId, nextCaseVersion, auditId],
        );
        return {
          caseId,
          disputeId,
          disputeVersion: nextDisputeVersion,
          caseVersion: nextCaseVersion,
          attendanceVersion: attendanceAfter?.version ?? currentVersion,
          resolution: input.resolution,
          leavesOpen: false,
          independentlyVerified,
          auditId,
        };
      },
      async (client, actor) => {
        await this.requirePg2(client);
        const caseRow = await this.scopedCase(client, actor, caseId);
        if (caseRow.assigned_to !== actor.principalId) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно назначение на это обращение");
        }
        const link = (
          await client.query(
            `SELECT 1 FROM game_attendance_dispute_case_links
             WHERE case_id=$1 AND dispute_id=$2`,
            [caseId, disputeId],
          )
        ).rows[0];
        if (!link) throw notFound("DISPUTE_UNAVAILABLE", "Возражение недоступно");
      },
    );
  }
}
