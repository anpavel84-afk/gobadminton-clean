import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict, forbidden, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import {
  isPermittedPresentAssertion,
  type AttendanceSource,
  type AttendanceValue,
} from "./game-attendance.policy";
import {
  consentPreviewRequest,
  createRoleReviewRequest,
  roleReplyCommandRequest,
  roleReviewCommandRequest,
  roleReviewReportRequest,
  type OwnEligibilityDto,
  type OwnRoleReviewDto,
  type PublicRoleReviewItemDto,
  type RoleReputationSummaryDto,
  type RoleReviewMutationReceiptDto,
} from "./role-reputation.dto";
import {
  countsTowardHeldGames,
  decodePublicCursor,
  evaluateWriteAdmission,
  opaqueHandle,
  parseOrThrow,
  participationEligible,
  postGameWritesEnabled,
  projectionHash,
  publicAuthorLabel,
  redactPublicCursor,
  topicsAllowedForRole,
  unavailable,
  writesUnavailable,
  type RoleKind,
} from "./role-reputation.policy";

type SubjectRow = {
  id: string;
  subject_user_id: string;
  role: RoleKind;
  public_handle: string;
  version: number;
};

type ProofTip = {
  game_id: string;
  role: RoleKind;
  version: number;
  subject_user_id: string;
  phase: "planned" | "performed" | "disputed" | "cleared";
  accepted_for_count: boolean;
  open_dispute: boolean;
};

type SlotRow = {
  id: string;
  author_user_id: string;
  subject_user_id: string;
  role: RoleKind;
  public_handle: string;
  status: string;
  version: number;
  approved_revision_id: string | null;
  pending_revision_id: string | null;
  basis_under_review: boolean;
};

@Injectable()
export class RoleReputationService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async installed(client: PoolClient | Pool): Promise<boolean> {
    return Boolean(
      (await client.query("SELECT to_regclass('role_reputation_subjects') AS name")).rows[0]?.name,
    );
  }

  private async displayName(client: PoolClient | Pool, userId: string): Promise<string | null> {
    const row = (
      await client.query<{ display_name: string | null }>(
        `SELECT display_name FROM player_social_profiles WHERE user_id = $1`,
        [userId],
      )
    ).rows[0];
    return row?.display_name ?? null;
  }

  private async ensureSubject(
    client: PoolClient,
    subjectUserId: string,
    role: RoleKind,
  ): Promise<SubjectRow> {
    const existing = (
      await client.query<SubjectRow>(
        `SELECT * FROM role_reputation_subjects
         WHERE subject_user_id = $1 AND role = $2 FOR UPDATE`,
        [subjectUserId, role],
      )
    ).rows[0];
    if (existing) return existing;
    const handle = opaqueHandle();
    return (
      await client.query<SubjectRow>(
        `INSERT INTO role_reputation_subjects
           (subject_user_id, role, public_handle, version)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (subject_user_id, role) DO UPDATE
           SET updated_at = clock_timestamp()
         RETURNING *`,
        [subjectUserId, role, handle],
      )
    ).rows[0]!;
  }

  private async appendProof(
    client: PoolClient,
    args: {
      gameId: string;
      role: RoleKind;
      subjectUserId: string;
      phase: ProofTip["phase"] | "corrected";
      bindingKind: string;
      provenanceSource: string;
      acceptedForCount: boolean;
      openDispute: boolean;
      actorUserId: string | null;
      actorPrincipalId?: string | null;
      gameVersion?: number | null;
      outcomeVersion?: number | null;
      rationale?: string | null;
    },
  ): Promise<ProofTip> {
    const tip = (
      await client.query<ProofTip>(
        `SELECT * FROM game_role_proofs WHERE game_id = $1 AND role = $2 FOR UPDATE`,
        [args.gameId, args.role],
      )
    ).rows[0];
    const nextVersion = (tip?.version ?? 0) + 1;
    const tipPhase =
      args.phase === "corrected" ? "performed" : (args.phase as ProofTip["phase"]);
    const rev = (
      await client.query<{ id: string }>(
        `INSERT INTO game_role_proof_revisions
           (game_id, role, resource_version, subject_user_id, phase, binding_kind,
            provenance_source, accepted_for_count, actor_user_id, actor_principal_id,
            game_version, outcome_version, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          args.gameId,
          args.role,
          nextVersion,
          args.subjectUserId,
          args.phase,
          args.bindingKind,
          args.provenanceSource,
          args.acceptedForCount,
          args.actorUserId,
          args.actorPrincipalId ?? null,
          args.gameVersion ?? null,
          args.outcomeVersion ?? null,
          args.rationale ?? null,
        ],
      )
    ).rows[0]!;
    if (!tip) {
      await client.query(
        `INSERT INTO game_role_proofs
           (game_id, role, version, subject_user_id, phase, accepted_for_count,
            open_dispute, latest_revision_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp())`,
        [
          args.gameId,
          args.role,
          nextVersion,
          args.subjectUserId,
          tipPhase,
          args.acceptedForCount,
          args.openDispute,
          rev.id,
        ],
      );
    } else {
      await client.query(
        `UPDATE game_role_proofs
         SET version = $3,
             subject_user_id = $4,
             phase = $5,
             accepted_for_count = $6,
             open_dispute = $7,
             latest_revision_id = $8,
             updated_at = clock_timestamp()
         WHERE game_id = $1 AND role = $2`,
        [
          args.gameId,
          args.role,
          nextVersion,
          args.subjectUserId,
          tipPhase,
          args.acceptedForCount,
          args.openDispute,
          rev.id,
        ],
      );
    }
    await this.ensureSubject(client, args.subjectUserId, args.role);
    return (
      await client.query<ProofTip>(
        `SELECT * FROM game_role_proofs WHERE game_id = $1 AND role = $2`,
        [args.gameId, args.role],
      )
    ).rows[0]!;
  }

  /** Called under game lock at publish: freeze intended role identities. */
  async freezeRolesAtPublish(
    client: PoolClient,
    args: {
      gameId: string;
      gameVersion: number;
      activityKind: "regular" | "trainer_led";
      actorUserId: string;
      organizerUserId: string;
      trainerUserId: string | null;
    },
  ): Promise<void> {
    if (!(await this.installed(client))) return;
    await this.appendProof(client, {
      gameId: args.gameId,
      role: "organization",
      subjectUserId: args.organizerUserId,
      phase: "planned",
      bindingKind: "publish_freeze",
      provenanceSource: "publish_manager",
      acceptedForCount: false,
      openDispute: false,
      actorUserId: args.actorUserId,
      gameVersion: args.gameVersion,
    });
    if (args.activityKind === "trainer_led" && args.trainerUserId) {
      await this.appendProof(client, {
        gameId: args.gameId,
        role: "training",
        subjectUserId: args.trainerUserId,
        phase: "planned",
        bindingKind: "publish_freeze",
        provenanceSource: "publish_manager",
        acceptedForCount: false,
        openDispute: false,
        actorUserId: args.actorUserId,
        gameVersion: args.gameVersion,
      });
    }
  }

  /** Called under game lock when outcome becomes held via authorized endgame command. */
  async confirmRolesAtHeld(
    client: PoolClient,
    args: {
      gameId: string;
      outcomeVersion: number;
      actorUserId: string;
      source: "manager_explicit" | "case_reviewer";
    },
  ): Promise<void> {
    if (!(await this.installed(client))) return;
    for (const role of ["organization", "training"] as const) {
      const tip = (
        await client.query<ProofTip>(
          `SELECT * FROM game_role_proofs WHERE game_id = $1 AND role = $2 FOR UPDATE`,
          [args.gameId, role],
        )
      ).rows[0];
      if (!tip) continue; // honest missing_history for old events — no current-manager backfill
      if (tip.phase === "performed" && tip.accepted_for_count && !tip.open_dispute) continue;
      if (tip.phase === "cleared") continue;
      await this.appendProof(client, {
        gameId: args.gameId,
        role,
        subjectUserId: tip.subject_user_id,
        phase: "performed",
        bindingKind: "held_confirm",
        provenanceSource: args.source,
        acceptedForCount: !tip.open_dispute,
        openDispute: tip.open_dispute,
        actorUserId: args.actorUserId,
        outcomeVersion: args.outcomeVersion,
      });
    }
  }

  async heldGamesCount(client: PoolClient | Pool, subjectUserId: string): Promise<number> {
    if (!(await this.installed(client))) return 0;
    const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    const rows = await client.query<{
      ends_at: Date;
      status: "draft" | "published" | "cancelled" | "completed";
      outcome: "held" | "not_held" | null;
      accepted_for_count: boolean;
      phase: ProofTip["phase"];
      open_dispute: boolean;
    }>(
      `SELECT g.ends_at, g.status, o.value AS outcome,
              p.accepted_for_count, p.phase, p.open_dispute
       FROM game_role_proofs p
       JOIN games g ON g.id = p.game_id
       LEFT JOIN game_outcomes o ON o.game_id = g.id
       WHERE p.subject_user_id = $1
         AND p.role = 'organization'
         AND p.accepted_for_count = true
         AND p.open_dispute = false
         AND p.phase = 'performed'`,
      [subjectUserId],
    );
    let count = 0;
    for (const row of rows.rows) {
      if (
        countsTowardHeldGames({
          endsAt: row.ends_at,
          now,
          lifecycle: row.status,
          outcome: row.outcome,
          proofAccepted: row.accepted_for_count,
          proofPhase: row.phase,
          openRoleOrHeldDispute: row.open_dispute,
        })
      ) {
        count += 1;
      }
    }
    return count;
  }

  private async viewerBlocked(
    client: PoolClient | Pool,
    viewerId: string | null,
    subjectUserId: string,
  ): Promise<boolean> {
    if (!viewerId || viewerId === subjectUserId) return false;
    return Boolean(
      (
        await client.query(
          `SELECT 1 FROM user_blocks
           WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
              OR (blocker_user_id = $2 AND blocked_user_id = $1)
           LIMIT 1`,
          [viewerId, subjectUserId],
        )
      ).rows[0],
    );
  }

  private async profileSurfaceOpen(
    client: PoolClient | Pool,
    viewerId: string | null,
    subjectUserId: string,
  ): Promise<boolean> {
    const row = (
      await client.query<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM player_social_profiles p
           JOIN users u ON u.id = p.user_id
           WHERE p.user_id = $1
             AND p.directory_visible = true
             AND p.social_eligible = true
             AND u.status = 'active'
         ) AS ok`,
        [subjectUserId],
      )
    ).rows[0];
    if (!row?.ok) return false;
    if (await this.viewerBlocked(client, viewerId, subjectUserId)) return false;
    return true;
  }

  private async gameSurfaceOpen(
    client: PoolClient | Pool,
    viewerId: string | null,
    gameId: string,
    role: RoleKind,
  ): Promise<{ open: boolean; subjectUserId: string | null }> {
    const game = (
      await client.query<{
        status: string;
        visibility: string;
        subject_user_id: string | null;
      }>(
        `SELECT g.status, g.visibility, p.subject_user_id
         FROM games g
         LEFT JOIN game_role_proofs p ON p.game_id = g.id AND p.role = $2
         WHERE g.id = $1`,
        [gameId, role],
      )
    ).rows[0];
    if (!game) return { open: false, subjectUserId: null };
    if (game.status !== "published" && game.status !== "completed") {
      return { open: false, subjectUserId: game.subject_user_id };
    }
    if (game.visibility === "public") {
      if (game.subject_user_id && (await this.viewerBlocked(client, viewerId, game.subject_user_id))) {
        return { open: false, subjectUserId: game.subject_user_id };
      }
      return { open: true, subjectUserId: game.subject_user_id };
    }
    // Unlisted/private: only managers/participants may see game-role projection.
    if (!viewerId) return { open: false, subjectUserId: game.subject_user_id };
    const member = (
      await client.query(
        `SELECT 1 WHERE EXISTS (
           SELECT 1 FROM game_managers
           WHERE game_id = $1 AND user_id = $2 AND status = 'active'
         ) OR EXISTS (
           SELECT 1 FROM participations
           WHERE game_id = $1 AND user_id = $2
             AND status IN ('confirmed', 'withdrawn', 'removed')
         )`,
        [gameId, viewerId],
      )
    ).rows[0];
    return { open: Boolean(member), subjectUserId: game.subject_user_id };
  }

  private async projectItems(
    client: PoolClient | Pool,
    args: {
      subjectUserId: string;
      role: RoleKind;
      viewerId: string | null;
      cursor: string | undefined;
      limit: number;
    },
  ): Promise<{ items: PublicRoleReviewItemDto[]; nextCursor: string | null }> {
    const decoded = decodePublicCursor(args.cursor);
    const rows = await client.query<{
      public_handle: string;
      role: RoleKind;
      body_text: string;
      topics: string[];
      basis_under_review: boolean;
      updated_at: Date;
      approved_revision_id: string | null;
      reply_text: string | null;
      reply_status: string | null;
      subject_user_id: string;
      author_user_id: string;
    }>(
      `SELECT s.public_handle, s.role, r.body_text, r.topics, s.basis_under_review,
              s.updated_at, s.approved_revision_id, s.subject_user_id, s.author_user_id,
              rr.body_text AS reply_text, rp.status AS reply_status
       FROM role_review_slots s
       JOIN role_review_revisions r ON r.id = s.approved_revision_id
       LEFT JOIN role_review_replies rp ON rp.slot_id = s.id
       LEFT JOIN role_review_reply_revisions rr ON rr.id = rp.approved_revision_id
       WHERE s.subject_user_id = $1
         AND s.role = $2
         AND s.status = 'published'
         AND s.approved_revision_id IS NOT NULL
         AND ($3::timestamptz IS NULL OR (s.updated_at, s.public_handle) < ($3::timestamptz, $4))
       ORDER BY s.updated_at DESC, s.public_handle DESC
       LIMIT $5`,
      [
        args.subjectUserId,
        args.role,
        decoded ? new Date(decoded.u) : null,
        decoded?.h ?? null,
        args.limit + 1,
      ],
    );
    const slice = rows.rows.slice(0, args.limit);
    const items: PublicRoleReviewItemDto[] = slice.map((row) => ({
      reviewHandle: row.public_handle,
      role: row.role,
      text: row.body_text,
      topics: row.topics ?? [],
      authorLabel: publicAuthorLabel(row.role),
      experienceState: row.basis_under_review ? "basis_under_review" : "published",
      reply:
        row.reply_status === "published" && row.reply_text
          ? { text: row.reply_text, experienceState: "published" }
          : null,
      allowedActions: {
        canReport: Boolean(args.viewerId),
        canReply: args.viewerId === row.subject_user_id,
      },
    }));
    const last = slice[slice.length - 1];
    return {
      items,
      nextCursor:
        rows.rows.length > args.limit && last
          ? redactPublicCursor({ u: last.updated_at.toISOString(), h: last.public_handle })
          : null,
    };
  }

  private async summaryForSubject(
    client: PoolClient | Pool,
    args: {
      subject: SubjectRow;
      viewerId: string | null;
      cursor?: string;
      limit?: number;
      includeDisplayName: boolean;
      surfaceOpen: boolean;
    },
  ): Promise<RoleReputationSummaryDto> {
    if (!args.surfaceOpen) {
      return {
        roleHandle: args.subject.public_handle,
        role: args.subject.role,
        subjectDisplayName: null,
        heldGamesCount: null,
        countScope: "confirmed_history",
        historyMayBeIncomplete: true,
        publishedReviewCount: 0,
        projectionVersion: "unavailable",
        items: [],
        nextCursor: null,
        availability: "unavailable",
      };
    }
    const limit = Math.min(
      Math.max(args.limit ?? 20, 1),
      50,
    );
    const page = await this.projectItems(client, {
      subjectUserId: args.subject.subject_user_id,
      role: args.subject.role,
      viewerId: args.viewerId,
      cursor: args.cursor,
      limit,
    });
    const publishedReviewCount = (
      await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM role_review_slots
         WHERE subject_user_id = $1 AND role = $2 AND status = 'published'
           AND approved_revision_id IS NOT NULL`,
        [args.subject.subject_user_id, args.subject.role],
      )
    ).rows[0]!.n;
    const held =
      args.subject.role === "organization"
        ? await this.heldGamesCount(client, args.subject.subject_user_id)
        : null;
    const display = args.includeDisplayName
      ? await this.displayName(client, args.subject.subject_user_id)
      : null;
    const projectionVersion = createProjectionVersion(
      args.subject.public_handle,
      publishedReviewCount,
      held,
      page.items.length,
    );
    return {
      roleHandle: args.subject.public_handle,
      role: args.subject.role,
      subjectDisplayName: display,
      heldGamesCount: held,
      countScope: "confirmed_history",
      historyMayBeIncomplete: true,
      publishedReviewCount: Number(publishedReviewCount),
      projectionVersion,
      items: page.items,
      nextCursor: page.nextCursor,
      availability: "available",
    };
  }

  async getByRoleHandle(
    viewerId: string | null,
    roleHandle: string,
    query: { cursor?: string; limit?: string; gameId?: string },
  ): Promise<RoleReputationSummaryDto> {
    if (!/^[0-9a-f]{32}$/i.test(roleHandle)) unavailable();
    if (!(await this.installed(this.pool))) unavailable();
    const subject = (
      await this.pool.query<SubjectRow>(
        `SELECT * FROM role_reputation_subjects WHERE public_handle = $1`,
        [roleHandle.toLowerCase()],
      )
    ).rows[0];
    if (!subject) unavailable();
    let surfaceOpen = false;
    let includeDisplayName = false;
    if (query.gameId) {
      const game = await this.gameSurfaceOpen(this.pool, viewerId, query.gameId, subject.role);
      if (!game.open || game.subjectUserId !== subject.subject_user_id) unavailable();
      surfaceOpen = true;
      includeDisplayName = false; // game-role projection is not a full profile
    } else {
      surfaceOpen = await this.profileSurfaceOpen(this.pool, viewerId, subject.subject_user_id);
      includeDisplayName = surfaceOpen;
      if (!surfaceOpen) {
        // Knowing opaque handle alone must not bypass profile gate.
        unavailable();
      }
    }
    return this.summaryForSubject(this.pool, {
      subject,
      viewerId,
      cursor: query.cursor,
      limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
      includeDisplayName,
      surfaceOpen,
    });
  }

  async getForGame(
    viewerId: string | null,
    gameId: string,
    role: RoleKind,
  ): Promise<RoleReputationSummaryDto | null> {
    if (!(await this.installed(this.pool))) return null;
    const surface = await this.gameSurfaceOpen(this.pool, viewerId, gameId, role);
    if (!surface.open || !surface.subjectUserId) return null;
    const subject = (
      await this.pool.query<SubjectRow>(
        `SELECT * FROM role_reputation_subjects
         WHERE subject_user_id = $1 AND role = $2`,
        [surface.subjectUserId, role],
      )
    ).rows[0];
    if (!subject) return null;
    return this.summaryForSubject(this.pool, {
      subject,
      viewerId,
      includeDisplayName: false,
      surfaceOpen: true,
    });
  }

  async getForPublicPlayer(
    viewerId: string | null,
    publicPlayerId: string,
    role: RoleKind,
  ): Promise<RoleReputationSummaryDto | null> {
    if (!(await this.installed(this.pool))) return null;
    const user = (
      await this.pool.query<{ user_id: string }>(
        `SELECT user_id FROM player_social_profiles WHERE public_player_id = $1`,
        [publicPlayerId],
      )
    ).rows[0];
    if (!user) return null;
    if (!(await this.profileSurfaceOpen(this.pool, viewerId, user.user_id))) return null;
    const subject = (
      await this.pool.query<SubjectRow>(
        `SELECT * FROM role_reputation_subjects
         WHERE subject_user_id = $1 AND role = $2`,
        [user.user_id, role],
      )
    ).rows[0];
    if (!subject) return null;
    return this.summaryForSubject(this.pool, {
      subject,
      viewerId,
      includeDisplayName: true,
      surfaceOpen: true,
    });
  }

  private async loadAdmissionContext(
    client: PoolClient,
    userId: string,
    gameId: string,
    role: RoleKind,
  ) {
    const game = (
      await client.query<{
        id: string;
        status: "draft" | "published" | "cancelled" | "completed";
        activity_kind: "regular" | "trainer_led" | null;
        starts_at: Date;
        ends_at: Date;
        version: number;
      }>(
        `SELECT id, status, activity_kind, starts_at, ends_at, version
         FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      )
    ).rows[0];
    if (!game) unavailable();
    const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
    const outcome = (
      await client.query<{ value: "held" | "not_held"; version: number }>(
        `SELECT value, version FROM game_outcomes WHERE game_id = $1`,
        [gameId],
      )
    ).rows[0];
    const proof = (
      await client.query<ProofTip>(
        `SELECT * FROM game_role_proofs WHERE game_id = $1 AND role = $2`,
        [gameId, role],
      )
    ).rows[0];
    const own = (
      await client.query<{ id: string; status: string; confirmed_at: Date | null }>(
        `SELECT id, status, confirmed_at FROM participations
         WHERE game_id = $1 AND user_id = $2 LIMIT 1`,
        [gameId, userId],
      )
    ).rows[0];
    let ownEligible = false;
    let authorConfirmed = false;
    let authorOpenDispute = false;
    let attendance: {
      value: AttendanceValue;
      source: AttendanceSource;
      actorUserId: string;
      version: number;
    } | null = null;
    if (own) {
      const transitions = await client.query<{ to_status: string; at: Date; id: string }>(
        `SELECT to_status, at, id FROM participation_transitions
         WHERE participation_id = $1 ORDER BY at ASC, id ASC`,
        [own.id],
      );
      ownEligible = participationEligible({
        transitions: transitions.rows,
        startsAt: game.starts_at,
        endsAt: game.ends_at,
        currentStatus: own.status,
        confirmedAt: own.confirmed_at,
      });
      authorOpenDispute = Boolean(
        (
          await client.query(
            `SELECT 1 FROM game_attendance_disputes
             WHERE participation_id = $1 AND status = 'open' LIMIT 1`,
            [own.id],
          )
        ).rows[0],
      );
      const att = (
        await client.query<{
          value: AttendanceValue;
          source: AttendanceSource;
          actor_user_id: string;
          version: number;
        }>(
          `SELECT value, source, actor_user_id, version FROM game_attendance
           WHERE participation_id = $1`,
          [own.id],
        )
      ).rows[0];
      if (att) {
        attendance = {
          value: att.value,
          source: att.source,
          actorUserId: att.actor_user_id,
          version: att.version,
        };
        authorConfirmed =
          !authorOpenDispute &&
          isPermittedPresentAssertion({
            value: att.value,
            source: att.source,
            actorUserId: att.actor_user_id,
            subjectUserId: userId,
          });
      }
    }
    const lifecycleOk =
      game.ends_at.getTime() <= now.getTime() &&
      (game.status === "published" || game.status === "completed");
    return {
      game,
      now,
      outcome,
      proof,
      ownEligible,
      authorConfirmed,
      authorOpenDispute,
      attendance,
      lifecycleOk,
      verdict: evaluateWriteAdmission({
        authorUserId: userId,
        subjectUserId: proof?.subject_user_id ?? null,
        role,
        activityKind: game.activity_kind,
        lifecycleOk,
        outcomeHeld: outcome?.value === "held",
        ownEligible,
        authorConfirmedPresent: authorConfirmed,
        authorOpenDispute,
        authorAttendance: attendance,
        proofPhase: proof?.phase ?? null,
        proofSubjectUserId: proof?.subject_user_id ?? null,
        proofAccepted: proof?.accepted_for_count ?? false,
        openRoleDispute: proof?.open_dispute ?? false,
        surfaceAvailable: true,
      }),
    };
  }

  async eligibility(
    userId: string,
    roleHandle: string,
  ): Promise<OwnEligibilityDto> {
    if (!/^[0-9a-f]{32}$/i.test(roleHandle)) unavailable();
    if (!(await this.installed(this.pool))) unavailable();
    const subject = (
      await this.pool.query<SubjectRow>(
        `SELECT * FROM role_reputation_subjects WHERE public_handle = $1`,
        [roleHandle.toLowerCase()],
      )
    ).rows[0];
    if (!subject) unavailable();
    const games = await this.pool.query<{ game_id: string; ends_at: Date }>(
      `SELECT p.game_id, g.ends_at
       FROM game_role_proofs p
       JOIN games g ON g.id = p.game_id
       JOIN participations part ON part.game_id = g.id AND part.user_id = $1
       WHERE p.subject_user_id = $2 AND p.role = $3
       ORDER BY g.ends_at DESC
       LIMIT 50`,
      [userId, subject.subject_user_id, subject.role],
    );
    const bases = [];
    for (const g of games.rows) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const ctx = await this.loadAdmissionContext(client, userId, g.game_id, subject.role);
        const previewText = "preview";
        const hash =
          ctx.verdict.status === "may_submit" && ctx.proof
            ? projectionHash({
                subjectUserId: ctx.proof.subject_user_id,
                role: subject.role,
                audience: "public",
                text: previewText,
                topics: [],
              })
            : null;
        bases.push({
          gameId: g.game_id,
          role: subject.role,
          endsAt: g.ends_at.toISOString(),
          proofVersion: ctx.proof?.version ?? 0,
          outcomeVersion: ctx.outcome?.version ?? 0,
          attendanceVersion: ctx.attendance?.version ?? 0,
          projectionHashPreview: null, // client must preview exact text via consent endpoint
          admission:
            ctx.verdict.status === "may_submit"
              ? ("may_submit" as const)
              : ctx.verdict.status === "hold"
                ? ("hold" as const)
                : ("deny" as const),
          reason: ctx.verdict.status === "may_submit" ? null : ctx.verdict.reason,
        });
        void hash;
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    return { roleHandle: subject.public_handle, role: subject.role, bases };
  }

  async previewConsent(
    userId: string,
    input: unknown,
  ): Promise<{ consentProjectionHash: string }> {
    const body = parseOrThrow(consentPreviewRequest, input);
    if (!(await this.installed(this.pool))) unavailable();
    const subject = (
      await this.pool.query<SubjectRow>(
        `SELECT * FROM role_reputation_subjects WHERE public_handle = $1`,
        [body.subjectRoleHandle],
      )
    ).rows[0];
    if (!subject || subject.role !== body.role) unavailable();
    if (subject.subject_user_id === userId) {
      throw forbidden("ROLE_REPUTATION_SELF", "Нельзя оценить себя");
    }
    if (!topicsAllowedForRole(body.role, body.topics)) {
      throw unprocessable("ROLE_TOPICS_INVALID", "Некорректные темы");
    }
    return {
      consentProjectionHash: projectionHash({
        subjectUserId: subject.subject_user_id,
        role: body.role,
        audience: "public",
        text: body.text,
        topics: body.topics,
      }),
    };
  }

  private async insertPendingIntake(
    client: PoolClient,
    args: {
      kind: "review_submit" | "reply_submit" | "report" | "appeal" | "basis_dispute";
      slotId: string;
      revisionId: string | null;
      replyRevisionId: string | null;
      submittedBy: string;
      subjectUserId: string;
      role: RoleKind;
    },
  ): Promise<{ id: string; receiptToken: string }> {
    const receiptToken = opaqueHandle();
    const row = (
      await client.query<{ id: string; receipt_token: string }>(
        `INSERT INTO role_reputation_pending_intakes
           (kind, slot_id, revision_id, reply_revision_id, receipt_token, status,
            submitted_by_user_id, subject_user_id, role, version)
         VALUES ($1,$2,$3,$4,$5,'waiting_intake',$6,$7,$8,1)
         RETURNING id, receipt_token`,
        [
          args.kind,
          args.slotId,
          args.revisionId,
          args.replyRevisionId,
          receiptToken,
          args.submittedBy,
          args.subjectUserId,
          args.role,
        ],
      )
    ).rows[0]!;
    return { id: row.id, receiptToken: row.receipt_token };
  }

  private async createOrResubmitReview(
    client: PoolClient,
    userId: string,
    body: {
      gameId: string;
      role: RoleKind;
      expectedBasisVersions: {
        proofVersion: number;
        outcomeVersion: number;
        attendanceVersion: number;
      };
      text: string;
      topics: string[];
      consentProjectionHash: string;
    },
    expectedSlotVersion: number | null,
  ): Promise<RoleReviewMutationReceiptDto> {
    if (!topicsAllowedForRole(body.role, body.topics)) {
      throw unprocessable("ROLE_TOPICS_INVALID", "Некорректные темы");
    }
    const ctx = await this.loadAdmissionContext(client, userId, body.gameId, body.role);
    if (ctx.verdict.status !== "may_submit" || !ctx.proof) {
      if (ctx.verdict.status === "hold") {
        throw unprocessable("ROLE_REPUTATION_HOLD", "Основание уточняется");
      }
      throw unprocessable("ROLE_REPUTATION_DENIED", "Нет допуска к публикации");
    }
    if (ctx.proof.version !== body.expectedBasisVersions.proofVersion) {
      throw conflict("VERSION_CONFLICT", "Версия основания устарела");
    }
    if ((ctx.outcome?.version ?? 0) !== body.expectedBasisVersions.outcomeVersion) {
      throw conflict("VERSION_CONFLICT", "Версия итога устарела");
    }
    if ((ctx.attendance?.version ?? 0) !== body.expectedBasisVersions.attendanceVersion) {
      throw conflict("VERSION_CONFLICT", "Версия посещения устарела");
    }
    const expectedHash = projectionHash({
      subjectUserId: ctx.proof.subject_user_id,
      role: body.role,
      audience: "public",
      text: body.text,
      topics: body.topics,
    });
    if (expectedHash !== body.consentProjectionHash) {
      throw unprocessable("ROLE_CONSENT_MISMATCH", "Согласие не соответствует тексту");
    }
    let slot = (
      await client.query<SlotRow>(
        `SELECT * FROM role_review_slots
         WHERE author_user_id = $1 AND subject_user_id = $2 AND role = $3
         FOR UPDATE`,
        [userId, ctx.proof.subject_user_id, body.role],
      )
    ).rows[0];
    if (!slot) {
      if (expectedSlotVersion !== null && expectedSlotVersion !== 0) {
        throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
      }
      slot = (
        await client.query<SlotRow>(
          `INSERT INTO role_review_slots
             (author_user_id, subject_user_id, role, public_handle, status, version)
           VALUES ($1,$2,$3,$4,'submitted',1)
           RETURNING *`,
          [userId, ctx.proof.subject_user_id, body.role, opaqueHandle()],
        )
      ).rows[0]!;
    } else {
      if (expectedSlotVersion !== null && slot.version !== expectedSlotVersion) {
        throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
      }
      if (slot.status === "published") {
        // revision_waiting keeps old approved revision
      } else if (slot.status === "withdrawn" || slot.status === "needs_correction" || slot.status === "removed") {
        // resubmit path
      } else if (slot.status === "submitted" || slot.status === "revision_waiting" || slot.status === "held_basis") {
        // replace pending
      }
    }
    await client.query(
      `INSERT INTO role_review_event_fences
         (author_user_id, game_id, subject_user_id, role, slot_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [userId, body.gameId, ctx.proof.subject_user_id, body.role, slot.id],
    );
    const nextRev = (
      await client.query<{ n: string }>(
        `SELECT COALESCE(MAX(resource_version), 0)::text AS n
         FROM role_review_revisions WHERE slot_id = $1`,
        [slot.id],
      )
    ).rows[0]!;
    const resourceVersion = Number(nextRev.n) + 1;
    const rev = (
      await client.query<{ id: string }>(
        `INSERT INTO role_review_revisions
           (slot_id, resource_version, game_id, body_text, topics, projection_hash,
            consent_at, lifecycle, actor_user_id, proof_game_id, proof_role, proof_version)
         VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp(),'submitted',$7,$8,$9,$10)
         RETURNING id`,
        [
          slot.id,
          resourceVersion,
          body.gameId,
          body.text,
          body.topics,
          body.consentProjectionHash,
          userId,
          body.gameId,
          body.role,
          ctx.proof.version,
        ],
      )
    ).rows[0]!;
    const nextStatus =
      slot.status === "published" || slot.approved_revision_id
        ? "revision_waiting"
        : "submitted";
    const nextSlotVersion = slot.version + (slot.version === 1 && !slot.pending_revision_id && resourceVersion === 1 ? 0 : 1);
    // First insert already version=1; subsequent bumps version.
    const versionToSet = resourceVersion === 1 && !slot.pending_revision_id && !slot.approved_revision_id
      ? 1
      : slot.version + 1;
    await client.query(
      `UPDATE role_review_slots
       SET status = $2,
           version = $3,
           pending_revision_id = $4,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [slot.id, nextStatus, versionToSet, rev.id],
    );
    void nextSlotVersion;
    const pending = await this.insertPendingIntake(client, {
      kind: "review_submit",
      slotId: slot.id,
      revisionId: rev.id,
      replyRevisionId: null,
      submittedBy: userId,
      subjectUserId: ctx.proof.subject_user_id,
      role: body.role,
    });
    const fresh = (
      await client.query<SlotRow>(`SELECT * FROM role_review_slots WHERE id = $1`, [slot.id])
    ).rows[0]!;
    return {
      id: fresh.id,
      reviewHandle: fresh.public_handle,
      version: fresh.version,
      status: fresh.status,
      receiptToken: pending.receiptToken,
      pendingIntakeStatus: "waiting_intake",
    };
  }

  async createReview(
    userId: string,
    sessionId: string,
    key: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: RoleReviewMutationReceiptDto }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const body = parseOrThrow(createRoleReviewRequest, input);
    const requestHash = this.idempotency.requestHash(body);
    return this.mutations.runIdempotent({
      actorId: userId,
      sessionId,
      operation: "role_review.create",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const ctx = await this.loadAdmissionContext(client, userId, body.gameId, body.role);
        if (ctx.verdict.status !== "may_submit") {
          throw unprocessable("ROLE_REPUTATION_DENIED", "Нет допуска к публикации");
        }
      },
      execute: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const receipt = await this.createOrResubmitReview(client, userId, body, null);
        return { statusCode: 200, body: receipt };
      },
    });
  }

  async listMine(userId: string): Promise<{ items: OwnRoleReviewDto[] }> {
    if (!(await this.installed(this.pool))) return { items: [] };
    const rows = await this.pool.query<{
      id: string;
      public_handle: string;
      role: RoleKind;
      status: string;
      version: number;
      approved_revision_id: string | null;
      pending_revision_id: string | null;
      body_text: string | null;
      topics: string[] | null;
      receipt_token: string | null;
      intake_status: string | null;
      approved_version: number | null;
      pending_version: number | null;
    }>(
      `SELECT s.id, s.public_handle, s.role, s.status, s.version,
              s.approved_revision_id, s.pending_revision_id,
              COALESCE(pr.body_text, ar.body_text) AS body_text,
              COALESCE(pr.topics, ar.topics, '{}') AS topics,
              pi.receipt_token, pi.status AS intake_status,
              ar.resource_version AS approved_version,
              pr.resource_version AS pending_version
       FROM role_review_slots s
       LEFT JOIN role_review_revisions ar ON ar.id = s.approved_revision_id
       LEFT JOIN role_review_revisions pr ON pr.id = s.pending_revision_id
       LEFT JOIN LATERAL (
         SELECT receipt_token, status FROM role_reputation_pending_intakes
         WHERE slot_id = s.id AND status = 'waiting_intake'
         ORDER BY created_at DESC LIMIT 1
       ) pi ON true
       WHERE s.author_user_id = $1
       ORDER BY s.updated_at DESC
       LIMIT 50`,
      [userId],
    );
    return {
      items: rows.rows.map((r) => ({
        id: r.id,
        reviewHandle: r.public_handle,
        role: r.role,
        status: r.status,
        version: r.version,
        text: r.body_text,
        topics: r.topics ?? [],
        receiptToken: r.receipt_token,
        pendingIntakeStatus:
          r.intake_status === "waiting_intake"
            ? "waiting_intake"
            : r.intake_status === "linked"
              ? "linked"
              : "none",
        approvedRevision: r.approved_version,
        pendingRevision: r.pending_version,
      })),
    };
  }

  async ownCommand(
    userId: string,
    sessionId: string,
    key: string,
    reviewId: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: RoleReviewMutationReceiptDto }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const body = parseOrThrow(roleReviewCommandRequest, input);
    const requestHash = this.idempotency.requestHash({ reviewId, ...body });
    return this.mutations.runIdempotent({
      actorId: userId,
      sessionId,
      operation: "role_review.command",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM role_review_slots WHERE id = $1 FOR UPDATE`,
            [reviewId],
          )
        ).rows[0];
        if (!slot || slot.author_user_id !== userId) unavailable();
      },
      execute: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM role_review_slots WHERE id = $1 FOR UPDATE`,
            [reviewId],
          )
        ).rows[0];
        if (!slot || slot.author_user_id !== userId) unavailable();
        if (slot.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
        }
        if (body.action === "withdraw") {
          await client.query(
            `UPDATE role_review_slots
             SET status = 'withdrawn',
                 version = version + 1,
                 pending_revision_id = NULL,
                 approved_revision_id = NULL,
                 updated_at = clock_timestamp()
             WHERE id = $1`,
            [slot.id],
          );
          await client.query(
            `UPDATE role_reputation_pending_intakes
             SET status = 'cancelled', updated_at = clock_timestamp(), version = version + 1
             WHERE slot_id = $1 AND status = 'waiting_intake'`,
            [slot.id],
          );
          const fresh = (
            await client.query<SlotRow>(`SELECT * FROM role_review_slots WHERE id = $1`, [slot.id])
          ).rows[0]!;
          return {
            statusCode: 200,
            body: {
              id: fresh.id,
              reviewHandle: fresh.public_handle,
              version: fresh.version,
              status: fresh.status,
              receiptToken: opaqueHandle(),
              pendingIntakeStatus: "waiting_intake" as const,
            },
          };
        }
        if (body.action === "appeal") {
          const pending = await this.insertPendingIntake(client, {
            kind: "appeal",
            slotId: slot.id,
            revisionId: slot.approved_revision_id ?? slot.pending_revision_id,
            replyRevisionId: null,
            submittedBy: userId,
            subjectUserId: slot.subject_user_id,
            role: slot.role,
          });
          await client.query(
            `UPDATE role_review_slots SET version = version + 1, updated_at = clock_timestamp()
             WHERE id = $1`,
            [slot.id],
          );
          const fresh = (
            await client.query<SlotRow>(`SELECT * FROM role_review_slots WHERE id = $1`, [slot.id])
          ).rows[0]!;
          return {
            statusCode: 200,
            body: {
              id: fresh.id,
              reviewHandle: fresh.public_handle,
              version: fresh.version,
              status: fresh.status,
              receiptToken: pending.receiptToken,
              pendingIntakeStatus: "waiting_intake",
            },
          };
        }
        const receipt = await this.createOrResubmitReview(
          client,
          userId,
          {
            gameId: body.gameId,
            role: slot.role,
            expectedBasisVersions: body.expectedBasisVersions,
            text: body.text,
            topics: body.topics,
            consentProjectionHash: body.consentProjectionHash,
          },
          body.expectedVersion,
        );
        return { statusCode: 200, body: receipt };
      },
    });
  }

  async replyCommand(
    userId: string,
    sessionId: string,
    key: string,
    reviewId: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: { version: number; status: string; receiptToken: string } }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const body = parseOrThrow(roleReplyCommandRequest, input);
    const requestHash = this.idempotency.requestHash({ reviewId, ...body });
    return this.mutations.runIdempotent({
      actorId: userId,
      sessionId,
      operation: "role_review.reply_command",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        const slot = (
          await client.query<SlotRow>(`SELECT * FROM role_review_slots WHERE id = $1`, [reviewId])
        ).rows[0];
        if (!slot || slot.subject_user_id !== userId) unavailable();
      },
      execute: async (client) => {
        if (!(await this.installed(client))) writesUnavailable();
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM role_review_slots WHERE id = $1 FOR UPDATE`,
            [reviewId],
          )
        ).rows[0];
        if (!slot || slot.subject_user_id !== userId) unavailable();
        if (slot.status === "withdrawn" || !slot.approved_revision_id) {
          throw unprocessable("ROLE_REPLY_UNAVAILABLE", "Ответ недоступен");
        }
        if (body.action === "withdraw") {
          const reply = (
            await client.query(
              `SELECT version, status FROM role_review_replies WHERE slot_id = $1 FOR UPDATE`,
              [slot.id],
            )
          ).rows[0] as { version: number; status: string } | undefined;
          if (!reply || reply.version !== body.expectedVersion) {
            throw conflict("VERSION_CONFLICT", "Версия ответа устарела");
          }
          await client.query(
            `UPDATE role_review_replies
             SET status = 'withdrawn', version = version + 1, pending_revision_id = NULL,
                 approved_revision_id = NULL, updated_at = clock_timestamp()
             WHERE slot_id = $1`,
            [slot.id],
          );
          return {
            statusCode: 200,
            body: { version: reply.version + 1, status: "withdrawn", receiptToken: opaqueHandle() },
          };
        }
        const approved = (
          await client.query<{ id: string; resource_version: number; projection_hash: string }>(
            `SELECT id, resource_version, projection_hash FROM role_review_revisions WHERE id = $1`,
            [slot.approved_revision_id],
          )
        ).rows[0];
        if (!approved || approved.resource_version !== body.expectedReviewRevision) {
          throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
        }
        const expectedHash = projectionHash({
          subjectUserId: slot.subject_user_id,
          role: slot.role,
          audience: "public",
          text: body.text,
          topics: [],
          reviewRevision: approved.resource_version,
        });
        if (expectedHash !== body.consentProjectionHash) {
          throw unprocessable("ROLE_CONSENT_MISMATCH", "Согласие не соответствует тексту");
        }
        let reply = (
          await client.query<{
            slot_id: string;
            version: number;
            status: string;
            approved_revision_id: string | null;
            bound_review_revision_id: string;
          }>(`SELECT * FROM role_review_replies WHERE slot_id = $1 FOR UPDATE`, [slot.id])
        ).rows[0];
        if (!reply) {
          if (body.expectedVersion !== 0) throw conflict("VERSION_CONFLICT", "Версия ответа устарела");
          await client.query(
            `INSERT INTO role_review_replies
               (slot_id, version, status, bound_review_revision_id)
             VALUES ($1, 1, 'submitted', $2)`,
            [slot.id, approved.id],
          );
          reply = {
            slot_id: slot.id,
            version: 1,
            status: "submitted",
            approved_revision_id: null,
            bound_review_revision_id: approved.id,
          };
        } else if (reply.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия ответа устарела");
        }
        const next = (
          await client.query<{ n: string }>(
            `SELECT COALESCE(MAX(resource_version),0)::text AS n
             FROM role_review_reply_revisions WHERE slot_id = $1`,
            [slot.id],
          )
        ).rows[0]!;
        const resourceVersion = Number(next.n) + 1;
        const rev = (
          await client.query<{ id: string }>(
            `INSERT INTO role_review_reply_revisions
               (slot_id, resource_version, body_text, projection_hash, consent_at,
                lifecycle, actor_user_id, bound_review_revision_id)
             VALUES ($1,$2,$3,$4,clock_timestamp(),'submitted',$5,$6)
             RETURNING id`,
            [
              slot.id,
              resourceVersion,
              body.text,
              body.consentProjectionHash,
              userId,
              approved.id,
            ],
          )
        ).rows[0]!;
        const versionToSet = resourceVersion === 1 ? 1 : reply.version + 1;
        await client.query(
          `UPDATE role_review_replies
           SET version = $2,
               status = CASE WHEN approved_revision_id IS NULL THEN 'submitted' ELSE 'revision_waiting' END,
               pending_revision_id = $3,
               bound_review_revision_id = $4,
               updated_at = clock_timestamp()
           WHERE slot_id = $1`,
          [slot.id, versionToSet, rev.id, approved.id],
        );
        const pending = await this.insertPendingIntake(client, {
          kind: "reply_submit",
          slotId: slot.id,
          revisionId: approved.id,
          replyRevisionId: rev.id,
          submittedBy: userId,
          subjectUserId: slot.subject_user_id,
          role: slot.role,
        });
        return {
          statusCode: 200,
          body: {
            version: versionToSet,
            status: "submitted",
            receiptToken: pending.receiptToken,
          },
        };
      },
    });
  }

  async report(
    userId: string,
    sessionId: string,
    key: string,
    reviewId: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: { reportId: string; receiptToken: string; status: "submitted" } }> {
    const body = parseOrThrow(roleReviewReportRequest, input);
    const requestHash = this.idempotency.requestHash({ reviewId, ...body });
    return this.mutations.runIdempotent({
      actorId: userId,
      sessionId,
      operation: "role_review.report",
      key,
      requestHash,
      authorizeReplay: async (client) => {
        const slot = (
          await client.query<SlotRow>(`SELECT * FROM role_review_slots WHERE id = $1`, [reviewId])
        ).rows[0];
        if (!slot || slot.status !== "published") unavailable();
      },
      execute: async (client) => {
        if (!(await this.installed(client))) unavailable();
        const slot = (
          await client.query<SlotRow>(
            `SELECT * FROM role_review_slots WHERE id = $1 FOR UPDATE`,
            [reviewId],
          )
        ).rows[0];
        if (!slot || slot.status !== "published") unavailable();
        // Report does not hide published text.
        const rev = (
          await client.query<{ id: string; resource_version: number }>(
            body.targetKind === "review"
              ? `SELECT id, resource_version FROM role_review_revisions WHERE id = $1`
              : `SELECT id, resource_version FROM role_review_reply_revisions WHERE id = $1`,
            [
              body.targetKind === "review"
                ? slot.approved_revision_id
                : (
                    await client.query<{ approved_revision_id: string | null }>(
                      `SELECT approved_revision_id FROM role_review_replies WHERE slot_id = $1`,
                      [slot.id],
                    )
                  ).rows[0]?.approved_revision_id,
            ],
          )
        ).rows[0];
        if (!rev || rev.resource_version !== body.expectedRevision) {
          throw conflict("VERSION_CONFLICT", "Версия содержимого устарела");
        }
        const existing = (
          await client.query<{ id: string; pending_intake_id: string }>(
            `SELECT id, pending_intake_id FROM role_reputation_reports
             WHERE reporter_user_id = $1 AND slot_id = $2
               AND target_kind = $3 AND reported_resource_version = $4`,
            [userId, slot.id, body.targetKind, body.expectedRevision],
          )
        ).rows[0];
        if (existing) {
          const receipt = (
            await client.query<{ receipt_token: string }>(
              `SELECT receipt_token FROM role_reputation_pending_intakes WHERE id = $1`,
              [existing.pending_intake_id],
            )
          ).rows[0]!;
          return {
            statusCode: 200,
            body: {
              reportId: existing.id,
              receiptToken: receipt.receipt_token,
              status: "submitted" as const,
            },
          };
        }
        const pending = await this.insertPendingIntake(client, {
          kind: "report",
          slotId: slot.id,
          revisionId: body.targetKind === "review" ? rev.id : null,
          replyRevisionId: body.targetKind === "reply" ? rev.id : null,
          submittedBy: userId,
          subjectUserId: slot.subject_user_id,
          role: slot.role,
        });
        const report = (
          await client.query<{ id: string }>(
            `INSERT INTO role_reputation_reports
               (slot_id, target_kind, reported_revision_id, reported_resource_version,
                reporter_user_id, reason_code, explanation, pending_intake_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [
              slot.id,
              body.targetKind,
              rev.id,
              body.expectedRevision,
              userId,
              body.reasonCode,
              body.explanation ?? null,
              pending.id,
            ],
          )
        ).rows[0]!;
        return {
          statusCode: 200,
          body: {
            reportId: report.id,
            receiptToken: pending.receiptToken,
            status: "submitted" as const,
          },
        };
      },
    });
  }
}

function createProjectionVersion(
  handle: string,
  publishedCount: string | number,
  held: number | null,
  itemCount: number,
): string {
  return createHash("sha256")
    .update(`${handle}:${publishedCount}:${held ?? "n"}:${itemCount}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}
