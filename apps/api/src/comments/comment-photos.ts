import { Controller, Delete, Get, Header, Inject, Injectable, Param, Post, Req, Res } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { ConsumerAuthService, type AuthenticatedConsumer } from "../auth/consumer-auth.service";
import { badRequest, conflict, notFound, ProblemHttpException, serviceUnavailable, type ProblemBody } from "../auth/problem";
import { ActorFenceService } from "../common/actor-fence.service";
import { IdempotencyService } from "../common/idempotency.service";
import { MutationRunner, type MutationResult } from "../common/mutation-runner.service";
import type { AppEnv } from "../config/env";
import { COMMUNITY_PHOTO_POLICY, ContentModerationService, type ImageApproval } from "../moderation/moderation.service";
import { MODERATION_MODEL } from "../moderation/provider";
import { sanitizeAvatar } from "../profiles/avatar-image";
import { AvatarService } from "../profiles/avatar.service";
import { assertCapabilities } from "../restrictions/policy";
import { APP_ENV, DATABASE_POOL } from "../tokens";
import { lockCatalogShared, resolveCanonicalVenue } from "../venues/venue-community.query";

export const COMMENT_PHOTO_RIGHTS = "community-photo-rights-v1";
const unavailable = () => notFound("PHOTO_SUBMISSION_UNAVAILABLE", "Фото недоступно");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw unavailable();
  return value.toLowerCase();
}
function expectedVersion(value: unknown, body: unknown): number {
  if (value !== "1") throw badRequest("VERSION_REQUIRED", "Требуется X-Photo-Version: 1");
  // Both CAS representations are required; ready submissions have version 1 only.
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).length !== 1 || (body as Record<string, unknown>).expectedVersion !== 1) {
    throw badRequest("INVALID_PHOTO_COMMAND", "Требуется JSON expectedVersion: 1, совпадающий с X-Photo-Version");
  }
  return 1;
}
type PhotoRow = {
  id: string; venue_id: string; storage_key: string; image_sha256: string;
  width: number; height: number; version: number; expires_at: Date; status: "ready" | "withdrawn";
  content_fingerprint: string;
};
type Receipt = {
  id: string; venueId: string; status: "ready" | "withdrawn"; version: number;
  expiresAt: string; width: number; height: number; previewPath: string | null;
};
type PreparedPhoto = {
  canonical: string; staged: Buffer; approval?: ImageApproval;
  width: number; height: number; rejection?: Rejection;
};
type Rejection = ProblemBody;
function receipt(row: PhotoRow): Receipt {
  return { id: row.id, venueId: row.venue_id, status: row.status, version: row.version,
    expiresAt: row.expires_at.toISOString(), width: row.width, height: row.height,
    previewPath: row.status === "ready" ? `/v1/me/venue-photo-submissions/${row.id}/content` : null };
}

@Injectable()
export class CommentPhotosService {
  private processing = 0;
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly mutations: MutationRunner, private readonly idempotency: IdempotencyService,
    private readonly fence: ActorFenceService, private readonly media: AvatarService,
    private readonly moderation: ContentModerationService) {}

  /** All local preflight/read transactions use the same actor → catalog → venue order. */
  private async ownedTransaction<T>(actor: AuthenticatedConsumer, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await this.fence.assertActiveConsumerInTransaction(client, { actorId: actor.userId, sessionId: actor.sessionId });
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  private async venue(client: PoolClient, venueId: string, canonical?: string): Promise<string> {
    await lockCatalogShared(client);
    const resolved = await resolveCanonicalVenue(client, venueId);
    if (!resolved || (canonical && resolved.canonicalId !== canonical)) throw unavailable();
    await client.query("SELECT id FROM venues WHERE id=$1 FOR SHARE", [resolved.canonicalId]);
    // Fresh statement after any row-lock wait (retirement can change eligibility).
    const fresh = await resolveCanonicalVenue(client, venueId);
    if (!fresh || fresh.canonicalId !== resolved.canonicalId) throw unavailable();
    return resolved.canonicalId;
  }
  private async capacity(client: PoolClient, owner: string): Promise<void> {
    const count = await client.query<{ count: string }>(
      "SELECT count(*) FROM venue_photo_submissions WHERE owner_user_id=$1 AND status='ready' AND expires_at>clock_timestamp()", [owner]);
    if (Number(count.rows[0]!.count) >= 8) throw conflict("COMMENT_PHOTO_LIMIT", "Сначала используйте или удалите загруженные фото");
  }
  private async current(client: PoolClient, actor: AuthenticatedConsumer, id: string): Promise<PhotoRow> {
    await assertCapabilities(client, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, actor.userId, ["profile.public"]);
    // Snapshot identifies venue only; no bytes/receipt are exposed before all current fences.
    const snapshot = await client.query<{ venue_id: string }>(
      "SELECT venue_id FROM venue_photo_submissions WHERE id=$1 AND owner_user_id=$2", [id, actor.userId]);
    if (!snapshot.rows[0]) throw unavailable();
    await this.venue(client, snapshot.rows[0].venue_id, snapshot.rows[0].venue_id);
    const found = await client.query<PhotoRow>(`SELECT s.*, a.content_fingerprint FROM venue_photo_submissions s
      JOIN content_moderation_approvals a ON a.id=s.image_approval_id
      WHERE s.id=$1 AND s.owner_user_id=$2 AND s.status='ready' AND s.expires_at>clock_timestamp()
        AND s.version=1 AND s.rights_version=$3 AND s.preset='community_photo'
        AND a.content_type='image' AND a.surface_key='community_photo_image' AND a.decision='allow'
        AND a.policy_version=$4 AND a.local_policy_version='none' AND a.fingerprint_version=1
        AND a.provider_model=$5 AND a.provider_key=$6
      FOR SHARE OF s,a`, [id, actor.userId, COMMENT_PHOTO_RIGHTS, COMMUNITY_PHOTO_POLICY, MODERATION_MODEL,
      this.env.CONTENT_MODERATION_PROVIDER]);
    const row = found.rows[0];
    if (!row || row.expires_at.getTime() <= Date.now()) throw unavailable();
    return row;
  }
  async upload(actor: AuthenticatedConsumer, venueId: string, key: string, rights: unknown, input: unknown, mime: string): Promise<MutationResult<Receipt | Rejection>> {
    venueId = uuid(venueId);
    if (rights !== COMMENT_PHOTO_RIGHTS) throw badRequest("PHOTO_RIGHTS_REQUIRED", "Подтвердите права на фото и согласие узнаваемых людей");
    const body = Buffer.isBuffer(input) ? Buffer.from(input) : input;
    const requestHash = this.idempotency.requestHash({ venueId, rights, mime, preset: "community_photo",
      policy: COMMUNITY_PHOTO_POLICY, imageSha256: Buffer.isBuffer(body) ? sha(body) : null });
    let storageKey: string | undefined;
    let retained = false;
    try {
      return await this.mutations.runWithExternalPrepare<PreparedPhoto, Receipt | Rejection>({
        actorId: actor.userId, sessionId: actor.sessionId, operation: "comments.photos.upload", key, requestHash,
        requiredCapabilities: ["profile.public"],
        authorizeReplay: async (client, saved: Receipt | Rejection) => {
          if (saved && "id" in saved) await this.current(client, actor, saved.id);
          else await this.venue(client, venueId);
        },
        prepare: async () => {
          const canonical = await this.ownedTransaction(actor, async client => {
            await assertCapabilities(client, this.env.USER_RESTRICTIONS_INTERNAL_ENABLED, actor.userId, ["profile.public"]);
            const resolved = await this.venue(client, venueId);
            await this.capacity(client, actor.userId);
            return resolved;
          });
          if (this.processing >= 2) throw serviceUnavailable("AVATAR_BUSY", "Загрузка занята. Попробуйте ещё раз.");
          this.processing++;
          try {
            const sanitized = await sanitizeAvatar(body, mime, "community_photo");
            storageKey = `${randomBytes(32).toString("hex")}.png`;
            const staged = await this.media.stage(storageKey, sanitized);
            if (!staged.equals(sanitized)) throw serviceUnavailable("AVATAR_STORAGE_UNAVAILABLE", "Фото недоступно");
            const metadata = await sharp(staged).metadata();
            try {
              const approval = await this.moderation.approveImage(actor.userId, staged, "community_photo");
              return { canonical, staged, approval, width: metadata.width!, height: metadata.height!, rejection: undefined };
            } catch (error) {
              if (error instanceof ProblemHttpException && (error.getResponse() as { code?: string }).code === "PUBLIC_IMAGE_CONTENT_REJECTED") {
                return { canonical, staged, approval: undefined, width: metadata.width!, height: metadata.height!,
                  rejection: error.getResponse() as ProblemBody };
              }
              throw error;
            }
          } finally { this.processing--; }
        },
        execute: async (client, prepared) => {
          await this.venue(client, venueId, prepared.canonical);
          if (prepared.rejection) return { statusCode: 422, body: prepared.rejection };
          await this.capacity(client, actor.userId);
          const bytes = await this.media.verifyStage(client, storageKey!, prepared.staged);
          const approvalId = await this.moderation.bindImage(client, prepared.approval!, bytes, "community_photo");
          const created = await client.query<PhotoRow>(`INSERT INTO venue_photo_submissions
            (owner_user_id,venue_id,storage_key,image_approval_id,image_sha256,preset,width,height,rights_version)
            VALUES($1,$2,$3,$4,$5,'community_photo',$6,$7,$8) RETURNING *`,
          [actor.userId, prepared.canonical, storageKey, approvalId, sha(bytes), prepared.width, prepared.height, COMMENT_PHOTO_RIGHTS]);
          return { statusCode: 201, body: receipt(created.rows[0]!) };
        },
      }).then(result => { retained = result.statusCode === 201; return result; });
    } finally {
      // Unknown COMMIT is safe: the collector checks committed live references.
      // Ready submissions keep a due journal row for one-hour abandoned-stage GC.
      if (storageKey && !retained) await this.media.releaseStage(storageKey);
    }
  }
  async status(actor: AuthenticatedConsumer, id: string): Promise<Receipt> {
    id = uuid(id);
    return this.ownedTransaction(actor, async client => receipt(await this.current(client, actor, id)));
  }
  async content(actor: AuthenticatedConsumer, id: string): Promise<Buffer> {
    id = uuid(id);
    return this.ownedTransaction(actor, async client => {
      const row = await this.current(client, actor, id);
      const bytes = await this.media.readPrivateStage(client, row.storage_key, row.image_sha256);
      if (this.moderation.fingerprint(bytes, "community_photo") !== row.content_fingerprint || row.expires_at.getTime() <= Date.now()) throw unavailable();
      return bytes;
    });
  }
  async withdraw(actor: AuthenticatedConsumer, id: string, key: string, version: unknown, command: unknown): Promise<Receipt> {
    id = uuid(id);
    const expected = expectedVersion(version, command);
    const result = await this.mutations.runIdempotent({
      actorId: actor.userId, sessionId: actor.sessionId, operation: "comments.photos.withdraw", key,
      requestHash: this.idempotency.requestHash({ id, expected }),
      authorizeReplay: async (client, saved: Receipt) => {
        const own = await client.query("SELECT 1 FROM venue_photo_submissions WHERE id=$1 AND owner_user_id=$2 AND status='withdrawn' AND version=$3", [saved.id, actor.userId, saved.version]);
        if (!own.rowCount) throw unavailable();
      },
      execute: async client => {
        // Withdrawal remains available after expiry/merge/restriction, without provider I/O.
        const found = await client.query<PhotoRow>("SELECT * FROM venue_photo_submissions WHERE id=$1 AND owner_user_id=$2 FOR UPDATE", [id, actor.userId]);
        const row = found.rows[0];
        if (!row) throw unavailable();
        if (row.status !== "ready" || row.version !== expected) throw conflict("VERSION_CONFLICT", "Фото изменилось");
        const updated = await client.query<PhotoRow>("UPDATE venue_photo_submissions SET status='withdrawn',version=version+1,withdrawn_at=clock_timestamp() WHERE id=$1 RETURNING *", [id]);
        await client.query("UPDATE avatar_media_gc SET not_before=now() WHERE storage_key=$1", [row.storage_key]);
        return { statusCode: 200, body: receipt(updated.rows[0]!) };
      },
    });
    return result.body;
  }
}

@Controller()
export class CommentPhotosController {
  constructor(private readonly auth: ConsumerAuthService, private readonly photos: CommentPhotosService,
    private readonly idempotency: IdempotencyService) {}
  @Post("venues/:venueId/comment-photos")
  @Header("Cache-Control", "no-store")
  async upload(@Req() req: FastifyRequest, @Param("venueId") venueId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const actor = await this.auth.requireCookieMutation(req);
    const key = this.idempotency.requireKey(req.headers["idempotency-key"]);
    const result = await this.photos.upload(actor, venueId, key, req.headers["x-photo-rights"], req.body, req.headers["content-type"] ?? "");
    reply.code(result.statusCode);
    if (result.statusCode >= 400) reply.type("application/problem+json");
    return result.body;
  }
  @Get("me/venue-photo-submissions/:photoId")
  @Header("Cache-Control", "no-store")
  async status(@Req() req: FastifyRequest, @Param("photoId") id: string) {
    return this.photos.status(await this.auth.requireSession(req), id);
  }
  @Get("me/venue-photo-submissions/:photoId/content")
  async content(@Req() req: FastifyRequest, @Param("photoId") id: string, @Res() reply: FastifyReply) {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox");
    // Conditional headers never bypass current authorization; return an authorized PNG body.
    const bytes = await this.photos.content(await this.auth.requireSession(req), id);
    return reply.type("image/png").send(bytes);
  }
  @Delete("me/venue-photo-submissions/:photoId")
  @Header("Cache-Control", "no-store")
  async withdraw(@Req() req: FastifyRequest, @Param("photoId") id: string) {
    const actor = await this.auth.requireCookieMutation(req);
    return this.photos.withdraw(actor, id, this.idempotency.requireKey(req.headers["idempotency-key"]), req.headers["x-photo-version"], req.body);
  }
}
