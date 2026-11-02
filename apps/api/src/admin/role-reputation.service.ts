import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { conflict, forbidden, notFound, serviceUnavailable } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { appendAudit, type AuditActor } from "./admin-db";
import { AdminService } from "./admin.service";
import { hasPermission, type AdminRole } from "./rbac";
import {
  type RoleBasisResolve,
  type RoleReputationIntake,
  type RoleReviewDecide,
} from "./role-reputation.dto";

type CaseRow = {
  id: string;
  status: string;
  version: number;
  assigned_to: string | null;
};

type PendingRow = {
  id: string;
  kind: string;
  slot_id: string;
  revision_id: string | null;
  reply_revision_id: string | null;
  receipt_token: string;
  status: string;
  case_id: string | null;
  submitted_by_user_id: string;
  subject_user_id: string;
  role: string;
  version: number;
  created_at: Date;
};

type SlotRow = {
  id: string;
  author_user_id: string;
  subject_user_id: string;
  role: string;
  status: string;
  version: number;
  approved_revision_id: string | null;
  pending_revision_id: string | null;
  public_handle: string;
};

const manages = (actor: AuditActor) => hasPermission(actor.roles as AdminRole[], "case.manage");

@Injectable()
export class AdminRoleReputationService {
  constructor(
    private readonly admin: AdminService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  enabled() {
    this.admin.enabled();
    if (!this.env.CASES_INTERNAL_ENABLED) {
      throw notFound("CASES_DISABLED", "Обращения недоступны");
    }
  }

  private async requireInstalled(client: PoolClient) {
    if (
      !(await client.query("SELECT to_regclass('role_reputation_pending_intakes') AS name")).rows[0]
        ?.name
    ) {
      throw serviceUnavailable("ROLE_REPUTATION_UNAVAILABLE", "Репутация ролей недоступна");
    }
  }

  private async scopedCase(client: PoolClient, actor: AuditActor, id: string) {
    const row = (
      await client.query<CaseRow>("SELECT * FROM support_cases WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (
      !row ||
      (!manages(actor) &&
        (!hasPermission(actor.roles as AdminRole[], "case.assigned.manage") ||
          row.assigned_to !== actor.principalId))
    ) {
      throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
    }
    return row;
  }

  private async assertIndependent(
    client: PoolClient,
    actor: AuditActor,
    affected: {
      authorUserId: string;
      subjectUserId: string;
      reporterUserIds: string[];
      gameIds: string[];
      excludePrincipalIds?: string[];
    },
  ) {
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
    const banned = new Set([
      affected.authorUserId,
      affected.subjectUserId,
      ...affected.reporterUserIds,
    ]);
    if (banned.has(reviewerUserId)) {
      throw forbidden("REVIEWER_SUBJECT_CONFLICT", "Проверяющий не может быть стороной обращения");
    }
    if (affected.excludePrincipalIds?.includes(actor.principalId)) {
      throw forbidden("REVIEWER_APPEAL_CONFLICT", "Исходный проверяющий исключён из апелляции");
    }
    for (const gameId of affected.gameIds) {
      if (
        (
          await client.query(
            `SELECT 1 FROM games WHERE id=$1 AND created_by_user_id=$2 LIMIT 1`,
            [gameId, reviewerUserId],
          )
        ).rows[0]
      ) {
        throw forbidden("REVIEWER_MANAGER_CONFLICT", "Организатор игры не может быть независимым проверяющим");
      }
      if (
        (
          await client.query(
            `SELECT 1 FROM game_managers
             WHERE game_id=$1 AND user_id=$2 AND role IN ('owner','manager') LIMIT 1`,
            [gameId, reviewerUserId],
          )
        ).rows[0]
      ) {
        throw forbidden("REVIEWER_MANAGER_CONFLICT", "Организатор игры не может быть независимым проверяющим");
      }
      if (
        (
          await client.query(
            `SELECT 1 FROM participations WHERE game_id=$1 AND user_id=$2 LIMIT 1`,
            [gameId, reviewerUserId],
          )
        ).rows[0]
      ) {
        throw forbidden(
          "REVIEWER_PARTICIPANT_CONFLICT",
          "Участник игры не может быть независимым проверяющим",
        );
      }
      if (
        (
          await client.query(
            `SELECT 1 FROM game_role_proofs
             WHERE game_id=$1 AND subject_user_id=$2 LIMIT 1`,
            [gameId, reviewerUserId],
          )
        ).rows[0]
      ) {
        throw forbidden("REVIEWER_ROLE_CONFLICT", "Исторический исполнитель роли исключён");
      }
    }
    return reviewerUserId;
  }

  async listPending(
    request: FastifyRequest,
    page: { beforeId?: string; limit: number; kind?: string },
  ) {
    this.enabled();
    return this.admin.privilegedRead(request, "user.lookup", async (client, actor) => {
      await this.requireInstalled(client);
      if (!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
      const rows = (
        await client.query<PendingRow>(
          `SELECT id, kind, slot_id, receipt_token, status, case_id,
                  submitted_by_user_id, subject_user_id, role, version, created_at,
                  revision_id, reply_revision_id
           FROM role_reputation_pending_intakes
           WHERE status = 'waiting_intake'
             AND ($1::text IS NULL OR kind = $1)
             AND ($2::uuid IS NULL OR id < $2)
           ORDER BY id DESC
           LIMIT $3`,
          [page.kind ?? null, page.beforeId ?? null, page.limit + 1],
        )
      ).rows;
      await appendAudit(client, {
        actor,
        action: "admin.role_reputation.pending_read",
        targetType: "role_reputation_pending",
        targetId: "bounded_queue",
        permission: "case.manage",
        reason: "operations_read",
      });
      // Minimal metadata only — no review body in queue.
      return {
        items: rows.slice(0, page.limit).map((r) => ({
          pendingIntakeId: r.id,
          kind: r.kind,
          role: r.role,
          status: r.status,
          version: r.version,
          createdAt: r.created_at,
          hasAssignee: false,
          caseId: null,
        })),
        nextBeforeId: rows.length > page.limit ? rows[page.limit - 1]!.id : null,
      };
    });
  }

  async intake(request: FastifyRequest, key: string | undefined, input: RoleReputationIntake) {
    this.enabled();
    if (!this.env.POST_GAME_INTERNAL_ENABLED) {
      throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись недоступна");
    }
    return this.admin.privilegedCommand(
      request,
      key,
      "user.lookup",
      true,
      "role_reputation.intake",
      input,
      async (client, actor, keyHash) => {
        await this.requireInstalled(client);
        if (!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
        const pending = (
          await client.query<PendingRow>(
            `SELECT * FROM role_reputation_pending_intakes WHERE id=$1 FOR UPDATE`,
            [input.pendingIntakeId],
          )
        ).rows[0];
        if (!pending || pending.status !== "waiting_intake") {
          throw notFound("PENDING_UNAVAILABLE", "Ожидание недоступно");
        }
        if (pending.version !== input.expectedIntakeVersion) {
          throw conflict("VERSION_CONFLICT", "Версия ожидания устарела");
        }
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM role_review_slots WHERE id=$1 FOR UPDATE`,
            [pending.slot_id],
          )
        ).rows[0];
        if (!slot) throw notFound("PENDING_UNAVAILABLE", "Ожидание недоступно");
        const gameIds = (
          await client.query<{ game_id: string }>(
            `SELECT DISTINCT game_id FROM role_review_revisions WHERE slot_id=$1
             UNION
             SELECT game_id FROM role_review_event_fences WHERE slot_id=$1`,
            [slot.id],
          )
        ).rows.map((r) => r.game_id);
        const reporters = (
          await client.query<{ reporter_user_id: string }>(
            `SELECT reporter_user_id FROM role_reputation_reports WHERE slot_id=$1`,
            [slot.id],
          )
        ).rows.map((r) => r.reporter_user_id);
        await this.assertIndependent(client, actor, {
          authorUserId: slot.author_user_id,
          subjectUserId: slot.subject_user_id,
          reporterUserIds: reporters,
          gameIds,
        });
        // Genuine admin principal creates Case — never fake created_by.
        const created = (
          await client.query<CaseRow>(
            `INSERT INTO support_cases(created_by, assigned_to, status)
             VALUES ($1, $2, 'open') RETURNING *`,
            [actor.principalId, actor.principalId],
          )
        ).rows[0]!;
        if (gameIds[0]) {
          await client.query(
            `INSERT INTO support_case_links(case_id, source_kind, game_id)
             VALUES ($1, 'game', $2) ON CONFLICT(case_id, game_id) DO NOTHING`,
            [created.id, gameIds[0]],
          );
        }
        await client.query(
          `INSERT INTO role_reputation_case_links
             (case_id, pending_intake_id, slot_id, created_by_principal_id)
           VALUES ($1,$2,$3,$4)`,
          [created.id, pending.id, slot.id, actor.principalId],
        );
        await client.query(
          `UPDATE role_reputation_pending_intakes
           SET status='linked', case_id=$2, version=version+1, updated_at=clock_timestamp()
           WHERE id=$1`,
          [pending.id, created.id],
        );
        const auditId = await appendAudit(client, {
          actor,
          action: "admin.role_reputation.intake",
          targetType: "case",
          targetId: created.id,
          permission: "case.manage",
          reason: input.reasonCode,
          after: { pendingIntakeId: pending.id, slotId: slot.id, assignedTo: actor.principalId },
          keyHash,
        });
        await client.query(
          `INSERT INTO support_case_actions(case_id, case_version, audit_id, action)
           VALUES ($1, 1, $2, 'create')`,
          [created.id, auditId],
        );
        return {
          caseId: created.id,
          pendingIntakeId: pending.id,
          caseVersion: 1,
          intakeVersion: pending.version + 1,
          auditId,
          assignedTo: actor.principalId,
        };
      },
      async (client, actor) => {
        await this.requireInstalled(client);
        if (!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
      },
    );
  }

  async readSource(request: FastifyRequest, caseId: string) {
    this.enabled();
    return this.admin.privilegedRead(
      request,
      "user.lookup",
      async (client, actor) => {
        await this.requireInstalled(client);
        const caze = await this.scopedCase(client, actor, caseId);
        if (caze.assigned_to !== actor.principalId) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
        }
        if (
          !hasPermission(actor.roles as AdminRole[], "evidence.assigned.read") &&
          !manages(actor)
        ) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
        }
        const link = (
          await client.query<{ pending_intake_id: string; slot_id: string }>(
            `SELECT pending_intake_id, slot_id FROM role_reputation_case_links WHERE case_id=$1`,
            [caseId],
          )
        ).rows[0];
        if (!link) throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
        const slot = (
          await client.query<SlotRow>(`SELECT * FROM role_review_slots WHERE id=$1`, [link.slot_id])
        ).rows[0];
        if (!slot) throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
        const pending = (
          await client.query<PendingRow>(
            `SELECT * FROM role_reputation_pending_intakes WHERE id=$1`,
            [link.pending_intake_id],
          )
        ).rows[0]!;
        const gameIds = (
          await client.query<{ game_id: string }>(
            `SELECT DISTINCT game_id FROM role_review_revisions WHERE slot_id=$1`,
            [slot.id],
          )
        ).rows.map((r) => r.game_id);
        await this.assertIndependent(client, actor, {
          authorUserId: slot.author_user_id,
          subjectUserId: slot.subject_user_id,
          reporterUserIds: [],
          gameIds,
        });
        const revisionId = pending.revision_id ?? slot.pending_revision_id ?? slot.approved_revision_id;
        const revision = revisionId
          ? (
              await client.query<{
                id: string;
                resource_version: number;
                body_text: string;
                topics: string[];
                projection_hash: string;
                proof_game_id: string;
                proof_role: string;
                proof_version: number;
                lifecycle: string;
              }>(
                `SELECT id, resource_version, body_text, topics, projection_hash,
                        proof_game_id, proof_role, proof_version, lifecycle
                 FROM role_review_revisions WHERE id=$1`,
                [revisionId],
              )
            ).rows[0]
          : null;
        const reply = pending.reply_revision_id
          ? (
              await client.query<{
                id: string;
                resource_version: number;
                body_text: string;
                projection_hash: string;
                lifecycle: string;
              }>(
                `SELECT id, resource_version, body_text, projection_hash, lifecycle
                 FROM role_review_reply_revisions WHERE id=$1`,
                [pending.reply_revision_id],
              )
            ).rows[0]
          : null;
        await appendAudit(client, {
          actor,
          action: "admin.role_reputation.source_read",
          targetType: "case",
          targetId: caseId,
          permission: "evidence.assigned.read",
          reason: "operations_read",
        });
        return {
          caseId,
          caseVersion: caze.version,
          assignedTo: caze.assigned_to,
          pendingKind: pending.kind,
          slot: {
            id: slot.id,
            reviewHandle: slot.public_handle,
            role: slot.role,
            status: slot.status,
            version: slot.version,
          },
          reviewRevision: revision
            ? {
                id: revision.id,
                resourceVersion: revision.resource_version,
                text: revision.body_text,
                topics: revision.topics,
                projectionHash: revision.projection_hash,
                lifecycle: revision.lifecycle,
                proofRef: {
                  gameId: revision.proof_game_id,
                  role: revision.proof_role,
                  version: revision.proof_version,
                },
              }
            : null,
          replyRevision: reply
            ? {
                id: reply.id,
                resourceVersion: reply.resource_version,
                text: reply.body_text,
                projectionHash: reply.projection_hash,
                lifecycle: reply.lifecycle,
              }
            : null,
        };
      },
      true,
    );
  }

  async decide(
    request: FastifyRequest,
    caseId: string,
    key: string | undefined,
    input: RoleReviewDecide,
  ) {
    this.enabled();
    return this.admin.privilegedCommand(
      request,
      key,
      "user.lookup",
      true,
      "role_reputation.decide",
      { caseId, ...input },
      async (client, actor, keyHash) => {
        await this.requireInstalled(client);
        const caze = await this.scopedCase(client, actor, caseId);
        if (caze.version !== input.expectedCaseVersion) {
          throw conflict("VERSION_CONFLICT", "Версия обращения устарела");
        }
        if (caze.assigned_to !== actor.principalId) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
        }
        // Generic case status=resolved alone never publishes.
        const link = (
          await client.query<{ slot_id: string }>(
            `SELECT slot_id FROM role_reputation_case_links WHERE case_id=$1`,
            [caseId],
          )
        ).rows[0];
        if (!link) throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM role_review_slots WHERE id=$1 FOR UPDATE`,
            [link.slot_id],
          )
        ).rows[0];
        if (!slot) throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
        const gameIds = (
          await client.query<{ game_id: string }>(
            `SELECT DISTINCT game_id FROM role_review_revisions WHERE slot_id=$1`,
            [slot.id],
          )
        ).rows.map((r) => r.game_id);
        await this.assertIndependent(client, actor, {
          authorUserId: slot.author_user_id,
          subjectUserId: slot.subject_user_id,
          reporterUserIds: [],
          gameIds,
        });
        if (input.targetKind === "review") {
          const rev = (
            await client.query<{
              id: string;
              resource_version: number;
              lifecycle: string;
              projection_hash: string;
              slot_id: string;
            }>(`SELECT * FROM role_review_revisions WHERE id=$1`, [input.exactRevisionId])
          ).rows[0];
          if (!rev || rev.slot_id !== slot.id) {
            throw notFound("REVISION_UNAVAILABLE", "Редакция недоступна");
          }
          if (rev.resource_version !== input.expectedResourceVersion) {
            throw conflict("VERSION_CONFLICT", "Версия редакции устарела");
          }
          if (slot.status === "withdrawn" && input.decision === "approve") {
            throw unprocessableWithdrawn();
          }
          if (input.decision === "approve") {
            if (slot.pending_revision_id !== rev.id && slot.approved_revision_id !== rev.id) {
              throw conflict("REVISION_NOT_CURRENT", "Редакция не является текущей ожидающей");
            }
            await client.query(
              `UPDATE role_review_slots
               SET status='published',
                   approved_revision_id=$2,
                   pending_revision_id=NULL,
                   version=version+1,
                   updated_at=clock_timestamp()
               WHERE id=$1`,
              [slot.id, rev.id],
            );
          } else if (input.decision === "remove") {
            await client.query(
              `UPDATE role_review_slots
               SET status='removed', version=version+1, updated_at=clock_timestamp()
               WHERE id=$1`,
              [slot.id],
            );
          } else if (input.decision === "restore") {
            if (slot.status !== "removed" || !slot.approved_revision_id) {
              throw conflict("RESTORE_DENIED", "Восстановление недоступно");
            }
            await client.query(
              `UPDATE role_review_slots
               SET status='published', version=version+1, updated_at=clock_timestamp()
               WHERE id=$1`,
              [slot.id],
            );
          } else if (input.decision === "request_correction") {
            await client.query(
              `UPDATE role_review_slots
               SET status='needs_correction', version=version+1, updated_at=clock_timestamp()
               WHERE id=$1`,
              [slot.id],
            );
          } else if (input.decision === "retain") {
            // keep published visible after report
            await client.query(
              `UPDATE role_review_slots
               SET version=version+1, updated_at=clock_timestamp()
               WHERE id=$1`,
              [slot.id],
            );
          }
        } else {
          const rev = (
            await client.query<{
              id: string;
              resource_version: number;
              slot_id: string;
            }>(`SELECT * FROM role_review_reply_revisions WHERE id=$1`, [input.exactRevisionId])
          ).rows[0];
          if (!rev || rev.slot_id !== slot.id) {
            throw notFound("REVISION_UNAVAILABLE", "Редакция недоступна");
          }
          if (rev.resource_version !== input.expectedResourceVersion) {
            throw conflict("VERSION_CONFLICT", "Версия редакции устарела");
          }
          if (input.decision === "approve") {
            await client.query(
              `UPDATE role_review_replies
               SET status='published',
                   approved_revision_id=$2,
                   pending_revision_id=NULL,
                   version=version+1,
                   updated_at=clock_timestamp()
               WHERE slot_id=$1`,
              [slot.id, rev.id],
            );
          } else if (input.decision === "remove") {
            await client.query(
              `UPDATE role_review_replies
               SET status='removed', version=version+1, updated_at=clock_timestamp()
               WHERE slot_id=$1`,
              [slot.id],
            );
          } else if (input.decision === "restore") {
            await client.query(
              `UPDATE role_review_replies
               SET status='published', version=version+1, updated_at=clock_timestamp()
               WHERE slot_id=$1`,
              [slot.id],
            );
          } else if (input.decision === "request_correction") {
            await client.query(
              `UPDATE role_review_replies
               SET status='needs_correction', version=version+1, updated_at=clock_timestamp()
               WHERE slot_id=$1`,
              [slot.id],
            );
          }
        }
        await client.query(
          `INSERT INTO role_reputation_decisions
             (case_id, slot_id, decision, target_kind, exact_revision_id,
              expected_case_version, expected_resource_version, rationale, actor_principal_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            caseId,
            slot.id,
            input.decision,
            input.targetKind,
            input.exactRevisionId,
            input.expectedCaseVersion,
            input.expectedResourceVersion,
            input.rationale,
            actor.principalId,
          ],
        );
        const nextCaseVersion = caze.version + 1;
        await client.query(
          `UPDATE support_cases SET version=$2, updated_at=clock_timestamp() WHERE id=$1`,
          [caseId, nextCaseVersion],
        );
        const auditId = await appendAudit(client, {
          actor,
          action: "admin.role_reputation.decide",
          targetType: "case",
          targetId: caseId,
          permission: "case.manage",
          reason: input.reasonCode,
          after: { decision: input.decision, targetKind: input.targetKind },
          keyHash,
        });
        await client.query(
          `INSERT INTO support_case_actions(case_id, case_version, audit_id, action)
           VALUES ($1,$2,$3,'note')`,
          [caseId, nextCaseVersion, auditId],
        );
        return {
          caseId,
          caseVersion: nextCaseVersion,
          decision: input.decision,
          auditId,
        };
      },
      async (client, actor) => {
        await this.requireInstalled(client);
        await this.scopedCase(client, actor, caseId);
      },
    );
  }

  async resolveBasis(
    request: FastifyRequest,
    caseId: string,
    key: string | undefined,
    input: RoleBasisResolve,
  ) {
    this.enabled();
    return this.admin.privilegedCommand(
      request,
      key,
      "user.lookup",
      true,
      "role_reputation.basis_resolve",
      { caseId, ...input },
      async (client, actor, keyHash) => {
        await this.requireInstalled(client);
        const caze = await this.scopedCase(client, actor, caseId);
        if (caze.version !== input.expectedCaseVersion) {
          throw conflict("VERSION_CONFLICT", "Версия обращения устарела");
        }
        if (caze.assigned_to !== actor.principalId) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
        }
        const tip = (
          await client.query<{
            version: number;
            subject_user_id: string;
            open_dispute: boolean;
          }>(
            `SELECT version, subject_user_id, open_dispute
             FROM game_role_proofs WHERE game_id=$1 AND role=$2 FOR UPDATE`,
            [input.gameId, input.role],
          )
        ).rows[0];
        if (!tip || tip.version !== input.expectedProofVersion) {
          throw conflict("VERSION_CONFLICT", "Версия основания устарела");
        }
        await this.assertIndependent(client, actor, {
          authorUserId: "00000000-0000-4000-8000-000000000000",
          subjectUserId: input.subjectUserId,
          reporterUserIds: [],
          gameIds: [input.gameId],
        });
        const nextVersion = tip.version + 1;
        const rev = (
          await client.query<{ id: string }>(
            `INSERT INTO game_role_proof_revisions
               (game_id, role, resource_version, subject_user_id, phase, binding_kind,
                provenance_source, accepted_for_count, actor_principal_id, rationale)
             VALUES ($1,$2,$3,$4,'corrected','case_correction','case_reviewer',$5,$6,$7)
             RETURNING id`,
            [
              input.gameId,
              input.role,
              nextVersion,
              input.subjectUserId,
              input.acceptedForCount,
              actor.principalId,
              input.rationale,
            ],
          )
        ).rows[0]!;
        await client.query(
          `UPDATE game_role_proofs
           SET version=$3,
               subject_user_id=$4,
               phase='performed',
               accepted_for_count=$5,
               open_dispute=false,
               latest_revision_id=$6,
               updated_at=clock_timestamp()
           WHERE game_id=$1 AND role=$2`,
          [
            input.gameId,
            input.role,
            nextVersion,
            input.subjectUserId,
            input.acceptedForCount,
            rev.id,
          ],
        );
        await client.query(
          `INSERT INTO role_reputation_decisions
             (case_id, slot_id, decision, target_kind, exact_revision_id,
              expected_case_version, expected_resource_version, rationale, actor_principal_id)
           SELECT $1, slot_id, $2, $3, NULL, $4, $5, $6, $7
           FROM role_reputation_case_links WHERE case_id=$1`,
          [
            caseId,
            input.decision,
            input.decision === "resolve_held" ? "held_basis" : "role_basis",
            input.expectedCaseVersion,
            input.expectedProofVersion,
            input.rationale,
            actor.principalId,
          ],
        );
        const nextCaseVersion = caze.version + 1;
        await client.query(
          `UPDATE support_cases SET version=$2, updated_at=clock_timestamp() WHERE id=$1`,
          [caseId, nextCaseVersion],
        );
        const auditId = await appendAudit(client, {
          actor,
          action: "admin.role_reputation.basis_resolve",
          targetType: "case",
          targetId: caseId,
          permission: "case.manage",
          reason: input.reasonCode,
          after: {
            gameId: input.gameId,
            role: input.role,
            subjectUserId: input.subjectUserId,
            acceptedForCount: input.acceptedForCount,
          },
          keyHash,
        });
        return { caseId, caseVersion: nextCaseVersion, proofVersion: nextVersion, auditId };
      },
      async (client, actor) => {
        await this.requireInstalled(client);
        await this.scopedCase(client, actor, caseId);
      },
    );
  }
}

function unprocessableWithdrawn(): never {
  throw conflict("WITHDRAWN_NOT_APPROVABLE", "Отозванный отзыв нельзя опубликовать");
}
