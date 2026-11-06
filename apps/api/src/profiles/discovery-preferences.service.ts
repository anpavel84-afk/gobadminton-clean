import type { DiscoveryPreference, PutDiscoveryPreference } from "@gobadminton/contracts/game-types";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { conflict, unauthorized, unprocessable } from "../auth/problem";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { DATABASE_POOL } from "../tokens";

/** Thirteen approved discovery cities — mirrors contracts regional-cities + Moscow/SPB. */
export const DISCOVERY_CITY_IDS = [
  "a0000000-0000-4000-8000-000000000001",
  "a0000000-0000-4000-8000-000000000002",
  "1775016f-373e-5a15-958b-1305770b2b16",
  "bec5831e-d6d2-59da-9d17-0c32b1eca331",
  "5c219eb1-87da-5fd3-9194-20e9d1501315",
  "3113cbf1-c8bd-5475-9774-2e9567414f46",
  "1a08b6d0-7bb8-5df5-903d-633ebc064a6e",
  "2f9a0a40-b6cd-53f6-8f0d-06cfb607cd0e",
  "38d822e9-2c2a-5969-871c-ee6da3c702da",
  "17b9f926-c927-59be-9adb-1434a971e2e4",
  "cc3fde74-3c6d-5dc6-8e87-eb463e45ade3",
  "f89658dd-d378-593d-9ec0-b8dae693f0af",
  "dc1f0006-1076-5e28-8608-63ecd96240eb",
] as const;
export const DISCOVERY_PREFERENCE_OPERATION = "discovery_preference.put";

export function validateDiscoveryPreference(input: unknown): PutDiscoveryPreference {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["cityId", "expectedVersion"].includes(key))) {
    throw unprocessable("DISCOVERY_PREFERENCE_INVALID", "Некорректные настройки города");
  }
  const { cityId, expectedVersion } = input as Record<string, unknown>;
  if (!DISCOVERY_CITY_IDS.some(id => id === cityId)) {
    throw unprocessable("CITY_ID_INVALID", "Выберите поддерживаемый город");
  }
  if (!Number.isSafeInteger(expectedVersion) ||
      (expectedVersion as number) < 0 || (expectedVersion as number) > 2147483647) {
    throw unprocessable("EXPECTED_VERSION_INVALID", "Некорректный expectedVersion");
  }
  return { cityId: cityId as PutDiscoveryPreference["cityId"], expectedVersion: expectedVersion as number };
}

/** Profiles owns this private resource; it does not depend on SocialProfile or Radar. */
@Injectable()
export class DiscoveryPreferencesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly idempotency: IdempotencyService,
    private readonly mutations: MutationRunner,
  ) {}

  async getOwn(userId: string): Promise<DiscoveryPreference> {
    const result = await this.pool.query<DiscoveryPreference>(
      `SELECT p.city_id AS "cityId", COALESCE(p.version, 0) AS version
       FROM users u LEFT JOIN user_discovery_preferences p ON p.user_id = u.id
       WHERE u.id = $1 AND u.status = 'active'`, [userId]);
    if (!result.rows[0]) throw unauthorized("ACCOUNT_INACTIVE", "Аккаунт недоступен");
    return result.rows[0];
  }

  async putOwn(userId: string, sessionId: string, key: string, input: unknown) {
    const preference = validateDiscoveryPreference(input);
    return this.mutations.runIdempotent<DiscoveryPreference>({
      actorId: userId, sessionId, operation: DISCOVERY_PREFERENCE_OPERATION, key,
      requestHash: this.idempotency.requestHash(preference),
      authorizeReplay: async () => { /* Own-only; MutationRunner rechecks active actor/session. */ },
      execute: async client => {
        // Actor fence serializes even absent-row writes. Conditional SQL remains
        // the version authority; no read-then-upsert or blind conflict overwrite.
        const result = preference.expectedVersion === 0
          ? await client.query<DiscoveryPreference>(
              `INSERT INTO user_discovery_preferences(user_id, city_id, version)
               VALUES ($1, $2, 1) ON CONFLICT (user_id) DO NOTHING
               RETURNING city_id AS "cityId", version`, [userId, preference.cityId])
          : await client.query<DiscoveryPreference>(
              `UPDATE user_discovery_preferences SET city_id = $2, version = version + 1, updated_at = now()
               WHERE user_id = $1 AND version = $3 AND version < 2147483647
               RETURNING city_id AS "cityId", version`, [userId, preference.cityId, preference.expectedVersion]);
        if (!result.rows[0]) throw conflict("VERSION_CONFLICT", "Версия настроек города устарела");
        return { statusCode: 200, body: result.rows[0] };
      },
    });
  }
}
