import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { FastifyRequest } from "fastify";
import { AdminService, type AdminActor } from "../admin/admin.service";
import { appendAudit } from "../admin/admin-db";
import { conflict, notFound, serviceUnavailable } from "../auth/problem";
import { AvatarService } from "../profiles/avatar.service";
import { sanitizeAvatar } from "../profiles/avatar-image";
import { ContentModerationService } from "../moderation/moderation.service";

/** No consumer role or supplied UI flag can grant venue.manage. Ownership further narrows it. */
@Injectable()
export class VenueCoverService {
  private processing = 0;
  constructor(private readonly admin: AdminService, private readonly media: AvatarService,
    private readonly moderation: ContentModerationService) {}
  private async scope(c: PoolClient, actor: AdminActor, id: string) {
    const user = await c.query("SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE",[actor.principal.user_id]);
    if (!user.rowCount) throw notFound("VENUE_NOT_FOUND", "Площадка недоступна для редактирования");
    const row = (await c.query<{version:number;has_cover:boolean}>(`SELECT version, cover_key IS NOT NULL AS has_cover FROM venues
      WHERE id=$1 AND created_by_user_id=$2 AND lifecycle_state IN ('unverified','verified') FOR UPDATE`,
      [id, actor.principal.user_id])).rows[0];
    if (!row) throw notFound("VENUE_NOT_FOUND", "Площадка недоступна для редактирования");
    return row;
  }
  async get(request: FastifyRequest, id: string) {
    return this.admin.privilegedRead(request, "venue.manage", async (c,a) => {
      const row = await this.scope(c,a,id);
      const cover = (await c.query<{uploaded_url:string|null}>("SELECT venue_cover_url($1) AS uploaded_url", [id])).rows[0]!;
      await appendAudit(c,{actor:a,action:"venue.cover_read",targetType:"venue",targetId:id,permission:"venue.manage",reason:"operations_read"});
      return {version:row.version,hasCover:row.has_cover,cover:{uploadedUrl:cover.uploaded_url}};
    });
  }
  async mutate(request: FastifyRequest, replayKey: string | undefined, id: string, expectedVersion: number,
    upload?: {body:unknown;mime:string}) {
    const authority = await this.admin.privilegedMutationPreflight(request, "venue.manage", async(c,a) => {
      const row=await this.scope(c,a,id); return {venueVersion:row.version,userId:a.principal.user_id,version:a.principal.version,sessionId:a.sessionId};
    });
    const original = upload && Buffer.isBuffer(upload.body) ? Buffer.from(upload.body) : null;
    const input = {id,expectedVersion,action:upload?"replace":"remove",mime:upload?.mime??null,
      sha256:original?createHash("sha256").update(original).digest("hex"):null};
    const replay = await this.admin.privilegedReplay<{version:number;hasCover:boolean;cover:{uploadedUrl:string|null}}>(request,replayKey,"venue.manage","venue.cover",input,
      async(c,a) => { await this.scope(c,a,id); });
    if (replay) return replay;
    if (authority.venueVersion !== expectedVersion) throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
    if (upload && this.processing >= 2) throw serviceUnavailable("AVATAR_BUSY", "Загрузка занята. Попробуйте ещё раз.");
    if (upload) this.processing++;
    let key: string | undefined;
    try {
      const sanitized = upload ? await sanitizeAvatar(original, upload.mime, "cover") : undefined;
      const approval = sanitized ? await this.moderation.approveImage(authority.userId, sanitized, "cover") : undefined;
      let staged: Buffer | undefined;
      if (sanitized) { key = `${randomBytes(32).toString("hex")}.png`; staged = await this.media.stage(key,sanitized); }
      return await this.admin.privilegedCommand(request,replayKey,"venue.manage",true,"venue.cover",input,async(c,a,keyHash) => {
        if (a.principal.version !== authority.version || a.sessionId !== authority.sessionId || a.principal.user_id !== authority.userId)
          throw conflict("VENUE_AUTHORITY_CHANGED", "Права изменились. Обновите данные.");
        const row = await this.scope(c,a,id);
        if (row.version !== expectedVersion) throw conflict("VENUE_VERSION_CONFLICT", "Площадка изменилась. Обновите данные.");
        const bytes = key && staged ? await this.media.verifyStage(c,key,staged) : undefined;
        const approvalId = approval && bytes ? await this.moderation.bindImage(c,approval,bytes,"cover") : null;
        const updated = (await c.query<{version:number}>(`UPDATE venues SET cover_key=$2,cover_moderation_approval_id=$3,
          cover_actor_id=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING version`,
          [id,key??null,approvalId,key?authority.userId:null])).rows[0]!;
        if (key) await c.query("DELETE FROM avatar_media_gc WHERE storage_key=$1",[key]);
        const auditId = await appendAudit(c,{actor:a,action:"venue.cover_changed",targetType:"venue",targetId:id,
          permission:"venue.manage",reason:"venue_cover",keyHash,before:{version:row.version},after:{version:updated.version}});
        await c.query("INSERT INTO venue_admin_actions(venue_id,venue_version,action,actor_id,audit_id) VALUES($1,$2,'cover',$3,$4)",[id,updated.version,a.principalId,auditId]);
        const cover = (await c.query<{url:string|null}>("SELECT venue_cover_url($1) AS url",[id])).rows[0]!;
        return {version:updated.version,hasCover:key !== undefined,cover:{uploadedUrl:cover.url}};
      },async(c,a) => { await this.scope(c,a,id); });
    } finally {
      if (key) await this.media.releaseStage(key);
      if (upload) this.processing--;
    }
  }
}
