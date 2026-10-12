import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { badRequest, conflict, notFound } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { GamesService } from "../games/games.service";
import { readModeration } from "../game-moderation/projection";
import { appendAudit } from "./admin-db";
import { AdminService } from "./admin.service";
import { uuid } from "./dto";
import type { GameModerationCommand } from "./game-moderation.dto";
type GameRow = {id:string;title:string;status:string;visibility:string;version:number};
@Injectable()
export class AdminGameModerationService {
  constructor(private readonly admin: AdminService, private readonly games: GamesService,
    @Inject(APP_ENV) private readonly env: AppEnv) {}
  enabled() {
    this.admin.enabled();
    if (!this.env.GAME_MODERATION_INTERNAL_ENABLED) throw notFound("GAME_MODERATION_DISABLED", "Game moderation internal simulation disabled");
  }
  private async snapshot(c: PoolClient, gameId: string) {
    const game=(await c.query<GameRow>("SELECT id,title,status,visibility,version FROM games WHERE id=$1",[gameId])).rows[0];
    if (!game) throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    return {id:game.id,title:game.title,status:game.status,visibility:game.visibility,gameVersion:game.version,moderation:await readModeration(c,gameId)};
  }
  async list(request:FastifyRequest, query:{cursor?:string;limit:number}) {
    this.enabled();
    return this.admin.privilegedRead(request,"game.moderate",async(c,actor)=>{
      const rows=(await c.query<GameRow & {state:"clear"|"hidden"|"taken_down"|null;requests_locked:boolean|null;moderation_version:number|null;last_action_id:string|null}>(
        `SELECT g.id,g.title,g.status,g.visibility,g.version,ms.state,ms.requests_locked,ms.version AS moderation_version,ms.last_action_id
        FROM games g LEFT JOIN game_moderation_state ms ON ms.game_id=g.id WHERE ($1::uuid IS NULL OR g.id>$1) ORDER BY g.id LIMIT $2`,[query.cursor??null,query.limit+1])).rows;
      const items=rows.slice(0,query.limit).map(r=>({id:r.id,title:r.title,status:r.status,visibility:r.visibility,gameVersion:r.version,
        moderation:{state:r.state??"clear",requestsLocked:r.requests_locked??false,version:r.moderation_version??1,lastActionId:r.last_action_id}}));
      await appendAudit(c,{actor,action:"admin.games_read",targetType:"game_moderation",targetId:"list",permission:"game.moderate",reason:"operations_read",after:{count:items.length}});
      return {items,nextCursor:rows.length>query.limit?items.at(-1)!.id:null};
    });
  }
  async detail(request:FastifyRequest, gameId:string, historyCursor?:string) {
    this.enabled();
    let cursor:{at:string;id:string}|null=null;
    if(historyCursor) {
      try { cursor=JSON.parse(Buffer.from(historyCursor,"base64url").toString("utf8")) as {at:string;id:string};
        if(!cursor || typeof cursor.at!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString()!==cursor.at.slice(0,23)+"Z" || !uuid.safeParse(cursor.id).success) throw new Error();
      } catch { throw badRequest("CURSOR_INVALID","Некорректный cursor"); }
    }
    return this.admin.privilegedRead(request,"game.moderate",async(c,actor)=>{
      const snapshot=await this.snapshot(c,gameId);
      // Keep full DB microsecond text in cursor; JS Date truncation could skip tied rows.
      const rows=(await c.query(`SELECT a.id,a.audit_id,a.action,a.reason_code,a.before_state,a.after_state,a.created_at,
          to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM game_moderation_actions a WHERE game_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
        ORDER BY created_at DESC,id DESC LIMIT 101`,[gameId,cursor?.at??null,cursor?.id??null])).rows;
      const page=rows.slice(0,100), last=page.at(-1);
      await appendAudit(c,{actor,action:"admin.game_read",targetType:"game",targetId:gameId,permission:"game.moderate",reason:"operations_read"});
      return {...snapshot,history:page.map(r=>({id:r.id,auditId:r.audit_id,action:r.action,reasonCode:r.reason_code,before:r.before_state,after:r.after_state,createdAt:r.created_at})),
        nextHistoryCursor:rows.length>100?Buffer.from(JSON.stringify({at:last!.cursor_at,id:last!.id})).toString("base64url"):null};
    });
  }
  async command(request:FastifyRequest,gameId:string,key:string|undefined,input:GameModerationCommand) {
    this.enabled();
    const permission=input.action==="force_cancel"?"game.force_cancel":"game.moderate";
    return this.admin.privilegedCommand(request,key,permission,["takedown","force_cancel"].includes(input.action),"game.moderation",{gameId,...input},async(c,actor,keyHash)=>{
      const locked=(await c.query("SELECT id FROM games WHERE id=$1 FOR UPDATE",[gameId])).rows[0];
      if(!locked)throw notFound("GAME_NOT_FOUND","Игра не найдена");
      const before=await this.snapshot(c,gameId);
      if(before.moderation.version!==input.expectedModerationVersion)throw conflict("MODERATION_VERSION_CONFLICT","Модерация игры уже изменена");
      if(input.action==="hide"&&before.moderation.state==="taken_down")throw conflict("MODERATION_RESTORE_REQUIRED","Сначала восстановите доступ к игре");
      if(input.action==="force_cancel")await this.games.cancelInTransaction(c,gameId,input.expectedGameVersion,input.reasonCode,actor.principal.user_id);
      const state=input.action==="hide"?"hidden":input.action==="takedown"?"taken_down":input.action==="restore_moderation"?"clear":before.moderation.state;
      const requestsLocked=input.action==="restore_moderation"?false:input.action==="lock_requests"?true:before.moderation.requestsLocked;
      await c.query(`INSERT INTO game_moderation_state(game_id,state,requests_locked,version) VALUES($1,$2,$3,$4)
        ON CONFLICT(game_id) DO UPDATE SET state=EXCLUDED.state,requests_locked=EXCLUDED.requests_locked,version=EXCLUDED.version,updated_at=clock_timestamp()`,[gameId,state,requestsLocked,before.moderation.version+1]);
      const actionId=randomUUID();
      const after={...await this.snapshot(c,gameId)};after.moderation.lastActionId=actionId;
      const auditId=await appendAudit(c,{actor,action:"admin.game."+input.action,targetType:"game",targetId:gameId,permission,reason:input.reasonCode,
        before:{gameVersion:before.gameVersion,status:before.status,moderation:before.moderation},after:{gameVersion:after.gameVersion,status:after.status,moderation:after.moderation},keyHash});
      await c.query("INSERT INTO game_moderation_actions(id,game_id,audit_id,action,reason_code,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [actionId,gameId,auditId,input.action,input.reasonCode,JSON.stringify({gameVersion:before.gameVersion,status:before.status,moderation:before.moderation}),JSON.stringify({gameVersion:after.gameVersion,status:after.status,moderation:after.moderation})]);
      await c.query("UPDATE game_moderation_state SET last_action_id=$2 WHERE game_id=$1",[gameId,actionId]);
      return {...after,actionId,auditId};
    });
  }
}
