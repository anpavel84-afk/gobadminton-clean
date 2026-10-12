import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

export type PairFenceRow = {
  id: string;
  user_low: string;
  user_high: string;
  version: number;
};

/**
 * Lazy undirected PairFence. Call after identity/session fence.
 * Always lock sorted {user_low,user_high}.
 */
@Injectable()
export class PairFenceService {
  sortedPair(a: string, b: string): { userLow: string; userHigh: string } {
    return a < b
      ? { userLow: a, userHigh: b }
      : { userLow: b, userHigh: a };
  }

  async lockOrCreate(
    client: PoolClient,
    userA: string,
    userB: string,
  ): Promise<PairFenceRow> {
    if (userA === userB) {
      throw new Error("pair fence requires distinct users");
    }
    const { userLow, userHigh } = this.sortedPair(userA, userB);
    await client.query(
      `INSERT INTO social_pairs (user_low, user_high)
       VALUES ($1, $2)
       ON CONFLICT (user_low, user_high) DO NOTHING`,
      [userLow, userHigh],
    );
    const result = await client.query<PairFenceRow>(
      `SELECT id, user_low, user_high, version
       FROM social_pairs
       WHERE user_low = $1 AND user_high = $2
       FOR UPDATE`,
      [userLow, userHigh],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("failed to lock social pair");
    }
    return row;
  }
}
