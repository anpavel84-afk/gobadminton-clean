import { avatarForGameCreator, type PlayerAvatar } from "../profiles/avatar-presentation";
import { GamePreferencesService, normalizePublicGameContact, validatePreferenceVersion } from "../profiles/game-preferences.service";
import type { AppEnv } from "../config/env";
import { readModeration } from "../game-moderation/projection";
import {
  availablePlaces,
  validateCapacityInvariant,
} from "../domain/capacity";
import { Inject, Injectable, forwardRef } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  badRequest,
  conflict,
  notFound,
  unprocessable,
} from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { OutboxService } from "../common/outbox.service";
import { GameChatService } from "../game-chat/game-chat.service";
import { InvitationsService } from "../invitations/invitations.service";
import { ParticipationsService } from "../participations/participations.service";
import { TrainersService } from "../trainers/trainers.service";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { privateContactWebsite } from "../lib/original-http-authority";
import { effectiveVenueCtes } from "../venues/effective-venue.query";
import { eligibleGames, normalizeDiscovery, type DiscoveryInput } from "./games-discovery.query";
import { readGamesMap } from "./games-map.read";
import type { DiscoveryFilter } from "./games-discovery.query";
import { GameAuthorityService } from "./game-authority.service";
import { unrestrictedSql } from "../restrictions/policy";
import type { UnifiedUpcomingGame } from "@gobadminton/contracts/src/unified.generated";

/** Read only, inside the caller's redeemed Radar transaction. A public Game
 * does not make participation public. Every candidate is authorized before
 * LIMIT; Game fences serialize roster, management and moderation writers.
 */
export async function readRadarPlayerGames(
  client: PoolClient,
  viewerId: string,
  targetId: string,
  env: Pick<AppEnv, "SOCIAL_DIRECTORY_ENABLED" | "USER_RESTRICTIONS_INTERNAL_ENABLED" | "GAME_MODERATION_INTERNAL_ENABLED">,
): Promise<UnifiedUpcomingGame[]> {
  const eligible = eligibleGames(normalizeDiscovery({ temporalScope: "upcoming" }), env.GAME_MODERATION_INTERNAL_ENABLED);
  const relationship = `(
    ($3::boolean AND g.created_by_user_id=$2 AND EXISTS (
      SELECT 1 FROM player_social_profiles p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=$2 AND u.status='active' AND p.directory_visible AND p.social_eligible
        AND ${unrestrictedSql(env.USER_RESTRICTIONS_INTERNAL_ENABLED, "p.user_id", ["account.access", "profile.public", "social.directory"])}
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
          (b.blocker_user_id=$1 AND b.blocked_user_id=$2) OR
          (b.blocker_user_id=$2 AND b.blocked_user_id=$1))))
    OR (EXISTS (SELECT 1 FROM participations p WHERE p.game_id=g.id AND p.user_id=$2 AND p.status='confirmed')
      AND EXISTS (SELECT 1 FROM game_managers gm WHERE gm.game_id=g.id AND gm.user_id=$1
        AND gm.status='active' AND gm.role IN ('owner','manager')))
  )`;
  const params = [viewerId, targetId, env.SOCIAL_DIRECTORY_ENABLED];
  const from = `FROM games g JOIN effective_venues v ON v.source_id=g.venue_id
    WHERE ${eligible.where} AND ${relationship}`;
  const candidates = await client.query<{ id: string }>(`${effectiveVenueCtes()}
    SELECT g.id ${from} ORDER BY g.starts_at,g.id LIMIT 3`, params);
  const ids = candidates.rows.map(row => row.id).sort();
  if (!ids.length) return [];
  // Lock only the bounded distinct candidate set, in deterministic UUID order.
  // A separate statement after the wait MUST reread all relationship predicates.
  await client.query("SELECT id FROM games WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE", [ids]);
  const fresh = await client.query<GameRow>(`${effectiveVenueCtes()}
    SELECT ${gameSelectColumns()} ${from} AND g.id=ANY($4::uuid[])
    ORDER BY g.starts_at,g.id LIMIT 3`, [...params, ids]);
  return fresh.rows.map(row => {
    const game = mapGameRow(row);
    // Explicit allowlist: never spread a GameDto (contacts, IDs, roster, geo).
    return { id: game.id, title: game.title, activityKind: game.activityKind,
      startsAt: game.startsAt, endsAt: game.endsAt, timezone: game.timezone,
      cover: { uploadedUrl: game.cover?.uploadedUrl ?? null },
      venue: { name: game.venue.name, cover: { uploadedUrl: game.venue.cover?.uploadedUrl ?? null } } };
  });
}

export type SettlementDto =
  | {
      mode: "external";
      purpose: "no_trainer_fee";
      priceMinor: null;
      currency: null;
      terms: string;
    }
  | {
      mode: "external";
      purpose: "trainer_fee";
      priceStatus: "fixed";
      priceUnit: "per_player_per_session";
      priceMinor: string;
      currency: string;
      terms: string;
    }
  | {
      mode: "external";
      purpose: "trainer_fee";
      priceStatus: "by_agreement";
      priceMinor: null;
      currency: null;
      terms: string;
    };

export type GameTrainerSummary = {
  profileId: string;
  displayName: string;
  declarationSource: "self_declared";
};

export type GameDto = {
  cover?: { uploadedUrl: string | null };
  id: string;
  version: number;
  title: string;
  status: "draft" | "published" | "cancelled" | "completed";
  visibility: "public" | "unlisted";
  activityKind: "regular" | "trainer_led";
  trainer: GameTrainerSummary | null;
  trainingDescription: string | null;
  organizer: {
    /** Legacy organizer entity id when present; null under game-scoped create. */
    id: string | null;
    displayName: string;
    publicContact: string;
    avatar?: PlayerAvatar;
  };
  venue: {
    contactPhone?: string | null;
    contactWebsite?: string | null;
    bookingNote?: string | null;
    cover?: { uploadedUrl: string | null };
    id: string;
    name: string;
    cityId: string;
    address: string;
    timezone: string;
    latitude: number;
    longitude: number;
  };
  startsAt: string;
  endsAt: string;
  timezone: string;
  applicationDeadlineAt: string;
  capacity: number;
  externalReservedCount: number;
  confirmedCount: number;
  availablePlaces: number;
  formatKey: string;
  levelRule: {
    scaleId: string;
    scaleVersion: number;
    allowedLevelIds: string[];
  };
  settlement: SettlementDto;
};

export type ManagedGameDto = GameDto & {
  management: {
    role: "owner" | "manager";
    /** Server-derived from immutable games.created_by_user_id vs session user. */
    createdByMe: boolean;
  };
};

export type CreateGameInput = {
  hostDisplayName: string;
  hostPublicContact: string;
  savePublicContactDefault?: { expectedVersion: number };
  venueId: string;
  title?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  applicationDeadlineAt: string;
  capacity: number;
  externalReservedCount: number;
  visibility: "public" | "unlisted";
  formatKey: string;
  activityKind: "regular" | "trainer_led";
  trainingDescription?: string | null;
  levelRule: {
    scaleId: string;
    scaleVersion: number;
    allowedLevelIds: string[];
  };
  settlement: SettlementDto;
};

type NormalizedCreateGame = CreateGameInput & {
  title: string;
  trainingDescription: string | null;
};

type GameRow = {
  id: string;
  version: number;
  title: string;
  status: GameDto["status"];
  visibility: GameDto["visibility"];
  activity_kind: "regular" | "trainer_led" | null;
  trainer_profile_id: string | null;
  trainer_display_name_snapshot: string | null;
  training_description: string | null;
  starts_at: Date;
  ends_at: Date;
  timezone: string;
  application_deadline_at: Date;
  capacity: number;
  external_reserved_count: number;
  format_key: string;
  level_scale_id: string;
  level_scale_version: number;
  allowed_level_ids: string[];
  settlement_mode: "external";
  settlement_purpose: "no_trainer_fee" | "trainer_fee" | null;
  price_status: "fixed" | "by_agreement" | null;
  price_unit: "per_player_per_session" | null;
  price_minor: string | null;
  currency: string | null;
  settlement_terms: string;
  organizer_id: string | null;
  organizer_display_name: string;
  organizer_public_contact: string;
  venue_id: string;
  venue_name: string;
  venue_contact_phone: string | null;
  venue_contact_website: string | null;
  venue_booking_note: string | null;
  venue_contacts_allowed?: boolean;
  venue_city_id: string;
  venue_cover_url: string | null;
  game_cover_url: string | null;
  venue_address: string;
  venue_timezone: string;
  venue_latitude: number;
  venue_longitude: number;
  confirmed_count: number;
};

@Injectable()
export class GamesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
    private readonly outbox: OutboxService,
    private readonly gameAuthority: GameAuthorityService,
    private readonly trainers: TrainersService,
    private readonly gamePreferences: GamePreferencesService,
    @Inject(forwardRef(() => ParticipationsService))
    private readonly participations: ParticipationsService,
    @Inject(forwardRef(() => InvitationsService))
    private readonly invitations: InvitationsService,
    private readonly gameChat: GameChatService,
  ) {}

  async createDraft(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: CreateGameInput,
  ): Promise<{ statusCode: number; body: GameDto }> {
    const normalized = normalizeCreateGame(input);
    const operation = "games.create";
    const requestHash = this.idempotency.requestHash(normalized);
    return this.mutations.runIdempotent<GameDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client, body) => {
        // Cached create success references a Game; require current management.
        const locked = await this.lockGame(client, body.id);
        await this.gameAuthority.assertCanManage(client, locked.id, userId);
      },
      execute: async (client) => {
        assertFutureStart(new Date(normalized.startsAt));
        let trainerProfileId: string | null = null;
        let trainerDisplayNameSnapshot: string | null = null;
        if (normalized.activityKind === "trainer_led") {
          const profile = await this.trainers.lockActiveOwnProfile(
            client,
            userId,
          );
          trainerProfileId = profile.id;
          trainerDisplayNameSnapshot = profile.displayName;
        }

        await client.query("SELECT pg_advisory_xact_lock(hashtext('gobadminton_venue_catalog'))");
        const venue = await client.query<{id:string}>(
          effectiveVenueCtes("SELECT id FROM venues WHERE id=$1") +
          " SELECT id FROM effective_venues WHERE canonical_resolved AND lifecycle_state IN ('unverified','verified')",
          [normalized.venueId],
        );
        if (!venue.rows[0]) {
          throw unprocessable("VENUE_NOT_FOUND", "Площадка не найдена");
        }

        assertFutureStart(new Date(normalized.startsAt));
        const settlementFields = settlementColumns(normalized.settlement);
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO games (
             organizer_id, host_display_name, host_public_contact,
             venue_id, title, status, visibility,
             starts_at, ends_at, timezone, application_deadline_at,
             capacity, external_reserved_count, format_key,
             level_scale_id, level_scale_version, allowed_level_ids,
             activity_kind, trainer_profile_id, trainer_display_name_snapshot,
             training_description,
             settlement_mode, settlement_purpose, price_status, price_unit,
             price_minor, currency, settlement_terms,
             version, created_by_user_id
           ) VALUES (
             NULL,$1,$2,
             $3,$4,'draft',$5,
             $6,$7,$8,$9,
             $10,$11,$12,
             $13,$14,$15::jsonb,
             $16,$17,$18,
             $19,
             $20,$21,$22,$23,
             $24,$25,$26,
             1,$27
           )
           RETURNING id`,
          [
            normalized.hostDisplayName,
            normalized.hostPublicContact,
            venue.rows[0].id,
            normalized.title,
            normalized.visibility,
            normalized.startsAt,
            normalized.endsAt,
            normalized.timezone,
            normalized.applicationDeadlineAt,
            normalized.capacity,
            normalized.externalReservedCount,
            normalized.formatKey,
            normalized.levelRule.scaleId,
            normalized.levelRule.scaleVersion,
            JSON.stringify(normalized.levelRule.allowedLevelIds),
            normalized.activityKind,
            trainerProfileId,
            trainerDisplayNameSnapshot,
            normalized.trainingDescription,
            settlementFields.mode,
            settlementFields.purpose,
            settlementFields.priceStatus,
            settlementFields.priceUnit,
            settlementFields.priceMinor,
            settlementFields.currency,
            settlementFields.terms,
            userId,
          ],
        );
        const gameId = inserted.rows[0]!.id;
        await this.gameAuthority.grantOwner(client, gameId, userId);
        if (normalized.activityKind === "regular") {
          await this.participations.initializeCreatorSeat(client, gameId, userId);
        }
        if (normalized.savePublicContactDefault) {
          await this.gamePreferences.saveInTransaction(client, userId,
            normalized.savePublicContactDefault.expectedVersion, normalized.hostPublicContact);
        }
        const body = await this.loadGameDto(client, gameId);
        return { statusCode: 201, body };
      },
    });
  }

  async publish(
    userId: string,
    sessionId: string,
    gameId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: GameDto }> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const operation = "games.publish";
    const requestHash = this.idempotency.requestHash({ gameId, expectedVersion });
    return this.mutations.runIdempotent<GameDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const locked = await this.lockGame(client, gameId);
        await this.gameAuthority.assertCanManage(client, locked.id, userId);
      },
      execute: async (client) => {
        const locked = await this.lockGame(client, gameId);
        await this.gameAuthority.assertCanManage(client, locked.id, userId);
        if (locked.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия игры устарела");
        }
        if (locked.status !== "draft") {
          throw conflict("GAME_NOT_DRAFT", "Публиковать можно только draft");
        }
        if (!locked.activity_kind) {
          throw conflict(
            "GAME_ACTIVITY_UNCLASSIFIED",
            "Нельзя публиковать неклассифицированную legacy-игру",
          );
        }
        assertCapacityRow(locked);

        if (locked.activity_kind === "trainer_led") {
          if (!locked.trainer_profile_id) {
            throw conflict(
              "TRAINER_BINDING_MISSING",
              "У trainer-led игры отсутствует привязка тренера",
            );
          }
          await this.trainers.assertActiveProfileId(
            client,
            locked.trainer_profile_id,
            userId,
          );
        }

        assertFutureStart(locked.starts_at);
        const updated = await client.query<{ id: string }>(
          `UPDATE games
           SET status = 'published',
               version = version + 1,
               published_at = now(),
               updated_at = now()
           WHERE id = $1
           RETURNING id`,
          [gameId],
        );
        const body = await this.loadGameDto(client, updated.rows[0]!.id);
        await this.outbox.enqueue(client, {
          type: "game.published",
          aggregateType: "game",
          aggregateId: body.id,
          aggregateVersion: body.version,
          payload: {
            gameId: body.id,
            version: body.version,
            status: body.status,
            activityKind: body.activityKind,
            settlementPurpose: body.settlement.purpose,
          },
        });
        return { statusCode: 200, body };
      },
    });
  }

  async cancel(
    userId: string,
    sessionId: string,
    gameId: string,
    idempotencyKey: string,
    expectedVersion: number,
    reason: string,
  ): Promise<{ statusCode: number; body: GameDto }> {
    const trimmedReason = reason?.trim() ?? "";
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    if (trimmedReason.length < 1 || trimmedReason.length > 1000) {
      throw unprocessable("CANCEL_REASON_INVALID", "Некорректная причина отмены");
    }
    const operation = "games.cancel";
    const requestHash = this.idempotency.requestHash({
      gameId,
      expectedVersion,
      reason: trimmedReason,
    });
    return this.mutations.runIdempotent<GameDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const locked = await this.lockGame(client, gameId);
        await this.gameAuthority.assertCanManage(client, locked.id, userId);
      },
      execute: async (client) => {
        const locked = await this.lockGame(client, gameId);
        await this.gameAuthority.assertCanManage(client, locked.id, userId);
        return { statusCode: 200, body: await this.cancelInTransaction(client, gameId, expectedVersion, trimmedReason, userId) };
      },
    });
  }

  /** Sessions-owned cancellation command, shared by owner and fenced Admin orchestration.
   * Caller owns transaction/authority; this method always acquires Game lock and runs all cascades. */
  async cancelInTransaction(client: PoolClient, gameId: string, expectedVersion: number, reason: string, userId: string): Promise<GameDto> {
    const locked = await this.lockGame(client, gameId);
    if (locked.version !== expectedVersion) {
      throw conflict("VERSION_CONFLICT", "Версия игры устарела");
    }
    if (locked.status === "cancelled") {
      throw conflict("GAME_ALREADY_CANCELLED", "Игра уже отменена");
    }
    if (locked.status !== "draft" && locked.status !== "published") {
      throw conflict(
        "GAME_NOT_CANCELLABLE",
        "Игру нельзя отменить в текущем статусе",
      );
    }

    const updated = await client.query<{ id: string }>(
      `UPDATE games
       SET status = 'cancelled',
           version = version + 1,
           cancel_reason = $2,
           cancelled_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [gameId, reason],
    );
    const body = await this.loadGameDto(client, updated.rows[0]!.id);
    await this.participations.cascadeCancelInTransaction(
      client,
      gameId,
      body.version,
      userId,
    );
    await this.invitations.cascadeCancelInTransaction(client, gameId);
    await this.gameChat.closeChatInTransaction(client, gameId);
    const bodyAfterCascade = await this.loadGameDto(client, body.id);
    await this.outbox.enqueue(client, {
      type: "game.cancelled",
      aggregateType: "game",
      aggregateId: bodyAfterCascade.id,
      aggregateVersion: bodyAfterCascade.version,
      payload: {
        gameId: bodyAfterCascade.id,
        version: bodyAfterCascade.version,
        status: bodyAfterCascade.status,
        activityKind: bodyAfterCascade.activityKind,
        reason: reason,
      },
    });
    return bodyAfterCascade;
  }

  async getGame(gameId: string, viewerUserId: string | null): Promise<GameDto> {
    if (!isUuid(gameId)) {
      throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    }
    const client = await this.pool.connect();
    try {
      let dto: GameDto;
      try {
        dto = await this.loadGameDto(client, gameId, viewerUserId, true);
      } catch {
        throw notFound("GAME_NOT_FOUND", "Игра не найдена");
      }

      if (dto.status === "published" && dto.visibility === "public" &&
          (!this.env.GAME_MODERATION_INTERNAL_ENABLED || (await readModeration(client, gameId)).state !== "taken_down")) {
        return dto;
      }

      if (!viewerUserId) {
        throw notFound("GAME_NOT_FOUND", "Игра не найдена");
      }

      const membership = await client.query(
        `SELECT 1
         FROM game_managers
         WHERE game_id = $1
           AND user_id = $2
           AND status = 'active'
         LIMIT 1`,
        [gameId, viewerUserId],
      );
      if (!membership.rows[0]) {
        // Unlisted share-token access remains intentionally out of scope.
        throw notFound("GAME_NOT_FOUND", "Игра не найдена");
      }
      return dto;
    } finally {
      client.release();
    }
  }

  /** FR-3A projection: same public discovery eligibility, no participant/contact DTO.
   * Hold Game SHARE through the local transaction, then re-read after any wait.
   * Missing IDs are indistinguishable from unpublished/unlisted/moderated games. */
  async recommendationSummary(client: PoolClient, gameId: string) {
    await client.query("SELECT id FROM games WHERE id=$1 FOR SHARE", [gameId]);
    const eligible = eligibleGames(normalizeDiscovery({ temporalScope: "upcoming" }),
      this.env.GAME_MODERATION_INTERNAL_ENABLED);
    const result = await client.query<{id:string;title:string;starts_at:Date;ends_at:Date;timezone:string}>(`
      ${effectiveVenueCtes("SELECT venue_id AS id FROM games WHERE id=$1")}
      SELECT g.id,g.title,g.starts_at,g.ends_at,g.timezone
      FROM games g JOIN effective_venues v ON v.source_id=g.venue_id
      WHERE g.id=$1 AND ${eligible.where}`, [gameId]);
    const row = result.rows[0];
    if (row && this.env.GAME_MODERATION_INTERNAL_ENABLED && (await readModeration(client,gameId)).requestsLocked) return null;
    return row ? { id:row.id, title:row.title, startsAt:row.starts_at.toISOString(),
      endsAt:row.ends_at.toISOString(), timezone:row.timezone } : null;
  }

  async mapPublished(filter: DiscoveryFilter, signal?: AbortSignal) {
    return readGamesMap(this.pool, filter, signal, this.env.GAME_MODERATION_INTERNAL_ENABLED);
  }

  async listPublished(query: DiscoveryInput & {
    cursor?: string;
    limit?: number;
  }, viewerId: string | null = null): Promise<{ items: GameDto[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);
    const filter = normalizeDiscovery(query);
    let cursorStartsAt: Date | null = null;
    let cursorId: string | null = null;
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      cursorStartsAt = decoded.startsAt;
      cursorId = decoded.id;
    }

    const eligible = eligibleGames(filter, this.env.GAME_MODERATION_INTERNAL_ENABLED);
    const params = eligible.params;
    const where = [eligible.where];
    if (cursorStartsAt && cursorId) {
      params.push(cursorStartsAt, cursorId);
      where.push(
        `(g.starts_at, g.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);
    const sql = `
      ${effectiveVenueCtes()}
      SELECT ${gameSelectColumns()}
      FROM games g
      INNER JOIN effective_venues v ON v.source_id = g.venue_id
      WHERE ${where.join(" AND ")}
      ORDER BY g.starts_at ASC, g.id ASC
      LIMIT $${params.length}
    `;
    const result = await this.pool.query<GameRow>(sql, params);
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map(async row => this.withCreatorAvatar(this.pool, mapGameRow(row), viewerId)));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.starts_at, last.id) : null,
    };
  }

  /**
   * Authenticated management projection: Games where the session user has an
   * active game_managers row. Includes draft/unlisted. Does not grant mutation
   * authority; writes still re-check game-scoped authorization.
   */
  async listMineManaged(
    userId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<{ items: ManagedGameDto[]; nextCursor: string | null }> {
    const limit = clampLimit(query.limit);

    let cursorStartsAt: Date | null = null;
    let cursorId: string | null = null;
    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      cursorStartsAt = decoded.startsAt;
      cursorId = decoded.id;
    }

    const params: unknown[] = [userId];
    const where: string[] = [
      `gm.user_id = $1`,
      `gm.status = 'active'`,
      // Typed Game DTO requires classified activity; unclassified legacy excluded.
      `g.activity_kind IS NOT NULL`,
    ];

    if (cursorStartsAt && cursorId) {
      params.push(cursorStartsAt, cursorId);
      where.push(
        `(g.starts_at, g.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);
    const sql = `
      ${effectiveVenueCtes()}
      SELECT ${gameSelectColumns()},
             gm.role AS management_role,
             g.created_by_user_id
      FROM games g
      INNER JOIN effective_venues v ON v.source_id = g.venue_id
      INNER JOIN game_managers gm
        ON gm.game_id = g.id
      WHERE ${where.join(" AND ")}
      ORDER BY g.starts_at ASC, g.id ASC
      LIMIT $${params.length}
    `;
    const result = await this.pool.query<
      GameRow & {
        management_role: "owner" | "manager";
        created_by_user_id: string;
      }
    >(sql, params);
    const rows = result.rows;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map(async (row) => {
      const game = await this.withCreatorAvatar(this.pool, mapGameRow(row), userId);
      return {
        ...game,
        management: {
          role: row.management_role,
          createdByMe: row.created_by_user_id === userId,
        },
      };
    }));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.starts_at, last.id) : null,
    };
  }

  /** Capacity-affecting write path: always lock Game FOR UPDATE first. */
  async withGameLockForCapacityWrite<T>(
    gameId: string,
    fn: (
      client: PoolClient,
      locked: { id: string; version: number },
    ) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await this.lockGame(client, gameId);
      const result = await fn(client, {
        id: locked.id,
        version: locked.version,
      });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockGame(
    client: PoolClient,
    gameId: string,
  ): Promise<{
    id: string;
    organizer_id: string | null;
    starts_at: Date;
    status: string;
    version: number;
    capacity: number;
    external_reserved_count: number;
    activity_kind: "regular" | "trainer_led" | null;
    trainer_profile_id: string | null;
  }> {
    if (!isUuid(gameId)) {
      throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    }
    const result = await client.query<{
      id: string;
      organizer_id: string | null;
      starts_at: Date;
    status: string;
      version: number;
      capacity: number;
      external_reserved_count: number;
      activity_kind: "regular" | "trainer_led" | null;
      trainer_profile_id: string | null;
    }>(
      `SELECT id, organizer_id, status, version, capacity, external_reserved_count,
              activity_kind, trainer_profile_id, starts_at
       FROM games
       WHERE id = $1
       FOR UPDATE`,
      [gameId],
    );
    const row = result.rows[0];
    if (!row) throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    return row;
  }

  private async loadGameDto(
    client: PoolClient,
    gameId: string,
    viewerId: string | null = null,
    includeVenueContacts = false,
  ): Promise<GameDto> {
    const result = await client.query<GameRow>(
      ` ${effectiveVenueCtes("SELECT venue_id AS id FROM games WHERE id = $1")}
       SELECT ${gameSelectColumns()},
         ($2::uuid IS NOT NULL AND (
           EXISTS (SELECT 1 FROM game_managers gm WHERE gm.game_id=g.id
             AND gm.user_id=$2 AND gm.status='active' AND gm.role IN ('owner','manager'))
           OR EXISTS (SELECT 1 FROM participations p WHERE p.game_id=g.id
             AND p.user_id=$2 AND p.status='confirmed')
         )) AS venue_contacts_allowed
       FROM games g
       INNER JOIN effective_venues v ON v.source_id = g.venue_id
       WHERE g.id = $1`,
      [gameId, includeVenueContacts ? viewerId : null],
    );
    const row = result.rows[0];
    if (!row) throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    return this.withCreatorAvatar(client, mapGameRow(row), viewerId);
  }

  private async withCreatorAvatar(db: Pool | PoolClient, game: GameDto, viewerId: string | null = null): Promise<GameDto> {
    return { ...game, organizer: { ...game.organizer, avatar: await avatarForGameCreator(db, game.id, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, viewerId) } };
  }
}

function gameSelectColumns(): string {
  return `
    g.id, g.version, g.title, g.status, g.visibility,
    g.activity_kind, g.trainer_profile_id, g.trainer_display_name_snapshot,
    g.training_description,
    g.starts_at, g.ends_at, g.timezone, g.application_deadline_at,
    g.capacity, g.external_reserved_count, g.format_key,
    g.level_scale_id, g.level_scale_version, g.allowed_level_ids,
    g.settlement_mode, g.settlement_purpose, g.price_status, g.price_unit,
    g.price_minor::text AS price_minor, g.currency, g.settlement_terms,
    g.organizer_id AS organizer_id,
    g.host_display_name AS organizer_display_name,
    g.host_public_contact AS organizer_public_contact,
    game_effective_cover_url(g.id) AS game_cover_url, venue_cover_url(g.venue_id) AS venue_cover_url, v.id AS venue_id, v.name AS venue_name, v.city_id AS venue_city_id, v.address AS venue_address,
    v.contact_phone AS venue_contact_phone, v.contact_website AS venue_contact_website,
    v.booking_note AS venue_booking_note,
    v.timezone AS venue_timezone,
    ST_Y(v.location::geometry) AS venue_latitude,
    ST_X(v.location::geometry) AS venue_longitude,
    (
      SELECT count(*)::int
      FROM participations p
      WHERE p.game_id = g.id AND p.status = 'confirmed'
    ) AS confirmed_count
  `;
}

function mapGameRow(row: GameRow): GameDto {
  if (!row.activity_kind || !row.settlement_purpose) {
    // Unclassified legacy rows are not projected into the typed Game DTO.
    throw notFound("GAME_NOT_FOUND", "Игра не найдена");
  }
  const confirmedCount = Number(row.confirmed_count ?? 0);
  const capacityState = {
    capacity: row.capacity,
    externalReservedCount: row.external_reserved_count,
    confirmedCount,
  };
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    status: row.status,
    visibility: row.visibility,
    activityKind: row.activity_kind,
    trainer:
      row.activity_kind === "trainer_led" &&
      row.trainer_profile_id &&
      row.trainer_display_name_snapshot
        ? {
            profileId: row.trainer_profile_id,
            displayName: row.trainer_display_name_snapshot,
            declarationSource: "self_declared",
          }
        : null,
    trainingDescription: row.training_description,
    cover: { uploadedUrl: row.game_cover_url ?? null },
    organizer: {
      id: row.organizer_id,
      displayName: row.organizer_display_name,
      publicContact: row.organizer_public_contact,
    },
    venue: {
      ...(row.venue_contacts_allowed ? {
        contactPhone: row.venue_contact_phone,
        contactWebsite: privateContactWebsite(row.venue_contact_website),
        bookingNote: row.venue_booking_note,
      } : {}),
      cover: { uploadedUrl: row.venue_cover_url ?? null },
      id: row.venue_id,
      name: row.venue_name,
      cityId: row.venue_city_id,
      address: row.venue_address,
      timezone: row.venue_timezone,
      latitude: Number(row.venue_latitude),
      longitude: Number(row.venue_longitude),
    },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    timezone: row.timezone,
    applicationDeadlineAt: row.application_deadline_at.toISOString(),
    capacity: row.capacity,
    externalReservedCount: row.external_reserved_count,
    confirmedCount,
    availablePlaces: availablePlaces(capacityState),
    formatKey: row.format_key,
    levelRule: {
      scaleId: row.level_scale_id,
      scaleVersion: row.level_scale_version,
      allowedLevelIds: Array.isArray(row.allowed_level_ids)
        ? row.allowed_level_ids
        : [],
    },
    settlement: mapSettlement(row),
  };
}

function mapSettlement(row: GameRow): SettlementDto {
  if (row.settlement_purpose === "no_trainer_fee") {
    return {
      mode: "external",
      purpose: "no_trainer_fee",
      priceMinor: null,
      currency: null,
      terms: row.settlement_terms,
    };
  }
  if (row.settlement_purpose === "trainer_fee" && row.price_status === "fixed") {
    return {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "fixed",
      priceUnit: "per_player_per_session",
      priceMinor: row.price_minor as string,
      currency: row.currency as string,
      terms: row.settlement_terms,
    };
  }
  if (
    row.settlement_purpose === "trainer_fee" &&
    row.price_status === "by_agreement"
  ) {
    return {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "by_agreement",
      priceMinor: null,
      currency: null,
      terms: row.settlement_terms,
    };
  }
  throw unprocessable(
    "SETTLEMENT_SHAPE_INVALID",
    "Некорректная форма settlement у игры",
  );
}

function settlementColumns(settlement: SettlementDto): {
  mode: "external";
  purpose: string;
  priceStatus: string | null;
  priceUnit: string | null;
  priceMinor: string | null;
  currency: string | null;
  terms: string;
} {
  if (settlement.purpose === "no_trainer_fee") {
    return {
      mode: "external",
      purpose: "no_trainer_fee",
      priceStatus: null,
      priceUnit: null,
      priceMinor: null,
      currency: null,
      terms: settlement.terms,
    };
  }
  if (settlement.priceStatus === "fixed") {
    return {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "fixed",
      priceUnit: "per_player_per_session",
      priceMinor: settlement.priceMinor,
      currency: settlement.currency,
      terms: settlement.terms,
    };
  }
  return {
    mode: "external",
    purpose: "trainer_fee",
    priceStatus: "by_agreement",
    priceUnit: null,
    priceMinor: null,
    currency: null,
    terms: settlement.terms,
  };
}

function normalizeCreateGame(input: CreateGameInput): NormalizedCreateGame {
  const raw = input as CreateGameInput & {
    organizerId?: unknown;
    ownerUserId?: unknown;
    trainerProfileId?: unknown;
    verificationStatus?: unknown;
  };
  if (raw.organizerId !== undefined) {
    throw unprocessable(
      "ORGANIZER_ID_NOT_ACCEPTED",
      "organizerId больше не принимается при создании игры",
    );
  }
  if (raw.ownerUserId !== undefined) {
    throw unprocessable(
      "OWNER_USER_ID_NOT_ACCEPTED",
      "ownerUserId не принимается от клиента",
    );
  }
  if (raw.trainerProfileId !== undefined) {
    throw unprocessable(
      "TRAINER_PROFILE_ID_NOT_ACCEPTED",
      "trainerProfileId назначается сервером",
    );
  }
  if (raw.verificationStatus !== undefined) {
    throw unprocessable(
      "VERIFICATION_CLAIM_NOT_ACCEPTED",
      "Заявки о verification не принимаются",
    );
  }
  if (!isUuid(input.venueId)) {
    throw unprocessable("VENUE_ID_INVALID", "Некорректный venueId");
  }
  if (input.activityKind !== "regular" && input.activityKind !== "trainer_led") {
    throw unprocessable(
      "ACTIVITY_KIND_INVALID",
      "activityKind должен быть regular или trainer_led",
    );
  }
  const hostDisplayName = input.hostDisplayName?.trim() ?? "";
  if (hostDisplayName.length < 1 || hostDisplayName.length > 160) {
    throw unprocessable(
      "HOST_DISPLAY_NAME_INVALID",
      "Некорректный hostDisplayName",
    );
  }
  const hostPublicContact = normalizePublicGameContact(input.hostPublicContact);
  if (input.savePublicContactDefault !== undefined) {
    const save = input.savePublicContactDefault;
    if (!save || typeof save !== "object" || Array.isArray(save) ||
        Object.keys(save).some(k => k !== "expectedVersion")) {
      throw unprocessable("GAME_PREFERENCES_INVALID", "Некорректное сохранение контакта");
    }
    validatePreferenceVersion(save.expectedVersion);
  }
  if (input.title !== undefined && typeof input.title !== "string") {
    throw unprocessable("GAME_TITLE_INVALID", "Некорректный title");
  }
  const title = input.title?.trim() || (input.activityKind === "trainer_led" ? "Игра с тренером" : "Игра");
  if (title.length > 160) {
    throw unprocessable("GAME_TITLE_INVALID", "Некорректный title");
  }
  const timezone = input.timezone?.trim() ?? "";
  if (timezone.length < 1 || timezone.length > 64) {
    throw unprocessable("GAME_TIMEZONE_INVALID", "Некорректный timezone");
  }
  const startsAt = parseInstant(input.startsAt, "startsAt");
  const endsAt = parseInstant(input.endsAt, "endsAt");
  const applicationDeadlineAt = parseInstant(
    input.applicationDeadlineAt,
    "applicationDeadlineAt",
  );
  if (!(startsAt < endsAt)) {
    throw unprocessable(
      "GAME_TIME_ORDER_INVALID",
      "startsAt должен быть раньше endsAt",
    );
  }
  if (!(applicationDeadlineAt <= startsAt)) {
    throw unprocessable(
      "GAME_DEADLINE_INVALID",
      "applicationDeadlineAt должен быть не позже startsAt",
    );
  }
  if (input.visibility !== "public" && input.visibility !== "unlisted") {
    throw unprocessable("GAME_VISIBILITY_INVALID", "Некорректный visibility");
  }
  const formatKey = input.formatKey?.trim() ?? "";
  if (formatKey.length < 1 || formatKey.length > 64) {
    throw unprocessable("FORMAT_KEY_INVALID", "Некорректный formatKey");
  }
  let trainingDescription: string | null = null;
  if (input.activityKind === "regular") {
    if (
      input.trainingDescription !== undefined &&
      input.trainingDescription !== null &&
      String(input.trainingDescription).trim() !== ""
    ) {
      throw unprocessable(
        "TRAINING_DESCRIPTION_NOT_ALLOWED",
        "regular игра не принимает trainingDescription",
      );
    }
  } else if (
    input.trainingDescription !== undefined &&
    input.trainingDescription !== null
  ) {
    const trimmed = String(input.trainingDescription).trim();
    if (trimmed.length < 1 || trimmed.length > 2000) {
      throw unprocessable(
        "TRAINING_DESCRIPTION_INVALID",
        "Некорректный trainingDescription",
      );
    }
    trainingDescription = trimmed;
  }
  const levelRule = input.levelRule;
  if (
    !levelRule ||
    typeof levelRule.scaleId !== "string" ||
    levelRule.scaleId.length < 1 ||
    levelRule.scaleId.length > 64 ||
    !Number.isInteger(levelRule.scaleVersion) ||
    levelRule.scaleVersion < 1 ||
    !Array.isArray(levelRule.allowedLevelIds) ||
    levelRule.allowedLevelIds.length < 1 ||
    levelRule.allowedLevelIds.length > 32
  ) {
    throw unprocessable("LEVEL_RULE_INVALID", "Некорректный levelRule");
  }
  const settlement = normalizeSettlement(input.settlement, input.activityKind);

  const capacity = input.capacity;
  const externalReservedCount = input.externalReservedCount;
  const violation = validateCapacityInvariant({
    capacity,
    externalReservedCount,
    confirmedCount: input.activityKind === "regular" ? 1 : 0,
  });
  if (violation === "CAPACITY_NONPOSITIVE") {
    throw unprocessable("CAPACITY_INVALID", "capacity должен быть > 0");
  }
  if (violation === "EXTERNAL_RESERVED_NEGATIVE") {
    throw unprocessable(
      "EXTERNAL_RESERVED_INVALID",
      "externalReservedCount должен быть >= 0",
    );
  }
  if (violation === "CAPACITY_OVERFLOW") {
    throw unprocessable(
      input.activityKind === "regular" ? "CAPACITY_INVALID" : "CAPACITY_OVERFLOW",
      "Участники и externalReservedCount не могут превышать capacity",
    );
  }
  if (capacity > 1000 || externalReservedCount > 1000) {
    throw unprocessable(
      "CAPACITY_OUT_OF_RANGE",
      "capacity/externalReserved вне диапазона",
    );
  }

  return {
    hostDisplayName,
    hostPublicContact,
    ...(input.savePublicContactDefault === undefined ? {} : { savePublicContactDefault: { expectedVersion: input.savePublicContactDefault.expectedVersion } }),
    venueId: input.venueId,
    title,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    timezone,
    applicationDeadlineAt: applicationDeadlineAt.toISOString(),
    capacity,
    externalReservedCount,
    visibility: input.visibility,
    formatKey,
    activityKind: input.activityKind,
    trainingDescription,
    levelRule: {
      scaleId: levelRule.scaleId,
      scaleVersion: levelRule.scaleVersion,
      allowedLevelIds: [...new Set(levelRule.allowedLevelIds)],
    },
    settlement,
  };
}

function normalizeSettlement(
  settlement: SettlementDto | (Record<string, unknown> & { mode?: string }),
  activityKind: "regular" | "trainer_led",
): SettlementDto {
  if (!settlement || settlement.mode !== "external") {
    throw unprocessable(
      "SETTLEMENT_MODE_INVALID",
      "Settlement mode должен быть external",
    );
  }
  const terms =
    typeof settlement.terms === "string" ? settlement.terms.trim() : "";
  if (terms.length < 1 || terms.length > 2000) {
    throw unprocessable(
      "SETTLEMENT_TERMS_INVALID",
      "Некорректные settlement.terms",
    );
  }
  const purpose = settlement.purpose;
  if (activityKind === "regular") {
    if (purpose !== "no_trainer_fee") {
      throw unprocessable(
        "SETTLEMENT_PURPOSE_INVALID",
        "regular требует settlement.purpose=no_trainer_fee",
      );
    }
    if (
      ("priceStatus" in settlement && settlement.priceStatus != null) ||
      ("priceUnit" in settlement && settlement.priceUnit != null)
    ) {
      throw unprocessable(
        "SETTLEMENT_PRICE_FIELDS_NOT_ALLOWED",
        "regular не принимает priceStatus/priceUnit",
      );
    }
    if (settlement.priceMinor != null || settlement.currency != null) {
      throw unprocessable(
        "SETTLEMENT_PRICE_NOT_ALLOWED",
        "regular не принимает trainer price; shared court cost — отдельная будущая модель",
      );
    }
    return {
      mode: "external",
      purpose: "no_trainer_fee",
      priceMinor: null,
      currency: null,
      terms,
    };
  }

  if (purpose !== "trainer_fee") {
    throw unprocessable(
      "SETTLEMENT_PURPOSE_INVALID",
      "trainer_led требует settlement.purpose=trainer_fee",
    );
  }
  const priceStatus = settlement.priceStatus;
  if (priceStatus === "fixed") {
    const priceMinor =
      typeof settlement.priceMinor === "string" ? settlement.priceMinor : null;
    const currency =
      typeof settlement.currency === "string" ? settlement.currency : null;
    if (!priceMinor || !/^[0-9]+$/.test(priceMinor) || priceMinor.length > 19) {
      throw unprocessable("PRICE_MINOR_INVALID", "Некорректный priceMinor");
    }
    if (priceMinor === "0" || /^0+$/.test(priceMinor)) {
      throw unprocessable(
        "PRICE_MINOR_NONPOSITIVE",
        "Фиксированная trainer fee должна быть > 0",
      );
    }
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw unprocessable(
        "CURRENCY_REQUIRED",
        "currency обязателен при fixed trainer fee",
      );
    }
    if (
      settlement.priceUnit !== undefined &&
      settlement.priceUnit !== "per_player_per_session"
    ) {
      throw unprocessable(
        "PRICE_UNIT_INVALID",
        "priceUnit должен быть per_player_per_session",
      );
    }
    return {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "fixed",
      priceUnit: "per_player_per_session",
      priceMinor,
      currency,
      terms,
    };
  }
  if (priceStatus === "by_agreement") {
    const raw = settlement as Record<string, unknown>;
    if (settlement.priceMinor != null || settlement.currency != null) {
      throw unprocessable(
        "PRICE_NOT_ALLOWED_FOR_BY_AGREEMENT",
        "by_agreement не принимает priceMinor/currency",
      );
    }
    if (raw.priceUnit !== undefined && raw.priceUnit !== null) {
      throw unprocessable(
        "PRICE_UNIT_NOT_ALLOWED",
        "by_agreement не принимает priceUnit",
      );
    }
    return {
      mode: "external",
      purpose: "trainer_fee",
      priceStatus: "by_agreement",
      priceMinor: null,
      currency: null,
      terms,
    };
  }
  throw unprocessable(
    "PRICE_STATUS_INVALID",
    "trainer_fee требует priceStatus fixed или by_agreement",
  );
}

function assertCapacityRow(row: {
  capacity: number;
  external_reserved_count: number;
}): void {
  const violation = validateCapacityInvariant({
    capacity: row.capacity,
    externalReservedCount: row.external_reserved_count,
    confirmedCount: 0,
  });
  if (violation) {
    throw conflict("CAPACITY_INVARIANT", "Нарушен инвариант вместимости");
  }
}

function parseInstant(value: string, field: string): Date {
  if (typeof value !== "string" || value.length < 1) {
    throw unprocessable("DATETIME_INVALID", `Некорректный ${field}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw unprocessable("DATETIME_INVALID", `Некорректный ${field}`);
  }
  return date;
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined) return 20;
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) {
    throw badRequest("LIMIT_INVALID", "limit должен быть 1–100");
  }
  return raw;
}

function encodeCursor(startsAt: Date, id: string): string {
  return Buffer.from(`${startsAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): { startsAt: Date; id: string } {
  if (cursor.length > 2048) {
    throw badRequest("CURSOR_INVALID", "Некорректный cursor");
  }
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [startsAtRaw, id] = raw.split("|");
    if (!startsAtRaw || !id || !isUuid(id)) {
      throw new Error("bad cursor");
    }
    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) throw new Error("bad cursor");
    return { startsAt, id };
  } catch {
    throw badRequest("CURSOR_INVALID", "Некорректный cursor");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Execute-only: a completed idempotent receipt remains replayable after start. */
function assertFutureStart(startsAt: Date): void {
  if (startsAt.getTime() <= Date.now()) {
    throw unprocessable("GAME_START_NOT_FUTURE", "Начало игры должно быть в будущем");
  }
}
