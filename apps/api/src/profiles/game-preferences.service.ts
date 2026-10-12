import type { GamePreferences, PatchGamePreferences } from "@gobadminton/contracts/game-types";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { conflict, unauthorized, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { DATABASE_POOL } from "../tokens";

export type GamePreferencesDto = GamePreferences;
export type PatchGamePreferencesInput = PatchGamePreferences;

export function normalizePublicGameContact(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 320) {
    throw unprocessable("HOST_PUBLIC_CONTACT_INVALID", "Некорректный публичный контакт игры");
  }
  return value.trim();
}

export function validatePreferenceVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || ((value as number) < 0 || (value as number) > 2147483647)) {
    throw unprocessable("EXPECTED_VERSION_INVALID", "Некорректный expectedVersion");
  }
}

@Injectable()
export class GamePreferencesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
  ) {}

  async getOwn(userId: string): Promise<GamePreferencesDto> {
    // One statement snapshots account eligibility and private data together.
    const result = await this.pool.query<GamePreferencesDto>(
      `SELECT p.default_public_game_contact AS "defaultPublicGameContact",
              COALESCE(p.version, 0) AS version
       FROM users u LEFT JOIN user_game_preferences p ON p.user_id = u.id
       WHERE u.id = $1 AND u.status = 'active'`, [userId]);
    if (!result.rows[0]) throw unauthorized("ACCOUNT_INACTIVE", "Аккаунт недоступен");
    return result.rows[0];
  }

  async patchOwn(userId: string, sessionId: string, key: string, input: PatchGamePreferencesInput) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(k => !["expectedVersion", "defaultPublicGameContact"].includes(k)) ||
        !Object.hasOwn(input, "defaultPublicGameContact")) {
      throw unprocessable("GAME_PREFERENCES_INVALID", "Некорректные настройки игры");
    }
    validatePreferenceVersion(input.expectedVersion);
    const contact = input.defaultPublicGameContact === null ? null : normalizePublicGameContact(input.defaultPublicGameContact);
    return this.mutations.runIdempotent<GamePreferencesDto>({
      actorId: userId, sessionId, operation: "game_preferences.patch", key,
      requestHash: this.idempotency.requestHash({ expectedVersion: input.expectedVersion, defaultPublicGameContact: contact }),
      authorizeReplay: async () => { /* Own-only; MutationRunner fences active actor/session. */ },
      execute: async client => ({ statusCode: 200, body: await this.saveInTransaction(client, userId, input.expectedVersion, contact) }),
    });
  }

  /** Caller holds active actor/session fence. Composed writes lock Game/dependents first. */
  async saveInTransaction(client: PoolClient, userId: string, expectedVersion: number, contact: string | null): Promise<GamePreferencesDto> {
    validatePreferenceVersion(expectedVersion);
    const normalized = contact === null ? null : normalizePublicGameContact(contact);
    const result = expectedVersion === 0
      ? await client.query<GamePreferencesDto>(
          `INSERT INTO user_game_preferences(user_id, default_public_game_contact, version)
           VALUES ($1,$2,1) ON CONFLICT (user_id) DO NOTHING
           RETURNING default_public_game_contact AS "defaultPublicGameContact", version`, [userId, normalized])
      : await client.query<GamePreferencesDto>(
          `UPDATE user_game_preferences SET default_public_game_contact=$2, version=version+1, updated_at=now()
           WHERE user_id=$1 AND version=$3
           RETURNING default_public_game_contact AS "defaultPublicGameContact", version`, [userId, normalized, expectedVersion]);
    if (!result.rows[0]) throw conflict("VERSION_CONFLICT", "Версия настроек игры устарела");
    return result.rows[0];
  }
}
