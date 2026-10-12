import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { conflict, notFound, unprocessable } from "../auth/problem";
import type { AppEnv } from "../config/env";
import { APP_ENV } from "../tokens";
import { CONSUMER_AUDIENCE } from "../auth/constants";
import { appendAudit } from "./admin-db";
import { AdminService } from "./admin.service";
import type { UserRestrictionCommand } from "./user-restrictions.dto";
@Injectable()
export class AdminUserRestrictionsService {
  constructor(private readonly admin: AdminService, @Inject(APP_ENV) private readonly env: AppEnv) {}
  enabled() {
    this.admin.enabled();
    if (!this.env.USER_RESTRICTIONS_INTERNAL_ENABLED) throw notFound("USER_RESTRICTIONS_DISABLED", "User restrictions internal simulation disabled");
  }
  private async snapshot(c: PoolClient, userId: string) {
    const user = (await c.query<{id:string}>("SELECT id FROM users WHERE id=$1", [userId])).rows[0];
    if (!user) throw notFound("USER_NOT_FOUND", "Учётная запись не найдена");
    const state = (await c.query<{version:number}>("SELECT version FROM user_restriction_state WHERE user_id=$1", [userId])).rows[0];
    const rows = (await c.query(`SELECT id,capability,reason_code,starts_at,expires_at,revoked_at,revoke_reason_code,version,
      CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'active' END AS status
      FROM user_restrictions WHERE user_id=$1 ORDER BY starts_at DESC,id DESC`, [userId])).rows;
    return { userId, version: state?.version ?? 1, restrictions: rows.map(r => ({id:r.id,capability:r.capability,reasonCode:r.reason_code,startsAt:r.starts_at,expiresAt:r.expires_at,revokedAt:r.revoked_at,revokeReasonCode:r.revoke_reason_code,version:r.version,status:r.status})) };
  }
  async detail(request: FastifyRequest, userId: string, beforeVersion?: number) {
    this.enabled();
    return this.admin.privilegedRead(request, "user.restrict", async(c,actor) => {
      // Bound aggregate growth per internal simulation; exact target only, no user enumeration.
      const state = await this.snapshot(c, userId);
      const rows = (await c.query(`SELECT id,restriction_id,user_version,audit_id,action,reason_code,created_at FROM user_restriction_actions
        WHERE user_id=$1 AND ($2::integer IS NULL OR user_version<$2) ORDER BY user_version DESC LIMIT 101`, [userId,beforeVersion??null])).rows;
      await appendAudit(c,{actor,action:"admin.user_restrictions_read",targetType:"user",targetId:userId,permission:"user.restrict",reason:"operations_read"});
      return {...state,history:rows.slice(0,100).map(r=>({id:r.id,restrictionId:r.restriction_id,userVersion:r.user_version,auditId:r.audit_id,action:r.action,reasonCode:r.reason_code,createdAt:r.created_at})),nextHistoryBeforeVersion:rows.length>100?rows[99]!.user_version:null};
    });
  }
  async command(request: FastifyRequest, userId: string, key: string | undefined, input: UserRestrictionCommand) {
    this.enabled();
    const permission = input.action === "revoke_consumer_sessions" ? "consumer_session.revoke" : "user.restrict";
    return this.admin.privilegedCommand(request,key,permission,true,"user.restrictions",{userId,...input},async(c,actor,keyHash)=>{
      if (!(await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE",[userId])).rowCount) throw notFound("USER_NOT_FOUND","Учётная запись не найдена");
      const before=await this.snapshot(c,userId);
      if(before.version!==input.expectedVersion)throw conflict("RESTRICTION_VERSION_CONFLICT","Ограничения уже изменены");
      let restrictionId: string | null = null, revokedCount: number | null = null;
      let reversalOf: string | undefined;
      if(input.action==="restrict") {
        const valid=(await c.query("SELECT 1 WHERE $1::timestamptz>clock_timestamp() AND $1::timestamptz<=clock_timestamp()+interval '30 days'",[input.expiresAt])).rowCount;
        if(!valid)throw unprocessable("RESTRICTION_EXPIRY_INVALID","Укажите будущую дату в пределах 30 дней");
        if(before.restrictions.length>=1000)throw conflict("RESTRICTION_LEDGER_LIMIT","Достигнут предел внутреннего журнала");
        restrictionId=(await c.query<{id:string}>("INSERT INTO user_restrictions(user_id,capability,reason_code,expires_at,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id",[userId,input.capability,input.reasonCode,input.expiresAt,actor.principalId])).rows[0]!.id;
        if(["account.access","social.radar","profile.public"].includes(input.capability)) await c.query("DELETE FROM radar_presences WHERE user_id=$1",[userId]);
      } else if(input.action==="revoke_restriction") {
        restrictionId=input.restrictionId;
        const row=(await c.query("SELECT id,revoked_at FROM user_restrictions WHERE id=$1 AND user_id=$2 FOR UPDATE",[restrictionId,userId])).rows[0];
        if(!row)throw notFound("RESTRICTION_NOT_FOUND","Ограничение не найдено");
        if(row.revoked_at)throw conflict("RESTRICTION_ALREADY_REVOKED","Ограничение уже снято");
        reversalOf=(await c.query<{audit_id:string}>("SELECT audit_id FROM user_restriction_actions WHERE restriction_id=$1 AND action='restrict'",[restrictionId])).rows[0]!.audit_id;
        await c.query("UPDATE user_restrictions SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason_code=$3,version=version+1 WHERE id=$1",[restrictionId,actor.principalId,input.reasonCode]);
      } else {
        const revoked=await c.query(`UPDATE app_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND audience=$2
          AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,[userId,CONSUMER_AUDIENCE]);
        revokedCount=revoked.rowCount??0;
        await c.query("DELETE FROM radar_presences WHERE user_id=$1",[userId]);
      }
      // Advance the existing P1 revision and force stale REPEATABLE READ consumers to retry.
      await c.query("UPDATE users SET updated_at=clock_timestamp() WHERE id=$1",[userId]);
      const version=before.version+1;
      await c.query(`INSERT INTO user_restriction_state(user_id,version) VALUES($1,$2) ON CONFLICT(user_id)
        DO UPDATE SET version=EXCLUDED.version,updated_at=clock_timestamp()`,[userId,version]);
      const after=await this.snapshot(c,userId);
      const auditId=await appendAudit(c,{actor,action:"admin.user."+input.action,targetType:"user",targetId:userId,permission,reason:input.reasonCode,
        before:{version:before.version},after:{version,restrictionId,...(input.action==="restrict"?{capability:input.capability,expiresAt:input.expiresAt}:{}),...(revokedCount===null?{}:{revokedCount})},keyHash,reversalOf});
      const actionId=randomUUID();
      await c.query("INSERT INTO user_restriction_actions(id,user_id,restriction_id,user_version,audit_id,action,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7)",[actionId,userId,restrictionId,version,auditId,input.action,input.reasonCode]);
      return {...after,actionId,auditId,revokedCount};
    });
  }
}
