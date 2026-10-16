import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedConsumer } from "../auth/consumer-auth.service";
import { badRequest, conflict, notFound, serviceUnavailable } from "../auth/problem";
import { MutationRunner } from "../common/mutation-runner.service";
import { IdempotencyService } from "../common/idempotency.service";
import { AvatarService } from "../profiles/avatar.service";
import { sanitizeAvatar } from "../profiles/avatar-image";
import { ContentModerationService } from "../moderation/moderation.service";
import { DATABASE_POOL } from "../tokens";
import { GameAuthorityService } from "./game-authority.service";
import { GamesService } from "./games.service";

@Injectable()
export class GameCoverService {
  private processing = 0;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly mutations: MutationRunner,
    private readonly idempotency: IdempotencyService, private readonly media: AvatarService,
    private readonly moderation: ContentModerationService, private readonly authority: GameAuthorityService,
    private readonly games: GamesService) {}
  private validId(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound("GAME_NOT_FOUND", "Игра не найдена");
  }
  private async scope(c: PoolClient, id: string, userId: string) {
    this.validId(id);
    const row = (await c.query<{version:number;status:string}>("SELECT version,status FROM games WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if (!row) throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    await this.authority.assertCanManage(c,id,userId);
    return row;
  }
  async get(id: string, actor: AuthenticatedConsumer) {
    this.validId(id);
    const row=(await this.pool.query<{version:number;has_cover:boolean;url:string|null}>(`SELECT g.version,g.cover_key IS NOT NULL AS has_cover,
      game_effective_cover_url(g.id) AS url FROM games g JOIN game_managers m ON m.game_id=g.id
      WHERE g.id=$1 AND m.user_id=$2 AND m.status='active' AND m.role IN ('owner','manager')`,[id,actor.userId])).rows[0];
    if(!row)throw notFound("GAME_NOT_FOUND", "Игра не найдена");
    return {version:row.version,hasCover:row.has_cover,cover:{uploadedUrl:row.url}};
  }
  async mutate(actor: AuthenticatedConsumer, key: string, id: string, version: unknown, upload?:{body:unknown;mime:string}) {
    this.validId(id);
    if(typeof version!=="string" || !/^[1-9][0-9]{0,9}$/.test(version) || Number(version)>2147483647)
      throw badRequest("VERSION_REQUIRED", "Обновите игру перед изменением фото");
    const expected=Number(version);
    const original=upload && Buffer.isBuffer(upload.body)?Buffer.from(upload.body):null;
    const receipt={actorId:actor.userId,sessionId:actor.sessionId,operation:"games.cover",key,
      requestHash:this.idempotency.requestHash({id,expected,action:upload?"replace":"remove",mime:upload?.mime??null,
        sha256:original?createHash("sha256").update(original).digest("hex"):null}),
      authorizeReplay:async(c:PoolClient)=>{await this.scope(c,id,actor.userId);}};
    const replay=await this.mutations.findReplay<{version:number}>(receipt);
    if(replay)return this.get(id,actor); // never return a stale URL from a receipt
    const before=await this.get(id,actor); // authorize BEFORE decode/provider work
    if(before.version!==expected)throw conflict("VERSION_CONFLICT", "Версия игры устарела");
    if(upload && this.processing>=2)throw serviceUnavailable("AVATAR_BUSY", "Загрузка занята. Попробуйте ещё раз.");
    if(upload)this.processing++;
    let storageKey:string|undefined;
    try {
      const sanitized=upload?await sanitizeAvatar(original,upload.mime,"cover"):undefined;
      const approval=sanitized?await this.moderation.approveImage(actor.userId,sanitized,"cover"):undefined;
      let staged:Buffer|undefined;
      if(sanitized){storageKey=`${randomBytes(32).toString("hex")}.png`;staged=await this.media.stage(storageKey,sanitized);}
      await this.mutations.runIdempotent({...receipt,execute:async c=>{
        const row=await this.scope(c,id,actor.userId);
        if(row.version!==expected)throw conflict("VERSION_CONFLICT", "Версия игры устарела");
        if(row.status!=="draft" && row.status!=="published")throw conflict("GAME_NOT_EDITABLE", "Фото этой игры изменить нельзя");
        const bytes=storageKey && staged?await this.media.verifyStage(c,storageKey,staged):undefined;
        const approvalId=approval && bytes?await this.moderation.bindImage(c,approval,bytes,"cover"):null;
        const updated=(await c.query<{version:number}>(`UPDATE games SET cover_key=$2,cover_moderation_approval_id=$3,
          cover_actor_id=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING version`,[id,storageKey??null,approvalId,storageKey?actor.userId:null])).rows[0]!;
        if(storageKey)await c.query("DELETE FROM avatar_media_gc WHERE storage_key=$1",[storageKey]);
        return {statusCode:200,body:{version:updated.version}};
      }});
      return await this.get(id,actor);
    } finally {if(storageKey)await this.media.releaseStage(storageKey);if(upload)this.processing--;}
  }
  async read(key: string, viewer: string|null) {
    // First read and authorize the actual Game, then reauthorize current bytes after disk I/O.
    const row=(await this.pool.query<{id:string}>("SELECT id FROM games WHERE cover_key=$1 AND game_own_cover_url(id) IS NOT NULL",[key])).rows[0];
    if(!row)throw notFound("COVER_UNAVAILABLE", "Обложка недоступна");
    await this.games.getGame(row.id,viewer);
    const bytes=await this.media.readGameCover(key);
    await this.games.getGame(row.id,viewer);
    // Replacement/hide/deletion during the read must invalidate the old key.
    await this.media.assertGameCoverCurrent(key);
    return bytes;
  }
}
