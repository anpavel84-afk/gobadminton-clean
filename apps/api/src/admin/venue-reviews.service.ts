import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { conflict, forbidden, notFound, serviceUnavailable } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { VenueReviewsService } from "../venues/venue-reviews.service";
import { APP_ENV } from "../tokens";
import { appendAudit, type AuditActor } from "./admin-db";
import { AdminService } from "./admin.service";
import { hasPermission, type AdminRole } from "./rbac";
import { type VenueReviewDecide, type VenueReviewIntake } from "./venue-reviews.dto";

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
  receipt_token: string;
  status: string;
  case_id: string | null;
  submitted_by_user_id: string;
  canonical_venue_id: string;
  version: number;
  created_at: Date;
  prior_decision_id: string | null;
};

type SlotRow = {
  id: string;
  author_user_id: string;
  canonical_venue_id: string;
  status: string;
  version: number;
  approved_revision_id: string | null;
  pending_revision_id: string | null;
  public_handle: string;
  first_eligible_at?: Date | null;
};

const manages = (actor: AuditActor) => hasPermission(actor.roles as AdminRole[], "case.manage");
const canReadAssignedEvidence = (actor: AuditActor) =>
  hasPermission(actor.roles as AdminRole[], "evidence.assigned.read");

@Injectable()
export class AdminVenueReviewsService {
  constructor(
    private readonly admin: AdminService,
    private readonly consumer: VenueReviewsService,
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
      !(await client.query("SELECT to_regclass('venue_review_pending_intakes') AS name")).rows[0]
        ?.name
    ) {
      throw serviceUnavailable("VENUE_REVIEWS_UNAVAILABLE", "Отзывы о площадке недоступны");
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

  private async loadBoundLink(client: PoolClient, caseId: string) {
    const link = (
      await client.query<{ slot_id: string; pending_intake_id: string }>(
        `SELECT slot_id, pending_intake_id FROM venue_review_case_links WHERE case_id=$1`,
        [caseId],
      )
    ).rows[0];
    if (!link) throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
    const pending = (
      await client.query<PendingRow>(
        `SELECT * FROM venue_review_pending_intakes WHERE id=$1`,
        [link.pending_intake_id],
      )
    ).rows[0];
    if (!pending || pending.slot_id !== link.slot_id) {
      throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
    }
    return { ...link, pending };
  }

  private async gameIdsForSlot(client: PoolClient, slotId: string): Promise<string[]> {
    return (
      await client.query<{ game_id: string }>(
        `SELECT DISTINCT game_id FROM venue_review_revisions WHERE slot_id=$1
         UNION
         SELECT game_id FROM venue_review_event_fences WHERE slot_id=$1`,
        [slotId],
      )
    ).rows.map((r) => r.game_id);
  }

  private async assertIndependent(
    client: PoolClient,
    actor: AuditActor,
    affected: {
      authorUserId: string;
      reporterUserIds: string[];
      gameIds: string[];
      venueId: string;
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
    const banned = new Set([affected.authorUserId, ...affected.reporterUserIds]);
    if (banned.has(reviewerUserId)) {
      throw forbidden("REVIEWER_SUBJECT_CONFLICT", "Проверяющий не может быть стороной обращения");
    }
    if (affected.excludePrincipalIds?.includes(actor.principalId)) {
      throw forbidden("REVIEWER_APPEAL_CONFLICT", "Исходный проверяющий исключён из апелляции");
    }
    if (
      (
        await client.query(
          `SELECT 1 FROM venues WHERE id=$1 AND created_by_user_id=$2 LIMIT 1`,
          [affected.venueId, reviewerUserId],
        )
      ).rows[0]
    ) {
      throw forbidden("REVIEWER_VENUE_CONFLICT", "Связанный с площадкой проверяющий исключён");
    }
    // Historic venue staff/admin actions — fail closed when affiliation proof exists.
    if (
      (
        await client.query(
          `SELECT 1
           FROM venue_admin_actions a
           JOIN admin_principals p ON p.id = a.actor_id
           WHERE a.venue_id = $1 AND p.user_id = $2
           LIMIT 1`,
          [affected.venueId, reviewerUserId],
        )
      ).rows[0]
    ) {
      throw forbidden("REVIEWER_VENUE_CONFLICT", "Связанный с площадкой проверяющий исключён");
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
      // Any historic manager seat (active or revoked) is a conflict — not only current active.
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
    }
    return reviewerUserId;
  }

  private async independenceForBound(
    client: PoolClient,
    slot: SlotRow,
    pending: PendingRow,
    gameIds: string[],
  ) {
    const reporterUserIds = new Set<string>([pending.submitted_by_user_id]);
    if (pending.kind === "report") {
      const reporters = (
        await client.query<{ reporter_user_id: string }>(
          `SELECT reporter_user_id FROM venue_review_reports WHERE pending_intake_id=$1`,
          [pending.id],
        )
      ).rows;
      for (const r of reporters) reporterUserIds.add(r.reporter_user_id);
    }
    let excludePrincipalIds: string[] | undefined;
    if (pending.prior_decision_id) {
      const prior = (
        await client.query<{ actor_principal_id: string }>(
          `SELECT actor_principal_id FROM venue_review_decisions WHERE id=$1`,
          [pending.prior_decision_id],
        )
      ).rows[0];
      if (prior) excludePrincipalIds = [prior.actor_principal_id];
    }
    return {
      authorUserId: slot.author_user_id,
      reporterUserIds: [...reporterUserIds],
      gameIds,
      venueId: slot.canonical_venue_id,
      excludePrincipalIds,
    };
  }

  async listPending(request: FastifyRequest, page: { beforeId?: string; limit: number }) {
    this.enabled();
    return this.admin.privilegedRead(request, "user.lookup", async (client, actor) => {
      await this.requireInstalled(client);
      if (!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
      const rows = (
        await client.query<PendingRow>(
          `SELECT id, kind, slot_id, receipt_token, status, case_id,
                  submitted_by_user_id, canonical_venue_id, version, created_at,
                  revision_id, prior_decision_id
           FROM venue_review_pending_intakes
           WHERE status = 'waiting_intake'
             AND ($1::uuid IS NULL OR id < $1)
           ORDER BY id DESC
           LIMIT $2`,
          [page.beforeId ?? null, page.limit + 1],
        )
      ).rows;
      await appendAudit(client, {
        actor,
        action: "admin.venue_reviews.pending_read",
        targetType: "venue_review_pending",
        targetId: "bounded_queue",
        permission: "case.manage",
        reason: "operations_read",
      });
      return {
        items: rows.slice(0, page.limit).map((r) => ({
          pendingIntakeId: r.id,
          kind: r.kind,
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

  async intake(request: FastifyRequest, key: string | undefined, input: VenueReviewIntake) {
    this.enabled();
    if (!this.env.POST_GAME_INTERNAL_ENABLED) {
      throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись недоступна");
    }
    return this.admin.privilegedCommand(
      request,
      key,
      "user.lookup",
      true,
      "venue_review.intake",
      input,
      async (client, actor, keyHash) => {
        await this.requireInstalled(client);
        if (!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
        const pending = (
          await client.query<PendingRow>(
            `SELECT * FROM venue_review_pending_intakes WHERE id=$1 FOR UPDATE`,
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
            `SELECT * FROM venue_review_slots WHERE id=$1 FOR UPDATE`,
            [pending.slot_id],
          )
        ).rows[0];
        if (!slot) throw notFound("PENDING_UNAVAILABLE", "Ожидание недоступно");
        const gameIds = await this.gameIdsForSlot(client, slot.id);
        await this.assertIndependent(
          client,
          actor,
          await this.independenceForBound(client, slot, pending, gameIds),
        );
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
          `INSERT INTO venue_review_case_links
             (case_id, pending_intake_id, slot_id, created_by_principal_id)
           VALUES ($1,$2,$3,$4)`,
          [created.id, pending.id, slot.id, actor.principalId],
        );
        await client.query(
          `UPDATE venue_review_pending_intakes
           SET status='linked', case_id=$2, version=version+1, updated_at=clock_timestamp()
           WHERE id=$1`,
          [pending.id, created.id],
        );
        const auditId = await appendAudit(client, {
          actor,
          action: "admin.venue_reviews.intake",
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
    return this.admin.privilegedRead(request, "user.lookup", async (client, actor) => {
      await this.requireInstalled(client);
      const caze = await this.scopedCase(client, actor, caseId);
      if (caze.assigned_to !== actor.principalId) {
        throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
      }
      if (!canReadAssignedEvidence(actor)) {
        throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
      }
      const bound = await this.loadBoundLink(client, caseId);
      const slot = (
        await client.query<SlotRow>(`SELECT * FROM venue_review_slots WHERE id=$1`, [bound.slot_id])
      ).rows[0];
      if (!slot) throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
      const pending = bound.pending;
      const gameIds = await this.gameIdsForSlot(client, slot.id);
      await this.assertIndependent(
        client,
        actor,
        await this.independenceForBound(client, slot, pending, gameIds),
      );
      const revision = pending.revision_id
        ? (
            await client.query<{
              id: string;
              resource_version: number;
              body_text: string;
              topics: string[];
              projection_hash: string | null;
              lifecycle: string;
              game_id: string;
              slot_id: string;
              audience: string;
            }>(`SELECT * FROM venue_review_revisions WHERE id=$1`, [pending.revision_id])
          ).rows[0]
        : null;
      if (revision && revision.slot_id !== slot.id) {
        throw notFound("REVISION_UNAVAILABLE", "Редакция недоступна");
      }
      await appendAudit(client, {
        actor,
        action: "admin.venue_reviews.source_read",
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
          venueId: slot.canonical_venue_id,
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
              audience: revision.audience,
              gameId: revision.game_id,
            }
          : null,
      };
    }, true);
  }

  async decide(request: FastifyRequest, caseId: string, key: string | undefined, input: VenueReviewDecide) {
    this.enabled();
    if (!this.env.POST_GAME_INTERNAL_ENABLED) {
      throw serviceUnavailable("POST_GAME_WRITES_UNAVAILABLE", "Запись недоступна");
    }
    return this.admin.privilegedCommand(
      request,
      key,
      "user.lookup",
      true,
      "venue_review.decide",
      { caseId, ...input },
      async (client, actor, keyHash) => {
        await this.requireInstalled(client);
        const caze = await this.scopedCase(client, actor, caseId);
        if (caze.assigned_to !== actor.principalId) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
        }
        if (!canReadAssignedEvidence(actor)) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
        }
        if (caze.version !== input.expectedCaseVersion) {
          throw conflict("CASE_VERSION_CONFLICT", "Обращение уже изменено");
        }
        const bound = await this.loadBoundLink(client, caseId);
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM venue_review_slots WHERE id=$1 FOR UPDATE`,
            [bound.slot_id],
          )
        ).rows[0];
        if (!slot) throw notFound("CASE_UNAVAILABLE", "Обращение недоступно");
        const pending = bound.pending;
        if (pending.revision_id !== input.exactRevisionId) {
          throw notFound("REVISION_UNAVAILABLE", "Редакция недоступна");
        }
        const rev = (
          await client.query<{ resource_version: number }>(
            `SELECT resource_version FROM venue_review_revisions WHERE id=$1`,
            [input.exactRevisionId],
          )
        ).rows[0];
        if (!rev || rev.resource_version !== input.expectedResourceVersion) {
          throw conflict("VERSION_CONFLICT", "Версия редакции устарела");
        }
        const gameIds = await this.gameIdsForSlot(client, slot.id);
        await this.assertIndependent(
          client,
          actor,
          await this.independenceForBound(client, slot, pending, gameIds),
        );
        let notBefore: Date | null = null;
        if (input.decision === "approve") {
          const result = await this.consumer.applyApprove(client, slot, input.exactRevisionId);
          notBefore = result.notBefore;
        } else if (input.decision === "request_correction") {
          await this.consumer.applyRequestCorrection(client, slot.id);
        } else if (input.decision === "remove") {
          await this.consumer.applyRemove(client, slot.id);
        } else if (input.decision === "restore") {
          await this.consumer.applyRestore(client, slot);
        }
        // retain: no slot mutation
        await client.query(
          `INSERT INTO venue_review_decisions
             (case_id, slot_id, decision, exact_revision_id, expected_case_version,
              expected_resource_version, rationale, actor_principal_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            caseId,
            slot.id,
            input.decision,
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
          action: "admin.venue_reviews.decide",
          targetType: "case",
          targetId: caseId,
          permission: "case.manage",
          reason: input.reasonCode,
          after: { decision: input.decision, revisionId: input.exactRevisionId, notBefore },
          keyHash,
        });
        await client.query(
          `INSERT INTO support_case_actions(case_id, case_version, audit_id, action, note_code)
           VALUES ($1, $2, $3, 'note', 'resolution_recorded')`,
          [caseId, nextCaseVersion, auditId],
        );
        return {
          caseId,
          caseVersion: nextCaseVersion,
          decision: input.decision,
          auditId,
          notBefore: notBefore?.toISOString() ?? null,
        };
      },
      async (client, actor) => {
        await this.requireInstalled(client);
        const caze = await this.scopedCase(client, actor, caseId);
        if (caze.assigned_to !== actor.principalId) {
          throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
        }
      },
    );
  }

  async caseHint(client: PoolClient, caseId: string) {
    if (!(await client.query("SELECT to_regclass('venue_review_case_links') AS name")).rows[0]?.name) {
      return null;
    }
    const hint = (
      await client.query<{
        kind: string;
        slot_status: string;
        intake_status: string;
      }>(
        `SELECT p.kind, s.status AS slot_status, p.status AS intake_status
         FROM venue_review_case_links l
         JOIN venue_review_pending_intakes p ON p.id=l.pending_intake_id
         JOIN venue_review_slots s ON s.id=l.slot_id
         WHERE l.case_id=$1`,
        [caseId],
      )
    ).rows[0];
    if (!hint) return null;
    return {
      pendingKind: hint.kind,
      slotStatus: hint.slot_status,
      intakeStatus: hint.intake_status,
    };
  }
}
