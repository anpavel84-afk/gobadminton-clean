import { HttpStatus, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { problem } from "../auth/problem";
import {
  RADAR_GEO_UPDATES_PER_HOUR,
  RADAR_NEARBY_MIN_INTERVAL_SECONDS,
  RADAR_NEARBY_PER_HOUR,
  RADAR_PREVIEW_PER_MINUTE,
  RADAR_START_TAKEOVER_PER_HOUR,
} from "./constants";

function tooMany(retryAfterSeconds: number, title: string) {
  return problem(
    HttpStatus.TOO_MANY_REQUESTS,
    "RATE_LIMITED",
    title,
    undefined,
    retryAfterSeconds,
  );
}

@Injectable()
export class RadarBudgetService {
  async consumeStartOrTakeover(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.consumeWindow(
      client,
      userId,
      "start_takeover",
      RADAR_START_TAKEOVER_PER_HOUR,
      60 * 60 * 1000,
      now,
    );
  }

  async consumeGeo(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.consumeWindow(
      client,
      userId,
      "geo_update",
      RADAR_GEO_UPDATES_PER_HOUR,
      60 * 60 * 1000,
      now,
    );
  }

  async consumePreview(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.consumeWindow(
      client,
      userId,
      "preview",
      RADAR_PREVIEW_PER_MINUTE,
      60 * 1000,
      now,
    );
  }

  async consumeNearby(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.ensureRow(client, userId, "nearby_hour", now);
    await this.ensureRow(client, userId, "nearby_interval", now);
    const locked = await client.query<{
      bucket: string;
      window_started_at: Date;
      count: number;
      next_allowed_at: Date | null;
    }>(
      `SELECT bucket, window_started_at, count, next_allowed_at
       FROM radar_rate_budgets
       WHERE user_id = $1 AND bucket IN ('nearby_hour', 'nearby_interval')
       FOR UPDATE`,
      [userId],
    );
    const byBucket = new Map(locked.rows.map((r) => [r.bucket, r]));
    const interval = byBucket.get("nearby_interval");
    const hour = byBucket.get("nearby_hour");
    if (!interval || !hour) {
      throw new Error("radar nearby budget rows missing");
    }
    if (
      interval.next_allowed_at &&
      interval.next_allowed_at.getTime() > now.getTime()
    ) {
      const retry = Math.max(
        1,
        Math.ceil((interval.next_allowed_at.getTime() - now.getTime()) / 1000),
      );
      throw tooMany(retry, "Слишком частые запросы Radar nearby");
    }
    let hourStarted = hour.window_started_at;
    let hourCount = hour.count;
    if (now.getTime() - hourStarted.getTime() >= 60 * 60 * 1000) {
      hourStarted = now;
      hourCount = 0;
    }
    if (hourCount >= RADAR_NEARBY_PER_HOUR) {
      const retry = Math.max(
        1,
        Math.ceil(
          (hourStarted.getTime() + 60 * 60 * 1000 - now.getTime()) / 1000,
        ),
      );
      throw tooMany(retry, "Превышен лимит Radar nearby");
    }
    const nextAllowed = new Date(
      now.getTime() + RADAR_NEARBY_MIN_INTERVAL_SECONDS * 1000,
    );
    await client.query(
      `UPDATE radar_rate_budgets
       SET window_started_at = $2, count = $3, next_allowed_at = NULL, updated_at = $2
       WHERE user_id = $1 AND bucket = 'nearby_hour'`,
      [userId, hourStarted, hourCount + 1],
    );
    await client.query(
      `UPDATE radar_rate_budgets
       SET window_started_at = $2, count = count + 1, next_allowed_at = $3, updated_at = $2
       WHERE user_id = $1 AND bucket = 'nearby_interval'`,
      [userId, now, nextAllowed],
    );
  }

  async consumeConfig(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.consumeWindow(client, userId, "config", 30, 60_000, now);
  }

  /** Only quota context hashes, never coordinates, proof tokens or target identifiers. */
  async consumeQueryContext(
    client: PoolClient,
    userId: string,
    cityHash: string,
    radius: number | null,
    now: Date,
  ): Promise<void> {
    for (const [bucket, hash, limit, cooldown] of [
      ["query_city", cityHash, 6, 0],
      ...(radius === null
        ? []
        : [["query_radius", String(radius), 2, 300_000]]),
    ] as [string, string, number, number][]) {
      await this.ensureRow(client, userId, bucket, now);
      const r = await client.query<{
        context_hash: string | null;
        count: number;
        window_started_at: Date;
        next_allowed_at: Date | null;
      }>(
        `SELECT context_hash,count,window_started_at,next_allowed_at FROM radar_rate_budgets WHERE user_id=$1 AND bucket=$2 FOR UPDATE`,
        [userId, bucket],
      );
      const row = r.rows[0]!;
      if (row.context_hash === hash) continue;
      const fresh = now.getTime() - row.window_started_at.getTime() >= 900_000;
      const count = fresh ? 0 : row.count;
      if (
        row.context_hash !== null &&
        ((row.next_allowed_at?.getTime() ?? 0) > now.getTime() ||
          count >= limit)
      ) {
        const until =
          count >= limit
            ? row.window_started_at.getTime() + 900_000
            : row.next_allowed_at!.getTime();
        throw tooMany(
          Math.max(1, Math.ceil((until - now.getTime()) / 1000)),
          "Слишком частая смена контекста Radar",
        );
      }
      await client.query(
        `UPDATE radar_rate_budgets SET context_hash=$3,count=$4,window_started_at=$5,next_allowed_at=$6,updated_at=$7 WHERE user_id=$1 AND bucket=$2`,
        [
          userId,
          bucket,
          hash,
          row.context_hash === null ? 0 : count + 1,
          fresh ? now : row.window_started_at,
          new Date(now.getTime() + cooldown),
          now,
        ],
      );
    }
  }

  async consumeUnified(client: PoolClient, userId: string, initial: boolean, now: Date) {
    if (!initial) return this.consumeWindow(client,userId,"unified_continuation",30,60_000,now);
    await this.ensureRow(client,userId,"unified_interval",now);
    const r=await client.query<{next_allowed_at:Date|null}>("SELECT next_allowed_at FROM radar_rate_budgets WHERE user_id=$1 AND bucket='unified_interval' FOR UPDATE",[userId]);
    const until=r.rows[0]?.next_allowed_at?.getTime()??0;
    if(until>now.getTime()) throw tooMany(Math.max(1,Math.ceil((until-now.getTime())/1000)),"Слишком частые запросы Players");
    await this.consumeWindow(client,userId,"unified_hour",120,3_600_000,now);
    await client.query("UPDATE radar_rate_budgets SET next_allowed_at=$2,updated_at=$3 WHERE user_id=$1 AND bucket='unified_interval'",[userId,new Date(now.getTime()+30_000),now]);
  }

  private async ensureRow(
    client: PoolClient,
    userId: string,
    bucket: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO radar_rate_budgets (user_id, bucket, window_started_at, count, next_allowed_at)
       VALUES ($1, $2, $3, 0, NULL)
       ON CONFLICT (user_id, bucket) DO NOTHING`,
      [userId, bucket, now],
    );
  }

  private async consumeWindow(
    client: PoolClient,
    userId: string,
    bucket: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<void> {
    await this.ensureRow(client, userId, bucket, now);
    const locked = await client.query<{
      window_started_at: Date;
      count: number;
    }>(
      `SELECT window_started_at, count
       FROM radar_rate_budgets
       WHERE user_id = $1 AND bucket = $2
       FOR UPDATE`,
      [userId, bucket],
    );
    const row = locked.rows[0];
    if (!row) throw new Error("radar budget row missing");
    let started = row.window_started_at;
    let count = row.count;
    if (now.getTime() - started.getTime() >= windowMs) {
      started = now;
      count = 0;
    }
    if (count >= limit) {
      const retry = Math.max(
        1,
        Math.ceil((started.getTime() + windowMs - now.getTime()) / 1000),
      );
      throw tooMany(retry, "Превышен лимит Radar");
    }
    await client.query(
      `UPDATE radar_rate_budgets
       SET window_started_at = $3, count = $4, updated_at = $5
       WHERE user_id = $1 AND bucket = $2`,
      [userId, bucket, started, count + 1, now],
    );
  }
}
