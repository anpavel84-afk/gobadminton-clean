import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { conflict, forbidden, notFound } from "../auth/problem";
import { APP_ENV } from "../tokens";
import type { AppEnv } from "../config/env";
import { AdminService } from "./admin.service";
import { appendAudit, type AuditActor } from "./admin-db";
import { hasPermission, type AdminRole } from "./rbac";
import type { CaseCommand } from "./cases.dto";
import { CASE_EVIDENCE_POLICY, type CaseEvidencePolicy } from "./case-evidence-policy";
type CaseRow = {id:string; status:string; version:number; assigned_to:string|null; created_at:Date; updated_at:Date};
type Page = {beforeId?:string; limit:number};
const manages = (actor: AuditActor) => hasPermission(actor.roles as AdminRole[], "case.manage");
const caseDto = (r:CaseRow) => ({id:r.id,status:r.status,version:r.version,assignedTo:r.assigned_to,createdAt:r.created_at,updatedAt:r.updated_at});
@Injectable()
export class AdminCasesService {
  constructor(private readonly admin:AdminService, @Inject(APP_ENV) private readonly env:AppEnv,
    @Inject(CASE_EVIDENCE_POLICY) private readonly policy:CaseEvidencePolicy) {}
  enabled() { this.admin.enabled(); if(!this.env.CASES_INTERNAL_ENABLED) throw notFound("CASES_DISABLED","Обращения недоступны"); }
  private manage(actor:AuditActor) { if(!manages(actor)) throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения"); }
  private async scoped(c:PoolClient,actor:AuditActor,id:string) {
    const r=(await c.query<CaseRow>("SELECT * FROM support_cases WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if(!r || (!manages(actor) && (!hasPermission(actor.roles as AdminRole[],"case.assigned.manage") || r.assigned_to!==actor.principalId))) throw notFound("CASE_UNAVAILABLE","Обращение недоступно");
    return r;
  }
  private evidencePermission(actor:AuditActor) {
    const permission=manages(actor)?"evidence.case.read":"evidence.assigned.read";
    if(!hasPermission(actor.roles as AdminRole[],permission))throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
  }
  private async report(c:PoolClient,id:string) {
    const r=(await c.query("SELECT id,target_kind,target_public_player_id,reason_code,state,created_at FROM abuse_reports WHERE id=$1",[id])).rows[0];
    if(!r)throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
    return {id:r.id,targetKind:r.target_kind,targetPublicPlayerId:r.target_public_player_id,reasonCode:r.reason_code,state:r.state,createdAt:r.created_at};
  }
  async reports(request:FastifyRequest,page:Page & {reportId?:string}) {
    this.enabled(); return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      this.manage(a);
      // UUID keyset is stable without disclosing cursor timestamps or accepting free-text search.
      const rows=(await c.query(`SELECT id FROM abuse_reports WHERE ($1::uuid IS NULL OR id<$1) AND ($2::uuid IS NULL OR id=$2) ORDER BY id DESC LIMIT $3`,[page.beforeId??null,page.reportId??null,page.limit+1])).rows;
      const items=[];for(const r of rows.slice(0,page.limit)) items.push({...await this.report(c,r.id),caseId:(await c.query("SELECT case_id FROM support_case_links WHERE report_id=$1",[r.id])).rows[0]?.case_id??null});
      await appendAudit(c,{actor:a,action:"admin.reports_read",targetType:"reports",targetId:page.reportId??"bounded_queue",permission:"case.manage",reason:"operations_read"});
      return {items,nextBeforeId:rows.length>page.limit?rows[page.limit-1]!.id:null};
    });
  }
  async list(request:FastifyRequest,page:Page) {
    this.enabled();return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      if(!manages(a) && !hasPermission(a.roles as AdminRole[],"case.assigned.manage"))throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
      const rows=(await c.query<CaseRow>("SELECT * FROM support_cases WHERE ($1::boolean OR assigned_to=$2) AND ($3::uuid IS NULL OR id<$3) ORDER BY id DESC LIMIT $4",[manages(a),a.principalId,page.beforeId??null,page.limit+1])).rows;
      await appendAudit(c,{actor:a,action:"admin.cases_read",targetType:"cases",targetId:manages(a)?"bounded_queue":a.principalId,permission:manages(a)?"case.manage":"case.assigned.manage",reason:"operations_read"});
      return {items:rows.slice(0,page.limit).map(caseDto),nextBeforeId:rows.length>page.limit?rows[page.limit-1]!.id:null};
    });
  }
  async detail(request:FastifyRequest,id:string,beforeVersion?:number) {
    this.enabled();return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      const r=await this.scoped(c,a,id);
      const links=(await c.query("SELECT id,source_kind,report_id,game_id FROM support_case_links WHERE case_id=$1 ORDER BY id",[id])).rows;
      const history=(await c.query("SELECT id,case_version,action,note_code,audit_id,created_at FROM support_case_actions WHERE case_id=$1 AND ($2::integer IS NULL OR case_version<$2) ORDER BY case_version DESC LIMIT 101",[id,beforeVersion??null])).rows;
      await appendAudit(c,{actor:a,action:"admin.case_read",targetType:"case",targetId:id,permission:manages(a)?"case.manage":"case.assigned.manage",reason:"operations_read"});
      return {...caseDto(r),links:links.map(x=>({id:x.id,sourceKind:x.source_kind,sourceId:x.report_id??x.game_id})),history:history.slice(0,100).map(x=>({id:x.id,version:x.case_version,action:x.action,noteCode:x.note_code,auditId:x.audit_id,createdAt:x.created_at})),nextHistoryBeforeVersion:history.length>100?history[99]!.case_version:null};
    });
  }
  async create(request:FastifyRequest,key:string|undefined,input:{reportId:string;reasonCode:string}) {
    this.enabled();return this.admin.privilegedCommand(request,key,"user.lookup",false,"case.create",input,async(c,a,keyHash)=>{
      await this.report(c,input.reportId);
      const r=(await c.query<CaseRow>("INSERT INTO support_cases(created_by) VALUES($1) RETURNING *",[a.principalId])).rows[0]!;
      await this.linkReport(c,r.id,input.reportId);
      const auditId=await appendAudit(c,{actor:a,action:"admin.case.create",targetType:"case",targetId:r.id,permission:"case.manage",reason:input.reasonCode,after:{status:r.status,reportId:input.reportId},keyHash});
      await c.query("INSERT INTO support_case_actions(case_id,case_version,audit_id,action) VALUES($1,1,$2,'create')",[r.id,auditId]);
      return {id:r.id,version:1,auditId};
    },async(_c,a)=>{this.manage(a);});
  }
  private async linkReport(c:PoolClient,id:string,reportId:string) {
    await this.report(c,reportId);
    if(!(await c.query("INSERT INTO support_case_links(case_id,source_kind,report_id) VALUES($1,'report',$2) ON CONFLICT(report_id) DO NOTHING RETURNING id",[id,reportId])).rowCount)throw conflict("REPORT_ALREADY_LINKED","Жалоба уже связана с обращением");
  }
  async command(request:FastifyRequest,id:string,key:string|undefined,input:CaseCommand) {
    this.enabled();return this.admin.privilegedCommand(request,key,"user.lookup",input.action==="capture_evidence","case.command",{id,...input},async(c,a,keyHash)=>{
      const r=await this.scoped(c,a,id);
      if(r.version!==input.expectedVersion)throw conflict("CASE_VERSION_CONFLICT","Обращение уже изменено");
      if(r.status==="closed" && !(input.action==="status" && input.status==="open"))throw conflict("CASE_CLOSED","Сначала откройте обращение снова");
      let evidenceId:string|undefined;
      const after:Record<string,unknown>={version:r.version+1,action:input.action};
      if(input.action==="assign") {
        if(input.principalId && !(await c.query(`SELECT 1 FROM admin_principals p WHERE p.id=$1 AND p.status='active' AND EXISTS(SELECT 1 FROM admin_role_grants g WHERE g.principal_id=p.id AND g.active AND g.role IN ('superadmin','moderator','support'))`,[input.principalId])).rowCount)throw notFound("ASSIGNEE_UNAVAILABLE","Сотрудник недоступен");
        await c.query("UPDATE support_cases SET assigned_to=$2 WHERE id=$1",[id,input.principalId]);after.assignedTo=input.principalId;
      } else if(input.action==="status") {
        const transitions:Record<string,string[]>={open:["in_review","resolved","closed"],in_review:["resolved","closed"],resolved:["closed","open"],closed:["open"]};
        if(!transitions[r.status]!.includes(input.status))throw conflict("CASE_STATUS_CONFLICT","Переход недоступен");
        await c.query("UPDATE support_cases SET status=$2 WHERE id=$1",[id,input.status]);after.status=input.status;
      } else if(input.action==="link_report" || input.action==="link_game") {
        if(Number((await c.query("SELECT count(*) FROM support_case_links WHERE case_id=$1",[id])).rows[0].count)>=100)throw conflict("CASE_LINK_LIMIT","Достигнут предел связей");
        if(input.action==="link_report")await this.linkReport(c,id,input.reportId);
        else {
          if(!(await c.query("SELECT 1 FROM games WHERE id=$1",[input.gameId])).rowCount)throw notFound("GAME_UNAVAILABLE","Игра недоступна");
          if(!(await c.query("INSERT INTO support_case_links(case_id,source_kind,game_id) VALUES($1,'game',$2) ON CONFLICT(case_id,game_id) DO NOTHING RETURNING id",[id,input.gameId])).rowCount)throw conflict("CASE_LINK_EXISTS","Связь уже существует");
        }
      } else if(input.action==="capture_evidence") {
        if(Number((await c.query("SELECT count(*) FROM case_evidence_items WHERE case_id=$1",[id])).rows[0].count)>=1000)throw conflict("CASE_EVIDENCE_LIMIT","Достигнут предел материалов");
        const link=(await c.query("SELECT * FROM support_case_links WHERE id=$1 AND case_id=$2",[input.linkId,id])).rows[0];
        if(!link)throw notFound("CASE_LINK_UNAVAILABLE","Связь недоступна");
        const policy=await this.policy.capture(c,id);
        let payload:object;
        if(link.source_kind==="report") payload=await this.report(c,link.report_id);
        else {
          const g=(await c.query("SELECT id,status,version FROM games WHERE id=$1 FOR SHARE",[link.game_id])).rows[0];
          const m=(await c.query("SELECT state,requests_locked,version FROM game_moderation_state WHERE game_id=$1",[link.game_id])).rows[0];
          payload={id:g.id,status:g.status,lifecycleVersion:g.version,moderationState:m?.state??"clear",requestsLocked:m?.requests_locked??false,moderationVersion:m?.version??1};
        }
        const raw=JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a],[b])=>a.localeCompare(b)))),hash=createHash("sha256").update(raw).digest("hex");
        const auditId=await appendAudit(c,{actor:a,action:"admin.evidence_capture",targetType:"case",targetId:id,permission:manages(a)?"evidence.case.read":"evidence.assigned.read",reason:input.reasonCode,after:{linkId:link.id,contentHash:hash,classification:"synthetic_minimal"},keyHash});
        evidenceId=(await c.query("INSERT INTO case_evidence_items(case_id,link_id,kind,payload,content_hash,classification,policy_id,expires_at,legal_hold,audit_id) VALUES($1,$2,$3,$4,$5,'synthetic_minimal',$6,$7,$8,$9) RETURNING id",[id,link.id,link.source_kind==="report"?"report_summary":"game_state",raw,hash,policy.policyId,policy.expiresAt,policy.legalHold,auditId])).rows[0].id;
        after.evidenceId=evidenceId;
      } else after.noteCode=input.noteCode;
      await c.query("UPDATE support_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",[id]);
      const auditId=await appendAudit(c,{actor:a,action:"admin.case."+input.action,targetType:"case",targetId:id,permission:manages(a)?"case.manage":"case.assigned.manage",reason:input.reasonCode,before:{version:r.version,status:r.status,assignedTo:r.assigned_to},after,keyHash});
      await c.query("INSERT INTO support_case_actions(case_id,case_version,audit_id,action,note_code) VALUES($1,$2,$3,$4,$5)",[id,r.version+1,auditId,input.action,input.action==="note"?input.noteCode:null]);
      return {id,version:r.version+1,auditId,...(evidenceId?{evidenceId}:{})};
    },async(c,a)=>{
      await this.scoped(c,a,id);
      if(["assign","link_report","link_game"].includes(input.action))this.manage(a);
      if(input.action==="capture_evidence")this.evidencePermission(a);
    });
  }
  async evidenceList(request:FastifyRequest,id:string,page:Page) {
    this.enabled();return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      await this.scoped(c,a,id);this.evidencePermission(a);
      const rows=(await c.query("SELECT id,link_id,kind,content_hash,classification,policy_id,expires_at,legal_hold,created_at FROM case_evidence_items WHERE case_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3",[id,page.beforeId??null,page.limit+1])).rows;
      await appendAudit(c,{actor:a,action:"admin.evidence_list",targetType:"case",targetId:id,permission:manages(a)?"evidence.case.read":"evidence.assigned.read",reason:"operations_read"});
      const items=[];for(const r of rows.slice(0,page.limit))items.push({id:r.id,linkId:r.link_id,kind:r.kind,contentHash:r.content_hash,classification:r.classification,policyId:r.policy_id,expiresAt:r.expires_at,legalHold:r.legal_hold,createdAt:r.created_at,readable:await this.policy.canRead(c,r)});
      return {items,nextBeforeId:rows.length>page.limit?rows[page.limit-1]!.id:null};
    },true);
  }
  async evidenceRead(request:FastifyRequest,id:string,evidenceId:string) {
    this.enabled();return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      await this.scoped(c,a,id);this.evidencePermission(a);
      const r=(await c.query("SELECT * FROM case_evidence_items WHERE id=$1 AND case_id=$2",[evidenceId,id])).rows[0];
      if(!r || !await this.policy.canRead(c,r))throw notFound("EVIDENCE_UNAVAILABLE","Материал недоступен");
      await appendAudit(c,{actor:a,action:"admin.evidence_read",targetType:"case",targetId:id,permission:manages(a)?"evidence.case.read":"evidence.assigned.read",reason:"operations_read",after:{evidenceId:r.id,contentHash:r.content_hash}});
      return {id:r.id,caseId:id,kind:r.kind,payload:r.payload,contentHash:r.content_hash};
    },true);
  }
}
