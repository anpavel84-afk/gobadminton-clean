import type { ParticipationConfirmedPayload } from "@gobadminton/contracts/game-types";
import type { AppEnv } from "../config/env";
import { assertNewGameInteraction } from "../game-moderation/projection";
import {
  availablePlaces,
  validateCapacityInvariant,
} from "../domain/capacity";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { conflict, notFound, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { OutboxService } from "../common/outbox.service";
import { GameChatService } from "../game-chat/game-chat.service";
import { GameAuthorityService } from "../games/game-authority.service";
import { APP_ENV, DATABASE_POOL } from "../tokens";

export type ParticipationStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "withdrawn"
  | "removed"
  | "cancelled_by_game"
  | "expired";

export type ParticipationDto = {
  id: string;
  gameId: string;
  userId: string;
  status: ParticipationStatus;
  version: number;
  attemptNumber: number;
  requestedAt: string;
  confirmedAt: string | null;
  isCreatorOrganizer?: boolean;
};

type ParticipationRow = {
  id: string;
  game_id: string;
  user_id: string;
  status: ParticipationStatus;
  version: number;
  attempt_number: number;
  requested_at: Date;
  confirmed_at: Date | null;
  is_creator_organizer: boolean;
};

type LockedGame = {
  id: string;
  organizer_id: string | null;
  status: string;
  version: number;
  capacity: number;
  external_reserved_count: number;
  starts_at: Date;
  application_deadline_at: Date;
};

@Injectable()
export class ParticipationsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    private readonly outbox: OutboxService,
    private readonly gameAuthority: GameAuthorityService,
    private readonly gameChat: GameChatService,
  ) {}

  /** Only new regular drafts: caller inserted Game and granted owner in this transaction. */
  async initializeCreatorSeat(client: PoolClient, gameId: string, userId: string): Promise<void> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO participations (game_id, user_id, status, attempt_number, version, requested_at, confirmed_at)
       SELECT id, created_by_user_id, 'confirmed', 1, 1, now(), now()
       FROM games WHERE id=$1 AND created_by_user_id=$2 AND status='draft' AND activity_kind='regular'
       RETURNING id`, [gameId, userId]);
    if (!inserted.rows[0]) throw conflict("CREATOR_SEAT_INVALID", "Нельзя создать место организатора");
    const id = inserted.rows[0].id;
    await this.writeTransition(client, { participationId: id, fromStatus: null, toStatus: "confirmed",
      actorId: userId, reasonCode: "creator_initial_seat", reasonText: null, aggregateVersion: 1, gameVersion: 1 });
    // Evidence only: no requested event, pg-boss job, inbox or draft-room delivery.
    await this.outbox.enqueue(client, { type: "participation.confirmed", aggregateType: "participation",
      aggregateId: id, aggregateVersion: 1, payload: { participationId: id, gameId, userId,
        status: "confirmed", attemptNumber: 1, origin: "creator_initial_seat" } satisfies ParticipationConfirmedPayload });
  }

  async request(
    userId: string,
    sessionId: string,
    gameId: string,
    idempotencyKey: string,
    expectedGameVersion: number,
    sourceCode?: string,
  ): Promise<{ statusCode: number; body: ParticipationDto }> {
    if (!Number.isInteger(expectedGameVersion) || expectedGameVersion < 1) {
      throw unprocessable(
        "EXPECTED_GAME_VERSION_INVALID",
        "Некорректный expectedGameVersion",
      );
    }
    const normalizedSource =
      typeof sourceCode === "string" && sourceCode.length > 0
        ? sourceCode.slice(0, 128)
        : null;
    const operation = "participations.request";
    const requestHash = this.idempotency.requestHash({
      gameId,
      expectedGameVersion,
      sourceCode: normalizedSource,
    });
    return this.mutations.runIdempotent<ParticipationDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const game = await this.lockGame(client, gameId);
        void game;
        // Player owns the participation target; verify actor still active owner
        // of any existing row for this game (or allow first-request replay).
        const existing = await client.query<{ user_id: string }>(
          `SELECT user_id FROM participations
           WHERE game_id = $1 AND user_id = $2`,
          [gameId, userId],
        );
        if (existing.rows[0] && existing.rows[0].user_id !== userId) {
          throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
        }
      },
      execute: async (client) => {
        const game = await this.lockGame(client, gameId);
        await assertNewGameInteraction(client, gameId, this.env.GAME_MODERATION_INTERNAL_ENABLED);
        if (game.version !== expectedGameVersion) {
          throw conflict("VERSION_CONFLICT", "Версия игры устарела");
        }
        if (game.status !== "published") {
          throw conflict(
            "GAME_NOT_PUBLISHED",
            "Заявка доступна только для published игры",
          );
        }
        const now = new Date();
        if (now > game.application_deadline_at) {
          throw conflict("APPLICATION_CLOSED", "Запись на игру закрыта");
        }
        if (now >= game.starts_at) {
          throw conflict("GAME_ALREADY_STARTED", "Игра уже началась");
        }

        const existing = await client.query<ParticipationRow>(
          `SELECT id, game_id, user_id, status, version, attempt_number,
                  requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer
           FROM participations
           WHERE game_id = $1 AND user_id = $2
           FOR UPDATE`,
          [game.id, userId],
        );
        const row = existing.rows[0];
        if (row?.status === "pending" || row?.status === "confirmed") {
          return { statusCode: 200, body: mapParticipation(row) };
        }
        const confirmedCount = await this.countConfirmed(client, game.id);
        const places = placesOrThrow(game, confirmedCount);
        if (places <= 0) {
          throw conflict("GAME_FULL", "Нет свободных мест");
        }


        const statusCode = 201;
        let body: ParticipationDto;

        if (!row) {
          const inserted = await client.query<ParticipationRow>(
            `INSERT INTO participations
               (game_id, user_id, status, attempt_number, version, requested_at)
             VALUES ($1, $2, 'pending', 1, 1, now())
             RETURNING id, game_id, user_id, status, version, attempt_number,
                       requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
            [game.id, userId],
          );
          body = mapParticipation(inserted.rows[0]!);
          await this.writeTransition(client, {
            participationId: body.id,
            fromStatus: null,
            toStatus: "pending",
            actorId: userId,
            reasonCode: "requested",
            reasonText: null,
            aggregateVersion: body.version,
            gameVersion: game.version,
          });
          await this.outbox.enqueue(client, {
            type: "participation.requested",
            aggregateType: "participation",
            aggregateId: body.id,
            aggregateVersion: body.version,
            payload: {
              participationId: body.id,
              gameId: body.gameId,
              userId: body.userId,
              status: body.status,
              attemptNumber: body.attemptNumber,
              sourceCode: normalizedSource,
            },
          });
        } else if (row.status === "withdrawn") {
          const updated = await client.query<ParticipationRow>(
            `UPDATE participations
             SET status = 'pending',
                 attempt_number = attempt_number + 1,
                 version = version + 1,
                 requested_at = now(),
                 confirmed_at = NULL,
                 decision_reason = NULL,
                 updated_at = now()
             WHERE id = $1
             RETURNING id, game_id, user_id, status, version, attempt_number,
                       requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
            [row.id],
          );
          body = mapParticipation(updated.rows[0]!);
          await this.writeTransition(client, {
            participationId: body.id,
            fromStatus: "withdrawn",
            toStatus: "pending",
            actorId: userId,
            reasonCode: "reapplied",
            reasonText: null,
            aggregateVersion: body.version,
            gameVersion: game.version,
          });
          await this.outbox.enqueue(client, {
            type: "participation.requested",
            aggregateType: "participation",
            aggregateId: body.id,
            aggregateVersion: body.version,
            payload: {
              participationId: body.id,
              gameId: body.gameId,
              userId: body.userId,
              status: body.status,
              attemptNumber: body.attemptNumber,
              sourceCode: normalizedSource,
              reapply: true,
            },
          });
        } else {
          throw conflict(
            "PARTICIPATION_NOT_REOPENABLE",
            "Повторная заявка из текущего статуса недоступна",
          );
        }

        return { statusCode, body };
      },
    });
  }

  async confirm(
    actorId: string,
    sessionId: string,
    participationId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: ParticipationDto }> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const operation = "participations.confirm";
    const requestHash = this.idempotency.requestHash({
      participationId,
      expectedVersion,
    });
    return this.mutations.runIdempotent<ParticipationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const { game } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
      },
      execute: async (client) => {
        const { game, current } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        await this.gameAuthority.assertCanManage(client, game.id, actorId);

        if (current.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия заявки устарела");
        }
        if (current.status !== "pending") {
          throw conflict(
            "PARTICIPATION_NOT_PENDING",
            "Подтвердить можно только pending заявку",
          );
        }
        if (game.status !== "published") {
          throw conflict(
            "GAME_NOT_PUBLISHED",
            "Подтверждение доступно только для published игры",
          );
        }
        const now = new Date();
        if (now > game.application_deadline_at) {
          throw conflict("APPLICATION_CLOSED", "Дедлайн заявок истёк");
        }
        if (now >= game.starts_at) {
          throw conflict("GAME_ALREADY_STARTED", "Игра уже началась");
        }

        const confirmedCount = await this.countConfirmed(client, game.id);
        const places = placesOrThrow(game, confirmedCount);
        if (places <= 0) {
          throw conflict("GAME_FULL", "Нет свободных мест");
        }

        const updated = await client.query<ParticipationRow>(
          `UPDATE participations
           SET status = 'confirmed',
               version = version + 1,
               confirmed_at = now(),
               decision_reason = NULL,
               updated_at = now()
           WHERE id = $1
           RETURNING id, game_id, user_id, status, version, attempt_number,
                     requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
          [participationId],
        );
        const body = mapParticipation(updated.rows[0]!);
        const gameVersion = await this.bumpGameVersion(client, game.id);
        await this.writeTransition(client, {
          participationId: body.id,
          fromStatus: "pending",
          toStatus: "confirmed",
          actorId,
          reasonCode: "confirmed",
          reasonText: null,
          aggregateVersion: body.version,
          gameVersion,
        });
        await this.outbox.enqueue(client, {
          type: "participation.confirmed",
          aggregateType: "participation",
          aggregateId: body.id,
          aggregateVersion: body.version,
          payload: {
            participationId: body.id,
            gameId: body.gameId,
            userId: body.userId,
            status: body.status,
          },
        });
        await this.gameChat.upsertMemberInTransaction(
          client,
          body.gameId,
          body.userId,
          "member",
        );
        return { statusCode: 200, body };
      },
    });
  }

  async reject(
    actorId: string,
    sessionId: string,
    participationId: string,
    idempotencyKey: string,
    expectedVersion: number,
    reason: string,
  ): Promise<{ statusCode: number; body: ParticipationDto }> {
    const trimmed = requireReason(reason);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const operation = "participations.reject";
    const requestHash = this.idempotency.requestHash({
      participationId,
      expectedVersion,
      reason: trimmed,
    });
    return this.mutations.runIdempotent<ParticipationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const { game } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
      },
      execute: async (client) => {
        const { game, current } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
        if (current.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия заявки устарела");
        }
        if (current.status !== "pending") {
          throw conflict(
            "PARTICIPATION_NOT_PENDING",
            "Отклонить можно только pending заявку",
          );
        }

        const updated = await client.query<ParticipationRow>(
          `UPDATE participations
           SET status = 'rejected',
               version = version + 1,
               decision_reason = $2,
               updated_at = now()
           WHERE id = $1
           RETURNING id, game_id, user_id, status, version, attempt_number,
                     requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
          [participationId, trimmed],
        );
        const body = mapParticipation(updated.rows[0]!);
        await this.writeTransition(client, {
          participationId: body.id,
          fromStatus: "pending",
          toStatus: "rejected",
          actorId,
          reasonCode: "rejected",
          reasonText: trimmed,
          aggregateVersion: body.version,
          gameVersion: game.version,
        });
        await this.outbox.enqueue(client, {
          type: "participation.rejected",
          aggregateType: "participation",
          aggregateId: body.id,
          aggregateVersion: body.version,
          payload: {
            participationId: body.id,
            gameId: body.gameId,
            userId: body.userId,
            status: body.status,
            reason: trimmed,
          },
        });
        return { statusCode: 200, body };
      },
    });
  }

  async withdraw(
    actorId: string,
    sessionId: string,
    participationId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: ParticipationDto }> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const operation = "participations.withdraw";
    const requestHash = this.idempotency.requestHash({
      participationId,
      expectedVersion,
    });
    return this.mutations.runIdempotent<ParticipationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const { current } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        if (current.user_id !== actorId) {
          throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
        }
      },
      execute: async (client) => {
        const { game, current } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        if (current.user_id !== actorId) {
          throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
        }
        if (current.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия заявки устарела");
        }
        if (current.status !== "pending" && current.status !== "confirmed") {
          throw conflict(
            "PARTICIPATION_NOT_WITHDRAWABLE",
            "Снять заявку можно только из pending/confirmed",
          );
        }
        if (new Date() >= game.starts_at) {
          throw conflict("GAME_ALREADY_STARTED", "Игра уже началась");
        }

        const fromStatus = current.status;
        const updated = await client.query<ParticipationRow>(
          `UPDATE participations
           SET status = 'withdrawn',
               version = version + 1,
               confirmed_at = CASE WHEN status = 'confirmed' THEN confirmed_at ELSE NULL END,
               updated_at = now()
           WHERE id = $1
           RETURNING id, game_id, user_id, status, version, attempt_number,
                     requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
          [participationId],
        );
        const body = mapParticipation(updated.rows[0]!);
        const gameVersion =
          fromStatus === "confirmed"
            ? await this.bumpGameVersion(client, game.id)
            : game.version;
        await this.writeTransition(client, {
          participationId: body.id,
          fromStatus,
          toStatus: "withdrawn",
          actorId,
          reasonCode: "withdrawn",
          reasonText: null,
          aggregateVersion: body.version,
          gameVersion,
        });
        await this.outbox.enqueue(client, {
          type: "participation.withdrawn",
          aggregateType: "participation",
          aggregateId: body.id,
          aggregateVersion: body.version,
          payload: {
            participationId: body.id,
            gameId: body.gameId,
            userId: body.userId,
            status: body.status,
            fromStatus,
          },
        });
        if (fromStatus === "confirmed") {
          await this.gameChat.revokeMemberInTransaction(
            client,
            body.gameId,
            body.userId,
          );
        }
        return { statusCode: 200, body };
      },
    });
  }

  async remove(
    actorId: string,
    sessionId: string,
    participationId: string,
    idempotencyKey: string,
    expectedVersion: number,
    reason: string,
  ): Promise<{ statusCode: number; body: ParticipationDto }> {
    const trimmed = requireReason(reason);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const operation = "participations.remove";
    const requestHash = this.idempotency.requestHash({
      participationId,
      expectedVersion,
      reason: trimmed,
    });
    return this.mutations.runIdempotent<ParticipationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const { game } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
      },
      execute: async (client) => {
        const { game, current } = await this.lockGameThenParticipation(
          client,
          participationId,
        );
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
        if (current.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия заявки устарела");
        }
        if (current.status !== "confirmed") {
          throw conflict(
            "PARTICIPATION_NOT_CONFIRMED",
            "Удалить можно только confirmed участника",
          );
        }
        if (new Date() >= game.starts_at) {
          throw conflict("GAME_ALREADY_STARTED", "Игра уже началась");
        }

        const updated = await client.query<ParticipationRow>(
          `UPDATE participations
           SET status = 'removed',
               version = version + 1,
               decision_reason = $2,
               updated_at = now()
           WHERE id = $1
           RETURNING id, game_id, user_id, status, version, attempt_number,
                     requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
          [participationId, trimmed],
        );
        const body = mapParticipation(updated.rows[0]!);
        const gameVersion = await this.bumpGameVersion(client, game.id);
        await this.writeTransition(client, {
          participationId: body.id,
          fromStatus: "confirmed",
          toStatus: "removed",
          actorId,
          reasonCode: "removed",
          reasonText: trimmed,
          aggregateVersion: body.version,
          gameVersion,
        });
        await this.outbox.enqueue(client, {
          type: "participation.removed",
          aggregateType: "participation",
          aggregateId: body.id,
          aggregateVersion: body.version,
          payload: {
            participationId: body.id,
            gameId: body.gameId,
            userId: body.userId,
            status: body.status,
            reason: trimmed,
          },
        });
        await this.gameChat.revokeMemberInTransaction(
          client,
          body.gameId,
          body.userId,
        );
        return { statusCode: 200, body };
      },
    });
  }

  async listForGame(
    actorId: string,
    gameId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: ParticipationDto[]; nextCursor: string | null }> {
    if (!isUuid(gameId)) {
      throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    }
    const limit = clampLimit(query.limit);
    const client = await this.pool.connect();
    try {
      const game = await client.query<{ id: string }>(
        `SELECT id FROM games WHERE id = $1`,
        [gameId],
      );
      if (!game.rows[0]) {
        throw notFound("GAME_NOT_FOUND", "Игра не найдена");
      }
      try {
        await this.gameAuthority.assertCanManage(client, gameId, actorId);
      } catch (error) {
        // Identical 404 for foreign private resources.
        if (
          error instanceof Error &&
          "getStatus" in error &&
          typeof (error as { getStatus: () => number }).getStatus ===
            "function" &&
          ((error as { getStatus: () => number }).getStatus() === 403 ||
            (error as { getStatus: () => number }).getStatus() === 404)
        ) {
          throw notFound("GAME_NOT_FOUND", "Игра не найдена");
        }
        throw error;
      }

      let cursorAt: Date | null = null;
      let cursorId: string | null = null;
      if (query.cursor) {
        const decoded = decodeCursor(query.cursor);
        cursorAt = decoded.at;
        cursorId = decoded.id;
      }
      const params: unknown[] = [gameId];
      const where = [`p.game_id = $1`];
      if (cursorAt && cursorId) {
        params.push(cursorAt, cursorId);
        where.push(
          `(p.requested_at, p.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(limit + 1);
      const result = await client.query<ParticipationRow>(
        `SELECT id, game_id, user_id, status, version, attempt_number,
                requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer
         FROM participations p
         WHERE ${where.join(" AND ")}
         ORDER BY p.requested_at ASC, p.id ASC
         LIMIT $${params.length}`,
        params,
      );
      const rows = result.rows;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        items: page.map(mapParticipation),
        nextCursor:
          hasMore && last
            ? encodeCursor(last.requested_at, last.id)
            : null,
      };
    } finally {
      client.release();
    }
  }

  async listMine(
    userId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: ParticipationDto[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);
    let cursorAt: Date | null = null;
    let cursorId: string | null = null;
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      cursorAt = decoded.at;
      cursorId = decoded.id;
    }
    const params: unknown[] = [userId];
    const where = [`p.user_id = $1`];
    if (cursorAt && cursorId) {
      params.push(cursorAt, cursorId);
      where.push(
        `(p.requested_at, p.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(limit + 1);
    const result = await this.pool.query<ParticipationRow>(
      `SELECT id, game_id, user_id, status, version, attempt_number,
              requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer
       FROM participations p
       WHERE ${where.join(" AND ")}
       ORDER BY p.requested_at ASC, p.id ASC
       LIMIT $${params.length}`,
      params,
    );
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(mapParticipation),
      nextCursor:
        hasMore && last ? encodeCursor(last.requested_at, last.id) : null,
    };
  }

  /**
   * Cascade active participations to cancelled_by_game inside an open txn
   * that already holds Game FOR UPDATE.
   */
  /**
   * Invitation accept path. Caller must already hold Game FOR UPDATE.
   * Uses the same capacity protocol as manager confirm; does not treat
   * the invitation itself as a reserved seat.
   */
  async confirmInviteeFromInvitation(
    client: PoolClient,
    input: {
      gameId: string;
      inviteeUserId: string;
      actorId: string;
    },
  ): Promise<ParticipationDto> {
    const game = await this.lockGame(client, input.gameId);
    await assertNewGameInteraction(client, input.gameId, this.env.GAME_MODERATION_INTERNAL_ENABLED);
    if (game.status !== "published") {
      throw conflict(
        "GAME_NOT_PUBLISHED",
        "Подтверждение доступно только для published игры",
      );
    }
    const now = new Date();
    if (now > game.application_deadline_at) {
      throw conflict("APPLICATION_CLOSED", "Дедлайн заявок истёк");
    }
    if (now >= game.starts_at) {
      throw conflict("GAME_ALREADY_STARTED", "Игра уже началась");
    }

    const existing = await client.query<ParticipationRow>(
      `SELECT id, game_id, user_id, status, version, attempt_number,
              requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer
       FROM participations
       WHERE game_id = $1 AND user_id = $2
       FOR UPDATE`,
      [game.id, input.inviteeUserId],
    );
    const row = existing.rows[0];

    if (row?.status === "confirmed") {
      return mapParticipation(row);
    }
    if (
      row &&
      row.status !== "pending" &&
      row.status !== "withdrawn"
    ) {
      throw conflict(
        "PARTICIPATION_TERMINAL",
        "Заявка на эту игру уже в терминальном состоянии",
      );
    }

    const confirmedCount = await this.countConfirmed(client, game.id);
    const places = placesOrThrow(game, confirmedCount);
    if (places <= 0) {
      throw conflict("GAME_FULL", "Нет свободных мест");
    }

    let body: ParticipationDto;
    const fromStatus: ParticipationStatus | null = row?.status ?? null;

    if (!row) {
      const inserted = await client.query<ParticipationRow>(
        `INSERT INTO participations
           (game_id, user_id, status, attempt_number, version, requested_at, confirmed_at)
         VALUES ($1, $2, 'confirmed', 1, 1, now(), now())
         RETURNING id, game_id, user_id, status, version, attempt_number,
                   requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
        [game.id, input.inviteeUserId],
      );
      body = mapParticipation(inserted.rows[0]!);
    } else if (row.status === "pending") {
      const updated = await client.query<ParticipationRow>(
        `UPDATE participations
         SET status = 'confirmed',
             version = version + 1,
             confirmed_at = now(),
             decision_reason = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING id, game_id, user_id, status, version, attempt_number,
                   requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
        [row.id],
      );
      body = mapParticipation(updated.rows[0]!);
    } else {
      const updated = await client.query<ParticipationRow>(
        `UPDATE participations
         SET status = 'confirmed',
             attempt_number = attempt_number + 1,
             version = version + 1,
             requested_at = now(),
             confirmed_at = now(),
             decision_reason = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING id, game_id, user_id, status, version, attempt_number,
                   requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
        [row.id],
      );
      body = mapParticipation(updated.rows[0]!);
    }

    const gameVersion = await this.bumpGameVersion(client, game.id);
    await this.writeTransition(client, {
      participationId: body.id,
      fromStatus,
      toStatus: "confirmed",
      actorId: input.actorId,
      reasonCode: "invitation_accepted",
      reasonText: null,
      aggregateVersion: body.version,
      gameVersion,
    });
    await this.outbox.enqueue(client, {
      type: "participation.confirmed",
      aggregateType: "participation",
      aggregateId: body.id,
      aggregateVersion: body.version,
      payload: {
        participationId: body.id,
        gameId: body.gameId,
        userId: body.userId,
        status: body.status,
        source: "game_invitation",
      },
    });
    await this.gameChat.upsertMemberInTransaction(
      client,
      body.gameId,
      body.userId,
      "member",
    );
    return body;
  }

  async cascadeCancelInTransaction(
    client: PoolClient,
    gameId: string,
    gameVersion: number,
    actorId: string,
  ): Promise<number> {
    const active = await client.query<ParticipationRow>(
      `SELECT id, game_id, user_id, status, version, attempt_number,
              requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer
       FROM participations
       WHERE game_id = $1
         AND status IN ('pending', 'confirmed')
       FOR UPDATE`,
      [gameId],
    );
    let count = 0;
    for (const row of active.rows) {
      const updated = await client.query<ParticipationRow>(
        `UPDATE participations
         SET status = 'cancelled_by_game',
             version = version + 1,
             updated_at = now()
         WHERE id = $1
         RETURNING id, game_id, user_id, status, version, attempt_number,
                   requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
        [row.id],
      );
      const body = mapParticipation(updated.rows[0]!);
      await this.writeTransition(client, {
        participationId: body.id,
        fromStatus: row.status,
        toStatus: "cancelled_by_game",
        actorId,
        reasonCode: "game_cancelled",
        reasonText: null,
        aggregateVersion: body.version,
        gameVersion,
      });
      await this.outbox.enqueue(client, {
        type: "participation.cancelled_by_game",
        aggregateType: "participation",
        aggregateId: body.id,
        aggregateVersion: body.version,
        payload: {
          participationId: body.id,
          gameId: body.gameId,
          userId: body.userId,
          status: body.status,
          fromStatus: row.status,
        },
      });
      count += 1;
    }
    return count;
  }

  /**
   * Bounded internal expire path for overdue pending after applicationDeadlineAt.
   * Not a public HTTP surface.
   */
  async expireOverduePending(now = new Date()): Promise<{ expired: number }> {
    const dueGames = await this.pool.query<{ id: string }>(
      `SELECT g.id
       FROM games g
       WHERE g.status = 'published'
         AND g.application_deadline_at < $1
         AND EXISTS (
           SELECT 1 FROM participations p
           WHERE p.game_id = g.id AND p.status = 'pending'
         )
       ORDER BY g.application_deadline_at ASC, g.id ASC
       LIMIT 20`,
      [now],
    );
    let expired = 0;
    for (const gameRow of dueGames.rows) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query<LockedGame>(
          `SELECT id, organizer_id, status, version, capacity, external_reserved_count,
                  starts_at, application_deadline_at
           FROM games
           WHERE id = $1
           FOR UPDATE SKIP LOCKED`,
          [gameRow.id],
        );
        const game = locked.rows[0];
        if (!game) {
          await client.query("ROLLBACK");
          continue;
        }
        if (
          game.status !== "published" ||
          game.application_deadline_at >= now
        ) {
          await client.query("COMMIT");
          continue;
        }
        const pending = await client.query<ParticipationRow>(
          `SELECT id, game_id, user_id, status, version, attempt_number,
                  requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer
           FROM participations
           WHERE game_id = $1 AND status = 'pending'
           FOR UPDATE`,
          [game.id],
        );
        for (const row of pending.rows) {
          const updated = await client.query<ParticipationRow>(
            `UPDATE participations
             SET status = 'expired',
                 version = version + 1,
                 updated_at = now()
             WHERE id = $1
             RETURNING id, game_id, user_id, status, version, attempt_number,
                       requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer`,
            [row.id],
          );
          const body = mapParticipation(updated.rows[0]!);
          await this.writeTransition(client, {
            participationId: body.id,
            fromStatus: "pending",
            toStatus: "expired",
            actorId: null,
            reasonCode: "deadline_expired",
            reasonText: null,
            aggregateVersion: body.version,
            gameVersion: game.version,
          });
          await this.outbox.enqueue(client, {
            type: "participation.expired",
            aggregateType: "participation",
            aggregateId: body.id,
            aggregateVersion: body.version,
            payload: {
              participationId: body.id,
              gameId: body.gameId,
              userId: body.userId,
              status: body.status,
            },
          });
          expired += 1;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        // Skip games locked by concurrent commands; retry on a later sweep.
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "55P03"
        ) {
          continue;
        }
        throw error;
      } finally {
        client.release();
      }
    }
    return { expired };
  }

  private async lockGame(
    client: PoolClient,
    gameId: string,
  ): Promise<LockedGame> {
    if (!isUuid(gameId)) {
      throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    }
    const result = await client.query<LockedGame>(
      `SELECT id, organizer_id, status, version, capacity, external_reserved_count,
              starts_at, application_deadline_at
       FROM games
       WHERE id = $1
       FOR UPDATE`,
      [gameId],
    );
    const row = result.rows[0];
    if (!row) throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    return row;
  }

  /**
   * Unlocked pre-read of immutable game_id, then Game FOR UPDATE, then
   * Participation FOR UPDATE with identity re-check (F-01).
   */
  private async lockGameThenParticipation(
    client: PoolClient,
    participationId: string,
  ): Promise<{ game: LockedGame; current: ParticipationRow }> {
    if (!isUuid(participationId)) {
      throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
    }
    const peek = await client.query<{ game_id: string }>(
      `SELECT game_id FROM participations WHERE id = $1`,
      [participationId],
    );
    const peeked = peek.rows[0];
    if (!peeked) {
      throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
    }
    const game = await this.lockGame(client, peeked.game_id);
    const current = await this.lockParticipation(client, participationId);
    if (current.game_id !== game.id) {
      throw conflict(
        "PARTICIPATION_GAME_MISMATCH",
        "Заявка не соответствует заблокированной игре",
      );
    }
    return { game, current };
  }

  private async lockParticipation(
    client: PoolClient,
    participationId: string,
  ): Promise<ParticipationRow> {
    if (!isUuid(participationId)) {
      throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
    }
    const result = await client.query<ParticipationRow>(
      `SELECT id, game_id, user_id, status, version, attempt_number,
              requested_at, confirmed_at,
              (SELECT COALESCE(g.created_by_user_id = user_id, false) FROM games g WHERE g.id = game_id) AS is_creator_organizer
       FROM participations
       WHERE id = $1
       FOR UPDATE`,
      [participationId],
    );
    const row = result.rows[0];
    if (!row) throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
    return row;
  }

  private async bumpGameVersion(
    client: PoolClient,
    gameId: string,
  ): Promise<number> {
    const result = await client.query<{ version: number }>(
      `UPDATE games
       SET version = version + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING version`,
      [gameId],
    );
    return result.rows[0]!.version;
  }

  private async countConfirmed(
    client: PoolClient,
    gameId: string,
  ): Promise<number> {
    const result = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM participations
       WHERE game_id = $1 AND status = 'confirmed'`,
      [gameId],
    );
    return result.rows[0]!.c;
  }

  private async writeTransition(
    client: PoolClient,
    input: {
      participationId: string;
      fromStatus: ParticipationStatus | null;
      toStatus: ParticipationStatus;
      actorId: string | null;
      reasonCode: string | null;
      reasonText: string | null;
      aggregateVersion: number;
      gameVersion: number;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO participation_transitions
         (participation_id, from_status, to_status, actor_id, reason_code,
          reason_text, aggregate_version, game_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.participationId,
        input.fromStatus,
        input.toStatus,
        input.actorId,
        input.reasonCode,
        input.reasonText,
        input.aggregateVersion,
        input.gameVersion,
      ],
    );
  }
}

function mapParticipation(row: ParticipationRow): ParticipationDto {
  return {
    id: row.id,
    gameId: row.game_id,
    userId: row.user_id,
    status: row.status,
    version: row.version,
    attemptNumber: row.attempt_number,
    requestedAt: row.requested_at.toISOString(),
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    isCreatorOrganizer: row.is_creator_organizer,
  };
}

function placesOrThrow(
  game: Pick<LockedGame, "capacity" | "external_reserved_count">,
  confirmedCount: number,
): number {
  const state = {
    capacity: game.capacity,
    externalReservedCount: game.external_reserved_count,
    confirmedCount,
  };
  const violation = validateCapacityInvariant(state);
  if (violation) {
    throw conflict("CAPACITY_INVARIANT", "Нарушен инвариант вместимости");
  }
  return availablePlaces(state);
}

function requireReason(reason: string): string {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 1 || trimmed.length > 1000) {
    throw unprocessable("REASON_INVALID", "Некорректная причина");
  }
  return trimmed;
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined) return 20;
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) {
    throw unprocessable("LIMIT_INVALID", "limit должен быть 1–100");
  }
  return raw;
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  if (cursor.length > 2048) {
    throw unprocessable("CURSOR_INVALID", "Некорректный cursor");
  }
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [atRaw, id] = raw.split("|");
    if (!atRaw || !id || !isUuid(id)) throw new Error("bad cursor");
    const at = new Date(atRaw);
    if (Number.isNaN(at.getTime())) throw new Error("bad cursor");
    return { at, id };
  } catch {
    throw unprocessable("CURSOR_INVALID", "Некорректный cursor");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
