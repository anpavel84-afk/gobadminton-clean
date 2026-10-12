import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  conflict,
  notFound,
  unprocessable,
} from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { DATABASE_POOL } from "../tokens";

export type TrainerProfileDto = {
  id: string;
  version: number;
  displayName: string;
  bio: string | null;
  declarationSource: "self_declared";
  declaredAt: string;
  status: "active" | "inactive";
};

export type UpsertTrainerProfileInput = {
  selfDeclared: true;
  displayName: string;
  bio?: string | null;
  expectedVersion?: number;
};

type TrainerProfileRow = {
  id: string;
  version: number;
  display_name: string;
  bio: string | null;
  declaration_source: "self_declared";
  declared_at: Date;
  status: "active" | "inactive";
};

@Injectable()
export class TrainersService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
  ) {}

  async getOwn(userId: string): Promise<TrainerProfileDto> {
    const result = await this.pool.query<TrainerProfileRow>(
      `SELECT id, version, display_name, bio, declaration_source, declared_at, status
       FROM trainer_profiles
       WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw notFound(
        "TRAINER_PROFILE_NOT_FOUND",
        "Профиль тренера не найден",
      );
    }
    return mapTrainerProfile(row);
  }

  async upsertOwn(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    input: UpsertTrainerProfileInput,
  ): Promise<{ statusCode: number; body: TrainerProfileDto }> {
    const normalized = normalizeUpsert(input);
    const operation = "trainer_profile.upsert";
    const requestHash = this.idempotency.requestHash(normalized);
    return this.mutations.runIdempotent<TrainerProfileDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const locked = await client.query<{ user_id: string }>(
          `SELECT user_id FROM trainer_profiles WHERE user_id = $1 FOR UPDATE`,
          [userId],
        );
        if (locked.rows[0] && locked.rows[0].user_id !== userId) {
          throw notFound(
            "TRAINER_PROFILE_NOT_FOUND",
            "Профиль тренера не найден",
          );
        }
      },
      execute: async (client) => {
        const locked = await client.query<TrainerProfileRow>(
          `SELECT id, version, display_name, bio, declaration_source, declared_at, status
           FROM trainer_profiles
           WHERE user_id = $1
           FOR UPDATE`,
          [userId],
        );
        const existing = locked.rows[0];
        let statusCode = 200;
        let body: TrainerProfileDto;

        if (!existing) {
          if (normalized.expectedVersion !== undefined) {
            throw conflict(
              "VERSION_CONFLICT",
              "Профиль тренера ещё не создан",
            );
          }
          const inserted = await client.query<TrainerProfileRow>(
            `INSERT INTO trainer_profiles (
               user_id, display_name, bio, declaration_source, status, version
             ) VALUES ($1, $2, $3, 'self_declared', 'active', 1)
             RETURNING id, version, display_name, bio, declaration_source, declared_at, status`,
            [userId, normalized.displayName, normalized.bio],
          );
          body = mapTrainerProfile(inserted.rows[0]!);
          statusCode = 201;
        } else {
          if (
            normalized.expectedVersion === undefined ||
            existing.version !== normalized.expectedVersion
          ) {
            throw conflict("VERSION_CONFLICT", "Версия профиля тренера устарела");
          }
          const updated = await client.query<TrainerProfileRow>(
            `UPDATE trainer_profiles
             SET display_name = $2,
                 bio = $3,
                 status = 'active',
                 version = version + 1,
                 updated_at = now()
             WHERE id = $1
             RETURNING id, version, display_name, bio, declaration_source, declared_at, status`,
            [existing.id, normalized.displayName, normalized.bio],
          );
          body = mapTrainerProfile(updated.rows[0]!);
        }
        return { statusCode, body };
      },
    });
  }

  async deactivateOwn(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<{ statusCode: number; body: TrainerProfileDto }> {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw unprocessable(
        "EXPECTED_VERSION_INVALID",
        "Некорректный expectedVersion",
      );
    }
    const operation = "trainer_profile.deactivate";
    const requestHash = this.idempotency.requestHash({ expectedVersion });
    return this.mutations.runIdempotent<TrainerProfileDto>({
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client) => {
        const locked = await client.query<{ user_id: string }>(
          `SELECT user_id FROM trainer_profiles WHERE user_id = $1 FOR UPDATE`,
          [userId],
        );
        if (!locked.rows[0]) {
          throw notFound(
            "TRAINER_PROFILE_NOT_FOUND",
            "Профиль тренера не найден",
          );
        }
      },
      execute: async (client) => {
        const locked = await client.query<TrainerProfileRow>(
          `SELECT id, version, display_name, bio, declaration_source, declared_at, status
           FROM trainer_profiles
           WHERE user_id = $1
           FOR UPDATE`,
          [userId],
        );
        const existing = locked.rows[0];
        if (!existing) {
          throw notFound(
            "TRAINER_PROFILE_NOT_FOUND",
            "Профиль тренера не найден",
          );
        }
        if (existing.version !== expectedVersion) {
          throw conflict("VERSION_CONFLICT", "Версия профиля тренера устарела");
        }
        if (existing.status === "inactive") {
          throw conflict(
            "TRAINER_PROFILE_ALREADY_INACTIVE",
            "Профиль тренера уже выключен",
          );
        }

        const updated = await client.query<TrainerProfileRow>(
          `UPDATE trainer_profiles
           SET status = 'inactive',
               version = version + 1,
               updated_at = now()
           WHERE id = $1
           RETURNING id, version, display_name, bio, declaration_source, declared_at, status`,
          [existing.id],
        );
        return { statusCode: 200, body: mapTrainerProfile(updated.rows[0]!) };
      },
    });
  }

  /**
   * Lock caller's active trainer profile for trainer-led Game create/publish.
   * Caller must already be inside a transaction.
   */
  async lockActiveOwnProfile(
    client: PoolClient,
    userId: string,
  ): Promise<{ id: string; displayName: string; version: number }> {
    const result = await client.query<{
      id: string;
      display_name: string;
      version: number;
      status: string;
    }>(
      `SELECT id, display_name, version, status
       FROM trainer_profiles
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") {
      throw unprocessable(
        "TRAINER_PROFILE_REQUIRED",
        "Для trainer-led игры нужен активный собственный профиль тренера",
      );
    }
    return {
      id: row.id,
      displayName: row.display_name,
      version: row.version,
    };
  }

  async assertActiveProfileId(
    client: PoolClient,
    profileId: string,
    userId: string,
  ): Promise<void> {
    const result = await client.query<{ status: string; user_id: string }>(
      `SELECT status, user_id
       FROM trainer_profiles
       WHERE id = $1
       FOR UPDATE`,
      [profileId],
    );
    const row = result.rows[0];
    if (!row || row.user_id !== userId || row.status !== "active") {
      throw conflict(
        "TRAINER_PROFILE_INACTIVE",
        "Профиль тренера неактивен или недоступен для публикации",
      );
    }
  }
}

function mapTrainerProfile(row: TrainerProfileRow): TrainerProfileDto {
  return {
    id: row.id,
    version: row.version,
    displayName: row.display_name,
    bio: row.bio,
    declarationSource: row.declaration_source,
    declaredAt: row.declared_at.toISOString(),
    status: row.status,
  };
}

function normalizeUpsert(input: UpsertTrainerProfileInput): {
  selfDeclared: true;
  displayName: string;
  bio: string | null;
  expectedVersion?: number;
} {
  const raw = input as UpsertTrainerProfileInput & {
    userId?: unknown;
    trainerProfileId?: unknown;
    verificationStatus?: unknown;
    verified?: unknown;
  };
  if (raw.userId !== undefined) {
    throw unprocessable(
      "USER_ID_NOT_ACCEPTED",
      "userId не принимается от клиента",
    );
  }
  if (raw.trainerProfileId !== undefined) {
    throw unprocessable(
      "TRAINER_PROFILE_ID_NOT_ACCEPTED",
      "trainerProfileId не принимается от клиента",
    );
  }
  if (raw.verificationStatus !== undefined || raw.verified !== undefined) {
    throw unprocessable(
      "VERIFICATION_CLAIM_NOT_ACCEPTED",
      "Заявки о verification не принимаются",
    );
  }
  if (input.selfDeclared !== true) {
    throw unprocessable(
      "SELF_DECLARED_REQUIRED",
      "Требуется явное selfDeclared=true",
    );
  }
  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length < 1 || displayName.length > 160) {
    throw unprocessable(
      "TRAINER_DISPLAY_NAME_INVALID",
      "Некорректный displayName",
    );
  }
  let bio: string | null = null;
  if (input.bio !== undefined && input.bio !== null) {
    const trimmed = String(input.bio).trim();
    if (trimmed.length < 1 || trimmed.length > 1000) {
      throw unprocessable("TRAINER_BIO_INVALID", "Некорректный bio");
    }
    bio = trimmed;
  }
  if (
    input.expectedVersion !== undefined &&
    (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)
  ) {
    throw unprocessable(
      "EXPECTED_VERSION_INVALID",
      "Некорректный expectedVersion",
    );
  }
  return {
    selfDeclared: true,
    displayName,
    bio,
    expectedVersion: input.expectedVersion,
  };
}
