import { AvatarService } from "../profiles/avatar.service";
import { bindPublicationPhotos, currentPhotoIds, photoApprovalSql, sameReportedCommentLineage, revisionPhotoEvidence, validatePublicationPhotos } from "../comments/comment-photo-publication";
import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { badRequest, conflict, forbidden, notFound, problem, unprocessable } from "../auth/problem";
import { APP_ENV } from "../tokens";
import type { AppEnv } from "../config/env";
import {
  evaluateMessageExactSourceAvailability,
  messageReportContentFingerprint,
} from "../moderation/message-report-source";
import {
  ContentModerationService,
  type TextBatchApproval,
} from "../moderation/moderation.service";
import {
  venueCommunityCommentReportFingerprint,
  venueCommunityVoteReportFingerprint,
} from "../venues/venue-community-report";
import { unavailableSummary } from "../venues/venue-community.policy";
import {
  batchCommunitySummaries,
  canonicalVenueFamilyIds,
  eligibleVoteWhereSql,
  lockCatalogShared,
  resolveCanonicalVenue,
} from "../venues/venue-community.query";
import { AdminService, type AdminActor } from "./admin.service";
import { appendAudit, type AuditActor } from "./admin-db";
import { hasPermission, type AdminRole } from "./rbac";
import type { CaseCommand, CommunityReportPage, VenueCommunityDecide } from "./cases.dto";
import { CASE_EVIDENCE_POLICY, type CaseEvidencePolicy } from "./case-evidence-policy";
import { AdminRoleReputationService } from "./role-reputation.service";
import { AdminVenueReviewsService } from "./venue-reviews.service";
import {
  communityHumanDecisionAllowed,
  communityHumanDecisionOptions,
  decodeCommunityAggregateVoteCursor,
  encodeCommunityAggregateVoteCursor,
  evaluateCommunityCommentSourceAvailability,
  evaluateCommunityVoteSourceAvailability,
  type CommunityHumanDecision,
} from "./venue-community-source";
type CaseRow = {id:string; status:string; version:number; assigned_to:string|null; created_at:Date; updated_at:Date};
type Page = {beforeId?:string; limit:number};
type CommunityBindingRow = {
  reporter_user_id:string;
  canonical_venue_id:string;
  subject_kind:"aggregate"|"own_vote"|"venue_comment";
  vote_id:string|null;
  comment_id:string|null;
  reported_resource_version:number|null;
  content_fingerprint:string|null;
};
const manages = (actor: AuditActor) => hasPermission(actor.roles as AdminRole[], "case.manage");
const canReadAssignedEvidence = (actor: AuditActor) =>
  hasPermission(actor.roles as AdminRole[], "evidence.assigned.read");
const caseDto = (r:CaseRow) => ({id:r.id,status:r.status,version:r.version,assignedTo:r.assigned_to,createdAt:r.created_at,updatedAt:r.updated_at});
@Injectable()
export class AdminCasesService {
  constructor(private readonly admin:AdminService, @Inject(APP_ENV) private readonly env:AppEnv,
    @Inject(CASE_EVIDENCE_POLICY) private readonly policy:CaseEvidencePolicy,
    private readonly roleReputation: AdminRoleReputationService,
    private readonly venueReviews: AdminVenueReviewsService,
    private readonly moderation: ContentModerationService,
    private readonly media: AvatarService) {}
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
    // game_review / message / venue_community queue/evidence: minimal typed metadata only —
    // never complaint detail, fingerprints, reporter/user identities, or raw source text.
    // Assigned community source-read is GET .../community-reports/:reportId (withhold/restore later).
    if(r.target_kind==="game_review") {
      return {id:r.id,targetKind:"game_review" as const,reasonCode:r.reason_code,state:r.state,createdAt:r.created_at};
    }
    if(r.target_kind==="message") {
      return {id:r.id,targetKind:"message" as const,reasonCode:r.reason_code,state:r.state,createdAt:r.created_at};
    }
    if(r.target_kind==="venue_community") {
      return {id:r.id,targetKind:"venue_community" as const,reasonCode:r.reason_code,state:r.state,createdAt:r.created_at};
    }
    return {id:r.id,targetKind:r.target_kind,targetPublicPlayerId:r.target_public_player_id,reasonCode:r.reason_code,state:r.state,createdAt:r.created_at};
  }
  /** Attendance-dispute COI mapped to affected users of a private peer review report. */
  private async assertIndependentReviewer(c:PoolClient,actor:AuditActor,gameId:string,affectedUserIds:string[]) {
    const principal=(await c.query<{user_id:string;status:string}>("SELECT user_id, status FROM admin_principals WHERE id=$1 FOR UPDATE",[actor.principalId])).rows[0];
    if(!principal || principal.status!=="active") throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
    const reviewerUserId=principal.user_id;
    if(affectedUserIds.includes(reviewerUserId)) throw forbidden("REVIEWER_SUBJECT_CONFLICT","Проверяющий не может быть стороной обращения");
    if((await c.query("SELECT 1 FROM games WHERE id=$1 AND created_by_user_id=$2 LIMIT 1",[gameId,reviewerUserId])).rows[0]) {
      throw forbidden("REVIEWER_MANAGER_CONFLICT","Организатор игры не может быть независимым проверяющим");
    }
    if((await c.query(`SELECT 1 FROM game_managers WHERE game_id=$1 AND user_id=$2 AND role IN ('owner','manager') LIMIT 1`,[gameId,reviewerUserId])).rows[0]) {
      throw forbidden("REVIEWER_MANAGER_CONFLICT","Организатор игры не может быть независимым проверяющим");
    }
    if((await c.query("SELECT 1 FROM participations WHERE game_id=$1 AND user_id=$2 LIMIT 1",[gameId,reviewerUserId])).rows[0]) {
      throw forbidden("REVIEWER_PARTICIPANT_CONFLICT","Участник игры не может быть независимым проверяющим");
    }
    return reviewerUserId;
  }
  /** DM message report: reviewer must not be reporter or message author (no game COI). */
  private async assertIndependentMessageReviewer(c:PoolClient,actor:AuditActor,affectedUserIds:string[],gameId:string|null) {
    if(gameId) return this.assertIndependentReviewer(c,actor,gameId,affectedUserIds);
    const principal=(await c.query<{user_id:string;status:string}>("SELECT user_id, status FROM admin_principals WHERE id=$1 FOR UPDATE",[actor.principalId])).rows[0];
    if(!principal || principal.status!=="active") throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
    if(affectedUserIds.includes(principal.user_id)) {
      throw forbidden("REVIEWER_SUBJECT_CONFLICT","Проверяющий не может быть стороной обращения");
    }
    return principal.user_id;
  }
  /**
   * Venue-community independence: linked human identities only (reporter, subject/voter/author,
   * venue creator, historic venue admin actions across the bounded physical family, own current
   * vote on aggregate). Role names are not a bypass.
   */
  private async assertIndependentCommunityReviewer(
    c:PoolClient,
    actor:AuditActor,
    input:{
      affectedUserIds:string[];
      canonicalVenueId:string;
      denyOwnVote:boolean;
    },
  ) {
    const reviewerUserId=await this.assertCommunityHumanIndependence(c,actor,input.affectedUserIds);
    const familyIds=await canonicalVenueFamilyIds(c,input.canonicalVenueId);
    await this.assertCommunityVenueFamilyAffiliation(c,reviewerUserId,familyIds);
    if(input.denyOwnVote && (await c.query(
      `SELECT 1 FROM venue_community_votes
       WHERE canonical_venue_id=$1 AND user_id=$2 AND merged_into_vote_id IS NULL LIMIT 1`,
      [input.canonicalVenueId,reviewerUserId],
    )).rows[0]) {
      throw forbidden("REVIEWER_SUBJECT_CONFLICT","Проверяющий не может быть стороной обращения");
    }
    return reviewerUserId;
  }
  /** Fail-closed human COI even when venue/source lifecycle is missing or unavailable. */
  private async assertCommunityHumanIndependence(
    c:PoolClient,
    actor:AuditActor,
    affectedUserIds:string[],
  ) {
    const principal=(await c.query<{user_id:string;status:string}>("SELECT user_id, status FROM admin_principals WHERE id=$1 FOR UPDATE",[actor.principalId])).rows[0];
    if(!principal || principal.status!=="active") throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
    if(affectedUserIds.includes(principal.user_id)) {
      throw forbidden("REVIEWER_SUBJECT_CONFLICT","Проверяющий не может быть стороной обращения");
    }
    return principal.user_id;
  }
  /** Creator + historic admin-action affiliation across bounded canonical physical family (incl. merged aliases). */
  private async assertCommunityVenueFamilyAffiliation(
    c:PoolClient,
    reviewerUserId:string,
    familyIds:string[],
  ) {
    if(familyIds.length===0) return;
    if((await c.query(
      `SELECT 1 FROM venues WHERE id=ANY($1::uuid[]) AND created_by_user_id=$2 LIMIT 1`,
      [familyIds,reviewerUserId],
    )).rows[0]) {
      throw forbidden("REVIEWER_VENUE_CONFLICT","Связанный с площадкой проверяющий исключён");
    }
    if((await c.query(
      `SELECT 1 FROM venue_admin_actions a
       JOIN admin_principals p ON p.id=a.actor_id
       WHERE a.venue_id=ANY($1::uuid[]) AND p.user_id=$2 LIMIT 1`,
      [familyIds,reviewerUserId],
    )).rows[0]) {
      throw forbidden("REVIEWER_VENUE_CONFLICT","Связанный с площадкой проверяющий исключён");
    }
  }
  /**
   * Unavailable venue source-read: human COI first, then safe NOT_FOUND.
   * Do not return complaint detail / reported raw values when the canonical physical venue
   * cannot be resolved (hidden/retired/broken/merged-terminal unavailable). Prefer 404 over
   * partial-family inference that can miss own-vote or terminal creator/admin affiliation.
   */
  private async rejectUnresolvedCommunityVenue(
    c:PoolClient,
    actor:AuditActor,
    affectedUserIds:string[],
  ):Promise<never> {
    await this.assertCommunityHumanIndependence(c,actor,affectedUserIds);
    throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
  }
  private fingerprintSecret():string {
    const secret=this.env.CONTENT_MODERATION_FINGERPRINT_SECRET;
    if(!secret) {
      throw problem(503,"MODERATION_TEMPORARILY_UNAVAILABLE","Проверка сообщений временно недоступна");
    }
    return secret;
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
      const links=(await c.query(`SELECT l.id,l.source_kind,l.report_id,l.game_id,ar.target_kind AS report_target_kind
        FROM support_case_links l
        LEFT JOIN abuse_reports ar ON ar.id=l.report_id
        WHERE l.case_id=$1 ORDER BY l.id`,[id])).rows;
      const history=(await c.query("SELECT id,case_version,action,note_code,audit_id,created_at FROM support_case_actions WHERE case_id=$1 AND ($2::integer IS NULL OR case_version<$2) ORDER BY case_version DESC LIMIT 101",[id,beforeVersion??null])).rows;
      // Optional safe role-reputation / venue-review hint — metadata only; no plaintext/private proof.
      // Guard table absence for legacy isolated fixtures without migration 0054/0058.
      let roleReputation: {
        pendingKind: string;
        role: string;
        slotStatus: string;
        intakeStatus: string;
      } | null = null;
      const tables=(await c.query<{ok:boolean}>(
        `SELECT to_regclass('role_reputation_case_links') IS NOT NULL AS ok`,
      )).rows[0];
      if(tables?.ok){
        const hint=(await c.query<{
          kind:string;role:string;slot_status:string;intake_status:string;
        }>(`SELECT p.kind, p.role, s.status AS slot_status, p.status AS intake_status
            FROM role_reputation_case_links l
            JOIN role_reputation_pending_intakes p ON p.id=l.pending_intake_id
            JOIN role_review_slots s ON s.id=l.slot_id
            WHERE l.case_id=$1`,[id])).rows[0];
        if(hint){
          roleReputation={
            pendingKind:hint.kind,
            role:hint.role,
            slotStatus:hint.slot_status,
            intakeStatus:hint.intake_status,
          };
        }
      }
      const venueReview = await this.venueReviews.caseHint(c, id);
      await appendAudit(c,{actor:a,action:"admin.case_read",targetType:"case",targetId:id,permission:manages(a)?"case.manage":"case.assigned.manage",reason:"operations_read"});
      return {
        ...caseDto(r),
        links:links.map(x=>({id:x.id,sourceKind:x.source_kind,sourceId:x.report_id??x.game_id,...(x.source_kind==="report"&&x.report_target_kind?{targetKind:x.report_target_kind}:{})})),
        history:history.slice(0,100).map(x=>({id:x.id,version:x.case_version,action:x.action,noteCode:x.note_code,auditId:x.audit_id,createdAt:x.created_at})),
        nextHistoryBeforeVersion:history.length>100?history[99]!.case_version:null,
        ...(roleReputation?{roleReputation}:{}),
        ...(venueReview?{venueReview}:{}),
      };
    });
  }
  /**
   * Assigned independent reviewer + evidence.assigned.read + fresh step-up may read the
   * consented exact immutable revision. case.manage / unassigned staff is not enough.
   * No mutation/side-effect beyond audit. Private text is never copied into case_evidence_items.
   */
  async readReviewReport(request:FastifyRequest,caseId:string,reportId:string) {
    this.enabled();
    return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      if(!hasPermission(a.roles as AdminRole[],"evidence.assigned.read")) {
        throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
      }
      await lockCatalogShared(c);
      const r=await this.scoped(c,a,caseId);
      if(r.assigned_to!==a.principalId) throw notFound("CASE_UNAVAILABLE","Обращение недоступно");
      const link=(await c.query("SELECT id FROM support_case_links WHERE case_id=$1 AND report_id=$2",[caseId,reportId])).rows[0];
      if(!link) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const reportMeta=await this.report(c,reportId);
      if(reportMeta.targetKind!=="game_review") throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const binding=(await c.query<{
        review_id:string;game_id:string;revision_id:string;reported_version:number;reporter_user_id:string;share_consent:boolean;
      }>(`SELECT review_id, game_id, revision_id, reported_version, reporter_user_id, share_consent
          FROM game_review_report_bindings WHERE report_id=$1`,[reportId])).rows[0];
      if(!binding || binding.share_consent!==true) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const review=(await c.query<{author_user_id:string;recipient_user_id:string;kind:string}>(
        `SELECT author_user_id, recipient_user_id, kind FROM game_reviews WHERE id=$1`,[binding.review_id],
      )).rows[0];
      if(!review || review.kind!=="peer") throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      await this.assertIndependentReviewer(c,a,binding.game_id,[review.author_user_id,review.recipient_user_id,binding.reporter_user_id]);
      const revision=(await c.query<{
        id:string;resource_version:number;after_peer_rating:string|null;after_comment:string|null;after_tags:string[]|null;
        after_organization_score:number|null;after_discrepancy_explanation:string|null;recorded_at:Date;
      }>(`SELECT id, resource_version, after_peer_rating, after_comment, after_tags,
                 after_organization_score, after_discrepancy_explanation, recorded_at
          FROM game_review_revisions WHERE id=$1 AND review_id=$2 AND resource_version=$3`,
        [binding.revision_id,binding.review_id,binding.reported_version])).rows[0];
      if(!revision) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      await appendAudit(c,{
        actor:a,
        action:"admin.case.review_report_read",
        targetType:"case",
        targetId:caseId,
        permission:"evidence.assigned.read",
        reason:"operations_read",
        after:{reportId,reviewId:binding.review_id,version:binding.reported_version,revisionId:revision.id},
      });
      return {
        caseId,
        reportId,
        reviewId:binding.review_id,
        gameId:binding.game_id,
        version:binding.reported_version,
        kind:"peer" as const,
        peerRating:revision.after_peer_rating,
        comment:revision.after_comment,
        tags:revision.after_tags??[],
        recordedAt:revision.recorded_at,
        reasonCode:reportMeta.reasonCode,
        reportState:reportMeta.state,
      };
    },true);
  }
  /**
   * Assigned independent reviewer + evidence.assigned.read + fresh step-up may read the
   * consented exact live message while original purge_eligible_at is finite and future.
   * NULL/expired/purged => sourceAvailable=false (no TTL mutation, no body copy).
   * Managers still require current assignment. Audit is IDs/metadata only.
   */
  async readMessageReport(request:FastifyRequest,caseId:string,reportId:string) {
    this.enabled();
    return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      if(!hasPermission(a.roles as AdminRole[],"evidence.assigned.read")) {
        throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
      }
      await lockCatalogShared(c);
      const r=await this.scoped(c,a,caseId);
      if(r.assigned_to!==a.principalId) throw notFound("CASE_UNAVAILABLE","Обращение недоступно");
      const link=(await c.query("SELECT id FROM support_case_links WHERE case_id=$1 AND report_id=$2",[caseId,reportId])).rows[0];
      if(!link) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const reportMeta=await this.report(c,reportId);
      if(reportMeta.targetKind!=="message") throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const binding=(await c.query<{
        message_id:string;conversation_id:string;conversation_kind:string;game_id:string|null;
        message_seq:string|number;author_user_id:string;content_fingerprint:string;reporter_user_id:string;share_consent:boolean;
      }>(`SELECT message_id, conversation_id, conversation_kind, game_id, message_seq,
                 author_user_id, content_fingerprint, reporter_user_id, share_consent
          FROM message_report_bindings WHERE report_id=$1`,[reportId])).rows[0];
      if(!binding || binding.share_consent!==true) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      await this.assertIndependentMessageReviewer(
        c,
        a,
        [binding.author_user_id,binding.reporter_user_id],
        binding.game_id,
      );
      const message=(await c.query<{
        id:string;body_text:string|null;content_state:string;purge_eligible_at:Date|null;created_at:Date;seq:string|number;conversation_id:string;
      }>(`SELECT id, body_text, content_state, purge_eligible_at, created_at, seq, conversation_id
          FROM messages WHERE id=$1 AND conversation_id=$2 AND seq=$3 AND author_user_id=$4`,
        [binding.message_id,binding.conversation_id,binding.message_seq,binding.author_user_id])).rows[0];
      if(!message) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const secret=this.env.CONTENT_MODERATION_FINGERPRINT_SECRET;
      if(!secret) {
        throw problem(503,"MODERATION_TEMPORARILY_UNAVAILABLE","Проверка сообщений временно недоступна");
      }
      const currentFingerprint =
        message.content_state === "live" && message.body_text
          ? messageReportContentFingerprint(secret, {
              messageId: message.id,
              conversationId: message.conversation_id,
              seq: message.seq,
              bodyText: message.body_text,
            })
          : undefined;
      const availability = evaluateMessageExactSourceAvailability({
        contentState: message.content_state,
        bodyText: message.body_text,
        purgeEligibleAt: message.purge_eligible_at,
        expectedFingerprint: binding.content_fingerprint,
        currentFingerprint,
      });
      await appendAudit(c,{
        actor:a,
        action:"admin.case.message_report_read",
        targetType:"case",
        targetId:caseId,
        permission:"evidence.assigned.read",
        reason:"operations_read",
        after:{
          reportId,
          messageId:binding.message_id,
          conversationId:binding.conversation_id,
          sourceAvailable:availability.available,
          ...(availability.available?{}:{unavailableReason:availability.reason}),
        },
      });
      const base = {
        caseId,
        reportId,
        messageId:binding.message_id,
        conversationId:binding.conversation_id,
        conversationKind:binding.conversation_kind as "direct"|"game",
        gameId:binding.game_id,
        seq:String(binding.message_seq),
        recordedAt:message.created_at,
        reasonCode:reportMeta.reasonCode,
        reportState:reportMeta.state,
      };
      if(!availability.available) {
        return {
          ...base,
          sourceAvailable:false as const,
          unavailableReason:availability.reason,
          text:null,
        };
      }
      return {
        ...base,
        sourceAvailable:true as const,
        unavailableReason:null,
        text:message.body_text,
      };
    },true);
  }
  /**
   * Assigned independent reviewer + evidence.assigned.read + fresh step-up may read exact
   * venue-community source bound to this case/report. Managers/superadmin still need current
   * assignment. Audit is IDs/availability/cursor metadata only — never detail/body/fingerprint.
   * decisionCapability is exposed only because venue_community_decide exists on CaseCommand.
   */
  async readCommunityReport(
    request:FastifyRequest,
    caseId:string,
    reportId:string,
    page:CommunityReportPage,
    photoId?:string,
  ) {
    this.enabled();
    return this.admin.privilegedRead(request,"user.lookup",async(c,a)=>{
      if(!canReadAssignedEvidence(a)) {
        throw forbidden("ADMIN_PERMISSION_DENIED","Нет разрешения");
      }
      await lockCatalogShared(c);
      const r=await this.scoped(c,a,caseId);
      if(r.assigned_to!==a.principalId) throw notFound("CASE_UNAVAILABLE","Обращение недоступно");
      const link=(await c.query("SELECT id FROM support_case_links WHERE case_id=$1 AND report_id=$2",[caseId,reportId])).rows[0];
      if(!link) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const reportMeta=await this.report(c,reportId);
      if(reportMeta.targetKind!=="venue_community") throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const binding=(await c.query<CommunityBindingRow>(
        `SELECT reporter_user_id, canonical_venue_id, subject_kind, vote_id, comment_id,
                reported_resource_version, content_fingerprint
         FROM venue_community_report_bindings WHERE report_id=$1`,[reportId])).rows[0];
      if(!binding) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const detailRow=(await c.query<{detail:string|null}>(
        `SELECT detail FROM abuse_reports WHERE id=$1`,[reportId],
      )).rows[0];
      const detail=detailRow?.detail??null;

      if(photoId && binding.subject_kind!=="venue_comment") throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      if(binding.subject_kind==="aggregate") {
        return this.readCommunityAggregateSource(c,a,{
          caseId,
          reportId,
          caseRow:r,
          binding:{...binding,subject_kind:"aggregate"},
          reportMeta,
          detail,
          page,
        });
      }
      if(binding.subject_kind==="own_vote") {
        return this.readCommunityOwnVoteSource(c,a,{
          caseId,
          reportId,
          caseRow:r,
          binding:{...binding,subject_kind:"own_vote"},
          reportMeta,
          detail,
        });
      }
      return this.readCommunityCommentSource(c,a,{
        caseId,
        reportId,
        caseRow:r,
        binding:{...binding,subject_kind:"venue_comment"},
        ...(photoId ? {photoId} : {}),
        reportMeta,
        detail,
      });
    },true);
  }
  private async readCommunityAggregateSource(
    c:PoolClient,
    a:AuditActor,
    input:{
      caseId:string;
      reportId:string;
      caseRow:CaseRow;
      binding:{
        reporter_user_id:string;
        canonical_venue_id:string;
        subject_kind:"aggregate";
        vote_id:string|null;
        comment_id:string|null;
        reported_resource_version:number|null;
        content_fingerprint:string|null;
      };
      reportMeta:{reasonCode:string;state:string};
      detail:string|null;
      page:CommunityReportPage;
    },
  ) {
    const resolved=await resolveCanonicalVenue(c,input.binding.canonical_venue_id);
    if(!resolved) {
      return await this.rejectUnresolvedCommunityVenue(c,a,[input.binding.reporter_user_id]);
    }
    await this.assertIndependentCommunityReviewer(c,a,{
      affectedUserIds:[input.binding.reporter_user_id],
      canonicalVenueId:resolved.canonicalId,
      denyOwnVote:true,
    });
    const cursorBinding={
      caseId:input.caseId,
      reportId:input.reportId,
      canonicalVenueId:resolved.canonicalId,
    };
    let beforeVoteId:string|null=null;
    if(input.page.cursor) {
      const secret=this.fingerprintSecret();
      beforeVoteId=decodeCommunityAggregateVoteCursor(secret,input.page.cursor,cursorBinding);
      if(!beforeVoteId) throw badRequest("CURSOR_INVALID","Некорректный cursor");
      // Cursor vote must already belong to this report's physical terminal — no cross-venue UUID probe.
      const cursorVote=(await c.query(
        `SELECT 1 FROM venue_community_votes
         WHERE id=$1 AND canonical_venue_id=$2 AND merged_into_vote_id IS NULL LIMIT 1`,
        [beforeVoteId,resolved.canonicalId],
      )).rows[0];
      if(!cursorVote) throw badRequest("CURSOR_INVALID","Некорректный cursor");
    }
    const restrictions=this.env.USER_RESTRICTIONS_INTERNAL_ENABLED;
    const eligible=eligibleVoteWhereSql(restrictions,"v","term");
    const rows=(await c.query<{
      id:string;
      value:number|null;
      version:number;
      moderation_state:"clear"|"withheld";
      withdrawn_at:Date|null;
      eligible:boolean;
    }>(`SELECT v.id, v.value, v.version, v.moderation_state, v.withdrawn_at,
              (${eligible}) AS eligible
         FROM venue_community_votes v
         JOIN venues term ON term.id=v.canonical_venue_id
         WHERE v.canonical_venue_id=$1
           AND v.merged_into_vote_id IS NULL
           AND ($2::uuid IS NULL OR v.id<$2)
         ORDER BY v.id DESC
         LIMIT $3`,
      [resolved.canonicalId,beforeVoteId,input.page.limit+1],
    )).rows;
    const pageRows=rows.slice(0,input.page.limit);
    const summaries=await batchCommunitySummaries(
      c,
      [resolved.canonicalId],
      restrictions,
    );
    const summary=summaries[0]??unavailableSummary(resolved.canonicalId,resolved.canonicalId);
    const hasMore=rows.length>input.page.limit;
    const nextCursor=hasMore
      ? encodeCommunityAggregateVoteCursor(this.fingerprintSecret(),{
          ...cursorBinding,
          beforeVoteId:pageRows[pageRows.length-1]!.id,
        })
      : null;
    await appendAudit(c,{
      actor:a,
      action:"admin.case.community_report_read",
      targetType:"case",
      targetId:input.caseId,
      permission:"evidence.assigned.read",
      reason:"operations_read",
      after:{
        reportId:input.reportId,
        subjectKind:"aggregate",
        canonicalVenueId:resolved.canonicalId,
        sourceAvailable:true,
        hasCursor:Boolean(input.page.cursor),
        limit:input.page.limit,
        hasMore,
        itemCount:pageRows.length,
        publicCount:summary.count,
      },
    });
    const decisionCapability =
      input.caseRow.status === "closed"
        ? null
        : {
            action: "venue_community_decide" as const,
            decisions: ["retain", "withhold", "restore"] as Array<
              "retain" | "withhold" | "restore"
            >,
            resourceKind: "vote" as const,
            requiresExactVoteId: true,
            expectedCaseVersion: input.caseRow.version,
            expectedResourceVersion: null,
          };
    return {
      caseId:input.caseId,
      reportId:input.reportId,
      subjectKind:"aggregate" as const,
      canonicalVenueId:resolved.canonicalId,
      reasonCode:input.reportMeta.reasonCode,
      reportState:input.reportMeta.state,
      detail:input.detail,
      sourceAvailable:true as const,
      unavailableReason:null,
      summary,
      votes:{
        items:pageRows.map((row)=>({
          voteId:row.id,
          value:row.value,
          version:row.version,
          moderationState:row.moderation_state,
          withdrawn:row.withdrawn_at!=null,
          eligibleForPublicCount:row.eligible,
        })),
        nextCursor,
        limit:input.page.limit,
      },
      decisionCapability,
    };
  }
  private async readCommunityOwnVoteSource(
    c:PoolClient,
    a:AuditActor,
    input:{
      caseId:string;
      reportId:string;
      caseRow:CaseRow;
      binding:{
        reporter_user_id:string;
        canonical_venue_id:string;
        subject_kind:"own_vote";
        vote_id:string|null;
        comment_id:string|null;
        reported_resource_version:number|null;
        content_fingerprint:string|null;
      };
      reportMeta:{reasonCode:string;state:string};
      detail:string|null;
    },
  ) {
    if(!input.binding.vote_id || input.binding.reported_resource_version==null || !input.binding.content_fingerprint) {
      throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
    }
    const votePreview=(await c.query<{user_id:string}>(
      `SELECT user_id FROM venue_community_votes WHERE id=$1`,[input.binding.vote_id],
    )).rows[0];
    const affectedUserIds=[
      input.binding.reporter_user_id,
      ...(votePreview? [votePreview.user_id]:[]),
    ];
    const resolved=await resolveCanonicalVenue(c,input.binding.canonical_venue_id);
    if(!resolved) {
      return await this.rejectUnresolvedCommunityVenue(c,a,affectedUserIds);
    }
    await this.assertIndependentCommunityReviewer(c,a,{
      affectedUserIds,
      canonicalVenueId:resolved.canonicalId,
      denyOwnVote:false,
    });
    const vote=(await c.query<{
      id:string;
      user_id:string;
      value:number|null;
      version:number;
      moderation_state:"clear"|"withheld";
      withdrawn_at:Date|null;
      merged_into_vote_id:string|null;
      canonical_venue_id:string;
    }>(`SELECT id, user_id, value, version, moderation_state, withdrawn_at,
               merged_into_vote_id, canonical_venue_id
        FROM venue_community_votes WHERE id=$1`,[input.binding.vote_id])).rows[0];
    if(vote && vote.user_id!==input.binding.reporter_user_id) {
      throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
    }
    if(vote && vote.canonical_venue_id!==resolved.canonicalId && vote.merged_into_vote_id==null) {
      // Bound vote must remain in the reported physical family terminal or be honestly superseded.
      const familyIds=await canonicalVenueFamilyIds(c,resolved.canonicalId);
      if(!familyIds.includes(vote.canonical_venue_id)) {
        throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      }
    }
    const revision=(await c.query<{
      after_value:number|null;
      after_moderation_state:string|null;
      after_withdrawn:boolean|null;
      resource_version:number;
    }>(`SELECT after_value, after_moderation_state, after_withdrawn, resource_version
        FROM venue_community_vote_revisions
        WHERE vote_id=$1 AND resource_version=$2`,
      [input.binding.vote_id,input.binding.reported_resource_version])).rows[0];
    const secret=this.fingerprintSecret();
    const reportedFingerprint=revision
      ? venueCommunityVoteReportFingerprint(secret,{
          voteId:input.binding.vote_id,
          canonicalVenueId:input.binding.canonical_venue_id,
          userId:input.binding.reporter_user_id,
          resourceVersion:revision.resource_version,
          value:revision.after_value,
          moderationState:revision.after_moderation_state??"clear",
          withdrawn:revision.after_withdrawn===true,
        })
      : null;
    const availability=evaluateCommunityVoteSourceAvailability({
      voteExists:Boolean(vote),
      mergedIntoVoteId:vote?.merged_into_vote_id??null,
      expectedFingerprint:input.binding.content_fingerprint,
      reportedFingerprint,
      revisionFound:Boolean(revision),
    });
    await appendAudit(c,{
      actor:a,
      action:"admin.case.community_report_read",
      targetType:"case",
      targetId:input.caseId,
      permission:"evidence.assigned.read",
      reason:"operations_read",
      after:{
        reportId:input.reportId,
        subjectKind:"own_vote",
        canonicalVenueId:resolved.canonicalId,
        voteId:input.binding.vote_id,
        sourceAvailable:availability.available,
        ...(availability.available
          ?{reportedVersion:input.binding.reported_resource_version,currentVersion:vote?.version??null}
          :{unavailableReason:availability.reason,reportedVersion:input.binding.reported_resource_version}),
      },
    });
    // Exact fingerprint validation before disclosing reported/current values — mismatch/unavailable
    // returns safe metadata only (nullable shape honest; no silent revision substitution).
    const ownVoteCapability =
      input.caseRow.status === "closed" ||
      !availability.available ||
      !vote ||
      vote.merged_into_vote_id != null
        ? null
        : {
            action: "venue_community_decide" as const,
            decisions: communityHumanDecisionOptions({
              moderationState: vote.moderation_state,
              withdrawn: vote.withdrawn_at != null,
              deleted: false,
              merged: false,
            }),
            resourceKind: "vote" as const,
            voteId: input.binding.vote_id,
            expectedCaseVersion: input.caseRow.version,
            expectedResourceVersion: vote.version,
          };
    if(!availability.available) {
      return {
        caseId:input.caseId,
        reportId:input.reportId,
        subjectKind:"own_vote" as const,
        canonicalVenueId:resolved.canonicalId,
        reasonCode:input.reportMeta.reasonCode,
        reportState:input.reportMeta.state,
        detail:input.detail,
        sourceAvailable:false as const,
        unavailableReason:availability.reason,
        voteId:input.binding.vote_id,
        reportedVersion:input.binding.reported_resource_version,
        currentVersion:null,
        reportedValue:null,
        reportedModerationState:null,
        reportedWithdrawn:null,
        currentValue:null,
        currentModerationState:null,
        currentWithdrawn:null,
        mergedIntoVoteId:vote?.merged_into_vote_id??null,
        decisionCapability:null,
      };
    }
    return {
      caseId:input.caseId,
      reportId:input.reportId,
      subjectKind:"own_vote" as const,
      canonicalVenueId:resolved.canonicalId,
      reasonCode:input.reportMeta.reasonCode,
      reportState:input.reportMeta.state,
      detail:input.detail,
      sourceAvailable:true as const,
      unavailableReason:null,
      voteId:input.binding.vote_id,
      reportedVersion:input.binding.reported_resource_version,
      currentVersion:vote?.version??null,
      reportedValue:revision?.after_value??null,
      reportedModerationState:(revision?.after_moderation_state as "clear"|"withheld"|null)??null,
      reportedWithdrawn:revision?.after_withdrawn??null,
      currentValue:vote?.value??null,
      currentModerationState:vote?.moderation_state??null,
      currentWithdrawn:vote?vote.withdrawn_at!=null:null,
      mergedIntoVoteId:vote?.merged_into_vote_id??null,
      decisionCapability:ownVoteCapability,
    };
  }
  private async readCommunityCommentSource(
    c:PoolClient,
    a:AuditActor,
    input:{
      photoId?:string;
      caseId:string;
      reportId:string;
      caseRow:CaseRow;
      binding:{
        reporter_user_id:string;
        canonical_venue_id:string;
        subject_kind:"venue_comment";
        vote_id:string|null;
        comment_id:string|null;
        reported_resource_version:number|null;
        content_fingerprint:string|null;
      };
      reportMeta:{reasonCode:string;state:string};
      detail:string|null;
    },
  ) {
    if(!input.binding.comment_id || input.binding.reported_resource_version==null || !input.binding.content_fingerprint) {
      throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
    }
    const commentPreview=(await c.query<{
      entity_kind:string;
      author_user_id:string;
    }>(`SELECT entity_kind, author_user_id FROM entity_comments WHERE id=$1`,[input.binding.comment_id])).rows[0];
    if(commentPreview && commentPreview.entity_kind!=="venue") {
      throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
    }
    const affectedUserIds=[
      input.binding.reporter_user_id,
      ...(commentPreview?[commentPreview.author_user_id]:[]),
    ];
    const resolved=await resolveCanonicalVenue(c,input.binding.canonical_venue_id);
    if(!resolved) {
      return await this.rejectUnresolvedCommunityVenue(c,a,affectedUserIds);
    }
    const comment=(await c.query<{
      id:string;
      entity_kind:string;
      entity_id:string;
      author_user_id:string;
      body:string|null;
      version:number;
      deleted_at:Date|null;
      moderation_state:string|null;
    }>(`SELECT id, entity_kind, entity_id, author_user_id, body, version, deleted_at, moderation_state
        FROM entity_comments WHERE id=$1`,[input.binding.comment_id])).rows[0];
    if(!comment || comment.entity_kind!=="venue") {
      throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
    }
    await this.assertIndependentCommunityReviewer(c,a,{
      affectedUserIds:[input.binding.reporter_user_id,comment.author_user_id],
      canonicalVenueId:resolved.canonicalId,
      denyOwnVote:false,
    });
    const revision=(await c.query<{
      after_body:string|null;
      entity_id:string;
      resource_version:number;
      tombstone:boolean;
    }>(`SELECT after_body, entity_id, resource_version, tombstone
        FROM entity_comment_revisions
        WHERE comment_id=$1 AND resource_version=$2`,
      [input.binding.comment_id,input.binding.reported_resource_version])).rows[0];
    const secret=this.fingerprintSecret();
    const reportedPhotos=await revisionPhotoEvidence(c,input.binding.comment_id,input.binding.reported_resource_version);
    const reportedFingerprint=
      revision && (revision.after_body!=null && revision.after_body.length>0 || reportedPhotos.length>0)
        ? venueCommunityCommentReportFingerprint(secret,{
            commentId:input.binding.comment_id,
            entityId:revision.entity_id,
            resourceVersion:revision.resource_version,
            bodyText:revision.after_body,
            photos:reportedPhotos,
          })
        : null;
    const availability=evaluateCommunityCommentSourceAvailability({
      revisionFound:Boolean(revision),
      reportedBody:revision?.after_body??null,
      reportedPhotoCount:reportedPhotos.length,
      expectedFingerprint:input.binding.content_fingerprint,
      reportedFingerprint,
      currentDeleted:comment.deleted_at!=null || revision?.tombstone===true,
      currentWithheld:(comment.moderation_state??"clear")==="withheld",
      currentVersion:comment.version,
      reportedVersion:input.binding.reported_resource_version,
    });
    await appendAudit(c,{
      actor:a,
      action:"admin.case.community_report_read",
      targetType:"case",
      targetId:input.caseId,
      permission:"evidence.assigned.read",
      reason:"operations_read",
      after:{
        reportId:input.reportId,
        subjectKind:"venue_comment",
        canonicalVenueId:resolved.canonicalId,
        commentId:input.binding.comment_id,
        sourceAvailable:availability.available,
        currentPublication:availability.currentPublication,
        reportedVersion:input.binding.reported_resource_version,
        currentVersion:availability.currentVersion,
        ...(availability.available?{}:{unavailableReason:availability.reason}),
      },
    });
    if (input.photoId) {
      if (!availability.available || !reportedPhotos.some(p=>p.id===input.photoId)) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const photo=(await c.query<{storage_key:string;image_sha256:string;content_fingerprint:string}>(`SELECT s.storage_key,s.image_sha256,a.content_fingerprint
        FROM entity_comment_photos p JOIN venue_photo_submissions s ON s.id=p.photo_id
        JOIN content_moderation_approvals a ON a.id=s.image_approval_id
        WHERE p.comment_id=$1 AND p.resource_version=$2 AND p.photo_id=$3
          AND ${photoApprovalSql(this.env)} AND a.provider_key=$4 FOR SHARE OF s,a`,
        [input.binding.comment_id,input.binding.reported_resource_version,input.photoId,this.env.CONTENT_MODERATION_PROVIDER])).rows[0];
      if (!photo) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      const bytes=await this.media.readPrivateStage(c,photo.storage_key,photo.image_sha256);
      if (this.moderation.fingerprint(bytes,"community_photo")!==photo.content_fingerprint) throw notFound("REPORT_UNAVAILABLE","Жалоба недоступна");
      await appendAudit(c,{actor:a,action:"admin.case.community_photo_read",targetType:"case",targetId:input.caseId,
        permission:"evidence.assigned.read",reason:"operations_read",after:{reportId:input.reportId,photoId:input.photoId,
          reportedVersion:input.binding.reported_resource_version}});
      return {bytes};
    }
    const sameLineage=await sameReportedCommentLineage(c,{caseId:input.caseId,reportId:input.reportId,
      commentId:comment.id,reportedVersion:input.binding.reported_resource_version,currentVersion:comment.version});
    const commentCapability =
      input.caseRow.status === "closed" ||
      !availability.available ||
      comment.deleted_at != null || !sameLineage
        ? null
        : {
            action: "venue_community_decide" as const,
            decisions: communityHumanDecisionOptions({
              moderationState:
                (comment.moderation_state ?? "clear") === "withheld" ? "withheld" : "clear",
              withdrawn: false,
              deleted: false,
              merged: false,
            }),
            resourceKind: "comment" as const,
            commentId: input.binding.comment_id,
            expectedCaseVersion: input.caseRow.version,
            expectedResourceVersion: comment.version,
          };
    return {
      caseId:input.caseId,
      reportId:input.reportId,
      subjectKind:"venue_comment" as const,
      canonicalVenueId:resolved.canonicalId,
      reasonCode:input.reportMeta.reasonCode,
      reportState:input.reportMeta.state,
      detail:input.detail,
      sourceAvailable:availability.available,
      unavailableReason:availability.available?null:availability.reason,
      commentId:input.binding.comment_id,
      reportedVersion:input.binding.reported_resource_version,
      currentVersion:availability.currentVersion,
      text:availability.available?availability.text:null,
      photos:availability.available?reportedPhotos.map(p=>({id:p.id,
        url:`/v1/admin/cases/${input.caseId}/community-reports/${input.reportId}?photoId=${p.id}`})):[],
      currentPublication:availability.currentPublication,
      decisionCapability:commentCapability,
    };
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
    this.enabled();
    // Explicit human role-reputation decisions — never implied by generic status=resolved.
    if (input.action === "role_review_decide") {
      return this.roleReputation.decide(request, id, key, input);
    }
    if (input.action === "role_basis_resolve") {
      return this.roleReputation.resolveBasis(request, id, key, input);
    }
    if (input.action === "venue_review_decide") {
      return this.venueReviews.decide(request, id, key, input);
    }
    if (input.action === "venue_community_decide") {
      return this.communityDecide(request, id, key, input);
    }
    type LegacyCaseCommand = Exclude<
      CaseCommand,
      | { action: "role_review_decide" }
      | { action: "role_basis_resolve" }
      | { action: "venue_review_decide" }
      | { action: "venue_community_decide" }
    >;
    const legacy = input as LegacyCaseCommand;
    return this.admin.privilegedCommand(request,key,"user.lookup",legacy.action==="capture_evidence","case.command",{id,...legacy},async(c,a,keyHash)=>{
      const r=await this.scoped(c,a,id);
      if(r.version!==legacy.expectedVersion)throw conflict("CASE_VERSION_CONFLICT","Обращение уже изменено");
      if(r.status==="closed" && !(legacy.action==="status" && legacy.status==="open"))throw conflict("CASE_CLOSED","Сначала откройте обращение снова");
      let evidenceId:string|undefined;
      const after:Record<string,unknown>={version:r.version+1,action:legacy.action};
      if(legacy.action==="assign") {
        if(legacy.principalId && !(await c.query(`SELECT 1 FROM admin_principals p WHERE p.id=$1 AND p.status='active' AND EXISTS(SELECT 1 FROM admin_role_grants g WHERE g.principal_id=p.id AND g.active AND g.role IN ('superadmin','moderator','support'))`,[legacy.principalId])).rowCount)throw notFound("ASSIGNEE_UNAVAILABLE","Сотрудник недоступен");
        await c.query("UPDATE support_cases SET assigned_to=$2 WHERE id=$1",[id,legacy.principalId]);after.assignedTo=legacy.principalId;
      } else if(legacy.action==="status") {
        const transitions:Record<string,string[]>={open:["in_review","resolved","closed"],in_review:["resolved","closed"],resolved:["closed","open"],closed:["open"]};
        if(!transitions[r.status]!.includes(legacy.status))throw conflict("CASE_STATUS_CONFLICT","Переход недоступен");
        await c.query("UPDATE support_cases SET status=$2 WHERE id=$1",[id,legacy.status]);after.status=legacy.status;
      } else if(legacy.action==="link_report" || legacy.action==="link_game") {
        if(Number((await c.query("SELECT count(*) FROM support_case_links WHERE case_id=$1",[id])).rows[0].count)>=100)throw conflict("CASE_LINK_LIMIT","Достигнут предел связей");
        if(legacy.action==="link_report")await this.linkReport(c,id,legacy.reportId);
        else {
          if(!(await c.query("SELECT 1 FROM games WHERE id=$1",[legacy.gameId])).rowCount)throw notFound("GAME_UNAVAILABLE","Игра недоступна");
          if(!(await c.query("INSERT INTO support_case_links(case_id,source_kind,game_id) VALUES($1,'game',$2) ON CONFLICT(case_id,game_id) DO NOTHING RETURNING id",[id,legacy.gameId])).rowCount)throw conflict("CASE_LINK_EXISTS","Связь уже существует");
        }
      } else if(legacy.action==="capture_evidence") {
        if(Number((await c.query("SELECT count(*) FROM case_evidence_items WHERE case_id=$1",[id])).rows[0].count)>=1000)throw conflict("CASE_EVIDENCE_LIMIT","Достигнут предел материалов");
        const link=(await c.query("SELECT * FROM support_case_links WHERE id=$1 AND case_id=$2",[legacy.linkId,id])).rows[0];
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
        const auditId=await appendAudit(c,{actor:a,action:"admin.evidence_capture",targetType:"case",targetId:id,permission:manages(a)?"evidence.case.read":"evidence.assigned.read",reason:legacy.reasonCode,after:{linkId:link.id,contentHash:hash,classification:"synthetic_minimal"},keyHash});
        evidenceId=(await c.query("INSERT INTO case_evidence_items(case_id,link_id,kind,payload,content_hash,classification,policy_id,expires_at,legal_hold,audit_id) VALUES($1,$2,$3,$4,$5,'synthetic_minimal',$6,$7,$8,$9) RETURNING id",[id,link.id,link.source_kind==="report"?"report_summary":"game_state",raw,hash,policy.policyId,policy.expiresAt,policy.legalHold,auditId])).rows[0].id;
        after.evidenceId=evidenceId;
      } else if(legacy.action==="note") after.noteCode=legacy.noteCode;
      await c.query("UPDATE support_cases SET version=version+1,updated_at=clock_timestamp() WHERE id=$1",[id]);
      const auditId=await appendAudit(c,{actor:a,action:"admin.case."+legacy.action,targetType:"case",targetId:id,permission:manages(a)?"case.manage":"case.assigned.manage",reason:legacy.reasonCode,before:{version:r.version,status:r.status,assignedTo:r.assigned_to},after,keyHash});
      await c.query("INSERT INTO support_case_actions(case_id,case_version,audit_id,action,note_code) VALUES($1,$2,$3,$4,$5)",[id,r.version+1,auditId,legacy.action,legacy.action==="note"?legacy.noteCode:null]);
      return {id,version:r.version+1,auditId,...(evidenceId?{evidenceId}:{})};
    },async(c,a)=>{
      await this.scoped(c,a,id);
      if(["assign","link_report","link_game"].includes(legacy.action))this.manage(a);
      if(legacy.action==="capture_evidence")this.evidencePermission(a);
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

  /**
   * Assigned human retain/withhold/restore for venue community vote/comment.
   * Extends CaseCommand — no standalone Admin API. Comment restore reuses #506
   * comment_body publication gate via privilegedRunWithExternalPrepare.
   */
  async communityDecide(
    request: FastifyRequest,
    caseId: string,
    key: string | undefined,
    input: VenueCommunityDecide,
  ) {
    this.enabled();
    const needsPublicationGate =
      input.decision === "restore" && input.resourceKind === "comment";
    if (!needsPublicationGate) {
      return this.admin.privilegedCommand(
        request,
        key,
        "user.lookup",
        true,
        "venue_community.decide",
        { caseId, ...input },
        async (client, actor, keyHash) =>
          this.executeCommunityDecide(client, actor, keyHash, caseId, input, null),
        async (client, actor) => {
          await this.authorizeCommunityDecideScope(client, actor, caseId, input);
        },
      );
    }

    let preparedText: string | null = null;
    let preparedResourceVersion: number | null = null;
    let preparedCommentId: string | null = null;
    let assessActorUserId: string | null = null;

    return this.admin.privilegedRunWithExternalPrepare<
      TextBatchApproval | null,
      {
        caseId: string;
        caseVersion: number;
        decision: CommunityHumanDecision;
        auditId: string;
        decisionId: string;
        resourceKind: "vote" | "comment";
        voteId?: string;
        commentId?: string;
        resourceVersion: number;
      }
    >(
      request,
      key,
      "user.lookup",
      true,
      "venue_community.decide",
      { caseId, ...input },
      async (client, actor) => {
        await this.authorizeCommunityDecideScope(client, actor, caseId, input);
      },
      async (client, actor) => {
        const locked = await this.loadCommunityDecideTarget(client, actor, caseId, input, {
          forUpdate: false,
          requireCaseVersion: true,
        });
        if (locked.resourceKind !== "comment") {
          throw conflict("RESOURCE_KIND_CONFLICT", "Ресурс недоступен");
        }
        if (locked.comment.deleted_at != null) {
          throw conflict("RESTORE_DENIED", "Восстановление недоступно");
        }
        if (locked.comment.moderation_state !== "withheld") {
          throw conflict("RESTORE_DENIED", "Восстановление недоступно");
        }
        const ids=await currentPhotoIds(client,locked.comment.id,locked.comment.version);
        if (!locked.comment.body && !ids.length) throw conflict("RESTORE_DENIED", "Восстановление недоступно");
        await validatePublicationPhotos(client,this.env,this.media,this.moderation,{actorId:locked.comment.author_user_id,
          canonical:locked.resolved.canonicalId,commentId:locked.comment.id,version:locked.comment.version,ids});
        preparedText = locked.comment.body;
        preparedResourceVersion = locked.comment.version;
        preparedCommentId = locked.comment.id;
        assessActorUserId = actor.principal.user_id;
      },
      async () =>
        preparedText===null ? Promise.resolve(null) : this.moderation.approveTexts(assessActorUserId!, [
          { surface: "comment_body", text: preparedText!, fieldId: "text" },
        ]),
      async (client, actor, keyHash, prepared) =>
        this.executeCommunityDecide(client, actor, keyHash, caseId, input, {
          approval: prepared,
          text: preparedText,
          resourceVersion: preparedResourceVersion!,
          commentId: preparedCommentId!,
        }),
    );
  }

  private async authorizeCommunityDecideScope(
    client: PoolClient,
    actor: AdminActor,
    caseId: string,
    input: VenueCommunityDecide,
  ) {
    if (!canReadAssignedEvidence(actor)) {
      throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
    }
    const caze = await this.scoped(client, actor, caseId);
    if (caze.assigned_to !== actor.principalId) {
      throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
    }
    await this.loadCommunityDecideTarget(client, actor, caseId, input, {
      forUpdate: false,
      requireCaseVersion: false,
    });
  }

  private async loadCommunityDecideTarget(
    client: PoolClient,
    actor: AdminActor,
    caseId: string,
    input: VenueCommunityDecide,
    opts: { forUpdate: boolean; requireCaseVersion: boolean },
  ) {
    const caze = await this.scoped(client, actor, caseId);
    if (caze.assigned_to !== actor.principalId) {
      throw forbidden("ADMIN_PERMISSION_DENIED", "Нужно текущее назначение");
    }
    if (!canReadAssignedEvidence(actor)) {
      throw forbidden("ADMIN_PERMISSION_DENIED", "Нет разрешения");
    }
    if (caze.status === "closed") {
      throw conflict("CASE_CLOSED", "Сначала откройте обращение снова");
    }
    if (opts.requireCaseVersion && caze.version !== input.expectedCaseVersion) {
      throw conflict("CASE_VERSION_CONFLICT", "Обращение уже изменено");
    }
    const link = (
      await client.query(
        `SELECT id FROM support_case_links WHERE case_id=$1 AND report_id=$2`,
        [caseId, input.reportId],
      )
    ).rows[0];
    if (!link) throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
    const reportMeta = await this.report(client, input.reportId);
    if (reportMeta.targetKind !== "venue_community") {
      throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
    }
    const binding = (
      await client.query<CommunityBindingRow>(
        `SELECT reporter_user_id, canonical_venue_id, subject_kind, vote_id, comment_id,
                reported_resource_version, content_fingerprint
         FROM venue_community_report_bindings WHERE report_id=$1`,
        [input.reportId],
      )
    ).rows[0];
    if (!binding) throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");

    if (input.resourceKind === "vote") {
      return this.loadCommunityVoteDecideTarget(client, actor, {
        caseId,
        input,
        binding,
        caze,
        forUpdate: opts.forUpdate,
      });
    }
    return this.loadCommunityCommentDecideTarget(client, actor, {
      caseId,
      input,
      binding,
      caze,
      forUpdate: opts.forUpdate,
    });
  }

  private async loadCommunityVoteDecideTarget(
    client: PoolClient,
    actor: AdminActor,
    args: {
      caseId: string;
      input: VenueCommunityDecide;
      binding: CommunityBindingRow;
      caze: CaseRow;
      forUpdate: boolean;
    },
  ) {
    const voteId = args.input.voteId;
    if (!voteId) throw badRequest("VOTE_ID_REQUIRED", "Нужен voteId");
    if (args.binding.subject_kind === "venue_comment") {
      throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
    }
    if (args.binding.subject_kind === "own_vote") {
      if (args.binding.vote_id !== voteId) {
        throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
      }
      if (
        args.binding.reported_resource_version == null ||
        !args.binding.content_fingerprint
      ) {
        throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
      }
    }

    const votePreview = (
      await client.query<{ user_id: string }>(
        `SELECT user_id FROM venue_community_votes WHERE id=$1`,
        [voteId],
      )
    ).rows[0];
    const affected = [
      args.binding.reporter_user_id,
      ...(votePreview ? [votePreview.user_id] : []),
    ];
    const resolved = await resolveCanonicalVenue(client, args.binding.canonical_venue_id);
    if (!resolved) {
      return await this.rejectUnresolvedCommunityVenue(client, actor, affected);
    }
    await this.assertIndependentCommunityReviewer(client, actor, {
      affectedUserIds: affected,
      canonicalVenueId: resolved.canonicalId,
      denyOwnVote: args.binding.subject_kind === "aggregate",
    });

    const vote = (
      await client.query<{
        id: string;
        user_id: string;
        value: number | null;
        version: number;
        moderation_state: "clear" | "withheld";
        withdrawn_at: Date | null;
        merged_into_vote_id: string | null;
        canonical_venue_id: string;
        user_action_at: Date;
      }>(
        `SELECT id, user_id, value, version, moderation_state, withdrawn_at,
                merged_into_vote_id, canonical_venue_id, user_action_at
         FROM venue_community_votes WHERE id=$1${args.forUpdate ? " FOR UPDATE" : ""}`,
        [voteId],
      )
    ).rows[0];
    if (!vote || vote.canonical_venue_id !== resolved.canonicalId) {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    if (args.binding.subject_kind === "own_vote") {
      if (vote.user_id !== args.binding.reporter_user_id) {
        throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
      }
      const revision = (
        await client.query<{
          after_value: number | null;
          after_moderation_state: string | null;
          after_withdrawn: boolean | null;
          resource_version: number;
        }>(
          `SELECT after_value, after_moderation_state, after_withdrawn, resource_version
           FROM venue_community_vote_revisions
           WHERE vote_id=$1 AND resource_version=$2`,
          [voteId, args.binding.reported_resource_version],
        )
      ).rows[0];
      const secret = this.fingerprintSecret();
      const reportedFingerprint = revision
        ? venueCommunityVoteReportFingerprint(secret, {
            voteId,
            canonicalVenueId: args.binding.canonical_venue_id,
            userId: args.binding.reporter_user_id,
            resourceVersion: revision.resource_version,
            value: revision.after_value,
            moderationState: revision.after_moderation_state ?? "clear",
            withdrawn: revision.after_withdrawn === true,
          })
        : null;
      const availability = evaluateCommunityVoteSourceAvailability({
        voteExists: true,
        mergedIntoVoteId: vote.merged_into_vote_id,
        expectedFingerprint: args.binding.content_fingerprint!,
        reportedFingerprint,
        revisionFound: Boolean(revision),
      });
      if (!availability.available) {
        throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
      }
    } else if (vote.merged_into_vote_id != null) {
      throw conflict("RESOURCE_SUPERSEDED", "Ресурс уже замещён");
    }

    return {
      resourceKind: "vote" as const,
      caze: args.caze,
      binding: args.binding,
      resolved,
      vote,
    };
  }

  private async loadCommunityCommentDecideTarget(
    client: PoolClient,
    actor: AdminActor,
    args: {
      caseId: string;
      input: VenueCommunityDecide;
      binding: CommunityBindingRow;
      caze: CaseRow;
      forUpdate: boolean;
    },
  ) {
    const commentId = args.input.commentId;
    if (!commentId) throw badRequest("COMMENT_ID_REQUIRED", "Нужен commentId");
    if (args.binding.subject_kind !== "venue_comment" || args.binding.comment_id !== commentId) {
      throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
    }
    if (
      args.binding.reported_resource_version == null ||
      !args.binding.content_fingerprint
    ) {
      throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
    }

    const preview = (
      await client.query<{ entity_kind: string; author_user_id: string }>(
        `SELECT entity_kind, author_user_id FROM entity_comments WHERE id=$1`,
        [commentId],
      )
    ).rows[0];
    if (preview && preview.entity_kind !== "venue") {
      throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
    }
    const affected = [
      args.binding.reporter_user_id,
      ...(preview ? [preview.author_user_id] : []),
    ];
    const resolved = await resolveCanonicalVenue(client, args.binding.canonical_venue_id);
    if (!resolved) {
      return await this.rejectUnresolvedCommunityVenue(client, actor, affected);
    }

    const comment = (
      await client.query<{
        id: string;
        entity_kind: string;
        entity_id: string;
        author_user_id: string;
        body: string | null;
        version: number;
        deleted_at: Date | null;
        moderation_state: string | null;
      }>(
        `SELECT id, entity_kind, entity_id, author_user_id, body, version, deleted_at, moderation_state
         FROM entity_comments WHERE id=$1${args.forUpdate ? " FOR UPDATE" : ""}`,
        [commentId],
      )
    ).rows[0];
    if (!comment || comment.entity_kind !== "venue") {
      throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
    }
    await this.assertIndependentCommunityReviewer(client, actor, {
      affectedUserIds: [args.binding.reporter_user_id, comment.author_user_id],
      canonicalVenueId: resolved.canonicalId,
      denyOwnVote: false,
    });

    const family = await canonicalVenueFamilyIds(client, resolved.canonicalId);
    if (!family.includes(comment.entity_id) && comment.entity_id !== resolved.canonicalId) {
      // Origin may be a merged alias in the same physical family.
      const originResolved = await resolveCanonicalVenue(client, comment.entity_id);
      if (!originResolved || originResolved.canonicalId !== resolved.canonicalId) {
        throw notFound("RESOURCE_UNAVAILABLE", "Ресурс недоступен");
      }
    }

    const revision = (
      await client.query<{
        after_body: string | null;
        entity_id: string;
        resource_version: number;
        tombstone: boolean;
      }>(
        `SELECT after_body, entity_id, resource_version, tombstone
         FROM entity_comment_revisions
         WHERE comment_id=$1 AND resource_version=$2`,
        [commentId, args.binding.reported_resource_version],
      )
    ).rows[0];
    const secret = this.fingerprintSecret();
    const reportedPhotos=await revisionPhotoEvidence(client,commentId,args.binding.reported_resource_version);
    const reportedFingerprint =
      revision && (revision.after_body != null && revision.after_body.length > 0 || reportedPhotos.length>0)
        ? venueCommunityCommentReportFingerprint(secret, {
            commentId,
            entityId: revision.entity_id,
            resourceVersion: revision.resource_version,
            bodyText: revision.after_body,
            photos: reportedPhotos,
          })
        : null;
    const availability = evaluateCommunityCommentSourceAvailability({
      revisionFound: Boolean(revision),
      reportedBody: revision?.after_body ?? null,
      reportedPhotoCount: reportedPhotos.length,
      expectedFingerprint: args.binding.content_fingerprint,
      reportedFingerprint,
      currentDeleted: comment.deleted_at != null || revision?.tombstone === true,
      currentWithheld: (comment.moderation_state ?? "clear") === "withheld",
      currentVersion: comment.version,
      reportedVersion: args.binding.reported_resource_version,
    });
    const sameLineage=await sameReportedCommentLineage(client,{caseId:args.caze.id,reportId:args.input.reportId,
      commentId,reportedVersion:args.binding.reported_resource_version,currentVersion:comment.version});
    if (!availability.available || !sameLineage) {
      throw notFound("REPORT_UNAVAILABLE", "Жалоба недоступна");
    }

    return {
      resourceKind: "comment" as const,
      caze: args.caze,
      binding: args.binding,
      resolved,
      comment,
    };
  }

  private async executeCommunityDecide(
    client: PoolClient,
    actor: AdminActor,
    keyHash: string,
    caseId: string,
    input: VenueCommunityDecide,
    prepared:
      | {
          approval: TextBatchApproval | null;
          text: string | null;
          resourceVersion: number;
          commentId: string;
        }
      | null,
  ) {
    // Shared catalog fence matches AdminVenues exclusive merge/catalog: hold through
    // canonical resolution, family/independence, exact resource locks, and decision commit.
    // External OpenAI restore prepare stays outside this transaction (and this lock).
    await lockCatalogShared(client);
    const locked = await this.loadCommunityDecideTarget(client, actor, caseId, input, {
      forUpdate: true,
      requireCaseVersion: true,
    });

    let resultingResourceVersion: number;
    let resourceId: string;

    if (locked.resourceKind === "vote") {
      const vote = locked.vote;
      if (vote.version !== input.expectedResourceVersion) {
        throw conflict("VERSION_CONFLICT", "Версия ресурса устарела");
      }
      const allowed = communityHumanDecisionAllowed(input.decision, {
        moderationState: vote.moderation_state,
        withdrawn: vote.withdrawn_at != null,
        deleted: false,
        merged: vote.merged_into_vote_id != null,
      });
      if (!allowed) {
        throw conflict("DECISION_DENIED", "Решение недоступно для текущего состояния");
      }
      resourceId = vote.id;

      if (input.decision === "retain") {
        resultingResourceVersion = vote.version;
        const decisionId = await this.insertCommunityDecision(client, {
          caseId,
          input,
          voteId: vote.id,
          commentId: null,
          resultingResourceVersion,
          actorPrincipalId: actor.principalId,
        });
        return this.finishCommunityDecide(client, actor, keyHash, {
          caseId,
          caze: locked.caze,
          input,
          decisionId,
          resourceKind: "vote",
          resourceId,
          resultingResourceVersion,
        });
      }

      if (vote.merged_into_vote_id != null || vote.withdrawn_at != null) {
        throw conflict("DECISION_DENIED", "Решение недоступно для текущего состояния");
      }
      const nextVersion = vote.version + 1;
      const nextState: "clear" | "withheld" =
        input.decision === "withhold" ? "withheld" : "clear";
      const action =
        input.decision === "withhold" ? "moderation_withhold" : "moderation_restore";
      // Insert durable decision first so vote_revisions.decision_id FK can reference it.
      const decisionId = await this.insertCommunityDecision(client, {
        caseId,
        input,
        voteId: vote.id,
        commentId: null,
        resultingResourceVersion: nextVersion,
        actorPrincipalId: actor.principalId,
      });
      // Preserve user_action_at / value / withdrawn / merged intent — moderation only.
      await client.query(
        `UPDATE venue_community_votes
         SET moderation_state=$2,
             version=$3,
             updated_at=clock_timestamp()
         WHERE id=$1`,
        [vote.id, nextState, nextVersion],
      );
      await client.query(
        `INSERT INTO venue_community_vote_revisions
           (vote_id, resource_version, actor_user_id, actor_principal_id, action,
            before_value, after_value, before_moderation_state, after_moderation_state,
            before_withdrawn, after_withdrawn, case_id, decision_id)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$9,$10,$11)`,
        [
          vote.id,
          nextVersion,
          actor.principal.user_id,
          actor.principalId,
          action,
          vote.value,
          vote.moderation_state,
          nextState,
          vote.withdrawn_at != null,
          caseId,
          decisionId,
        ],
      );
      resultingResourceVersion = nextVersion;
      return this.finishCommunityDecide(client, actor, keyHash, {
        caseId,
        caze: locked.caze,
        input,
        decisionId,
        resourceKind: "vote",
        resourceId,
        resultingResourceVersion,
      });
    }

    const comment = locked.comment;
    if (comment.version !== input.expectedResourceVersion) {
      throw conflict("VERSION_CONFLICT", "Версия ресурса устарела");
    }
    const moderationState: "clear" | "withheld" =
      (comment.moderation_state ?? "clear") === "withheld" ? "withheld" : "clear";
    const allowed = communityHumanDecisionAllowed(input.decision, {
      moderationState,
      withdrawn: false,
      deleted: comment.deleted_at != null,
      merged: false,
    });
    if (!allowed) {
      throw conflict("DECISION_DENIED", "Решение недоступно для текущего состояния");
    }
    resourceId = comment.id;

    if (input.decision === "retain") {
      resultingResourceVersion = comment.version;
      const decisionId = await this.insertCommunityDecision(client, {
        caseId,
        input,
        voteId: null,
        commentId: comment.id,
        resultingResourceVersion,
        actorPrincipalId: actor.principalId,
      });
      return this.finishCommunityDecide(client, actor, keyHash, {
        caseId,
        caze: locked.caze,
        input,
        decisionId,
        resourceKind: "comment",
        resourceId,
        resultingResourceVersion,
      });
    }

    const photoIds=await currentPhotoIds(client,comment.id,comment.version);
    if (comment.deleted_at != null || (!comment.body && !photoIds.length)) {
      throw conflict("DECISION_DENIED", "Решение недоступно для текущего состояния");
    }

    if (input.decision === "restore") {
      if (!prepared || prepared.commentId !== comment.id) {
        throw unprocessable("VENUE_MODERATION_REQUIRED", "Нужна проверка текста");
      }
      if (
        prepared.resourceVersion !== comment.version ||
        prepared.text !== comment.body
      ) {
        throw conflict("VERSION_CONFLICT", "Версия ресурса устарела");
      }
    }

    if(input.decision==="restore") await validatePublicationPhotos(client,this.env,this.media,this.moderation,{actorId:comment.author_user_id,
      canonical:locked.resolved.canonicalId,commentId:comment.id,version:comment.version,ids:photoIds});
    const nextVersion = comment.version + 1;
    const nextState: "clear" | "withheld" =
      input.decision === "withhold" ? "withheld" : "clear";
    const decisionId = await this.insertCommunityDecision(client, {
      caseId,
      input,
      voteId: null,
      commentId: comment.id,
      resultingResourceVersion: nextVersion,
      actorPrincipalId: actor.principalId,
    });
    // Staff cannot edit authored text — body unchanged; moderation_state + version only.
    await client.query(
      `UPDATE entity_comments
       SET moderation_state=$2,
           version=$3,
           updated_at=clock_timestamp()
       WHERE id=$1`,
      [comment.id, nextState, nextVersion],
    );
    await client.query(
      `INSERT INTO entity_comment_revisions
         (comment_id, entity_kind, entity_id, resource_version, actor_user_id,
          before_body, after_body, tombstone)
       VALUES ($1,'venue',$2,$3,$4,$5,$5,false)`,
      [
        comment.id,
        comment.entity_id,
        nextVersion,
        actor.principal.user_id,
        comment.body,
      ],
    );
    await bindPublicationPhotos(client,comment.id,nextVersion,photoIds);
    if (input.decision === "restore" && prepared?.approval && prepared.text !== null) {
      await this.moderation.bindTexts(
        client,
        prepared.approval,
        [{ surface: "comment_body", text: prepared.text }],
        {
          entityKind: "entity_comment",
          entityId: comment.id,
          resourceVersion: nextVersion,
          actorUserId: comment.author_user_id,
          actorPrincipalId: actor.principalId,
          bindingKind: "publication",
        },
      );
    }
    resultingResourceVersion = nextVersion;
    return this.finishCommunityDecide(client, actor, keyHash, {
      caseId,
      caze: locked.caze,
      input,
      decisionId,
      resourceKind: "comment",
      resourceId,
      resultingResourceVersion,
    });
  }

  private async insertCommunityDecision(
    client: PoolClient,
    args: {
      caseId: string;
      input: VenueCommunityDecide;
      voteId: string | null;
      commentId: string | null;
      resultingResourceVersion: number;
      actorPrincipalId: string;
    },
  ) {
    const row = (
      await client.query<{ id: string }>(
        `INSERT INTO venue_community_decisions
           (case_id, report_id, decision, resource_kind, vote_id, comment_id,
            expected_case_version, expected_resource_version, resulting_resource_version,
            rationale, actor_principal_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          args.caseId,
          args.input.reportId,
          args.input.decision,
          args.input.resourceKind,
          args.voteId,
          args.commentId,
          args.input.expectedCaseVersion,
          args.input.expectedResourceVersion,
          args.resultingResourceVersion,
          args.input.rationale,
          args.actorPrincipalId,
        ],
      )
    ).rows[0];
    if (!row) throw new Error("venue_community_decisions insert failed");
    return row.id;
  }

  private async finishCommunityDecide(
    client: PoolClient,
    actor: AdminActor,
    keyHash: string,
    args: {
      caseId: string;
      caze: CaseRow;
      input: VenueCommunityDecide;
      decisionId: string;
      resourceKind: "vote" | "comment";
      resourceId: string;
      resultingResourceVersion: number;
    },
  ) {
    const nextCaseVersion = args.caze.version + 1;
    await client.query(
      `UPDATE support_cases SET version=$2, updated_at=clock_timestamp() WHERE id=$1`,
      [args.caseId, nextCaseVersion],
    );
    const auditId = await appendAudit(client, {
      actor,
      action: "admin.case.venue_community_decide",
      targetType: "case",
      targetId: args.caseId,
      permission: manages(actor) ? "case.manage" : "case.assigned.manage",
      reason: args.input.reasonCode,
      after: {
        decision: args.input.decision,
        decisionId: args.decisionId,
        reportId: args.input.reportId,
        resourceKind: args.resourceKind,
        resourceId: args.resourceId,
        expectedCaseVersion: args.input.expectedCaseVersion,
        expectedResourceVersion: args.input.expectedResourceVersion,
        resultingResourceVersion: args.resultingResourceVersion,
      },
      keyHash,
    });
    await client.query(
      `INSERT INTO support_case_actions(case_id, case_version, audit_id, action, note_code)
       VALUES ($1, $2, $3, 'note', 'resolution_recorded')`,
      [args.caseId, nextCaseVersion, auditId],
    );
    return {
      caseId: args.caseId,
      caseVersion: nextCaseVersion,
      decision: args.input.decision,
      auditId,
      decisionId: args.decisionId,
      resourceKind: args.resourceKind,
      ...(args.resourceKind === "vote"
        ? { voteId: args.resourceId }
        : { commentId: args.resourceId }),
      resourceVersion: args.resultingResourceVersion,
    };
  }
}
