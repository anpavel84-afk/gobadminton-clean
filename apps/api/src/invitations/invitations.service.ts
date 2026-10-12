import type { AppEnv } from "../config/env";
import { assertNewGameInteraction } from "../game-moderation/projection";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  conflict,
  notFound,
  unprocessable,
} from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { OutboxService } from "../common/outbox.service";
import {
  availablePlaces,
  validateCapacityInvariant,
} from "../domain/capacity";
import { GameAuthorityService } from "../games/game-authority.service";
import { JobEnqueueService } from "../jobs/job-enqueue.service";
import { DiscoveryProofHook } from "../messaging/discovery-proof.hook";
import {
  ParticipationsService,
  type ParticipationDto,
} from "../participations/participations.service";
import { ProfilesService } from "../profiles/profiles.service";
import { PairFenceService } from "../safety/pair-fence.service";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import {
  INVITATION_PAGE_DEFAULT,
  INVITATION_PAGE_MAX,
} from "./constants";
import { InvitationFeatureService } from "./invitation-feature";

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked"
  | "cancelled_by_game";

export type GameInvitationDto = {
  id: string;
  gameId: string;
  status: InvitationStatus;
  version: number;
  inviterPublicPlayerId: string | null;
  inviteePublicPlayerId: string | null;
  expiresAt: string | null;
  decidedAt: string | null;
  participationId: string | null;
  createdAt: string;
};

export type AcceptInvitationResultDto = {
  invitation: GameInvitationDto;
  participation: ParticipationDto;
};

type InvitationRow = {
  id: string;
  game_id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  pair_id: string;
  status: InvitationStatus;
  version: number;
  expires_at: Date | null;
  decided_at: Date | null;
  participation_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type LockedGame = {
  id: string;
  status: string;
  version: number;
  capacity: number;
  external_reserved_count: number;
  starts_at: Date;
  application_deadline_at: Date;
};

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    private readonly outbox: OutboxService,
    private readonly feature: InvitationFeatureService,
    private readonly gameAuthority: GameAuthorityService,
    private readonly participations: ParticipationsService,
    private readonly profiles: ProfilesService,
    private readonly pairs: PairFenceService,
    private readonly proofHook: DiscoveryProofHook,
    private readonly jobs: JobEnqueueService,
  ) {
    void this.pool;
  }

  async create(
    actorId: string,
    sessionId: string,
    gameId: string,
    idempotencyKey: string,
    input: {
      inviteePublicPlayerId?: string;
      expectedGameVersion?: number;
      discoveryProof?: string | null;
    },
  ): Promise<{ statusCode: number; body: GameInvitationDto }> {
    this.feature.assertEnabled();
    const normalized = normalizeCreate(input);
    const operation = "invitations.create";
    const requestHash = this.idempotency.requestHash({
      gameId,
      inviteePublicPlayerId: normalized.inviteePublicPlayerId,
      expectedGameVersion: normalized.expectedGameVersion,
      discoveryProof: normalized.discoveryProof ?? null,
    });
    return this.mutations.runIdempotent<GameInvitationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        const locked = await this.lockGame(client, body.gameId);
        await this.gameAuthority.assertCanManage(client, locked.id, actorId);
      },
      execute: async (client) => {
        const now = new Date();
        const game = await this.lockGame(client, gameId);
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
        await assertNewGameInteraction(client, gameId, this.env.GAME_MODERATION_INTERNAL_ENABLED);
        if (game.version !== normalized.expectedGameVersion) {
          throw conflict("GAME_VERSION_CHANGED", "Версия игры устарела");
        }
        if (game.status !== "published") {
          throw conflict(
            "GAME_NOT_PUBLISHED",
            "Приглашение доступно только для published игры",
          );
        }
        if (now > game.application_deadline_at) {
          throw conflict("APPLICATION_CLOSED", "Запись на игру закрыта");
        }
        if (now >= game.starts_at) {
          throw conflict("GAME_ALREADY_STARTED", "Игра уже началась");
        }

        const inviteeUserId = await this.profiles.resolveUserIdByPublicPlayerId(
          client,
          normalized.inviteePublicPlayerId,
        );
        if (!inviteeUserId || inviteeUserId === actorId) {
          throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
        }

        if (!this.proofHook.usesGeographicFence(normalized.discoveryProof)) await this.lockAccounts(client, [actorId, inviteeUserId]);
        await this.assertSocialEligible(client, actorId, inviteeUserId);
        const pair = await this.pairs.lockOrCreate(client, actorId, inviteeUserId);
        await this.assertNoBilateralBlock(client, actorId, inviteeUserId);
        await this.assertInviteeParticipationAllowsInvite(
          client,
          game.id,
          inviteeUserId,
        );

        const pending = await client.query<InvitationRow>(
          `SELECT * FROM game_invitations
           WHERE game_id = $1 AND invitee_user_id = $2 AND status = 'pending'
           FOR UPDATE`,
          [game.id, inviteeUserId],
        );
        if (pending.rows[0]) {
          const effective = await this.expireIfDue(client, pending.rows[0], now);
          if (effective.status === "pending") {
            throw conflict(
              "INVITATION_PENDING",
              "Уже есть ожидающее приглашение для этого игрока",
            );
          }
        }

        await this.proofHook.assertOptionalProof(client, {
          actorId,
          sessionId,
          targetUserId: inviteeUserId,
          discoveryProof: normalized.discoveryProof,
        });
        const expiresAt = this.feature.expiresAt(now, game.application_deadline_at);
        if (expiresAt <= now) {
          throw conflict("APPLICATION_CLOSED", "Запись на игру закрыта");
        }

        let inserted: InvitationRow;
        try {
          const result = await client.query<InvitationRow>(
            `INSERT INTO game_invitations (
               game_id, inviter_user_id, invitee_user_id, pair_id, status,
               version, expires_at, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, 'pending', 1, $5, $6, $6
             )
             RETURNING *`,
            [game.id, actorId, inviteeUserId, pair.id, expiresAt, now],
          );
          inserted = result.rows[0]!;
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw conflict(
              "INVITATION_PENDING",
              "Уже есть ожидающее приглашение для этого игрока",
            );
          }
          throw error;
        }

        await this.jobs.enqueueInvitationExpiry(client, {
          invitationId: inserted.id,
          version: inserted.version,
          expiresAt,
        });
        await this.outbox.enqueue(client, {
          type: "invitation.created",
          aggregateType: "game_invitation",
          aggregateId: inserted.id,
          aggregateVersion: inserted.version,
          payload: {
            invitationId: inserted.id,
            gameId: inserted.game_id,
            status: inserted.status,
          },
        });
        const dto=await this.toDto(client,inserted);
        await this.proofHook.assertFinalProof(client,{actorId,sessionId,targetUserId:inviteeUserId,discoveryProof:normalized.discoveryProof});
        return {
          statusCode: 201,
          body: dto,
        };
      },
    });
  }

  async accept(
    actorId: string,
    sessionId: string,
    invitationId: string,
    idempotencyKey: string,
    input: { expectedVersion?: number; expectedGameVersion?: number },
  ): Promise<{ statusCode: number; body: AcceptInvitationResultDto }> {
    this.feature.assertEnabled();
    const expectedVersion = requireVersion(input.expectedVersion, "expectedVersion");
    const expectedGameVersion = requireVersion(
      input.expectedGameVersion,
      "expectedGameVersion",
    );
    const operation = "invitations.accept";
    const requestHash = this.idempotency.requestHash({
      invitationId,
      expectedVersion,
      expectedGameVersion,
    });
    return this.mutations.runIdempotent<AcceptInvitationResultDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        const { invitation } = await this.lockGameThenInvitation(
          client,
          body.invitation.id,
        );
        if (invitation.invitee_user_id !== actorId) {
          throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
        }
      },
      execute: async (client) => {
        const now = new Date();
        const { game, invitation } = await this.lockGameThenInvitation(
          client,
          invitationId,
        );
        if (invitation.invitee_user_id !== actorId) {
          throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
        }
        await this.lockAccounts(client, [
          invitation.inviter_user_id,
          invitation.invitee_user_id,
        ]);
        await this.pairs.lockOrCreate(
          client,
          invitation.inviter_user_id,
          invitation.invitee_user_id,
        );
        await this.assertNoBilateralBlock(
          client,
          invitation.inviter_user_id,
          invitation.invitee_user_id,
        );
        await this.assertSocialEligible(
          client,
          invitation.inviter_user_id,
          invitation.invitee_user_id,
        );

        const effective = await this.expireIfDue(client, invitation, now);
        if (effective.status === "accepted") {
          if (
            effective.version === expectedVersion &&
            game.version === expectedGameVersion &&
            effective.participation_id
          ) {
            const participation = await this.loadParticipationDto(
              client,
              effective.participation_id,
            );
            return {
              statusCode: 200,
              body: {
                invitation: await this.toDto(client, effective),
                participation,
              },
            };
          }
          throw conflict("INVITATION_NOT_PENDING", "Приглашение уже принято");
        }
        if (effective.status !== "pending") {
          throw conflict(
            "INVITATION_NOT_PENDING",
            "Приглашение недоступно для принятия",
          );
        }
        if (effective.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия приглашения устарела");
        }
        const confirmedCount = await this.countConfirmed(client, game.id);
        const places = placesOrThrow(game, confirmedCount);
        if (places <= 0) {
          throw conflict("GAME_FULL", "Нет свободных мест");
        }
        if (game.version !== expectedGameVersion) {
          throw conflict("GAME_VERSION_CHANGED", "Версия игры устарела");
        }

        const participation = await this.participations.confirmInviteeFromInvitation(
          client,
          {
            gameId: game.id,
            inviteeUserId: actorId,
            actorId,
          },
        );

        const updated = await client.query<InvitationRow>(
          `UPDATE game_invitations
           SET status = 'accepted',
               version = version + 1,
               decided_at = $2,
               participation_id = $3,
               updated_at = $2
           WHERE id = $1 AND status = 'pending'
           RETURNING *`,
          [invitation.id, now, participation.id],
        );
        const next = updated.rows[0];
        if (!next) {
          throw conflict("INVITATION_NOT_PENDING", "Приглашение недоступно для принятия");
        }
        await this.outbox.enqueue(client, {
          type: "invitation.accepted",
          aggregateType: "game_invitation",
          aggregateId: next.id,
          aggregateVersion: next.version,
          payload: {
            invitationId: next.id,
            gameId: next.game_id,
            participationId: participation.id,
            status: next.status,
          },
        });
        return {
          statusCode: 200,
          body: {
            invitation: await this.toDto(client, next),
            participation,
          },
        };
      },
    });
  }

  async decline(
    actorId: string,
    sessionId: string,
    invitationId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: GameInvitationDto }> {
    this.feature.assertEnabled();
    const version = requireVersion(expectedVersion, "expectedVersion");
    const operation = "invitations.decline";
    const requestHash = this.idempotency.requestHash({
      invitationId,
      expectedVersion: version,
    });
    return this.mutations.runIdempotent<GameInvitationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        const { invitation } = await this.lockGameThenInvitation(
          client,
          body.id,
        );
        if (invitation.invitee_user_id !== actorId) {
          throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
        }
      },
      execute: async (client) => {
        const now = new Date();
        const { invitation } = await this.lockGameThenInvitation(
          client,
          invitationId,
        );
        if (invitation.invitee_user_id !== actorId) {
          throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
        }
        const effective = await this.expireIfDue(client, invitation, now);
        if (effective.status === "declined" && effective.version === version) {
          return { statusCode: 200, body: await this.toDto(client, effective) };
        }
        if (effective.status !== "pending") {
          throw conflict(
            "INVITATION_NOT_PENDING",
            "Приглашение недоступно для отклонения",
          );
        }
        if (effective.version !== version) {
          throw conflict("VERSION_CONFLICT", "Версия приглашения устарела");
        }
        const updated = await this.transition(
          client,
          effective.id,
          "declined",
          now,
        );
        await this.outbox.enqueue(client, {
          type: "invitation.declined",
          aggregateType: "game_invitation",
          aggregateId: updated.id,
          aggregateVersion: updated.version,
          payload: {
            invitationId: updated.id,
            gameId: updated.game_id,
            status: updated.status,
          },
        });
        return { statusCode: 200, body: await this.toDto(client, updated) };
      },
    });
  }

  async revoke(
    actorId: string,
    sessionId: string,
    invitationId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: GameInvitationDto }> {
    this.feature.assertEnabled();
    const version = requireVersion(expectedVersion, "expectedVersion");
    const operation = "invitations.revoke";
    const requestHash = this.idempotency.requestHash({
      invitationId,
      expectedVersion: version,
    });
    return this.mutations.runIdempotent<GameInvitationDto>({
      actorId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        const { game } = await this.lockGameThenInvitation(client, body.id);
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
      },
      execute: async (client) => {
        const now = new Date();
        const { game, invitation } = await this.lockGameThenInvitation(
          client,
          invitationId,
        );
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
        const effective = await this.expireIfDue(client, invitation, now);
        if (effective.status === "revoked" && effective.version === version) {
          return { statusCode: 200, body: await this.toDto(client, effective) };
        }
        if (effective.status !== "pending") {
          throw conflict(
            "INVITATION_NOT_PENDING",
            "Отозвать можно только ожидающее приглашение",
          );
        }
        if (effective.version !== version) {
          throw conflict("VERSION_CONFLICT", "Версия приглашения устарела");
        }
        const updated = await this.transition(
          client,
          effective.id,
          "revoked",
          now,
        );
        await this.outbox.enqueue(client, {
          type: "invitation.revoked",
          aggregateType: "game_invitation",
          aggregateId: updated.id,
          aggregateVersion: updated.version,
          payload: {
            invitationId: updated.id,
            gameId: updated.game_id,
            status: updated.status,
          },
        });
        return { statusCode: 200, body: await this.toDto(client, updated) };
      },
    });
  }

  async getOne(actorId: string, invitationId: string): Promise<GameInvitationDto> {
    this.feature.assertEnabled();
    if (!isUuid(invitationId)) {
      throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
    }
    const client = await this.pool.connect();
    try {
      const peeked = await client.query<{ game_id: string }>(
        `SELECT game_id FROM game_invitations WHERE id = $1`,
        [invitationId],
      );
      if (!peeked.rows[0]) {
        throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
      }
      await client.query("BEGIN");
      try {
        const { invitation } = await this.lockGameThenInvitation(
          client,
          invitationId,
        );
        const visible = await this.canView(client, actorId, invitation);
        if (!visible) {
          await client.query("ROLLBACK");
          throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
        }
        const effective = await this.expireIfDue(client, invitation, new Date());
        const dto = await this.toDto(client, effective);
        await client.query("COMMIT");
        return dto;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async listForGame(
    actorId: string,
    gameId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: GameInvitationDto[]; nextCursor: string | null }> {
    this.feature.assertEnabled();
    const limit = clampLimit(query.limit);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const game = await this.lockGame(client, gameId);
        await this.gameAuthority.assertCanManage(client, game.id, actorId);
        await this.expireDueForGame(client, game.id);
        const params: unknown[] = [game.id];
        let where =
          "game_id = $1";
        if (query.cursor) {
          const decoded = decodeCursor(query.cursor);
          params.push(decoded.at, decoded.id);
          where += ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
        }
        params.push(limit + 1);
        const result = await client.query<InvitationRow>(
          `SELECT * FROM game_invitations
           WHERE ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT $${params.length}`,
          params,
        );
        const hasMore = result.rows.length > limit;
        const page = hasMore ? result.rows.slice(0, limit) : result.rows;
        const items = await Promise.all(page.map((row) => this.toDto(client, row)));
        const last = page[page.length - 1];
        await client.query("COMMIT");
        return {
          items,
          nextCursor:
            hasMore && last ? encodeCursor(last.created_at, last.id) : null,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async listMine(
    actorId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: GameInvitationDto[]; nextCursor: string | null }> {
    this.feature.assertEnabled();
    const limit = clampLimit(query.limit);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await this.expireDueForInvitee(client, actorId);
        const params: unknown[] = [actorId];
        let where = "invitee_user_id = $1";
        if (query.cursor) {
          const decoded = decodeCursor(query.cursor);
          params.push(decoded.at, decoded.id);
          where += ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
        }
        params.push(limit + 1);
        const result = await client.query<InvitationRow>(
          `SELECT * FROM game_invitations
           WHERE ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT $${params.length}`,
          params,
        );
        const hasMore = result.rows.length > limit;
        const page = hasMore ? result.rows.slice(0, limit) : result.rows;
        const items = await Promise.all(page.map((row) => this.toDto(client, row)));
        const last = page[page.length - 1];
        await client.query("COMMIT");
        return {
          items,
          nextCursor:
            hasMore && last ? encodeCursor(last.created_at, last.id) : null,
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async cascadeCancelInTransaction(
    client: PoolClient,
    gameId: string,
  ): Promise<number> {
    const pending = await client.query<InvitationRow>(
      `SELECT * FROM game_invitations
       WHERE game_id = $1 AND status = 'pending'
       FOR UPDATE`,
      [gameId],
    );
    let count = 0;
    const now = new Date();
    for (const row of pending.rows) {
      const updated = await this.transition(
        client,
        row.id,
        "cancelled_by_game",
        now,
      );
      await this.outbox.enqueue(client, {
        type: "invitation.cancelled_by_game",
        aggregateType: "game_invitation",
        aggregateId: updated.id,
        aggregateVersion: updated.version,
        payload: {
          invitationId: updated.id,
          gameId: updated.game_id,
          status: updated.status,
        },
      });
      count += 1;
    }
    return count;
  }

  private async lockGame(client: PoolClient, gameId: string): Promise<LockedGame> {
    if (!isUuid(gameId)) {
      throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    }
    const result = await client.query<LockedGame>(
      `SELECT id, status, version, capacity, external_reserved_count,
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

  private async lockGameThenInvitation(
    client: PoolClient,
    invitationId: string,
  ): Promise<{ game: LockedGame; invitation: InvitationRow }> {
    if (!isUuid(invitationId)) {
      throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
    }
    const peek = await client.query<{ game_id: string }>(
      `SELECT game_id FROM game_invitations WHERE id = $1`,
      [invitationId],
    );
    if (!peek.rows[0]) {
      throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
    }
    const game = await this.lockGame(client, peek.rows[0].game_id);
    const locked = await client.query<InvitationRow>(
      `SELECT * FROM game_invitations WHERE id = $1 FOR UPDATE`,
      [invitationId],
    );
    const invitation = locked.rows[0];
    if (!invitation) {
      throw notFound("INVITATION_NOT_FOUND", "Приглашение не найдено");
    }
    if (invitation.game_id !== game.id) {
      throw conflict("INVITATION_GAME_MISMATCH", "Приглашение не соответствует игре");
    }
    return { game, invitation };
  }

  private async expireIfDue(
    client: PoolClient,
    row: InvitationRow,
    now: Date,
  ): Promise<InvitationRow> {
    if (
      row.status === "pending" &&
      row.expires_at &&
      row.expires_at <= now
    ) {
      const updated = await this.transition(client, row.id, "expired", now);
      await this.outbox.enqueue(client, {
        type: "invitation.expired",
        aggregateType: "game_invitation",
        aggregateId: updated.id,
        aggregateVersion: updated.version,
        payload: {
          invitationId: updated.id,
          gameId: updated.game_id,
          status: updated.status,
        },
      });
      return updated;
    }
    return row;
  }

  private async expireDueForGame(client: PoolClient, gameId: string): Promise<void> {
    await client.query(
      `UPDATE game_invitations
       SET status = 'expired',
           version = version + 1,
           decided_at = now(),
           updated_at = now()
       WHERE game_id = $1
         AND status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at <= now()`,
      [gameId],
    );
  }

  private async expireDueForInvitee(
    client: PoolClient,
    inviteeUserId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE game_invitations
       SET status = 'expired',
           version = version + 1,
           decided_at = now(),
           updated_at = now()
       WHERE invitee_user_id = $1
         AND status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at <= now()`,
      [inviteeUserId],
    );
  }

  private async transition(
    client: PoolClient,
    invitationId: string,
    status: InvitationStatus,
    now: Date,
  ): Promise<InvitationRow> {
    const result = await client.query<InvitationRow>(
      `UPDATE game_invitations
       SET status = $2,
           version = version + 1,
           decided_at = $3,
           updated_at = $3
       WHERE id = $1
       RETURNING *`,
      [invitationId, status, now],
    );
    return result.rows[0]!;
  }

  private async canView(
    client: PoolClient,
    actorId: string,
    invitation: InvitationRow,
  ): Promise<boolean> {
    if (
      invitation.invitee_user_id === actorId ||
      invitation.inviter_user_id === actorId
    ) {
      return true;
    }
    const membership = await client.query(
      `SELECT 1 FROM game_managers
       WHERE game_id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      [invitation.game_id, actorId],
    );
    return Boolean(membership.rows[0]);
  }

  private async assertInviteeParticipationAllowsInvite(
    client: PoolClient,
    gameId: string,
    inviteeUserId: string,
  ): Promise<void> {
    const existing = await client.query<{ status: string }>(
      `SELECT status FROM participations
       WHERE game_id = $1 AND user_id = $2
       FOR UPDATE`,
      [gameId, inviteeUserId],
    );
    const status = existing.rows[0]?.status;
    if (!status) return;
    if (status === "pending" || status === "confirmed") {
      throw conflict(
        "PARTICIPATION_ACTIVE",
        "У игрока уже есть активная заявка на эту игру",
      );
    }
    if (status !== "withdrawn") {
      throw conflict(
        "PARTICIPATION_TERMINAL",
        "Заявка на эту игру уже в терминальном состоянии",
      );
    }
  }

  private async lockAccounts(
    client: PoolClient,
    userIds: string[],
  ): Promise<void> {
    const sorted = [...new Set(userIds)].sort();
    for (const id of sorted) {
      const result = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM users WHERE id = $1 FOR SHARE`,
        [id],
      );
      if (!result.rows[0] || result.rows[0].status !== "active") {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
    }
  }

  private async assertSocialEligible(
    client: PoolClient,
    a: string,
    b: string,
  ): Promise<void> {
    const result = await client.query<{ user_id: string; social_eligible: boolean }>(
      `SELECT user_id, social_eligible
       FROM player_social_profiles
       WHERE user_id IN ($1, $2)
       FOR SHARE`,
      [a, b],
    );
    const byId = new Map(result.rows.map((row) => [row.user_id, row]));
    if (
      !byId.get(a)?.social_eligible ||
      !byId.get(b)?.social_eligible
    ) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }

  private async assertNoBilateralBlock(
    client: PoolClient,
    a: string,
    b: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
       LIMIT 1`,
      [a, b],
    );
    if (result.rows[0]) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
  }

  private async toDto(
    client: PoolClient,
    row: InvitationRow,
  ): Promise<GameInvitationDto> {
    const profiles = await client.query<{
      user_id: string;
      public_player_id: string;
    }>(
      `SELECT user_id, public_player_id
       FROM player_social_profiles
       WHERE user_id IN ($1, $2)`,
      [row.inviter_user_id, row.invitee_user_id],
    );
    const byId = new Map(
      profiles.rows.map((item) => [item.user_id, item.public_player_id]),
    );
    return {
      id: row.id,
      gameId: row.game_id,
      status: row.status,
      version: row.version,
      inviterPublicPlayerId: byId.get(row.inviter_user_id) ?? null,
      inviteePublicPlayerId: byId.get(row.invitee_user_id) ?? null,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
      participationId: row.participation_id,
      createdAt: row.created_at.toISOString(),
    };
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

  private async loadParticipationDto(
    client: PoolClient,
    participationId: string,
  ): Promise<ParticipationDto> {
    const result = await client.query<{
      id: string;
      game_id: string;
      user_id: string;
      status: ParticipationDto["status"];
      version: number;
      attempt_number: number;
      requested_at: Date;
      confirmed_at: Date | null;
    }>(
      `SELECT id, game_id, user_id, status, version, attempt_number,
              requested_at, confirmed_at
       FROM participations WHERE id = $1`,
      [participationId],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFound("PARTICIPATION_NOT_FOUND", "Заявка не найдена");
    }
    return {
      id: row.id,
      gameId: row.game_id,
      userId: row.user_id,
      status: row.status,
      version: row.version,
      attemptNumber: row.attempt_number,
      requestedAt: row.requested_at.toISOString(),
      confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
    };
  }
}

function normalizeCreate(input: {
  inviteePublicPlayerId?: string;
  expectedGameVersion?: number;
  discoveryProof?: string | null;
}): {
  inviteePublicPlayerId: string;
  expectedGameVersion: number;
  discoveryProof?: string | null;
} {
  if (
    !input.inviteePublicPlayerId ||
    !isUuid(input.inviteePublicPlayerId)
  ) {
    throw unprocessable(
      "INVITEE_INVALID",
      "Некорректный inviteePublicPlayerId",
    );
  }
  const expectedGameVersion = requireVersion(
    input.expectedGameVersion,
    "expectedGameVersion",
  );
  if (
    input.discoveryProof !== undefined &&
    input.discoveryProof !== null &&
    typeof input.discoveryProof !== "string"
  ) {
    throw unprocessable("DISCOVERY_PROOF_INVALID", "Некорректный discoveryProof");
  }
  return {
    inviteePublicPlayerId: input.inviteePublicPlayerId,
    expectedGameVersion,
    discoveryProof: input.discoveryProof,
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

function requireVersion(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw unprocessable(
      field === "expectedGameVersion"
        ? "EXPECTED_GAME_VERSION_INVALID"
        : "EXPECTED_VERSION_INVALID",
      `Некорректный ${field}`,
    );
  }
  return value as number;
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined) return INVITATION_PAGE_DEFAULT;
  if (!Number.isInteger(raw) || raw < 1 || raw > INVITATION_PAGE_MAX) {
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505"
  );
}
