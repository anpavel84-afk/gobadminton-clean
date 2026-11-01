import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { GameAttendanceService } from "./game-attendance.service";
import { eligibleFromTransitions } from "./game-attendance.policy";
import {
  assertLifecycleForFeedback,
  createReviewRequest,
  decodeMeReviewsCursor,
  deleteNoteRequest,
  emptyFeedbackSlice,
  encodeMeReviewsCursor,
  FEEDBACK_ACTOR_MUTATIONS_PER_GAME_MAX,
  needsDiscrepancy,
  parse,
  parseContextId,
  parseMeReviewsLimit,
  parseReviewId,
  patchReviewRequest,
  privateMissing,
  putNoteRequest,
  putReplyRequest,
  unavailable,
  writesUnavailable,
  postGameWritesEnabled,
  type AttendanceContext,
  type CreateReviewRequest,
  type FeedbackCapabilities,
  type GameFeedbackSlice,
  type MeReviewsPage,
  type PeerTag,
  type PersonalNoteView,
  type ReviewKind,
  type ReviewView,
  type LockedGameRow,
} from "./game-feedback.policy";
import { parseGameId } from "./game-outcomes.policy";

type AccessRole = "manager" | "participant" | "none";

type ReviewRow = {
  id: string;
  game_id: string;
  kind: ReviewKind;
  author_user_id: string;
  author_participation_id: string | null;
  subject_participation_id: string | null;
  recipient_user_id: string;
  peer_rating: "play_again" | "neutral" | "difficulties" | null;
  organization_score: number | null;
  comment: string | null;
  tags: string[] | null;
  experience_assertion: "i_experienced_this_game";
  discrepancy_explanation: string | null;
  attendance_context: AttendanceContext;
  outcome_context: "unknown" | "held" | "not_held";
  version: number;
  edited_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type NoteRow = {
  id: string;
  game_id: string;
  context_id: string;
  author_user_id: string;
  subject_user_id: string;
  text: string | null;
  version: number;
  deleted_at: Date | null;
  updated_at: Date;
};

type ReplyRow = {
  review_id: string;
  game_id: string;
  author_user_id: string;
  text: string;
  version: number;
  edited_at: Date | null;
  updated_at: Date;
};

@Injectable()
export class GameFeedbackService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
    private readonly attendance: GameAttendanceService,
  ) {}

  private async installed(client: PoolClient | Pool): Promise<boolean> {
    return Boolean((await client.query("SELECT to_regclass('game_reviews') AS name")).rows[0]?.name);
  }

  private async lockGame(client: PoolClient, gameId: string): Promise<LockedGameRow> {
    const row = (
      await client.query<LockedGameRow>(
        `SELECT id, status, version, ends_at FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      )
    ).rows[0];
    if (!row) unavailable();
    return row;
  }

  private async displayName(client: PoolClient | Pool, userId: string): Promise<string> {
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

  private async assertMutationBudget(client: PoolClient, gameId: string, userId: string): Promise<void> {
    const count = (
      await client.query<{ n: string }>(
        `SELECT (
           (SELECT COUNT(*) FROM game_review_revisions WHERE game_id = $1 AND actor_user_id = $2)
         + (SELECT COUNT(*) FROM game_review_reply_revisions WHERE game_id = $1 AND actor_user_id = $2)
         + (SELECT COUNT(*) FROM game_personal_note_revisions WHERE game_id = $1 AND actor_user_id = $2)
         )::text AS n`,
        [gameId, userId],
      )
    ).rows[0]?.n;
    if (Number(count ?? 0) >= FEEDBACK_ACTOR_MUTATIONS_PER_GAME_MAX) {
      throw conflict("FEEDBACK_RATE_LIMITED", "Достигнут лимит изменений обратной связи для этой игры");
    }
  }

  private async loadGameMeta(
    client: PoolClient | Pool,
    gameId: string,
  ): Promise<{
    activityKind: "regular" | "trainer_led";
    trainerUserId: string | null;
    startsAt: Date;
    endsAt: Date;
  }> {
    const row = (
      await client.query<{
        activity_kind: "regular" | "trainer_led";
        starts_at: Date;
        ends_at: Date;
        trainer_user_id: string | null;
      }>(
        `SELECT g.activity_kind, g.starts_at, g.ends_at, tp.user_id AS trainer_user_id
         FROM games g
         LEFT JOIN trainer_profiles tp ON tp.id = g.trainer_profile_id
         WHERE g.id = $1`,
        [gameId],
      )
    ).rows[0];
    if (!row) unavailable();
    return {
      activityKind: row.activity_kind,
      trainerUserId: row.trainer_user_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  }

  private async responsibleOrganizer(
    client: PoolClient | Pool,
    gameId: string,
  ): Promise<{ userId: string; displayName: string } | null> {
    const row = (
      await client.query<{ user_id: string }>(
        `SELECT user_id FROM game_managers
         WHERE game_id = $1 AND status = 'active' AND role IN ('owner', 'manager')
         ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC, user_id ASC
         LIMIT 1`,
        [gameId],
      )
    ).rows[0];
    if (!row) return null;
    return { userId: row.user_id, displayName: await this.displayName(client, row.user_id) };
  }

  private async authorParticipation(
    client: PoolClient | Pool,
    gameId: string,
    userId: string,
  ): Promise<{ id: string; status: string; confirmed_at: Date | null } | null> {
    return (
      await client.query<{ id: string; status: string; confirmed_at: Date | null }>(
        `SELECT id, status, confirmed_at FROM participations
         WHERE game_id = $1 AND user_id = $2 LIMIT 1`,
        [gameId, userId],
      )
    ).rows[0] ?? null;
  }

  private async resolveAttendanceContext(
    client: PoolClient,
    gameId: string,
    userId: string,
    role: AccessRole,
    outcome: "unknown" | "held" | "not_held",
  ): Promise<AttendanceContext> {
    if (outcome === "not_held") return "outcome_not_held";
    const own = await this.authorParticipation(client, gameId, userId);
    if (!own) {
      if (role === "manager") return "not_participant_manager";
      unavailable();
    }
    const att = (
      await client.query<{ value: string }>(
        `SELECT value FROM game_attendance WHERE participation_id = $1`,
        [own.id],
      )
    ).rows[0];
    const openDispute = (
      await client.query(
        `SELECT 1 FROM game_attendance_disputes
         WHERE participation_id = $1 AND status = 'open' LIMIT 1`,
        [own.id],
      )
    ).rows[0];
    if (openDispute) return "contested";
    if (!att) return "unknown";
    if (att.value === "present") return "present";
    if (att.value === "absent") return "absent";
    return "unknown";
  }

  private async projectReply(
    client: PoolClient | Pool,
    reviewId: string,
  ): Promise<ReplyRow | null> {
    return (
      await client.query<ReplyRow>(`SELECT * FROM game_review_replies WHERE review_id = $1`, [reviewId])
    ).rows[0] ?? null;
  }

  private async projectReview(
    client: PoolClient | Pool,
    row: ReviewRow,
    viewerId: string,
    writesEnabled: boolean,
  ): Promise<ReviewView> {
    const direction: "sent" | "received" =
      row.author_user_id === viewerId ? "sent" : "received";
    if (direction === "received" && row.recipient_user_id !== viewerId) privateMissing();
    if (direction === "sent" && row.author_user_id !== viewerId) privateMissing();
    const reply = await this.projectReply(client, row.id);
    const recipientDisplay = await this.displayName(client, row.recipient_user_id);
    return {
      id: row.id,
      gameId: row.game_id,
      kind: row.kind,
      subjectContextId: row.subject_participation_id,
      recipientDisplay,
      peerRating: row.peer_rating,
      organizationScore: row.organization_score,
      comment: row.comment,
      tags: (row.tags ?? []) as PeerTag[],
      experienceAssertion: row.experience_assertion,
      discrepancyExplanation: row.discrepancy_explanation,
      attendanceContext: row.attendance_context,
      outcomeContext: row.outcome_context,
      version: row.version,
      editedAt: row.edited_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      direction,
      reply: reply
        ? {
            text: reply.text,
            version: reply.version,
            editedAt: reply.edited_at?.toISOString() ?? null,
            updatedAt: reply.updated_at.toISOString(),
          }
        : null,
      allowedActions: {
        canEdit: writesEnabled && direction === "sent",
        canReply: writesEnabled && direction === "received",
      },
    };
  }

  private async projectNote(
    client: PoolClient | Pool,
    row: NoteRow,
    writesEnabled: boolean,
  ): Promise<PersonalNoteView | null> {
    if (row.deleted_at || row.text == null) return null;
    return {
      gameId: row.game_id,
      contextId: row.context_id,
      subjectDisplay: await this.displayName(client, row.subject_user_id),
      text: row.text,
      version: row.version,
      updatedAt: row.updated_at.toISOString(),
      allowedActions: {
        canEdit: writesEnabled,
        canDelete: writesEnabled,
      },
    };
  }

  private async loadOutcomeValue(
    client: PoolClient | Pool,
    gameId: string,
  ): Promise<"unknown" | "held" | "not_held"> {
    const row = (
      await client.query<{ value: "held" | "not_held" }>(
        `SELECT value FROM game_outcomes WHERE game_id = $1`,
        [gameId],
      )
    ).rows[0];
    return row?.value ?? "unknown";
  }

  async enrichResults(
    client: PoolClient | Pool,
    gameId: string,
    userId: string,
    role: AccessRole,
    game: LockedGameRow,
    now: Date,
  ): Promise<GameFeedbackSlice> {
    const writesEnabled = postGameWritesEnabled(this.env);
    if (!(await this.installed(client))) return emptyFeedbackSlice(writesEnabled);
    const meta = await this.loadGameMeta(client, gameId);
    const organizer = await this.responsibleOrganizer(client, gameId);
    const afterEnd = game.ends_at.getTime() <= now.getTime();
    const lifecycleOk =
      afterEnd &&
      (game.status === "published" || game.status === "completed" || game.status === "cancelled");
    const authorPart = await this.authorParticipation(client, gameId, userId);
    const canAuthorAsParticipant = role === "participant" && !!authorPart;
    const canAuthorAsManager = role === "manager";
    const canCreate = writesEnabled && lifecycleOk && (canAuthorAsParticipant || canAuthorAsManager);

    let peerSubjects: Array<{ contextId: string; displayName: string }> = [];
    if (canCreate && canAuthorAsParticipant) {
      peerSubjects = await this.loadPeerSubjects(client, gameId, userId, meta.startsAt, meta.endsAt);
    }

    const trainingOk =
      canCreate &&
      meta.activityKind === "trainer_led" &&
      !!meta.trainerUserId &&
      meta.trainerUserId !== userId;

    const capabilities: FeedbackCapabilities = {
      installed: true,
      writesEnabled,
      canCreatePeer: canCreate && canAuthorAsParticipant && peerSubjects.length > 0,
      canCreateOrganization: canCreate && !!organizer && organizer.userId !== userId,
      canCreateTraining: !!trainingOk,
      canCreateNote: writesEnabled && lifecycleOk && role === "manager",
      peerSubjects,
      organizationRecipientDisplay: organizer && organizer.userId !== userId ? organizer.displayName : null,
      complaintReuse: "existing_player_report",
      remaining: ["typed_review_safety_extension"],
    };

    const reviews = await client.query<ReviewRow>(
      `SELECT * FROM game_reviews
       WHERE game_id = $1 AND (author_user_id = $2 OR recipient_user_id = $2)
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [gameId, userId],
    );
    const gameReviews: ReviewView[] = [];
    for (const row of reviews.rows) {
      gameReviews.push(await this.projectReview(client, row, userId, writesEnabled));
    }

    const notes = await client.query<NoteRow>(
      `SELECT * FROM game_personal_notes
       WHERE game_id = $1 AND author_user_id = $2 AND deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC
       LIMIT 50`,
      [gameId, userId],
    );
    const myNotes: PersonalNoteView[] = [];
    for (const row of notes.rows) {
      const projected = await this.projectNote(client, row, writesEnabled && (role === "manager" || true));
      if (projected) myNotes.push(projected);
    }

    return {
      installed: true,
      writesEnabled,
      capabilities,
      myNotes,
      gameReviews,
    };
  }

  private async loadPeerSubjects(
    client: PoolClient | Pool,
    gameId: string,
    viewerId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<Array<{ contextId: string; displayName: string }>> {
    const parts = await client.query<{
      id: string;
      user_id: string;
      status: string;
      confirmed_at: Date | null;
      display_name: string;
    }>(
      `SELECT p.id, p.user_id, p.status, p.confirmed_at,
              COALESCE(NULLIF(TRIM(sp.display_name), ''), NULLIF(TRIM(u.display_name), ''), 'Игрок') AS display_name
       FROM participations p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN player_social_profiles sp ON sp.user_id = p.user_id
       WHERE p.game_id = $1`,
      [gameId],
    );
    const out: Array<{ contextId: string; displayName: string }> = [];
    for (const part of parts.rows) {
      if (part.user_id === viewerId) continue;
      const transitions = await client.query<{ to_status: string; at: Date; id: string }>(
        `SELECT to_status, at, id FROM participation_transitions
         WHERE participation_id = $1 ORDER BY at ASC, id ASC`,
        [part.id],
      );
      const verdict = eligibleFromTransitions(
        transitions.rows,
        startsAt,
        part.status,
        part.confirmed_at,
        endsAt,
      );
      if (!verdict.eligible) continue;
      out.push({ contextId: part.id, displayName: part.display_name });
    }
    out.sort((a, b) => {
      const byName = a.displayName.localeCompare(b.displayName, "ru");
      return byName !== 0 ? byName : a.contextId.localeCompare(b.contextId);
    });
    return out;
  }

  async createReview(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: ReviewView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const body = parse(createReviewRequest, input);
    const requestHash = this.idempotency.requestHash({
      gameId,
      kind: body.kind,
      subjectContextId: body.subjectContextId ?? null,
      peerRating: body.peerRating ?? null,
      organizationScore: body.organizationScore ?? null,
      comment: body.comment ?? null,
      tags: body.tags ?? [],
      experienceAssertion: body.experienceAssertion,
      discrepancyExplanation: body.discrepancyExplanation ?? null,
    });
    return this.mutations.runIdempotent<ReviewView>({
      actorId: userId,
      sessionId,
      operation: "games.reviews.create",
      key,
      requestHash,
      authorizeReplay: async (client, existing) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        await this.lockGame(client, gameId);
        const role = await this.attendance.resolveAccessRole(client, gameId, userId);
        if (role === "none") unavailable();
        if (existing.gameId !== gameId || existing.direction !== "sent") privateMissing();
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const locked = await this.lockGame(client, gameId);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        assertLifecycleForFeedback(locked, now);
        const role = await this.attendance.resolveAccessRole(client, gameId, userId);
        if (role === "none") unavailable();
        await this.assertMutationBudget(client, gameId, userId);

        const outcome = await this.loadOutcomeValue(client, gameId);
        const attendanceContext = await this.resolveAttendanceContext(client, gameId, userId, role, outcome);
        if (needsDiscrepancy(attendanceContext) && !body.discrepancyExplanation) {
          throw unprocessable(
            "FEEDBACK_DISCREPANCY_REQUIRED",
            "Нужно пояснение расхождения с посещением или итога",
          );
        }
        if (!needsDiscrepancy(attendanceContext) && body.discrepancyExplanation) {
          throw unprocessable("FEEDBACK_DISCREPANCY_UNEXPECTED", "Пояснение расхождения не требуется");
        }

        const authorPart = await this.authorParticipation(client, gameId, userId);
        if (role === "participant" && !authorPart) unavailable();
        // Creator/manager is not automatically a participant for peer feedback.
        if (body.kind === "peer" && role !== "participant") {
          throw unprocessable("FEEDBACK_PEER_REQUIRES_PARTICIPATION", "Отзыв игроку доступен участнику с контекстом");
        }

        let recipientUserId: string;
        let subjectParticipationId: string | null = null;
        const meta = await this.loadGameMeta(client, gameId);

        if (body.kind === "peer") {
          const subjectId = body.subjectContextId!;
          const subject = (
            await client.query<{ id: string; user_id: string; game_id: string; status: string }>(
              `SELECT id, user_id, game_id, status FROM participations WHERE id = $1 FOR UPDATE`,
              [subjectId],
            )
          ).rows[0];
          if (!subject || subject.game_id !== gameId) {
            throw unprocessable("FEEDBACK_SUBJECT_INVALID", "Контекст адресата недоступен");
          }
          if (subject.user_id === userId) {
            throw unprocessable("FEEDBACK_SELF_PEER", "Нельзя оставить отзыв самому себе");
          }
          const peers = await this.loadPeerSubjects(client, gameId, userId, meta.startsAt, meta.endsAt);
          if (!peers.some((p) => p.contextId === subjectId)) {
            throw unprocessable("FEEDBACK_SUBJECT_FOREIGN", "Контекст адресата недоступен");
          }
          // Reject pending/unknown foreign contexts already filtered by eligibility.
          subjectParticipationId = subject.id;
          recipientUserId = subject.user_id;
        } else if (body.kind === "organization") {
          const organizer = await this.responsibleOrganizer(client, gameId);
          if (!organizer) throw unprocessable("FEEDBACK_ORGANIZER_MISSING", "Организатор недоступен");
          if (organizer.userId === userId) {
            throw unprocessable("FEEDBACK_SELF_ORGANIZATION", "Нельзя оставить отзыв организации самому себе");
          }
          recipientUserId = organizer.userId;
        } else {
          if (meta.activityKind !== "trainer_led" || !meta.trainerUserId) {
            throw unprocessable("FEEDBACK_TRAINING_CONTEXT_MISSING", "Тренировочный контекст не подтверждён");
          }
          if (meta.trainerUserId === userId) {
            throw unprocessable("FEEDBACK_SELF_TRAINING", "Нельзя оставить отзыв самому себе");
          }
          // TrainerProfile alone is insufficient — require trainer_led game binding above.
          recipientUserId = meta.trainerUserId;
        }

        const tags = body.kind === "peer" ? (body.tags ?? []) : [];
        // Game row is locked above: same-game writers serialize. Precheck returns the
        // stored projection only (does not apply this request's fields). SAVEPOINT keeps
        // a late UNIQUE 23505 from aborting the outer txn before owned lookup (25P02).
        const ownedPrior = await this.findOwnedDuplicate(client, gameId, userId, body);
        if (ownedPrior) {
          return {
            statusCode: 200,
            body: await this.projectReview(client, ownedPrior, userId, true),
          };
        }

        let inserted: ReviewRow;
        await client.query("SAVEPOINT game_review_insert");
        try {
          inserted = (
            await client.query<ReviewRow>(
              `INSERT INTO game_reviews (
                 game_id, kind, author_user_id, author_participation_id, subject_participation_id,
                 recipient_user_id, peer_rating, organization_score, comment, tags,
                 experience_assertion, discrepancy_explanation, attendance_context, outcome_context,
                 version, created_at, updated_at
               ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,$12,$13,$14,1,$15,$15
               ) RETURNING *`,
              [
                gameId,
                body.kind,
                userId,
                authorPart?.id ?? null,
                subjectParticipationId,
                recipientUserId,
                body.peerRating ?? null,
                body.organizationScore ?? null,
                body.comment ?? null,
                tags,
                body.experienceAssertion,
                body.discrepancyExplanation ?? null,
                attendanceContext,
                outcome,
                now,
              ],
            )
          ).rows[0]!;
          await client.query("RELEASE SAVEPOINT game_review_insert");
        } catch (error) {
          if (isUniqueViolation(error)) {
            await client.query("ROLLBACK TO SAVEPOINT game_review_insert");
            const existing = await this.findOwnedDuplicate(client, gameId, userId, body);
            if (existing) {
              return {
                statusCode: 200,
                body: await this.projectReview(client, existing, userId, true),
              };
            }
            throw conflict("FEEDBACK_DUPLICATE", "Отзыв этого вида уже существует");
          }
          throw error;
        }

        await client.query(
          `INSERT INTO game_review_revisions (
             review_id, game_id, resource_version, actor_user_id, recorded_at,
             after_peer_rating, after_organization_score, after_comment, after_tags, after_discrepancy_explanation
           ) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8::text[],$9)`,
          [
            inserted.id,
            gameId,
            userId,
            now,
            inserted.peer_rating,
            inserted.organization_score,
            inserted.comment,
            inserted.tags ?? [],
            inserted.discrepancy_explanation,
          ],
        );

        return {
          statusCode: 201,
          body: await this.projectReview(client, inserted, userId, true),
        };
      },
    });
  }

  private async findOwnedDuplicate(
    client: PoolClient,
    gameId: string,
    userId: string,
    body: CreateReviewRequest,
  ): Promise<ReviewRow | null> {
    if (body.kind === "peer") {
      return (
        await client.query<ReviewRow>(
          `SELECT * FROM game_reviews
           WHERE game_id = $1 AND author_user_id = $2 AND kind = 'peer' AND subject_participation_id = $3`,
          [gameId, userId, body.subjectContextId],
        )
      ).rows[0] ?? null;
    }
    return (
      await client.query<ReviewRow>(
        `SELECT * FROM game_reviews
         WHERE game_id = $1 AND author_user_id = $2 AND kind = $3`,
        [gameId, userId, body.kind],
      )
    ).rows[0] ?? null;
  }

  async patchReview(
    userId: string,
    sessionId: string,
    key: string,
    reviewIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: ReviewView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const reviewId = parseReviewId(reviewIdRaw);
    const body = parse(patchReviewRequest, input);
    const requestHash = this.idempotency.requestHash({
      reviewId,
      expectedVersion: body.expectedVersion,
      peerRating: body.peerRating ?? null,
      organizationScore: body.organizationScore === undefined ? undefined : body.organizationScore,
      comment: body.comment === undefined ? undefined : body.comment,
      tags: body.tags ?? null,
      discrepancyExplanation:
        body.discrepancyExplanation === undefined ? undefined : body.discrepancyExplanation,
    });
    return this.mutations.runIdempotent<ReviewView>({
      actorId: userId,
      sessionId,
      operation: "games.reviews.patch",
      key,
      requestHash,
      authorizeReplay: async (client, existing) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const row = (
          await client.query<ReviewRow>(`SELECT * FROM game_reviews WHERE id = $1 FOR UPDATE`, [reviewId])
        ).rows[0];
        if (!row || row.author_user_id !== userId) privateMissing();
        await this.lockGame(client, row.game_id);
        if (existing.id !== reviewId || existing.direction !== "sent") privateMissing();
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const existing = (
          await client.query<ReviewRow>(`SELECT * FROM game_reviews WHERE id = $1 FOR UPDATE`, [reviewId])
        ).rows[0];
        if (!existing || existing.author_user_id !== userId) privateMissing();
        const locked = await this.lockGame(client, existing.game_id);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        assertLifecycleForFeedback(locked, now);
        await this.assertMutationBudget(client, existing.game_id, userId);
        if (existing.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия отзыва устарела");
        }

        if (existing.kind === "peer") {
          if (body.organizationScore !== undefined) {
            throw unprocessable("FEEDBACK_PATCH_KIND", "Поле недоступно для этого отзыва");
          }
        } else if (existing.kind === "organization") {
          if (body.peerRating !== undefined || body.tags !== undefined) {
            throw unprocessable("FEEDBACK_PATCH_KIND", "Поле недоступно для этого отзыва");
          }
        } else {
          if (
            body.peerRating !== undefined ||
            body.organizationScore !== undefined ||
            body.tags !== undefined
          ) {
            throw unprocessable("FEEDBACK_PATCH_KIND", "Поле недоступно для этого отзыва");
          }
        }

        const nextPeer = body.peerRating !== undefined ? body.peerRating : existing.peer_rating;
        const nextScore =
          body.organizationScore !== undefined ? body.organizationScore : existing.organization_score;
        const nextComment = body.comment !== undefined ? body.comment : existing.comment;
        const nextTags = body.tags !== undefined ? body.tags : ((existing.tags ?? []) as PeerTag[]);
        const nextDiscrepancy =
          body.discrepancyExplanation !== undefined
            ? body.discrepancyExplanation
            : existing.discrepancy_explanation;

        if (existing.kind === "organization" && nextScore == null && nextComment == null) {
          throw unprocessable("FEEDBACK_ORG_EMPTY", "Нужна оценка или комментарий");
        }
        if (existing.kind === "training" && nextComment == null) {
          throw unprocessable("FEEDBACK_TRAINING_EMPTY", "Нужен текст опыта");
        }
        if (needsDiscrepancy(existing.attendance_context) && !nextDiscrepancy) {
          throw unprocessable("FEEDBACK_DISCREPANCY_REQUIRED", "Нужно пояснение расхождения");
        }

        const nextVersion = existing.version + 1;
        const updated = (
          await client.query<ReviewRow>(
            `UPDATE game_reviews SET
               peer_rating = $2,
               organization_score = $3,
               comment = $4,
               tags = $5::text[],
               discrepancy_explanation = $6,
               version = $7,
               edited_at = $8,
               updated_at = $8
             WHERE id = $1
             RETURNING *`,
            [
              reviewId,
              nextPeer,
              nextScore,
              nextComment,
              nextTags,
              nextDiscrepancy,
              nextVersion,
              now,
            ],
          )
        ).rows[0]!;

        await client.query(
          `INSERT INTO game_review_revisions (
             review_id, game_id, resource_version, actor_user_id, recorded_at,
             before_peer_rating, after_peer_rating,
             before_organization_score, after_organization_score,
             before_comment, after_comment,
             before_tags, after_tags,
             before_discrepancy_explanation, after_discrepancy_explanation
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[],$13::text[],$14,$15)`,
          [
            reviewId,
            existing.game_id,
            nextVersion,
            userId,
            now,
            existing.peer_rating,
            updated.peer_rating,
            existing.organization_score,
            updated.organization_score,
            existing.comment,
            updated.comment,
            existing.tags ?? [],
            updated.tags ?? [],
            existing.discrepancy_explanation,
            updated.discrepancy_explanation,
          ],
        );

        return { statusCode: 200, body: await this.projectReview(client, updated, userId, true) };
      },
    });
  }

  async putReply(
    userId: string,
    sessionId: string,
    key: string,
    reviewIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: ReviewView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const reviewId = parseReviewId(reviewIdRaw);
    const body = parse(putReplyRequest, input);
    const requestHash = this.idempotency.requestHash({
      reviewId,
      expectedVersion: body.expectedVersion,
      text: body.text,
    });
    return this.mutations.runIdempotent<ReviewView>({
      actorId: userId,
      sessionId,
      operation: "games.reviews.reply",
      key,
      requestHash,
      authorizeReplay: async (client, existing) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const row = (
          await client.query<ReviewRow>(`SELECT * FROM game_reviews WHERE id = $1 FOR UPDATE`, [reviewId])
        ).rows[0];
        if (!row || row.recipient_user_id !== userId) privateMissing();
        await this.lockGame(client, row.game_id);
        if (existing.id !== reviewId || existing.direction !== "received") privateMissing();
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const review = (
          await client.query<ReviewRow>(`SELECT * FROM game_reviews WHERE id = $1 FOR UPDATE`, [reviewId])
        ).rows[0];
        if (!review || review.recipient_user_id !== userId) privateMissing();
        const locked = await this.lockGame(client, review.game_id);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        assertLifecycleForFeedback(locked, now);
        await this.assertMutationBudget(client, review.game_id, userId);

        const existing = (
          await client.query<ReplyRow>(
            `SELECT * FROM game_review_replies WHERE review_id = $1 FOR UPDATE`,
            [reviewId],
          )
        ).rows[0] ?? null;
        const currentVersion = existing?.version ?? 0;
        if (currentVersion !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия ответа устарела");
        }
        const nextVersion = currentVersion + 1;
        if (!existing) {
          await client.query(
            `INSERT INTO game_review_replies
               (review_id, game_id, author_user_id, text, version, created_at, updated_at)
             VALUES ($1,$2,$3,$4,1,$5,$5)`,
            [reviewId, review.game_id, userId, body.text, now],
          );
        } else {
          await client.query(
            `UPDATE game_review_replies
             SET text = $2, version = $3, edited_at = $4, updated_at = $4
             WHERE review_id = $1`,
            [reviewId, body.text, nextVersion, now],
          );
        }
        await client.query(
          `INSERT INTO game_review_reply_revisions
             (review_id, game_id, resource_version, actor_user_id, recorded_at, before_text, after_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            reviewId,
            review.game_id,
            nextVersion,
            userId,
            now,
            existing?.text ?? null,
            body.text,
          ],
        );
        const refreshed = (
          await client.query<ReviewRow>(`SELECT * FROM game_reviews WHERE id = $1`, [reviewId])
        ).rows[0]!;
        return { statusCode: 200, body: await this.projectReview(client, refreshed, userId, true) };
      },
    });
  }

  async listMeReviews(
    userId: string,
    query: { limit?: string; cursor?: string; direction?: string } = {},
  ): Promise<MeReviewsPage> {
    const limit = parseMeReviewsLimit(query.limit);
    const cursor = decodeMeReviewsCursor(query.cursor);
    const direction =
      query.direction === "received" || query.direction === "sent"
        ? query.direction
        : cursor?.direction ?? "received";
    if (!(await this.installed(this.pool))) {
      return { items: [], nextCursor: null };
    }
    const rows = await this.pool.query<ReviewRow>(
      direction === "sent"
        ? `SELECT * FROM game_reviews
           WHERE author_user_id = $1
             AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
           ORDER BY created_at DESC, id DESC
           LIMIT $4`
        : `SELECT * FROM game_reviews
           WHERE recipient_user_id = $1
             AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
           ORDER BY created_at DESC, id DESC
           LIMIT $4`,
      [userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const writesEnabled = postGameWritesEnabled(this.env);
    const window = rows.rows.slice(0, limit);
    const items: ReviewView[] = [];
    for (const row of window) {
      items.push(await this.projectReview(this.pool, row, userId, writesEnabled));
    }
    const last = window[window.length - 1];
    return {
      items,
      nextCursor:
        rows.rows.length > limit && last
          ? encodeMeReviewsCursor(last.created_at.toISOString(), last.id, direction)
          : null,
    };
  }

  async putNote(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    contextIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: PersonalNoteView }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const contextId = parseContextId(contextIdRaw);
    const body = parse(putNoteRequest, input);
    const requestHash = this.idempotency.requestHash({
      gameId,
      contextId,
      expectedVersion: body.expectedVersion,
      text: body.text,
    });
    return this.mutations.runIdempotent<PersonalNoteView>({
      actorId: userId,
      sessionId,
      operation: "games.notes.put",
      key,
      requestHash,
      authorizeReplay: async (client, existing) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        await this.lockGame(client, gameId);
        const note = (
          await client.query<NoteRow>(
            `SELECT * FROM game_personal_notes
             WHERE game_id = $1 AND context_id = $2 AND author_user_id = $3 FOR UPDATE`,
            [gameId, contextId, userId],
          )
        ).rows[0];
        if (!note || note.deleted_at) {
          // Existing author retains own recourse after revoke — authorize if owned projection matches.
          if (existing.gameId !== gameId || existing.contextId !== contextId) privateMissing();
          return;
        }
        if (note.author_user_id !== userId) privateMissing();
        if (existing.gameId !== gameId || existing.contextId !== contextId) privateMissing();
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        const locked = await this.lockGame(client, gameId);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        assertLifecycleForFeedback(locked, now);
        await this.assertMutationBudget(client, gameId, userId);

        const existing = (
          await client.query<NoteRow>(
            `SELECT * FROM game_personal_notes
             WHERE game_id = $1 AND context_id = $2 AND author_user_id = $3 FOR UPDATE`,
            [gameId, contextId, userId],
          )
        ).rows[0] ?? null;

        if (existing?.deleted_at) {
          throw conflict("NOTE_TOMBSTONED", "Заметка удалена и не может быть восстановлена");
        }

        const participation = (
          await client.query<{ id: string; user_id: string; game_id: string }>(
            `SELECT id, user_id, game_id FROM participations WHERE id = $1 FOR UPDATE`,
            [contextId],
          )
        ).rows[0];
        if (!participation || participation.game_id !== gameId) {
          throw unprocessable("NOTE_CONTEXT_INVALID", "Контекст заметки недоступен");
        }

        // Create requires current manager; edit of own note survives revoke.
        if (!existing) {
          const manager = await client.query(
            `SELECT 1 FROM game_managers
             WHERE game_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner', 'manager')
             LIMIT 1`,
            [gameId, userId],
          );
          if (!manager.rows[0]) unavailable();
        } else if (existing.author_user_id !== userId) {
          privateMissing();
        }

        const currentVersion = existing?.version ?? 0;
        if (currentVersion !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия заметки устарела");
        }
        const nextVersion = currentVersion + 1;
        let row: NoteRow;
        if (!existing) {
          row = (
            await client.query<NoteRow>(
              `INSERT INTO game_personal_notes
                 (game_id, context_id, author_user_id, subject_user_id, text, version, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,1,$6,$6)
               RETURNING *`,
              [gameId, contextId, userId, participation.user_id, body.text, now],
            )
          ).rows[0]!;
        } else {
          row = (
            await client.query<NoteRow>(
              `UPDATE game_personal_notes
               SET text = $2, version = $3, updated_at = $4
               WHERE id = $1
               RETURNING *`,
              [existing.id, body.text, nextVersion, now],
            )
          ).rows[0]!;
        }
        await client.query(
          `INSERT INTO game_personal_note_revisions
             (note_id, game_id, context_id, resource_version, actor_user_id, recorded_at,
              before_text, after_text, tombstone)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false)`,
          [
            row.id,
            gameId,
            contextId,
            nextVersion,
            userId,
            now,
            existing?.text ?? null,
            body.text,
          ],
        );
        const projected = await this.projectNote(client, row, true);
        if (!projected) privateMissing();
        return { statusCode: existing ? 200 : 201, body: projected };
      },
    });
  }

  async deleteNote(
    userId: string,
    sessionId: string,
    key: string,
    gameIdRaw: string,
    contextIdRaw: string,
    input: unknown,
  ): Promise<{ statusCode: number; body: { gameId: string; contextId: string; version: number; deleted: true } }> {
    if (!postGameWritesEnabled(this.env)) writesUnavailable();
    const gameId = parseGameId(gameIdRaw);
    const contextId = parseContextId(contextIdRaw);
    const body = parse(deleteNoteRequest, input ?? {});
    const requestHash = this.idempotency.requestHash({
      gameId,
      contextId,
      expectedVersion: body.expectedVersion,
      op: "delete",
    });
    return this.mutations.runIdempotent<{
      gameId: string;
      contextId: string;
      version: number;
      deleted: true;
    }>({
      actorId: userId,
      sessionId,
      operation: "games.notes.delete",
      key,
      requestHash,
      authorizeReplay: async (client, existing) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        await this.lockGame(client, gameId);
        if (existing.gameId !== gameId || existing.contextId !== contextId || !existing.deleted) {
          privateMissing();
        }
      },
      execute: async (client) => {
        if (!postGameWritesEnabled(this.env)) writesUnavailable();
        if (!(await this.installed(client))) writesUnavailable();
        await this.lockGame(client, gameId);
        const now = (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        await this.assertMutationBudget(client, gameId, userId);
        const existing = (
          await client.query<NoteRow>(
            `SELECT * FROM game_personal_notes
             WHERE game_id = $1 AND context_id = $2 AND author_user_id = $3 FOR UPDATE`,
            [gameId, contextId, userId],
          )
        ).rows[0];
        if (!existing || existing.author_user_id !== userId) privateMissing();
        if (existing.deleted_at) {
          return {
            statusCode: 200,
            body: { gameId, contextId, version: existing.version, deleted: true as const },
          };
        }
        if (existing.version !== body.expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия заметки устарела");
        }
        const nextVersion = existing.version + 1;
        await client.query(
          `UPDATE game_personal_notes
           SET text = NULL, deleted_at = $2, version = $3, updated_at = $2
           WHERE id = $1`,
          [existing.id, now, nextVersion],
        );
        await client.query(
          `INSERT INTO game_personal_note_revisions
             (note_id, game_id, context_id, resource_version, actor_user_id, recorded_at,
              before_text, after_text, tombstone)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,true)`,
          [existing.id, gameId, contextId, nextVersion, userId, now, existing.text],
        );
        return {
          statusCode: 200,
          body: { gameId, contextId, version: nextVersion, deleted: true as const },
        };
      },
    });
  }

  async getOwnNote(
    userId: string,
    gameIdRaw: string,
    contextIdRaw: string,
  ): Promise<PersonalNoteView> {
    const gameId = parseGameId(gameIdRaw);
    const contextId = parseContextId(contextIdRaw);
    if (!(await this.installed(this.pool))) privateMissing();
    const row = (
      await this.pool.query<NoteRow>(
        `SELECT * FROM game_personal_notes
         WHERE game_id = $1 AND context_id = $2 AND author_user_id = $3 AND deleted_at IS NULL`,
        [gameId, contextId, userId],
      )
    ).rows[0];
    if (!row) privateMissing();
    const projected = await this.projectNote(this.pool, row, postGameWritesEnabled(this.env));
    if (!projected) privateMissing();
    return projected;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505",
  );
}
