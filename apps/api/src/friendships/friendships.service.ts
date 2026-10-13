import { Inject, Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { FriendshipView, FriendshipReceipt } from "@gobadminton/contracts/friendship-types";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict, problem, serviceUnavailable } from "../auth/problem";
import { ActorFenceService } from "../common/actor-fence.service";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { PairFenceService } from "../safety/pair-fence.service";
import { avatarForUser } from "../profiles/avatar-presentation";
import { unrestrictedSql } from "../restrictions/policy";
import { assertDecision, createRequest, decideRequest, effectivePending, eligible, emptyView,
  friendsEnabled, listQuery, parse, unavailable, uuid, type Availability, type FriendshipRow } from "./friendships.policy";

type Action = "accept" | "decline" | "cancel" | "remove";
type Context = { profiles: Availability[]; blocked: boolean; now: Date };

@Injectable()
export class FriendshipsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService,
    private readonly actors: ActorFenceService,
    private readonly pairs: PairFenceService) {}

  private assertEnabled() {
    if (!friendsEnabled(this.env)) throw serviceUnavailable("FRIENDS_UNAVAILABLE", "Друзья недоступны");
  }
  private async schema(client: PoolClient) {
    const r = await client.query("SELECT to_regclass('friendships') AS name");
    if (!r.rows[0]?.name) throw serviceUnavailable("FRIENDS_UNAVAILABLE", "Друзья недоступны");
  }
  /** Profile SHARE one at a time, sorted; no peer-user SHARE upgrades. Status
   * writers take user→profile and bump epoch before committing (migration0032). */
  private async profiles(client: PoolClient, a: string, b?: string): Promise<Availability[]> {
    const ids = [...new Set([a, ...(b ? [b] : [])])].sort();
    for (const id of ids) {
      await client.query("SELECT user_id FROM player_social_profiles WHERE user_id=$1 FOR SHARE", [id]);
    }
    const r = await client.query<Availability>(`SELECT p.*, u.status,
      ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "p.user_id", ["account.access", "profile.public", "social.directory"])} AS unrestricted
      FROM player_social_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=ANY($1::uuid[])`, [ids]);
    return r.rows;
  }
  private async context(client: PoolClient, profiles: Availability[], pairId: string): Promise<Context> {
    const r = await client.query(`SELECT clock_timestamp() AS now,
      EXISTS(SELECT 1 FROM user_blocks WHERE pair_id=$1) AS blocked`, [pairId]);
    return { profiles, blocked: r.rows[0].blocked, now: r.rows[0].now };
  }
  private async lock(client: PoolClient, actor: string, locator: FriendshipRow, readOnly = false) {
    if (actor !== locator.requester_user_id && actor !== locator.recipient_user_id) unavailable();
    const profiles = await this.profiles(client, locator.requester_user_id, locator.recipient_user_id);
    const sorted = this.pairs.sortedPair(locator.requester_user_id, locator.recipient_user_id);
    const pair = readOnly
      ? (await client.query<{id: string}>("SELECT id FROM social_pairs WHERE user_low=$1 AND user_high=$2 FOR SHARE",
          [sorted.userLow,sorted.userHigh])).rows[0]
      : await this.pairs.lockOrCreate(client, locator.requester_user_id, locator.recipient_user_id);
    if (!pair) unavailable();
    const r = await client.query<FriendshipRow>(`SELECT * FROM friendships WHERE id=$1 AND pair_id=$2 FOR ${readOnly ? "SHARE" : "UPDATE"}`, [locator.id, pair.id]);
    const row = r.rows[0];
    if (!row || (actor !== row.requester_user_id && actor !== row.recipient_user_id)) unavailable();
    return { row, ctx: await this.context(client, profiles, pair.id) };
  }
  private async locate(client: PoolClient, actor: string, id: string, byRequest = false) {
    const r = await client.query<FriendshipRow>(byRequest
      ? `SELECT f.* FROM friendship_request_attempts a JOIN friendships f ON f.id=a.friendship_id
         WHERE a.request_id=$1 AND (a.requester_user_id=$2 OR a.recipient_user_id=$2)`
      : "SELECT * FROM friendships WHERE id=$1 AND (requester_user_id=$2 OR recipient_user_id=$2)", [id, actor]);
    if (!r.rows[0]) unavailable();
    return r.rows[0];
  }
  private receipt(row: FriendshipRow, outcome: FriendshipReceipt["outcome"]): FriendshipReceipt {
    return { friendshipId: row.id, requestId: row.request_id, version: row.version, outcome };
  }
  private async replay(client: PoolClient, actor: string, receipt: FriendshipReceipt, safe: boolean) {
    await this.schema(client);
    const { row, ctx } = await this.lock(client, actor, await this.locate(client, actor, receipt.friendshipId));
    if (safe) return; // Own minimal acknowledgement contains no peer or rights.
    this.assertEnabled();
    if (row.request_id !== receipt.requestId || row.version !== receipt.version || ctx.blocked
      || !ctx.profiles.every(eligible) || ctx.profiles.length !== 2
      || (row.state === "pending" ? !effectivePending(row, ctx.profiles, ctx.blocked, ctx.now) : row.state !== "accepted")) unavailable();
  }
  async create(actor: string, sessionId: string, key: string, input: unknown) {
    this.assertEnabled();
    const body = parse(createRequest, input);
    return this.mutations.runIdempotent<FriendshipReceipt>({ actorId: actor, sessionId,
      operation: "friendships.request", key, requestHash: this.idempotency.requestHash(body),
      requiredCapabilities: ["profile.public", "social.directory"],
      authorizeReplay: (client, receipt) => this.replay(client, actor, receipt, false),
      execute: async client => {
        await this.schema(client);
        const target = await client.query<{user_id: string}>("SELECT user_id FROM player_social_profiles WHERE public_player_id=$1", [body.targetPublicPlayerId]);
        const peer = target.rows[0]?.user_id;
        if (!peer || peer === actor) unavailable();
        const profiles = await this.profiles(client, actor, peer);
        const pair = await this.pairs.lockOrCreate(client, actor, peer);
        const ctx = await this.context(client, profiles, pair.id);
        if (ctx.blocked || profiles.length !== 2 || !profiles.every(eligible)) unavailable();
        const current = (await client.query<FriendshipRow>("SELECT * FROM friendships WHERE pair_id=$1 FOR UPDATE", [pair.id])).rows[0];
        if (current?.state === "accepted") throw conflict("FRIENDSHIP_EXISTS", "Состояние изменилось");
        if (current && effectivePending(current, profiles, ctx.blocked, ctx.now)) {
          if (current.requester_user_id !== actor) throw conflict("FRIEND_REQUEST_DECISION_REQUIRED", "Требуется решение по входящему запросу");
          return { statusCode: 200, body: this.receipt(current, "pending") };
        }
        await this.charge(client, actor, peer, ctx.now);
        const requestId = randomUUID();
        const expires = new Date(ctx.now.getTime() + this.env.FRIENDS_REQUEST_TTL_SECONDS! * 1000);
        if (!Number.isFinite(expires.getTime())) throw serviceUnavailable("FRIENDS_UNAVAILABLE", "Друзья недоступны");
        const requesterEpoch = profiles.find(p => p.user_id === actor)!.social_action_epoch;
        const recipientEpoch = profiles.find(p => p.user_id === peer)!.social_action_epoch;
        const values = [pair.id, actor, peer, requestId, requesterEpoch, recipientEpoch, ctx.now, expires];
        const result = current
          ? await client.query<FriendshipRow>(`UPDATE friendships SET requester_user_id=$2,recipient_user_id=$3,
              request_id=$4,requester_epoch=$5,recipient_epoch=$6,requested_at=$7,expires_at=$8,
              accepted_at=NULL,state='pending',generation=generation+1,version=version+1,updated_at=clock_timestamp()
              WHERE pair_id=$1 AND version=$9 AND generation=$10 RETURNING *`, [...values, current.version, current.generation])
          : await client.query<FriendshipRow>(`INSERT INTO friendships(pair_id,requester_user_id,recipient_user_id,request_id,
              requester_epoch,recipient_epoch,requested_at,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`, values);
        const row = result.rows[0];
        if (!row) throw conflict("FRIENDSHIP_STALE", "Состояние изменилось");
        await client.query(`INSERT INTO friendship_request_attempts(request_id,friendship_id,generation,requester_user_id,
          recipient_user_id,requested_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [row.request_id,row.id,row.generation,row.requester_user_id,row.recipient_user_id,row.requested_at,row.expires_at]);
        return { statusCode: 201, body: this.receipt(row, "pending") };
      } });
  }
  private async charge(client: PoolClient, actor: string, peer: string, now: Date) {
    const ms = this.env.FRIENDS_RATE_WINDOW_SECONDS! * 1000;
    const start = new Date(Math.floor(now.getTime() / ms) * ms);
    const end = new Date(start.getTime() + ms);
    if (!Number.isFinite(end.getTime())) throw serviceUnavailable("FRIENDS_UNAVAILABLE", "Друзья недоступны");
    const budgets = [{ user: actor, bucket: "friend.send", cap: this.env.FRIENDS_SEND_LIMIT! },
      { user: peer, bucket: "friend.receive", cap: this.env.FRIENDS_RECEIVE_LIMIT! }]
      .sort((a,b) => a.user.localeCompare(b.user) || a.bucket.localeCompare(b.bucket));
    for (const budget of budgets) {
      await client.query(`INSERT INTO social_action_rate_buckets(user_id,bucket,window_start,expires_at)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [budget.user,budget.bucket,start,end]);
      const r = await client.query<{count: number}>(`SELECT count FROM social_action_rate_buckets
        WHERE user_id=$1 AND bucket=$2 AND window_start=$3 FOR UPDATE`, [budget.user,budget.bucket,start]);
      if (r.rows[0]!.count >= budget.cap) {
        if (budget.user !== actor) unavailable();
        throw problem(429, "FRIEND_REQUEST_RATE_LIMITED", "Повторите позднее", undefined,
          Math.max(1, Math.ceil((end.getTime()-now.getTime())/1000)));
      }
      await client.query(`UPDATE social_action_rate_buckets SET count=count+1
        WHERE user_id=$1 AND bucket=$2 AND window_start=$3`, [budget.user,budget.bucket,start]);
    }
  }
  async decide(actor: string, sessionId: string, key: string, idRaw: string, action: Action, input: unknown) {
    const id = parse(uuid, idRaw);
    const body = parse(decideRequest, input);
    if (action === "accept") this.assertEnabled();
    return this.mutations.runIdempotent<FriendshipReceipt>({ actorId: actor, sessionId,
      operation: `friendships.${action}`, key, requestHash: this.idempotency.requestHash({ id, ...body }),
      requiredCapabilities: action === "accept" ? ["profile.public", "social.directory"] : [],
      authorizeReplay: (client, receipt) => this.replay(client, actor, receipt, action !== "accept"),
      execute: async client => {
        await this.schema(client);
        const { row, ctx } = await this.lock(client, actor, await this.locate(client, actor, id, action !== "remove"));
        assertDecision(row, actor, action, id, body.expectedVersion);
        // Safe terminal actions are allowed with a dormant peer and feature OFF;
        // they still snapshot/check policy under locks and confer no entitlement.
        const live = effectivePending(row, ctx.profiles, ctx.blocked, ctx.now);
        if (action === "accept" && !live) unavailable();
        const state = { accept: "accepted", decline: "declined", cancel: "cancelled", remove: "removed" }[action];
        const updated = await client.query<FriendshipRow>(`UPDATE friendships SET state=$2,version=version+1,
          accepted_at=CASE WHEN $2='accepted' THEN clock_timestamp() ELSE NULL END,
          expires_at=CASE WHEN $2='accepted' THEN NULL ELSE expires_at END,updated_at=clock_timestamp()
          WHERE id=$1 AND request_id=$3 AND version=$4 AND generation=$5 RETURNING *`,
          [row.id, state, row.request_id, body.expectedVersion, row.generation]);
        if (!updated.rows[0]) throw conflict("FRIENDSHIP_STALE", "Состояние изменилось");
        return { statusCode: 200, body: this.receipt(updated.rows[0], state as FriendshipReceipt["outcome"]) };
      } });
  }
  /** All owner reads use the existing actor/session fence and one transaction. */
  private async read<T>(actor: string, sessionId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      await this.actors.assertActiveConsumerInTransaction(client, {actorId: actor, sessionId});
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async capabilities(actor: string, sessionId: string) {
    return this.read(actor, sessionId, async client => {
      const installed = (await client.query("SELECT to_regclass('friendships') AS name")).rows[0]?.name;
      const friends = Boolean(installed && friendsEnabled(this.env)
        && eligible((await this.profiles(client, actor))[0]));
      return { friends, gameRecommendations: false, gameAttention: false, socialPush: false };
    });
  }
  private async view(client: PoolClient, actor: string, row: FriendshipRow, ctx: Context): Promise<FriendshipView> {
    const peerId = row.requester_user_id === actor ? row.recipient_user_id : row.requester_user_id;
    const peer = ctx.profiles.find(p => p.user_id === peerId);
    const visible = !ctx.blocked && eligible(peer) && eligible(ctx.profiles.find(p => p.user_id === actor));
    const live = effectivePending(row, ctx.profiles, ctx.blocked, ctx.now);
    const accepted = row.state === "accepted" && !ctx.blocked;
    const pending = live && friendsEnabled(this.env);
    const relationship = accepted ? "friends" : pending
      ? row.requester_user_id === actor ? "outgoing_pending" : "incoming_pending" : "unavailable";
    return { friendshipId: row.id, relationship, version: row.version,
      request: pending ? { id: row.request_id, expiresAt: row.expires_at!.toISOString() } : null,
      peer: visible && (accepted || pending) ? { publicPlayerId: peer.public_player_id, displayName: peer.display_name,
        avatar: await avatarForUser(client, peerId) } : null,
      capabilities: { canRequest: false, canAccept: pending && row.recipient_user_id === actor,
        canDecline: row.state === "pending" && row.recipient_user_id === actor,
        canCancel: row.state === "pending" && row.requester_user_id === actor,
        canRemove: row.state === "accepted" } };
  }
  async get(actor: string, sessionId: string, idRaw: string) {
    const id = parse(uuid, idRaw);
    return this.read(actor, sessionId, async client => {
      await this.schema(client);
      const { row, ctx } = await this.lock(client, actor, await this.locate(client, actor, id), true);
      return this.view(client, actor, row, ctx);
    });
  }
  async states(actor: string, sessionId: string, idsRaw: unknown) {
    const ids = parse(uuid.array().min(1).max(50), Array.isArray(idsRaw) ? idsRaw : [idsRaw]);
    return this.read(actor, sessionId, async client => {
      await this.schema(client);
      // Acquire all profile fences first, sorted, before any Pair (batch lock order).
      const targets = await client.query<{user_id: string; public_player_id: string}>(
        "SELECT user_id,public_player_id FROM player_social_profiles WHERE public_player_id=ANY($1::uuid[])", [ids]);
      const allIds = [...new Set([actor, ...targets.rows.map(p => p.user_id)])].sort();
      for (const user of allIds) await this.profiles(client, user);
      const existingPairs = await client.query<{id:string;user_low:string;user_high:string}>(
        "SELECT id,user_low,user_high FROM social_pairs WHERE (user_low=$1 AND user_high=ANY($2::uuid[])) OR (user_high=$1 AND user_low=ANY($2::uuid[])) ORDER BY id",
        [actor, targets.rows.map(p => p.user_id)]);
      // All batch reads acquire Pair SHARE in the same UUID order, no lazy writes.
      for (const pair of existingPairs.rows) await client.query("SELECT id FROM social_pairs WHERE id=$1 FOR SHARE", [pair.id]);
      const items: FriendshipView[] = [];
      for (const id of ids) {
        const peer = targets.rows.find(p => p.public_player_id === id)?.user_id;
        if (!peer || peer === actor) { items.push(emptyView()); continue; }
        const profiles = await this.profiles(client, actor, peer); // already held
        const pair = existingPairs.rows.find(p => p.user_low === peer || p.user_high === peer);
        const ctx = pair ? await this.context(client, profiles, pair.id) : {profiles,blocked:false,now:new Date()};
        const row = pair ? (await client.query<FriendshipRow>("SELECT * FROM friendships WHERE pair_id=$1 FOR SHARE", [pair.id])).rows[0] : undefined;
        if (row) items.push(await this.view(client, actor, row, ctx));
        else if (friendsEnabled(this.env) && !ctx.blocked && profiles.length === 2 && profiles.every(eligible)) {
          const p = profiles.find(p => p.user_id === peer)!;
          items.push({ ...emptyView(), relationship: "none", peer: { publicPlayerId: p.public_player_id,
            displayName: p.display_name, avatar: await avatarForUser(client, peer) },
            capabilities: { ...emptyView().capabilities, canRequest: true } });
        } else items.push(emptyView());
      }
      return { items };
    });
  }
  private sign(value: string) { return createHmac("sha256", this.env.AUTH_PEPPER).update(`friends-cursor:${value}`).digest("base64url"); }
  async list(actor: string, sessionId: string, input: unknown) {
    const query = parse(listQuery, input);
    // The payload is base64url, NOT encryption: never serialize internal actor IDs.
    // Keep actor/view/search exact binding but disclose only a purpose-separated keyed digest.
    const binding = createHmac("sha256", this.env.AUTH_PEPPER)
      .update("friends-cursor-binding:v1\0")
      .update(JSON.stringify([actor, query.view, query.q ?? ""]))
      .digest("base64url");
    let after: string | null = null;
    let asOf = new Date();
    if (query.cursor) {
      try {
        const [value, signature, extra] = query.cursor.split(".");
        const expected = Buffer.from(this.sign(value!));
        const actual = Buffer.from(signature ?? "");
        if (extra || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
        const data = JSON.parse(Buffer.from(value!, "base64url").toString());
        if (data.binding !== binding || !this.env.FRIENDS_REQUEST_TTL_SECONDS
          || Date.now() >= data.expires || data.asOf > Date.now()) throw new Error();
        after = parse(uuid, data.after); asOf = new Date(data.asOf);
        if (!Number.isFinite(asOf.getTime())) throw new Error();
      } catch { throw conflict("FRIENDSHIP_CURSOR_INVALID", "Обновите список"); }
    }
    return this.read(actor, sessionId, async client => {
      const installed = (await client.query("SELECT to_regclass('friendships') AS name")).rows[0]?.name;
      if (!installed) return { items: [], nextCursor: null, asOf: asOf.toISOString() };
      const field = query.view === "incoming" ? "recipient_user_id" : "requester_user_id";
      const r = await client.query<FriendshipRow>(`SELECT f.* FROM friendships f
        JOIN player_social_profiles p ON p.user_id=CASE WHEN f.requester_user_id=$1 THEN f.recipient_user_id ELSE f.requester_user_id END
        JOIN users u ON u.id=p.user_id
        WHERE ${query.view === "accepted" ? "(f.requester_user_id=$1 OR f.recipient_user_id=$1) AND f.state='accepted'" : `f.${field}=$1 AND f.state='pending'`}
        AND ($2::uuid IS NULL OR f.id>$2) AND f.requested_at<=$3
        AND ($4::text IS NULL OR (p.directory_visible AND p.social_eligible AND p.contact_policy='requests'
          AND u.status='active' AND ${unrestrictedSql(this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, "p.user_id", ["account.access", "profile.public", "social.directory"])}
          AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE b.pair_id=f.pair_id)
          AND strpos(lower(p.display_name),lower($4))>0)) ORDER BY f.id LIMIT $5`,
        [actor,after,asOf,query.q || null,query.limit+1]);
      const page = r.rows.slice(0,query.limit);
      const users = [...new Set(page.flatMap(row => [row.requester_user_id,row.recipient_user_id]))].sort();
      for (const user of users) await this.profiles(client,user);
      const items: FriendshipView[] = [];
      const views = new Map<string,FriendshipView>();
      for (const locator of [...page].sort((a,b) => a.pair_id.localeCompare(b.pair_id))) {
        const { row, ctx } = await this.lock(client, actor, locator, true);
        const view = await this.view(client,actor,row,ctx);
        // Fresh locks may observe a newer hide/decision than the candidate query.
        if (row.state !== (query.view === "accepted" ? "accepted" : "pending")) continue;
        if (query.view === "incoming" && row.recipient_user_id !== actor) continue;
        if (query.view === "outgoing" && row.requester_user_id !== actor) continue;
        if (query.q && (!view.peer || !view.peer.displayName.toLowerCase().includes(query.q.toLowerCase()))) continue;
        if (query.view !== "accepted" && !view.request) continue;
        views.set(row.id,view);
      }
      for (const row of page) { const view = views.get(row.id); if (view) items.push(view); }
      const last = page.at(-1);
      const value = last && r.rows.length > query.limit && this.env.FRIENDS_REQUEST_TTL_SECONDS
        ? Buffer.from(JSON.stringify({binding, after:last.id, asOf:asOf.getTime(),
          expires:asOf.getTime()+this.env.FRIENDS_REQUEST_TTL_SECONDS*1000})).toString("base64url") : null;
      return { items, nextCursor: value ? `${value}.${this.sign(value)}` : null, asOf:asOf.toISOString() };
    });
  }
}
