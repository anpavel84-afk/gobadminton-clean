import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PlayInterestReceipt, PlayInterestView } from "@gobadminton/contracts/friendship-types";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict, problem, serviceUnavailable } from "../auth/problem";
import { ActorFenceService } from "../common/actor-fence.service";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { PairFenceService } from "../safety/pair-fence.service";
import { unrestrictedSql } from "../restrictions/policy";
import {
  actorRelationship, canSend, createRequest, effectiveActive, eligible, emptyView,
  parse, PLAY_INTEREST_RATE_WINDOW_SECONDS, PLAY_INTEREST_SEND_LIMIT, playInterestsEnabled,
  unavailable, uuid, withdrawRequest, type Availability, type PlayInterestRow,
} from "./play-interests.policy";

type Context = { profiles: Availability[]; blocked: boolean };

@Injectable()
export class PlayInterestsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
    private readonly actors: ActorFenceService,
    private readonly pairs: PairFenceService,
  ) {}

  private assertEnabled() {
    if (!playInterestsEnabled(this.env)) {
      throw serviceUnavailable("PLAY_INTERESTS_UNAVAILABLE", "Интерес к игре недоступен");
    }
  }

  private async schema(client: PoolClient) {
    const r = await client.query("SELECT to_regclass('play_interests') AS name");
    if (!r.rows[0]?.name) {
      throw serviceUnavailable("PLAY_INTERESTS_UNAVAILABLE", "Интерес к игре недоступен");
    }
  }

  private restrictionsOn(): boolean {
    return this.env.USER_RESTRICTIONS_INTERNAL_ENABLED
      || (this.env.NODE_ENV === "production" && playInterestsEnabled(this.env));
  }

  /** Profile SHARE one at a time, sorted — same order as Friendships writers. */
  private async profiles(client: PoolClient, a: string, b?: string): Promise<Availability[]> {
    const ids = [...new Set([a, ...(b ? [b] : [])])].sort();
    for (const id of ids) {
      await client.query("SELECT user_id FROM player_social_profiles WHERE user_id=$1 FOR SHARE", [id]);
    }
    const r = await client.query<Availability>(`SELECT p.*, u.status,
      ${unrestrictedSql(this.restrictionsOn(), "p.user_id", ["account.access", "profile.public", "social.directory"])} AS unrestricted
      FROM player_social_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=ANY($1::uuid[])`, [ids]);
    return r.rows;
  }

  private async context(client: PoolClient, profiles: Availability[], pairId: string): Promise<Context> {
    const r = await client.query(`SELECT EXISTS(SELECT 1 FROM user_blocks WHERE pair_id=$1) AS blocked`, [pairId]);
    return { profiles, blocked: Boolean(r.rows[0]?.blocked) };
  }

  private async directions(client: PoolClient, pairId: string, forUpdate: boolean) {
    const r = await client.query<PlayInterestRow>(
      `SELECT * FROM play_interests WHERE pair_id=$1 FOR ${forUpdate ? "UPDATE" : "SHARE"}`,
      [pairId],
    );
    return r.rows;
  }

  private receipt(row: PlayInterestRow, outcome: PlayInterestReceipt["outcome"]): PlayInterestReceipt {
    return { interestId: row.interest_id, version: row.version, outcome };
  }

  private view(
    actor: string,
    rows: PlayInterestRow[],
    ctx: Context,
  ): PlayInterestView {
    const own = rows.find(r => r.actor_user_id === actor);
    const peer = rows.find(r => r.peer_user_id === actor);
    const enabled = playInterestsEnabled(this.env);
    const relationship = actorRelationship(own, peer, ctx.profiles, ctx.blocked, enabled);
    const ownLive = Boolean(own && effectiveActive(own, ctx.profiles, ctx.blocked));
    return {
      interestId: ownLive && own ? own.interest_id : null,
      relationship,
      version: ownLive && own ? own.version : null,
      capabilities: {
        canSend: canSend(own, ctx.profiles, ctx.blocked, enabled),
        canWithdraw: ownLive && Boolean(own),
      },
    };
  }

  private async replay(client: PoolClient, actor: string, receipt: PlayInterestReceipt, safe: boolean) {
    await this.schema(client);
    const located = (await client.query<PlayInterestRow>(
      "SELECT * FROM play_interests WHERE interest_id=$1 AND actor_user_id=$2",
      [receipt.interestId, actor],
    )).rows[0];
    if (!located) unavailable();
    const profiles = await this.profiles(client, located.actor_user_id, located.peer_user_id);
    const pair = await this.pairs.lockOrCreate(client, located.actor_user_id, located.peer_user_id);
    const rows = await this.directions(client, pair.id, true);
    const row = rows.find(r => r.interest_id === receipt.interestId);
    if (!row || row.version !== receipt.version) unavailable();
    if (safe) {
      // Terminal withdraw acknowledgement is actor-owned; confers no mutual rights.
      if (receipt.outcome === "withdrawn" && row.state === "withdrawn") return;
      if (receipt.outcome === "withdrawn") unavailable();
      return;
    }
    this.assertEnabled();
    const ctx = await this.context(client, profiles, pair.id);
    // Peer may become mutual later without a new actor write; require own live identity only.
    if (receipt.outcome === "withdrawn" || !effectiveActive(row, ctx.profiles, ctx.blocked)) unavailable();
  }

  async create(actor: string, sessionId: string, key: string, input: unknown) {
    this.assertEnabled();
    const body = parse(createRequest, input);
    return this.mutations.runIdempotent<PlayInterestReceipt>({
      actorId: actor,
      sessionId,
      operation: "play_interests.send",
      key,
      requestHash: this.idempotency.requestHash(body),
      requiredCapabilities: ["profile.public", "social.directory"],
      authorizeReplay: (client, receipt) => this.replay(client, actor, receipt, false),
      execute: async client => {
        await this.schema(client);
        const target = await client.query<{ user_id: string }>(
          "SELECT user_id FROM player_social_profiles WHERE public_player_id=$1",
          [body.targetPublicPlayerId],
        );
        const peer = target.rows[0]?.user_id;
        if (!peer || peer === actor) unavailable();
        const profiles = await this.profiles(client, actor, peer);
        const pair = await this.pairs.lockOrCreate(client, actor, peer);
        const ctx = await this.context(client, profiles, pair.id);
        if (ctx.blocked || profiles.length !== 2 || !profiles.every(eligible)) unavailable();
        const rows = await this.directions(client, pair.id, true);
        const current = rows.find(r => r.actor_user_id === actor);
        if (current && effectiveActive(current, profiles, ctx.blocked)) {
          const peerRow = rows.find(r => r.actor_user_id === peer);
          const outcome = effectiveActive(peerRow, profiles, ctx.blocked) ? "mutual" : "outgoing";
          return { statusCode: 200, body: this.receipt(current, outcome) };
        }
        await this.charge(client, actor, new Date());
        const actorEpoch = profiles.find(p => p.user_id === actor)!.social_action_epoch;
        const peerEpoch = profiles.find(p => p.user_id === peer)!.social_action_epoch;
        const interestId = randomUUID();
        const result = current
          ? await client.query<PlayInterestRow>(`UPDATE play_interests SET
              interest_id=$2, state='active', actor_epoch=$3, peer_epoch=$4,
              generation=generation+1, version=version+1, updated_at=clock_timestamp()
              WHERE id=$1 AND version=$5 AND generation=$6 RETURNING *`,
            [current.id, interestId, actorEpoch, peerEpoch, current.version, current.generation])
          : await client.query<PlayInterestRow>(`INSERT INTO play_interests(
              pair_id, actor_user_id, peer_user_id, interest_id, state, actor_epoch, peer_epoch)
              VALUES($1,$2,$3,$4,'active',$5,$6) RETURNING *`,
            [pair.id, actor, peer, interestId, actorEpoch, peerEpoch]);
        const row = result.rows[0];
        if (!row) throw conflict("PLAY_INTEREST_STALE", "Состояние изменилось");
        await client.query(
          `UPDATE social_pairs SET version=version+1, updated_at=clock_timestamp() WHERE id=$1`,
          [pair.id],
        );
        const peerRow = rows.find(r => r.actor_user_id === peer)
          ?? (await client.query<PlayInterestRow>(
            "SELECT * FROM play_interests WHERE pair_id=$1 AND actor_user_id=$2 FOR SHARE",
            [pair.id, peer],
          )).rows[0];
        const outcome = effectiveActive(peerRow, profiles, ctx.blocked) ? "mutual" : "outgoing";
        return { statusCode: 201, body: this.receipt(row, outcome) };
      },
    });
  }

  private async charge(client: PoolClient, actor: string, now: Date) {
    const ms = PLAY_INTEREST_RATE_WINDOW_SECONDS * 1000;
    const start = new Date(Math.floor(now.getTime() / ms) * ms);
    const end = new Date(start.getTime() + ms);
    if (!Number.isFinite(end.getTime())) {
      throw serviceUnavailable("PLAY_INTERESTS_UNAVAILABLE", "Интерес к игре недоступен");
    }
    await client.query(
      `INSERT INTO social_action_rate_buckets(user_id,bucket,window_start,expires_at)
       VALUES($1,'play.interest.send',$2,$3) ON CONFLICT DO NOTHING`,
      [actor, start, end],
    );
    const r = await client.query<{ count: number }>(
      `SELECT count FROM social_action_rate_buckets
       WHERE user_id=$1 AND bucket='play.interest.send' AND window_start=$2 FOR UPDATE`,
      [actor, start],
    );
    if ((r.rows[0]?.count ?? 0) >= PLAY_INTEREST_SEND_LIMIT) {
      throw problem(429, "PLAY_INTEREST_RATE_LIMITED", "Повторите позднее", undefined,
        Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 1000)));
    }
    await client.query(
      `UPDATE social_action_rate_buckets SET count=count+1
       WHERE user_id=$1 AND bucket='play.interest.send' AND window_start=$2`,
      [actor, start],
    );
  }

  async withdraw(actor: string, sessionId: string, key: string, idRaw: string, input: unknown) {
    const id = parse(uuid, idRaw);
    const body = parse(withdrawRequest, input);
    return this.mutations.runIdempotent<PlayInterestReceipt>({
      actorId: actor,
      sessionId,
      operation: "play_interests.withdraw",
      key,
      requestHash: this.idempotency.requestHash({ id, ...body }),
      requiredCapabilities: [],
      authorizeReplay: (client, receipt) => this.replay(client, actor, receipt, true),
      execute: async client => {
        await this.schema(client);
        const located = (await client.query<PlayInterestRow>(
          "SELECT * FROM play_interests WHERE interest_id=$1 AND actor_user_id=$2",
          [id, actor],
        )).rows[0];
        if (!located) unavailable();
        const profiles = await this.profiles(client, located.actor_user_id, located.peer_user_id);
        const pair = await this.pairs.lockOrCreate(client, located.actor_user_id, located.peer_user_id);
        const rows = await this.directions(client, pair.id, true);
        const row = rows.find(r => r.interest_id === id);
        if (!row || row.actor_user_id !== actor) unavailable();
        if (row.version !== body.expectedVersion || row.state !== "active") {
          throw conflict("PLAY_INTEREST_STALE", "Состояние изменилось");
        }
        const updated = await client.query<PlayInterestRow>(
          `UPDATE play_interests SET state='withdrawn', version=version+1, updated_at=clock_timestamp()
           WHERE id=$1 AND interest_id=$2 AND version=$3 AND generation=$4 RETURNING *`,
          [row.id, row.interest_id, body.expectedVersion, row.generation],
        );
        if (!updated.rows[0]) throw conflict("PLAY_INTEREST_STALE", "Состояние изменилось");
        await client.query(
          `UPDATE social_pairs SET version=version+1, updated_at=clock_timestamp() WHERE id=$1`,
          [pair.id],
        );
        // Withdraw remains available even when feature/peer are dormant; confers no rights.
        void profiles;
        return { statusCode: 200, body: this.receipt(updated.rows[0], "withdrawn") };
      },
    });
  }

  private async read<T>(actor: string, sessionId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      await this.actors.assertActiveConsumerInTransaction(client, { actorId: actor, sessionId });
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async states(actor: string, sessionId: string, idsRaw: unknown) {
    const ids = parse(uuid.array().min(1).max(50), Array.isArray(idsRaw) ? idsRaw : [idsRaw]);
    return this.read(actor, sessionId, async client => {
      const installed = (await client.query("SELECT to_regclass('play_interests') AS name")).rows[0]?.name;
      if (!installed || !playInterestsEnabled(this.env)) {
        return { items: ids.map(() => emptyView()) };
      }
      const targets = await client.query<{ user_id: string; public_player_id: string }>(
        "SELECT user_id, public_player_id FROM player_social_profiles WHERE public_player_id=ANY($1::uuid[])",
        [ids],
      );
      const allIds = [...new Set([actor, ...targets.rows.map(p => p.user_id)])].sort();
      for (const user of allIds) await this.profiles(client, user);
      const existingPairs = await client.query<{ id: string; user_low: string; user_high: string }>(
        `SELECT id, user_low, user_high FROM social_pairs
         WHERE (user_low=$1 AND user_high=ANY($2::uuid[])) OR (user_high=$1 AND user_low=ANY($2::uuid[]))
         ORDER BY id`,
        [actor, targets.rows.map(p => p.user_id)],
      );
      for (const pair of existingPairs.rows) {
        await client.query("SELECT id FROM social_pairs WHERE id=$1 FOR SHARE", [pair.id]);
      }
      const items: PlayInterestView[] = [];
      for (const id of ids) {
        const peer = targets.rows.find(p => p.public_player_id === id)?.user_id;
        if (!peer || peer === actor) {
          items.push(emptyView());
          continue;
        }
        const profiles = await this.profiles(client, actor, peer);
        const pair = existingPairs.rows.find(p => p.user_low === peer || p.user_high === peer);
        const ctx = pair
          ? await this.context(client, profiles, pair.id)
          : { profiles, blocked: false };
        const rows = pair
          ? (await client.query<PlayInterestRow>(
            "SELECT * FROM play_interests WHERE pair_id=$1 FOR SHARE",
            [pair.id],
          )).rows
          : [];
        if (rows.length) items.push(this.view(actor, rows, ctx));
        else if (playInterestsEnabled(this.env) && !ctx.blocked && profiles.length === 2 && profiles.every(eligible)) {
          items.push({
            ...emptyView(),
            relationship: "none",
            capabilities: { canSend: true, canWithdraw: false },
          });
        } else items.push(emptyView());
      }
      return { items };
    });
  }
}
