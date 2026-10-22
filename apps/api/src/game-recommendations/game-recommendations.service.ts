import { Inject, Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppEnv } from "../config/env";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { conflict, problem, serviceUnavailable } from "../auth/problem";
import { ActorFenceService } from "../common/actor-fence.service";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner } from "../common/mutation-runner.service";
import { FriendshipsService } from "../friendships/friendships.service";
import { effectiveAccepted, friendsEnabled, unavailable } from "../friendships/friendships.policy";
import { GamesService } from "../games/games.service";
import { assertDecision, assertRole, decisionRequest, listQuery, parse, sendRequest, stale, uuid,
  type Action, type Receipt, type RecommendationRow } from "./game-recommendations.policy";

type Context = Awaited<ReturnType<FriendshipsService["recommendationContext"]>>;
type Summary = NonNullable<Awaited<ReturnType<GamesService["recommendationSummary"]>>>;
type Item = {id:string;version:number;state:"active"|"withdrawn";createdAt:string;expiresAt:string;
  game:Summary;peer:{publicPlayerId:string;displayName:string}};

@Injectable()
export class GameRecommendationsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool:Pool,@Inject(APP_ENV) private readonly env:AppEnv,
    private readonly mutations:MutationRunner,private readonly idempotency:IdempotencyService,
    private readonly actors:ActorFenceService,private readonly friends:FriendshipsService,
    private readonly games:GamesService) {}
  private enabled() {
    if (!friendsEnabled(this.env)) throw serviceUnavailable("GAME_RECOMMENDATIONS_UNAVAILABLE","Рекомендации недоступны");
  }
  private async installed(client:PoolClient) {
    return Boolean((await client.query("SELECT to_regclass('game_recommendations') AS name")).rows[0]?.name);
  }
  private async schema(client:PoolClient) {
    if (!await this.installed(client)) throw serviceUnavailable("GAME_RECOMMENDATIONS_UNAVAILABLE","Рекомендации недоступны");
  }
  private async locate(client:PoolClient,actor:string,id:string,lock=false):Promise<RecommendationRow> {
    const row=(await client.query<RecommendationRow>(`SELECT * FROM game_recommendations
      WHERE id=$1 AND (sender_user_id=$2 OR recipient_user_id=$2) ${lock ? "FOR UPDATE" : ""}`,[id,actor])).rows[0];
    if (!row) unavailable();return row;
  }
  private current(row:RecommendationRow,ctx:Context) {
    return effectiveAccepted(ctx.row,ctx.ctx.profiles,ctx.ctx.blocked)
      && ctx.row.generation===row.friendship_generation && row.expires_at>ctx.ctx.now
      && ctx.ctx.profiles.find(p=>p.user_id===row.sender_user_id)?.social_action_epoch===row.sender_epoch
      && ctx.ctx.profiles.find(p=>p.user_id===row.recipient_user_id)?.social_action_epoch===row.recipient_epoch;
  }
  private receipt(row:RecommendationRow,outcome:Receipt["outcome"]):Receipt {
    return {id:row.id,version:row.version,outcome};
  }
  /** Same-key send replay never confirms a now-hidden/withdrawn/stale delivery. */
  private async replaySend(client:PoolClient,actor:string,receipt:Receipt) {
    this.enabled();await this.schema(client);
    const locator=await this.locate(client,actor,receipt.id);
    if (locator.sender_user_id!==actor) unavailable();
    const game=await this.games.recommendationSummary(client,locator.game_id);
    const ctx=await this.friends.recommendationContext(client,actor,locator.friendship_id);
    const row=await this.locate(client,actor,receipt.id,true);
    if (!game || !this.current(row,ctx) || row.state!=="active" || row.recipient_hidden
      || row.version!==receipt.version) unavailable();
  }
  async send(actor:string,sessionId:string,key:string,gameRaw:string,input:unknown) {
    this.enabled();const gameId=parse(uuid,gameRaw),body=parse(sendRequest,input);
    return this.mutations.runIdempotent<Receipt>({actorId:actor,sessionId,key,operation:"game_recommendations.send",
      requestHash:this.idempotency.requestHash({gameId,...body}),
      requiredCapabilities:["profile.public","social.directory"],
      authorizeReplay:(client,receipt)=>this.replaySend(client,actor,receipt),
      execute:async client=>{
        await this.schema(client);
        // Lock order: Actor -> Game -> sorted User KEY SHARE -> sorted profiles -> Pair -> Friendship -> Recommendation -> budgets.
        const game=await this.games.recommendationSummary(client,gameId);
        const ctx=await this.friends.recommendationContext(client,actor,body.friendshipId);
        if (!game || !effectiveAccepted(ctx.row,ctx.ctx.profiles,ctx.ctx.blocked)) unavailable();
        const peer=ctx.row.requester_user_id===actor ? ctx.row.recipient_user_id : ctx.row.requester_user_id;
        const existing=(await client.query<RecommendationRow>(`SELECT * FROM game_recommendations
          WHERE friendship_id=$1 AND game_id=$2 AND sender_user_id=$3 FOR UPDATE`,[body.friendshipId,gameId,actor])).rows[0];
        if (existing) {
          if (!this.current(existing,ctx) || existing.state!=="active" || existing.recipient_hidden) stale();
          return {statusCode:200,body:this.receipt(existing,"sent")};
        }
        await this.charge(client,actor,peer,ctx.ctx.now);
        const expires=new Date(Math.min(Date.parse(game.startsAt),ctx.ctx.now.getTime()
          +Math.min(this.env.FRIENDS_REQUEST_TTL_SECONDS!,30*86400)*1000));
        if (!(expires>ctx.ctx.now)) unavailable();
        const row=(await client.query<RecommendationRow>(`INSERT INTO game_recommendations
          (friendship_id,friendship_generation,game_id,sender_user_id,recipient_user_id,sender_epoch,recipient_epoch,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[body.friendshipId,ctx.row.generation,gameId,actor,peer,
          ctx.ctx.profiles.find(p=>p.user_id===actor)!.social_action_epoch,
          ctx.ctx.profiles.find(p=>p.user_id===peer)!.social_action_epoch,expires])).rows[0]!;
        return {statusCode:201,body:this.receipt(row,"sent")};
      }});
  }
  private async charge(client:PoolClient,actor:string,peer:string,now:Date) {
    // Existing bounded social budget. Both endpoints are charged; opposite directions
    // share a conservative game.recommend budget. No new runtime configuration.
    const ms=Math.min(this.env.FRIENDS_RATE_WINDOW_SECONDS!,86400)*1000;
    const start=new Date(Math.floor(now.getTime()/ms)*ms),end=new Date(start.getTime()+ms);
    const budgets=[{id:actor,cap:Math.min(this.env.FRIENDS_SEND_LIMIT!,100)},
      {id:peer,cap:Math.min(this.env.FRIENDS_RECEIVE_LIMIT!,100)}].sort((a,b)=>a.id.localeCompare(b.id));
    for (const budget of budgets) {
      const r=await client.query<{count:number}>(`INSERT INTO social_action_rate_buckets(user_id,bucket,window_start,expires_at,count)
        VALUES($1,'game.recommend',$2,$3,1) ON CONFLICT(user_id,bucket,window_start)
        DO UPDATE SET count=social_action_rate_buckets.count+1
        WHERE social_action_rate_buckets.count<$4 RETURNING count`,[budget.id,start,end,budget.cap]);
      if (!r.rows.length) {
        if (budget.id!==actor) unavailable();
        throw problem(429,"GAME_RECOMMENDATION_RATE_LIMITED","Повторите позднее",undefined,
          Math.max(1,Math.ceil((end.getTime()-now.getTime())/1000)));
      }
    }
  }
  async decide(actor:string,sessionId:string,key:string,idRaw:string,action:Action,input:unknown) {
    const id=parse(uuid,idRaw),body=parse(decisionRequest,input);
    return this.mutations.runIdempotent<Receipt>({actorId:actor,sessionId,key,operation:`game_recommendations.${action}`,
      requestHash:this.idempotency.requestHash({id,...body}),
      // Terminal receipts acknowledge a historical safe action, grant no peer/game rights.
      authorizeReplay:async(client,receipt)=>{
        await this.schema(client);const row=await this.locate(client,actor,receipt.id,true);
        assertRole(row,actor,action);
        if (row.version<receipt.version || (action==="hide" ? !row.recipient_hidden : row.state!=="withdrawn")) unavailable();
      },
      execute:async client=>{
        await this.schema(client);
        // Terminal action touches only its own row; no Game/Pair locks or grants.
        const row=await this.locate(client,actor,id,true);
        assertDecision(row,actor,action,body.expectedVersion);
        const changed=(await client.query<RecommendationRow>(`UPDATE game_recommendations
          SET ${action==="hide" ? "recipient_hidden=true" : "state='withdrawn'"},version=version+1,updated_at=clock_timestamp()
          WHERE id=$1 AND version=$2 RETURNING *`,[id,body.expectedVersion])).rows[0];
        if (!changed) stale();
        return {statusCode:200,body:this.receipt(changed,action==="hide" ? "hidden" : "withdrawn")};
      }});
  }
  private digest(purpose:string,value:string) {
    return createHmac("sha256",this.env.AUTH_PEPPER).update(`game-recommendations:${purpose}:v1\0`).update(value).digest("base64url");
  }
  async list(actor:string,sessionId:string,input:unknown) {
    const query=parse(listQuery,input);
    const binding=this.digest("binding",JSON.stringify([actor,query.view]));
    let after:string|null=null,asOf=new Date();
    if (query.cursor) {
      try {
        const [value,signature,extra]=query.cursor.split(".");
        const actual=Buffer.from(signature??""),expected=Buffer.from(this.digest("cursor",value!));
        if (extra || actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw new Error();
        const data=JSON.parse(Buffer.from(value!,"base64url").toString());
        if (data.binding!==binding || !Number.isSafeInteger(data.asOf) || data.asOf>Date.now()
          || Date.now()>=data.asOf+900000) throw new Error();
        after=parse(uuid,data.after);asOf=new Date(data.asOf);
        if (!Number.isFinite(asOf.getTime())) throw new Error();
      } catch {throw conflict("GAME_RECOMMENDATION_CURSOR_INVALID","Обновите список");}
    }
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL statement_timeout='15s'");
      await this.actors.assertActiveConsumerInTransaction(client,{actorId:actor,sessionId});
      const empty={items:[] as Item[],nextCursor:null as string|null,asOf:asOf.toISOString()};
      if (!friendsEnabled(this.env) || !await this.installed(client)) {
        await client.query("COMMIT");return empty;
      }
      const field=query.view==="sent" ? "sender_user_id" : "recipient_user_id";
      const candidates=(await client.query<RecommendationRow & {pair_id:string}>(`SELECT r.*,f.pair_id
        FROM game_recommendations r JOIN friendships f ON f.id=r.friendship_id
        WHERE r.${field}=$1 AND ($2::uuid IS NULL OR r.id>$2) AND r.created_at<=$3
        ${query.view==="received" ? "AND r.state='active' AND NOT r.recipient_hidden" : ""}
        ORDER BY r.id LIMIT $4`,[actor,after,asOf,query.limit+1])).rows;
      const page=candidates.slice(0,query.limit);
      // Acquire all fences of each kind before advancing to the next kind.
      for (const id of [...new Set(page.map(r=>r.game_id))].sort()) await this.games.recommendationSummary(client,id);
      await this.friends.fenceRecommendationProfiles(client,page.flatMap(r=>[r.sender_user_id,r.recipient_user_id]));
      const contexts=new Map<string,Context>();
      for (const r of [...page].sort((a,b)=>a.pair_id.localeCompare(b.pair_id))) {
        if (!contexts.has(r.friendship_id)) contexts.set(r.friendship_id,
          await this.friends.recommendationContext(client,actor,r.friendship_id,true));
      }
      const items:Item[]=[];
      for (const candidate of page) {
        const row=(await client.query<RecommendationRow>(`SELECT * FROM game_recommendations
          WHERE id=$1 AND ${field}=$2 FOR SHARE`,[candidate.id,actor])).rows[0];
        if (!row || (query.view==="received" && (row.state!=="active" || row.recipient_hidden))) continue;
        const ctx=contexts.get(row.friendship_id)!;
        const game=await this.games.recommendationSummary(client,row.game_id);
        const now=(await client.query<{now:Date}>("SELECT clock_timestamp() AS now")).rows[0]!.now;
        if (!game || !this.current(row,{...ctx,ctx:{...ctx.ctx,now}})) continue;
        const peerId=row.sender_user_id===actor ? row.recipient_user_id : row.sender_user_id;
        const peer=ctx.ctx.profiles.find(p=>p.user_id===peerId)!;
        items.push({id:row.id,version:row.version,state:row.state,createdAt:row.created_at.toISOString(),
          expiresAt:row.expires_at.toISOString(),game,peer:{publicPlayerId:peer.public_player_id,displayName:peer.display_name}});
      }
      const last=page.at(-1);
      const value=last && candidates.length>query.limit
        ? Buffer.from(JSON.stringify({binding,after:last.id,asOf:asOf.getTime()})).toString("base64url") : null;
      await client.query("COMMIT");
      return {items,nextCursor:value ? `${value}.${this.digest("cursor",value)}` : null,asOf:asOf.toISOString()};
    } catch(error) {await client.query("ROLLBACK").catch(()=>undefined);throw error;}
    finally {client.release();}
  }
}
