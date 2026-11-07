import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import {
  conflict,
  notFound,
  unprocessable,
} from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import {
  ContentModerationService,
  type TextBatchApproval,
} from "../moderation/moderation.service";
import type { TextFieldCandidate } from "../moderation/text-policy";
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
    private readonly moderation: ContentModerationService,
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
    const receipt = {
      actorId: userId,
      sessionId,
      operation,
      key: idempotencyKey,
      requestHash,
      authorizeReplay: async (client: PoolClient) => {
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
    };
    const replay = await this.mutations.findReplay<TrainerProfileDto>(receipt);
    if (replay) return replay;

    const existing = (
      await this.pool.query<TrainerProfileRow>(
        `SELECT id, version, display_name, bio, declaration_source, declared_at, status
         FROM trainer_profiles WHERE user_id = $1`,
        [userId],
      )
    ).rows[0];

    const textFields: TextFieldCandidate[] = [];
    if (!existing) {
      if (normalized.expectedVersion !== undefined) {
        throw conflict("VERSION_CONFLICT", "Профиль тренера ещё не создан");
      }
      textFields.push({
        surface: "trainer_display_name",
        text: normalized.displayName,
        fieldId: "displayName",
      });
      if (normalized.bio) {
        textFields.push({
          surface: "trainer_bio",
          text: normalized.bio,
          fieldId: "bio",
        });
      }
    } else {
      if (
        normalized.expectedVersion === undefined ||
        existing.version !== normalized.expectedVersion
      ) {
        throw conflict("VERSION_CONFLICT", "Версия профиля тренера устарела");
      }
      const reactivating = existing.status !== "active";
      if (reactivating || normalized.displayName !== existing.display_name) {
        textFields.push({
          surface: "trainer_display_name",
          text: normalized.displayName,
          fieldId: "displayName",
        });
      }
      if (
        reactivating ||
        (normalized.bio ?? null) !== existing.bio
      ) {
        if (normalized.bio) {
          textFields.push({
            surface: "trainer_bio",
            text: normalized.bio,
            fieldId: "bio",
          });
        }
      }
    }

    const textApproval: TextBatchApproval | null =
      textFields.length > 0
        ? await this.moderation.approveTexts(userId, textFields)
        : null;

    return this.mutations.runIdempotent<TrainerProfileDto>({
      ...receipt,
      execute: async (client) => {
        const locked = await client.query<TrainerProfileRow>(
          `SELECT id, version, display_name, bio, declaration_source, declared_at, status
           FROM trainer_profiles
           WHERE user_id = $1
           FOR UPDATE`,
          [userId],
        );
        const current = locked.rows[0];
        let statusCode = 200;
        let body: TrainerProfileDto;

        if (!current) {
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
            current.version !== normalized.expectedVersion
          ) {
            throw conflict("VERSION_CONFLICT", "Версия профиля тренера устарела");
          }
          if (
            normalized.displayName !== current.display_name &&
            textApproval &&
            !textApproval.fields.some((f) => f.surface === "trainer_display_name" && f.text === normalized.displayName)
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
            [current.id, normalized.displayName, normalized.bio],
          );
          body = mapTrainerProfile(updated.rows[0]!);
        }
        if (textApproval) {
          const committed: Array<{ surface: "trainer_display_name" | "trainer_bio"; text: string }> = [];
          for (const field of textApproval.fields) {
            if (field.surface === "trainer_display_name") {
              committed.push({ surface: "trainer_display_name", text: body.displayName });
            } else if (field.surface === "trainer_bio" && body.bio) {
              committed.push({ surface: "trainer_bio", text: body.bio });
            }
          }
          await this.moderation.bindTexts(client, textApproval, committed, {
            entityKind: "trainer_profile",
            entityId: body.id,
            resourceVersion: body.version,
            actorUserId: userId,
            bindingKind: "publication",
          });
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
          return { statusCode: 200, body: mapTrainerProfile(existing) };
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

  async lockActiveOwnProfile(
    client: PoolClient,
    userId: string,
  ): Promise<{ id: string; displayName: string }> {
    const result = await client.query<{
      id: string;
      display_name: string;
    }>(
      `SELECT id, display_name FROM trainer_profiles
       WHERE user_id = $1 AND status = 'active'
       FOR UPDATE`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw unprocessable(
        "TRAINER_PROFILE_REQUIRED",
        "Нужен активный профиль тренера",
      );
    }
    return { id: row.id, displayName: row.display_name };
  }

  async assertActiveProfileId(
    client: PoolClient,
    profileId: string,
    userId: string,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM trainer_profiles
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [profileId, userId],
    );
    if (!result.rows[0]) {
      throw conflict(
        "TRAINER_PROFILE_INACTIVE",
        "Профиль тренера недоступен для публикации",
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
  if (input.selfDeclared !== true) {
    throw unprocessable(
      "TRAINER_DECLARATION_REQUIRED",
      "Требуется явное самообъявление тренера",
    );
  }
  const displayName = input.displayName?.trim() ?? "";
  if (displayName.length < 1 || displayName.length > 80) {
    throw unprocessable(
      "TRAINER_DISPLAY_NAME_INVALID",
      "Некорректное имя тренера",
    );
  }
  let bio: string | null = null;
  if (input.bio !== undefined && input.bio !== null) {
    const trimmed = input.bio.trim();
    if (trimmed.length > 2000) {
      throw unprocessable("TRAINER_BIO_INVALID", "Слишком длинное описание");
    }
    bio = trimmed.length > 0 ? trimmed : null;
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
